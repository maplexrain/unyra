/**
 * useShotHistory.ts — 截图标注对象的编辑历史
 * 职责：持有画布上全部标注对象 objects 与当前选中对象 selectedObjectId，
 * 提供「撤销最后一笔」操作（Ctrl+Z / 工具条撤销按钮共用同一逻辑）。
 * 其余 setObjects / setSelectedObjectId 原样透传给交互层使用。
 */
import { useState } from 'react'
import type { AnnotationObject } from './types'

export interface ShotHistoryState {
  // 所有落在画布上的编辑均为独立对象
  objects: AnnotationObject[]
  setObjects: React.Dispatch<React.SetStateAction<AnnotationObject[]>>
  selectedObjectId: string | null
  setSelectedObjectId: React.Dispatch<React.SetStateAction<string | null>>
  /** 撤销最后一笔标注（原 Ctrl+Z / 工具条撤销按钮内的 slice 逻辑） */
  undo: () => void
}

export function useShotHistory(): ShotHistoryState {
  // 所有落在画布上的编辑均为独立对象
  const [objects, setObjects] = useState<AnnotationObject[]>([])
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)

  // 撤销最后一笔标注（原键盘 Ctrl+Z 与工具条撤销按钮的重复逻辑，原样收拢）
  const undo = () => {
    setObjects((prev) => prev.slice(0, -1))
    setSelectedObjectId(null)
  }

  return {
    objects,
    setObjects,
    selectedObjectId,
    setSelectedObjectId,
    undo,
  }
}
