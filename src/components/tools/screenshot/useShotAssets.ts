/**
 * useShotAssets.ts — 截图画布离屏资源与原图预加载
 * 职责：预加载原始截图到 <img> 与离屏 canvas（取色放大镜 / 马赛克取样 / 最终导出的像素源），
 * 维护 isLoaded 首帧就绪标记与 drawMainRef 晚绑定挂点（主画布渲染器由 useShotRender 回填）。
 */
import { useEffect, useRef, useState } from 'react'

export interface ShotAssetsDeps {
  imageSrc: string
  onReady?: () => void
}

export interface ShotAssetsState {
  // 画布与离屏资源
  /** 离屏原图画布：放大镜取样、马赛克取样与最终导出的像素来源 */
  offscreenCanvasRef: React.RefObject<HTMLCanvasElement | null>
  imageElementRef: React.RefObject<HTMLImageElement | null>
  isLoaded: boolean
  /** 晚绑定挂点：主画布渲染函数由 useShotRender 回填，首帧就绪后在这里调用 */
  drawMainRef: React.RefObject<() => void>
}

export function useShotAssets(deps: ShotAssetsDeps): ShotAssetsState {
  const { imageSrc, onReady } = deps
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageElementRef = useRef<HTMLImageElement | null>(null)
  const drawMainRef = useRef<() => void>(() => {})
  const [isLoaded, setIsLoaded] = useState(false)

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
        drawMainRef.current?.()
        onReady?.()
      })
    }
    return () => {
      active = false
    }
  }, [imageSrc, onReady])

  return {
    offscreenCanvasRef,
    imageElementRef,
    isLoaded,
    drawMainRef,
  }
}
