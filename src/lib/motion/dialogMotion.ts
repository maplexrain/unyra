import { useEffect, useRef } from 'react'
import { animate } from 'animejs'
import { EASE_NATURAL, EASE_EXIT } from './springPresets'

export interface DialogMotionOptions {
  /** 进场持续毫秒，默认 260 */
  enterDuration?: number
  /** 退场持续毫秒，默认 150 */
  exitDuration?: number
  /** 初始 y 轴位移 (px)，默认 14 */
  yOffset?: number
  /** 初始缩放比例，默认 0.96 */
  initialScale?: number
}

/**
 * 驱动弹窗卡片进退场的弹簧动效。
 * 进场：丝滑上浮 + 微放大 + 渐入；
 * 退场：微下沉 + 缩小 + 快速淡出。
 */
export function useDialogMotion<T extends HTMLElement = HTMLDivElement>(
  closing: boolean,
  options: DialogMotionOptions = {},
) {
  const cardRef = useRef<T | null>(null)
  const isFirstRender = useRef(true)

  useEffect(() => {
    const el = cardRef.current
    if (!el) return

    const y = options.yOffset ?? 14
    const scale = options.initialScale ?? 0.96

    if (isFirstRender.current) {
      isFirstRender.current = false
      animate(el, {
        opacity: [0, 1],
        scale: [scale, 1],
        y: [y, 0],
        duration: options.enterDuration ?? 260,
        ease: EASE_NATURAL,
      })
      return
    }

    if (closing) {
      animate(el, {
        opacity: [1, 0],
        scale: [1, scale * 1.02],
        y: [0, y * 0.6],
        duration: options.exitDuration ?? 150,
        ease: EASE_EXIT,
      })
    }
  }, [closing, options.enterDuration, options.exitDuration, options.initialScale, options.yOffset])

  return cardRef
}
