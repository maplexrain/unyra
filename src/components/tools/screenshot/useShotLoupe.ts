/**
 * useShotLoupe.ts — 像素取色放大镜与颜色复制
 * 职责：跟随光标的放大镜取样渲染（17x17 取样网格）、当前颜色 / 颜色格式状态、
 * 剪贴板复制颜色与 Shift 循环切换格式。
 */
import { useCallback, useRef, useState } from 'react'
import { t } from '../../../i18n'
import type { ColorMode } from './types'
import { formatColor } from './shotGeometry'

export interface ShotLoupeDeps {
  /** 离屏原图画布：放大镜取样像素来源（来自 useShotAssets） */
  offscreenCanvasRef: React.RefObject<HTMLCanvasElement | null>
  onToast: (msg: string) => void
}

export interface ShotLoupeState {
  // 放大镜与颜色拾取
  mousePos: { x: number; y: number }
  setMousePos: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>
  colorMode: ColorMode
  currentColor: string
  currentRgb: [number, number, number]
  copiedNotice: boolean
  loupeCanvasRef: React.RefObject<HTMLCanvasElement | null>
  updateLoupe: (clientX: number, clientY: number) => void
  copyCurrentColor: (overrideColor?: string) => void
  /** Shift 键循环切换 HEX → RGB → HSL，并同步当前颜色显示 */
  cycleColorMode: () => void
}

export function useShotLoupe(deps: ShotLoupeDeps): ShotLoupeState {
  const { offscreenCanvasRef, onToast } = deps
  // 放大镜与颜色拾取
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: -1000, y: -1000 })
  const [colorMode, setColorMode] = useState<ColorMode>('HEX')
  const [currentColor, setCurrentColor] = useState<string>('#000000')
  const [currentRgb, setCurrentRgb] = useState<[number, number, number]>([0, 0, 0])
  const [copiedNotice, setCopiedNotice] = useState(false)
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null)

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
    // deps：offscreenCanvasRef 为稳定 ref 对象，列入仅为满足 exhaustive-deps（行为不变）
  }, [colorMode, offscreenCanvasRef])

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

  // Shift 换格式（原键盘 Shift 分支逻辑原样收拢：循环 HEX → RGB → HSL）
  const cycleColorMode = useCallback(() => {
    setColorMode((prev) => {
      const next = prev === 'HEX' ? 'RGB' : prev === 'RGB' ? 'HSL' : 'HEX'
      setCurrentColor(formatColor(currentRgb[0], currentRgb[1], currentRgb[2], next))
      return next
    })
  }, [currentRgb])

  return {
    mousePos,
    setMousePos,
    colorMode,
    currentColor,
    currentRgb,
    copiedNotice,
    loupeCanvasRef,
    updateLoupe,
    copyCurrentColor,
    cycleColorMode,
  }
}
