/**
 * shotGeometry.ts — 截图编辑器纯几何 / 取色 / 光标 / 定位辅助
 * 职责：色彩格式转换（HEX/RGB/HSL）、缩放手柄光标样式、选区与标注对象命中检测、
 * 动态光标计算、工具条与放大镜定位。全部为无状态纯函数，不持有 React 状态。
 * （自 ScreenshotEditor.tsx 原样搬出，仅把原先的组件闭包读取改为显式入参。）
 */
import type { AnnotationObject, ColorMode, Rect, ToolType } from './types'

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

export const formatColor = (r: number, g: number, b: number, mode: ColorMode): string => {
  if (mode === 'HEX') {
    const toHex = (v: number) => v.toString(16).padStart(2, '0').toUpperCase()
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`
  }
  if (mode === 'RGB') return `rgb(${r}, ${g}, ${b})`
  return rgbToHsl(r, g, b)
}

// 辅助：获取缩放手柄对应的鼠标指针样式（提醒用户可调整尺寸）
export const getResizeCursor = (handle: string): string => {
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
export const getHitSelectionHandle = (cx: number, cy: number, sel: Rect): string | null => {
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
export function distToSegment(p: { x: number; y: number }, v: { x: number; y: number }, w: { x: number; y: number }) {
  const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y)
  let tVal = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2
  tVal = Math.max(0, Math.min(1, tVal))
  return Math.hypot(p.x - (v.x + tVal * (w.x - v.x)), p.y - (v.y + tVal * (w.y - v.y)))
}

// 对象拖动/改变大小交互的起始快照（原 useState 内联类型）
export interface ShotObjectDragStart {
  x: number
  y: number
  handle?: string
  origObj: AnnotationObject
}

// 对象命中检测（支持线框、圆框、带字箭头、马赛克、文字）
export const hitTestObject = (
  objects: AnnotationObject[],
  selectedObjectId: string | null,
  clientX: number,
  clientY: number,
): { obj: AnnotationObject; handle?: string } | null => {
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
export interface ShotCursorContext {
  clientX: number
  clientY: number
  /** 是否正在自由拉选框（原为 isSelectingRef.current） */
  isSelecting: boolean
  isMovingSelection: boolean
  selectionResizeHandle: string | null
  isDraggingObject: boolean
  objectDragStart: ShotObjectDragStart | null
  selection: Rect | null
  tool: ToolType
  objects: AnnotationObject[]
  selectedObjectId: string | null
  hoveredWindowRect: Rect | null
}

export const computeCursor = (ctx: ShotCursorContext): string => {
  const {
    clientX,
    clientY,
    isSelecting,
    isMovingSelection,
    selectionResizeHandle,
    isDraggingObject,
    objectDragStart,
    selection,
    tool,
    objects,
    selectedObjectId,
    hoveredWindowRect,
  } = ctx
  // 正在拉选框中
  if (isSelecting) return 'crosshair'
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
    const hit = hitTestObject(objects, selectedObjectId, clientX, clientY)
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

// 动态定位工具条
export const getToolbarStyle = (selection: Rect | null): React.CSSProperties => {
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
export const getLoupeStyle = (mousePos: { x: number; y: number }): React.CSSProperties => {
  const loupeWidth = 115
  const loupeHeight = 160
  let left = mousePos.x + 16
  let top = mousePos.y + 16
  if (left + loupeWidth > window.innerWidth - 10) left = mousePos.x - loupeWidth - 16
  if (top + loupeHeight > window.innerHeight - 10) top = mousePos.y - loupeHeight - 16
  return { left: `${left}px`, top: `${top}px` }
}
