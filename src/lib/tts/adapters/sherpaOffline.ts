/**
 * 基于 Sherpa-ONNX 本地离线神经网络的 TTS 适配器。
 *
 * 支持多款高品质端侧离线模型并允许随时切换：
 * - MeloTTS: 44.1kHz 超清 CD 级音质，支持中英文自然混读，约 60MB；
 * - AISHELL-3: 8kHz 极速轻量，内置 174 位发音人，约 42MB。
 *
 * 特性：
 * - 纯端侧离线推理，不经过任何云端网络，隐私零外泄；
 * - 毫秒级极速生成，发音清晰自然；
 * - 首次使用时按需下载，不随安装包分发。
 */

import { cleanTextForSpeech } from '../cleanText'
import { splitTextIntoSpeechChunks } from '../chunkText'
import type { TTSAdapter, TTSSpeakOptions, TTSVoice } from '../types'
import { isWeb, native } from '../../native'

export const STORAGE_ACTIVE_OFFLINE_MODEL = 'moji-tts-active-offline-model'
export const DEFAULT_OFFLINE_MODEL = 'vits-melo-tts-zh_en'

export class SherpaOfflineTTSAdapter implements TTSAdapter {
  readonly id = 'sherpa-offline'
  readonly name = '本地离线模型 (Sherpa-ONNX · VITS)'
  readonly description = '纯端侧运行的高保真神经网络模型，零云端网络依赖，支持 44.1kHz MeloTTS 与 AISHELL-3 等多种优质音色。'

  private currentAudio: HTMLAudioElement | null = null
  private abortController: AbortController | null = null

  getActiveModelId(): string {
    try {
      return localStorage.getItem(STORAGE_ACTIVE_OFFLINE_MODEL) || DEFAULT_OFFLINE_MODEL
    } catch {
      return DEFAULT_OFFLINE_MODEL
    }
  }

  setActiveModelId(modelId: string): void {
    try {
      localStorage.setItem(STORAGE_ACTIVE_OFFLINE_MODEL, modelId)
    } catch {}
  }

  async isAvailable(): Promise<boolean> {
    if (isWeb() || !window.mojiNative?.tts) return false
    try {
      const modelId = this.getActiveModelId()
      const status = await native().tts.modelStatus(modelId)
      return status.exists
    } catch {
      return false
    }
  }

  async getVoices(): Promise<TTSVoice[]> {
    if (isWeb() || !window.mojiNative?.tts) {
      return [
        { id: '0', name: 'MeloTTS 自然女声 (44.1kHz 高保真)', lang: 'zh/en', gender: 'female', localService: true },
      ]
    }
    try {
      const activeModelId = this.getActiveModelId()
      const status = await native().tts.modelStatus(activeModelId)
      const currentDef = status.availableModels?.find((m) => m.id === activeModelId)
      if (currentDef && currentDef.speakers && currentDef.speakers.length > 0) {
        return currentDef.speakers.map((s) => ({
          id: s.id,
          name: s.name,
          lang: s.lang || 'zh-CN',
          gender: s.gender as any,
          localService: true,
        }))
      }
    } catch {}
    return [
      { id: '0', name: 'MeloTTS 自然女声 (44.1kHz 高保真)', lang: 'zh/en', gender: 'female', localService: true },
    ]
  }

  async speak(text: string, options?: TTSSpeakOptions): Promise<void> {
    if (isWeb() || !window.mojiNative?.tts) {
      throw new Error('Web 浏览器环境暂不支持本地离线推理，请使用桌面客户端')
    }

    const available = await this.isAvailable()
    if (!available) {
      throw new Error('当前选中的本地离线语音模型尚未下载，请前往【设置 → 插件 → 语音合成】进行下载')
    }

    this.stop()

    const cleaned = cleanTextForSpeech(text)
    if (!cleaned) return

    // 智能分句：将长文本拆为自然短句，单句控制在 ~70 字内，避免大批量文本导致引擎卡死
    const chunks = splitTextIntoSpeechChunks(cleaned, 70)
    if (!chunks.length) return

    const abort = new AbortController()
    this.abortController = abort

    const speakerId = options?.voiceId ? Number.parseInt(options.voiceId, 10) || 0 : 0
    const speed = options?.rate || 1.0
    const modelId = this.getActiveModelId()

    // 预合成缓存：当前正在播放第 N 句时，后台提前预合成第 N+1 句，实现无缝连续播放
    const prefetchMap = new Map<number, Promise<string | null>>()

    const fetchChunk = (idx: number): Promise<string | null> => {
      if (idx < 0 || idx >= chunks.length || abort.signal.aborted) {
        return Promise.resolve(null)
      }
      if (prefetchMap.has(idx)) {
        return prefetchMap.get(idx)!
      }
      const p = (async () => {
        if (abort.signal.aborted) return null
        const res = await native().tts.synthesize({
          text: chunks[idx],
          speed,
          speakerId,
          modelId,
        })
        if (abort.signal.aborted) return null
        if (!res.ok || !res.audioDataUrl) {
          throw new Error(res.error || `句子合成失败：${chunks[idx].slice(0, 15)}...`)
        }
        return res.audioDataUrl
      })()
      prefetchMap.set(idx, p)
      return p
    }

    // 提前启动第 0 句与第 1 句预合成
    void fetchChunk(0)
    if (chunks.length > 1) {
      void fetchChunk(1)
    }

    let startedTriggered = false

    return new Promise(async (resolve, reject) => {
      try {
        for (let i = 0; i < chunks.length; i++) {
          if (abort.signal.aborted) break

          // 播放第 i 句时，立即预拉取第 i+1 句
          if (i + 1 < chunks.length) {
            void fetchChunk(i + 1)
          }

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
              const err = new Error('离线音频解码播放失败')
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
      } catch (err: any) {
        if (!abort.signal.aborted) {
          options?.onError?.(err)
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
