/**
 * useShotCanvas.ts — 截图画布交互机制（选区 / 标注对象 / 文字编辑 / 快捷键 / 光标）
 * 职责：处理画布上的鼠标交互（拉框选区、选区移动缩放、标注对象绘制拖拽缩放、
 * 文字编辑）、键盘快捷键、动态光标与右键退出。状态依赖经单一 deps 对象注入。
 */
import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { detectWindowUnderCursor } from './windowDetector'
import type { AnnotationObject, Rect, TextObject, ToolType } from './types'
import { computeCursor, getHitSelectionHandle, hitTestObject } from './shotGeometry'
import type { ShotObjectDragStart } from './shotGeometry'
import type { ShotHistoryState } from './useShotHistory'
import type { ShotSelectionState } from './useShotSelection'
import type { ShotLoupeState } from './useShotLoupe'

// 正在编辑文字或箭头的尾部文本（原 useState 内联类型）
export interface ShotEditingTarget {
  id: string
  type: 'text' | 'arrowTail'
  x: number
  y: number
  text: string
}

/** 确认动作签名（与 useShotExport 的 handleConfirm 一致） */
export type ShotConfirmFn = (targetRect?: Rect | null | ReactMouseEvent) => Promise<void> | void

export interface ShotCanvasDeps {
  /** 选区与窗口自动吸附状态（useShotSelection） */
  sel: ShotSelectionState
  /** 标注对象编辑历史（useShotHistory） */
  history: ShotHistoryState
  /** 取色放大镜状态（useShotLoupe） */
  loupe: ShotLoupeState
  /** 离屏原图画布：窗口吸附检测的像素来源（useShotAssets） */
  offscreenCanvasRef: React.RefObject<HTMLCanvasElement | null>
  onClose: () => void
  /** 确定（复制到剪贴板）动作，由 useShotExport 提供；键盘 Enter 经挂点晚绑定调用 */
  onConfirm: ShotConfirmFn
}

