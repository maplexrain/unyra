/**
 * 动作任务封装与 WAAPI 动作编译器 (ActionCompiler)
 * 将声明式 VisualVerb / Speak / Wait / Checkpoint 编译为具备可控句柄的 RunningTask
 */
import type { StageViewport } from './StageViewport'
import { runAnimeAnimation } from './animations'
import { ANIME_ACTION_VERBS } from './verbs'
import type {
  CheckpointAction,
  ITTSAdapter,
  LessonAction,
  RunningTask,
  SpeakAction,
  VisualAction,
  WaitAction,
} from './types'

export class ActionCompiler {
  private stage: StageViewport
  private tts: ITTSAdapter

  constructor(stage: StageViewport, tts: ITTSAdapter) {
    this.stage = stage
    this.tts = tts
  }

  public compile(
    action: LessonAction,
    playbackRate: number = 1.0,
    onVoiceReady?: () => void
  ): RunningTask {
    if (action.type === 'speak') {
      return this.compileSpeak(action, playbackRate, onVoiceReady)
    }
    if (action.type === 'wait') {
      return this.compileWait(action, playbackRate)
    }
    if (action.type === 'checkpoint') {
      return this.compileCheckpoint(action)
    }
    return this.compileVisual(action, playbackRate)
  }

  /** 后台预加载口语讲解音频 */
  public preloadSpeak(text: string, rate: number = 1.0): void {
    if (this.tts.preload) {
      void this.tts.preload(text, rate)
    }
  }

  /** 编译口语讲解动作 */
  private compileSpeak(
    action: SpeakAction,
    rate: number,
    onVoiceReady?: () => void
  ): RunningTask {
    const handle = this.tts.speak(action.text, rate)
    if (onVoiceReady) {
      if (handle.ready) {
        handle.ready.then(onVoiceReady).catch(onVoiceReady)
      } else {
        onVoiceReady()
      }
    }
    // 异常安全兜底：若 TTS 引擎报错或无响应，按汉字语速估算等待时长，防止课堂死锁
    const fallbackMs = Math.max(1200, (action.text.length * 200) / rate)
    const safeFinished = handle.finished.catch(() => {
      return new Promise<void>((resolve) => {
        setTimeout(resolve, fallbackMs)
      })
    })

    return {
      pause: () => handle.pause(),
      resume: () => handle.resume(),
      abort: () => handle.stop(),
      instantFinish: () => handle.stop(),
      finished: safeFinished,
    }
  }

  /** 编译气口停顿动作 */
  private compileWait(action: WaitAction, rate: number): RunningTask {
    let timerId: number | null = null
    let remaining = Math.max(0, action.duration / rate)
    let startTime = Date.now()
    let resolveFn!: () => void

    const finished = new Promise<void>((resolve) => {
      resolveFn = resolve
      timerId = window.setTimeout(resolve, remaining)
    })

    return {
      pause: () => {
        if (timerId !== null) {
          clearTimeout(timerId)
          timerId = null
          remaining -= Date.now() - startTime
        }
      },
      resume: () => {
        if (timerId === null && remaining > 0) {
          startTime = Date.now()
          timerId = window.setTimeout(resolveFn, remaining)
        }
      },
      abort: () => {
        if (timerId !== null) {
          clearTimeout(timerId)
          timerId = null
        }
      },
      instantFinish: () => {
        if (timerId !== null) {
          clearTimeout(timerId)
          timerId = null
        }
        resolveFn()
      },
      finished,
    }
  }

  /** 编译思考/交互检查点动作（等待用户主动继续或按键） */
  private compileCheckpoint(_action: CheckpointAction): RunningTask {
    let resolveFn!: () => void

    const finished = new Promise<void>((resolve) => {
      resolveFn = resolve
    })

    return {
      pause: () => {},
      resume: () => {},
      abort: () => resolveFn(),
      instantFinish: () => resolveFn(),
      finished,
    }
  }

