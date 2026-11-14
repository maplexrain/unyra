/**
 * 缩放 HUD 的显隐 hook（滚轮/按钮缩放时短暂显示百分比徽章）。
 * 从 PdfDocView 抽出（2026-11-14）：诊断层加入后主组件顶到文件体积红线。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const HUD_MS = 900

export function usePdfZoomHud(): { visible: boolean; trigger: () => void } {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<number | null>(null)

  const trigger = useCallback(() => {
    setVisible(true)
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
    }
    timerRef.current = window.setTimeout(() => {
      setVisible(false)
      timerRef.current = null
    }, HUD_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  return { visible, trigger }
}
