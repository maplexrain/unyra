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
import { native } from '../../lib/native'
import { t } from '../../i18n'
import type { PinnedItem } from './PinnedScreenshot'

export interface ScreenshotModalProps {
  imageSrc: string
  onClose: () => void
  onPin: (pinned: PinnedItem) => void
  onToast: (msg: string) => void
}

type ColorMode = 'HEX' | 'RGB' | 'HSL'
type ToolType = 'none' | 'rect' | 'circle' | 'arrow' | 'mosaic' | 'text'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface BaseAnnotation {
  color: string
  strokeWidth: number
}

interface RectAnnotation extends BaseAnnotation {
  type: 'rect'
  x1: number
  y1: number
  x2: number
  y2: number
}

interface CircleAnnotation extends BaseAnnotation {
  type: 'circle'
  x1: number
  y1: number
  x2: number
  y2: number
}

interface ArrowAnnotation extends BaseAnnotation {
  type: 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
}

interface MosaicAnnotation {
  type: 'mosaic'
  points: Array<{ x: number; y: number }>
  brushSize: number
}

interface TextAnnotation {
  type: 'text'
  x: number
  y: number
  text: string
  color: string
  fontSize: number
}

type Annotation = RectAnnotation | CircleAnnotation | ArrowAnnotation | MosaicAnnotation | TextAnnotation

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

