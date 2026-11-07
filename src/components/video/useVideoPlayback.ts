/*
 * 这个文件负责：VideoPlayer 的**播放控制**——播放/进度/缓冲状态、音量与倍速
 * （记忆设置）、全屏与镜像、菜单弹层、控制栏自动隐藏、进度条悬停预览与拖拽跳转、
 * 屏幕快捷键、抓帧（换集幕布/截图共用一套画布逻辑）、页签切走停播，以及把
 * 音量/静音/倍速落到 <video> 元素上的同步 effect。
 * 原样搬自 VideoPlayer.tsx 的播放控制区块（注释一并带走），按仓库惯例收成
 * Deps 单对象的逻辑 hook：门面 JSX 也要挂的同几块 ref 由门面创建后递进来。
 * 字幕系统在 useVideoSubtitles.ts；换集幕布与对外 imperative handle 留在门面。
 * 门面递进来的 ref 都是稳定引用：被 exhaustive-deps 点名的，补进依赖只为过 lint，
 * 行为不变（同 useTabMark 的做法）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'
import { t } from '../../i18n'
import { formatClock } from '../../video/transcript'
import {
  CENTER_FEEDBACK_MS,
  MUTED_STORAGE_KEY,
  PLAYBACK_RATE_STORAGE_KEY,
  VOLUME_STORAGE_KEY,
  readStoredMuted,
  readStoredRate,
  readStoredVolume,
} from './videoPlayerShared'

/** 播放控制需要宿主提供的最小能力 */
export interface VideoPlaybackDeps {
  /** 视频源地址：把音量/静音/倍速重新落上去的同步 effect 依赖它 */
  src: string
  /** 页签此刻是否激活：视频页签 keepalive 只藏不卸，藏起来的时候必须停播 */
  active: boolean
  /** 入参预估总时长（毫秒）：元数据就绪前先拿它当总长用 */
  propDurationMs?: number
  /** 截图文件名用的标题 */
  title?: string
  /** 进度条拖拽/点击跳转后回传当前时刻（毫秒） */
  onSeeked?: (currentMs: number) => void
  /** 主 <video> 元素挂点：门面 JSX 也要挂（仓库惯例：ref 由门面创建后递进来） */
  videoRef: RefObject<HTMLVideoElement | null>
  /** 播放器根容器挂点：全屏挂在它身上，自身尺寸监听也量它 */
  containerRef: RefObject<HTMLDivElement | null>
  /** 进度条交互区挂点：拖拽/点击 seek 按它的实测矩形换算 */
  progressBarRef: RefObject<HTMLDivElement | null>
  /** 离屏预览视频挂点：悬停缩略图从它取帧 */
  previewVideoRef: RefObject<HTMLVideoElement | null>
  /** 悬停帧预览画布挂点 */
  previewCanvasRef: RefObject<HTMLCanvasElement | null>
}

/**
 * 播放控制：返回播放/进度/音量/倍速/全屏/镜像/菜单弹层/反馈提示等状态
 * （含 setter——门面 JSX 的事件处理器直接用）与全部控制回调。
 */
