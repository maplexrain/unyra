/**
 * useShotExport.ts — 截图结果产出动作
 * 职责：把当前选区与标注对象合成最终高清裁切画布（renderFinalCroppedCanvas），
 * 并提供下载保存、置顶贴图、复制到剪贴板并退出三个出口动作。
 */
import type { MouseEvent as ReactMouseEvent } from 'react'
import { native } from '../../../lib/native'
import { t } from '../../../i18n'
import type { AnnotationObject, PinnedItemData, Rect } from './types'
import { renderAnnotationObject } from './shotShapes'

export interface ShotExportDeps {
  selection: Rect | null
  objects: AnnotationObject[]
  /** 原图元素 / 离屏画布：最终导出的像素来源（来自 useShotAssets） */
  imageElementRef: React.RefObject<HTMLImageElement | null>
  offscreenCanvasRef: React.RefObject<HTMLCanvasElement | null>
  onClose: () => void
  onPin: (pinned: PinnedItemData) => void
  onToast: (msg: string) => void
}

export function useShotExport(deps: ShotExportDeps) {
  const { selection, objects, imageElementRef, offscreenCanvasRef, onClose, onPin, onToast } = deps

  // 生成最终高清裁切合并画布（支持指定目标矩形，未指定时默认使用当前选区）
  const renderFinalCroppedCanvas = (targetRect?: Rect | null): HTMLCanvasElement | null => {
    const target = targetRect || selection
    if (!target) return null
    const { x, y, width, height } = target
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

    if (objects.length > 0) {
      ctx.save()
      ctx.translate(-x, -y)
      for (const obj of objects) {
        renderAnnotationObject(ctx, obj, false, offscreenCanvasRef.current)
      }
      ctx.restore()
    }

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

  // 确定：复制到剪贴板并退出（支持指定目标矩形，如未选取时双击快速复制全屏或候选窗口）
  const handleConfirm = async (targetRect?: Rect | null | ReactMouseEvent) => {
    const isRect = (r: unknown): r is Rect =>
      typeof r === 'object' && r !== null && 'x' in r && 'y' in r && 'width' in r && 'height' in r
    const rect = isRect(targetRect) ? targetRect : selection
    const finalCanvas = renderFinalCroppedCanvas(rect)
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

  return { handleDownload, handlePin, handleConfirm }
}