export default function ScreenshotModal({ imageSrc, onClose, onPin, onToast }: ScreenshotModalProps) {
  // 基础 DOM 引用
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null)
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageElementRef = useRef<HTMLImageElement | null>(null)

  // 选区与交互状态
  const [selection, setSelection] = useState<Rect | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [activeHandle, setActiveHandle] = useState<string | null>(null)
  const [isMoving, setIsMoving] = useState(false)
  const [moveStart, setMoveStart] = useState<{ x: number; y: number; origSel: Rect } | null>(null)

  // 放大镜与颜色模式
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: -1000, y: -1000 })
  const [colorMode, setColorMode] = useState<ColorMode>('HEX')
  const [currentColor, setCurrentColor] = useState<string>('#000000')
  const [currentRgb, setCurrentRgb] = useState<[number, number, number]>([0, 0, 0])
  const [copiedNotice, setCopiedNotice] = useState(false)

  // 批注工具与历史
  const [tool, setTool] = useState<ToolType>('none')
  const [activeColor, setActiveColor] = useState<string>('#ef4444')
  const [strokeWidth, setStrokeWidth] = useState<number>(3)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [draftAnnotation, setDraftAnnotation] = useState<Annotation | null>(null)
  const [editingText, setEditingText] = useState<{ x: number; y: number; text: string } | null>(null)

  // 颜色模式转换辅助函数
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
        case rNorm:
          h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0)
          break
        case gNorm:
          h = (bNorm - rNorm) / d + 2
          break
        case bNorm:
          h = (rNorm - gNorm) / d + 4
          break
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
    if (mode === 'RGB') {
      return `rgb(${r}, ${g}, ${b})`
    }
    return rgbToHsl(r, g, b)
  }, [])

  // 复制当前拾取颜色
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

  // 初始化离屏图像与画布
  useEffect(() => {
    const img = new Image()
    img.src = imageSrc
    img.onload = () => {
      imageElementRef.current = img
      const offscreen = document.createElement('canvas')
      offscreen.width = img.naturalWidth
      offscreen.height = img.naturalHeight
      const ctx = offscreen.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        ctx.drawImage(img, 0, 0)
      }
      offscreenCanvasRef.current = offscreen
      drawMainCanvas()
    }
  }, [imageSrc])

  // 窗口大小变化时同步重绘画布
  useEffect(() => {
    const handleResize = () => {
      drawMainCanvas()
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [selection, annotations, draftAnnotation])

  // 全局快捷键监听（Shift 切换颜色模式，Ctrl+C 复制颜色，Ctrl+Z 撤销，Esc 退出，Enter 确认）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果正在输入文字批注，跳过特殊快捷键
      if (editingText) {
        if (e.key === 'Escape') {
          setEditingText(null)
        }
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
        // 用户快捷键 Ctrl+C：如果没有已确认的完整选区，优先复制当前鼠标像素颜色
        e.preventDefault()
        copyCurrentColor()
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        setAnnotations((prev) => prev.slice(0, -1))
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
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
  }, [colorMode, currentRgb, currentColor, editingText, selection, annotations, copyCurrentColor, formatColor, onClose])

  // 主画布绘制逻辑
  const drawMainCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const img = imageElementRef.current
    if (!canvas || !img) return

    const dpr = window.devicePixelRatio || 1
    const w = window.innerWidth
    const h = window.innerHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    // 1. 绘制完整原图
    ctx.drawImage(img, 0, 0, w, h)

    // 2. 如果存在选区，绘制半透明遮罩与镂空选区
    if (selection) {
      const { x, y, width, height } = selection

      // 遮罩层
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.fillRect(0, 0, w, y) // 上
      ctx.fillRect(0, y + height, w, h - (y + height)) // 下
      ctx.fillRect(0, y, x, height) // 左
      ctx.fillRect(x + width, y, w - (x + width), height) // 右

      // 选区边框（高对比鲜明边框）
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, width, height)

      // 绘制批注内容（限制在选区内）
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, width, height)
      ctx.clip()

      // 绘制所有已确认的批注
      for (const ann of annotations) {
        renderAnnotation(ctx, ann)
      }
      // 绘制当前正在绘制的草稿批注
      if (draftAnnotation) {
        renderAnnotation(ctx, draftAnnotation)
      }
      ctx.restore()

      // 绘制选区四周的 8 个拖动手柄（仅在没有选择标注工具时显示更清晰）
      if (tool === 'none') {
        drawHandles(ctx, selection)
      }
    } else {
      // 尚未框选时，整屏微暗，提示框选
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
      ctx.fillRect(0, 0, w, h)
    }
  }, [selection, annotations, draftAnnotation, tool])

  // 绘制 8 个缩放手柄
  const drawHandles = (ctx: CanvasRenderingContext2D, sel: Rect) => {
    const { x, y, width: w, height: h } = sel
    const handleSize = 7
    const half = handleSize / 2

    const coords = [
      { id: 'nw', cx: x, cy: y },
      { id: 'n', cx: x + w / 2, cy: y },
      { id: 'ne', cx: x + w, cy: y },
      { id: 'e', cx: x + w, cy: y + h / 2 },
      { id: 'se', cx: x + w, cy: y + h },
      { id: 's', cx: x + w / 2, cy: y + h },
      { id: 'sw', cx: x, cy: y + h },
      { id: 'w', cx: x, cy: y + h / 2 },
    ]

    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#0284c7'
    ctx.lineWidth = 1.5

    for (const pt of coords) {
      ctx.fillRect(pt.cx - half, pt.cy - half, handleSize, handleSize)
      ctx.strokeRect(pt.cx - half, pt.cy - half, handleSize, handleSize)
    }
  }

  // 批注图形渲染函数
  const renderAnnotation = (ctx: CanvasRenderingContext2D, ann: Annotation) => {
    ctx.save()

    if (ann.type === 'rect') {
      ctx.strokeStyle = ann.color
      ctx.lineWidth = ann.strokeWidth
      const x = Math.min(ann.x1, ann.x2)
      const y = Math.min(ann.y1, ann.y2)
      const w = Math.abs(ann.x2 - ann.x1)
      const h = Math.abs(ann.y2 - ann.y1)
      ctx.strokeRect(x, y, w, h)
    } else if (ann.type === 'circle') {
      ctx.strokeStyle = ann.color
      ctx.lineWidth = ann.strokeWidth
      const cx = (ann.x1 + ann.x2) / 2
      const cy = (ann.y1 + ann.y2) / 2
      const rx = Math.abs(ann.x2 - ann.x1) / 2
      const ry = Math.abs(ann.y2 - ann.y1) / 2
      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
      ctx.stroke()
    } else if (ann.type === 'arrow') {
      ctx.strokeStyle = ann.color
      ctx.fillStyle = ann.color
      ctx.lineWidth = ann.strokeWidth

      const dx = ann.x2 - ann.x1
      const dy = ann.y2 - ann.y1
      const angle = Math.atan2(dy, dx)
      const headlen = Math.max(12, ann.strokeWidth * 3.5)

      ctx.beginPath()
      ctx.moveTo(ann.x1, ann.y1)
      ctx.lineTo(ann.x2, ann.y2)
      ctx.stroke()

      // 箭头头部
      ctx.beginPath()
      ctx.moveTo(ann.x2, ann.y2)
      ctx.lineTo(
        ann.x2 - headlen * Math.cos(angle - Math.PI / 6),
        ann.y2 - headlen * Math.sin(angle - Math.PI / 6),
      )
      ctx.lineTo(
        ann.x2 - headlen * Math.cos(angle + Math.PI / 6),
        ann.y2 - headlen * Math.sin(angle + Math.PI / 6),
      )
      ctx.closePath()
      ctx.fill()
    } else if (ann.type === 'mosaic') {
      // 马赛克效果：在涂抹轨迹周围做块状像素化
      const img = imageElementRef.current
      if (img && ann.points.length > 0) {
        const blockSize = 8
        const r = ann.brushSize || 16
        for (const pt of ann.points) {
          const bx = Math.floor((pt.x - r) / blockSize) * blockSize
          const by = Math.floor((pt.y - r) / blockSize) * blockSize
          const bw = Math.ceil((r * 2) / blockSize) * blockSize
          const bh = Math.ceil((r * 2) / blockSize) * blockSize

          // 从离屏源获取颜色并画块
          const off = offscreenCanvasRef.current
          if (off) {
            const offCtx = off.getContext('2d')
            if (offCtx) {
              const scaleX = off.width / window.innerWidth
              const scaleY = off.height / window.innerHeight
              for (let x = bx; x < bx + bw; x += blockSize) {
                for (let y = by; y < by + bh; y += blockSize) {
                  // 计算该点到画笔中心的距离
                  if (Math.hypot(x + blockSize / 2 - pt.x, y + blockSize / 2 - pt.y) <= r) {
                    const sx = Math.floor((x + blockSize / 2) * scaleX)
                    const sy = Math.floor((y + blockSize / 2) * scaleY)
                    const p = offCtx.getImageData(sx, sy, 1, 1).data
                    ctx.fillStyle = `rgb(${p[0]}, ${p[1]}, ${p[2]})`
                    ctx.fillRect(x, y, blockSize, blockSize)
                  }
                }
              }
            }
          }
        }
      }
    } else if (ann.type === 'text') {
      ctx.font = `bold ${ann.fontSize}px system-ui, -apple-system, sans-serif`
      ctx.textBaseline = 'top'
      // 文字阴影与描边，确保在任何深浅背景上都清晰可读
      ctx.strokeStyle = '#000000'
      ctx.lineWidth = 3
      ctx.strokeText(ann.text, ann.x, ann.y)
      ctx.fillStyle = ann.color
      ctx.fillText(ann.text, ann.x, ann.y)
    }

    ctx.restore()
  }

  // 放大镜像素放大与取色渲染
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

    // 读取中心像素颜色
    const clampedX = Math.max(0, Math.min(offCanvas.width - 1, imgX))
    const clampedY = Math.max(0, Math.min(offCanvas.height - 1, imgY))
    const p = offCtx.getImageData(clampedX, clampedY, 1, 1).data
    const r = p[0]
    const g = p[1]
    const b = p[2]
    setCurrentRgb([r, g, b])
    setCurrentColor(formatColor(r, g, b, colorMode))

    // 绘制放大镜网格 (13 x 13 像素区域，放大为 9x9 像素格)
    const gridSize = 13
    const cellSize = 9
    loupeCanvas.width = gridSize * cellSize
    loupeCanvas.height = gridSize * cellSize

    const lCtx = loupeCanvas.getContext('2d')
    if (!lCtx) return
    lCtx.imageSmoothingEnabled = false

    const half = Math.floor(gridSize / 2)
    const sx = Math.max(0, Math.min(offCanvas.width - gridSize, imgX - half))
    const sy = Math.max(0, Math.min(offCanvas.height - gridSize, imgY - half))

    // 将原图的 13x13 像素拉伸绘制到 117x117 画布上
    lCtx.drawImage(offCanvas, sx, sy, gridSize, gridSize, 0, 0, gridSize * cellSize, gridSize * cellSize)

    // 绘制像素网格分割线
    lCtx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
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

    // 中心目标像素高亮准星框
    lCtx.strokeStyle = '#38bdf8'
    lCtx.lineWidth = 1.5
    lCtx.strokeRect(half * cellSize, half * cellSize, cellSize, cellSize)
  }, [colorMode, formatColor])

  // 鼠标移动事件统一处理
  const handleMouseMove = (e: React.MouseEvent) => {
    const clientX = e.clientX
    const clientY = e.clientY
    setMousePos({ x: clientX, y: clientY })

    // 更新取色与放大镜
    updateLoupe(clientX, clientY)

    // 1. 正在框选选区中
    if (isSelecting && dragStart) {
      const x = Math.min(dragStart.x, clientX)
      const y = Math.min(dragStart.y, clientY)
      const width = Math.abs(clientX - dragStart.x)
      const height = Math.abs(clientY - dragStart.y)
      setSelection({ x, y, width, height })
      return
    }

    // 2. 正在调整手柄缩放选区中
    if (activeHandle && selection && dragStart) {
      const dx = clientX - dragStart.x
      const dy = clientY - dragStart.y
      const s = { ...selection }

      if (activeHandle.includes('w')) {
        s.x += dx
        s.width -= dx
      }
      if (activeHandle.includes('e')) {
        s.width += dx
      }
      if (activeHandle.includes('n')) {
        s.y += dy
        s.height -= dy
      }
      if (activeHandle.includes('s')) {
        s.height += dy
      }

      // 规整正向尺寸
      if (s.width > 10 && s.height > 10) {
        setSelection(s)
        setDragStart({ x: clientX, y: clientY })
      }
      return
    }

    // 3. 正在整体拖动移动选区中
    if (isMoving && moveStart) {
      const dx = clientX - moveStart.x
      const dy = clientY - moveStart.y
      const maxW = window.innerWidth
      const maxH = window.innerHeight
      const nextX = Math.max(0, Math.min(maxW - moveStart.origSel.width, moveStart.origSel.x + dx))
      const nextY = Math.max(0, Math.min(maxH - moveStart.origSel.height, moveStart.origSel.y + dy))
      setSelection({
        ...moveStart.origSel,
        x: nextX,
        y: nextY,
      })
      return
    }

    // 4. 正在绘制标注草稿中
    if (tool !== 'none' && draftAnnotation && selection) {
      const clampedX = Math.max(selection.x, Math.min(selection.x + selection.width, clientX))
      const clampedY = Math.max(selection.y, Math.min(selection.y + selection.height, clientY))

      if (draftAnnotation.type === 'rect' || draftAnnotation.type === 'circle' || draftAnnotation.type === 'arrow') {
        setDraftAnnotation({
          ...draftAnnotation,
          x2: clampedX,
          y2: clampedY,
        })
      } else if (draftAnnotation.type === 'mosaic') {
        setDraftAnnotation({
          ...draftAnnotation,
          points: [...draftAnnotation.points, { x: clampedX, y: clampedY }],
        })
      }
    }
  }

  // 检测鼠标是否命中手柄
  const getHitHandle = (cx: number, cy: number, sel: Rect): string | null => {
    const handleHitDist = 8
    const { x, y, width: w, height: h } = sel
    const points: Array<[string, number, number]> = [
      ['nw', x, y],
      ['n', x + w / 2, y],
      ['ne', x + w, y],
      ['e', x + w, y + h / 2],
      ['se', x + w, y + h],
      ['s', x + w / 2, y + h],
      ['sw', x, y + h],
      ['w', x, y + h / 2],
    ]
    for (const [id, px, py] of points) {
      if (Math.hypot(cx - px, cy - py) <= handleHitDist) {
        return id
      }
    }
    return null
  }

  // 鼠标按下事件
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return // 仅响应左键
    const clientX = e.clientX
    const clientY = e.clientY

    // 如果点击了工具条浮层，直接返回不触发画布操作
    if ((e.target as HTMLElement).closest('.screenshot-toolbar')) return

    // 1. 如果已有选区且启用了绘制工具（线框/圆框/箭头/马赛克/文字）
    if (selection && tool !== 'none') {
      // 检查点击是否在选区内
      const inside =
        clientX >= selection.x &&
        clientX <= selection.x + selection.width &&
        clientY >= selection.y &&
        clientY <= selection.y + selection.height

      if (inside) {
        if (tool === 'text') {
          setEditingText({ x: clientX, y: clientY, text: '' })
          return
        }
        if (tool === 'rect' || tool === 'circle' || tool === 'arrow') {
          setDraftAnnotation({
            type: tool,
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
          setDraftAnnotation({
            type: 'mosaic',
            points: [{ x: clientX, y: clientY }],
            brushSize: 16,
          })
          return
        }
      }
    }

    // 2. 如果已有选区，判断是否点中了调整手柄
    if (selection) {
      const hit = getHitHandle(clientX, clientY, selection)
      if (hit) {
        setActiveHandle(hit)
        setDragStart({ x: clientX, y: clientY })
        return
      }

      // 判断是否点在选区内部以进行整体拖动移动
      const inside =
        clientX >= selection.x &&
        clientX <= selection.x + selection.width &&
        clientY >= selection.y &&
        clientY <= selection.y + selection.height

      if (inside && tool === 'none') {
        setIsMoving(true)
        setMoveStart({ x: clientX, y: clientY, origSel: selection })
        return
      }
    }

    // 3. 否则重新开始框选
    setIsSelecting(true)
    setDragStart({ x: clientX, y: clientY })
    setSelection({ x: clientX, y: clientY, width: 0, height: 0 })
    setAnnotations([])
    setTool('none')
    setEditingText(null)
  }

  // 鼠标松开事件
  const handleMouseUp = () => {
    if (isSelecting) {
      setIsSelecting(false)
      setDragStart(null)
      // 如果框选面积太小（例如单击了一下），自动全屏框选或清空
      if (selection && (selection.width < 10 || selection.height < 10)) {
        setSelection(null)
      }
    }

    if (activeHandle) {
      setActiveHandle(null)
      setDragStart(null)
    }

    if (isMoving) {
      setIsMoving(false)
      setMoveStart(null)
    }

    if (draftAnnotation) {
      setAnnotations((prev) => [...prev, draftAnnotation])
      setDraftAnnotation(null)
    }
  }

  // 生成裁切并合并批注后的最终画板
  const renderFinalCroppedCanvas = (): HTMLCanvasElement | null => {
    if (!selection || !imageElementRef.current) return null
    const { x, y, width, height } = selection
    if (width <= 0 || height <= 0) return null

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const img = imageElementRef.current
    const scaleX = img.naturalWidth / window.innerWidth
    const scaleY = img.naturalHeight / window.innerHeight

    // 1. 绘制截取原图像素
    ctx.drawImage(
      img,
      x * scaleX,
      y * scaleY,
      width * scaleX,
      height * scaleY,
      0,
      0,
      width,
      height,
    )

    // 2. 坐标转换并绘制全部批注
    ctx.save()
    ctx.translate(-x, -y)
    for (const ann of annotations) {
      renderAnnotation(ctx, ann)
    }
    ctx.restore()

    return canvas
  }

  // 1. 下载 / 保存截图
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
      // Web 浏览器兜底直接触发下载
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

  // 2. 指定 / 置顶贴图
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

  // 3. 确定 / 复制到剪贴板并退出
  const handleConfirm = async () => {
    const finalCanvas = renderFinalCroppedCanvas()
    if (!finalCanvas) return

    const dataUrl = finalCanvas.toDataURL('image/png')

    try {
      const bridge = native()
      // Electron 主进程原生剪贴板
      if (bridge.tools?.copyImage) {
        await bridge.tools.copyImage(dataUrl)
      }

      // Web Clipboard API 写入
      finalCanvas.toBlob(async (blob) => {
        if (blob && navigator.clipboard && window.ClipboardItem) {
          try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          } catch {
            // 已由主进程写入或静默
          }
        }
      }, 'image/png')

      onToast(t('截图已复制到剪贴板'))
      onClose()
    } catch {
      onToast(t('复制失败'))
    }
  }

  // 提交文字批注
  const handleCommitText = () => {
    if (!editingText || !editingText.text.trim()) {
      setEditingText(null)
      return
    }
    setAnnotations((prev) => [
      ...prev,
      {
        type: 'text',
        x: editingText.x,
        y: editingText.y,
        text: editingText.text.trim(),
        color: activeColor,
        fontSize: 18,
      },
    ])
    setEditingText(null)
  }

  // 动态计算工具栏位置（贴在选区右下角外部，超出视口则自动翻转或吸附）
  const getToolbarStyle = (): React.CSSProperties => {
    if (!selection) return { display: 'none' }
    const toolbarWidth = 370
    const toolbarHeight = 44
    let left = selection.x + selection.width - toolbarWidth
    left = Math.max(10, Math.min(window.innerWidth - toolbarWidth - 10, left))

    let top = selection.y + selection.height + 10
    if (top + toolbarHeight > window.innerHeight - 10) {
      top = selection.y - toolbarHeight - 10
      if (top < 10) {
        top = Math.max(10, selection.y + 10)
      }
    }
    return { left: `${left}px`, top: `${top}px` }
  }

  // 动态计算放大镜浮窗位置（避开右边缘与下边缘）
  const getLoupeStyle = (): React.CSSProperties => {
    const loupeWidth = 135
    const loupeHeight = 190
    let left = mousePos.x + 18
    let top = mousePos.y + 18

    if (left + loupeWidth > window.innerWidth - 10) {
      left = mousePos.x - loupeWidth - 18
    }
    if (top + loupeHeight > window.innerHeight - 10) {
      top = mousePos.y - loupeHeight - 18
    }
    return { left: `${left}px`, top: `${top}px` }
  }

  // 监听重绘
  useEffect(() => {
    drawMainCanvas()
  }, [drawMainCanvas])

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      className="fixed inset-0 z-[9999] select-none overflow-hidden cursor-crosshair bg-black"
    >
      {/* 主截图渲染与镂空画布 */}
      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* 文字输入气泡框 */}
      {editingText && (
        <div
          style={{ left: `${editingText.x}px`, top: `${editingText.y}px` }}
          className="absolute z-30"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            autoFocus
            value={editingText.text}
            onChange={(e) => setEditingText({ ...editingText, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCommitText()
            }}
            onBlur={handleCommitText}
            placeholder={t('输入文字后回车...')}
            style={{ color: activeColor }}
            className="rounded border border-sky-400 bg-black/80 px-2 py-1 text-[16px] font-semibold text-white shadow-xl outline-none"
          />
        </div>
      )}

      {/* 取色放大镜浮窗（跟随鼠标） */}
      {mousePos.x > 0 && !editingText && (
        <div
          style={getLoupeStyle()}
          className="pointer-events-none absolute z-20 flex flex-col items-center rounded-xl border border-white/20 bg-[#18181b]/95 p-2 shadow-2xl backdrop-blur-md text-white w-[130px]"
        >
          {/* 像素放大镜格 */}
          <div className="relative overflow-hidden rounded-lg border border-white/10 shadow-inner">
            <canvas ref={loupeCanvasRef} className="block" />
          </div>

          {/* 颜色数值与色块 */}
          <div className="mt-2 flex w-full items-center justify-between gap-1.5 px-0.5">
            <span
              style={{ backgroundColor: currentColor }}
              className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/40 shadow-sm"
            />
            <span className="font-mono text-[11px] font-semibold tracking-tight text-white/95 truncate">
              {currentColor}
            </span>
            <span className="shrink-0 rounded bg-white/10 px-1 py-0.2 text-[9px] font-medium text-white/70">
              {colorMode}
            </span>
          </div>

          {/* 坐标与选区尺寸提示 */}
          <div className="mt-1 flex w-full justify-between text-[9.5px] text-zinc-400 px-0.5 font-mono">
            <span>{`X:${Math.round(mousePos.x)} Y:${Math.round(mousePos.y)}`}</span>
            {selection && (
              <span className="text-sky-400 font-semibold">{`${Math.round(selection.width)}×${Math.round(selection.height)}`}</span>
            )}
          </div>

          {/* 快捷键提示 */}
          <div className="mt-1.5 border-t border-white/10 pt-1 flex w-full justify-between text-[8.5px] text-zinc-400">
            <span>Shift 换模式</span>
            <span className={copiedNotice ? 'text-green-400 font-bold' : ''}>
              {copiedNotice ? t('已复制!') : 'Ctrl+C 复制'}
            </span>
          </div>
        </div>
      )}

      {/* 截图工具条（选区确认后出现） */}
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

            {/* 3. 箭头 */}
            <button
              type="button"
              title={t('箭头')}
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
              title={t('马赛克 (涂抹模糊)')}
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

            {/* 撤销上一步 */}
            <button
              type="button"
              title={t('撤销 (Ctrl+Z)')}
              disabled={annotations.length === 0}
              onClick={() => setAnnotations((prev) => prev.slice(0, -1))}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-line/60 hover:text-ink disabled:opacity-30 disabled:pointer-events-none"
            >
              <Undo2 size={15} />
            </button>

            <div className="mx-0.5 h-4 w-px bg-line/60" />

            {/* 6. 下载 */}
            <button
              type="button"
              title={t('下载 / 保存到文件')}
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

          {/* 标注参数子工具条（当激活绘制工具时展开） */}
          {(tool === 'rect' || tool === 'circle' || tool === 'arrow' || tool === 'text') && (
            <div className="flex items-center justify-between rounded-xl border border-line-strong/80 bg-card/95 px-2.5 py-1.5 shadow-xl backdrop-blur-md">
              {/* 调色板 */}
              <div className="flex items-center gap-1.5">
                {COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setActiveColor(c)}
                    style={{ backgroundColor: c }}
                    className={`h-4 w-4 rounded-full border transition ${
                      activeColor === c ? 'scale-125 border-seal shadow-md' : 'border-black/20 hover:scale-110'
                    }`}
                  />
                ))}
              </div>

              {/* 线宽选择 */}
              {tool !== 'text' && (
                <div className="flex items-center gap-1 pl-2 border-l border-line/60">
                  {STROKE_WIDTHS.map((sw) => (
                    <button
                      key={sw}
                      type="button"
                      onClick={() => setStrokeWidth(sw)}
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
