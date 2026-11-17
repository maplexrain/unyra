/**
 * 对接宿主环境统一 TTS 系统的互动课堂音频适配器
 */
import { ttsManager } from '../../lib/tts/manager'
import type { ITTSAdapter, TTSPlaybackHandle } from './types'

export class ClassroomTTSAdapter implements ITTSAdapter {
  public speak(text: string, rate: number = 1.0): TTSPlaybackHandle {
    let hasEnded = false
    let resolveFn!: () => void
    let rejectFn!: (err: unknown) => void

    const finished = new Promise<void>((resolve, reject) => {
      resolveFn = resolve
      rejectFn = reject
    })

    const onComplete = () => {
      if (!hasEnded) {
        hasEnded = true
        resolveFn()
      }
    }

    // 调用全局 ttsManager
    try {
      ttsManager.speak(text, {
        rate,
        onEnd: onComplete,
        onError: (err) => {
          if (!hasEnded) {
            hasEnded = true
            rejectFn(err)
          }
        },
      }).catch((err) => {
        if (!hasEnded) {
          hasEnded = true
          rejectFn(err)
        }
      })
    } catch (err) {
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
    }
  }
}

export const defaultClassroomTTS = new ClassroomTTSAdapter()
