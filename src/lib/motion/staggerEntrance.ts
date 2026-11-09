import { animate, stagger } from 'animejs'
import { EASE_NATURAL } from './springPresets'

export interface StaggerOptions {
  /** 相邻元素间隔延迟 (ms)，默认 35 */
  delayStep?: number
  /** 单个元素持续时长 (ms)，默认 280 */
  duration?: number
  /** 上浮位移距离 (px)，默认 8 */
  yOffset?: number
}

/**
 * 为容器内匹配的一组子元素播放错峰上浮进场动效（Stagger Entrance）。
 */
export function animateStagger(
  container: HTMLElement | null,
  selector: string,
  options: StaggerOptions = {},
): void {
  if (!container) return
  const elements = container.querySelectorAll<HTMLElement>(selector)
  if (!elements.length) return

  const delayStep = options.delayStep ?? 35
  const duration = options.duration ?? 280
  const y = options.yOffset ?? 8

  try {
    animate(Array.from(elements), {
      opacity: [0, 1],
      y: [y, 0],
      delay: stagger(delayStep),
      duration,
      ease: EASE_NATURAL,
    })
  } catch {
    // 降级兜底
  }
}
