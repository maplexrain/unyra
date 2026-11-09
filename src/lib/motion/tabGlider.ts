import { useEffect, useRef } from 'react'
import { animate } from 'animejs'
import { EASE_NATURAL } from './springPresets'

export interface TabGliderOptions {
  /** 激活状态元素的选择器，如 `[data-active="true"]` 或 `.is-active` */
  activeSelector?: string
  /** 动画时长 (ms)，默认 240 */
  duration?: number
  /** 自定义缓动/弹簧 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ease?: any
}

/**
 * 磁吸滑动页签指示器 Hook（Tab Glider）。
 * 跟踪容器内当前激活的页签位置与宽度，驱动底衬胶囊或下划线流畅滑入。
 */
export function useTabGlider(
  containerRef: React.RefObject<HTMLElement | null>,
  activeKey: string | number | null | undefined,
  options: TabGliderOptions = {},
) {
  const gliderRef = useRef<HTMLDivElement | null>(null)
  const isInitialRef = useRef(true)

  useEffect(() => {
    const container = containerRef.current
    const glider = gliderRef.current
    if (!container || !glider) return

    // 寻找当前激活的页签项
    const selector = options.activeSelector ?? '[data-active="true"]'
    const activeEl = container.querySelector<HTMLElement>(selector)

    if (!activeEl) {
      glider.style.opacity = '0'
      return
    }

    const activeRect = activeEl.getBoundingClientRect()

    // 相对容器内部滚动的真实偏移
    const left = activeEl.offsetLeft
    const top = activeEl.offsetTop
    const width = activeRect.width
    const height = activeRect.height

    if (width === 0 || height === 0) return

    if (isInitialRef.current) {
      isInitialRef.current = false
      glider.style.transform = `translate3d(${left}px, ${top}px, 0)`
      glider.style.width = `${width}px`
      glider.style.height = `${height}px`
      glider.style.opacity = '1'
      return
    }

    glider.style.opacity = '1'

    animate(glider, {
      x: left,
      y: top,
      width,
      height,
      duration: options.duration ?? 240,
      ease: options.ease ?? EASE_NATURAL,
    })
  }, [activeKey, containerRef, options.activeSelector, options.duration, options.ease])

  return gliderRef
}
