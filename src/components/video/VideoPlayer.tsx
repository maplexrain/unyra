/**
 * 自定义视频播放器组件 (VideoPlayer)
 *
 * 功能特性：
 * 1. 基础播放控制：播放/暂停、进度跳转、缓冲进度、时间展示 (当前/总长)；
 * 2. 倍速调节：最低 0.25x，最高 3.0x，支持预设项选择与微调，记忆设置；
 * 3. 音量调节：静音切换、平滑滑动调节，记忆音量设置；
 * 4. 全屏与快捷键：全屏切换、双击全屏、空格播放暂停、方向键快进快退与音量；
 * 5. 外挂字幕：支持导入 .srt, .vtt, .json 字幕，内置/外挂切换，时间轴微调 (-1s ~ +1s)，屏幕字幕渲染；
 * 6. 进度条悬停预览：实时计算悬停时间戳，离屏绘制 16:9 视频帧缩略图预览；
 * 7. 画面截图：全分辨率当前帧截图，自动下载并写入剪贴板，带快门闪光反馈；
 * 8. 画面镜像：水平翻转画面（舞蹈/教学/手势学习必备），不影响字幕与 UI 控件；
 * 9. 界面美化：磨砂暗色渐变、控制栏无操作 2.5 秒平滑自动隐藏、大尺寸中心播放指示器、Toast 交互提示。
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import {
  Camera,
  Captions,
  Check,
  FlipHorizontal,
  Loader2,
  Maximize,
  Minimize,
  ListVideo,
  Pause,
  Play,
  RotateCcw,
  Upload,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { t } from '../../i18n'
import { formatClock } from '../../video/transcript'
import {
  calculateSubtitleLayout,
  findActiveSubtitle,
  parseSubtitleFile,
  SUBTITLE_HARD_TEXT_SHADOW,
  toTranscript,
} from '../../video/subtitles'
import type { Transcript, TranscriptSegment } from '../../video/types'
import type { VideoChapter } from '../../learn/types'

export interface VideoPlayerProps {
  src: string
  title?: string
  /** 顶部标题的副行：当前选集 / 分 P（可空） */
  subLabel?: string
  durationMs?: number
  transcript?: Transcript | null
  onTimeUpdate?: (currentMs: number) => void
  onSeeked?: (currentMs: number) => void
  onExternalSubtitleLoaded?: (transcript: Transcript) => void
  /**
   * 右侧悬浮面板（合集 / 选集列表）。挂在**播放器根容器里**——全屏时也能打开，
   * 这是它不进外层布局的原因（全屏只显示 containerRef 的子树）。
   */
  sidePanel?: React.ReactNode
  /**
   * 切换选集时的「冻结帧」幕布：token 变化即显示 src（上一集的最后一帧），
   * 新流首帧就绪（loadeddata）后淡出。只影响视觉，不参与播放逻辑。
   */
  transitionStill?: { token: string; src: string } | null
  /** 底部控件栏的「选集 / 合集列表」开关（没有列表时不传，按钮不画） */
  onToggleSidePanel?: () => void
  /** 列表此刻是否展开（决定按钮高亮与提示语） */
  sidePanelOpen?: boolean
  /** 页签此刻是否激活：视频页签 keepalive 只藏不卸，藏起来的时候必须停播 */
  active?: boolean
  /**
   * 当前来源的 AI 语义分段（「视频分段」，见 learn/video/summarize）：
   * 进度条上的分段点——点一下跳到那段开头，悬停给这一段的内容概述；
   * 悬停预览落进某一段之内时，预览下方显示那段标题。
   */
  chapters?: VideoChapter[] | null
  className?: string
}

export interface VideoPlayerHandle {
  seekMs: (ms: number) => void
  /** 抓当前画面为 dataURL：切换选集前冻结上一帧，盖住新流首帧到来前的黑屏 */
  captureFrame: () => string | null
  play: () => Promise<void>
  pause: () => void
  getVideoElement: () => HTMLVideoElement | null
  /** 读静音态（页签条快捷按钮用；与播放器按钮、持久化是同一份状态） */
  getMuted: () => boolean
  /** 写静音态：进状态机，元素属性由同步 effect 落下去 */
  setMuted: (muted: boolean) => void
}

const SPEED_PRESETS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0]
/** 中心播放/暂停气泡的完整时长（与 motion.css 的 moji-center-pop 对齐：淡入+停留+淡出） */
const CENTER_FEEDBACK_MS = 700
const VOLUME_STORAGE_KEY = 'moji.video.volume'
const MUTED_STORAGE_KEY = 'moji.video.muted'
const PLAYBACK_RATE_STORAGE_KEY = 'moji.video.playbackRate'

