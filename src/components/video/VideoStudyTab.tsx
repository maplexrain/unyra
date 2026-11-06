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
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Clapperboard, Download, Loader2, MonitorPlay, Plus, Puzzle, Sparkles } from 'lucide-react'
import { t } from '../../i18n'
import { isWeb, native } from '../../lib/native'
import { fadeMask, useScrollEdges } from '../../lib/scrollFade'
import { matchVideoPlugin, resolveVideoSource, resolveVideoTranscript, videoSourcePlugins } from '../../lib/videoPlugins'
import { openRelayStream } from '../../video/registry'
import { buildPagesMarkdown, type PagesExportEntry } from '../../video/export'
import { formatClock, segmentIndexAt } from '../../video/transcript'
import { summarizeVideoRecap } from '../../learn/video/summarize'
import type { Transcript, VideoSource } from '../../video/types'
import type { PluginSettingField } from '../../lib/plugins'
import type { VideoRecap, VideoResource } from '../../learn/types'
import { registerVideoAudio } from '../../learn/video/videoRegistry'
import VideoPlayer, { type VideoPlayerHandle } from './VideoPlayer'

/** 创建态的输入记忆：下次打新建视频，上次粘的链接还在 */
const INPUT_KEY = 'moji.video.input'
/** 合集列表收起与否：跟输入一样落在 localStorage，重启后保持上次的选择 */
const COLLAPSED_KEY = 'moji.video.collapsed'
/** 自动总结（用户设置）：打开视频就自动生成内容总结与分段 */
const AUTO_RECAP_KEY = 'moji.video.autoRecap'
/** 底部区的分栏门槛：不到用它就还是三页签（用户定的 700px） */
const SPLIT_MIN_WIDTH = 700

const readLastInput = (): string => {
  try {
    return localStorage.getItem(INPUT_KEY) ?? ''
  } catch {
    return ''
  }
}

