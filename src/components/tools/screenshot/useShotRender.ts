/**
 * useShotRender.ts — 截图主画布渲染
 * 职责：把选区遮罩、候选窗口高亮、标注对象与选区手柄绘制到主画布（DPR 适配），
 * 监听重绘时机（状态变化 / 首帧就绪 / 窗口缩放），并把渲染器回填到 drawMainRef 挂点。
 */
import { useCallback, useEffect, useRef } from 'react'
import type { AnnotationObject, Rect, ToolType } from './types'
import { drawSelectionHandles, renderAnnotationObject } from './shotShapes'

export interface ShotRenderDeps {
  selection: Rect | null
  hoveredWindowRect: Rect | null
  isSelecting: boolean
  objects: AnnotationObject[]
  draftObject: AnnotationObject | null
  selectedObjectId: string | null
  tool: ToolType
  isLoaded: boolean
  /** 离屏原图画布：马赛克取样的像素来源（来自 useShotAssets） */
  offscreenCanvasRef: React.RefObject<HTMLCanvasElement | null>
  /** 晚绑定挂点：由 useShotAssets 创建，首帧就绪后调用本渲染器 */
  drawMainRef: React.RefObject<() => void>
}

export function useShotRender(deps: ShotRenderDeps) {
  const {
    selection,
    hoveredWindowRect,
    isSelecting,
    objects,
    draftObject,
    selectedObjectId,
    tool,
    isLoaded,
    offscreenCanvasRef,
    drawMainRef,
  } = deps
  const canvasRef = useRef<HTMLCanvasElement>(null)

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
        renderAnnotationObject(ctx, obj, obj.id === selectedObjectId, offscreenCanvasRef.current)
      }
      if (draftObject) {
        renderAnnotationObject(ctx, draftObject, true, offscreenCanvasRef.current)
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
    // deps：offscreenCanvasRef 为稳定 ref 对象，列入仅为满足 exhaustive-deps（行为不变）
  }, [selection, hoveredWindowRect, isSelecting, objects, draftObject, selectedObjectId, tool, isLoaded, offscreenCanvasRef])

  useEffect(() => {
    drawMainRef.current = drawMainCanvas
  }, [drawMainCanvas, drawMainRef])

  // 监听画面重绘与窗口缩放
  useEffect(() => {
    drawMainCanvas()
  }, [drawMainCanvas, isLoaded])

  useEffect(() => {
    const handleResize = () => drawMainCanvas()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [drawMainCanvas])

  return { canvasRef }
}
