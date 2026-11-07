/**
 * useShotSelection.ts — 截图选区与窗口自动吸附状态
 * 职责：持有当前选区、拉框 / 移动 / 缩放选区的交互状态、系统窗口矩形列表与
 * 悬停候选窗口（用于单击自动吸附窗口）。纯状态层，不含鼠标事件处理。
 */
import { useEffect, useRef, useState } from 'react'
import type { Rect } from './types'
import { native } from '../../../lib/native'

export interface ShotSelectionState {
  // 选区与窗口自动吸附
  selection: Rect | null
  setSelection: React.Dispatch<React.SetStateAction<Rect | null>>
  isSelecting: boolean
  setIsSelecting: React.Dispatch<React.SetStateAction<boolean>>
  isSelectingRef: React.RefObject<boolean>
  dragStart: { x: number; y: number } | null
  setDragStart: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>
  systemRects: Rect[]
  hoveredWindowRect: Rect | null
  setHoveredWindowRect: React.Dispatch<React.SetStateAction<Rect | null>>
  selectionResizeHandle: string | null
  setSelectionResizeHandle: React.Dispatch<React.SetStateAction<string | null>>
  isMovingSelection: boolean
  setIsMovingSelection: React.Dispatch<React.SetStateAction<boolean>>
  selectionMoveStart: { x: number; y: number; orig: Rect } | null
  setSelectionMoveStart: React.Dispatch<React.SetStateAction<{ x: number; y: number; orig: Rect } | null>>
}

export function useShotSelection(): ShotSelectionState {
  // 选区与窗口自动吸附
  const [selection, setSelection] = useState<Rect | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const isSelectingRef = useRef(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [systemRects, setSystemRects] = useState<Rect[]>([])
  const [hoveredWindowRect, setHoveredWindowRect] = useState<Rect | null>(null)
  const hoveredWindowRectRef = useRef<Rect | null>(null)
  hoveredWindowRectRef.current = hoveredWindowRect
  const [selectionResizeHandle, setSelectionResizeHandle] = useState<string | null>(null)
  const [isMovingSelection, setIsMovingSelection] = useState(false)
  const [selectionMoveStart, setSelectionMoveStart] = useState<{ x: number; y: number; orig: Rect } | null>(null)

  // 获取系统已存在窗口与工作区边界，用于自动窗口捕捉
  useEffect(() => {
    const fetchRects = async () => {
      try {
        const bridge = native()
        if (bridge.tools?.getScreenshotSystemRects) {
          const rects = await bridge.tools.getScreenshotSystemRects()
          if (rects && rects.length > 0) {
            setSystemRects(rects)
          }
        }
      } catch {}
    }
    void fetchRects()
  }, [])

  return {
    selection,
    setSelection,
    isSelecting,
    setIsSelecting,
    isSelectingRef,
    dragStart,
    setDragStart,
    systemRects,
    hoveredWindowRect,
    setHoveredWindowRect,
    selectionResizeHandle,
    setSelectionResizeHandle,
    isMovingSelection,
    setIsMovingSelection,
    selectionMoveStart,
    setSelectionMoveStart,
  }
}
