/**
 * 纯净阅读模式（Zen Mode）状态管理。
 *
 * 原由 useSideColumns 托管，在移除双栏 SplitRow 后独立抽离，
 * 供 F11 / Esc / 悬浮工具栏及工作流提示栏协同使用。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { SIDE_ANIM_MS } from './constants'

export function useZenMode() {
  const [pure, setPureState] = useState(false)
  const [pureMoving, setPureMoving] = useState(false)
  const pureTimer = useRef<number | null>(null)

  const setPure = useCallback((on: boolean) => {
    setPureState((prev) => {
      if (prev === on) return prev
      setPureMoving(true)
      if (pureTimer.current !== null) window.clearTimeout(pureTimer.current)
      pureTimer.current = window.setTimeout(() => {
        pureTimer.current = null
        setPureMoving(false)
      }, SIDE_ANIM_MS)
      return on
    })
  }, [])

  const togglePure = useCallback(() => {
    setPureState((prev) => {
      const next = !prev
      setPureMoving(true)
      if (pureTimer.current !== null) window.clearTimeout(pureTimer.current)
      pureTimer.current = window.setTimeout(() => {
        pureTimer.current = null
        setPureMoving(false)
      }, SIDE_ANIM_MS)
      return next
    })
  }, [])

  useEffect(
    () => () => {
      if (pureTimer.current !== null) window.clearTimeout(pureTimer.current)
    },
    [],
  )

  return { pure, pureMoving, setPure, togglePure }
}
