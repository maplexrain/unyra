/**
 * 视频页签：两种形态，同一个组件。
 *
 * - **创建态**（`video` 为空，全局一份，键 v:new）：只有一个输入框 + 创建按钮。
 *   输入不一定是 URL——交给已装载的插件逐个 `match()` 认领，认领后展示该插件的
 *   `createFields` 表单，填完创建。插件与输入在这一刻确定，之后不再让用户重填。
 * - **绑定态**（`video` 有值，键 v:<id>）：页里**没有任何输入组件**，进页即按
 *   资源的「输入 + 字段」自动解析；标题栏/播放器/合集/选集/字幕条照旧。
 *
 * 两种形态都走 `lib/videoPlugins` 的派发（match → resolve → 宿主归一 + 时长对账）。
 * 流地址每次解析都重新登记（media-relay 不落盘）；解析结果不随页签持久化。
 * 视频页签由工作区的常驻层 keepalive 渲染（切走只藏不卸，播放不打断）。
 *
 * 重构说明：
 * - 移除底部三栏（字幕、总结、视频分段），播放器铺满容器高度；
 * - 增加 Tab 键浮层：浮层位于播放器容器内部左侧，上方显示字幕列表，下方显示视频分段；
 * - 废弃视频总结，仅生成章节分段；
 * - 视频播放时立即自动生成分段；限制 50,000 字符，超过 50,000 字符需手动点击生成。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Captions,
  Clapperboard,
  Download,
  ListTree,
  Loader2,
  MonitorPlay,
  Plus,
  Puzzle,
  X,
} from 'lucide-react'
import { t } from '../../i18n'
import { isWeb, native } from '../../lib/native'
import { fadeMask, useScrollEdges } from '../../lib/scrollFade'
import { matchVideoPlugin, resolveVideoSource, resolveVideoTranscript, videoSourcePlugins } from '../../lib/videoPlugins'
import { openRelayStream } from '../../video/registry'
import { buildPagesMarkdown, type PagesExportEntry } from '../../video/export'
import { formatClock, segmentIndexAt } from '../../video/transcript'
import { summarizeVideoChapters } from '../../learn/video/summarize'
import type { Transcript, VideoSource } from '../../video/types'
import type { PluginSettingField } from '../../lib/plugins'
import type { VideoRecap, VideoResource } from '../../learn/types'
import { registerVideoAudio } from '../../learn/video/videoRegistry'
import VideoPlayer, { type VideoPlayerHandle } from './VideoPlayer'

/** 创建态的输入记忆：下次打新建视频，上次粘的链接还在 */
const INPUT_KEY = 'moji.video.input'
/** 合集列表收起与否：跟输入一样落在 localStorage，重启后保持上次的选择 */
const COLLAPSED_KEY = 'moji.video.collapsed'

const readLastInput = (): string => {
  try {
    return localStorage.getItem(INPUT_KEY) ?? ''
  } catch {
    return ''
  }
}

const readCollapsed = (): boolean => {
  try {
    // 默认收起：没存过按收起算，展开过一次才记住
    return (localStorage.getItem(COLLAPSED_KEY) ?? '1') === '1'
  } catch {
    return false
  }
}

/** 创建时的工作区回调签名：落库 + 开关页签都在工作区做（页签自己不认识 store） */
export interface VideoCreateDraft {
  pluginId: string
  pluginName: string
  input: string
  fields: Record<string, string | number | boolean>
}