  /** 编译语义视觉动词 */
  private compileVisual(action: VisualAction, rate: number): RunningTask {
    const el = this.stage.getElement(action.target)
    const noop: RunningTask = {
      pause: () => {},
      resume: () => {},
      abort: () => {},
      instantFinish: () => {},
      finished: Promise.resolve(),
    }
    if (!el) return noop

    const duration = Math.max(50, (action.params?.duration ?? 450) / rate)

    // 动画动词交由 runAnimeAnimation 处理（白名单唯一事实源在 verbs.ts：'animate' +
    // registry 的一次性入场动效，含 slideIn 系列；pulse 走下面的状态动词通道）
    if (ANIME_ACTION_VERBS.has(action.verb)) {
      const animName = action.verb === 'animate' ? action.params?.animation || 'popIn' : action.verb
      return runAnimeAnimation(el, animName, duration, action.params as Record<string, unknown> | undefined)
    }

    let anim: Animation | null = null
    let fallbackTimer: number | null = null

    // 0ms 终态应用（供 instantFinish 与动画完成后调用）
    const applyFinalState = () => {
      switch (action.verb) {
        case 'appear':
          el.removeAttribute('data-hidden')
          el.style.opacity = '1'
          el.style.transform = el.dataset.baseTransform || ''
          break
        case 'disappear':
          el.setAttribute('data-hidden', 'true')
          el.style.opacity = '0'
          break
        case 'highlight':
          el.classList.add('fx-highlight')
          if (action.params?.color) {
            el.style.setProperty('--fx-color', action.params.color)
          }
          break
        case 'unhighlight':
          el.classList.remove('fx-highlight')
          break
        case 'dimOthers':
          if (el.parentElement) {
            Array.from(el.parentElement.children).forEach((child) => {
              const sib = child as HTMLElement
              if (sib.id) {
                sib.style.opacity = sib === el ? '1' : '0.25'
              }
            })
          }
          break
        case 'resetFocus':
          if (el.parentElement) {
            Array.from(el.parentElement.children).forEach((child) => {
              const sib = child as HTMLElement
              if (sib.id) {
                sib.style.opacity = '1'
              }
            })
          }
          break
        case 'move': {
          const prevX = Number(el.dataset.tx || 0)
          const prevY = Number(el.dataset.ty || 0)
          const nextX = prevX + (action.params?.x ?? 0)
          const nextY = prevY + (action.params?.y ?? 0)
          el.dataset.tx = String(nextX)
          el.dataset.ty = String(nextY)
          const t = `translate(${nextX}px, ${nextY}px)`
          el.dataset.baseTransform = t
          el.style.transform = t
          break
        }
        case 'scale': {
          const s = action.params?.scale ?? 1.15
          const tx = Number(el.dataset.tx || 0)
          const ty = Number(el.dataset.ty || 0)
          const t = `translate(${tx}px, ${ty}px) scale(${s})`
          el.dataset.baseTransform = t
          el.style.transform = t
          break
        }
        case 'drawSvg':
          el.removeAttribute('data-hidden')
          el.style.opacity = '1'
          ;(el as unknown as SVGGeometryElement).style.strokeDashoffset = '0'
          break;
        case 'updateText':
          if (action.params?.text !== undefined) {
            el.textContent = action.params.text
          }
          break
        case 'pulse':
          // 瞬态动画，无持久化终态变化
          break
      }
    }

    // 运行动画
    const runAnimation = (): Promise<void> => {
      // 在支持 WAAPI animate 的现代环境中执行硬件加速动画
      if (typeof el.animate === 'function') {
        switch (action.verb) {
          case 'appear': {
            el.removeAttribute('data-hidden')
            anim = el.animate(
              [
                { opacity: 0, transform: 'translateY(20px)' },
                { opacity: 1, transform: 'translateY(0)' },
              ],
              { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' }
            )
            break
          }
          case 'disappear': {
            anim = el.animate(
              [{ opacity: 1 }, { opacity: 0 }],
              { duration, easing: 'ease-out', fill: 'forwards' }
            )
            break
          }
          case 'pulse': {
            const base = el.dataset.baseTransform || ''
            anim = el.animate(
              [
                { transform: `${base} scale(1)` },
                { transform: `${base} scale(1.08)` },
                { transform: `${base} scale(1)` },
              ],
              { duration: Math.max(duration, 400), easing: 'ease-in-out' }
            )
            break
          }
          case 'drawSvg': {
            el.removeAttribute('data-hidden')
            el.style.opacity = '1'
            const svgEl = el as unknown as SVGGeometryElement
            const len = typeof svgEl.getTotalLength === 'function' ? svgEl.getTotalLength() : 600
            svgEl.style.strokeDasharray = String(len)
            anim = el.animate(
              [{ strokeDashoffset: len }, { strokeDashoffset: 0 }],
              { duration: Math.max(duration, 600), easing: 'ease-in-out', fill: 'forwards' }
            )
            break
          }
          case 'move': {
            const prevX = Number(el.dataset.tx || 0)
            const prevY = Number(el.dataset.ty || 0)
            const nextX = prevX + (action.params?.x ?? 0)
            const nextY = prevY + (action.params?.y ?? 0)
            anim = el.animate(
              [
                { transform: `translate(${prevX}px, ${prevY}px)` },
                { transform: `translate(${nextX}px, ${nextY}px)` },
              ],
              { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' }
            )
            break
          }
          default: {
            // highlight / unhighlight / dimOthers / resetFocus / scale / updateText
            el.style.transition = `all ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`
            applyFinalState()
            return new Promise<void>((res) => {
              fallbackTimer = window.setTimeout(() => {
                el.style.transition = ''
                res()
              }, duration)
            })
          }
        }

        if (anim) {
          return anim.finished
            .then(() => {
              applyFinalState()
              anim?.cancel() // 释放 forwards，由 inline style 接管
            })
            .catch(() => {
              // 被 cancel 或中断时静默
            })
        }
      }

      // 兜底直接应用终态
      applyFinalState()
      return Promise.resolve()
    }

    const finished = runAnimation()

    return {
      pause: () => anim?.pause(),
      resume: () => anim?.play(),
      abort: () => {
        if (fallbackTimer !== null) clearTimeout(fallbackTimer)
        anim?.cancel()
      },
      instantFinish: () => {
        if (fallbackTimer !== null) clearTimeout(fallbackTimer)
        anim?.cancel()
        applyFinalState()
      },
      finished,
    }
  }
}
