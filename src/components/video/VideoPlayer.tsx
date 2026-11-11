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
 *
 * 拆分结构（原样搬运，中文理由注释随代码走）：播放控制逻辑 → useVideoPlayback.ts；
 * 字幕系统 → useVideoSubtitles.ts；总结分段的时刻匹配 → useVideoChapters.ts；
 * 进度条交互区（分段点 onMouseDown stopPropagation 敏感区在组件内原样保留）→
 * VideoProgressBar.tsx；底部控制条按钮行 → VideoControlBar.tsx；常量与本地存储读取 →
 * videoPlayerShared.ts。本文件是对外门面：props/handle 接口、换集幕布与 JSX 编排，
 * 既有导出（含 default）全部不变。
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { Loader2, Pause, Play } from 'lucide-react'
import {
  calculateSubtitleLayout,
  findActiveSubtitle,
  SUBTITLE_HARD_TEXT_SHADOW,
} from '../../video/subtitles'
import type { Transcript, TranscriptSegment } from '../../video/types'
import type { VideoChapter } from '../../learn/types'
import { VideoControlBar } from './VideoControlBar'
import { VideoProgressBar } from './VideoProgressBar'
import { findHoverChapter } from './useVideoChapters'
import { useVideoPlayback } from './useVideoPlayback'
import { useVideoSubtitles } from './useVideoSubtitles'

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
  leftOverlay?: React.ReactNode
  leftOverlayOpen?: boolean
  onToggleLeftOverlay?: () => void
  rightOverlay?: React.ReactNode
  rightOverlayOpen?: boolean
  onToggleRightOverlay?: () => void
  onPlay?: () => void
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
      sidePanel: _sidePanel,
      transitionStill,
      onToggleSidePanel: _onToggleSidePanel,
      sidePanelOpen: _sidePanelOpen = false,
      leftOverlay,
      leftOverlayOpen = false,
      onToggleLeftOverlay,
      rightOverlay,
      rightOverlayOpen = false,
      onToggleRightOverlay,
      onPlay,
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

    // 播放控制（播放/进度/缓冲、音量/倍速、全屏/镜像、菜单弹层、反馈提示与全部控制回调）：
    // 状态与逻辑收进 useVideoPlayback；门面 JSX 也要挂的同几块 ref 由门面创建后递进来（仓库惯例）
    const {
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
      volume,
      isMuted,
      isMutedRef,
      applyMuted,
      playbackRate,
      isFullscreen,
      isMirrored,
      fsAnimating,
      toggleFullscreen,
      toggleMirror,
      speedMenuOpen,
      setSpeedMenuOpen,
      subtitleMenuOpen,
      setSubtitleMenuOpen,
      volumeHovered,
      setVolumeHovered,
      playerDimensions,
      hoverPercent,
      hoverTime,
      hoverPosPx,
      handleProgressMouseDown,
      handleProgressMouseMove,
      handleProgressMouseLeave,
      handlePreviewVideoSeeked,
      flashActive,
      centerIndicator,
      setCenterIndicator,
      toastMessage,
      showToast,
      scheduleHideControls,
      handleMouseMove,
      handleMouseLeave,
      togglePlay,
      changePlaybackRate,
      changeVolume,
      toggleMute,
      takeScreenshot,
      captureFrame,
    } = useVideoPlayback({
      src,
      active,
      propDurationMs,
      title,
      onSeeked,
      videoRef,
      containerRef,
      progressBarRef,
      previewVideoRef,
      previewCanvasRef,
    })

    // 字幕系统（轨道 / 外挂 / 时间轴偏移 / 字号缩放）：状态与导入逻辑收进 hook，showToast 递进去
    const {
      subtitleTrack,
      setSubtitleTrack,
      externalSegments,
      externalName,
      subtitleOffsetMs,
      setSubtitleOffsetMs,
      subtitleScale,
      changeSubtitleScale,
      handleSubtitleFile,
      clearExternalSubtitles,
    } = useVideoSubtitles({ showToast, onExternalSubtitleLoaded })

    /** 换集幕布（冻结上一帧）：token 变了才换图；新流首帧到了再淡出 */
    const [still, setStill] = useState<{ token: string; src: string } | null>(null)
    const [stillFading, setStillFading] = useState(false)
    const stillRef = useRef<{ token: string; src: string } | null>(null)
    const stillTokenRef = useRef('')

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
      // setCurrentTime（useState setter）/ isMutedRef（ref）都是稳定引用，补进依赖只为过 lint，行为不变
      [captureFrame, applyMuted, setCurrentTime, isMutedRef],
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
      // 外挂字幕属于上一集：换流时清掉，免得把别人的字幕挂在新集上（见 useVideoSubtitles.clearExternalSubtitles）
      clearExternalSubtitles()
      video.load()
      void video.play().catch(() => {
        // 浏览器可能拦自动播放：留着暂停态，用户点一下即可
      })
      // setCurrentTime / setBuffered / setCenterIndicator（useState setter）与 clearExternalSubtitles（useCallback []）都是稳定引用，补进依赖只为过 lint，行为不变
    }, [src, setCurrentTime, setBuffered, setCenterIndicator, clearExternalSubtitles])

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
    const hoverChapter = findHoverChapter(chapters, hoverTime)

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
            onPlay?.()
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
            className={`pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/90 via-black/40 to-transparent px-4 pb-6 pt-2.5 transition-opacity duration-300 ${
              isControlsVisible ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <div className="flex min-w-0 items-baseline gap-2 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
              {/* 标题限宽（截断）：把右侧位置让给选集名——长标题不许把选集挤没 */}
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">{title}</span>
              {subLabel && (
                <span className="max-w-[45%] shrink-0 truncate text-[11px] text-white/75">{subLabel}</span>
              )}
            </div>
          </div>
        )}

        {/* 底部控制器渐变背景与控制栏（倍速/字幕浮层展开时提升至 z-50） */}
        <div
          className={`absolute inset-x-0 bottom-0 ${
            speedMenuOpen || subtitleMenuOpen ? 'z-50' : 'z-30'
          } flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/45 to-transparent pt-7 pb-2 px-3 transition-opacity duration-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] ${
            isControlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 进度条交互区域（分段点 onMouseDown stopPropagation 敏感区，原样在子组件里） */}
          <VideoProgressBar
            progressBarRef={progressBarRef}
            onMouseDown={handleProgressMouseDown}
            onMouseMove={handleProgressMouseMove}
            onMouseLeave={handleProgressMouseLeave}
            hoverPercent={hoverPercent}
            hoverTime={hoverTime}
            hoverPosPx={hoverPosPx}
            previewCanvasRef={previewCanvasRef}
            currentPercent={currentPercent}
            bufferedPercent={bufferedPercent}
            effectiveDuration={effectiveDuration}
            chapters={chapters}
            hoverChapter={hoverChapter}
            onChapterClick={(ch) => {
              const video = videoRef.current
              if (!video) return
              video.currentTime = ch.startMs / 1000
              setCurrentTime(ch.startMs / 1000)
            }}
          />

          {/* 控制条按钮行 */}
          <VideoControlBar
            isPlaying={isPlaying}
            togglePlay={togglePlay}
            currentTime={currentTime}
            effectiveDuration={effectiveDuration}
            onToggleLeftOverlay={onToggleLeftOverlay}
            leftOverlayOpen={leftOverlayOpen}
            onToggleRightOverlay={onToggleRightOverlay}
            rightOverlayOpen={rightOverlayOpen}
            isMuted={isMuted}
            volume={volume}
            volumeHovered={volumeHovered}
            setVolumeHovered={setVolumeHovered}
            toggleMute={toggleMute}
            changeVolume={changeVolume}
            subtitleMenuOpen={subtitleMenuOpen}
            setSubtitleMenuOpen={setSubtitleMenuOpen}
            setSpeedMenuOpen={setSpeedMenuOpen}
            subtitleTrack={subtitleTrack}
            setSubtitleTrack={setSubtitleTrack}
            transcript={transcript}
            externalSegments={externalSegments}
            externalName={externalName}
            subtitleOffsetMs={subtitleOffsetMs}
            setSubtitleOffsetMs={setSubtitleOffsetMs}
            subtitleScale={subtitleScale}
            changeSubtitleScale={changeSubtitleScale}
            fileInputRef={fileInputRef}
            speedMenuOpen={speedMenuOpen}
            playbackRate={playbackRate}
            changePlaybackRate={changePlaybackRate}
            takeScreenshot={takeScreenshot}
            isMirrored={isMirrored}
            toggleMirror={toggleMirror}
            isFullscreen={isFullscreen}
            toggleFullscreen={toggleFullscreen}
          />
        </div>

        {/* 左侧悬浮面板（选集 + 字幕 + 视频分段）：按 Tab 展开/收起，挂在播放器根容器里 */}
        {leftOverlay}

        {/* 右侧悬浮面板（笔记栏）：按 Tab 展开/收起，挂在播放器根容器里 */}
        {rightOverlay}

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
