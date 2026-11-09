import { animate } from 'animejs'
import { EASE_BOUNCY, EASE_NATURAL, EASE_SPIN } from './springPresets'

/**
 * 触发图标顺时针优雅 360° 惯性自旋动画（适用于刷新、重置、重新回答按钮）。
 */
export function spinIcon(el: Element | null, duration = 520): void {
  if (!el) return
  try {
    animate(el, {
      rotate: ['0deg', '360deg'],
      duration,
      ease: EASE_SPIN,
    })
  } catch {
    // 降级兜底
  }
}

/**
 * 触发元素微缩放回弹微交互（适用于复制成功、打卡勾选、徽章点亮）。
 */
export function popScale(el: Element | null, duration = 320): void {
  if (!el) return
  try {
    animate(el, {
      scale: [1, 1.22, 0.95, 1],
      duration,
      ease: EASE_BOUNCY,
    })
  } catch {
    // 降级兜底
  }
}

/**
 * 触发元素细微物理顿挫抖动（适用于表单校验失败、禁止操作、按键敲空）。
 */
export function shakeSubtle(el: Element | null, duration = 300): void {
  if (!el) return
  try {
    animate(el, {
      x: [0, -5, 4, -3, 2, 0],
      duration,
      ease: EASE_NATURAL,
    })
  } catch {
    // 降级兜底
  }
}

/**
 * 触发声音波纹光晕扩散（适用于麦克风拾音、Agent 聆听）。
 */
export function pulseAura(el: Element | null, level = 0.5): void {
  if (!el) return
  const scaleTarget = 1 + Math.min(0.6, level * 1.5)
  try {
    animate(el, {
      scale: [1, scaleTarget, 1],
      opacity: [0.8, 0.2, 0.8],
      duration: 350,
      ease: EASE_NATURAL,
    })
  } catch {
    // 降级兜底
  }
}
