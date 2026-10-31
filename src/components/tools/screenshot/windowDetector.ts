import type { Rect } from './types'

/**
 * 智能窗口与区块边缘捕捉器：
 * 1. 优先在已知系统与应用窗口集合中进行命中测试，匹配最小且包围光标的窗口；
 * 2. 在离屏画布像素中以十字射线快速扫描高对比度断层边缘（支持对话框、卡片、代码块等子容器吸附）。
 */
export function detectWindowUnderCursor(
  cx: number,
  cy: number,
  offCanvas: HTMLCanvasElement | null,
  sysRects: Rect[],
  screenWidth: number,
  screenHeight: number,
): Rect {
  // 1. 优先命中系统已知窗口或工作区
  const matched = sysRects
    .filter(
      (r) =>
        cx >= r.x &&
        cx <= r.x + r.width &&
        cy >= r.y &&
        cy <= r.y + r.height &&
        r.width > 60 &&
        r.height > 40 &&
        r.width <= screenWidth + 20 &&
        r.height <= screenHeight + 20,
    )
    .sort((a, b) => a.width * a.height - b.width * b.height)

  const base: Rect = matched[0] || { x: 0, y: 0, width: screenWidth, height: screenHeight }

  // 2. 在 base 范围内尝试寻找更精确的子区块/卡片高对比度边界
  if (offCanvas) {
    try {
      const scaleX = offCanvas.width / screenWidth
      const scaleY = offCanvas.height / screenHeight
      const ctx = offCanvas.getContext('2d')
      if (ctx) {
        const sub = findContentBoundsAround(
          ctx,
          Math.round(cx * scaleX),
          Math.round(cy * scaleY),
          offCanvas.width,
          offCanvas.height,
          scaleX,
          scaleY,
        )
        if (
          sub &&
          sub.width >= 120 &&
          sub.height >= 70 &&
          sub.width < base.width &&
          sub.height < base.height &&
          cx >= sub.x &&
          cx <= sub.x + sub.width &&
          cy >= sub.y &&
          cy <= sub.y + sub.height
        ) {
          return sub
        }
      }
    } catch {}
  }

  return base
}

/**
 * 十字射线边界探测：沿上下左右四个方向极速采样单像素色彩断层
 */
export function findContentBoundsAround(
  ctx: CanvasRenderingContext2D,
  ix: number,
  iy: number,
  imgW: number,
  imgH: number,
  scaleX: number,
  scaleY: number,
): Rect | null {
  try {
    const center = ctx.getImageData(ix, iy, 1, 1).data
    const diff = (data: Uint8ClampedArray, offset: number) =>
      Math.abs(data[offset] - center[0]) +
      Math.abs(data[offset + 1] - center[1]) +
      Math.abs(data[offset + 2] - center[2])

    // 上方向扫描
    const maxUp = Math.min(iy, 800)
    let top = iy
    if (maxUp > 10) {
      const up = ctx.getImageData(ix, iy - maxUp, 1, maxUp).data
      for (let i = maxUp - 1; i >= 0; i--) {
        if (diff(up, i * 4) > 65) {
          top = iy - (maxUp - i)
          break
        }
      }
    }

    // 下方向扫描
    const maxDown = Math.min(imgH - iy - 1, 800)
    let bottom = iy
    if (maxDown > 10) {
      const down = ctx.getImageData(ix, iy, 1, maxDown).data
      for (let i = 0; i < maxDown; i++) {
        if (diff(down, i * 4) > 65) {
          bottom = iy + i
          break
        }
      }
    }

    // 左方向扫描
    const maxLeft = Math.min(ix, 1200)
    let left = ix
    if (maxLeft > 10) {
      const leftCol = ctx.getImageData(ix - maxLeft, iy, maxLeft, 1).data
      for (let i = maxLeft - 1; i >= 0; i--) {
        if (diff(leftCol, i * 4) > 65) {
          left = ix - (maxLeft - i)
          break
        }
      }
    }

    // 右方向扫描
    const maxRight = Math.min(imgW - ix - 1, 1200)
    let right = ix
    if (maxRight > 10) {
      const rightCol = ctx.getImageData(ix, iy, maxRight, 1).data
      for (let i = 0; i < maxRight; i++) {
        if (diff(rightCol, i * 4) > 65) {
          right = ix + i
          break
        }
      }
    }

    const rx = Math.round(left / scaleX)
    const ry = Math.round(top / scaleY)
    const rw = Math.round((right - left) / scaleX)
    const rh = Math.round((bottom - top) / scaleY)
    if (rw >= 120 && rh >= 70) {
      return { x: rx, y: ry, width: rw, height: rh }
    }
  } catch {}
  return null
}