const readCollapsed = (): boolean => {
  try {
    // 默认**收起**（用户定的）：没存过就按收起算，展开过一次才记住
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
  /** AI 视频总结完成（内容总结 + 语义分段**一次生成**）：按**当前来源**写进资源；生成过就没有再次入口 */
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
   * 空输入或无插件认领都是 null——界面上分别给「请输入」与「没有插件认领」两种提示。
   */
  const matched = useMemo(() => {
    if (bound) return null
    const text = input.trim()
    if (!text) return null
    return matchVideoPlugin(text)
  }, [bound, input])
  // 记忆化：空数组兜底不能每次渲染新建一个，否则下面的 useMemo 永远失效
  const createFields = useMemo<PluginSettingField[]>(() => matched?.plugin.createFields ?? [], [matched])
  /**
   * 创建态：插件的 createFields 值。
   * 默认值在渲染期推导（换插件自动换一套），用户改动只记「覆盖项」——
   * 不用 effect 里 setState，换插件那一瞬也不会闪一帧空表单。
   */
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
  /** 播放器此刻的位置（ms）：timeupdate 约 4Hz，直接跟着走足够高亮与自动滚动用 */
  const [currentMs, setCurrentMs] = useState(0)
  /**
   * 当前解析的是哪一项（选集 source）的**渲染期**读数：currentSourceRef 是给回调用的，
   * 状态这份给「这一集的分段点」用（换集/续播解析完就跟着换）。
   */
  const [currentSource, setCurrentSource] = useState(() => video?.selection?.source ?? video?.input ?? '')
  /** AI 视频总结进行中（生成按钮转圈、禁点；总结与分段**合在同一个动作**） */
  const [recapBusy, setRecapBusy] = useState(false)
  /** 底部区的页签：字幕（转录列表）/ 总结（内容描述）/ 视频分段（章节行）——只在**窄**布局用 */
  const [bottomTab, setBottomTab] = useState<'sub' | 'summary' | 'chapters'>('sub')
  /** 自动总结（用户设置，localStorage）：打开视频就自动生成总结与分段 */
  const [autoRecap, setAutoRecap] = useState(() => {
    try {
      return localStorage.getItem(AUTO_RECAP_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleAutoRecap = useCallback(() => {
    setAutoRecap((v) => {
      const next = !v
      try {
        localStorage.setItem(AUTO_RECAP_KEY, next ? '1' : '0')
      } catch {
        // 会话内生效即可
      }
      return next
    })
  }, [])
  /** 底部区够不够宽走**分栏**（左字幕、右总结+分段）；不够就还是三页签。实测驱动，不由窗口猜 */
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const el = bottomRef.current
    if (!el) return
    const measure = () => setWide(el.clientWidth > SPLIT_MIN_WIDTH)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [relayUrl])
  /** 合集列表收起与否（用户可收起；选择落 localStorage，重启保持） */
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
  /** 面板容器：判断「点的是不是面板里面」（外点自动收起用） */
  const panelRef = useRef<HTMLDivElement | null>(null)
  const collapsePanel = useCallback(() => {
    setCollapsed(true)
    try {
      localStorage.setItem(COLLAPSED_KEY, '1')
    } catch {
      // 会话内生效即可
    }
  }, [])
  /**
   * 点面板外任意处 → 自动收起（用户定的）。
   * 捕获阶段监听 pointerdown：视频区的点击、控件栏、空白处都算「外面」；
   * 控件栏那颗开关要放行（它自己负责开合，否则 pointerdown 先收起、click 又打开）。
   */
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
  /** 合集字幕批量导出进度；null = 没在导出 */
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null)
  /** 换集幕布：点下一集时先冻结当前帧，新流首帧到了由播放器淡出 */
  const [switchStill, setSwitchStill] = useState<{ token: string; src: string } | null>(null)

  const playerRef = useRef<VideoPlayerHandle | null>(null)

  /**
   * 音频控制登记（见 learn/video/videoRegistry）：页签条上的快捷静音按钮跨组件
   * 读 / 写播放器自己的静音态。流解析出来（relayUrl 就绪、播放器挂载）那一刻
   * <video> 元素才存在，所以登记跟着 relayUrl 重挂一次把元素带上。
   */
  useEffect(() => {
    if (!tabId) return
    registerVideoAudio(tabId, {
      getMuted: () => playerRef.current?.getMuted() ?? false,
      setMuted: (muted) => playerRef.current?.setMuted(muted),
      element: playerRef.current?.getVideoElement() ?? null,
    })
    return () => registerVideoAudio(tabId, null)
  }, [tabId, relayUrl])
  /** 上次上报进度时的位置：节流用（每 5 秒最多写一次存档） */
  const lastProgressRef = useRef(0)
  /** 当前解析的是哪一项（选集 source）：进度要带上它，别把上一集的进度续到这一集 */
  const currentSourceRef = useRef<string>('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const edges = useScrollEdges(listRef)

  const segments = transcript?.segments ?? []
  /** 播放推进到哪一段：段间空隙（-1）时全部行保持素净 */
  const activeIdx = segments.length ? segmentIndexAt(segments, currentMs) : -1

  /** 当前来源的内容总结与分段（**生成过就不再生成**：底部两个页签与进度条分段点都读它们） */
  /** 当前来源的总结（内容描述 + 语义分段**一份**）：进度条分段点、底部两个页签都读它 */
  const recapOfSource = video?.recaps?.[currentSource] ?? null
  const summaryOfSource = recapOfSource?.summary ?? ''
  const chapterRows = recapOfSource?.chapters ?? []
  /** 当前播放落在哪个分段（-1 = 还没分段 / 段间）；分段行的高亮用 */
  const activeChapterIdx = chapterRows.length
    ? chapterRows.reduce((acc, ch, i) => (currentMs >= ch.startMs ? i : acc), -1)
    : -1

  /**
   * 解析一轮：换流 → 更新整页。错误原话进横幅（库抛什么显示什么，不做预判文案）。
   * fields 是视频级的 createFields 值（创建时填的），与插件全局配置在宿主合并。
   */
  const runResolve = useCallback(
    async (text: string, fields?: Record<string, string | number | boolean>) => {
      if (!text || busy) return
      // 换集过渡：先冻结当前帧（此刻抓，解析期间旧画面照播）；播放器会在新流挂上、
      // 首帧未到时才把这帧亮出来盖住黑屏
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
        // 三种状态说三种话：拿到了 / 试过但失败（原话上屏）/ 真没有
        if (src.transcript) setTranscriptNote(null)
        else if (src.transcriptError) setTranscriptNote(t('字幕获取失败：{0}', src.transcriptError))
        else setTranscriptNote(t('这条来源没有字幕：需要登录的平台，请到「设置 → 插件」的插件配置里填好凭据后重试。'))
        setCurrentMs(0)
        currentSourceRef.current = text
        setCurrentSource(text)
        lastProgressRef.current = 0
        onResolved?.(src.title)
        // 选集切换（合集项 / 分 P）：把那串输入记进资源，重开页签回到同一集
        if (video && text !== (video.selection?.source ?? video.input)) onSelection?.(text, src.title)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [busy, onResolved, video, onSelection],
  )

  /*
   * 绑定态：进页即自动解析一次（按资源 id 记账——store 更新标题/进度会重渲染，
   * 但不再重解析）。解析的**起点**是停下的那一集（selection），没有才是创建时的输入。
   */
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
   * 进度落盘的两条路：
   * - timeupdate 每 5 秒最多上报一次（节流在下面播放器回调里）；
   * - 暂停 / 播完立刻补一次——这两个时刻用户「走了」，最后 5 秒不能丢。
   */
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

  /**
   * 续播：解析出流之后跳回上次位置（太靠前 / 已到片尾就不折腾）。
   * **只在进度属于当前这一项时**才跳——换了选集还跳旧进度就是回到别的集上了。
   */
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

  /** 创建：把「插件 + 输入 + 专属字段」交给工作区落库 */
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

  /**
   * 批量导出**当前视频全部分 P** 的选集字幕：逐 P 只取转录（专用通道，跳过播放地址）
   * → 拼一个 Markdown → 原生保存对话框落盘。一 P 失败不炸全局（那一节写
   * 「字幕缺失：原因」）；一条条来并留 150ms 间隙，别把 B 站风控招来。
   */
  /** 视频级字段的稳定引用：导出回调不因 video 对象每次更新（进度每 5 秒变）而重建 */
  const videoFieldsRef = useRef(video?.fields)
  useEffect(() => {
    videoFieldsRef.current = video?.fields
  }, [video?.fields])

  // 普通函数而不是 useCallback：只在按钮点击时调用，没有 memo 消费者；useCallback 反而让
  // React Compiler 的自动缓存降级（这条 async 循环里跨 await 的闭包它保留不了）
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
      // 视频级来源链接从任一分 P 的 source 里抠 BV 号拼回（分 P 的 source 都带 ?p=N）
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

  /** 点转录段 → 播放器 seek 到段首并起播 */
  const seekMs = useCallback((ms: number) => {
    playerRef.current?.seekMs(ms)
  }, [])

  /*
   * AI 视频总结（内容总结 + 语义分段，**合在同一个动作一次生成**）：
   * 不走导师 agent——内部的一次性补全（少提示词、思考档位 none，见 learn/video/summarize）。
   * 产出按当前来源写进资源：总结落在「总结」页签、分段变成进度条分段点与「视频分段」行。
   * **单个来源生成过就不再生成**：入口只在空态出现，run 函数里再守一道。
   * 失败原话进顶部横幅（与解析失败同一块），播放不打断。
   * 普通函数而不是 useCallback：与 exportPages 同一个理由（React Compiler 的
   * 自动缓存在这条 async 跨 await 闭包上保留不了）。
   */
  const runRecap = async () => {
    if (!transcript?.segments?.length || recapBusy || recapOfSource) return
    setRecapBusy(true)
    try {
      const recap = await summarizeVideoRecap({
        title: source?.title ?? video?.title ?? '',
        transcript,
      })
      onSaveRecap?.(currentSourceRef.current || currentSource, recap)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRecapBusy(false)
    }
  }

  /*
   * 自动总结（用户开了开关）：流解析出来、字幕可用、这一来源还没有总结时**自动跑一次**。
   * 每个来源只试一次（autoTriedRef 记账——失败也不在同一帧里反复重试，重开页签才再试）。
   * runRecap 是普通函数（身份随渲染变），经 ref 回填拿最新的一份（与 openTabRef 同一套）。
   */
  const autoTriedRef = useRef<Set<string>>(new Set())
  const runRecapRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    runRecapRef.current = runRecap
  })
  useEffect(() => {
    if (!autoRecap || !video || !relayUrl) return
    if (!transcript?.segments?.length) return
    const src = currentSourceRef.current || currentSource
    if (video.recaps?.[src]) return
    const key = video.id + '|' + src
    if (autoTriedRef.current.has(key)) return
    autoTriedRef.current.add(key)
    void runRecapRef.current()
  }, [autoRecap, video, relayUrl, transcript, currentSource])

  /** 当前段变了就把那行滚进视野（跟随定位：钉在可视区 20% 高度，用户定的） */
  useEffect(() => {
    const list = listRef.current
    const row = activeIdx >= 0 ? rowRefs.current[activeIdx] : null
    if (!list || !row) return
    /*
     * contentTop 必须是「行顶在滚动内容坐标系里的位置」——用 rect 差值现算，
     * 不用 offsetTop：那是相对 offsetParent（最近的定位祖先）量的，滚动容器
     * 自己没定位时量出来的是相对更外层的偏移，落点整个错掉（踩过）。
     */
    const contentTop = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop
    const max = Math.max(0, list.scrollHeight - list.clientHeight)
    const target = Math.max(0, Math.min(max, Math.round(contentTop - list.clientHeight * 0.2)))
    if (target !== list.scrollTop) list.scrollTo({ top: target, behavior: 'smooth' })
  }, [activeIdx, transcript])

  /* ---------- 浏览器（WebUI）模式：本地媒体通道不存在，整页给一句引导 ---------- */
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

  /* ---------- 创建态：输入 → 插件匹配 → 填该插件要的数据 → 创建 ---------- */
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

          {/* 就一个输入框 + 创建按钮（用户定的创建态形态） */}
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

          {/* 匹配结果：认领了就显示插件卡片与它要的数据 */}
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
   * 右侧悬浮面板（合集 / 选集）：交给**播放器根容器**渲染——全屏时也能打开。
   * 80% 高、垂直居中、离右边缘留缝；背景不做模糊（backdrop-blur 有性能代价）。
   */
  const currentPage = source?.pages?.find((p) => p.current)
  const pageLabel = currentPage ? 'P' + currentPage.page + ' ' + currentPage.title : undefined
  const sidePanel =
    source && (source.collection || source.pages) ? (
      <>
        {/* 面板本体：宽度过渡（300ms）；内容层钉死 320px，动画期间只裁不重排。
            开关只剩控件栏那一颗（边缘小竖条已按用户要求去掉）；点面板外任意处自动收起。 */}
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
      </>
    ) : null

  /*
   * 底部区的内容件（窄布局与分栏布局共用同几块，只换摆法）：
   * - 字幕列表（listRef 挂在谁身上，跟随定位就滚谁——两个布局各渲染一份，同时只挂一个）；
   * - 总结正文 / 生成分段行 / 空态生成入口（总结与分段**合在同一个动作**，空态两个页签给同一个按钮）。
   */
  const maskStyle = { maskImage: fadeMask(edges), WebkitMaskImage: fadeMask(edges) } as const
  const transcriptEl = (
    <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {segments.length ? (
        segments.map((seg, i) => (
          <div key={seg.startMs} ref={(el) => { rowRefs.current[i] = el }}>
            <button
              type="button"
              onClick={() => seekMs(seg.startMs)}
              className={
                'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition ' +
                (i === activeIdx ? 'bg-seal/10' : 'hover:bg-line/50')
              }
            >
              <span
                className={
                  'mt-px w-11 shrink-0 pt-px text-right font-mono text-[10.5px] ' +
                  (i === activeIdx ? 'text-seal' : 'text-ink-faint')
                }
              >
                {formatClock(seg.startMs)}
              </span>
              <span
                className={
                  'min-w-0 flex-1 text-[12.5px] leading-relaxed ' +
                  (i === activeIdx ? 'font-medium text-ink-strong' : 'text-ink')
                }
              >
                {seg.text}
              </span>
            </button>
          </div>
        ))
      ) : (
        <div className="px-3 py-8 text-center text-[12px] leading-relaxed text-ink-faint">
          {transcriptNote ?? t('这条来源没有可用的转录。')}
        </div>
      )}
    </div>
  )
  const summaryEl = (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-2.5">
      <p className="text-[12.5px] leading-relaxed text-ink">{summaryOfSource}</p>
    </div>
  )
  const chaptersEl = (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {chapterRows.map((ch, i) => (
        <button
          key={ch.startMs}
          type="button"
          onClick={() => seekMs(ch.startMs)}
          title={ch.summary}
          className={
            'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition ' +
            (i === activeChapterIdx ? 'bg-seal/10' : 'hover:bg-line/50')
          }
        >
          <span
            className={
              'mt-px w-11 shrink-0 pt-px text-right font-mono text-[10.5px] ' +
              (i === activeChapterIdx ? 'text-seal' : 'text-ink-faint')
            }
          >
            {formatClock(ch.startMs)}
          </span>
          <span
            className={
              'min-w-0 flex-1 text-[12.5px] leading-relaxed ' +
              (i === activeChapterIdx ? 'font-medium text-ink-strong' : 'text-ink')
            }
          >
            {ch.summary}
          </span>
        </button>
      ))}
    </div>
  )
  const hasTranscript = !!transcript?.segments?.length
  const recapEmptyEl = (
    <GenerateEmpty
      busy={recapBusy}
      busyLabel={t('正在总结…')}
      hint={
        hasTranscript
          ? t('还没有总结：按字幕让 AI 生成内容总结与语义分段，分段点会钉在进度条上（生成后不再重复）')
          : t('这条来源没有可用字幕，无法总结')
      }
      actionLabel={t('生成总结')}
      disabled={!hasTranscript}
      onRun={() => void runRecap()}
    />
  )
  /** 头行右侧的公共件：自动总结开关 + 时长 + 字幕来源徽章（两种布局都在；source 由调用处窄化后传入） */
  const metaRightOf = (src: VideoSource) => (
    <>
      <button
        type="button"
        onClick={toggleAutoRecap}
        title={
          autoRecap
            ? t('自动总结已开启：打开视频时自动生成内容总结与分段（点一下关闭）')
            : t('自动总结已关闭：打开视频时自动生成内容总结与分段（点一下开启）')
        }
        className={
          'flex h-6 w-6 shrink-0 items-center justify-center rounded transition hover:bg-line/60 ' +
          (autoRecap ? 'text-seal' : 'text-ink-faint')
        }
      >
        <Sparkles size={13} />
      </button>
      {src.durationMs ? (
        <span className="shrink-0 font-mono text-[10.5px] text-ink-faint">{formatClock(src.durationMs)}</span>
      ) : null}
      {transcript ? (
        <span className="shrink-0 rounded border border-line bg-paper px-1.5 py-px text-[10px] text-ink-faint">
          {(transcript.origin === 'subtitle' ? t('字幕') : t('语音识别')) +
            (transcript.language
              ? ' · ' +
                (transcript.language === 'ai-zh'
                  ? t('AI 中文字幕')
                  : /^(zh-Hans|zh-CN)$/i.test(transcript.language)
                    ? t('中文字幕')
                    : transcript.language)
              : '')}
        </span>
      ) : null}
    </>
  )

  /* ---------- 绑定态：没有输入组件，自动解析 ---------- */
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-paper select-none">
      {/* 错误横幅：解析或登记流的失败原话 */}
      {error && (
        <div className="shrink-0 border-b border-red-400/30 bg-red-400/10 px-3 py-1.5 text-[12px] leading-relaxed text-red-500 dark:text-red-300">
          {error}
        </div>
      )}

      {source && relayUrl ? (
        <>
          {/* 播放器铺满整格；合集/选集改成**浮在画面上的右侧悬浮窗**（用户定的） */}
          <div className="min-h-0 flex-1 bg-black">
              {/*
                **不要给播放器绑 key**：选集切换会换流，重建组件等于把全屏元素
                （requestFullscreen 的那个容器）从 DOM 里摘掉，浏览器会立刻退出全屏
                （实测）。换源由播放器内部在同一只 <video> 上 load() 完成。
              */}
              <VideoPlayer
                ref={playerRef}
                src={relayUrl}
                active={active}
                title={source.title}
                durationMs={source.durationMs}
                transcript={transcript}
                sidePanel={sidePanel}
                subLabel={pageLabel}
                transitionStill={switchStill}
                chapters={chapterRows.length ? chapterRows : null}
                // 选集列表开关：有列表才给按钮（没有列表时控件栏不画这一颗）
                onToggleSidePanel={sidePanel ? toggleCollapsed : undefined}
                sidePanelOpen={!collapsed}
                onTimeUpdate={(ms) => {
                  setCurrentMs(ms)
                  // 节流：每 5 秒最多存一次；暂停/播完另有即时落盘（见上面的 effect）
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
          {/*
            底部区：字幕 / 总结 / 视频分段。**宽度 ≤700px 用三页签，更宽用分栏**
            （左栏字幕、右栏总结在上+分段在下——实测 bottomRef 的宽度，不由窗口猜）。
            总结与分段合在同一个动作：空态给同一个「生成总结」，生成过就只有内容。
          */}
          <div ref={bottomRef} className="flex h-[30%] shrink-0 flex-col border-t border-line">
            <div className="flex shrink-0 items-center gap-0.5 border-b border-line bg-card/40 px-2 py-1">
              {!wide &&
                ([
                  ['sub', t('字幕')],
                  ['summary', t('总结')],
                  ['chapters', t('视频分段')],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setBottomTab(key)}
                    className={
                      'rounded-md px-2 py-0.5 text-[11.5px] font-medium transition ' +
                      (bottomTab === key ? 'bg-seal/10 text-seal-deep' : 'text-ink-faint hover:bg-line/50 hover:text-ink')
                    }
                  >
                    {label}
                  </button>
                ))}
              <span className="min-w-0 flex-1" />
              {metaRightOf(source)}
            </div>

            {wide ? (
              /* 分栏三栏：字幕 | 总结 | 视频分段，各占一列（总结与分段放一栏太挤，用户定的） */
              <div className="flex min-h-0 flex-1">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-line">
                  <div className="shrink-0 px-3 pb-0.5 pt-1.5 text-[10.5px] font-medium text-ink-faint">{t('字幕')}</div>
                  <div className="flex min-h-0 flex-1 flex-col" style={maskStyle}>
                    {transcriptEl}
                  </div>
                </div>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-line">
                  <div className="shrink-0 px-3 pb-0.5 pt-1.5 text-[10.5px] font-medium text-ink-faint">{t('总结')}</div>
                  {summaryOfSource ? (
                    summaryEl
                  ) : recapOfSource ? (
                    /* 残缺数据（手改过）：总结文本缺失，合并动作生成过就不再生成 */
                    <div className="flex flex-1 items-center justify-center px-4 text-center text-[11px] text-ink-faint">
                      {t('总结文本缺失（数据不完整）')}
                    </div>
                  ) : (
                    <div className="flex min-h-0 flex-1 flex-col">{recapEmptyEl}</div>
                  )}
                </div>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <div className="shrink-0 px-3 pb-0.5 pt-1.5 text-[10.5px] font-medium text-ink-faint">
                    {t('视频分段')}
                  </div>
                  {chapterRows.length ? (
                    chaptersEl
                  ) : (
                    <div className="flex flex-1 items-center justify-center px-4 text-center text-[11px] text-ink-faint">
                      {recapBusy ? (
                        <span className="flex items-center gap-1.5">
                          <Loader2 size={12} className="animate-spin text-seal/70" />
                          {t('正在总结…')}
                        </span>
                      ) : (
                        t('分段会与总结一并生成')
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* 窄：三页签（内容区 mask 挂外层、滚动留内层，见 scrollFade 的说明） */
              <div className="flex min-h-0 flex-1 flex-col" style={maskStyle}>
                {bottomTab === 'sub' ? (
                  transcriptEl
                ) : bottomTab === 'summary' ? (
                  summaryOfSource ? (
                    summaryEl
                  ) : (
                    recapEmptyEl
                  )
                ) : chapterRows.length ? (
                  chaptersEl
                ) : (
                  recapEmptyEl
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        /* 绑定态还没解析出来：给在途提示；失败已在上方横幅里 */
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
 * 底部「总结 / 视频分段」页签的空态：一句说明 + 生成按钮（进行中给转圈）。
 * **生成过的来源不会走到这里**（页签直接渲染内容）——这就是「不能重复生成」的守卫。
 */
function GenerateEmpty({
  busy,
  busyLabel,
  hint,
  actionLabel,
  disabled,
  onRun,
}: {
  busy: boolean
  busyLabel: string
  hint: string
  actionLabel: string
  disabled?: boolean
  onRun: () => void
}) {
  if (busy) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[12px] text-ink-faint">
        <Loader2 size={14} className="animate-spin text-seal/70" />
        {busyLabel}
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2.5 p-4 text-center">
      <p className="max-w-[380px] text-[11.5px] leading-relaxed text-ink-faint">{hint}</p>
      <button
        type="button"
        disabled={disabled}
        onClick={onRun}
        className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-paper transition hover:bg-ink-strong disabled:pointer-events-none disabled:opacity-35"
      >
        {actionLabel}
      </button>
    </div>
  )
}

/**
 * 创建态的表单字段（插件 createFields 的渲染）。
 * 与设置页的插件表单同一套字段类型，但值只属于**这一个视频**（创建时落库）。
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