export function useVideoPlayback(
  {
    src,
    active,
    propDurationMs,
    title = '',
    onSeeked,
    videoRef,
    containerRef,
    progressBarRef,
    previewVideoRef,
    previewCanvasRef,
  }: VideoPlaybackDeps,
) {
  // 播放与进度状态
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0) // 单位：秒
  const [duration, setDuration] = useState(() => (propDurationMs && propDurationMs > 0 ? propDurationMs / 1000 : 0))
  const [buffered, setBuffered] = useState(0) // 缓冲至几秒
  const [isBuffering, setIsBuffering] = useState(false)
  const [isControlsVisible, setIsControlsVisible] = useState(true)
  const [videoAspect, setVideoAspect] = useState(16 / 9)

  // 音量与倍速
  const [volume, setVolume] = useState(readStoredVolume)
  const [isMuted, setIsMuted] = useState(readStoredMuted)
  /** 静音态的即时读数：handle 的 getMuted 要读「现在」的值，不等下一次渲染 */
  const isMutedRef = useRef(isMuted)
  useEffect(() => {
    isMutedRef.current = isMuted
  }, [isMuted])
  /** 外部（页签条快捷静音）写静音：与 toggleMute 同一份状态与持久化；元素属性由同步 effect 落下去 */
  const applyMuted = useCallback((muted: boolean) => {
    setIsMuted(muted)
    try {
      localStorage.setItem(MUTED_STORAGE_KEY, muted ? '1' : '0')
    } catch {
      // 忽略
    }
  }, [])
  /**
   * 页签切走就停播：视频页签 keepalive 只藏不卸，display:none 挡不住声音——
   * 离开页签必须显式 pause。回到页签不自动续播，从暂停处接着看由用户自己按。
   */
  useEffect(() => {
    if (active) return
    videoRef.current?.pause()
  }, [active, videoRef])
  const [playbackRate, setPlaybackRate] = useState(readStoredRate)

  // 全屏与镜像
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isMirrored, setIsMirrored] = useState(false)
  /** 进出全屏的短过渡（真实全屏切换是瞬时的，这层只是把跳变抹平） */
  const [fsAnimating, setFsAnimating] = useState(false)
  const fsTimerRef = useRef<number | null>(null)

  // 菜单弹层控制
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false)
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false)
  const [volumeHovered, setVolumeHovered] = useState(false)

  // 播放器自身尺寸（宽、高），确保字幕响应的是播放器尺寸而非屏幕尺寸
  const [playerDimensions, setPlayerDimensions] = useState({ width: 0, height: 0 })

  // 进度条悬停与预览
  const [hoverPercent, setHoverPercent] = useState<number | null>(null)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverPosPx, setHoverPosPx] = useState(0)
  const isDraggingProgress = useRef(false)

  // 反馈与特效
  const [flashActive, setFlashActive] = useState(false)
  const [centerIndicator, setCenterIndicator] = useState<'play' | 'pause' | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const hideTimerRef = useRef<number | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const centerTimerRef = useRef<number | null>(null)
  const lastPreviewSeekTimeRef = useRef<number>(0)

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null)
    }, 2200)
  }, [])

  /**
   * 抓当前帧（dataURL JPEG）：给「切换选集」当过渡幕布用。
   * 与截图同一套画布逻辑（含镜像），只是编码成 JPEG 省内存。
   */
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return null
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      if (isMirrored) {
        ctx.translate(canvas.width, 0)
        ctx.scale(-1, 1)
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/jpeg', 0.7)
    } catch {
      // 画布被跨域污染（不该发生：流走 media-relay 同源）：没有幕布也能用
      return null
    }
  }, [isMirrored, videoRef])

  // 自动重置/同步视频元素属性
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = isMuted
    video.playbackRate = playbackRate
  }, [src, volume, isMuted, playbackRate, videoRef])

  // 监听播放器组件自身尺寸变化（与外部屏幕尺寸解耦）
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return

    const updateSize = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setPlayerDimensions({ width: Math.round(rect.width), height: Math.round(rect.height) })
      }
    }

    updateSize()

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setPlayerDimensions({ width: Math.round(width), height: Math.round(height) })
        }
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])

  // 有效总时长（优先真实元数据，次选入参预估）
  const effectiveDuration = duration > 0 ? duration : (propDurationMs && propDurationMs > 0 ? propDurationMs / 1000 : 0)

  // 控制栏自动隐藏调度
  const scheduleHideControls = useCallback(() => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
    setIsControlsVisible(true)
    if (isPlaying && !speedMenuOpen && !subtitleMenuOpen && !volumeHovered) {
      hideTimerRef.current = window.setTimeout(() => {
        setIsControlsVisible(false)
      }, 2500)
    }
  }, [isPlaying, speedMenuOpen, subtitleMenuOpen, volumeHovered])

  const handleMouseMove = useCallback(() => {
    scheduleHideControls()
  }, [scheduleHideControls])

  const handleMouseLeave = useCallback(() => {
    if (isPlaying && !speedMenuOpen && !subtitleMenuOpen) {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
      setIsControlsVisible(false)
    }
  }, [isPlaying, speedMenuOpen, subtitleMenuOpen])

  // 播放/暂停切换
  const togglePlay = useCallback(() => {
    if (speedMenuOpen || subtitleMenuOpen) {
      setSpeedMenuOpen(false)
      setSubtitleMenuOpen(false)
      return
    }
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play().then(() => {
        setCenterIndicator('play')
        if (centerTimerRef.current) window.clearTimeout(centerTimerRef.current)
        centerTimerRef.current = window.setTimeout(() => setCenterIndicator(null), CENTER_FEEDBACK_MS)
      }).catch(() => {})
    } else {
      video.pause()
      setCenterIndicator('pause')
      if (centerTimerRef.current) window.clearTimeout(centerTimerRef.current)
      centerTimerRef.current = window.setTimeout(() => setCenterIndicator(null), CENTER_FEEDBACK_MS)
    }
    scheduleHideControls()
  }, [scheduleHideControls, speedMenuOpen, subtitleMenuOpen, videoRef])


  // 点击外部区域关闭弹出菜单
  useEffect(() => {
    if (!speedMenuOpen && !subtitleMenuOpen) return
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target?.closest('.group\\/player')) {
        setSpeedMenuOpen(false)
        setSubtitleMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [speedMenuOpen, subtitleMenuOpen])

  // 倍速设置（限制在 0.25 到 3.0 之间）
  const changePlaybackRate = useCallback((rate: number) => {
    const clamped = Math.max(0.25, Math.min(3.0, Math.round(rate * 100) / 100))
    const video = videoRef.current
    if (video) video.playbackRate = clamped
    setPlaybackRate(clamped)
    try {
      localStorage.setItem(PLAYBACK_RATE_STORAGE_KEY, String(clamped))
    } catch {
      // 忽略
    }
    showToast(t('播放倍速：{0}x', String(clamped)))
    setSpeedMenuOpen(false)
  }, [showToast, videoRef])

  // 音量调节
  const changeVolume = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(1, val))
    const video = videoRef.current
    if (video) {
      video.volume = clamped
      if (clamped > 0 && video.muted) {
        video.muted = false
        setIsMuted(false)
      }
    }
    setVolume(clamped)
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped))
    } catch {
      // 忽略
    }
  }, [videoRef])

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const nextMuted = !video.muted
    video.muted = nextMuted
    setIsMuted(nextMuted)
    try {
      localStorage.setItem(MUTED_STORAGE_KEY, nextMuted ? '1' : '0')
    } catch {
      // 忽略
    }
    if (!nextMuted && volume === 0) {
      changeVolume(0.5)
    }
    showToast(nextMuted ? t('已静音') : t('已取消静音'))
  }, [changeVolume, volume, showToast, videoRef])

  // 全屏切换
  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current
    if (!container) return
    try {
      if (!document.fullscreenElement) {
        await container.requestFullscreen()
        setIsFullscreen(true)
      } else {
        await document.exitFullscreen()
        setIsFullscreen(false)
      }
    } catch (err) {
      console.warn('Fullscreen toggle failed', err)
    }
  }, [containerRef])

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
      setFsAnimating(true)
      if (fsTimerRef.current) window.clearTimeout(fsTimerRef.current)
      fsTimerRef.current = window.setTimeout(() => setFsAnimating(false), 320)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      if (fsTimerRef.current) window.clearTimeout(fsTimerRef.current)
    }
  }, [])

  // 水平镜像翻转
  const toggleMirror = useCallback(() => {
    setIsMirrored((v) => {
      const next = !v
      showToast(next ? t('画面已开启水平镜像') : t('画面已恢复正常'))
      return next
    })
  }, [showToast])

  // 截图当前帧
  const takeScreenshot = useCallback(() => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      showToast(t('视频尚未就绪，无法截图'))
      return
    }

    // 快门闪光效果
    setFlashActive(true)
    window.setTimeout(() => setFlashActive(false), 200)

    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      if (isMirrored) {
        ctx.translate(canvas.width, 0)
        ctx.scale(-1, 1)
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      // 尝试写入剪贴板
      canvas.toBlob((blob) => {
        if (blob && navigator.clipboard && window.ClipboardItem) {
          try {
            void navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
          } catch {
            // 忽略剪贴板写入失败
          }
        }
      }, 'image/png')

      // 触发下载文件
      const safeTitle = (title || 'video').replace(/[\\/:*?"<>|]/g, '_')
      const clockStr = formatClock(currentTime * 1000).replace(/:/g, '-')
      const filename = `${safeTitle}_${clockStr}.png`
      const url = canvas.toDataURL('image/png')
      const a = document.createElement('a')
      a.download = filename
      a.href = url
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)

      showToast(t('截图已保存并复制到剪贴板'))
    } catch (err) {
      console.warn('Screenshot error', err)
      showToast(t('截图失败：{0}', String(err)))
    }
  }, [currentTime, isMirrored, showToast, title, videoRef])

  // 进度条拖拽与跳转
  const seekToPosition = useCallback(
    (clientX: number) => {
      const bar = progressBarRef.current
      const video = videoRef.current
      if (!bar || !video || effectiveDuration <= 0) return
      const rect = bar.getBoundingClientRect()
      const clickX = Math.max(0, Math.min(rect.width, clientX - rect.left))
      const percent = clickX / rect.width
      const targetSec = percent * effectiveDuration
      video.currentTime = targetSec
      setCurrentTime(targetSec)
      if (onSeeked) onSeeked(targetSec * 1000)
    },
    [effectiveDuration, onSeeked, progressBarRef, videoRef],
  )

  const handleProgressMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      isDraggingProgress.current = true
      seekToPosition(e.clientX)

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (isDraggingProgress.current) {
          seekToPosition(moveEvent.clientX)
        }
      }
      const onMouseUp = () => {
        isDraggingProgress.current = false
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
        window.removeEventListener('blur', onMouseUp)
      }
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
      // 拖到一半窗口被切走：没有 mouseup 可等，就地收尾（否则两条监听会一直挂着）
      window.addEventListener('blur', onMouseUp)
    },
    [seekToPosition],
  )

  // 进度条悬停与缩略图预览
  const handleProgressMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const bar = progressBarRef.current
      if (!bar || effectiveDuration <= 0) return
      const rect = bar.getBoundingClientRect()
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
      const percent = x / rect.width
      const timeSec = percent * effectiveDuration
      setHoverPercent(percent)
      setHoverTime(timeSec)

      // 缩略图浮层宽度 160px，居中偏移需保留边界避免被裁切
      const tooltipHalfWidth = 84
      const clampedX =
        rect.width > tooltipHalfWidth * 2
          ? Math.max(tooltipHalfWidth, Math.min(rect.width - tooltipHalfWidth, x))
          : rect.width / 2
      setHoverPosPx(clampedX)

      // 节流给离屏预览视频 seek（不带加载态：seek 是异步的，加载图标会在滑动时一路闪）
      const now = Date.now()
      if (now - lastPreviewSeekTimeRef.current > 80) {
        lastPreviewSeekTimeRef.current = now
        const pVid = previewVideoRef.current
        if (pVid && Number.isFinite(timeSec)) pVid.currentTime = timeSec
      }
    },
    [effectiveDuration, previewVideoRef, progressBarRef],
  )

  const handleProgressMouseLeave = useCallback(() => {
    setHoverPercent(null)
    setHoverTime(null)
  }, [])

  // 当离屏预览视频 seek 完毕时，将画面绘制在 previewCanvasRef
  const handlePreviewVideoSeeked = useCallback(() => {
    const pVid = previewVideoRef.current
    const canvas = previewCanvasRef.current
    if (!pVid || !canvas || !pVid.videoWidth) return
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(pVid, 0, 0, canvas.width, canvas.height)
    }
  }, [previewCanvasRef, previewVideoRef])

  // 键盘快捷键监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 如果焦点在输入框或文本域中，不拦截快捷键
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }

      const video = videoRef.current
      if (!video) return

      switch (e.code) {
        case 'Space':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          e.preventDefault()
          video.currentTime = Math.max(0, video.currentTime - 5)
          showToast(t('快退 5 秒'))
          break
        case 'ArrowRight':
          e.preventDefault()
          video.currentTime = Math.min(video.duration || effectiveDuration, video.currentTime + 5)
          showToast(t('快进 5 秒'))
          break
        case 'ArrowUp':
          e.preventDefault()
          changeVolume(Math.min(1, volume + 0.05))
          break
        case 'ArrowDown':
          e.preventDefault()
          changeVolume(Math.max(0, volume - 0.05))
          break
        case 'KeyM':
          e.preventDefault()
          toggleMute()
          break
        case 'KeyF':
          e.preventDefault()
          void toggleFullscreen()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [changeVolume, effectiveDuration, toggleFullscreen, toggleMute, togglePlay, volume, showToast, videoRef])

  return {
    // 播放与进度
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    setDuration,
    buffered,
    setBuffered,
    isBuffering,
    setIsBuffering,
    isControlsVisible,
    setIsControlsVisible,
    videoAspect,
    setVideoAspect,
    effectiveDuration,
    // 音量与倍速
    volume,
    isMuted,
    /** 静音态的即时读数：handle 的 getMuted 用 */
    isMutedRef,
    applyMuted,
    playbackRate,
    // 全屏与镜像
    isFullscreen,
    isMirrored,
    fsAnimating,
    toggleFullscreen,
    toggleMirror,
    // 菜单弹层
    speedMenuOpen,
    setSpeedMenuOpen,
    subtitleMenuOpen,
    setSubtitleMenuOpen,
    volumeHovered,
    setVolumeHovered,
    // 字幕布局
    playerDimensions,
    // 进度条悬停与拖拽
    hoverPercent,
    hoverTime,
    hoverPosPx,
    handleProgressMouseDown,
    handleProgressMouseMove,
    handleProgressMouseLeave,
    handlePreviewVideoSeeked,
    // 反馈与特效
    flashActive,
    centerIndicator,
    setCenterIndicator,
    toastMessage,
    showToast,
    // 控制回调
    scheduleHideControls,
    handleMouseMove,
    handleMouseLeave,
    togglePlay,
    changePlaybackRate,
    changeVolume,
    toggleMute,
    takeScreenshot,
    // 抓帧（门面拼 imperative handle 用）
    captureFrame,
  }
}
