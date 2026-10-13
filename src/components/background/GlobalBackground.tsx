/**
 * 全局图片背景与幻灯片播放组件。
 *
 * 挂载在应用视口最底层（z-0 / fixed inset-0），UI 各面板降低透明度以透出背景。
 * 支持单张壁纸、图组轮播播放（顺序/随机）、平滑淡入淡出补间过渡、
 * 缩放填充策略（cover/contain/center/repeat）、高斯模糊与暗度遮罩。
 *
 * 配置里存的是**地址**（`preset:` / `asset:` / 外链），不是图片本身（见 lib/customBackground
 * 的文件头）。所以这里先把整组的地址解析成能直接用的 src 再画——**整组一起解析**，
 * 而不是轮到哪张才读哪张：轮播每隔几十秒换一张，那时才去读盘会看得见一次白闪，
 * 而一整组也就三五张。
 */

import { useEffect, useRef, useState } from 'react'
import { DEFAULT_CUSTOM_BACKGROUND, type CustomBackgroundConfig } from '../../lib/customBackground'
import { useBackgroundSrcs } from './useBackgroundSrc'

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

  /*
   * 把这一组地址解析成能画的 src（见 useBackgroundSrcs：它按「一组地址」缓存结果）。
   * 单张模式也得把图组的地址一并解出来——用户随时可能切到幻灯片，而多解几张
   * 只是几个文件的读取，换来的是一次切换不必等。
   */
  const srcMap = useBackgroundSrcs([
    singleImageUrl,
    ...groupImages.map((img) => img.url),
  ])
  /** 地址 → 能画的 src；解析不出来的（文件没了）当作没有这张 */
  const srcOf = (url: string): string => (url ? (srcMap[url] ?? '') : '')

  // 当前播放的图片索引
  const [currentIndex, setCurrentIndex] = useState(0)

  // 决定当前主展示的图片地址（还没解析出来时为空串，两层都不画，就是一片空底）
  let targetUrl = srcOf(singleImageUrl)
  if (mode === 'slideshow' && groupImages.length > 0) {
    const safeIdx = currentIndex % groupImages.length
    targetUrl = srcOf(groupImages[safeIdx]?.url ?? '') || targetUrl
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
