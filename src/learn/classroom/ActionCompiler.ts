/**
 * 动作任务封装与 WAAPI 动作编译器 (ActionCompiler)
 * 将声明式 VisualVerb / Speak / Wait / Checkpoint 编译为具备可控句柄的 RunningTask，
 * 并与 WebAudio 音效引擎（sfxEngine）协同实现确定性音画同步（快进静音）。
 */
import type { StageViewport } from './StageViewport'
import { runAnimeAnimation } from './animations'
import { startSfx, type SfxHandle } from './sfx/sfxEngine'
import { ANIME_ACTION_VERBS, WAKING_VERBS } from './verbs'
import type {
  CheckpointAction,
  ITTSAdapter,
  LessonAction,
  RunningTask,
  SpeakAction,
  VisualAction,
  WaitAction,
} from './types'

const INTRINSIC_VERB_SFX: Record<string, string> = {
  countUp: 'count',
  typewriter: 'typing',
  stamp: 'stamp',
  tada: 'success',
}

export interface CompileOptions {
  /** 静音编译（用于 seekTo 快进重演，绝不发出音效） */
  silent?: boolean
}

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
    onVoiceReady?: () => void,
    opts?: CompileOptions,
  ): RunningTask {
    if (action.type === 'speak') {
      return this.compileSpeak(action, playbackRate, onVoiceReady)
    }
    if (action.type === 'wait') {
      return this.compileWait(action, playbackRate)
    }
    if (action.type === 'checkpoint') {
      return this.compileCheckpoint(action, opts)
    }
    return this.compileVisual(action, playbackRate, opts)
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
    onVoiceReady?: () => void,
  ): RunningTask {
    const handle = this.tts.speak(action.text, rate)
    if (onVoiceReady) {
      if (handle.ready) {
        handle.ready.then(onVoiceReady).catch(onVoiceReady)
      } else {
        onVoiceReady()
      }
    }
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
  private compileCheckpoint(action: CheckpointAction, opts?: CompileOptions): RunningTask {
    let resolveFn!: () => void
    let sfxHandle: SfxHandle | null = null

    if (!opts?.silent) {
      const sfxName = action.sfx ?? 'bell'
      if (sfxName && sfxName !== 'none') {
        sfxHandle = startSfx(sfxName)
      }
    }

    const finished = new Promise<void>((resolve) => {
      resolveFn = resolve
    })

    return {
      pause: () => {},
      resume: () => {},
      abort: () => {
        sfxHandle?.stop()
        resolveFn()
      },
      instantFinish: () => {
        sfxHandle?.stop()
        resolveFn()
      },
      finished,
    }
  }

  /** 编译语义视觉动词 */
  private compileVisual(action: VisualAction, rate: number, opts?: CompileOptions): RunningTask {
    const el = this.stage.getElement(action.target)
    const noop: RunningTask = {
      pause: () => {},
      resume: () => {},
      abort: () => {},
      instantFinish: () => {},
      finished: Promise.resolve(),
    }
    if (!el) return noop

    const resolvedAnim = action.verb === 'animate' ? action.params?.animation || 'popIn' : action.verb
    const defaultMs =
      resolvedAnim === 'typewriter' ? 1200 : resolvedAnim === 'countUp' ? 1100 : ANIME_ACTION_VERBS.has(action.verb) ? 620 : 480
    const duration = Math.max(50, (action.params?.duration ?? defaultMs) / rate)

    // 确定此动作是否伴随音效（快进模式 silent=true 时严格静音）
    let sfxHandle: SfxHandle | null = null
    if (!opts?.silent) {
      const explicitSfx = action.params?.sfx
      const attrSfx = WAKING_VERBS.has(action.verb) ? el.getAttribute('data-sfx') : null
      const sfxName = explicitSfx !== undefined ? explicitSfx : (attrSfx ?? INTRINSIC_VERB_SFX[resolvedAnim])
      if (sfxName && sfxName !== 'none') {
        const sfxDuration =
          resolvedAnim === 'typewriter'
            ? Math.max(duration, ((action.params?.text || el.dataset.fullText || el.textContent || '').length * 42) / rate)
            : duration
        sfxHandle = startSfx(sfxName, { duration: sfxDuration })
      }
    }

    // 动画动词交由 runAnimeAnimation 处理
    if (ANIME_ACTION_VERBS.has(action.verb)) {
      const task = runAnimeAnimation(el, resolvedAnim, duration, action.params as Record<string, unknown> | undefined)
      return {
        pause: task.pause,
        resume: task.resume,
        abort: () => {
          sfxHandle?.stop()
          task.abort()
        },
        instantFinish: () => {
          sfxHandle?.stop()
          task.instantFinish()
        },
        finished: task.finished,
      }
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
                if (sib === el) {
                  sib.style.opacity = '1'
                  sib.style.filter = 'none'
                  sib.style.transform = sib.dataset.baseTransform || ''
                } else {
                  sib.style.opacity = '0.26'
                  sib.style.filter = 'blur(0.8px) saturate(0.75)'
                  sib.style.transform = `${sib.dataset.baseTransform || ''} scale(0.985)`.trim()
                }
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
                sib.style.filter = 'none'
                sib.style.transform = sib.dataset.baseTransform || ''
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
          const s = action.params?.scale ?? 1.12
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
          break
        case 'updateText':
          if (action.params?.text !== undefined) {
            el.textContent = action.params.text
          }
          break
        case 'pulse':
          break
      }
    }

    const runAnimation = (): Promise<void> => {
      if (typeof el.animate === 'function') {
        switch (action.verb) {
          case 'appear': {
            el.removeAttribute('data-hidden')
            const base = el.dataset.baseTransform || ''
            anim = el.animate(
              [
                { opacity: 0, transform: `${base} translateY(22px) scale(0.975)`.trim() },
                { opacity: 1, transform: base || 'translateY(0) scale(1)' },
              ],
              { duration, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' },
            )
            break
          }
          case 'disappear': {
            anim = el.animate(
              [
                { opacity: 1, transform: el.dataset.baseTransform || 'scale(1)' },
                { opacity: 0, transform: `${el.dataset.baseTransform || ''} scale(0.97)`.trim() },
              ],
              { duration, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
            )
            break
          }
          case 'pulse': {
            const base = el.dataset.baseTransform || ''
            anim = el.animate(
              [
                { transform: `${base} scale(1)` },
                { transform: `${base} scale(1.06)` },
                { transform: `${base} scale(1)` },
              ],
              { duration: Math.max(duration, 420), easing: 'ease-in-out' },
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
              { duration: Math.max(duration, 650), easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
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
              { duration, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' },
            )
            break
          }
          default: {
            // highlight / unhighlight / dimOthers / resetFocus / scale / updateText
            const targets: HTMLElement[] =
              (action.verb === 'dimOthers' || action.verb === 'resetFocus') && el.parentElement
                ? Array.from(el.parentElement.children).filter((c): c is HTMLElement => !!(c as HTMLElement).id)
                : [el]
            targets.forEach((t) => {
              t.style.transition = `all ${duration}ms cubic-bezier(0.16, 1, 0.3, 1)`
            })
            applyFinalState()
            return new Promise<void>((res) => {
              fallbackTimer = window.setTimeout(() => {
                targets.forEach((t) => {
                  t.style.transition = ''
                })
                res()
              }, duration)
            })
          }
        }

        if (anim) {
          return anim.finished
            .then(() => {
              applyFinalState()
              anim?.cancel()
            })
            .catch(() => {})
        }
      }

      applyFinalState()
      return Promise.resolve()
    }

    const finished = runAnimation()

    return {
      pause: () => anim?.pause(),
      resume: () => anim?.play(),
      abort: () => {
        sfxHandle?.stop()
        if (fallbackTimer !== null) clearTimeout(fallbackTimer)
        anim?.cancel()
      },
      instantFinish: () => {
        sfxHandle?.stop()
        if (fallbackTimer !== null) clearTimeout(fallbackTimer)
        anim?.cancel()
        applyFinalState()
      },
      finished,
    }
  }
}
