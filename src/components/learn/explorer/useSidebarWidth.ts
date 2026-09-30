/**
 * 这个文件负责：资源管理器那一栏的宽度——宽度 state、那条把手的拖动态（resizing）、
 * 写宽度用的 aside 引用，以及把手上的 onWidthDown / onWidthMove / onWidthUp。
 */
import { useRef, useState } from 'react'
import {
  EXPLORER_WIDTH_DEFAULT,
  clampExplorerWidth,
  getAppearance,
  setAppearance,
} from '../../../lib/appearance'

export function useSidebarWidth() {
  /**
   * 宽度（px）与那条把手。与右侧那一栏同一套做法：
   * **拖动期间只改 DOM**（直接写 aside 的 style.width），松手才写进设置——
   * 每一帧 setState 会把整棵学习区重渲染一遍，手感上就是拖不动。
   */
  const [width, setWidth] = useState(() => getAppearance().explorerWidth || EXPLORER_WIDTH_DEFAULT)
  const [resizing, setResizing] = useState(false)
  const asideRef = useRef<HTMLElement | null>(null)
  const widthDrag = useRef<{ startX: number; startWidth: number; moved: boolean } | null>(null)

  const onWidthDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    widthDrag.current = { startX: e.clientX, startWidth: width, moved: false }
    setResizing(true)
  }
  const onWidthMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = widthDrag.current
    if (!d) return
    const next = clampExplorerWidth(d.startWidth + (e.clientX - d.startX))
    if (!d.moved && Math.abs(e.clientX - d.startX) >= 2) d.moved = true
    if (asideRef.current) asideRef.current.style.width = next + 'px'
  }
  const onWidthUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = widthDrag.current
    if (!d) return
    widthDrag.current = null
    setResizing(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    // 没真挪动就别写设置（点一下也会走一遍按下 / 抬起）
    if (!d.moved) return
    const settled = clampExplorerWidth(d.startWidth + (e.clientX - d.startX))
    setWidth(settled)
    setAppearance({ ...getAppearance(), explorerWidth: settled })
  }

  return { width, resizing, asideRef, onWidthDown, onWidthMove, onWidthUp }
}
