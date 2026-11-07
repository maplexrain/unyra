/**
 * shotShapes.ts — 截图标注对象的画布渲染
 * 职责：把矩形 / 圆框 / 马赛克 / 箭头 / 文字等标注对象绘制到给定 2D 上下文，
 * 并提供对象与选区的缩放手柄、圆角矩形等绘制辅助。
 * （自 ScreenshotEditor.tsx 原样搬出；马赛克取样的离屏画布由闭包读取改为显式入参 offCanvas。）
 */
import type { AnnotationObject, Rect } from './types'

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
export const drawSelectionHandles = (ctx: CanvasRenderingContext2D, sel: Rect) => {
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

// 单个对象渲染器（包含带边框文本框连接的箭头）
export const renderAnnotationObject = (
  ctx: CanvasRenderingContext2D,
  obj: AnnotationObject,
  isSelected: boolean,
  // 离屏原图画布：马赛克取样的像素来源（原组件闭包中的 offscreenCanvasRef.current）
  offCanvas: HTMLCanvasElement | null,
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
    const off = offCanvas
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
