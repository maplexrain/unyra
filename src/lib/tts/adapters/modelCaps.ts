/**
 * 「模型能力」TTS 适配器：接入方式由「设置 → 模型 → 能力接入」决定——
 * DeepSeek 官方（/v1/tools/tts，stella / tide 两个音色）或用户自架的
 * OpenAI 兼容本地服务（/audio/speech）。合成请求经主进程发起
 * （native().caps.tts），结果按「文本 + 音色 + 引擎」指纹落盘缓存：
 * 同一段话再听一遍不再花钱、也不再等网络。
 *
 * 播放骨架沿用了旧离线适配器的方案（分句 → 预取下一句 → 顺序无缝播放），
 * 那套结构当年是为端侧推理的吞吐写的，对按量计费的云端一样成立——
 * 只是「预取」现在还兼着「缓存命中」的便宜。
 */

import { cleanTextForSpeech } from '../cleanText'
import { splitTextIntoSpeechChunks } from '../chunkText'
import type { TTSAdapter, TTSSpeakOptions, TTSVoice } from '../types'
import { native } from '../../native'
import { t } from '../../../i18n'
import { DEEPSEEK_TTS_VOICES } from '../../../ai/capabilitySettings'
import { capsCacheGet, capsCacheSet, capsHashKey } from '../../capsCache'
import { loadCapabilities, ttsEngineOf } from '../../capabilities'

/** 单条合成结果的缓存形态（音频字节 + MIME，还原成 data URL 交给播放器） */
interface CachedAudio {
  audioBase64: string
  mime: string
}

export class ModelCapsTTSAdapter implements TTSAdapter {
  readonly id = 'model-caps'
  readonly name = '模型能力 (DeepSeek / 本地服务)'
  readonly description = '由「设置 → 模型 → 能力接入」决定：DeepSeek 官方音色或本地 OpenAI 兼容服务，结果本地缓存。'

  private currentAudio: HTMLAudioElement | null = null
  private abortController: AbortController | null = null

  async isAvailable(): Promise<boolean> {
    return ttsEngineOf() !== null
  }

  async getVoices(): Promise<TTSVoice[]> {
    if (loadCapabilities().tts.mode === 'deepseek') {
      return DEEPSEEK_TTS_VOICES.map((v: { id: string; label: string }) => ({
        id: v.id,
        name: v.label,
        lang: 'zh/en',
        gender: v.id === 'tide' ? 'male' : 'female',
      }))
    }
    const voice = loadCapabilities().tts.local?.voice
    return [
      {
        id: voice || 'alloy',
        name: voice ? t(`本地音色 {0}`, voice) : t('本地适配器默认音色'),
        lang: 'zh/en',
        localService: true,
      },
    ]
  }

  async speak(text: string, options?: TTSSpeakOptions): Promise<void> {
    const engineCfg = ttsEngineOf()
    if (!engineCfg) {
      throw new Error('TTS 尚未接入：到「设置 → 模型 → 能力接入」选择 DeepSeek 或本地服务')
    }

    this.stop()

    const cleaned = cleanTextForSpeech(text)
    if (!cleaned) return

    // 分句：长文本拆成 ~70 字的短句逐段合成，第 N 句播放时后台预合成第 N+1 句，
    // 首响时间与缓存粒度都受益（同句重听直接命中缓存）
    const chunks = splitTextIntoSpeechChunks(cleaned, 70)
    if (!chunks.length) return

    const abort = new AbortController()
    this.abortController = abort

    const mode = loadCapabilities().tts.mode
    const voiceId = options?.voiceId || engineCfg.voiceId
    const speed = options?.rate || 1.0

    const fetchChunk = async (idx: number): Promise<string | null> => {
      if (idx < 0 || idx >= chunks.length || abort.signal.aborted) return null
      const chunk = chunks[idx]
      const key = await capsHashKey('tts', mode, voiceId ?? '', chunk)
      const cached = await capsCacheGet<CachedAudio>(key)
      if (cached?.audioBase64) return `data:${cached.mime || 'audio/wav'};base64,${cached.audioBase64}`
      if (abort.signal.aborted) return null
      const res = await native().caps.tts({
        text: chunk,
        ...(voiceId ? { voiceId } : {}),
        engine: engineCfg.engine,
      })
      if (abort.signal.aborted) return null
      if (!res.ok || !res.audioBase64) {
        throw new Error(res.error || `句子合成失败：${chunk.slice(0, 15)}…`)
      }
      const value: CachedAudio = { audioBase64: res.audioBase64, mime: res.mime || 'audio/wav' }
      await capsCacheSet(key, value)
      return `data:${value.mime};base64,${value.audioBase64}`
    }

    // 提前启动第 0 句与第 1 句
    void fetchChunk(0)
    if (chunks.length > 1) void fetchChunk(1)

    let startedTriggered = false

    return new Promise(async (resolve, reject) => {
      try {
        for (let i = 0; i < chunks.length; i++) {
          if (abort.signal.aborted) break

          if (i + 1 < chunks.length) void fetchChunk(i + 1)

          const audioUrl = await fetchChunk(i)
          if (abort.signal.aborted) break
          if (!audioUrl) continue

          await new Promise<void>((playResolve, playReject) => {
            if (abort.signal.aborted) {
              playResolve()
              return
            }

            const audio = new Audio(audioUrl)
            this.currentAudio = audio

            const cleanup = () => {
              abort.signal.removeEventListener('abort', onAbort)
              if (this.currentAudio === audio) {
                this.currentAudio = null
              }
            }

            const onAbort = () => {
              cleanup()
              try {
                audio.pause()
                audio.currentTime = 0
              } catch {}
              playResolve()
            }

            abort.signal.addEventListener('abort', onAbort, { once: true })

            if (options?.volume !== undefined) {
              audio.volume = Math.max(0, Math.min(1, options.volume))
            }
            // DeepSeek /audio/speech 这条契约没有语速参数（只有音色与格式），
            // 语速在播放层调：playbackRate + preservesPitch，快慢不变形
            if (speed !== 1.0) {
              try {
                audio.playbackRate = speed
                ;(audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true
              } catch {}
            }

            audio.onplay = () => {
              if (!startedTriggered) {
                startedTriggered = true
                options?.onStart?.()
              }
            }

            audio.onended = () => {
              cleanup()
              playResolve()
            }

            audio.onerror = () => {
              cleanup()
              const err = new Error('音频解码播放失败')
              options?.onError?.(err)
              playReject(err)
            }

            audio.play().catch((err) => {
              cleanup()
              if (abort.signal.aborted) {
                playResolve()
              } else {
                options?.onError?.(err)
                playReject(err)
              }
            })
          })
        }

        if (!abort.signal.aborted) {
          options?.onEnd?.()
        }
        resolve()
      } catch (err) {
        if (!abort.signal.aborted) {
          options?.onError?.(err instanceof Error ? err : new Error(String(err)))
        }
        reject(err)
      } finally {
        if (this.abortController === abort) {
          this.abortController = null
        }
      }
    })
  }

  pause(): void {
    if (this.currentAudio && !this.currentAudio.paused) {
      this.currentAudio.pause()
    }
  }

  resume(): void {
    if (this.currentAudio && this.currentAudio.paused) {
      this.currentAudio.play().catch(() => {})
    }
  }

  stop(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    if (this.currentAudio) {
      this.currentAudio.pause()
      this.currentAudio.currentTime = 0
      this.currentAudio = null
    }
  }
}
