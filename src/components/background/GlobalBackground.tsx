/**
 * 全局图片背景与幻灯片播放组件。
 *
 * 挂载在应用视口最底层（z-0 / fixed inset-0），UI 各面板降低透明度以透出背景。
 * 支持单张壁纸、图组轮播播放（顺序/随机）、平滑淡入淡出补间过渡、
 * 缩放填充策略（cover/contain/center/repeat）、高斯模糊与暗度遮罩。
 */

import { useEffect, useRef, useState } from 'react'
import { DEFAULT_CUSTOM_BACKGROUND, type CustomBackgroundConfig } from '../../lib/customBackground'

interface Props {
  customBg?: CustomBackgroundConfig
  isDark?: boolean
}

export default function GlobalBackground({ customBg }: Props) {
  const isEnabled = Boolean(customBg?.enabled)
  const cfg = customBg ?? DEFAULT_CUSTOM_BACKGROUND

  const {
    mode,
    singleImageUrl,
    activeGroupId,
    groups,
    slideshowInterval,
    slideshowOrder,
    fit = 'cover',
    blur = 0,
  } = cfg

  // 提取当前图组中的图片列表
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0]
  const groupImages = activeGroup?.images ?? []

  // 当前播放的图片索引
  const [currentIndex, setCurrentIndex] = useState(0)

  // 决定当前主展示的图片 URL
  let targetUrl = singleImageUrl
  if (mode === 'slideshow' && groupImages.length > 0) {
    const safeIdx = currentIndex % groupImages.length
    targetUrl = groupImages[safeIdx]?.url || singleImageUrl
  }

  // 双层交叉淡入淡出（Cross-fade）状态管理：A 层与 B 层
  const [layers, setLayers] = useState<{
    front: 'a' | 'b'
    urlA: string
    urlB: string
  }>({
    front: 'a',
    urlA: targetUrl,
    urlB: targetUrl,
  })

  // 当目标 URL 变动时，平滑换层过渡
  useEffect(() => {
    if (!isEnabled) return
    setLayers((prev) => {
      if (prev.front === 'a') {
        if (prev.urlA === targetUrl) return prev
        return { front: 'b', urlA: prev.urlA, urlB: targetUrl }
      } else {
        if (prev.urlB === targetUrl) return prev
        return { front: 'a', urlA: targetUrl, urlB: prev.urlB }
      }
    })
  }, [isEnabled, targetUrl])

  // 幻灯片定时器驱动
  const timerRef = useRef<number | null>(null)
  useEffect(() => {
    if (!isEnabled || mode !== 'slideshow' || groupImages.length <= 1) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }

    const intervalMs = Math.max(5000, (slideshowInterval || 60) * 1000)

    timerRef.current = window.setInterval(() => {
      setCurrentIndex((prev) => {
        if (slideshowOrder === 'random' && groupImages.length > 1) {
          let next = Math.floor(Math.random() * groupImages.length)
          while (next === prev % groupImages.length) {
            next = Math.floor(Math.random() * groupImages.length)
          }
          return next
        }
        return (prev + 1) % groupImages.length
      })
    }, intervalMs)

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [isEnabled, mode, slideshowInterval, slideshowOrder, groupImages.length])

  if (!isEnabled) return null

  // 背景样式计算（根据 fit 策略）
  const getBackgroundStyle = (url: string, isVisible: boolean) => {
    const bgStyle: React.CSSProperties = {
      backgroundImage: url ? `url("${url}")` : undefined,
      opacity: isVisible ? 1 : 0,
      transition: 'opacity 1200ms cubic-bezier(0.4, 0, 0.2, 1)',
      filter: blur > 0 ? `blur(${blur}px)` : undefined,
      // 模糊边缘扩展，消除全屏滤镜白边
      transform: blur > 0 ? 'scale(1.05)' : 'none',
    }

    if (fit === 'cover') {
      bgStyle.backgroundSize = 'cover'
      bgStyle.backgroundPosition = 'center center'
      bgStyle.backgroundRepeat = 'no-repeat'
    } else if (fit === 'contain') {
      bgStyle.backgroundSize = 'contain'
      bgStyle.backgroundPosition = 'center center'
      bgStyle.backgroundRepeat = 'no-repeat'
    } else if (fit === 'repeat') {
      bgStyle.backgroundSize = 'auto'
      bgStyle.backgroundPosition = 'top left'
      bgStyle.backgroundRepeat = 'repeat'
    } else {
      // center 原尺寸居中
      bgStyle.backgroundSize = 'auto'
      bgStyle.backgroundPosition = 'center center'
      bgStyle.backgroundRepeat = 'no-repeat'
    }

    return bgStyle
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden select-none"
    >
      {/* 图层 A */}
      <div
        className="absolute inset-0 h-full w-full will-change-[opacity]"
        style={getBackgroundStyle(layers.urlA, layers.front === 'a')}
      />

      {/* 图层 B（用于交叉淡入淡出） */}
      <div
        className="absolute inset-0 h-full w-full will-change-[opacity]"
        style={getBackgroundStyle(layers.urlB, layers.front === 'b')}
      />
    </div>
  )
}