export function useShotCanvas(deps: ShotCanvasDeps) {
  const { sel, history, loupe, offscreenCanvasRef, onClose, onConfirm } = deps
  const {
    selection, setSelection, isSelecting, setIsSelecting, isSelectingRef, dragStart, setDragStart,
    systemRects, hoveredWindowRect, setHoveredWindowRect, selectionResizeHandle, setSelectionResizeHandle,
    isMovingSelection, setIsMovingSelection, selectionMoveStart, setSelectionMoveStart,
  } = sel
  const { objects, setObjects, selectedObjectId, setSelectedObjectId } = history
  const { setMousePos, updateLoupe, copyCurrentColor, cycleColorMode } = loupe

  // 工具条与标注对象系统
  const [tool, setTool] = useState<ToolType>('none')
  const [activeColor, setActiveColor] = useState<string>('#ef4444')
  const [strokeWidth, setStrokeWidth] = useState<number>(3)

  const [draftObject, setDraftObject] = useState<AnnotationObject | null>(null)

  // 正在编辑文字或箭头的尾部文本
  const [editingTarget, setEditingTarget] = useState<ShotEditingTarget | null>(null)

  // 对象拖动/改变大小交互
  const [isDraggingObject, setIsDraggingObject] = useState(false)
  const [objectDragStart, setObjectDragStart] = useState<ShotObjectDragStart | null>(null)

  // 动态计算的当前光标样式
  const [currentCursor, setCurrentCursor] = useState<string>('crosshair')
  const textInputRef = useRef<HTMLInputElement>(null)

  // 晚绑定挂点：确定动作（键盘 Enter 触发时取最新实现，与原闭包行为一致）
  const onConfirmRef = useRef(deps.onConfirm)
  onConfirmRef.current = onConfirm

  // 当调出文字输入框时，自动聚焦并选中文字
  useEffect(() => {
    if (editingTarget) {
      requestAnimationFrame(() => {
        textInputRef.current?.focus()
        textInputRef.current?.select()
      })
    }
  }, [editingTarget])

  // 键盘快捷键监听（方向键微调光标、Shift 换格式、Ctrl+C 复制颜色、Delete 删除对象、Ctrl+Z 撤销、Esc 退出）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingTarget) {
        if (e.key === 'Escape') setEditingTarget(null)
        return
      }

      // 方向键 1 像素精确微调光标与选区位置
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        setMousePos((prev) => {
          let nx = prev.x < 0 ? window.innerWidth / 2 : prev.x
          let ny = prev.y < 0 ? window.innerHeight / 2 : prev.y
          if (e.key === 'ArrowUp') ny = Math.max(0, ny - step)
          if (e.key === 'ArrowDown') ny = Math.min(window.innerHeight - 1, ny + step)
          if (e.key === 'ArrowLeft') nx = Math.max(0, nx - step)
          if (e.key === 'ArrowRight') nx = Math.min(window.innerWidth - 1, nx + step)
          updateLoupe(nx, ny)
          return { x: nx, y: ny }
        })
        return
      }

      if (e.key === 'Shift') {
        e.preventDefault()
        cycleColorMode()
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        copyCurrentColor()
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedObjectId) {
          e.preventDefault()
          setObjects((prev) => prev.filter((o) => o.id !== selectedObjectId))
          setSelectedObjectId(null)
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        setObjects((prev) => prev.slice(0, -1))
        setSelectedObjectId(null)
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        if (selection) {
          setSelection(null)
          setObjects([])
          setTool('none')
          setSelectedObjectId(null)
          return
        }
        onClose()
        return
      }

      if (e.key === 'Enter' && selection) {
        e.preventDefault()
        void onConfirmRef.current()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // deps：setMousePos / setObjects / setSelectedObjectId / setSelection 均为稳定的 setState 函数，列入仅为满足 exhaustive-deps（行为不变）
  }, [editingTarget, selectedObjectId, selection, setMousePos, setObjects, setSelectedObjectId, setSelection, copyCurrentColor, cycleColorMode, onClose, updateLoupe])

  // 鼠标移动
  const handleMouseMove = (e: React.MouseEvent) => {
    const clientX = e.clientX
    const clientY = e.clientY
    setMousePos({ x: clientX, y: clientY })
    updateLoupe(clientX, clientY)

    // 实时计算当前光标样式（明确提醒用户操作意图：拖拽、拉伸手柄、改文字）
    const cursor = computeCursor({
      clientX,
      clientY,
      isSelecting: isSelectingRef.current,
      isMovingSelection,
      selectionResizeHandle,
      isDraggingObject,
      objectDragStart,
      selection,
      tool,
      objects,
      selectedObjectId,
      hoveredWindowRect,
    })
    setCurrentCursor(cursor)

    // 1. 正在自由拖拽拉框中 (高优先级：连续帧刷新选区尺寸)
    if (isSelectingRef.current && dragStart) {
      const x = Math.min(dragStart.x, clientX)
      const y = Math.min(dragStart.y, clientY)
      const width = Math.abs(clientX - dragStart.x)
      const height = Math.abs(clientY - dragStart.y)
      setSelection({ x, y, width, height })
      return
    }

    // 2. 检查按下后拖动是否超过 4px 阈值，进入拉选框状态
    if (dragStart && !selectionResizeHandle && !isMovingSelection && !isDraggingObject && !draftObject && tool === 'none') {
      const dist = Math.hypot(clientX - dragStart.x, clientY - dragStart.y)
      if (dist >= 4) {
        isSelectingRef.current = true
        setIsSelecting(true)
        setHoveredWindowRect(null)
        const x = Math.min(dragStart.x, clientX)
        const y = Math.min(dragStart.y, clientY)
        const width = Math.abs(clientX - dragStart.x)
        const height = Math.abs(clientY - dragStart.y)
        setSelection({ x, y, width, height })
        return
      }
    }

    // 3. 未确立选区且未按住光标：实时根据当前光标位置精准吸附最优候选窗口
    if (!selection && !dragStart) {
      const detected = detectWindowUnderCursor(
        clientX,
        clientY,
        offscreenCanvasRef.current,
        systemRects,
        window.innerWidth,
        window.innerHeight,
      )
      setHoveredWindowRect(detected)
      return
    }

    // 4. 正在微调选区边框手柄中
    if (selectionResizeHandle && selection && dragStart) {
      const dx = clientX - dragStart.x
      const dy = clientY - dragStart.y
      const s = { ...selection }
      if (selectionResizeHandle.includes('w')) { s.x += dx; s.width -= dx }
      if (selectionResizeHandle.includes('e')) { s.width += dx }
      if (selectionResizeHandle.includes('n')) { s.y += dy; s.height -= dy }
      if (selectionResizeHandle.includes('s')) { s.height += dy }
      if (s.width > 10 && s.height > 10) {
        setSelection(s)
        setDragStart({ x: clientX, y: clientY })
      }
      return
    }

    // 5. 正在整体移动选区中
    if (isMovingSelection && selectionMoveStart) {
      const dx = clientX - selectionMoveStart.x
      const dy = clientY - selectionMoveStart.y
      const nextX = Math.max(0, Math.min(window.innerWidth - selectionMoveStart.orig.width, selectionMoveStart.orig.x + dx))
      const nextY = Math.max(0, Math.min(window.innerHeight - selectionMoveStart.orig.height, selectionMoveStart.orig.y + dy))
      setSelection({ ...selectionMoveStart.orig, x: nextX, y: nextY })
      return
    }

    // 6. 正在拖动/缩放已有对象中
    if (isDraggingObject && objectDragStart) {
      const dx = clientX - objectDragStart.x
      const dy = clientY - objectDragStart.y
      const orig = objectDragStart.origObj

      setObjects((prev) =>
        prev.map((item) => {
          if (item.id !== orig.id) return item
          if (
            (item.type === 'rect' || item.type === 'circle' || item.type === 'mosaic') &&
            (orig.type === 'rect' || orig.type === 'circle' || orig.type === 'mosaic')
          ) {
            const h = objectDragStart.handle
            if (!h) {
              return { ...item, x: orig.x + dx, y: orig.y + dy }
            }
            const s = { ...item }
            if (h.includes('w')) { s.x = orig.x + dx; s.width = orig.width - dx }
            if (h.includes('e')) { s.width = orig.width + dx }
            if (h.includes('n')) { s.y = orig.y + dy; s.height = orig.height - dy }
            if (h.includes('s')) { s.height = orig.height + dy }
            return s
          }
          if (item.type === 'arrow' && orig.type === 'arrow') {
            if (objectDragStart.handle === 'p1') {
              return { ...item, x1: orig.x1 + dx, y1: orig.y1 + dy }
            }
            if (objectDragStart.handle === 'p2') {
              return { ...item, x2: orig.x2 + dx, y2: orig.y2 + dy }
            }
            return {
              ...item,
              x1: orig.x1 + dx,
              y1: orig.y1 + dy,
              x2: orig.x2 + dx,
              y2: orig.y2 + dy,
            }
          }
          if (item.type === 'text' && orig.type === 'text') {
            if (objectDragStart.handle === 'se') {
              const delta = (dx + dy) / 2
              const newFontSize = Math.round(Math.max(12, Math.min(80, orig.fontSize + delta * 0.4)))
              return { ...item, fontSize: newFontSize }
            }
            return { ...item, x: orig.x + dx, y: orig.y + dy }
          }
          return item
        }),
      )
      return
    }

    // 7. 正在绘制新标注草稿中
    if (tool !== 'none' && draftObject && selection) {
      const cx = Math.max(selection.x, Math.min(selection.x + selection.width, clientX))
      const cy = Math.max(selection.y, Math.min(selection.y + selection.height, clientY))

      if (draftObject.type === 'rect' || draftObject.type === 'circle' || draftObject.type === 'mosaic') {
        const x = Math.min(draftObject.x, cx)
        const y = Math.min(draftObject.y, cy)
        const width = Math.abs(cx - draftObject.x)
        const height = Math.abs(cy - draftObject.y)
        setDraftObject({ ...draftObject, x, y, width, height })
      } else if (draftObject.type === 'arrow') {
        setDraftObject({ ...draftObject, x2: cx, y2: cy })
      }
    }
  }

  // 鼠标按下
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const clientX = e.clientX
    const clientY = e.clientY

    if ((e.target as HTMLElement).closest('.screenshot-toolbar') || (e.target as HTMLElement).closest('.text-editor-box')) {
      return
    }

    // 正在编辑文字时点击外部：先提交当前文字，避免误触发重新框选或新建
    if (editingTarget) {
      handleCommitEditing()
      return
    }

    // 1. 如果已有选区，优先检查是否点中已存在的标注对象进行交互
    if (selection) {
      const hit = hitTestObject(objects, selectedObjectId, clientX, clientY)
      if (hit) {
        setSelectedObjectId(hit.obj.id)
        if (hit.handle === 'tailText' && hit.obj.type === 'arrow') {
          // 双击或点击箭头尾部文本编辑
          setEditingTarget({
            id: hit.obj.id,
            type: 'arrowTail',
            x: hit.obj.x1,
            y: hit.obj.y1,
            text: hit.obj.text || '',
          })
          return
        }
        if (tool === 'text' && hit.obj.type === 'text') {
          // 当前处于文字工具模式时点击已有文字：进入编辑改文字
          setEditingTarget({
            id: hit.obj.id,
            type: 'text',
            x: hit.obj.x,
            y: hit.obj.y,
            text: hit.obj.text,
          })
          return
        }
        // 允许直接拖拽对象（包括文字对象）或缩放其手柄（拉尺寸）
        setIsDraggingObject(true)
        setObjectDragStart({
          x: clientX,
          y: clientY,
          handle: hit.handle === 'textBody' ? undefined : hit.handle,
          origObj: { ...hit.obj },
        })
        return
      }

      // 2. 检查是否点中了选区手柄
      const selHandle = getHitSelectionHandle(clientX, clientY, selection)
      if (selHandle) {
        setSelectionResizeHandle(selHandle)
        setDragStart({ x: clientX, y: clientY })
        return
      }

      // 3. 在选区内根据当前工具创建新对象
      const inside =
        clientX >= selection.x &&
        clientX <= selection.x + selection.width &&
        clientY >= selection.y &&
        clientY <= selection.y + selection.height

      if (inside) {
        const id = `obj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

        if (tool === 'text') {
          setEditingTarget({ id, type: 'text', x: clientX, y: clientY, text: '' })
          return
        }
        if (tool === 'rect') {
          setDraftObject({
            id,
            type: 'rect',
            x: clientX,
            y: clientY,
            width: 0,
            height: 0,
            color: activeColor,
            strokeWidth,
          })
          return
        }
        if (tool === 'circle') {
          setDraftObject({
            id,
            type: 'circle',
            x: clientX,
            y: clientY,
            width: 0,
            height: 0,
            color: activeColor,
            strokeWidth,
          })
          return
        }
        if (tool === 'arrow') {
          setDraftObject({
            id,
            type: 'arrow',
            x1: clientX,
            y1: clientY,
            x2: clientX,
            y2: clientY,
            color: activeColor,
            strokeWidth,
          })
          return
        }
        if (tool === 'mosaic') {
          setDraftObject({
            id,
            type: 'mosaic',
            x: clientX,
            y: clientY,
            width: 0,
            height: 0,
            blockSize: 10,
          })
          return
        }

        // 无绘制工具时，选区内拖拽触发整体位移
        if (tool === 'none') {
          setSelectedObjectId(null)
          setIsMovingSelection(true)
          setSelectionMoveStart({ x: clientX, y: clientY, orig: selection })
          return
        }
      }
    }

    // 4. 点击选区外，进入准备框选/窗口选取状态
    setSelectedObjectId(null)
    setDragStart({ x: clientX, y: clientY })
    isSelectingRef.current = false
    setIsSelecting(false)
    setObjects([])
    setTool('none')
    setEditingTarget(null)
    if (selection) {
      setSelection(null)
    }
  }

  // 鼠标松开
  const handleMouseUp = (e: React.MouseEvent) => {
    const clientX = e.clientX
    const clientY = e.clientY

    // 1. 处于自由拉选框状态中：松开鼠标确立选区
    if (isSelectingRef.current || isSelecting) {
      isSelectingRef.current = false
      setIsSelecting(false)
      setDragStart(null)
      if (selection && (selection.width < 10 || selection.height < 10)) {
        setSelection(null)
      }
      return
    }

    // 2. 单击自动吸附选定窗口：未拖动（位移 < 4px）且命中候选窗口
    if (!selection && dragStart) {
      const dist = Math.hypot(clientX - dragStart.x, clientY - dragStart.y)
      if (dist < 4 && hoveredWindowRect) {
        setSelection(hoveredWindowRect)
        setHoveredWindowRect(null)
        setDragStart(null)
        isSelectingRef.current = false
        setIsSelecting(false)
        return
      }
    }

    setDragStart(null)

    if (selectionResizeHandle) {
      setSelectionResizeHandle(null)
    }

    if (isMovingSelection) {
      setIsMovingSelection(false)
      setSelectionMoveStart(null)
    }

    if (isDraggingObject) {
      setIsDraggingObject(false)
      setObjectDragStart(null)
    }

    // 确认新绘制的草稿对象
    if (draftObject) {
      if (draftObject.type === 'arrow') {
        const len = Math.hypot(draftObject.x2 - draftObject.x1, draftObject.y2 - draftObject.y1)
        if (len > 12) {
          setObjects((prev) => [...prev, draftObject])
          setSelectedObjectId(draftObject.id)
          // 重点满足：箭头创建后在非箭头一端（起点 x1, y1）自动弹出连接的文本框并自动聚焦
          setEditingTarget({
            id: draftObject.id,
            type: 'arrowTail',
            x: draftObject.x1,
            y: draftObject.y1,
            text: '',
          })
        }
      } else if (
        (draftObject.type === 'rect' || draftObject.type === 'circle' || draftObject.type === 'mosaic') &&
        draftObject.width > 8 &&
        draftObject.height > 8
      ) {
        setObjects((prev) => [...prev, draftObject])
        setSelectedObjectId(draftObject.id)
      }
      setDraftObject(null)
    }
  }

  // 双击事件：快速复制截图到粘贴板并退出（未选取时复制窗口/全屏，已选取时复制选区）
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (editingTarget) return

    const clientX = e.clientX
    const clientY = e.clientY

    // 1. 截图选取后：在选区内部双击快速复制截图到粘贴板并退出
    if (selection) {
      const inside =
        clientX >= selection.x &&
        clientX <= selection.x + selection.width &&
        clientY >= selection.y &&
        clientY <= selection.y + selection.height
      if (inside) {
        void onConfirm(selection)
        return
      }
      return
    }

    // 2. 截图后未选取：双击快速复制截图（光标悬停候选窗口或全屏画面）到粘贴板并退出
    const target = hoveredWindowRect || {
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    }
    void onConfirm(target)
  }

  // 提交文字编辑
  const handleCommitEditing = () => {
    if (!editingTarget) return
    const text = editingTarget.text.trim()

    if (editingTarget.type === 'arrowTail') {
      setObjects((prev) =>
        prev.map((item) => (item.id === editingTarget.id && item.type === 'arrow' ? { ...item, text } : item)),
      )
      setSelectedObjectId(editingTarget.id)
    } else if (editingTarget.type === 'text') {
      if (text) {
        setObjects((prev) => {
          const exists = prev.some((o) => o.id === editingTarget.id)
          if (exists) {
            return prev.map((o) => (o.id === editingTarget.id && o.type === 'text' ? { ...o, text } : o))
          }
          const newTextObj: TextObject = {
            id: editingTarget.id,
            type: 'text',
            x: editingTarget.x,
            y: editingTarget.y,
            text,
            color: activeColor,
            fontSize: 16,
          }
          return [...prev, newTextObj]
        })
        setSelectedObjectId(editingTarget.id)
      } else {
        setObjects((prev) => prev.filter((o) => o.id !== editingTarget.id))
        setSelectedObjectId(null)
      }
    }
    setEditingTarget(null)
    setTool('none') // 提交后自动切回常规选择模式，便于后续移动、改尺寸或切换颜色
  }

  // 当选择调色板颜色或粗细时，联动应用给当前选中的对象
  const handleColorChange = (c: string) => {
    setActiveColor(c)
    if (selectedObjectId) {
      setObjects((prev) =>
        prev.map((o) => (o.id === selectedObjectId && 'color' in o ? { ...o, color: c } : o)),
      )
    }
  }

  const handleStrokeWidthChange = (sw: number) => {
    setStrokeWidth(sw)
    if (selectedObjectId) {
      setObjects((prev) =>
        prev.map((o) => (o.id === selectedObjectId && 'strokeWidth' in o ? { ...o, strokeWidth: sw } : o)),
      )
    }
  }

  // 右键快捷退出或取消选区
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // 1. 若当前正在编辑文字，右键取消本次文字编辑
    if (editingTarget) {
      setEditingTarget(null)
      return
    }

    // 2. 若选中了对象，右键取消选中
    if (selectedObjectId) {
      setSelectedObjectId(null)
      return
    }

    // 3. 若当前已确立选区：如果在选区外部右键，直接秒关退出截图；如果在选区内部，取消选区
    if (selection) {
      const inside =
        e.clientX >= selection.x &&
        e.clientX <= selection.x + selection.width &&
        e.clientY >= selection.y &&
        e.clientY <= selection.y + selection.height
      if (!inside) {
        onClose()
        return
      }
      setSelection(null)
      setObjects([])
      setTool('none')
      return
    }

    // 4. 无选区状态下，右键直接秒退截屏
    onClose()
  }

  return {
    // 工具条与标注状态
    tool,
    setTool,
    activeColor,
    strokeWidth,
    handleColorChange,
    handleStrokeWidthChange,
    draftObject,
    // 文字编辑
    editingTarget,
    setEditingTarget,
    handleCommitEditing,
    textInputRef,
    // 光标与画布鼠标事件
    currentCursor,
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleDoubleClick,
    handleContextMenu,
  }
}
