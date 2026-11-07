/*
 * 视频学习页签的「视频引擎」（VideoStudyTab 拆分模块）：
 * 解析（runResolve：换集幕布抓帧 → resolve → 开 media-relay 中转流）、绑定态
 * 进页自动解析、moji:video 协议超链接跳转处理、播放进度上报与续播、内容语义
 * 分段（手动 + 播放时自动，50,000 字符上限）、页签音频登记（快捷静音按钮）、
 * 字幕行跟随滚动，以及门面 JSX 要挂的几块 ref（播放器 handle、字幕列表/行、
 * 分段列表）。原样搬自 VideoStudyTab.tsx（注释一并带走），按仓库惯例收成
 * Deps 单对象的逻辑 hook；门面 JSX 事件里的进度节流/外挂字幕装载也原样搬成
 * handleTimeUpdate / handleSeeked / applyExternalSubtitle 三个回调，行为不变。
 * 流地址每次解析都重新登记（media-relay 不落盘）；解析结果不随页签持久化。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../i18n'
import { resolveVideoSource } from '../../lib/videoPlugins'
import { openRelayStream } from '../../video/registry'
import { segmentIndexAt } from '../../video/transcript'
import { summarizeVideoChapters } from '../../learn/video/summarize'
import { registerVideoAudio } from '../../learn/video/videoRegistry'
import { setVideoLinkHandler, type VideoJumpTarget } from '../../lib/videoLink'
import type { Transcript, VideoSource } from '../../video/types'
import type { VideoRecap, VideoResource } from '../../learn/types'
import type { VideoPlayerHandle } from './VideoPlayer'

/** 视频引擎需要宿主（页签门面）提供的入参 */
export interface VideoStudyDeps {
  /** 绑定的视频资源；空 = 创建态（引擎的自动解析只对绑定态生效） */
  video: VideoResource | null
  /** 页签此刻是否激活：切走时不再接管 moji:video 跳转 */
  active: boolean
  /** 自己的页签 id：音频控制登记的键（页签条的快捷静音按钮按它找上来） */
  tabId?: string
  /** 解析成功回写标题（资源列表显示真实标题） */
  onResolved?: (title: string) => void
  /** 选集切换：把「停在的那一项」写进资源（重开回到同一集） */
  onSelection?: (source: string, title: string) => void
  /** 播放进度（毫秒，节流后上报）：工作区写进视频资源，下次打开自动跳回 */
  onProgress?: (positionMs: number, source: string) => void
  /** 视频分段保存：按当前来源写进资源 */
  onSaveRecap?: (source: string, recap: VideoRecap) => void
}

/**
 * 视频引擎：返回解析/播放/分段的状态（门面 JSX 与侧栏直接用）与全部控制回调。
 */
