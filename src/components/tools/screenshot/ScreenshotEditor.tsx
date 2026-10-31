import { useEffect, useRef, useState, useCallback } from 'react'
import {
  ArrowUpRight,
  Check,
  Circle,
  Download,
  Grid,
  Pin,
  Square,
  Type,
  Undo2,
  X,
} from 'lucide-react'
import { native } from '../../../lib/native'
import { t } from '../../../i18n'
import type {
  AnnotationObject,
  ColorMode,
  PinnedItemData,
  Rect,
  TextObject,
  ToolType,
} from './types'
import { detectWindowUnderCursor } from './windowDetector'

export interface ScreenshotEditorProps {
  imageSrc: string
  onClose: () => void
  onPin: (pinned: PinnedItemData) => void
  onToast: (msg: string) => void
  onReady?: () => void
}

const COLOR_PALETTE = [
  '#ef4444', // 红
  '#f97316', // 橙
  '#eab308', // 黄
  '#22c55e', // 绿
  '#3b82f6', // 蓝
  '#a855f7', // 紫
  '#ffffff', // 白
  '#000000', // 黑
]

const STROKE_WIDTHS = [2, 4, 6]

export default function ScreenshotEditor({
  imageSrc,
  onClose,
  onPin,
  onToast,
  onReady,
}: ScreenshotEditorProps) {
  // 画布与离屏资源
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null)
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageElementRef = useRef<HTMLImageElement | null>(null)
  const drawMainCanvasRef = useRef<() => void>(() => {})
  const [isLoaded, setIsLoaded] = useState(false)

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

  // 放大镜与颜色拾取
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: -1000, y: -1000 })
  const [colorMode, setColorMode] = useState<ColorMode>('HEX')
  const [currentColor, setCurrentColor] = useState<string>('#000000')
  const [currentRgb, setCurrentRgb] = useState<[number, number, number]>([0, 0, 0])
  const [copiedNotice, setCopiedNotice] = useState(false)
  const [currentCursor, setCurrentCursor] = useState<string>('crosshair')
  const textInputRef = useRef<HTMLInputElement>(null)

  // 工具条与标注对象系统
  const [tool, setTool] = useState<ToolType>('none')
  const [activeColor, setActiveColor] = useState<string>('#ef4444')
  const [strokeWidth, setStrokeWidth] = useState<number>(3)

  // 所有落在画布上的编辑均为独立对象
  const [objects, setObjects] = useState<AnnotationObject[]>([])
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)
  const [draftObject, setDraftObject] = useState<AnnotationObject | null>(null)

  // 正在编辑文字或箭头的尾部文本
  const [editingTarget, setEditingTarget] = useState<{
    id: string
    type: 'text' | 'arrowTail'
    x: number
    y: number
    text: string
  } | null>(null)

  // 对象拖动/改变大小交互
  const [isDraggingObject, setIsDraggingObject] = useState(false)
  const [objectDragStart, setObjectDragStart] = useState<{
    x: number
    y: number
    handle?: string
    origObj: AnnotationObject
  } | null>(null)

  // 色彩转换
  const rgbToHsl = (r: number, g: number, b: number): string => {
    const rNorm = r / 255
    const gNorm = g / 255
    const bNorm = b / 255
    const max = Math.max(rNorm, gNorm, bNorm)
    const min = Math.min(rNorm, gNorm, bNorm)
    let h = 0
    let s = 0
    const l = (max + min) / 2
    if (max !== min) {
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      switch (max) {
        case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break
        case gNorm: h = (bNorm - rNorm) / d + 2; break
        case bNorm: h = (rNorm - gNorm) / d + 4; break
      }
      h = Math.round(h * 60)
    }
    return `hsl(${h}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`
  }

  const formatColor = useCallback((r: number, g: number, b: number, mode: ColorMode): string => {
    if (mode === 'HEX') {
      const toHex = (v: number) => v.toString(16).padStart(2, '0').toUpperCase()
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`
    }
    if (mode === 'RGB') return `rgb(${r}, ${g}, ${b})`
    return rgbToHsl(r, g, b)
  }, [])

  // 复制当前光标颜色
  const copyCurrentColor = useCallback((overrideColor?: string) => {
    const val = overrideColor || currentColor
    void navigator.clipboard.writeText(val).then(() => {
      setCopiedNotice(true)
      setTimeout(() => setCopiedNotice(false), 1200)
      onToast(t('已复制颜色: {0}', val))
    }).catch(() => {
      onToast(t('复制失败'))
    })
  }, [currentColor, onToast])

  // 预加载原图，确保画面瞬时呈现绝不黑闪
  useEffect(() => {
    let active = true
    const img = new Image()
    img.src = imageSrc
    img.onload = () => {
      if (!active) return
      imageElementRef.current = img
      const offscreen = document.createElement('canvas')
      offscreen.width = img.naturalWidth
      offscreen.height = img.naturalHeight
      const ctx = offscreen.getContext('2d', { willReadFrequently: true })
      if (ctx) ctx.drawImage(img, 0, 0)
      offscreenCanvasRef.current = offscreen
      setIsLoaded(true)
      // 首帧双缓冲绘制，确保就绪后再显示窗口
      requestAnimationFrame(() => {
        drawMainCanvasRef.current?.()
        onReady?.()
      })
    }
    return () => {
      active = false
    }
  }, [imageSrc, onReady])

  // 当调出文字输入框时，自动聚焦并选中文字
  useEffect(() => {
    if (editingTarget) {
      requestAnimationFrame(() => {
        textInputRef.current?.focus()
        textInputRef.current?.select()
      })
    }
  }, [editingTarget])

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

  // 放大镜取样（缩放尺度调小，取样 17x17，单元格 5px，视野更广更舒适）
  const updateLoupe = useCallback((clientX: number, clientY: number) => {
    const loupeCanvas = loupeCanvasRef.current
    const offCanvas = offscreenCanvasRef.current
    if (!loupeCanvas || !offCanvas) return
    const offCtx = offCanvas.getContext('2d')
    if (!offCtx) return

    const scaleX = offCanvas.width / window.innerWidth
    const scaleY = offCanvas.height / window.innerHeight
    const imgX = Math.round(clientX * scaleX)
    const imgY = Math.round(clientY * scaleY)

    const clampedX = Math.max(0, Math.min(offCanvas.width - 1, imgX))
    const clampedY = Math.max(0, Math.min(offCanvas.height - 1, imgY))
    const p = offCtx.getImageData(clampedX, clampedY, 1, 1).data
    const r = p[0]
    const g = p[1]
    const b = p[2]
    setCurrentRgb([r, g, b])
    setCurrentColor(formatColor(r, g, b, colorMode))

    const gridSize = 17
    const cellSize = 5
    loupeCanvas.width = gridSize * cellSize
    loupeCanvas.height = gridSize * cellSize

    const lCtx = loupeCanvas.getContext('2d')
    if (!lCtx) return
    lCtx.imageSmoothingEnabled = false

    const half = Math.floor(gridSize / 2)
    const sx = Math.max(0, Math.min(offCanvas.width - gridSize, imgX - half))
    const sy = Math.max(0, Math.min(offCanvas.height - gridSize, imgY - half))

    lCtx.drawImage(offCanvas, sx, sy, gridSize, gridSize, 0, 0, gridSize * cellSize, gridSize * cellSize)

    // 细致网格线
    lCtx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
    lCtx.lineWidth = 0.5
    for (let i = 0; i <= gridSize; i++) {
      lCtx.beginPath()
      lCtx.moveTo(i * cellSize, 0)
      lCtx.lineTo(i * cellSize, gridSize * cellSize)
      lCtx.stroke()
      lCtx.beginPath()
      lCtx.moveTo(0, i * cellSize)
      lCtx.lineTo(gridSize * cellSize, i * cellSize)
      lCtx.stroke()
    }

    // 中心像素准星
    lCtx.strokeStyle = '#38bdf8'
    lCtx.lineWidth = 1.2
    lCtx.strokeRect(half * cellSize, half * cellSize, cellSize, cellSize)
  }, [colorMode, formatColor])

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
        setColorMode((prev) => {
          const next = prev === 'HEX' ? 'RGB' : prev === 'RGB' ? 'HSL' : 'HEX'
          setCurrentColor(formatColor(currentRgb[0], currentRgb[1], currentRgb[2], next))
          return next
        })
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
        void handleConfirm()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [editingTarget, selectedObjectId, selection, currentRgb, currentColor, colorMode, copyCurrentColor, formatColor, onClose, updateLoupe])

  // 辅助：获取缩放手柄对应的鼠标指针样式（提醒用户可调整尺寸）
  const getResizeCursor = (handle: string): string => {
    switch (handle) {
      case 'nw':
      case 'se':
        return 'nwse-resize'
      case 'ne':
      case 'sw':
        return 'nesw-resize'
      case 'n':
      case 's':
        return 'ns-resize'
      case 'e':
      case 'w':
        return 'ew-resize'
      default:
        return 'move'
    }
  }

  // 检测是否命中选区四周边框缩放手柄
  const getHitSelectionHandle = (cx: number, cy: number, sel: Rect): string | null => {
    const handleHitDist = 8
    const { x, y, width: w, height: h } = sel
    const points: Array<[string, number, number]> = [
      ['nw', x, y], ['n', x + w / 2, y], ['ne', x + w, y],
      ['e', x + w, y + h / 2], ['se', x + w, y + h],
      ['s', x + w / 2, y + h], ['sw', x, y + h], ['w', x, y + h / 2],
    ]
    for (const [id, px, py] of points) {
      if (Math.hypot(cx - px, cy - py) <= handleHitDist) return id
    }
    return null
  }

  // 点到线段距离辅助计算
  function distToSegment(p: { x: number; y: number }, v: { x: number; y: number }, w: { x: number; y: number }) {
    const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y)
    let tVal = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2
    tVal = Math.max(0, Math.min(1, tVal))
    return Math.hypot(p.x - (v.x + tVal * (w.x - v.x)), p.y - (v.y + tVal * (w.y - v.y)))
  }

  // 对象命中检测（支持线框、圆框、带字箭头、马赛克、文字）
  const hitTestObject = (clientX: number, clientY: number): { obj: AnnotationObject; handle?: string } | null => {
    // 逆序检查，优先选中最上层对象
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i]

      if (obj.type === 'rect' || obj.type === 'circle' || obj.type === 'mosaic') {
        const { x, y, width: w, height: h } = obj
        // 检查四周 8 个缩放手柄（拉尺寸）
        const handles: Array<[string, number, number]> = [
          ['nw', x, y], ['n', x + w / 2, y], ['ne', x + w, y],
          ['e', x + w, y + h / 2], ['se', x + w, y + h],
          ['s', x + w / 2, y + h], ['sw', x, y + h], ['w', x, y + h / 2],
        ]
        if (selectedObjectId === obj.id) {
          for (const [hName, hx, hy] of handles) {
            if (Math.hypot(clientX - hx, clientY - hy) <= 8) {
              return { obj, handle: hName }
            }
          }
        }
        // 检查矩形/圆形框内部或边框区域（拖拽移动）
        if (clientX >= x - 4 && clientX <= x + w + 4 && clientY >= y - 4 && clientY <= y + h + 4) {
          return { obj }
        }
      } else if (obj.type === 'arrow') {
        // 检查箭头起点手柄（非箭头端）与终点手柄（箭头端）
        if (selectedObjectId === obj.id) {
          if (Math.hypot(clientX - obj.x1, clientY - obj.y1) <= 10) return { obj, handle: 'p1' }
          if (Math.hypot(clientX - obj.x2, clientY - obj.y2) <= 10) return { obj, handle: 'p2' }
        }
        // 检查非箭头端的连接文本框区域（改文字）
        if (obj.text) {
          const textW = Math.max(60, obj.text.length * 14 + 16)
          const textH = 26
          const tx = obj.x1 - textW / 2
          const ty = obj.y1 - textH - 6
          if (clientX >= tx && clientX <= tx + textW && clientY >= ty && clientY <= ty + textH) {
            return { obj, handle: 'tailText' }
          }
        }
        // 检查点到箭头线段的距离（拖拽移动）
        const dist = distToSegment({ x: clientX, y: clientY }, { x: obj.x1, y: obj.y1 }, { x: obj.x2, y: obj.y2 })
        if (dist <= 8) return { obj }
      } else if (obj.type === 'text') {
        const textW = Math.max(30, obj.text.length * (obj.fontSize * 0.75) + 16)
        const textH = Math.max(20, obj.fontSize * 1.25)

        // 1. 选中时右下角缩放手柄（拉尺寸）
        if (selectedObjectId === obj.id) {
          const hx = obj.x + textW + 4
          const hy = obj.y + textH + 4
          if (Math.hypot(clientX - hx, clientY - hy) <= 9) {
            return { obj, handle: 'se' }
          }
        }

        // 2. 检查文字整体区域（拖拽移动或双击编辑）
        if (clientX >= obj.x - 6 && clientX <= obj.x + textW + 6 && clientY >= obj.y - 6 && clientY <= obj.y + textH + 6) {
          return { obj, handle: 'textBody' }
        }
      }
    }
    return null
  }

  // 动态计算当前光标样式，提醒用户操作意图（可拖拽、可拉伸、可改文字等）
  const computeCursor = (clientX: number, clientY: number): string => {
    // 正在拉选框中
    if (isSelectingRef.current) return 'crosshair'
    // 正在整体移动选区
    if (isMovingSelection) return 'move'
    // 正在缩放微调选区边框
    if (selectionResizeHandle) return getResizeCursor(selectionResizeHandle)
    // 正在拖拽或缩放标注对象
    if (isDraggingObject && objectDragStart) {
      if (objectDragStart.handle === 'tailText') return 'text'
      if (objectDragStart.handle === 'se') return 'nwse-resize'
      if (objectDragStart.handle === 'p1' || objectDragStart.handle === 'p2') return 'crosshair'
      if (objectDragStart.handle) return getResizeCursor(objectDragStart.handle)
      return 'move'
    }

    // 已确立选区时
    if (selection) {
      // 1. 检查是否在选区缩放手柄上（拉尺寸）
      if (tool === 'none') {
        const selHandle = getHitSelectionHandle(clientX, clientY, selection)
        if (selHandle) return getResizeCursor(selHandle)
      }

      // 2. 检查是否悬停在已存在的标注对象及其手柄上
      const hit = hitTestObject(clientX, clientY)
      if (hit) {
        if (hit.handle === 'tailText') return 'text' // 箭头文字：改文字
        if (hit.handle === 'se') return 'nwse-resize' // 文字缩放手柄：拉尺寸
        if (hit.handle === 'p1' || hit.handle === 'p2') return 'crosshair' // 箭头端点
        if (hit.handle && hit.handle !== 'textBody') return getResizeCursor(hit.handle) // 几何对象 8 向缩放手柄：拉尺寸
        if (hit.obj.type === 'text') {
          return tool === 'text' ? 'text' : 'move' // 文字对象：工具为文字时为 text，普通模式下为 move（可拖拽）
        }
        if (tool === 'none') return 'move' // 几何对象/箭头：可拖拽移动
      }

      // 3. 选区内部
      const inside =
        clientX >= selection.x &&
        clientX <= selection.x + selection.width &&
        clientY >= selection.y &&
        clientY <= selection.y + selection.height
      if (inside) {
        if (tool === 'none') return 'move' // 拖拽移动整个选框
        if (tool === 'text') return 'text' // 点击输入文字
        return 'crosshair' // 绘制工具准星
      }

      return 'crosshair'
    }

    // 尚未拉选区时：若悬停在检测出的候选窗口上，提示可单击选取窗口
    if (hoveredWindowRect) return 'pointer'
    return 'crosshair'
  }

  // 鼠标移动
  const handleMouseMove = (e: React.MouseEvent) => {
    const clientX = e.clientX
    const clientY = e.clientY
    setMousePos({ x: clientX, y: clientY })
    updateLoupe(clientX, clientY)

    // 实时计算当前光标样式（明确提醒用户操作意图：拖拽、拉伸手柄、改文字）
    const cursor = computeCursor(clientX, clientY)
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

    // 3. 未确立选区且未按住光标：实时探测并吸附候选窗口
    if (!selection && !dragStart) {
      const cur = hoveredWindowRectRef.current
      if (
        !cur ||
        clientX < cur.x ||
        clientX > cur.x + cur.width ||
        clientY < cur.y ||
        clientY > cur.y + cur.height
      ) {
        const detected = detectWindowUnderCursor(
          clientX,
          clientY,
          offscreenCanvasRef.current,
          systemRects,
          window.innerWidth,
          window.innerHeight,
        )
        setHoveredWindowRect(detected)
      }
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
      const hit = hitTestObject(clientX, clientY)
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

  // 双击事件：快速进入文字或箭头说明编辑（改文字）
  const handleDoubleClick = (e: React.MouseEvent) => {
    const clientX = e.clientX
    const clientY = e.clientY
    const hit = hitTestObject(clientX, clientY)
    if (hit) {
      if (hit.obj.type === 'text') {
        setEditingTarget({
          id: hit.obj.id,
          type: 'text',
          x: hit.obj.x,
          y: hit.obj.y,
          text: hit.obj.text,
        })
        setSelectedObjectId(hit.obj.id)
      } else if (hit.obj.type === 'arrow') {
        setEditingTarget({
          id: hit.obj.id,
          type: 'arrowTail',
          x: hit.obj.x1,
          y: hit.obj.y1,
          text: hit.obj.text || '',
        })
        setSelectedObjectId(hit.obj.id)
      }
    }
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

  // 画布主渲染逻辑
  const drawMainCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    const w = window.innerWidth
    const h = window.innerHeight
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.scale(dpr, dpr)

    // 1. 已选区状态：选区外部绘制黑色半透明遮罩，聚焦指示当前选框
    if (selection && (selection.width > 0 || selection.height > 0)) {
      const { x, y, width, height } = selection

      // 选区外部黑色半透明遮罩（聚焦突出当前选区位置，选区内部保持原色清晰）
      ctx.save()
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.beginPath()
      ctx.rect(0, 0, w, h)
      ctx.rect(x, y, width, height)
      ctx.fill('evenodd')
      ctx.restore()

      // 选区边框（精致天蓝边线）
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, width, height)

      // 限制绘制在选区之内
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, width, height)
      ctx.clip()

      // 绘制所有对象
      for (const obj of objects) {
        renderAnnotationObject(ctx, obj, obj.id === selectedObjectId)
      }
      if (draftObject) {
        renderAnnotationObject(ctx, draftObject, true)
      }

      ctx.restore()

      // 绘制选区四周调节手柄
      if (tool === 'none') {
        drawSelectionHandles(ctx, selection)
      }
    } else if (hoveredWindowRect && !isSelecting) {
      // 2. 悬停在窗口上时：高亮指示该窗口，无任何变色与暗化
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 2
      ctx.strokeRect(
        hoveredWindowRect.x,
        hoveredWindowRect.y,
        hoveredWindowRect.width,
        hoveredWindowRect.height,
      )
    }
  }, [selection, hoveredWindowRect, isSelecting, objects, draftObject, selectedObjectId, tool, isLoaded])

  useEffect(() => {
    drawMainCanvasRef.current = drawMainCanvas
  }, [drawMainCanvas])

  // 绘制几何对象选中的 8 个边框缩放手柄（提醒用户可以拉尺寸）
  const drawObjectResizeHandles = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    const normX = Math.min(x, x + w)
    const normY = Math.min(y, y + h)
    const normW = Math.abs(w)
    const normH = Math.abs(h)
    const sz = 6
    const half = sz / 2
    const pts = [
      [normX, normY], [normX + normW / 2, normY], [normX + normW, normY],
      [normX + normW, normY + normH / 2], [normX + normW, normY + normH],
      [normX + normW / 2, normY + normH], [normX, normY + normH], [normX, normY + normH / 2],
    ]
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#0284c7'
    ctx.lineWidth = 1.2
    for (const [px, py] of pts) {
      ctx.fillRect(px - half, py - half, sz, sz)
      ctx.strokeRect(px - half, py - half, sz, sz)
    }
  }

  // 绘制 8 个手柄
  const drawSelectionHandles = (ctx: CanvasRenderingContext2D, sel: Rect) => {
    const { x, y, width: w, height: h } = sel
    const sz = 7
    const half = sz / 2
    const pts = [
      [x, y], [x + w / 2, y], [x + w, y],
      [x + w, y + h / 2], [x + w, y + h],
      [x + w / 2, y + h], [x, y + h], [x, y + h / 2],
    ]
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#0284c7'
    ctx.lineWidth = 1.5
    for (const [px, py] of pts) {
      ctx.fillRect(px - half, py - half, sz, sz)
      ctx.strokeRect(px - half, py - half, sz, sz)
    }
  }

  // 单个对象渲染器（包含带边框文本框连接的箭头）
  const renderAnnotationObject = (
    ctx: CanvasRenderingContext2D,
    obj: AnnotationObject,
    isSelected: boolean,
  ) => {
    ctx.save()

    if (obj.type === 'rect') {
      ctx.strokeStyle = obj.color
      ctx.lineWidth = obj.strokeWidth
      ctx.strokeRect(obj.x, obj.y, obj.width, obj.height)
      if (isSelected) {
        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.strokeRect(obj.x - 3, obj.y - 3, obj.width + 6, obj.height + 6)
        ctx.setLineDash([])
        drawObjectResizeHandles(ctx, obj.x, obj.y, obj.width, obj.height)
      }
    } else if (obj.type === 'circle') {
      ctx.strokeStyle = obj.color
      ctx.lineWidth = obj.strokeWidth
      const cx = obj.x + obj.width / 2
      const cy = obj.y + obj.height / 2
      const rx = Math.abs(obj.width) / 2
      const ry = Math.abs(obj.height) / 2
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      ctx.stroke()
      if (isSelected) {
        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.strokeRect(obj.x - 3, obj.y - 3, obj.width + 6, obj.height + 6)
        ctx.setLineDash([])
        drawObjectResizeHandles(ctx, obj.x, obj.y, obj.width, obj.height)
      }
    } else if (obj.type === 'mosaic') {
      // 马赛克对象处理
      const off = offscreenCanvasRef.current
      if (off) {
        const offCtx = off.getContext('2d')
        if (offCtx) {
          const scaleX = off.width / window.innerWidth
          const scaleY = off.height / window.innerHeight
          const bs = obj.blockSize || 10
          for (let bx = obj.x; bx < obj.x + obj.width; bx += bs) {
            for (let by = obj.y; by < obj.y + obj.height; by += bs) {
              const sx = Math.floor((bx + bs / 2) * scaleX)
              const sy = Math.floor((by + bs / 2) * scaleY)
              const p = offCtx.getImageData(sx, sy, 1, 1).data
              ctx.fillStyle = `rgb(${p[0]}, ${p[1]}, ${p[2]})`
              ctx.fillRect(bx, by, bs, bs)
            }
          }
        }
      }
      if (isSelected) {
        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 1.5
        ctx.strokeRect(obj.x, obj.y, obj.width, obj.height)
        drawObjectResizeHandles(ctx, obj.x, obj.y, obj.width, obj.height)
      }
    } else if (obj.type === 'arrow') {
      ctx.strokeStyle = obj.color
      ctx.fillStyle = obj.color
      ctx.lineWidth = obj.strokeWidth

      const dx = obj.x2 - obj.x1
      const dy = obj.y2 - obj.y1
      const angle = Math.atan2(dy, dx)
      const headlen = Math.max(12, obj.strokeWidth * 3.5)

      // 箭杆
      ctx.beginPath()
      ctx.moveTo(obj.x1, obj.y1)
      ctx.lineTo(obj.x2, obj.y2)
      ctx.stroke()

      // 箭头头部 (在 (x2, y2))
      ctx.beginPath()
      ctx.moveTo(obj.x2, obj.y2)
      ctx.lineTo(
        obj.x2 - headlen * Math.cos(angle - Math.PI / 6),
        obj.y2 - headlen * Math.sin(angle - Math.PI / 6),
      )
      ctx.lineTo(
        obj.x2 - headlen * Math.cos(angle + Math.PI / 6),
        obj.y2 - headlen * Math.sin(angle + Math.PI / 6),
      )
      ctx.closePath()
      ctx.fill()

      // 非箭头的一端（起点 x1, y1）圆点连接指示
      ctx.beginPath()
      ctx.arc(obj.x1, obj.y1, Math.max(3, obj.strokeWidth), 0, Math.PI * 2)
      ctx.fill()

      // 连接的带边框文本框展示（非箭头端）
      if (obj.text) {
        ctx.font = 'bold 13px system-ui, sans-serif'
        ctx.textBaseline = 'middle'
        const metrics = ctx.measureText(obj.text)
        const textW = Math.max(50, metrics.width + 16)
        const textH = 24
        const tx = obj.x1 - textW / 2
        const ty = obj.y1 - textH - 8

        // 连线到文本框底边
        ctx.beginPath()
        ctx.moveTo(obj.x1, obj.y1)
        ctx.lineTo(obj.x1, ty + textH)
        ctx.strokeStyle = obj.color
        ctx.lineWidth = 1.5
        ctx.stroke()

        // 文本框底色与边框
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)'
        ctx.strokeStyle = obj.color
        ctx.lineWidth = 1.8
        roundRect(ctx, tx, ty, textW, textH, 6, true, true)

        // 文本内容
        ctx.fillStyle = '#ffffff'
        ctx.fillText(obj.text, tx + 8, ty + textH / 2)
      }

      if (isSelected) {
        // 选中时显示两端手柄
        ctx.fillStyle = '#ffffff'
        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(obj.x1, obj.y1, 5, 0, Math.PI * 2)
        ctx.fill(); ctx.stroke()
        ctx.beginPath()
        ctx.arc(obj.x2, obj.y2, 5, 0, Math.PI * 2)
        ctx.fill(); ctx.stroke()
      }
    } else if (obj.type === 'text') {
      ctx.font = `bold ${obj.fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
      ctx.textBaseline = 'top'
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)'
      ctx.lineWidth = 3
      ctx.strokeText(obj.text, obj.x, obj.y)
      ctx.fillStyle = obj.color
      ctx.fillText(obj.text, obj.x, obj.y)

      if (isSelected) {
        const metrics = ctx.measureText(obj.text)
        const textW = Math.max(30, metrics.width)
        const textH = Math.max(16, obj.fontSize * 1.2)
        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 1.2
        ctx.setLineDash([3, 3])
        ctx.strokeRect(obj.x - 4, obj.y - 4, textW + 8, textH + 8)
        ctx.setLineDash([])

        // 右下角缩放手柄（拉尺寸）
        const sz = 6
        const half = sz / 2
        const hx = obj.x + textW + 4
        const hy = obj.y + textH + 4
        ctx.fillStyle = '#ffffff'
        ctx.strokeStyle = '#0284c7'
        ctx.lineWidth = 1.2
        ctx.fillRect(hx - half, hy - half, sz, sz)
        ctx.strokeRect(hx - half, hy - half, sz, sz)
      }
    }

    ctx.restore()
  }

  // 绘制圆角矩形辅助函数
  function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fill: boolean,
    stroke: boolean,
  ) {
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.lineTo(x + width - radius, y)
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
    ctx.lineTo(x + width, y + height - radius)
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
    ctx.lineTo(x + radius, y + height)
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
    ctx.lineTo(x, y + radius)
    ctx.quadraticCurveTo(x, y, x + radius, y)
    ctx.closePath()
    if (fill) ctx.fill()
    if (stroke) ctx.stroke()
  }

  // 监听画面重绘与窗口缩放
  useEffect(() => {
    drawMainCanvas()
  }, [drawMainCanvas, isLoaded])

  useEffect(() => {
    const handleResize = () => drawMainCanvas()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [drawMainCanvas])

  // 生成最终高清裁切合并画布
  const renderFinalCroppedCanvas = (): HTMLCanvasElement | null => {
    if (!selection) return null
    const { x, y, width, height } = selection
    const rw = Math.round(width)
    const rh = Math.round(height)
    if (rw <= 0 || rh <= 0) return null

    const canvas = document.createElement('canvas')
    canvas.width = rw
    canvas.height = rh
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const img = imageElementRef.current
    const off = offscreenCanvasRef.current
    const source: CanvasImageSource | null = img && img.naturalWidth > 0 ? img : off
    if (!source) return null

    const naturalW = img?.naturalWidth || off?.width || window.innerWidth
    const naturalH = img?.naturalHeight || off?.height || window.innerHeight

    const scaleX = naturalW / window.innerWidth
    const scaleY = naturalH / window.innerHeight

    ctx.drawImage(
      source,
      x * scaleX,
      y * scaleY,
      width * scaleX,
      height * scaleY,
      0,
      0,
      rw,
      rh,
    )

    ctx.save()
    ctx.translate(-x, -y)
    for (const obj of objects) {
      renderAnnotationObject(ctx, obj, false)
    }
    ctx.restore()

    return canvas
  }

  // 下载保存
  const handleDownload = async () => {
    const finalCanvas = renderFinalCroppedCanvas()
    if (!finalCanvas) return
    const dataUrl = finalCanvas.toDataURL('image/png')
    const suggestedName = `Screenshot_${Date.now()}.png`

    try {
      const bridge = native()
      if (bridge.tools?.saveImage) {
        const res = await bridge.tools.saveImage({ suggestedName, dataUrl })
        if (res.ok && !res.canceled) {
          onToast(t('截图已保存'))
          onClose()
          return
        }
      }
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = suggestedName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      onToast(t('截图已保存'))
      onClose()
    } catch {
      onToast(t('保存失败'))
    }
  }

  // 指定 / 置顶贴图
  const handlePin = () => {
    if (!selection) return
    const finalCanvas = renderFinalCroppedCanvas()
    if (!finalCanvas) return
    const dataUrl = finalCanvas.toDataURL('image/png')
    onPin({
      id: `pin_${Date.now()}`,
      dataUrl,
      width: selection.width,
      height: selection.height,
      x: selection.x,
      y: selection.y,
    })
    onToast(t('已生成置顶贴图'))
    onClose()
  }

  // 确定：复制到剪贴板并退出
  const handleConfirm = async () => {
    const finalCanvas = renderFinalCroppedCanvas()
    if (!finalCanvas) return
    const dataUrl = finalCanvas.toDataURL('image/png')

    try {
      const bridge = native()
      // 1. Electron 独立截图窗口环境：由主进程直接将完整系统剪贴板格式写入并安全关闭截图窗口
      if (bridge.tools?.confirmScreenshot) {
        const res = await bridge.tools.confirmScreenshot(dataUrl)
        if (res && !res.ok) {
          onToast(res.error || t('写入剪贴板失败'))
        }
        return
      }

      // 2. WebUI / 独立工作区环境：通过 bridge.tools.copyImage 写入
      if (bridge.tools?.copyImage) {
        await bridge.tools.copyImage(dataUrl)
      } else if (navigator.clipboard && window.ClipboardItem) {
        const blob = await new Promise<Blob | null>((resolve) => finalCanvas.toBlob(resolve, 'image/png'))
        if (blob) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        }
      }
      onToast(t('截图已复制到剪贴板'))
      onClose()
    } catch {
      onToast(t('复制失败'))
    }
  }

  // 动态定位工具条
  const getToolbarStyle = (): React.CSSProperties => {
    if (!selection) return { display: 'none' }
    const toolbarWidth = 370
    const toolbarHeight = 44
    let left = selection.x + selection.width - toolbarWidth
    left = Math.max(10, Math.min(window.innerWidth - toolbarWidth - 10, left))
    let top = selection.y + selection.height + 10
    if (top + toolbarHeight > window.innerHeight - 10) {
      top = selection.y - toolbarHeight - 10
      if (top < 10) top = Math.max(10, selection.y + 10)
    }
    return { left: `${left}px`, top: `${top}px` }
  }

  // 动态定位放大镜
  const getLoupeStyle = (): React.CSSProperties => {
    const loupeWidth = 115
    const loupeHeight = 160
    let left = mousePos.x + 16
    let top = mousePos.y + 16
    if (left + loupeWidth > window.innerWidth - 10) left = mousePos.x - loupeWidth - 16
    if (top + loupeHeight > window.innerHeight - 10) top = mousePos.y - loupeHeight - 16
    return { left: `${left}px`, top: `${top}px` }
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

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      style={{ cursor: currentCursor }}
      className="fixed inset-0 z-[9999] select-none overflow-hidden"
    >
      {/* 底层硬件加速原图：100% 确保任何情况下屏幕画面绝无黑屏 */}
      <img
        src={imageSrc}
        alt="captured desktop"
        className="absolute inset-0 w-full h-full object-fill pointer-events-none select-none -z-10"
        draggable={false}
      />
      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* 尚未选取时的操作指引 */}
      {!selection && isLoaded && (
        <div className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full border border-white/20 bg-black/85 px-4 py-1.5 text-xs text-white/95 shadow-2xl backdrop-blur-md">
          <span>{t('单击自动选取窗口 · 拖拽自由框选 · 右键退出')}</span>
          <span className="text-white/40">|</span>
          <span className="text-white/60">{t('Shift 换色 · 双击反引号唤出')}</span>
        </div>
      )}

      {/* 自动捕捉候选窗口的实时尺寸展示 */}
      {!selection && hoveredWindowRect && (
        <div
          style={{
            left: `${Math.max(10, Math.min(window.innerWidth - 110, hoveredWindowRect.x + hoveredWindowRect.width - 92))}px`,
            top: `${hoveredWindowRect.y >= 32 ? hoveredWindowRect.y - 28 : hoveredWindowRect.y + 8}px`,
          }}
          className="pointer-events-none absolute z-30 flex items-center justify-center rounded-md bg-black/85 px-2 py-0.8 font-mono text-[11px] font-bold text-sky-400 shadow-lg backdrop-blur-sm border border-sky-400/30"
        >
          {Math.round(hoveredWindowRect.width)} × {Math.round(hoveredWindowRect.height)}
        </div>
      )}

      {/* 实时选框尺寸展示在右上角 */}
      {selection && (selection.width > 2 || selection.height > 2) && (
        <div
          style={{
            left: `${Math.max(10, Math.min(window.innerWidth - 110, selection.x + selection.width - 92))}px`,
            top: `${selection.y >= 32 ? selection.y - 28 : selection.y + 8}px`,
          }}
          className="pointer-events-none absolute z-30 flex items-center justify-center rounded-md bg-black/85 px-2 py-0.8 font-mono text-[11px] font-bold text-sky-400 shadow-lg backdrop-blur-sm border border-sky-400/30"
        >
          {Math.round(selection.width)} × {Math.round(selection.height)}
        </div>
      )}

      {/* 箭头连接文本框或独立文字编辑浮层 */}
      {editingTarget && (
        <div
          style={{
            left: `${editingTarget.x - (editingTarget.type === 'arrowTail' ? 70 : 0)}px`,
            top: `${editingTarget.y - (editingTarget.type === 'arrowTail' ? 36 : 0)}px`,
          }}
          className="text-editor-box absolute z-40"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            ref={textInputRef}
            value={editingTarget.text}
            onChange={(e) => setEditingTarget({ ...editingTarget, text: e.target.value })}
            onKeyDown={(e) => {
              // 中文输入法组合敲回车选字时放行
              if (e.nativeEvent.isComposing || e.key === 'Process') return
              if (e.key === 'Enter') {
                e.preventDefault()
                handleCommitEditing()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setEditingTarget(null)
              }
            }}
            onBlur={handleCommitEditing}
            placeholder={editingTarget.type === 'arrowTail' ? t('输入箭头说明...') : t('输入文字...')}
            style={{
              borderColor: activeColor,
              color: editingTarget.type === 'arrowTail' ? '#ffffff' : activeColor,
            }}
            className="rounded-lg border-2 bg-slate-950/95 px-2.5 py-1 text-[14px] font-semibold shadow-2xl outline-none min-w-[140px]"
          />
        </div>
      )}

      {/* 像素级取色放大镜（尺度舒适，微调友好，选取时跟随光标） */}
      {mousePos.x > 0 && (!selection || isSelecting) && !editingTarget && !selectionResizeHandle && (
        <div
          style={getLoupeStyle()}
          className="pointer-events-none absolute z-20 flex flex-col items-center rounded-xl border border-white/20 bg-slate-950/95 p-1.5 shadow-2xl backdrop-blur-md text-white w-[115px]"
        >
          <div className="relative overflow-hidden rounded-md border border-white/10 shadow-inner">
            <canvas ref={loupeCanvasRef} className="block" />
          </div>

          <div className="mt-1.5 flex w-full items-center justify-between gap-1 px-0.5">
            <span
              style={{ backgroundColor: currentColor }}
              className="h-3 w-3 shrink-0 rounded-full border border-white/40 shadow-sm"
            />
            <span className="font-mono text-[10.5px] font-semibold tracking-tight text-white/95 truncate">
              {currentColor}
            </span>
            <span className="shrink-0 rounded bg-white/10 px-1 py-0.2 text-[8.5px] font-medium text-white/70">
              {colorMode}
            </span>
          </div>

          <div className="mt-0.5 flex w-full justify-between text-[9px] text-zinc-400 px-0.5 font-mono">
            <span>{`X:${Math.round(mousePos.x)} Y:${Math.round(mousePos.y)}`}</span>
          </div>

          <div className="mt-1 border-t border-white/10 pt-0.5 flex w-full justify-between text-[8px] text-zinc-400">
            <span>Shift 换模式</span>
            <span className={copiedNotice ? 'text-green-400 font-bold' : ''}>
              {copiedNotice ? t('已复制!') : 'Ctrl+C 复制'}
            </span>
          </div>
        </div>
      )}

      {/* 截图工具条 */}
      {selection && selection.width > 15 && selection.height > 15 && (
        <div
          style={getToolbarStyle()}
          className="screenshot-toolbar absolute z-30 flex flex-col gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 主工具条 */}
          <div className="flex items-center gap-1 rounded-xl border border-line-strong/80 bg-card/95 p-1 shadow-2xl backdrop-blur-md text-ink">
            {/* 1. 线框 */}
            <button
              type="button"
              title={t('线框 (矩形)')}
              onClick={() => setTool(tool === 'rect' ? 'none' : 'rect')}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                tool === 'rect' ? 'bg-seal text-white' : 'hover:bg-line/60 text-ink-soft hover:text-ink'
              }`}
            >
              <Square size={15} />
            </button>

            {/* 2. 圆框 */}
            <button
              type="button"
              title={t('圆框 (椭圆)')}
              onClick={() => setTool(tool === 'circle' ? 'none' : 'circle')}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                tool === 'circle' ? 'bg-seal text-white' : 'hover:bg-line/60 text-ink-soft hover:text-ink'
              }`}
            >
              <Circle size={15} />
            </button>

            {/* 3. 箭头（附带尾部说明文本框） */}
            <button
              type="button"
              title={t('箭头标注（附带说明框）')}
              onClick={() => setTool(tool === 'arrow' ? 'none' : 'arrow')}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                tool === 'arrow' ? 'bg-seal text-white' : 'hover:bg-line/60 text-ink-soft hover:text-ink'
              }`}
            >
              <ArrowUpRight size={17} />
            </button>

            {/* 4. 马赛克 */}
            <button
              type="button"
              title={t('马赛克框选')}
              onClick={() => setTool(tool === 'mosaic' ? 'none' : 'mosaic')}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                tool === 'mosaic' ? 'bg-seal text-white' : 'hover:bg-line/60 text-ink-soft hover:text-ink'
              }`}
            >
              <Grid size={15} />
            </button>

            {/* 5. 文字 */}
            <button
              type="button"
              title={t('文字批注')}
              onClick={() => setTool(tool === 'text' ? 'none' : 'text')}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${
                tool === 'text' ? 'bg-seal text-white' : 'hover:bg-line/60 text-ink-soft hover:text-ink'
              }`}
            >
              <Type size={16} />
            </button>

            {/* 撤销 */}
            <button
              type="button"
              title={t('撤销 (Ctrl+Z)')}
              disabled={objects.length === 0}
              onClick={() => {
                setObjects((prev) => prev.slice(0, -1))
                setSelectedObjectId(null)
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-line/60 hover:text-ink disabled:opacity-30 disabled:pointer-events-none"
            >
              <Undo2 size={15} />
            </button>

            <div className="mx-0.5 h-4 w-px bg-line/60" />

            {/* 6. 下载 */}
            <button
              type="button"
              title={t('下载 / 保存')}
              onClick={handleDownload}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-line/60 hover:text-ink"
            >
              <Download size={15} />
            </button>

            {/* 7. 指定 / 置顶贴图 */}
            <button
              type="button"
              title={t('指定 / 置顶贴图')}
              onClick={handlePin}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-line/60 hover:text-ink"
            >
              <Pin size={15} />
            </button>

            {/* 取消 / 关闭 */}
            <button
              type="button"
              title={t('取消 (Esc)')}
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-red-500/20 hover:text-red-500"
            >
              <X size={16} />
            </button>

            {/* 8. 确定（复制到剪贴板） */}
            <button
              type="button"
              title={t('确定 (复制到剪贴板并退出)')}
              onClick={handleConfirm}
              className="flex h-8 items-center gap-1 rounded-lg bg-seal px-2.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-seal/90"
            >
              <Check size={14} />
              <span>{t('确定')}</span>
            </button>
          </div>

          {/* 属性子工具条（联动编辑当前选中对象或新建属性） */}
          {(tool === 'rect' || tool === 'circle' || tool === 'arrow' || tool === 'text' || selectedObjectId) && (
            <div className="flex items-center justify-between rounded-xl border border-line-strong/80 bg-card/95 px-2.5 py-1.5 shadow-xl backdrop-blur-md">
              <div className="flex items-center gap-1.5">
                {COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => handleColorChange(c)}
                    style={{ backgroundColor: c }}
                    className={`h-4 w-4 rounded-full border ${
                      activeColor === c ? 'ring-2 ring-seal ring-offset-1 border-white shadow-md' : 'border-black/20 hover:border-black/50'
                    }`}
                  />
                ))}
              </div>

              {tool !== 'text' && (
                <div className="flex items-center gap-1 pl-2 border-l border-line/60">
                  {STROKE_WIDTHS.map((sw) => (
                    <button
                      key={sw}
                      type="button"
                      onClick={() => handleStrokeWidthChange(sw)}
                      className={`flex h-5 w-5 items-center justify-center rounded ${
                        strokeWidth === sw ? 'bg-line text-seal font-bold' : 'text-ink-soft hover:bg-line/50'
                      }`}
                    >
                      <div
                        style={{ height: `${sw}px`, width: '12px', backgroundColor: activeColor }}
                        className="rounded-full"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
