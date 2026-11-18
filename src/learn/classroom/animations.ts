/**
 * anime.js 课堂内置动画引擎 (animations.ts)
 * 提供可挂载在组件上的多种预置动效、数字滚动、打字机及动作调度句柄
 */
import { animate } from 'animejs'
import type { RunningTask } from './types'

export type ClassroomAnimationName =
  | 'bounce'
  | 'shake'
  | 'wobble'
  | 'float'
  | 'pulse'
  | 'popIn'
  | 'zoomIn'
  | 'flip'
  | 'slideInLeft'
  | 'slideInRight'
  | 'slideInTop'
  | 'slideInBottom'
  | 'rotate'
  | 'glow'
  | 'countUp'
  | 'typewriter'

interface AnimeAnimationInstance {
  pause: () => void
  resume: () => void
  cancel: () => void
  complete: () => void
  then: (onfulfilled?: (() => void) | null) => Promise<unknown>
}

/** 空任务句柄兜底 */
function createNoopTask(): RunningTask {
  return {
    pause: () => {},
    resume: () => {},
    abort: () => {},
    instantFinish: () => {},
    finished: Promise.resolve(),
  }
}

/** 执行单次由 anime.js 驱动的内置动画 */
export function runAnimeAnimation(
  el: HTMLElement,
  name: string,
  customDuration?: number,
  params?: Record<string, unknown>
): RunningTask {
  if (typeof window === 'undefined' || !el) {
    return createNoopTask()
  }

  // 播放前确保元素脱离隐藏态
  if (el.hasAttribute('data-hidden')) {
    el.removeAttribute('data-hidden')
    el.style.opacity = '1'
  }

  const duration = Math.max(100, customDuration ?? 600)
  let animInstance: AnimeAnimationInstance | null = null

  // 终态回落保底逻辑
  const applyFinalState = () => {
    switch (name) {
      case 'popIn':
      case 'zoomIn':
      case 'slideInLeft':
      case 'slideInRight':
      case 'slideInTop':
      case 'slideInBottom':
        el.style.opacity = '1'
        el.style.transform = el.dataset.baseTransform || ''
        break
      case 'countUp': {
        const endVal = typeof params?.end === 'number' ? params.end : parseFloat(el.textContent || '0') || 0
        const suffix = typeof params?.suffix === 'string' ? params.suffix : ''
        el.textContent = `${endVal}${suffix}`
        break
      }
      case 'typewriter': {
        const fullText = (params?.text as string) || el.dataset.fullText || el.textContent || ''
        el.textContent = fullText
        break
      }
      case 'flip':
        el.style.transform = 'perspective(1000px) rotateY(0deg)'
        break
      default:
        el.style.transform = el.dataset.baseTransform || ''
        break
    }
  }

  try {
    switch (name) {
      case 'bounce': {
        animInstance = animate(el, {
          translateY: [0, -32, 0, -16, 0],
          duration,
          ease: 'outBounce',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'shake': {
        animInstance = animate(el, {
          translateX: [0, -14, 14, -10, 10, -5, 5, 0],
          duration,
          ease: 'inOutQuad',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'wobble': {
        animInstance = animate(el, {
          rotate: [0, -8, 7, -5, 4, -2, 0],
          duration,
          ease: 'inOutQuad',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'float': {
        animInstance = animate(el, {
          translateY: [0, -16, 0],
          duration,
          ease: 'inOutSine',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'pulse': {
        animInstance = animate(el, {
          scale: [1, 1.1, 1],
          duration,
          ease: 'inOutQuad',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'popIn': {
        el.style.opacity = '0'
        animInstance = animate(el, {
          scale: [0.2, 1.08, 1],
          opacity: [0, 1],
          duration,
          ease: 'outBack',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'zoomIn': {
        el.style.opacity = '0'
        animInstance = animate(el, {
          scale: [0.6, 1],
          opacity: [0, 1],
          duration,
          ease: 'outQuad',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'flip': {
        animInstance = animate(el, {
          rotateY: [-90, 0],
          opacity: [0.3, 1],
          duration,
          ease: 'outCubic',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'slideInLeft': {
        el.style.opacity = '0'
        animInstance = animate(el, {
          translateX: [-80, 0],
          opacity: [0, 1],
          duration,
          ease: 'outCubic',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'slideInRight': {
        el.style.opacity = '0'
        animInstance = animate(el, {
          translateX: [80, 0],
          opacity: [0, 1],
          duration,
          ease: 'outCubic',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'slideInTop': {
        el.style.opacity = '0'
        animInstance = animate(el, {
          translateY: [-60, 0],
          opacity: [0, 1],
          duration,
          ease: 'outCubic',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'slideInBottom': {
        el.style.opacity = '0'
        animInstance = animate(el, {
          translateY: [60, 0],
          opacity: [0, 1],
          duration,
          ease: 'outCubic',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'rotate': {
        animInstance = animate(el, {
          rotate: [0, 360],
          duration,
          ease: 'outCubic',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'glow': {
        const glowColor = (params?.color as string) || 'var(--color-seal, rgba(168, 67, 47, 0.6))'
        animInstance = animate(el, {
          boxShadow: [
            '0 0 0px transparent',
            `0 0 32px ${glowColor}`,
            '0 0 0px transparent',
          ],
          duration,
          ease: 'inOutQuad',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'countUp': {
        const rawTarget = params?.end !== undefined ? Number(params.end) : parseFloat(el.textContent || '0') || 100
        const startVal = params?.start !== undefined ? Number(params.start) : 0
        const suffix = typeof params?.suffix === 'string' ? params.suffix : ''
        const state = { val: startVal }

        animInstance = animate(state, {
          val: rawTarget,
          duration,
          ease: 'outExpo',
          onUpdate: () => {
            const formatted = Number.isInteger(rawTarget) ? Math.round(state.val) : state.val.toFixed(1)
            el.textContent = `${formatted}${suffix}`
          },
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'typewriter': {
        const targetText = (params?.text as string) || el.dataset.fullText || el.textContent || ''
        el.dataset.fullText = targetText
        el.textContent = ''
        const state = { charCount: 0 }

        animInstance = animate(state, {
          charCount: targetText.length,
          duration: Math.max(duration, targetText.length * 40),
          ease: 'linear',
          onUpdate: () => {
            const idx = Math.floor(state.charCount)
            el.textContent = targetText.slice(0, idx)
          },
        }) as unknown as AnimeAnimationInstance
        break
      }

      default: {
        // 未知动画名称回落到 popIn
        animInstance = animate(el, {
          scale: [0.95, 1],
          opacity: [0.5, 1],
          duration,
          ease: 'outQuad',
        }) as unknown as AnimeAnimationInstance
        break
      }
    }
  } catch (err) {
    console.warn('[anime] 动画启动失败，直接应用终态', err)
    applyFinalState()
    return createNoopTask()
  }

  const finishedPromise: Promise<void> = animInstance
    ? animInstance
        .then(() => {
          applyFinalState()
        })
        .then(() => {})
    : Promise.resolve()
        .then(applyFinalState)
        .then(() => {})

  return {
    pause: () => animInstance?.pause(),
    resume: () => animInstance?.resume(),
    abort: () => {
      animInstance?.cancel()
    },
    instantFinish: () => {
      if (animInstance) {
        animInstance.complete()
      }
      applyFinalState()
    },
    finished: finishedPromise,
  }
}

/**
 * 扫描当前画面中挂载了 data-anim 的所有组件，启动初始动画或持续循环动效
 * 返回一个 cleanup 清理函数，以便画面卸载或切帧时销毁所有持续动效
 */
export function mountComponentAnimations(rootEl: HTMLElement): () => void {
  if (typeof window === 'undefined' || !rootEl) return () => {}

  const runningAnimations: AnimeAnimationInstance[] = []
  const animElements = rootEl.querySelectorAll<HTMLElement>('[data-anim]')

  animElements.forEach((el) => {
    const animType = el.getAttribute('data-anim')
    if (!animType) return

    try {
      if (animType === 'float') {
        // 持续微浮动效
        const a = animate(el, {
          translateY: [0, -12, 0],
          duration: 2400,
          loop: true,
          ease: 'inOutSine',
        }) as unknown as AnimeAnimationInstance
        runningAnimations.push(a)
      } else if (animType === 'pulse') {
        // 持续温和呼吸动效
        const a = animate(el, {
          scale: [1, 1.04, 1],
          duration: 2000,
          loop: true,
          ease: 'inOutQuad',
        }) as unknown as AnimeAnimationInstance
        runningAnimations.push(a)
      } else if (animType === 'glow') {
        // 持续柔和光晕呼吸
        const a = animate(el, {
          boxShadow: [
            '0 0 10px rgba(168, 67, 47, 0.1)',
            '0 0 28px rgba(168, 67, 47, 0.4)',
            '0 0 10px rgba(168, 67, 47, 0.1)',
          ],
          duration: 2200,
          loop: true,
          ease: 'inOutQuad',
        }) as unknown as AnimeAnimationInstance
        runningAnimations.push(a)
      } else if (animType === 'countUp') {
        // 自动递增计数器
        const targetVal = parseFloat(el.getAttribute('data-target') || el.textContent || '100') || 100
        const suffix = el.getAttribute('data-suffix') || ''
        const state = { val: 0 }
        const a = animate(state, {
          val: targetVal,
          duration: 1200,
          ease: 'outExpo',
          onUpdate: () => {
            const formatted = Number.isInteger(targetVal) ? Math.round(state.val) : state.val.toFixed(1)
            el.textContent = `${formatted}${suffix}`
          },
        }) as unknown as AnimeAnimationInstance
        runningAnimations.push(a)
      } else {
        // 入场单次动画 (如 popIn, slideInLeft, bounce)
        const a = runAnimeAnimation(el, animType, 650)
        // 保持引用以便销毁
        runningAnimations.push({
          pause: a.pause,
          resume: a.resume,
          cancel: a.abort,
          complete: a.instantFinish,
          then: (cb) => a.finished.then(cb),
        })
      }
    } catch (e) {
      console.warn('[anime] 挂载组件动画异常', animType, e)
    }
  })

  // 返回卸载清理句柄
  return () => {
    runningAnimations.forEach((a) => {
      try {
        a.cancel()
      } catch {}
    })
    runningAnimations.length = 0
  }
}
