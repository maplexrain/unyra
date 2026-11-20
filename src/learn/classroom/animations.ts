/**
 * anime.js 课堂内置动画引擎 (animations.ts)
 * 29 种精雕教学动效，注重物理弹簧质感、光学景深、流光与清理隔离。
 */
import { animate } from 'animejs'
import type { RunningTask } from './types'
import { getClassroomAnimation, listClassroomAnimations } from './registry'

export type ClassroomAnimationName =
  | 'riseIn'
  | 'popIn'
  | 'zoomIn'
  | 'blurIn'
  | 'unfold'
  | 'stamp'
  | 'flip'
  | 'slideInLeft'
  | 'slideInRight'
  | 'slideInTop'
  | 'slideInBottom'
  | 'spotlight'
  | 'shimmer'
  | 'ripple'
  | 'glow'
  | 'pulse'
  | 'heartbeat'
  | 'float'
  | 'bounce'
  | 'swing'
  | 'wobble'
  | 'jello'
  | 'rubberBand'
  | 'shake'
  | 'flash'
  | 'tada'
  | 'rotate'
  | 'countUp'
  | 'typewriter'

interface AnimeAnimationInstance {
  pause: () => void
  resume: () => void
  cancel: () => void
  complete: () => void
  then: (onfulfilled?: (() => void) | null) => Promise<unknown>
}

function createNoopTask(): RunningTask {
  return {
    pause: () => {},
    resume: () => {},
    abort: () => {},
    instantFinish: () => {},
    finished: Promise.resolve(),
  }
}

function countDecimals(num: number): number {
  if (!Number.isFinite(num) || Number.isInteger(num)) return 0
  const s = String(num)
  const dot = s.indexOf('.')
  return dot >= 0 ? Math.min(4, s.length - dot - 1) : 0
}

function formatNumeric(val: number, decimals: number): string {
  return decimals > 0 ? val.toFixed(decimals) : String(Math.round(val))
}

