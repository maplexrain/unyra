/**
 * 对接宿主环境统一 TTS 系统的课堂音频适配器
 * 支持三句滑动窗口预加载（Preload Buffer），实现 0ms 延迟即时播放与音画精准同步
 */
import { ttsManager } from '../../lib/tts/manager'
import { cleanTextForSpeech } from '../../lib/tts/cleanText'
import { capsCacheGet, capsCacheSet, capsHashKey } from '../../lib/capsCache'
import { loadCapabilities, ttsEngineOf } from '../../lib/capabilities'
import { native } from '../../lib/native'
import type { ITTSAdapter, TTSPlaybackHandle } from './types'

interface PreloadEntry {
  text: string
  audio?: HTMLAudioElement
  audioUrl?: string
  readyPromise: Promise<void>
}

export class ClassroomTTSAdapter implements ITTSAdapter {
  private preloadCache = new Map<string, PreloadEntry>()
  private maxCacheSize = 12

  /**
   * 预加载指定文本的音频数据，填充三句话缓冲区
   */
  public async preload(text: string, _rate: number = 1.0): Promise<void> {
    const cleaned = cleanTextForSpeech(text)
    if (!cleaned) return

    // 优先从持久化缓存尝试获取音频数据
    const engineCfg = ttsEngineOf()
    const mode = loadCapabilities().tts.mode
    const voiceId = engineCfg?.voiceId ?? ''
    const key = await capsHashKey('tts', mode, voiceId, cleaned)
    
    // 检查是否已经在 preloadCache 中
    if (this.preloadCache.has(cleaned)) {
      return this.preloadCache.get(cleaned)!.readyPromise
    }

    let resolveReady!: () => void
    const readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve
    })

    const entry: PreloadEntry = {
      text: cleaned,
      readyPromise,
    }

    // 维护缓存容量
    if (this.preloadCache.size >= this.maxCacheSize) {
      const oldest = this.preloadCache.keys().next().value
      if (oldest) this.preloadCache.delete(oldest)
    }
    this.preloadCache.set(cleaned, entry)

    try {
      const cached = await capsCacheGet<{ audioBase64: string; mime: string }>(key)
      let audioUrl: string | null = null

      if (cached?.audioBase64) {
        audioUrl = `data:${cached.mime || 'audio/wav'};base64,${cached.audioBase64}`
      } else if (engineCfg && typeof native === 'function') {
        const res = await native().caps.tts({
          text: cleaned,
          ...(voiceId ? { voiceId } : {}),
          engine: engineCfg.engine,
        })
        if (res?.ok && res.audioBase64) {
          await capsCacheSet(key, { audioBase64: res.audioBase64, mime: res.mime || 'audio/wav' })
          audioUrl = `data:${res.mime || 'audio/wav'};base64,${res.audioBase64}`
        }
      }

      if (audioUrl && typeof Audio !== 'undefined') {
        const audio = new Audio(audioUrl)
        audio.preload = 'auto'
        entry.audio = audio
        entry.audioUrl = audioUrl
      }
    } catch {
      // 容错降级
    } finally {
      resolveReady()
    }

    return readyPromise
  }

  public speak(text: string, rate: number = 1.0): TTSPlaybackHandle {
    const cleaned = cleanTextForSpeech(text) || text
    const cachedEntry = this.preloadCache.get(cleaned)

    // 若命中预加载的高性能音频缓冲
    if (cachedEntry?.audio) {
      const audio = cachedEntry.audio
      let resolveFinished!: () => void
      let isDone = false

      const finished = new Promise<void>((resolve) => {
        resolveFinished = resolve
      })

      const onEnd = () => {
        if (!isDone) {
          isDone = true
          audio.removeEventListener('ended', onEnd)
          audio.removeEventListener('error', onEnd)
          resolveFinished()
        }
      }

      audio.addEventListener('ended', onEnd, { once: true })
      audio.addEventListener('error', onEnd, { once: true })
      audio.playbackRate = rate
      audio.currentTime = 0

      const playPromise = audio.play().catch(() => {
        onEnd()
      })

      return {
        pause: () => {
          try {
            audio.pause()
          } catch {}
        },
        resume: () => {
          try {
            audio.play().catch(() => {})
          } catch {}
        },
        stop: () => {
          if (!isDone) {
            try {
              audio.pause()
              audio.currentTime = 0
            } catch {}
            onEnd()
          }
        },
        finished,
        ready: playPromise.then(() => {}),
      }
    }

    // 缺省回退到统一 ttsManager
    let hasEnded = false
    let resolveFn!: () => void
    let rejectFn!: (err: unknown) => void
    let resolveReady!: () => void

    const finished = new Promise<void>((resolve, reject) => {
      resolveFn = resolve
      rejectFn = reject
    })

    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve
    })

    const onComplete = () => {
      if (!hasEnded) {
        hasEnded = true
        resolveFn()
      }
    }

    try {
      ttsManager
        .speak(text, {
          rate,
          onStart: () => resolveReady(),
          onEnd: onComplete,
          onError: (err) => {
            resolveReady()
            if (!hasEnded) {
              hasEnded = true
              rejectFn(err)
            }
          },
        })
        .catch((err) => {
          resolveReady()
          if (!hasEnded) {
            hasEnded = true
            rejectFn(err)
          }
        })
    } catch (err) {
      resolveReady()
      if (!hasEnded) {
        hasEnded = true
        rejectFn(err)
      }
    }

    return {
      pause: () => ttsManager.pause(),
      resume: () => ttsManager.resume(),
      stop: () => {
        if (!hasEnded) {
          hasEnded = true
          ttsManager.stop()
          resolveFn()
        }
      },
      finished,
      ready,
    }
  }
}

export const defaultClassroomTTS = new ClassroomTTSAdapter()