export function useVideoStudy({
  video,
  active,
  tabId,
  onResolved,
  onSelection,
  onProgress,
  onSaveRecap,
}: VideoStudyDeps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 解析结果：流地址（media-relay）+ 转录稿 + 元信息；null = 还没解析出来 */
  const [relayUrl, setRelayUrl] = useState<string | null>(null)
  const [source, setSource] = useState<VideoSource | null>(null)
  const [transcript, setTranscript] = useState<Transcript | null>(null)
  const [transcriptNote, setTranscriptNote] = useState<string | null>(null)
  /** 播放器此刻的位置（ms） */
  const [currentMs, setCurrentMs] = useState(0)

  /** 当前解析的是哪一项（选集 source） */
  const [currentSource, setCurrentSource] = useState(() => video?.selection?.source ?? video?.input ?? '')

  /** 视频分段生成中（禁点、转圈） */
  const [chaptersBusy, setChaptersBusy] = useState(false)

  /** 挂起的跨选集跳转目标时间（毫秒） */
  const pendingSeekMsRef = useRef<number | null>(null)

  /** 换集幕布 */
  const [switchStill, setSwitchStill] = useState<{ token: string; src: string } | null>(null)

  const playerRef = useRef<VideoPlayerHandle | null>(null)

  useEffect(() => {
    if (!tabId) return
    registerVideoAudio(tabId, {
      getMuted: () => playerRef.current?.getMuted() ?? false,
      setMuted: (muted) => playerRef.current?.setMuted(muted),
      element: playerRef.current?.getVideoElement() ?? null,
    })
    return () => registerVideoAudio(tabId, null)
  }, [tabId, relayUrl])

  const lastProgressRef = useRef(0)
  const currentSourceRef = useRef<string>('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const chapterListRef = useRef<HTMLDivElement | null>(null)

  const segments = transcript?.segments ?? []
  const activeIdx = segments.length ? segmentIndexAt(segments, currentMs) : -1

  /** 当前来源的分段行 */
  const recapOfSource = video?.recaps?.[currentSource] ?? null
  const chapterRows = recapOfSource?.chapters ?? []

  /** 当前播放落在哪个分段 */
  const activeChapterIdx = chapterRows.length
    ? chapterRows.reduce((acc, ch, i) => (currentMs >= ch.startMs ? i : acc), -1)
    : -1

  /** 转录字幕总字符数：用于限制 50,000 字符防爆破上下文 */
  const totalTranscriptChars = useMemo(() => {
    return segments.reduce((sum, seg) => sum + (seg.text ? seg.text.length : 0), 0)
  }, [segments])

  /**
   * 解析视频来源
   */
  const runResolve = useCallback(
    async (text: string, fields?: Record<string, string | number | boolean>) => {
      if (!text || busy) return
      const frame = playerRef.current?.captureFrame() ?? null
      if (frame) setSwitchStill({ token: Math.random().toString(36).slice(2), src: frame })
      setBusy(true)
      setError(null)
      setTranscriptNote(null)
      try {
        const src = await resolveVideoSource(text, fields)
        const url = await openRelayStream(src)
        setSource(src)
        setRelayUrl(url)
        setTranscript(src.transcript ?? null)
        if (src.transcript) setTranscriptNote(null)
        else if (src.transcriptError) setTranscriptNote(t('字幕获取失败：{0}', src.transcriptError))
        else setTranscriptNote(t('这条来源没有字幕：需要登录的平台，请到「设置 → 插件」的插件配置里填好凭据后重试。'))
        setCurrentMs(0)
        currentSourceRef.current = text
        setCurrentSource(text)
        lastProgressRef.current = 0
        onResolved?.(src.title)
        if (video && text !== (video.selection?.source ?? video.input)) onSelection?.(text, src.title)
        if (pendingSeekMsRef.current !== null) {
          const targetSeek = pendingSeekMsRef.current
          pendingSeekMsRef.current = null
          window.setTimeout(() => {
            playerRef.current?.seekMs(targetSeek)
          }, 350)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [busy, onResolved, video, onSelection],
  )

  const autoResolvedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!video) return
    const targetSource = video.selection?.source ?? video.input
    const key = `${video.id}::${targetSource}`
    if (autoResolvedRef.current === key) return
    autoResolvedRef.current = key
    void runResolve(targetSource, video.fields)
  }, [video, runResolve])

  /**
   * 注册视频超链接（moji:video 协议）跳转处理
   */
  useEffect(() => {
    if (!active) return

    const handleJump = (target: VideoJumpTarget) => {
      const pages = source?.pages ?? []
      if (typeof target.page === 'number' && pages.length > 0) {
        const targetPage = pages.find((p) => p.page === target.page)
        if (targetPage && !targetPage.current) {
          pendingSeekMsRef.current = typeof target.timeMs === 'number' ? target.timeMs : null
          void runResolve(targetPage.source, video?.fields)
          return
        }
      }
      if (typeof target.timeMs === 'number') {
        playerRef.current?.seekMs(target.timeMs)
      }
    }

    const restore = setVideoLinkHandler((target) => {
      handleJump(target)
    })

    const onCustomJump = (e: Event) => {
      const detail = (e as CustomEvent<VideoJumpTarget>).detail
      if (detail && typeof detail.timeMs === 'number') {
        handleJump(detail)
      }
    }
    window.addEventListener('moji:video:jump', onCustomJump)

    return () => {
      restore()
      window.removeEventListener('moji:video:jump', onCustomJump)
    }
  }, [active, source?.pages, runResolve, video?.fields])

  /** 进度上报 */
  useEffect(() => {
    const el = playerRef.current?.getVideoElement()
    if (!el || !onProgress) return
    const flush = () => {
      const ms = el.currentTime * 1000
      lastProgressRef.current = ms
      onProgress(ms, currentSourceRef.current)
    }
    el.addEventListener('pause', flush)
    el.addEventListener('ended', flush)
    return () => {
      el.removeEventListener('pause', flush)
      el.removeEventListener('ended', flush)
    }
  }, [relayUrl, onProgress])

  /** 续播 */
  const resumedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!relayUrl || !video) return
    const resumeKey = video.id + '|' + currentSourceRef.current
    if (resumedRef.current === resumeKey) return
    resumedRef.current = resumeKey
    const progress = video.progress
    if (!progress) return
    if (progress.source && progress.source !== currentSourceRef.current) return
    const saved = progress.positionMs
    if (saved < 5000) return
    if (source?.durationMs && saved > source.durationMs - 5000) return
    const timer = window.setTimeout(() => {
      playerRef.current?.seekMs(saved)
      lastProgressRef.current = saved
    }, 350)
    return () => window.clearTimeout(timer)
  }, [relayUrl, video, source?.durationMs])

  const seekMs = useCallback((ms: number) => {
    playerRef.current?.seekMs(ms)
  }, [])

  /**
   * 生成当前视频的内容分段（不再生成视频总结）：
   * 产出仅为语义分段列表，分段点更新到进度条与浮层分段列表中。
   */
  const runChapters = useCallback(async () => {
    if (!transcript?.segments?.length || chaptersBusy) return
    const src = currentSourceRef.current || currentSource
    if (video?.recaps?.[src]?.chapters?.length) return
    setChaptersBusy(true)
    try {
      const chapters = await summarizeVideoChapters({
        title: source?.title ?? video?.title ?? '',
        transcript,
      })
      onSaveRecap?.(src, { summary: '', chapters })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setChaptersBusy(false)
    }
  }, [transcript, chaptersBusy, currentSource, video?.recaps, video?.title, source?.title, onSaveRecap])

  const autoChapterTriedRef = useRef<Set<string>>(new Set())
  const runChaptersRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    runChaptersRef.current = runChapters
  })

  /**
   * 视频播放时立即自动生成分段：
   * 限制 50,000 字符以内，超过 50,000 字符需手动点击生成。
   */
  const triggerAutoChaptersOnPlay = useCallback(() => {
    if (!video || !transcript?.segments?.length) return
    if (totalTranscriptChars > 50000) return
    const src = currentSourceRef.current || currentSource
    if (!src) return
    if (video.recaps?.[src]?.chapters?.length) return
    if (chaptersBusy) return
    const key = `${video.id}::${src}`
    if (autoChapterTriedRef.current.has(key)) return
    autoChapterTriedRef.current.add(key)
    void runChaptersRef.current()
  }, [video, transcript, totalTranscriptChars, currentSource, chaptersBusy])

  /** 当前字幕行跟随定位 */
  useEffect(() => {
    const list = listRef.current
    const row = activeIdx >= 0 ? rowRefs.current[activeIdx] : null
    if (!list || !row) return
    const contentTop = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop
    const max = Math.max(0, list.scrollHeight - list.clientHeight)
    const target = Math.max(0, Math.min(max, Math.round(contentTop - list.clientHeight * 0.2)))
    if (target !== list.scrollTop) list.scrollTo({ top: target, behavior: 'smooth' })
  }, [activeIdx, transcript])

  /** VideoPlayer onTimeUpdate：更新当前时刻 + 触发播放时自动分段 + 5 秒节流上报进度（原门面内联回调原样搬入） */
  const handleTimeUpdate = (ms: number) => {
    setCurrentMs(ms)
    triggerAutoChaptersOnPlay()
    if (Math.abs(ms - lastProgressRef.current) >= 5000) {
      lastProgressRef.current = ms
      onProgress?.(ms, currentSourceRef.current)
    }
  }

  /** VideoPlayer onSeeked：更新当前时刻并立即上报进度（原门面内联回调原样搬入） */
  const handleSeeked = (ms: number) => {
    setCurrentMs(ms)
    lastProgressRef.current = ms
    onProgress?.(ms, currentSourceRef.current)
  }

  /** VideoPlayer onExternalSubtitleLoaded：外挂字幕装载后替换转录稿并清掉失败提示（原门面内联回调原样搬入） */
  const applyExternalSubtitle = (extTranscript: Transcript) => {
    setTranscript(extTranscript)
    setTranscriptNote(null)
  }

  return {
    busy,
    error,
    relayUrl,
    source,
    transcript,
    transcriptNote,
    /** 播放器此刻的位置（ms） */
    currentMs,
    chaptersBusy,
    /** 换集幕布 */
    switchStill,
    playerRef,
    listRef,
    rowRefs,
    chapterListRef,
    segments,
    activeIdx,
    chapterRows,
    activeChapterIdx,
    totalTranscriptChars,
    runResolve,
    seekMs,
    runChapters,
    triggerAutoChaptersOnPlay,
    handleTimeUpdate,
    handleSeeked,
    applyExternalSubtitle,
  }
}