const readStoredVolume = (): number => {
  try {
    const v = localStorage.getItem(VOLUME_STORAGE_KEY)
    if (v !== null) {
      const num = parseFloat(v)
      if (Number.isFinite(num) && num >= 0 && num <= 1) return num
    }
  } catch {
    // 忽略
  }
  return 1
}

const readStoredMuted = (): boolean => {
  try {
    return localStorage.getItem(MUTED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const readStoredRate = (): number => {
  try {
    const r = localStorage.getItem(PLAYBACK_RATE_STORAGE_KEY)
    if (r !== null) {
      const num = parseFloat(r)
      if (Number.isFinite(num) && num >= 0.25 && num <= 3.0) return num
    }
  } catch {
    // 忽略
  }
  return 1.0
}

const SUBTITLE_SCALE_STORAGE_KEY = 'moji.video.subtitleScale'
const readStoredSubtitleScale = (): number => {
  try {
    const s = localStorage.getItem(SUBTITLE_SCALE_STORAGE_KEY)
    if (s !== null) {
      const num = parseFloat(s)
      if (Number.isFinite(num) && num >= 0.5 && num <= 2.5) return num
    }
  } catch {
    // 忽略
  }
  return 0.8
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer(
    {
      src,
      title = '',
      subLabel,
      durationMs: propDurationMs,
      transcript,
      onTimeUpdate,
      onSeeked,
      onExternalSubtitleLoaded,
      sidePanel,
      transitionStill,
      onToggleSidePanel,
      sidePanelOpen = false,
      active = true,
      chapters,
      className = '',
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const previewVideoRef = useRef<HTMLVideoElement | null>(null)
    const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)
    const progressBarRef = useRef<HTMLDivElement | null>(null)
    const fileInputRef = useRef<HTMLInputElement | null>(null)

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
    }, [active])
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

    // 字幕系统
    const [subtitleTrack, setSubtitleTrack] = useState<'off' | 'builtin' | 'external'>('builtin')
    const [externalSegments, setExternalSegments] = useState<TranscriptSegment[]>([])
    const [externalName, setExternalName] = useState<string>('')
    const [subtitleOffsetMs, setSubtitleOffsetMs] = useState(0) // 字幕时间偏移
    const [subtitleScale, setSubtitleScale] = useState(readStoredSubtitleScale) // 字幕字号缩放倍率

    // 进度条悬停与预览
    const [hoverPercent, setHoverPercent] = useState<number | null>(null)
    const [hoverTime, setHoverTime] = useState<number | null>(null)
    const [hoverPosPx, setHoverPosPx] = useState(0)
    const isDraggingProgress = useRef(false)

    // 反馈与特效
    const [flashActive, setFlashActive] = useState(false)
    const [centerIndicator, setCenterIndicator] = useState<'play' | 'pause' | null>(null)
    const [toastMessage, setToastMessage] = useState<string | null>(null)

    /** 换集幕布（冻结上一帧）：token 变了才换图；新流首帧到了再淡出 */
    const [still, setStill] = useState<{ token: string; src: string } | null>(null)
    const [stillFading, setStillFading] = useState(false)
    const stillRef = useRef<{ token: string; src: string } | null>(null)
    const stillTokenRef = useRef('')

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
    }, [isMirrored])

    // 暴露给父组件的引用方法
    useImperativeHandle(
      ref,
      () => ({
        captureFrame,
        seekMs: (ms: number) => {
          const video = videoRef.current
          if (!video) return
          const targetSec = Math.max(0, ms / 1000)
          video.currentTime = targetSec
          setCurrentTime(targetSec)
          void video.play().catch(() => {})
        },
        play: async () => {
          if (videoRef.current) await videoRef.current.play()
        },
        pause: () => {
          if (videoRef.current) videoRef.current.pause()
        },
        getVideoElement: () => videoRef.current,
        getMuted: () => isMutedRef.current,
        setMuted: applyMuted,
      }),
      [captureFrame, applyMuted],
    )

    /**
     * 父组件传来幕布：**只排队，不立刻显示**。点击下一集时旧画面还在播，
     * 提前盖上就成了「画面冻住 1~2 秒」；等 src 真正切换那一刻（见下）再亮出来。
     */
    const pendingStillRef = useRef<{ token: string; src: string } | null>(null)
    useEffect(() => {
      if (transitionStill) pendingStillRef.current = transitionStill
    }, [transitionStill])

    /** 新流首帧就绪后淡出幕布；重复调用无害 */
    const releaseStill = useCallback(() => {
      if (!stillRef.current) return
      stillRef.current = null
      setStillFading(true)
      window.setTimeout(() => {
        setStill(null)
        setStillFading(false)
      }, 220)
    }, [])

    /** 兜底：流卡住时别让幕布永久盖着画面（8 秒） */
    useEffect(() => {
      if (!still) return
      const timer = window.setTimeout(() => releaseStill(), 8000)
      return () => window.clearTimeout(timer)
    }, [still, releaseStill])

    /**
     * 换流（切换选集 / 换来源）：**在同一只 <video> 上重载**，不重建组件——
     * 全屏状态挂在容器上，容器一重建浏览器就退出全屏。这里手动 load + 起播，
     * 补上原先靠 autoPlay 起播的那一份行为。
     */
    const prevSrcRef = useRef(src)
    useEffect(() => {
      if (prevSrcRef.current === src) return
      prevSrcRef.current = src
      const video = videoRef.current
      if (!video) return
      // 幕布就在这一刻亮出来：新 src 已挂上、首帧还没到，正是不该看见黑屏的窗口
      const pending = pendingStillRef.current
      if (pending && pending.token !== stillTokenRef.current) {
        stillTokenRef.current = pending.token
        stillRef.current = pending
        setStill(pending)
        setStillFading(false)
      }
      setCurrentTime(0)
      setBuffered(0)
      setCenterIndicator(null)
      // 外挂字幕属于上一集：换流时清掉，免得把别人的字幕挂在新集上
      setExternalSegments([])
      setExternalName('')
      setSubtitleOffsetMs(0)
      setSubtitleTrack((mode) => (mode === 'external' ? 'builtin' : mode))
      video.load()
      void video.play().catch(() => {
        // 浏览器可能拦自动播放：留着暂停态，用户点一下即可
      })
    }, [src])

    // 自动重置/同步视频元素属性
    useEffect(() => {
      const video = videoRef.current
      if (!video) return
      video.volume = volume
      video.muted = isMuted
      video.playbackRate = playbackRate
    }, [src, volume, isMuted, playbackRate])

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
    }, [])

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
    }, [scheduleHideControls, speedMenuOpen, subtitleMenuOpen])

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
    }, [showToast])

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
    }, [])

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
    }, [changeVolume, volume, showToast])

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
    }, [])

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
    }, [currentTime, isMirrored, showToast, title])

    // 字幕字号缩放微调
    const changeSubtitleScale = useCallback((scale: number) => {
      setSubtitleScale(scale)
      try {
        localStorage.setItem(SUBTITLE_SCALE_STORAGE_KEY, String(scale))
      } catch {
        // 忽略
      }
      showToast(t('字幕大小：{0}x', String(scale)))
    }, [showToast])

    // 导入外挂字幕文件 (.srt / .vtt / .json)
    const handleSubtitleFile = useCallback(
      (file: File) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          const content = String(e.target?.result ?? '')
          const parsed = parseSubtitleFile(content, file.name)
          if (!parsed.length) {
            showToast(t('未从文件中解析出有效字幕'))
            return
          }
          setExternalSegments(parsed)
          setExternalName(file.name)
          setSubtitleTrack('external')
          setSubtitleOffsetMs(0)
          showToast(t('成功载入外挂字幕：共 {0} 条', String(parsed.length)))

          if (onExternalSubtitleLoaded) {
            onExternalSubtitleLoaded(toTranscript(parsed, file.name))
          }
        }
        reader.onerror = () => {
          showToast(t('读取字幕文件失败'))
        }
        reader.readAsText(file, 'utf-8')
      },
      [onExternalSubtitleLoaded, showToast],
    )

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
      [effectiveDuration, onSeeked],
    )

    const handleProgressMouseDown = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
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
      (e: React.MouseEvent<HTMLDivElement>) => {
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
      [effectiveDuration],
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
    }, [])

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
    }, [changeVolume, effectiveDuration, toggleFullscreen, toggleMute, togglePlay, volume, showToast])

    // 计算当前应当显示的字幕
    const activeSegments: TranscriptSegment[] =
      subtitleTrack === 'external'
        ? externalSegments
        : subtitleTrack === 'builtin' && transcript?.segments
          ? transcript.segments
          : []
    const currentMs = currentTime * 1000
    const activeCue =
      subtitleTrack !== 'off'
        ? findActiveSubtitle(activeSegments, currentMs, subtitleOffsetMs)
        : null

    // 进度条百分比
    const currentPercent = effectiveDuration > 0 ? (currentTime / effectiveDuration) * 100 : 0
    const bufferedPercent = effectiveDuration > 0 ? (buffered / effectiveDuration) * 100 : 0

    /*
     * 悬停时刻落在哪个分段之内（progress bar 预览下方的分段标题）：
     * startMs <= 悬停时刻 < 下一段的 startMs（最后一段到片尾）。
     */
    const hoverChapter =
      chapters && hoverTime != null && chapters.length
        ? (chapters.find((ch, i) => {
            const ms = hoverTime * 1000
            return ms >= ch.startMs && (i === chapters.length - 1 || ms < chapters[i + 1].startMs)
          }) ?? null)
        : null

    // 根据播放器自身尺寸（宽、高与视频画面比例）精确计算字幕字号与定位
    const subtitleLayout = calculateSubtitleLayout(
      playerDimensions.width,
      playerDimensions.height,
      isControlsVisible,
      videoAspect,
      subtitleScale,
    )

    return (
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ containerType: 'inline-size' }}
        className={`group/player relative flex h-full w-full select-none items-center justify-center overflow-hidden bg-black text-white ${
          isFullscreen && !isControlsVisible ? 'cursor-none' : ''
        } ${fsAnimating ? 'moji-fs-in' : ''} ${className}`}
      >
        {/* 快门闪光层 */}
        <div
          className={`pointer-events-none absolute inset-0 z-40 bg-white transition-opacity duration-200 ${
            flashActive ? 'opacity-70' : 'opacity-0'
          }`}
        />

        {/* 顶部浮动 Toast 提示 */}
        {toastMessage && (
          <div className="pointer-events-none absolute top-4 z-40 flex items-center justify-center transition-all duration-200 animate-in fade-in slide-in-from-top-2">
            <span className="rounded-full border border-white/15 bg-black/75 px-3 py-1 text-[11.5px] font-medium text-white shadow-lg backdrop-blur-md">
              {toastMessage}
            </span>
          </div>
        )}

        {/* 主视频元素 */}
        <video
          ref={videoRef}
          src={src}
          crossOrigin="anonymous"
          playsInline
          autoPlay
          style={{ transform: isMirrored ? 'scaleX(-1)' : 'none' }}
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
          onPlay={() => {
            setIsPlaying(true)
            scheduleHideControls()
          }}
          onPause={() => {
            setIsPlaying(false)
            setIsControlsVisible(true)
          }}
          onTimeUpdate={(e) => {
            const cur = e.currentTarget.currentTime
            setCurrentTime(cur)
            if (onTimeUpdate) onTimeUpdate(cur * 1000)
          }}
          onSeeked={(e) => {
            const cur = e.currentTarget.currentTime
            setCurrentTime(cur)
            if (onSeeked) onSeeked(cur * 1000)
          }}
          onLoadedData={() => releaseStill()}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration
            if (Number.isFinite(d) && d > 0) setDuration(d)
            if (e.currentTarget.videoWidth && e.currentTarget.videoHeight) {
              setVideoAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight)
            }
          }}
          onDurationChange={(e) => {
            const d = e.currentTarget.duration
            if (Number.isFinite(d) && d > 0) setDuration(d)
          }}
          onProgress={(e) => {
            const v = e.currentTarget
            if (v.buffered.length > 0) {
              setBuffered(v.buffered.end(v.buffered.length - 1))
            }
          }}
          onWaiting={() => setIsBuffering(true)}
          onPlaying={() => setIsBuffering(false)}
          onCanPlay={() => setIsBuffering(false)}
          className="h-full w-full object-contain"
        />

        {/* 换集幕布：盖住新流首帧到来前的黑屏（z-10：在视频之上、控件与字幕之下） */}
        {still && (
          <img
            src={still.src}
            alt=""
            aria-hidden="true"
            className={
              'pointer-events-none absolute inset-0 z-10 h-full w-full object-contain transition-opacity duration-200 ' +
              (stillFading ? 'opacity-0' : 'opacity-100')
            }
          />
        )}

        {/* 隐藏的离屏预览视频（用于进度条悬停帧预览） */}
        <video
          ref={previewVideoRef}
          src={src}
          crossOrigin="anonymous"
          preload="auto"
          muted
          onSeeked={handlePreviewVideoSeeked}
          className="hidden pointer-events-none"
        />

        {/* 缓冲等待加载指示器 */}
        {isBuffering && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/20">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 backdrop-blur-xs">
              <Loader2 size={24} className="animate-spin text-white" />
            </div>
          </div>
        )}

        {/* 画面中央播放/暂停气泡动画（暂停显示播放图标，起播显示暂停图标） */}
        {centerIndicator && (
          <div className="moji-center-pop pointer-events-none absolute z-30 flex items-center justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/60 shadow-xl backdrop-blur-sm">
              {centerIndicator === 'play' ? (
                <Pause size={32} className="text-white fill-white" />
              ) : (
                <Play size={32} className="ml-1 text-white fill-white" />
              )}
            </div>
          </div>
        )}

        {/* 屏幕字幕显示层（不受视频镜像影响）：跟随播放器自身尺寸自适应缩放，无背景色，使用 text-shadow 绘制不扩散的硬描边 */}
        {activeCue && (
          <div
            style={{
              bottom: `${subtitleLayout.bottomPx}px`,
              maxWidth: `${subtitleLayout.maxTextWidthPx}px`,
              transition: 'bottom 0.2s ease-out',
            }}
            className="pointer-events-none absolute z-20 w-full px-4 text-center"
          >
            <span
              style={{
                fontSize: `${subtitleLayout.fontSizePx}px`,
                lineHeight: 1.35,
                letterSpacing: '0.08em',
                textShadow: SUBTITLE_HARD_TEXT_SHADOW,
              }}
              className="inline-block whitespace-pre-line bg-transparent font-bold tracking-wider text-white"
            >
              {activeCue.text}
            </span>
          </div>
        )}

        {/*
          顶部标题层：当前视频 + 选集副行。
          和底部控件栏**同进同退**——鼠标不动 2.5 秒一起收起（见 scheduleHideControls），
          暂停时保持可见；全屏里同样成立。
        */}
        {(title || subLabel) && (
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/80 via-black/30 to-transparent px-4 pb-8 pt-3 transition-opacity duration-300 ${
              isControlsVisible ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <div className="flex min-w-0 items-baseline gap-2">
              {/* 标题限宽（截断）：把右侧位置让给选集名——长标题不许把选集挤没 */}
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white/95">{title}</span>
              {subLabel && (
                <span className="max-w-[45%] shrink-0 truncate text-[11px] text-white/60">{subLabel}</span>
              )}
            </div>
          </div>
        )}

        {/* 底部控制器渐变背景与控制栏 */}
        <div
          className={`absolute inset-x-0 bottom-0 z-30 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/40 to-transparent pt-12 pb-2 px-3 transition-opacity duration-300 ${
            isControlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 进度条交互区域 */}
          <div
            ref={progressBarRef}
            onMouseDown={handleProgressMouseDown}
            onMouseMove={handleProgressMouseMove}
            onMouseLeave={handleProgressMouseLeave}
            className="group/progress relative flex h-4 w-full cursor-pointer items-center py-1.5"
          >
            {/* 进度条悬停预览浮层 */}
            {hoverPercent !== null && hoverTime !== null && (
              <div
                style={{
                  left: `${hoverPosPx}px`,
                  transform: 'translateX(-50%)',
                }}
                className="pointer-events-none absolute bottom-5 z-40 flex flex-col items-center gap-1"
              >
                {/* 预览缩略图盒子（无加载态：seek 期间沿用上一帧，滑动才不会一路闪） */}
                <div className="relative h-[90px] w-[160px] overflow-hidden rounded-md border border-white/20 bg-black shadow-xl">
                  <canvas
                    ref={previewCanvasRef}
                    width={160}
                    height={90}
                    className="h-full w-full object-cover"
                  />
                </div>
                {/* 悬停时间胶囊 */}
                <span className="rounded bg-black/80 px-1.5 py-0.5 font-mono text-[11px] font-medium text-white shadow backdrop-blur-xs">
                  {formatClock(hoverTime * 1000)}
                </span>
                {/* 落在某个分段之内：预览下方显示那一段的标题 */}
                {hoverChapter && (
                  <span
                    title={hoverChapter.summary}
                    className="max-w-[220px] truncate rounded bg-seal/90 px-1.5 py-0.5 text-[10.5px] font-medium text-white shadow"
                  >
                    {hoverChapter.summary}
                  </span>
                )}
              </div>
            )}

            {/* 进度条轨道底色 */}
            <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-all group-hover/progress:h-1.5">
              {/* 缓冲进度条 */}
              <div
                style={{ width: `${Math.min(100, Math.max(0, bufferedPercent))}%` }}
                className="absolute inset-y-0 left-0 bg-white/35"
              />
              {/* 已播放进度条 */}
              <div
                style={{ width: `${Math.min(100, Math.max(0, currentPercent))}%` }}
                className="absolute inset-y-0 left-0 bg-seal"
              />
            </div>

            {/* 进度条滑块手柄 */}
            <div
              style={{
                left: `${Math.min(100, Math.max(0, currentPercent))}%`,
              }}
              className="absolute -ml-1.5 h-3 w-3 rounded-full bg-seal shadow transition-transform group-hover/progress:scale-125"
            />

            {/* AI 语义分段点：点一下跳到那段开头，悬停给出这一段的内容概述（title 原生提示，零布局风险） */}
            {(chapters ?? []).map((ch) => (
              <button
                key={ch.startMs}
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={() => {
                  const video = videoRef.current
                  if (!video) return
                  video.currentTime = ch.startMs / 1000
                  setCurrentTime(ch.startMs / 1000)
                }}
                title={`${formatClock(ch.startMs)} · ${ch.summary}`}
                style={{
                  left: `${effectiveDuration > 0 ? Math.min(100, Math.max(0, (ch.startMs / (effectiveDuration * 1000)) * 100)) : 0}%`,
                }}
                className="absolute top-1/2 z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border border-white/60 bg-seal shadow transition-transform hover:scale-150"
              />
            ))}
          </div>

          {/* 控制条按钮行 */}
          <div className="mt-1 flex items-center justify-between text-white/90">
            {/* 左侧：播放/暂停与时间显示 */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={togglePlay}
                title={isPlaying ? t('暂停 (空格)') : t('播放 (空格)')}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white/90 transition hover:bg-white/20 hover:text-white"
              >
                {isPlaying ? <Pause size={17} className="fill-white" /> : <Play size={17} className="ml-0.5 fill-white" />}
              </button>

              <div className="flex items-center gap-1 font-mono text-[12px] text-white/80">
                <span className="text-white">{formatClock(currentTime * 1000)}</span>
                <span className="text-white/40">/</span>
                <span>{formatClock(effectiveDuration * 1000)}</span>
              </div>
            </div>

            {/* 右侧功能控制集合 */}
            <div className="flex items-center gap-1.5">
              {/* 选集 / 合集列表开关（用户定的：这就是「视频空间栏」里要放的那个入口） */}
              {onToggleSidePanel && (
                <button
                  type="button"
                  data-video-panel-toggle=""
                  onClick={onToggleSidePanel}
                  title={sidePanelOpen ? t('收起选集列表') : t('展开选集列表')}
                  aria-expanded={sidePanelOpen}
                  className={
                    'flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/20 ' +
                    (sidePanelOpen ? 'bg-white/20 text-seal' : 'text-white/80 hover:text-white')
                  }
                >
                  <ListVideo size={16} />
                </button>
              )}

              {/* 音量控制组 */}
              <div
                onMouseEnter={() => setVolumeHovered(true)}
                onMouseLeave={() => setVolumeHovered(false)}
                className="relative flex items-center"
              >
                <button
                  type="button"
                  onClick={toggleMute}
                  title={isMuted ? t('取消静音 (M)') : t('静音 (M)')}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/20 hover:text-white"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX size={17} />
                  ) : volume < 0.5 ? (
                    <Volume1 size={17} />
                  ) : (
                    <Volume2 size={17} />
                  )}
                </button>

                {/* 音量滑块（悬停展开） */}
                <div
                  className={`flex items-center overflow-hidden transition-all duration-200 ${
                    volumeHovered ? 'w-20 opacity-100 mr-2' : 'w-0 opacity-0'
                  }`}
                >
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => changeVolume(parseFloat(e.target.value))}
                    className="h-1 w-20 cursor-pointer accent-seal"
                    title={t('音量 {0}%', String(Math.round((isMuted ? 0 : volume) * 100)))}
                  />
                </div>
              </div>

              {/* 外挂字幕控制：鼠标经过即展开（用户定的，不再要求点击） */}
              <div
                className="relative"
                onMouseEnter={() => {
                  setSubtitleMenuOpen(true)
                  setSpeedMenuOpen(false)
                }}
                onMouseLeave={() => setSubtitleMenuOpen(false)}
              >
                <button
                  type="button"
                  title={t('字幕设置')}
                  className={`flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-medium transition hover:bg-white/20 ${
                    subtitleTrack !== 'off' ? 'bg-white/15 text-seal font-semibold' : 'text-white/80'
                  }`}
                >
                  <Captions size={15} />
                  <span>{subtitleTrack === 'off' ? t('字幕') : t('字幕开')}</span>
                </button>

                {/* 字幕菜单面板 */}
                {subtitleMenuOpen && (
                  <div className="absolute right-0 bottom-full mb-2 w-52 rounded-xl border border-white/15 bg-card/95 p-2 text-ink shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95">
                    <div className="px-2 py-1 text-[11px] font-semibold text-ink-faint">
                      {t('字幕轨道')}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setSubtitleTrack('off')
                        setSubtitleMenuOpen(false)
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12px] text-ink hover:bg-line/50"
                    >
                      <span>{t('关闭字幕')}</span>
                      {subtitleTrack === 'off' && <Check size={13} className="text-seal" />}
                    </button>

                    {transcript?.segments?.length ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSubtitleTrack('builtin')
                          setSubtitleMenuOpen(false)
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12px] text-ink hover:bg-line/50"
                      >
                        <span className="truncate">
                          {t('内置/转录字幕')}
                          {transcript.language ? ` (${transcript.language})` : ''}
                        </span>
                        {subtitleTrack === 'builtin' && <Check size={13} className="text-seal" />}
                      </button>
                    ) : null}

                    {externalSegments.length ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSubtitleTrack('external')
                          setSubtitleMenuOpen(false)
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12px] text-ink hover:bg-line/50"
                      >
                        <span className="truncate" title={externalName}>
                          {t('外挂：{0}', externalName || t('自定义字幕'))}
                        </span>
                        {subtitleTrack === 'external' && <Check size={13} className="text-seal" />}
                      </button>
                    ) : null}

                    <div className="my-1 border-t border-line/60" />

                    {/* 导入本地外挂字幕按钮 */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] font-medium text-seal hover:bg-seal/10"
                    >
                      <Upload size={13} />
                      <span>{t('导入外挂字幕 (.srt/.vtt)')}</span>
                    </button>

                    {/* 时间轴同步微调 */}
                    {subtitleTrack !== 'off' && (
                      <div className="mt-1 pt-1 border-t border-line/60">
                        <div className="flex items-center justify-between px-2 text-[10.5px] text-ink-faint">
                          <span>{t('时间轴微调')}</span>
                          <span className="font-mono text-seal">
                            {subtitleOffsetMs > 0 ? `+${subtitleOffsetMs}ms` : `${subtitleOffsetMs}ms`}
                          </span>
                        </div>
                        <div className="mt-1 grid grid-cols-4 gap-1 px-1">
                          <button
                            type="button"
                            onClick={() => setSubtitleOffsetMs((v) => v - 500)}
                            className="rounded bg-line/40 py-0.5 text-center font-mono text-[10px] text-ink hover:bg-line"
                          >
                            -0.5s
                          </button>
                          <button
                            type="button"
                            onClick={() => setSubtitleOffsetMs(0)}
                            className="flex items-center justify-center rounded bg-line/40 py-0.5 text-center font-mono text-[10px] text-ink hover:bg-line"
                            title={t('复位')}
                          >
                            <RotateCcw size={10} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setSubtitleOffsetMs((v) => v + 500)}
                            className="rounded bg-line/40 py-0.5 text-center font-mono text-[10px] text-ink hover:bg-line"
                          >
                            +0.5s
                          </button>
                          <button
                            type="button"
                            onClick={() => setSubtitleOffsetMs((v) => v + 1000)}
                            className="rounded bg-line/40 py-0.5 text-center font-mono text-[10px] text-ink hover:bg-line"
                          >
                            +1s
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 字幕字号倍率调节 */}
                    {subtitleTrack !== 'off' && (
                      <div className="mt-1 pt-1 border-t border-line/60">
                        <div className="flex items-center justify-between px-2 text-[10.5px] text-ink-faint">
                          <span>{t('字幕字号')}</span>
                          <span className="font-mono text-seal font-medium">{subtitleScale}x</span>
                        </div>
                        <div className="mt-1 grid grid-cols-4 gap-1 px-1">
                          {[
                            { label: t('小'), scale: 0.8 },
                            { label: t('标准'), scale: 1.0 },
                            { label: t('大'), scale: 1.25 },
                            { label: t('特大'), scale: 1.5 },
                          ].map((item) => (
                            <button
                              key={item.scale}
                              type="button"
                              onClick={() => changeSubtitleScale(item.scale)}
                              className={`rounded py-0.5 text-center text-[10px] transition ${
                                subtitleScale === item.scale
                                  ? 'bg-seal text-white font-medium shadow-xs'
                                  : 'bg-line/40 text-ink hover:bg-line'
                              }`}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 倍速控制菜单：鼠标经过即展开 */}
              <div
                className="relative"
                onMouseEnter={() => {
                  setSpeedMenuOpen(true)
                  setSubtitleMenuOpen(false)
                }}
                onMouseLeave={() => setSpeedMenuOpen(false)}
              >
                <button
                  type="button"
                  title={t('倍速调节')}
                  className="flex h-8 min-w-[42px] items-center justify-center rounded-lg px-2 text-[12px] font-medium text-white/80 transition hover:bg-white/20 hover:text-white"
                >
                  <span>{playbackRate === 1.0 ? t('倍速') : `${playbackRate}x`}</span>
                </button>

                {/* 倍速选择面板 */}
                {speedMenuOpen && (
                  <div className="absolute right-0 bottom-full mb-2 w-36 rounded-xl border border-white/15 bg-card/95 p-1.5 text-ink shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95">
                    <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-ink-faint">
                      <span>{t('播放倍速')}</span>
                      <span className="font-mono text-seal font-bold">{playbackRate}x</span>
                    </div>

                    <div className="my-1 border-t border-line/60" />

                    <div className="max-h-48 overflow-y-auto">
                      {SPEED_PRESETS.map((rate) => (
                        <button
                          key={rate}
                          type="button"
                          onClick={() => changePlaybackRate(rate)}
                          className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-[11.5px] font-mono text-ink hover:bg-line/50"
                        >
                          <span>{rate.toFixed(2).replace(/\.?0+$/, '')}x</span>
                          {playbackRate === rate && <Check size={12} className="text-seal" />}
                        </button>
                      ))}
                    </div>

                    <div className="mt-1 flex items-center justify-between border-t border-line/60 pt-1 px-1">
                      <button
                        type="button"
                        onClick={() => changePlaybackRate(playbackRate - 0.1)}
                        disabled={playbackRate <= 0.25}
                        className="rounded px-1.5 py-0.5 text-[10.5px] text-ink-soft hover:bg-line/60 disabled:opacity-40"
                      >
                        -0.1
                      </button>
                      <button
                        type="button"
                        onClick={() => changePlaybackRate(1.0)}
                        className="rounded px-1.5 py-0.5 text-[10.5px] text-ink-soft hover:bg-line/60"
                      >
                        {t('正常')}
                      </button>
                      <button
                        type="button"
                        onClick={() => changePlaybackRate(playbackRate + 0.1)}
                        disabled={playbackRate >= 3.0}
                        className="rounded px-1.5 py-0.5 text-[10.5px] text-ink-soft hover:bg-line/60 disabled:opacity-40"
                      >
                        +0.1
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 截图当前画面 */}
              <button
                type="button"
                onClick={takeScreenshot}
                title={t('截图 (保存当前帧并复制到剪贴板)')}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/20 hover:text-white"
              >
                <Camera size={16} />
              </button>

              {/* 水平镜像翻转 */}
              <button
                type="button"
                onClick={toggleMirror}
                title={isMirrored ? t('关闭镜像翻转') : t('水平镜像翻转')}
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/20 ${
                  isMirrored ? 'bg-white/20 text-seal' : 'text-white/80 hover:text-white'
                }`}
              >
                <FlipHorizontal size={16} />
              </button>

              {/* 全屏切换 */}
              <button
                type="button"
                onClick={toggleFullscreen}
                title={isFullscreen ? t('退出全屏 (F)') : t('全屏 (F)')}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/20 hover:text-white"
              >
                {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
            </div>
          </div>
        </div>

        {/* 右侧悬浮面板（合集 / 选集）：挂在根容器里，全屏时同样可见 */}
        {sidePanel}

        {/* 隐藏的字幕文件导入 input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".srt,.vtt,.json,.txt"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleSubtitleFile(file)
            e.target.value = ''
          }}
          className="hidden"
        />
      </div>
    )
  },
)

VideoPlayer.displayName = 'VideoPlayer'
export default VideoPlayer