/** 执行单次由 anime.js 驱动的内置动画 */
export function runAnimeAnimation(
  el: HTMLElement,
  name: string,
  customDuration?: number,
  params?: Record<string, unknown>,
): RunningTask {
  if (typeof window === 'undefined' || !el) {
    return createNoopTask()
  }

  // 播放前确保元素脱离隐藏态
  if (el.hasAttribute('data-hidden')) {
    el.removeAttribute('data-hidden')
    el.style.opacity = '1'
  }

  const def = getClassroomAnimation(name)
  const duration = Math.max(100, customDuration ?? def?.duration ?? 600)
  let animInstance: AnimeAnimationInstance | null = null
  const cleanups: Array<() => void> = []

  const runCleanups = () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop()
      try {
        fn?.()
      } catch {}
    }
  }

  // 终态回落保底逻辑
  const applyFinalState = () => {
    runCleanups()
    switch (name) {
      case 'riseIn':
      case 'popIn':
      case 'zoomIn':
      case 'slideInLeft':
      case 'slideInRight':
      case 'slideInTop':
      case 'slideInBottom':
      case 'blurIn':
      case 'unfold':
      case 'stamp':
        el.style.opacity = '1'
        el.style.filter = 'none'
        el.style.transform = el.dataset.baseTransform || ''
        break
      case 'flip':
        el.style.opacity = '1'
        el.style.transform = el.dataset.baseTransform || 'perspective(1200px) rotateY(0deg)'
        break
      case 'spotlight':
      case 'glow':
      case 'flash':
        el.style.opacity = '1'
        el.style.filter = 'none'
        el.style.boxShadow = ''
        el.style.transform = el.dataset.baseTransform || ''
        break
      case 'countUp': {
        const endVal =
          typeof params?.end === 'number'
            ? params.end
            : parseFloat((el.getAttribute('data-target') || el.textContent || '0').replace(/,/g, '')) || 0
        const prefix = typeof params?.prefix === 'string' ? params.prefix : el.getAttribute('data-prefix') || ''
        const suffix = typeof params?.suffix === 'string' ? params.suffix : el.getAttribute('data-suffix') || ''
        const dec = countDecimals(endVal)
        el.textContent = `${prefix}${formatNumeric(endVal, dec)}${suffix}`
        break
      }
      case 'typewriter': {
        const fullText = (params?.text as string) || el.dataset.fullText || el.textContent || ''
        el.classList.remove('fx-typing-caret')
        el.textContent = fullText
        break
      }
      default:
        el.style.transform = el.dataset.baseTransform || ''
        break
    }
  }

  try {
    switch (name) {
      case 'riseIn': {
        el.style.opacity = '0'
        animInstance = animate(el, {
          translateY: [32, 0],
          scale: [0.96, 1],
          opacity: [0, 1],
          duration,
          ease: 'outQuart',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'popIn': {
        el.style.opacity = '0'
        animInstance = animate(el, {
          scale: [0.88, 1.03, 1],
          translateY: [12, 0],
          opacity: [0, 1],
          duration,
          ease: 'outBack',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'zoomIn': {
        el.style.opacity = '0'
        animInstance = animate(el, {
          scale: [0.82, 1],
          opacity: [0, 1],
          duration,
          ease: 'outExpo',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'blurIn': {
        el.style.opacity = '0'
        animInstance = animate(el, {
          filter: ['blur(14px)', 'blur(0px)'],
          scale: [1.04, 1],
          opacity: [0, 1],
          duration,
          ease: 'outExpo',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'unfold': {
        const prevOrigin = el.style.transformOrigin
        el.style.transformOrigin = 'top center'
        el.style.opacity = '0'
        cleanups.push(() => {
          el.style.transformOrigin = prevOrigin
        })
        animInstance = animate(el, {
          scaleY: [0.8, 1],
          translateY: [-10, 0],
          opacity: [0, 1],
          duration,
          ease: 'outExpo',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'stamp': {
        el.style.opacity = '0'
        animInstance = animate(el, {
          scale: [1.38, 0.96, 1],
          rotate: [-3, 0.4, 0],
          opacity: [0, 1],
          duration,
          ease: 'outBack',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'flip': {
        el.style.opacity = '0'
        animInstance = animate(el, {
          perspective: 1200,
          rotateY: [-72, 4, 0],
          scale: [0.93, 1.01, 1],
          opacity: [0, 1],
          duration,
          ease: 'outExpo',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'slideInLeft': {
        el.style.opacity = '0'
        animInstance = animate(el, {
          translateX: [-64, 0],
          scale: [0.98, 1],
          opacity: [0, 1],
          duration,
          ease: 'outExpo',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'slideInRight': {
        el.style.opacity = '0'
        animInstance = animate(el, {
          translateX: [64, 0],
          scale: [0.98, 1],
          opacity: [0, 1],
          duration,
          ease: 'outExpo',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'slideInTop': {
        el.style.opacity = '0'
        animInstance = animate(el, {
          translateY: [-48, 0],
          scale: [0.98, 1],
          opacity: [0, 1],
          duration,
          ease: 'outExpo',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'slideInBottom': {
        el.style.opacity = '0'
        animInstance = animate(el, {
          translateY: [48, 0],
          scale: [0.98, 1],
          opacity: [0, 1],
          duration,
          ease: 'outExpo',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'spotlight': {
        const spotColor = (params?.color as string) || 'var(--fx-color, var(--color-seal, #a8432f))'
        animInstance = animate(el, {
          translateY: [0, -8, -4, 0],
          scale: [1, 1.022, 1.014, 1],
          boxShadow: [
            '0 0 0 0 transparent',
            `0 18px 42px -10px color-mix(in srgb, ${spotColor} 42%, transparent), 0 0 0 2px ${spotColor}`,
            '0 0 0 0 transparent',
          ],
          duration,
          ease: 'outQuart',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'shimmer': {
        el.classList.add('fx-shimmer-host')
        const sheen = document.createElement('span')
        sheen.className = 'fx-shimmer-sheen'
        sheen.setAttribute('aria-hidden', 'true')
        el.appendChild(sheen)
        cleanups.push(() => {
          sheen.remove()
          el.classList.remove('fx-shimmer-host')
        })
        animInstance = animate(sheen, {
          translateX: ['-140%', '240%'],
          opacity: [0, 0.9, 0.9, 0],
          duration,
          ease: 'inOutSine',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'ripple': {
        el.classList.add('fx-ripple-host')
        const ring = document.createElement('span')
        ring.className = 'fx-ripple-ring'
        ring.setAttribute('aria-hidden', 'true')
        if (typeof params?.color === 'string') {
          ring.style.borderColor = params.color
        }
        el.appendChild(ring)
        cleanups.push(() => {
          ring.remove()
          el.classList.remove('fx-ripple-host')
        })
        animInstance = animate(ring, {
          scale: [0.96, 1.12],
          opacity: [0.9, 0],
          duration,
          ease: 'outCubic',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'glow': {
        const glowColor = (params?.color as string) || 'var(--fx-color, var(--color-seal, #a8432f))'
        animInstance = animate(el, {
          boxShadow: [
            '0 0 0px transparent',
            `0 0 0 3px color-mix(in srgb, ${glowColor} 28%, transparent), 0 0 32px color-mix(in srgb, ${glowColor} 42%, transparent)`,
            '0 0 0px transparent',
          ],
          duration,
          ease: 'inOutQuad',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'pulse': {
        animInstance = animate(el, {
          scale: [1, 1.06, 1],
          duration,
          ease: 'inOutSine',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'heartbeat': {
        animInstance = animate(el, {
          scale: [1, 1.09, 1, 1.055, 1],
          duration,
          ease: 'inOutQuad',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'float': {
        animInstance = animate(el, {
          translateY: [0, -10, 0],
          duration,
          ease: 'inOutSine',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'bounce': {
        animInstance = animate(el, {
          translateY: [0, -24, 0, -10, 0, -3, 0],
          duration,
          ease: 'outQuad',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'swing': {
        const prevOrigin = el.style.transformOrigin
        el.style.transformOrigin = 'top center'
        cleanups.push(() => {
          el.style.transformOrigin = prevOrigin
        })
        animInstance = animate(el, {
          rotate: [0, 10, -7, 4, -2, 0],
          duration,
          ease: 'inOutSine',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'wobble': {
        animInstance = animate(el, {
          rotate: [0, -6, 5, -3, 2, 0],
          duration,
          ease: 'inOutSine',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'jello': {
        animInstance = animate(el, {
          skewX: [0, -8, 6, -3, 1.5, 0],
          skewY: [0, -4, 3, -1.5, 0.5, 0],
          duration,
          ease: 'outQuad',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'rubberBand': {
        animInstance = animate(el, {
          scaleX: [1, 1.14, 0.9, 1.06, 0.98, 1],
          scaleY: [1, 0.88, 1.1, 0.95, 1.02, 1],
          duration,
          ease: 'outQuad',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'shake': {
        animInstance = animate(el, {
          translateX: [0, -11, 11, -7, 7, -3, 3, 0],
          duration,
          ease: 'inOutQuad',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'flash': {
        animInstance = animate(el, {
          opacity: [1, 0.22, 1, 0.22, 1],
          duration,
          ease: 'inOutSine',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'tada': {
        animInstance = animate(el, {
          scale: [1, 0.94, 1.07, 1.07, 1.05, 1],
          rotate: [0, -3, 3, -2, 2, 0],
          duration,
          ease: 'inOutQuad',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'rotate': {
        animInstance = animate(el, {
          rotate: [0, 360],
          duration,
          ease: 'outExpo',
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'countUp': {
        const rawTarget =
          params?.end !== undefined
            ? Number(params.end)
            : parseFloat((el.getAttribute('data-target') || el.textContent || '0').replace(/,/g, '')) || 100
        const startVal = params?.start !== undefined ? Number(params.start) : 0
        const prefix = typeof params?.prefix === 'string' ? params.prefix : el.getAttribute('data-prefix') || ''
        const suffix = typeof params?.suffix === 'string' ? params.suffix : el.getAttribute('data-suffix') || ''
        const dec = countDecimals(rawTarget)
        const state = { val: startVal }

        animInstance = animate(state, {
          val: rawTarget,
          duration,
          ease: 'outExpo',
          onUpdate: () => {
            el.textContent = `${prefix}${formatNumeric(state.val, dec)}${suffix}`
          },
        }) as unknown as AnimeAnimationInstance
        break
      }

      case 'typewriter': {
        const targetText = (params?.text as string) || el.dataset.fullText || el.textContent || ''
        el.dataset.fullText = targetText
        el.textContent = ''
        el.classList.add('fx-typing-caret')
        cleanups.push(() => {
          el.classList.remove('fx-typing-caret')
        })
        const state = { charCount: 0 }

        animInstance = animate(state, {
          charCount: targetText.length,
          duration: Math.max(duration, targetText.length * 42),
          ease: 'linear',
          onUpdate: () => {
            const idx = Math.floor(state.charCount)
            el.textContent = targetText.slice(0, idx)
          },
        }) as unknown as AnimeAnimationInstance
        break
      }

      default: {
        const customDef = getClassroomAnimation(name)
        if (customDef) {
          const customDuration =
            typeof params?.duration === 'number'
              ? params.duration
              : customDef.duration || duration
          const customEase = (params?.ease as string) || customDef.easing || 'outQuad'
          const animOptions = (
            Array.isArray(customDef.keyframes)
              ? { keyframes: customDef.keyframes, duration: customDuration, ease: customEase }
              : { ...(customDef.keyframes || { opacity: [0, 1], scale: [0.95, 1] }), duration: customDuration, ease: customEase }
          ) as Parameters<typeof animate>[1]
          animInstance = animate(el, animOptions) as unknown as AnimeAnimationInstance
          break
        }
        // 未知动画名平滑回落
        animInstance = animate(el, {
          scale: [0.96, 1],
          opacity: [0.4, 1],
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
      runCleanups()
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
 * 扫描当前画面中挂载了 data-anim 的所有可见组件，启动初始动画或持续循环动效。
 * 带 data-hidden 的元素等待时间轴 action.verb 唤醒，不在这里提前揭晓。
 */
export function mountComponentAnimations(rootEl: HTMLElement): () => void {
  if (typeof window === 'undefined' || !rootEl) return () => {}

  const runningAnimations: AnimeAnimationInstance[] = []
  const animElements = rootEl.querySelectorAll<HTMLElement>('[data-anim]')

  animElements.forEach((el) => {
    if (el.hasAttribute('data-hidden')) return
    const animType = el.getAttribute('data-anim')
    if (!animType) return

    try {
      if (animType === 'float') {
        const a = animate(el, {
          translateY: [0, -10, 0],
          duration: 2800,
          loop: true,
          ease: 'inOutSine',
        }) as unknown as AnimeAnimationInstance
        runningAnimations.push(a)
      } else if (animType === 'pulse') {
        const a = animate(el, {
          scale: [1, 1.035, 1],
          duration: 2200,
          loop: true,
          ease: 'inOutSine',
        }) as unknown as AnimeAnimationInstance
        runningAnimations.push(a)
      } else if (animType === 'glow') {
        const a = animate(el, {
          boxShadow: [
            '0 0 8px color-mix(in srgb, var(--accent-primary, #a8432f) 12%, transparent)',
            '0 0 28px color-mix(in srgb, var(--accent-primary, #a8432f) 38%, transparent)',
            '0 0 8px color-mix(in srgb, var(--accent-primary, #a8432f) 12%, transparent)',
          ],
          duration: 2400,
          loop: true,
          ease: 'inOutQuad',
        }) as unknown as AnimeAnimationInstance
        runningAnimations.push(a)
      } else if (animType === 'countUp') {
        const rawStr = (el.getAttribute('data-target') || el.textContent || '0').replace(/,/g, '').trim()
        const targetVal = parseFloat(rawStr)
        if (!Number.isFinite(targetVal)) return
        const prefix = el.getAttribute('data-prefix') || ''
        const suffix = el.getAttribute('data-suffix') || ''
        const dec = countDecimals(targetVal)
        const state = { val: 0 }
        const a = animate(state, {
          val: targetVal,
          duration: 1100,
          ease: 'outExpo',
          onUpdate: () => {
            el.textContent = `${prefix}${formatNumeric(state.val, dec)}${suffix}`
          },
        }) as unknown as AnimeAnimationInstance
        runningAnimations.push(a)
      } else {
        const task = runAnimeAnimation(el, animType)
        runningAnimations.push({
          pause: task.pause,
          resume: task.resume,
          cancel: task.abort,
          complete: task.instantFinish,
          then: (cb) => task.finished.then(cb),
        })
      }
    } catch (e) {
      console.warn('[anime] 挂载组件动画异常', animType, e)
    }
  })

  return () => {
    runningAnimations.forEach((a) => {
      try {
        a.cancel()
      } catch {}
    })
    runningAnimations.length = 0
  }
}

/** 获取当前所有可用动效的动词清单（包含内置与外部注册） */
export function getAvailableAnimationVerbs(): string[] {
  return listClassroomAnimations().map((a) => a.verb)
}