interface Props {
  /** 绑定的视频资源；空 = 创建态 */
  video?: VideoResource | null
  /** 关联的视频节点 id（如果有） */
  videoNodeId?: string
  /** 初始输入（来自视频节点） */
  initialInput?: string
  /** 创建（工作区负责落库、开绑定页签、关掉创建页签） */
  onCreate?: (draft: VideoCreateDraft) => void
  /** 解析成功回写标题（资源列表显示真实标题） */
  onResolved?: (title: string) => void
  /** 播放进度（毫秒，节流后上报）：工作区写进视频资源，下次打开自动跳回 */
  onProgress?: (positionMs: number, source: string) => void
  /** 选集切换：把「停在的那一项」写进资源（重开回到同一集） */
  onSelection?: (source: string, title: string) => void
  /** 视频分段保存：按当前来源写进资源 */
  onSaveRecap?: (source: string, recap: VideoRecap) => void
  /** 自己的页签 id：音频控制登记的键（页签条的快捷静音按钮按它找上来） */
  tabId?: string
  /** 页签此刻是否激活：切走就停播（VideoPlayer 的 active） */
  active?: boolean
}

export default function VideoStudyTab({
  video = null,
  onCreate,
  onResolved,
  onProgress,
  onSelection,
  onSaveRecap,
  tabId,
  active = true,
  videoNodeId: _videoNodeId,
  initialInput = '',
}: Props) {
  const bound = !!video
  /** 创建态输入（绑定态不用它——页里没有输入组件） */
  const [input, setInput] = useState(() => video?.input ?? (initialInput || readLastInput()))

  useEffect(() => {
    if (!bound && initialInput && !input) {
      setInput(initialInput)
    }
  }, [bound, initialInput, input])

  /**
   * 创建态的匹配结果：纯函数，输入一变就重算。
   */
  const matched = useMemo(() => {
    if (bound) return null
    const text = input.trim()
    if (!text) return null
    return matchVideoPlugin(text)
  }, [bound, input])

  const createFields = useMemo<PluginSettingField[]>(() => matched?.plugin.createFields ?? [], [matched])

  const [createOverrides, setCreateOverrides] = useState<{
    pluginId: string
    values: Record<string, string | number | boolean>
  } | null>(null)

  const createValues = useMemo(() => {
    const seed: Record<string, string | number | boolean> = {}
    for (const f of createFields) {
      if (f.default !== undefined) seed[f.key] = f.default
      else if (f.type === 'boolean') seed[f.key] = false
      else seed[f.key] = ''
    }
    const pluginId = matched?.plugin.id ?? ''
    const overrides = createOverrides?.pluginId === pluginId ? createOverrides.values : {}
    return { ...seed, ...overrides }
  }, [createFields, createOverrides, matched?.plugin.id])

  const setCreateValue = useCallback(
    (key: string, value: string | number | boolean) => {
      const pluginId = matched?.plugin.id ?? ''
      setCreateOverrides((prev) => ({
        pluginId,
        values: { ...(prev?.pluginId === pluginId ? prev.values : {}), [key]: value },
      }))
    },
    [matched?.plugin.id],
  )

  const missingRequired = createFields.some((f) => f.required && !String(createValues[f.key] ?? '').trim())

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

  /** 左侧抽屉（字幕列表 + 视频分段）：按 Tab 展开/收起 */
  const [leftOverlayOpen, setLeftOverlayOpen] = useState(false)

  /** 合集列表收起与否 */
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, v ? '0' : '1')
      } catch {
        // 会话内生效即可
      }
      return !v
    })
  }, [])

  const panelRef = useRef<HTMLDivElement | null>(null)
  const collapsePanel = useCallback(() => {
    setCollapsed(true)
    try {
      localStorage.setItem(COLLAPSED_KEY, '1')
    } catch {
      // 会话内生效即可
    }
  }, [])

  useEffect(() => {
    if (collapsed) return
    const onDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-video-panel-toggle]')) return
      collapsePanel()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [collapsed, collapsePanel])

  /** 键盘 Tab 键监听：切换左侧字幕与分段浮层 */
  useEffect(() => {
    if (!active) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const target = e.target as HTMLElement | null
        if (target) {
          const tag = target.tagName.toUpperCase()
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
            return
          }
        }
        e.preventDefault()
        setLeftOverlayOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [active])

  /** 合集字幕批量导出进度 */
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null)
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
  const edges = useScrollEdges(listRef)

  const chapterListRef = useRef<HTMLDivElement | null>(null)
  const chapterEdges = useScrollEdges(chapterListRef)

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

  const create = useCallback(() => {
    if (!matched || missingRequired) return
    const text = input.trim()
    if (!text) return
    try {
      localStorage.setItem(INPUT_KEY, text)
    } catch {
      // 记不住也无碍
    }
    onCreate?.({
      pluginId: matched.plugin.id,
      pluginName: matched.plugin.name ?? matched.plugin.id,
      input: text,
      fields: createValues,
    })
  }, [matched, missingRequired, input, createValues, onCreate])

  const videoFieldsRef = useRef(video?.fields)
  useEffect(() => {
    videoFieldsRef.current = video?.fields
  }, [video?.fields])

  const exportPages = async () => {
    const pages = source?.pages
    if (!pages || !source || exportProgress) return
    setExportProgress({ done: 0, total: pages.length })
    const entries: PagesExportEntry[] = []
    try {
      for (let i = 0; i < pages.length; i++) {
        const item = pages[i]
        const entry: PagesExportEntry = {
          page: item.page,
          title: item.title,
          durationMs: item.durationMs,
          source: item.source,
        }
        try {
          entry.transcript = await resolveVideoTranscript(item.source, videoFieldsRef.current)
        } catch (err) {
          entry.error = err instanceof Error ? err.message : String(err)
        }
        entries.push(entry)
        setExportProgress({ done: i + 1, total: pages.length })
        if (i < pages.length - 1) await new Promise((r) => window.setTimeout(r, 150))
      }
      const bvid = /BV[0-9A-Za-z]{10}/.exec(pages[0]?.source ?? '')?.[0]
      const md = buildPagesMarkdown(
        {
          title: source.title,
          durationMs: source.durationMs,
          source: bvid ? `https://www.bilibili.com/video/${bvid}` : (video?.input ?? source.mediaId),
        },
        entries,
      )
      const safeName = source.title.replace(/[\\/:*?"<>|]/g, '_')
      const res = await native().saveText({ suggestedName: `${safeName}.md`, content: md, title: t('导出选集字幕') })
      if (!res.ok && !res.canceled) setError(res.error ?? t('导出失败'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setExportProgress(null)
    }
  }

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

  /* ---------- 浏览器（WebUI）模式 ---------- */
  if (isWeb()) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-card p-6 text-center select-none">
        <MonitorPlay size={32} className="text-seal/70" />
        <div className="text-[14px] font-semibold text-ink-strong">{t('视频学习仅桌面端可用')}</div>
        <p className="max-w-md text-[12px] leading-relaxed text-ink-faint">
          {t('视频流由主进程的本地媒体通道转发（防盗链头 `<video>` 发不出来），浏览器模式里没有这条通道。')}
        </p>
      </div>
    )
  }

  /* ---------- 创建态 ---------- */
  if (!bound) {
    const installed = videoSourcePlugins()
    const ready = !!matched && !missingRequired
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto bg-paper">
        <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3 px-5 pt-[12vh]">
          <div className="flex items-center gap-2">
            <Clapperboard size={20} className="text-seal" />
            <span className="text-[15px] font-semibold text-ink-strong">{t('新建视频')}</span>
          </div>
          <p className="text-[12px] leading-relaxed text-ink-faint">
            {t('粘贴链接或输入编号，插件会认领它。视频创建后绑定插件与输入，打开页签即自动播放。')}
          </p>

          <div className="mt-1 flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && ready) create()
              }}
              placeholder={t('链接或编号（例如 B 站链接 / BV 号）')}
              className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-2 text-[13px] text-ink outline-none transition placeholder:text-ink-faint focus:border-seal/50 focus:ring-2 focus:ring-seal/10"
            />
            <button
              type="button"
              onClick={create}
              disabled={!ready}
              className="flex h-[36px] shrink-0 items-center gap-1.5 rounded-lg bg-pink-600 px-3.5 text-[12px] font-medium text-white transition hover:bg-pink-700 disabled:pointer-events-none disabled:opacity-35 cursor-pointer shadow-sm"
            >
              <Plus size={13} />
              {t('确定为视频资源')}
            </button>
          </div>

          {input.trim() && !matched && (
            <div className="rounded-xl border border-dashed border-line bg-card/50 px-3.5 py-3 text-[11.5px] leading-relaxed text-ink-soft">
              {installed.length
                ? t('没有插件认领这段输入。已安装：{0}', installed.map((p) => p.name ?? p.id).join('、'))
                : t('还没有安装任何视频来源插件：到「设置 → 插件 → 视频 / 音频来源」安装并启用。')}
            </div>
          )}
          {matched && (
            <div className="flex flex-col gap-2.5 rounded-xl border border-seal/30 bg-seal/5 px-3.5 py-3">
              <div className="flex items-center gap-1.5">
                <Puzzle size={13} className="text-seal" />
                <span className="text-[12px] font-medium text-ink-strong">
                  {matched.plugin.name ?? matched.plugin.id}
                </span>
                {matched.plugin.version && (
                  <span className="text-[10.5px] text-ink-faint">v{matched.plugin.version}</span>
                )}
              </div>
              {createFields.length > 0 && (
                <div className="flex flex-col gap-2">
                  {createFields.map((f) => (
                    <CreateField
                      key={f.key}
                      field={f}
                      value={createValues[f.key]}
                      onChange={(v) => setCreateValue(f.key, v)}
                    />
                  ))}
                </div>
              )}
              <p className="text-[10.5px] leading-relaxed text-ink-faint">
                {t('上面填的是这个视频专属的数据；插件全局配置（如登录凭据）在「设置 → 插件」里。')}
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  /**
   * 右侧悬浮面板（合集 / 选集）：挂在根容器里，全屏时也能打开
   */
  const currentPage = source?.pages?.find((p) => p.current)
  const pageLabel = currentPage ? 'P' + currentPage.page + ' ' + currentPage.title : undefined
  const sidePanel =
    source && (source.collection || source.pages) ? (
      <div
        className={
          'absolute right-3 top-1/2 z-10 h-[80%] -translate-y-1/2 overflow-hidden rounded-xl transition-[width] duration-300 ease-out ' +
          (collapsed ? 'w-0' : 'w-[320px]')
        }
      >
        <div
          ref={panelRef}
          className="flex h-full w-[320px] flex-col border border-line/60 bg-card/95 shadow-[0_10px_30px_rgba(0,0,0,0.28)]"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            {source.collection && (
              <>
                <div className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-medium text-ink-faint">
                  {t('合集')} · {source.collection.name}
                </div>
                {source.collection.items.map((item) => (
                  <button
                    key={item.source}
                    type="button"
                    title={item.title}
                    disabled={busy}
                    onClick={() => void runResolve(item.source, video?.fields)}
                    className={
                      'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition disabled:opacity-50 ' +
                      (item.current ? 'bg-seal/10' : 'hover:bg-line/50')
                    }
                  >
                    <span
                      className={
                        'min-w-0 flex-1 truncate text-[12px] ' +
                        (item.current ? 'font-medium text-ink-strong' : 'text-ink')
                      }
                    >
                      {item.title}
                    </span>
                    <span
                      className={
                        'shrink-0 font-mono text-[10.5px] ' +
                        (item.current ? 'text-seal' : 'text-ink-faint')
                      }
                    >
                      {item.durationMs ? formatClock(item.durationMs) : '--:--'}
                    </span>
                  </button>
                ))}
              </>
            )}
            {source.pages && (
              <>
                <div className="flex items-center gap-1 px-2 pb-0.5 pt-1.5">
                  <span className="min-w-0 flex-1 truncate text-[10.5px] font-medium text-ink-faint">
                    {t('选集')} · {source.pages.length}
                  </span>
                  <button
                    type="button"
                    title={
                      exportProgress
                        ? t('导出中 {0}/{1}', String(exportProgress.done), String(exportProgress.total))
                        : t('导出选集字幕（全部分 P 的转录合并为一个 Markdown）')
                    }
                    disabled={!!exportProgress || busy}
                    onClick={() => void exportPages()}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint transition hover:bg-line/60 hover:text-ink disabled:opacity-50"
                  >
                    {exportProgress ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                  </button>
                </div>
                {exportProgress && (
                  <div className="px-2 pb-0.5 text-[10.5px] text-ink-faint">
                    {t('导出中 {0}/{1}', String(exportProgress.done), String(exportProgress.total))}
                  </div>
                )}
                {source.pages.map((item) => (
                  <button
                    key={item.source}
                    type="button"
                    title={item.title}
                    disabled={busy}
                    onClick={() => void runResolve(item.source, video?.fields)}
                    className={
                      'flex w-full items-center gap-2 rounded-md py-1 pl-4 pr-2 text-left transition disabled:opacity-50 ' +
                      (item.current ? 'bg-seal/10' : 'hover:bg-line/50')
                    }
                  >
                    <span className="shrink-0 font-mono text-[10.5px] text-ink-faint">p{item.page}</span>
                    <span
                      className={
                        'min-w-0 flex-1 truncate text-[12px] ' +
                        (item.current ? 'font-medium text-ink-strong' : 'text-ink')
                      }
                    >
                      {item.title}
                    </span>
                    <span
                      className={
                        'shrink-0 font-mono text-[10.5px] ' +
                        (item.current ? 'text-seal' : 'text-ink-faint')
                      }
                    >
                      {item.durationMs ? formatClock(item.durationMs) : '--:--'}
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    ) : null

  const maskStyle = { maskImage: fadeMask(edges), WebkitMaskImage: fadeMask(edges) } as const
  const chapterMaskStyle = { maskImage: fadeMask(chapterEdges), WebkitMaskImage: fadeMask(chapterEdges) } as const
  const hasTranscript = !!transcript?.segments?.length

  /**
   * 左侧浮层（按 Tab 展开/收起）：
   * 上方：字幕列表（支持按时间高亮与点击跳转）；
   * 下方：视频分段（展示分段章节列表；支持 50,000 字符限制与手动生成）。
   */
  const leftOverlay = (
    <div
      className={
        'absolute left-3 top-3 bottom-14 z-20 flex w-[340px] max-w-[46vw] flex-col overflow-hidden rounded-xl border border-white/15 bg-black/85 text-white backdrop-blur-md shadow-2xl transition-all duration-200 ' +
        (leftOverlayOpen ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 -translate-x-4 pointer-events-none')
      }
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 上半部分：字幕列表 */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2 bg-white/[0.03]">
        <div className="flex items-center gap-1.5 min-w-0">
          <Captions size={14} className="text-pink-400 shrink-0" />
          <span className="text-[12px] font-semibold text-white/95 truncate">{t('字幕列表')}</span>
          {segments.length > 0 && (
            <span className="rounded bg-white/10 px-1.5 py-0.2 text-[10px] text-white/60 shrink-0">
              {segments.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setLeftOverlayOpen(false)}
          title={t('收起 (Tab)')}
          className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white transition cursor-pointer"
        >
          <X size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 flex flex-col" style={maskStyle}>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {segments.length ? (
            segments.map((seg, i) => (
              <div key={seg.startMs} ref={(el) => { rowRefs.current[i] = el }}>
                <button
                  type="button"
                  onClick={() => seekMs(seg.startMs)}
                  className={
                    'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition cursor-pointer ' +
                    (i === activeIdx ? 'bg-pink-500/25 text-white' : 'text-white/80 hover:bg-white/10')
                  }
                >
                  <span
                    className={
                      'mt-px w-11 shrink-0 pt-px text-right font-mono text-[10.5px] ' +
                      (i === activeIdx ? 'text-pink-400 font-semibold' : 'text-white/50')
                    }
                  >
                    {formatClock(seg.startMs)}
                  </span>
                  <span
                    className={
                      'min-w-0 flex-1 text-[12px] leading-relaxed ' +
                      (i === activeIdx ? 'font-medium text-white' : 'text-white/85')
                    }
                  >
                    {seg.text}
                  </span>
                </button>
              </div>
            ))
          ) : (
            <div className="px-3 py-8 text-center text-[12px] leading-relaxed text-white/50">
              {transcriptNote ?? t('这条来源没有可用的转录。')}
            </div>
          )}
        </div>
      </div>

      {/* 下半部分：视频分段 */}
      <div className="flex h-[44%] shrink-0 flex-col border-t border-white/15 bg-black/40">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-1.5 bg-white/[0.02]">
          <div className="flex items-center gap-1.5 min-w-0">
            <ListTree size={14} className="text-pink-400 shrink-0" />
            <span className="text-[12px] font-semibold text-white/95 truncate">{t('视频分段')}</span>
            {chapterRows.length > 0 && (
              <span className="rounded bg-white/10 px-1.5 py-0.2 text-[10px] text-white/60 shrink-0">
                {chapterRows.length}
              </span>
            )}
          </div>
          {chaptersBusy && (
            <span className="flex items-center gap-1 text-[10.5px] text-pink-300">
              <Loader2 size={11} className="animate-spin" />
              {t('生成中…')}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 flex flex-col" style={chapterMaskStyle}>
          <div ref={chapterListRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {chapterRows.length ? (
              chapterRows.map((ch, i) => (
                <button
                  key={ch.startMs}
                  type="button"
                  onClick={() => seekMs(ch.startMs)}
                  title={ch.summary}
                  className={
                    'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition cursor-pointer ' +
                    (i === activeChapterIdx ? 'bg-pink-500/25 text-white' : 'text-white/80 hover:bg-white/10')
                  }
                >
                  <span
                    className={
                      'mt-px w-11 shrink-0 pt-px text-right font-mono text-[10.5px] ' +
                      (i === activeChapterIdx ? 'text-pink-400 font-semibold' : 'text-white/50')
                    }
                  >
                    {formatClock(ch.startMs)}
                  </span>
                  <span
                    className={
                      'min-w-0 flex-1 text-[12px] leading-relaxed ' +
                      (i === activeChapterIdx ? 'font-medium text-white' : 'text-white/85')
                    }
                  >
                    {ch.summary}
                  </span>
                </button>
              ))
            ) : chaptersBusy ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-[11.5px] text-white/60">
                <Loader2 size={16} className="animate-spin text-pink-400" />
                <span>{t('正在生成视频语义分段…')}</span>
              </div>
            ) : !hasTranscript ? (
              <div className="flex h-full items-center justify-center p-3 text-center text-[11.5px] text-white/40">
                {t('暂无可用字幕，无法分段')}
              </div>
            ) : totalTranscriptChars > 50000 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
                <p className="text-[11.5px] leading-relaxed text-amber-300">
                  {t('字幕共 {0} 字符（超出 50,000 字符限制）', totalTranscriptChars.toLocaleString())}
                </p>
                <p className="text-[10.5px] text-white/50">
                  {t('为避免超出上下文窗口，长视频需手动生成')}
                </p>
                <button
                  type="button"
                  onClick={() => void runChapters()}
                  className="mt-1 rounded-md bg-pink-600 px-3 py-1.5 text-[11.5px] font-medium text-white shadow transition hover:bg-pink-700 cursor-pointer"
                >
                  {t('手动生成分段')}
                </button>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-[11.5px] text-white/50">
                <span>{t('播放视频时将自动生成分段')}</span>
                <button
                  type="button"
                  onClick={() => void runChapters()}
                  className="rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/80 hover:bg-white/20 transition cursor-pointer"
                >
                  {t('立即生成分段')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  /* ---------- 绑定态：没有输入组件，自动解析 ---------- */
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-paper select-none">
      {/* 错误横幅 */}
      {error && (
        <div className="shrink-0 border-b border-red-400/30 bg-red-400/10 px-3 py-1.5 text-[12px] leading-relaxed text-red-500 dark:text-red-300">
          {error}
        </div>
      )}

      {source && relayUrl ? (
        <div className="relative min-h-0 flex-1 bg-black overflow-hidden">
          <VideoPlayer
            ref={playerRef}
            src={relayUrl}
            active={active}
            title={source.title}
            durationMs={source.durationMs}
            transcript={transcript}
            leftOverlay={leftOverlay}
            leftOverlayOpen={leftOverlayOpen}
            onToggleLeftOverlay={() => setLeftOverlayOpen((v) => !v)}
            sidePanel={sidePanel}
            subLabel={pageLabel}
            transitionStill={switchStill}
            chapters={chapterRows.length ? chapterRows : null}
            onToggleSidePanel={sidePanel ? toggleCollapsed : undefined}
            sidePanelOpen={!collapsed}
            onPlay={triggerAutoChaptersOnPlay}
            onTimeUpdate={(ms) => {
              setCurrentMs(ms)
              triggerAutoChaptersOnPlay()
              if (Math.abs(ms - lastProgressRef.current) >= 5000) {
                lastProgressRef.current = ms
                onProgress?.(ms, currentSourceRef.current)
              }
            }}
            onSeeked={(ms) => {
              setCurrentMs(ms)
              lastProgressRef.current = ms
              onProgress?.(ms, currentSourceRef.current)
            }}
            onExternalSubtitleLoaded={(extTranscript) => {
              setTranscript(extTranscript)
              setTranscriptNote(null)
            }}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center select-none">
          {busy ? (
            <>
              <Loader2 size={26} className="animate-spin text-seal/70" />
              <p className="text-[12px] text-ink-faint">{t('正在解析视频来源…')}</p>
            </>
          ) : (
            <>
              <MonitorPlay size={30} className="text-seal/50" />
              <p className="max-w-[420px] text-[12px] leading-relaxed text-ink-faint">
                {t('这个视频还没有解析出来：检查插件是否已启用、凭据是否配好，然后重新打开本页签。')}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 创建态的表单字段（插件 createFields 的渲染）。
 */
function CreateField({
  field,
  value,
  onChange,
}: {
  field: PluginSettingField
  value: string | number | boolean | undefined
  onChange: (v: string | number | boolean) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      {field.type !== 'static' && (
        <span className="text-[11.5px] font-medium text-ink">
          {field.label}
          {field.required && <span className="ml-0.5 text-seal">*</span>}
        </span>
      )}
      {field.type === 'static' ? (
        <p className="text-[11px] leading-relaxed text-ink-faint">{field.label}</p>
      ) : field.type === 'boolean' ? (
        <button
          type="button"
          onClick={() => onChange(value !== true)}
          className={
            'flex h-7 w-11 items-center rounded-full px-0.5 transition ' +
            (value === true ? 'justify-end bg-seal' : 'justify-start bg-line-strong')
          }
          aria-pressed={value === true}
        >
          <span className="h-6 w-6 rounded-full bg-card shadow" />
        </button>
      ) : field.type === 'select' ? (
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-lg border border-line bg-card px-2 py-1.5 text-[12px] text-ink outline-none focus:border-seal/50"
        >
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          value={String(value ?? '')}
          placeholder={field.placeholder}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-lg border border-line bg-card px-2 py-1.5 font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-faint focus:border-seal/50"
        />
      ) : (
        <input
          type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
          className="rounded-lg border border-line bg-card px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-seal/50"
        />
      )}
      {field.help && <span className="text-[10.5px] leading-relaxed text-ink-faint">{field.help}</span>}
    </label>
  )
}
