import { animate } from 'animejs'
import { EASE_NATURAL } from './springPresets'

export interface InkRippleOptions {
  /** 涟漪颜色，默认使用印章朱红（含透明度）或文字淡色 */
  color?: string
  /** 扩散时长 (ms)，默认 350ms */
  duration?: number
  /** 最大尺寸限制，默认根据元素对角线动态计算 */
  maxRadius?: number
}

/**
 * 触发一次墨韵微水波微交互（Ink Ripple）。
 * 在可点击元素（如复制按钮、操作图标、主按钮）上点击时，自指针点击原点荡开一层温润淡雅的涟漪。
 */
export function spawnInkRipple(e: React.MouseEvent<HTMLElement> | MouseEvent, options: InkRippleOptions = {}): void {
  const target = (e.currentTarget || e.target) as HTMLElement | null
  if (!target) return

  // 确保父容器具备相对定位与溢出裁切
  const rect = target.getBoundingClientRect()
  if (!rect.width || !rect.height) return

  const originalPosition = target.style.position || (typeof window !== 'undefined' ? window.getComputedStyle(target).position : '')
  if (originalPosition === 'static' || !originalPosition) {
    target.style.position = 'relative'
  }
  target.style.overflow = 'hidden'

  const x = e.clientX - rect.left
  const y = e.clientY - rect.top

  // 计算覆盖整个矩形所需的最大半径
  const dX = Math.max(x, rect.width - x)
  const dY = Math.max(y, rect.height - y)
  const radius = options.maxRadius ?? Math.sqrt(dX * dX + dY * dY) * 1.8

  const ripple = document.createElement('span')
  ripple.className = 'moji-ink-ripple pointer-events-none rounded-full'
  ripple.style.position = 'absolute'
  ripple.style.left = `${x}px`
  ripple.style.top = `${y}px`
  ripple.style.width = '0px'
  ripple.style.height = '0px'
  ripple.style.transform = 'translate(-50%, -50%)'
  ripple.style.backgroundColor = options.color ?? 'currentColor'
  ripple.style.opacity = '0.2'
  ripple.style.zIndex = '1'

  target.appendChild(ripple)

  const duration = options.duration ?? 380

  try {
    animate(ripple, {
      width: [0, radius * 2],
      height: [0, radius * 2],
      opacity: [0.22, 0],
      duration,
      ease: EASE_NATURAL,
      onComplete: () => {
        ripple.remove()
      },
    })
  } catch {
    // 降级兜底
    ripple.remove()
  }
}
