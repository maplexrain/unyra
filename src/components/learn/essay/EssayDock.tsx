/**
 * 随笔：文档区右下角那颗**悬浮按钮**，以及它展开之后的那扇小窗口。
 *
 * 四件事写在前面：
 *
 * 1. **按钮变成窗口**。收起时是一颗圆按钮（点它、或双击 Shift，见 lib/useDoubleShift），
 *    点开的那一刻它不再是「消失 + 另弹一块」：窗口从按钮的位置与尺寸出发，圆角从正圆
 *    过渡到方角，边长大到窗口大小（动的是 left / top / width / height / border-radius，
 *    不是等比缩放——那会把字拉变形）。收起时原路缩回按钮，动画播完才卸载（见 lib/presence）。
 * 2. **没有「新建」按钮**。随笔的粒度小到不值得一次确认：写下第一个字，它当场成一条
 *    （去抖 400ms 之后落库，见 learn/essays）。清空再写就是下一条；空文本永远不落盘。
 *    随笔**不再拿日期当唯一标识**：每条有 id 与可改的 title（默认取当天日期），
 *    想开几条开几条；打开窗口时接着**最近的一条**写，一条都没有就自动备好一条新的
 *    （标题已填今天的日期，写下第一个字才真正落一条）。
 * 3. **顶部下拉选随笔**（用户定的）：不再在左边占一列列表——窗口只有一扇，正文才是主角。
 *    「笔记」页签只列**当前目标**的笔记（不跨目标）：随笔本身是目标级的，翻到别的课
 *    的笔记会让归属乱掉。
 *    下拉里按标题列，正文上方有一行标题输入框，随时改名；另有一项「空白（新的一条）」。
 *    提交页与提交详情里同理：摆的是标题，旧的提交快照没有标题才按日期回退。
 * 4. **提交像 git**（见 learn/essayCommits）：把这一批随笔封成快照，交给 Agent 整理进
 *    知识树对应节点的笔记；整理结果（新建 / 更新了哪几份笔记）与 Agent 的**提交评论**
 *    （Markdown，首行是标题）记在这次提交上。每次提交都封存**全部随笔**（需求定的），
 *    所以提交记录是目标级的：历史与详情都按整次提交展示，不再按某一条随笔切分。
 *    历史排成 timeline：每个节点只摆「日期 + 评论标题」，全文点开详情再看。
 *
 * 窗口能拖、能拉右下角改大小，几何存在 state.json（见 learn/types 的 EssayDockRect）：
 * 下次打开还在你摆的那个位置；**没摆过时的默认是视口居中、500×700**。打开那一刻要
 * 重新夹一遍视口——上次是 1440 宽的屏，这次可能只有 900，存下来的坐标必须当场收回来
 * （见 clampRect）。窗口开着时，**点窗口外面的任何东西都直接收起**：随笔是随手记，
 * 注意力走了窗口就该让路（Esc 同效）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft,
  BookOpen,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  GitCommitHorizontal,
  History,
  Loader2,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import type { DockNoteItem, EssayCommit, EssayDockRect, EssayDockState, EssayEntry } from '../../../learn/types'
import { ESSAY_DOCK_MIN_H, ESSAY_DOCK_MIN_W, essayPreview, dayOfEssay } from '../../../learn/essays'
import { changesSummary, diffEssaysAgainst, essayCommentTitle } from '../../../learn/essayCommits'
import { usePresence } from '../../../lib/presence'
import { renderNote } from '../../../lib/markdown'
import { t } from '../../../i18n'
import MarkdownView from '../../MarkdownView'
import EssayEditor from './EssayEditor'

/** 默认尺寸（用户定的）：500×700，居中摆——够写一段、读一段历史，也不偏到角落去 */
const DEFAULT_W = 500
const DEFAULT_H = 700
/** 自动落库的去抖：一直在打字就不写盘，停手这么久才落一条 */
const SAVE_MS = 400
/** 圆 → 方的变形时长；与 CSS 过渡、退场时序同一个数 */
const MORPH_MS = 260
/** 方窗口的圆角（变形终点） */
const PANEL_RADIUS = 16
/** 内容晚一点再淡入：先让盒子长开，字再跟上，才不会在 44px 的圆里挤成一团 */
const CONTENT_DELAY_MS = 140

/** 变形中的几何：x/y/w/h + 圆角（按钮是正圆，窗口是 16px） */
interface Box {
  x: number
  y: number
  w: number
  h: number
  r: number
}

/** 窗口里的子块：提交确认 / 提交历史 / 某次提交的详情（主要列表/编辑由 tab 与二级状态决定） */
type SubPanel = 'main' | 'commit' | 'history' | 'detail'

/**
 * 没存过几何时的位置：**视口居中**（用户定的）。量不到按钮也无所谓——
 * 变形动画的起点仍由按钮那颗圆决定（见 boxOfButton），终点落在这里。
 */
function defaultRect(): EssayDockRect {
  const w = Math.min(DEFAULT_W, Math.max(ESSAY_DOCK_MIN_W, window.innerWidth - 24))
  const h = Math.min(DEFAULT_H, Math.max(ESSAY_DOCK_MIN_H, window.innerHeight - 24))
  return {
    x: Math.max(8, Math.round((window.innerWidth - w) / 2)),
    y: Math.max(8, Math.round((window.innerHeight - h) / 2)),
    w,
    h,
  }
}

/** 夹进视口：窗口不许被拖到看不见的地方（拖出去就再也抓不回来了） */
function clampRect(r: EssayDockRect): EssayDockRect {
  const maxW = Math.max(ESSAY_DOCK_MIN_W, window.innerWidth - 24)
  const maxH = Math.max(ESSAY_DOCK_MIN_H, window.innerHeight - 24)
  const w = Math.min(Math.max(ESSAY_DOCK_MIN_W, r.w), maxW)
  const h = Math.min(Math.max(ESSAY_DOCK_MIN_H, r.h), maxH)
  return {
    ...r,
    w,
    h,
    x: Math.min(Math.max(8, r.x), Math.max(8, window.innerWidth - w - 8)),
    y: Math.min(Math.max(8, r.y), Math.max(8, window.innerHeight - h - 8)),
  }
}

/** 日期：月日，跨年才带年份。列表与下拉都不写钟点（用户定的：随笔按天归属） */
function dateLabelOfEssay(ts: number): string {
  const day = dayOfEssay(ts)
  const [y, m, d] = day.split('-')
  const sameYear = String(new Date().getFullYear()) === y
  return sameYear
    ? t('{0} 月 {1} 日', String(Number(m)), String(Number(d)))
    : t('{0} 年 {1} 月 {2} 日', y, String(Number(m)), String(Number(d)))
}

/** 提交记录里的时间：日期 + 钟点（历史里知道「哪一天几点提交的」是有用的） */
function timeLabel(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return dateLabelOfEssay(ts) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** 从一颗圆按钮长成方窗口：起点的圆角与尺寸都由按钮自己决定 */
function boxOfButton(el: HTMLElement): Box {
  const b = el.getBoundingClientRect()
  return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.width / 2 }
}

/** 状态徽章：整理中 / 已整理 / 整理失败 */
function StatusBadge({ status }: { status: EssayCommit['status'] }) {
  const tone =
    status === 'done'
      ? 'bg-ok/10 text-ok-text'
      : status === 'error'
        ? 'bg-warn/10 text-warn-deep'
        : 'bg-line/70 text-ink-faint'
  const label = status === 'done' ? t('已整理') : status === 'error' ? t('整理失败') : t('整理中')
  return <span className={'shrink-0 rounded px-1.5 py-px text-[10px] leading-4 ' + tone}>{label}</span>
}

interface Props {
  /** 这些随笔属于哪个目标（随笔是目标级的，见 learn/essays） */
  goalId: string
  /** 这一屏要不要显示入口（只在教学文档上露脸） */
  showEntry: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 这个目标的随笔（新的在前） */
  essays: EssayEntry[]
  /** 这个目标的提交记录（新的在前） */
  commits: EssayCommit[]
  /** 提交一批随笔：返回新提交的 id（界面据此打开详情）；没有可提交的返回 null */
  onCommit: (message: string) => string | null
  /** 重试一次失败的整理（快照还在，不必重新提交） */
  onRetryCommit: (id: string) => void
  /** 从提交详情里或笔记项打开一份笔记到主工作区 */
  onOpenNote: (nodeId: string, noteName: string) => void
  /** 上次存下来的窗口状态与几何（没有就用默认位置） */
  geometry: EssayDockState | null
  onGeometry: (state: EssayDockState) => void
  /** 写下第一个字时落一条（标题缺省取当天日期）；返回新条目的 id（空文本返回 null，什么都不做） */
  onCreate: (goalId: string, title: string, text: string) => string | null
  /** 改一条：给了谁改谁（正文 / 标题），去抖后调 */
  onUpdate: (goalId: string, id: string, patch: { text?: string; title?: string }) => void
  onDelete: (goalId: string, id: string) => void

  /** 当前目标下所有节点的笔记（不跨目标，见 LearnWorkspace 的 dockNotes） */
  allNotes?: DockNoteItem[]
  /** 写入节点笔记 */
  onWriteNote?: (nodeId: string, noteName: string, content: string) => void
  /** 删除节点笔记 */
  onDeleteNote?: (nodeId: string, noteName: string) => void
}

/**
 * 窗口级指针拖拽的装/拆（拖动浮窗、拖右下角改大小共用）。
 *
 * 三件事缺一不可：`setPointerCapture`（拖出窗口再松手时 up 仍会派发到元素）、
 * `pointerup` / `pointercancel`（正常收尾）、`blur`（拖动途中 Alt+Tab 切走）。
 * 只写前两条的话，那一次没人收到的 up 会把三个监听连同闭包永久留在 window 上，
 * 每漏一次多一份——用久了拖拽会越来越迟钝，而且只有重载才清得掉。
 */
function bindWindowDrag(
  el: HTMLElement,
  pointerId: number,
  onMove: (ev: PointerEvent) => void,
  onEnd: () => void,
): void {
  try {
    el.setPointerCapture(pointerId)
  } catch {
    // 不支持捕获的环境：靠 blur 兜底
  }
  const end = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    window.removeEventListener('blur', end)
    try {
      el.releasePointerCapture(pointerId)
    } catch {
      // 元素已经卸载 / 早就释放了：无所谓
    }
    onEnd()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
  window.addEventListener('blur', end)
}

export default function EssayDock({
  goalId,
  showEntry,
  open,
  onOpenChange,
  essays,
  commits,
  onCommit,
  onRetryCommit,
  onOpenNote,
  geometry,
  onGeometry,
  onCreate,
  onUpdate,
  onDelete,
  allNotes = [],
  onWriteNote,
  onDeleteNote,
}: Props) {
  // 退场要等变形播完才卸载：130ms 那套默认时序会把缩回去的动画切掉一半
  const { setOpen: setMounted, mounted } = usePresence(false, MORPH_MS + 20)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  /** 挂出来的那扇窗口：点外关闭用它判断「这一下落在不在窗口里」 */
  const panelRef = useRef<HTMLDivElement | null>(null)

  // 开合时序交给 usePresence：退场动画播完才卸载（与其它浮层同一条规矩）
  useEffect(() => {
    setMounted(open)
  }, [open, setMounted])

  const [rect, setRect] = useState<EssayDockRect>(() => clampRect(geometry ?? defaultRect()))
  const rectRef = useRef(rect)

  /**
   * 变形中的盒子：null = 就停在 rect 上（常态）。
   * 展开/收起的那 260ms 里它是有值的，CSS 过渡负责补间，播完再清掉。
   */
  const [morph, setMorph] = useState<Box | null>(null)
  /** 内容（标题栏、正文）要不要露出来：变形途中先藏着，免得在 44px 的圆里挤成一团 */
  const [contentIn, setContentIn] = useState(false)
  /** 拖 / 改大小的那一刻关掉过渡：跟着指针走要立刻响应，不能有 260ms 的拖尾 */
  const [moving, setMoving] = useState(false)
  /** 量不到按钮时的退场（双击 Shift 在非教学文档上唤出、又在那里收起）：只能淡出 */
  const [fade, setFade] = useState(false)
  const contentTimer = useRef<number | null>(null)
  /** 双 rAF 的收尾令牌：关得比开得快时，旧的那一段不许再把状态写回去 */
  const morphSeq = useRef(0)

  /** 当前选中的固定 Tab：随笔 或 笔记 */
  const [dockTab, setDockTab] = useState<'essay' | 'note'>(() => geometry?.activeTab ?? 'essay')
  const dockTabRef = useRef(dockTab)
  useEffect(() => {
    dockTabRef.current = dockTab
  }, [dockTab])

  /** 子面板：main = 列表或编辑区；commit / history / detail 为提交相关流程 */
  const [subPanel, setSubPanel] = useState<SubPanel>('main')
  /** 正在看哪一条提交；null = 没打开详情 */
  const [detailId, setDetailId] = useState<string | null>(null)
  /** 详情是从哪儿进去的：返回时回到那儿（history / 刚提交完） */
  const [detailBack, setDetailBack] = useState<'main' | 'history'>('history')
  /** 提交说明（打开提交页时给一句默认的） */
  const [commitMessage, setCommitMessage] = useState('')

  /* ---------- 随笔状态（目标级） ---------- */
  /** 正在编辑哪一条随笔；null = 随笔列表（一级页面），'__blank__' = 新建空白随笔，或随笔 id */
  const [editingId, setEditingId] = useState<string | null>(() => {
    if (geometry?.essayEditingId === '__blank__') return '__blank__'
    if (geometry?.essayEditingId && essays.some((e) => e.id === geometry.essayEditingId)) {
      return geometry.essayEditingId
    }
    return null
  })
  const editingRef = useRef<string | null>(editingId)
  useEffect(() => {
    editingRef.current = editingId
  }, [editingId])

  const initialEssay = editingId && editingId !== '__blank__' ? essays.find((e) => e.id === editingId) : null
  const [text, setText] = useState(initialEssay?.text ?? '')
  const textRef = useRef(text)
  const [title, setTitle] = useState(initialEssay?.title ?? (editingId === '__blank__' ? dateLabelOfEssay(Date.now()) : ''))
  const titleRef = useRef(title)

  /* ---------- 笔记状态（节点级） ---------- */
  /** 笔记列表搜索过滤词 */
  const [noteSearch, setNoteSearch] = useState('')
  /** 选中的笔记（二级页面）；null = 笔记列表（一级页面） */
  const [noteTarget, setNoteTarget] = useState<{ nodeId: string; noteName: string; goalId?: string } | null>(() => {
    const t = geometry?.noteTarget
    if (t && allNotes?.some((n) => n.nodeId === t.nodeId && n.name === t.noteName)) {
      return t
    }
    return null
  })
  const noteTargetRef = useRef(noteTarget)
  useEffect(() => {
    noteTargetRef.current = noteTarget
  }, [noteTarget])

  /** 笔记二级页面模式：可自由切换预览与编辑模式 */
  const [noteViewMode, setNoteViewMode] = useState<'edit' | 'preview'>(() => geometry?.noteViewMode ?? 'preview')
  const noteViewModeRef = useRef(noteViewMode)
  useEffect(() => {
    noteViewModeRef.current = noteViewMode
  }, [noteViewMode])

  const currentNoteItem = useMemo(() => {
    if (!noteTarget || !allNotes) return null
    return allNotes.find((n) => n.nodeId === noteTarget.nodeId && n.name === noteTarget.noteName) ?? null
  }, [allNotes, noteTarget])

  const filteredNotes = useMemo(() => {
    if (!allNotes) return []
    if (!noteSearch.trim()) return allNotes
    const q = noteSearch.trim().toLowerCase()
    return allNotes.filter(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        n.goalTitle.toLowerCase().includes(q) ||
        n.nodeTitle.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q),
    )
  }, [allNotes, noteSearch])

  const [noteText, setNoteText] = useState(() => currentNoteItem?.content ?? '')
  const noteTextRef = useRef(noteText)
  const noteTimerRef = useRef<number | null>(null)
  const noteDirtyRef = useRef(false)

  // 当外部 noteItem 更新时同步正文（仅在没有本地未保存改动时）
  useEffect(() => {
    if (currentNoteItem && !noteDirtyRef.current) {
      setNoteText(currentNoteItem.content)
      noteTextRef.current = currentNoteItem.content
    }
  }, [currentNoteItem])

  /** 持久化当前状态到 state.json */
  const persistState = useCallback(
    (patch: Partial<EssayDockState>) => {
      onGeometry({
        ...rectRef.current,
        activeTab: dockTabRef.current,
        essayEditingId: editingRef.current,
        noteTarget: noteTargetRef.current,
        noteViewMode: noteViewModeRef.current,
        ...patch,
      })
    },
    [onGeometry],
  )

  /** 笔记保存：去抖写入 store */
  const flushNote = useCallback(() => {
    if (noteTimerRef.current !== null) {
      window.clearTimeout(noteTimerRef.current)
      noteTimerRef.current = null
    }
    if (!noteDirtyRef.current || !noteTargetRef.current || !onWriteNote) return
    noteDirtyRef.current = false
    onWriteNote(noteTargetRef.current.nodeId, noteTargetRef.current.noteName, noteTextRef.current)
  }, [onWriteNote])

  const handleNoteTextChange = useCallback(
    (next: string) => {
      noteTextRef.current = next
      setNoteText(next)
      noteDirtyRef.current = true
      if (noteTimerRef.current !== null) return
      noteTimerRef.current = window.setTimeout(() => {
        noteTimerRef.current = null
        flushNote()
      }, SAVE_MS)
    },
    [flushNote],
  )

  /** 还没落库的那一次随笔改动（正文与标题一起带：400ms 里两头都可能动） */
  const pendingRef = useRef<{ id: string | null; text: string; title: string } | null>(null)
  const timerRef = useRef<number | null>(null)

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const p = pendingRef.current
    pendingRef.current = null
    if (!p) return
    if (p.id && p.id !== '__blank__') {
      // 改成空 = 这条随笔被擦干净了：不写空文本，留给 settle 去删
      if (p.text.trim()) onUpdate(goalId, p.id, { text: p.text, title: p.title })
      return
    }
    if (!p.text.trim()) return
    const id = onCreate(goalId, p.title, p.text)
    if (id) {
      editingRef.current = id
      setEditingId(id)
      persistState({ essayEditingId: id })
    }
  }, [goalId, onCreate, onUpdate, persistState])

  /**
   * 收尾：把没落库的写掉，擦干净的删掉。
   */
  const settle = useCallback(() => {
    flush()
    flushNote()
    const id = editingRef.current
    if (id && id !== '__blank__' && !textRef.current.trim()) {
      onDelete(goalId, id)
      editingRef.current = null
      setEditingId(null)
      persistState({ essayEditingId: null })
    }
  }, [flush, flushNote, goalId, onDelete, persistState])

  /** 去抖排队：正文与标题各自改了什么都以 ref 里的最新值为准 */
  const queue = useCallback(() => {
    const curId = editingRef.current === '__blank__' ? null : editingRef.current
    pendingRef.current = { id: curId, text: textRef.current, title: titleRef.current }
    if (timerRef.current !== null) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      flush()
    }, SAVE_MS)
  }, [flush])

  const change = useCallback(
    (next: string) => {
      textRef.current = next
      setText(next)
      queue()
    },
    [queue],
  )

  /** 改标题：当场显示，落库跟正文同一条去抖队列 */
  const rename = useCallback(
    (next: string) => {
      titleRef.current = next
      setTitle(next)
      queue()
    },
    [queue],
  )

  /** 空白编辑器：从这儿开始新随笔，标题先备好今天的日期（可改） */
  const startBlank = useCallback(() => {
    settle()
    editingRef.current = '__blank__'
    setEditingId('__blank__')
    textRef.current = ''
    setText('')
    const fresh = dateLabelOfEssay(Date.now())
    titleRef.current = fresh
    setTitle(fresh)
    setSubPanel('main')
    persistState({ essayEditingId: '__blank__' })
  }, [settle, persistState])

  /** 打开指定随笔编辑（二级页面） */
  const openEssay = useCallback(
    (essay: EssayEntry) => {
      if (essay.id !== editingRef.current) {
        settle()
        editingRef.current = essay.id
        setEditingId(essay.id)
        textRef.current = essay.text
        setText(essay.text)
        titleRef.current = essay.title
        setTitle(essay.title)
        persistState({ essayEditingId: essay.id })
      }
      setSubPanel('main')
    },
    [settle, persistState],
  )

  /** 返回随笔列表（一级页面） */
  const backToEssayList = useCallback(() => {
    settle()
    editingRef.current = null
    setEditingId(null)
    setSubPanel('main')
    persistState({ essayEditingId: null })
  }, [settle, persistState])

  /** 删除随笔 */
  const removeEssay = useCallback(
    (id: string) => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      pendingRef.current = null
      onDelete(goalId, id)
      if (id === editingRef.current) {
        backToEssayList()
      }
    },
    [goalId, onDelete, backToEssayList],
  )

  /** 打开指定笔记编辑/预览（二级页面） */
  const openNote = useCallback(
    (item: DockNoteItem) => {
      flushNote()
      const target = { nodeId: item.nodeId, noteName: item.name, goalId: item.goalId }
      noteTargetRef.current = target
      setNoteTarget(target)
      noteTextRef.current = item.content
      setNoteText(item.content)
      noteDirtyRef.current = false
      persistState({ noteTarget: target })
    },
    [flushNote, persistState],
  )

  /** 返回笔记列表（一级页面） */
  const backToNoteList = useCallback(() => {
    flushNote()
    noteTargetRef.current = null
    setNoteTarget(null)
    noteDirtyRef.current = false
    persistState({ noteTarget: null })
  }, [flushNote, persistState])

  /** 切换笔记视图模式（预览 / 编辑） */
  const toggleNoteViewMode = useCallback(() => {
    flushNote()
    const next = noteViewMode === 'preview' ? 'edit' : 'preview'
    noteViewModeRef.current = next
    setNoteViewMode(next)
    persistState({ noteViewMode: next })
  }, [flushNote, noteViewMode, persistState])

  /** 切换顶部的两个固定 Tab */
  const switchTab = useCallback(
    (nextTab: 'essay' | 'note') => {
      if (nextTab === dockTabRef.current) return
      settle()
      dockTabRef.current = nextTab
      setDockTab(nextTab)
      persistState({ activeTab: nextTab })
    },
    [settle, persistState],
  )

  const essaysRef = useRef(essays)
  useEffect(() => {
    essaysRef.current = essays
  }, [essays])

  const openInitial = useCallback(() => {
    setSubPanel('main')
    setDetailId(null)
    // 根据持久化恢复，若已存在 editingId 则加载对应随笔
    const curEditing = editingRef.current
    if (curEditing && curEditing !== '__blank__') {
      const found = essaysRef.current.find((e) => e.id === curEditing)
      if (found) {
        textRef.current = found.text
        setText(found.text)
        titleRef.current = found.title
        setTitle(found.title)
      } else {
        editingRef.current = null
        setEditingId(null)
        persistState({ essayEditingId: null })
      }
    }
  }, [persistState])

  /*
   * 打开：接上最近的一条（没有就备好一条新的），然后**从按钮那颗圆长出来**；
   * 关掉时收尾并缩回按钮。
   */
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open === wasOpen.current) return
    wasOpen.current = open
    const seq = ++morphSeq.current
    if (contentTimer.current !== null) {
      window.clearTimeout(contentTimer.current)
      contentTimer.current = null
    }
    if (open) {
      openInitial()
      const btn = btnRef.current
      const next = clampRect(geometry ?? defaultRect())
      rectRef.current = next
      setRect(next)
      setFade(false)
      if (btn) {
        // 第一帧真的把「那颗圆」画出来，下一帧再交给目标几何——过渡才有起点
        setMorph(boxOfButton(btn))
        setContentIn(false)
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (seq !== morphSeq.current) return
            setMorph(null)
            // 字晚一点跟上：先看盒子长开，再看内容淡入
            contentTimer.current = window.setTimeout(() => {
              contentTimer.current = null
              if (seq !== morphSeq.current) return
              setContentIn(true)
            }, CONTENT_DELAY_MS)
          }),
        )
      } else {
        setMorph(null)
        setContentIn(true)
      }
    } else {
      settle()
      const btn = btnRef.current
      if (btn) {
        setMorph(boxOfButton(btn))
        setContentIn(false)
      } else {
        setFade(true)
      }
    }
    // geometry 只在「打开那一刻」读一次：拖过之后窗口自己就是最新的，不必跟着它重摆
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, openInitial, settle])

  // 卸载（换目标、关学习区）也要把没落库的那一下写掉，并清掉变形计时器。
  // 走 ref：settle 的身份会随父组件重渲染变，直接写进依赖里会变成「每次变都 settle 一次」
  const settleRef = useRef(settle)
  useEffect(() => {
    settleRef.current = settle
  }, [settle])
  useEffect(
    () => () => {
      settleRef.current()
      if (contentTimer.current !== null) window.clearTimeout(contentTimer.current)
    },
    [],
  )

  /* ---------- 拖动与改大小 ---------- */
  const beginDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    // 下拉、输入框、按钮上不拖：那是要操作它们，不是要挪窗口
    if ((e.target as HTMLElement).closest('button, select, input, textarea, a, label')) return
    setMoving(true)
    const start = { px: e.clientX, py: e.clientY, x: rectRef.current.x, y: rectRef.current.y }
    const onMove = (ev: PointerEvent) => {
      const next = clampRect({
        ...rectRef.current,
        x: start.x + (ev.clientX - start.px),
        y: start.y + (ev.clientY - start.py),
      })
      rectRef.current = next
      setRect(next)
    }
    bindWindowDrag(e.currentTarget, e.pointerId, onMove, () => {
      setMoving(false)
      onGeometry(rectRef.current)
    })
  }

  const beginResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    setMoving(true)
    const start = { px: e.clientX, py: e.clientY, w: rectRef.current.w, h: rectRef.current.h }
    const onMove = (ev: PointerEvent) => {
      const next = clampRect({
        ...rectRef.current,
        w: start.w + (ev.clientX - start.px),
        h: start.h + (ev.clientY - start.py),
      })
      rectRef.current = next
      setRect(next)
    }
    bindWindowDrag(e.currentTarget, e.pointerId, onMove, () => {
      setMoving(false)
      onGeometry(rectRef.current)
    })
  }

  // Esc：在子页面里先退回上一级；已经在列表页了才收起窗口
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (subPanel === 'detail') {
        setSubPanel(detailBack)
        return
      }
      if (subPanel !== 'main') {
        setSubPanel('main')
        return
      }
      if (dockTab === 'essay' && editingId !== null) {
        backToEssayList()
        return
      }
      if (dockTab === 'note' && noteTarget !== null) {
        backToNoteList()
        return
      }
      onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, subPanel, detailBack, dockTab, editingId, noteTarget, backToEssayList, backToNoteList, onOpenChange])

  /**
   * 点窗口外面的任何东西都快速收起（用户定的）：随笔窗口是「随手记」的便签，
   * 注意力回正文去了它就该让路，不必先精确瞄准右上角那颗 ×。
   * 捕获阶段监听：别的浮层拦了冒泡也拦不住收起。按钮本身排除在外——
   * 它在窗口开着时只是藏着，防御性绕开它的位置上的那一下。
   */
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target)) return
      if (btnRef.current?.contains(target)) return
      onOpenChange(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [open, onOpenChange])

  /* ---------- 提交 ---------- */
  /**
   * 全部随笔 vs 上一次提交：新增 / 修改 / 删除 / 未变化。
   * 提交本身带的是**全部随笔**（需求定的），这份差异只决定「这次有没有东西要整理」。
   */
  const diff = diffEssaysAgainst(essays, commits[0]?.snapshot)
  /** 编辑器里的字与已经落库的那一份不一样（刚敲下、去抖还没写进去） */
  const storedText = editingId ? (essays.find((e) => e.id === editingId)?.text ?? '') : ''
  const dirty = text.trim() !== storedText.trim()
  const commitVisible = essays.length > 0 && (diff.changed || dirty)

  const openCommitPanel = () => {
    // 去抖中的正文先落库，否则刚写的最后一句不会进快照
    flush()
    setCommitMessage(t('随笔整理 · {0}', dateLabelOfEssay(Date.now())))
    setSubPanel('commit')
  }

  const submitCommit = () => {
    const id = onCommit(commitMessage.trim())
    if (!id) return
    setDetailId(id)
    setDetailBack('main')
    setSubPanel('detail')
  }

  const activeCommit = detailId ? commits.find((c) => c.id === detailId) ?? null : null

  /**
   * 每次提交都封存全部随笔（需求定的），所以提交记录是**目标级**的：
   * 不再按「正在编辑的那条随笔」切分历史与快照——每条提交本来就包含所有随笔。
   */
  const scopedCommits = commits
  const scopedSnapshot = activeCommit ? activeCommit.snapshot : []

  const backFromPanel = () => {
    if (subPanel === 'detail') {
      setSubPanel(detailBack)
      return
    }
    setSubPanel('main')
  }

  const panelTitle =
    subPanel === 'commit'
      ? t('提交全部随笔')
      : subPanel === 'history'
        ? t('提交记录')
        : activeCommit?.message ?? t('提交详情')

  /** 下拉里的那一行：标题（旧数据没标题时按日期回退——normalize 会补，这里只是保险） */
  const titleOf = (essay: EssayEntry): string => essay.title || dateLabelOfEssay(essay.createdAt)

  const box: Box = morph ?? { x: rect.x, y: rect.y, w: rect.w, h: rect.h, r: PANEL_RADIUS }
  /**
   * 按钮在窗口挂着时先藏起来：收起动画的终点就是它，最后那一帧再露出来。
   * 判据用 mounted 而不是 open——点开的那一帧窗口还没挂上，按钮先留着，交接才不闪。
   */
  const buttonHidden = mounted

  return (
    <>
      {/*
        入口：一颗悬浮圆按钮，贴在文档区右下角。
        窗口开着时它只是**藏起来**，并不卸载——收起动画要靠它的位置当终点（见上）。
      */}
      {showEntry && (
        <button
          ref={btnRef}
          type="button"
          onClick={() => onOpenChange(true)}
          title={t('随笔（双击 Shift 也能唤出）')}
          aria-label={t('随笔')}
          aria-hidden={buttonHidden}
          tabIndex={buttonHidden ? -1 : 0}
          className={
            'no-print absolute bottom-4 right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-line-strong/70 bg-card/85 text-seal-deep shadow-[0_6px_20px_rgba(31,27,23,0.16)] backdrop-blur transition hover:border-seal/45 hover:bg-card hover:text-seal active:scale-95 ' +
            (buttonHidden ? 'pointer-events-none opacity-0' : '')
          }
        >
          {/* 手写的 SVG：一支笔压在一行字上（「随手记」） */}
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 20h4.2L19 9.2a2.1 2.1 0 0 0-3-3L5.2 17 4 20Z" />
            <path d="M13.6 7.6 16.6 10.6" />
          </svg>
        </button>
      )}

      {mounted &&
        createPortal(
          <div
            ref={panelRef}
            className={
              'no-print fixed z-[80] overflow-hidden border border-line-strong bg-paper shadow-[0_24px_64px_rgba(31,27,23,0.28)] ' +
              // 几何过渡就是「圆变方」本身：与按钮同一颗圆角起点，长到窗口的方角
              // 拖动 / 改大小 / 淡出退场时摘掉——那几种情形各有自己的动画
              (moving || fade
                ? ''
                : 'transition-[left,top,width,height,border-radius] duration-[260ms] ease-[cubic-bezier(0.22,0.8,0.24,1)] motion-reduce:transition-none ') +
              (fade ? 'opacity-0 scale-95 transition-[opacity,transform] duration-150' : '')
            }
            style={{ left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: box.r }}
            role="dialog"
            aria-label={t('随笔')}
          >
            <div
              className={
                'flex h-full w-full min-h-0 flex-col ' +
                (contentIn ? 'opacity-100' : 'pointer-events-none opacity-0')
              }
              style={{ transition: 'opacity 140ms ease-out' }}
            >
              {/* 顶栏：两个固定 Tab（随笔 / 笔记） + 拖拽窗口区 + 关闭按钮 */}
              <div
                onPointerDown={beginDrag}
                className="flex shrink-0 cursor-grab items-center justify-between border-b border-line bg-card/85 px-2.5 py-1.5 active:cursor-grabbing select-none"
              >
                {/* 两个固定 Tab */}
                <div className="flex items-center rounded-lg bg-paper/80 p-0.5 border border-line/60">
                  <button
                    type="button"
                    onClick={() => switchTab('essay')}
                    className={
                      'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition ' +
                      (dockTab === 'essay'
                        ? 'bg-seal/15 text-seal-deep shadow-xs'
                        : 'text-ink-soft hover:text-ink hover:bg-line/40')
                    }
                  >
                    <PenLine size={12} className={dockTab === 'essay' ? 'text-seal' : 'text-ink-faint'} />
                    {t('随笔')}
                  </button>
                  <button
                    type="button"
                    onClick={() => switchTab('note')}
                    className={
                      'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition ' +
                      (dockTab === 'note'
                        ? 'bg-seal/15 text-seal-deep shadow-xs'
                        : 'text-ink-soft hover:text-ink hover:bg-line/40')
                    }
                  >
                    <BookOpen size={12} className={dockTab === 'note' ? 'text-seal' : 'text-ink-faint'} />
                    {t('笔记')}
                  </button>
                </div>

                {/* 拖动留白 */}
                <span className="min-w-0 flex-1 h-6" aria-hidden="true" />

                {/* 关闭窗口 */}
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  title={t('收起（Esc）')}
                  aria-label={t('收起')}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/60 hover:text-ink"
                >
                  <X size={13} />
                </button>
              </div>

              {/* 子流程（提交、历史、详情）顶栏标题 */}
              {subPanel !== 'main' && (
                <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-card/70 px-2.5 py-1.5">
                  <button
                    type="button"
                    onClick={backFromPanel}
                    title={t('返回')}
                    aria-label={t('返回')}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/60 hover:text-ink"
                  >
                    <ArrowLeft size={13} />
                  </button>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-strong">{panelTitle}</span>
                  {subPanel === 'detail' && activeCommit && <StatusBadge status={activeCommit.status} />}
                </div>
              )}

              {/* ==================== 随笔 Tab ==================== */}
              {subPanel === 'main' && dockTab === 'essay' && (
                <>
                  {editingId === null ? (
                    /* ----- 随笔一级页面：随笔列表 ----- */
                    <div className="flex min-h-0 flex-1 flex-col bg-card">
                      {/* 操作栏 */}
                      <div className="flex shrink-0 items-center gap-1.5 border-b border-line/80 px-3 py-2 bg-paper/40">
                        <span className="text-[11.5px] font-medium text-ink-strong">
                          {t('随笔列表')}
                          <span className="ml-1 text-[10.5px] font-normal text-ink-faint">({essays.length})</span>
                        </span>
                        <span className="min-w-0 flex-1" aria-hidden="true" />
                        <button
                          type="button"
                          onClick={startBlank}
                          title={t('新建一条随笔')}
                          className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-seal px-2 text-[10.5px] font-medium text-white shadow-xs transition hover:bg-seal-deep"
                        >
                          <Plus size={12} />
                          {t('新建随笔')}
                        </button>
                        <button
                          type="button"
                          onClick={openCommitPanel}
                          disabled={!commitVisible}
                          title={
                            commitVisible
                              ? t('提交全部随笔：带上全部内容，AI 按与上次的差异统一整理')
                              : t('和上次提交相比没有变化')
                          }
                          className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-seal/10 px-1.5 text-[10.5px] font-medium text-seal-deep transition hover:bg-seal/15 disabled:cursor-default disabled:opacity-40"
                        >
                          <GitCommitHorizontal size={12} />
                          {t('提交全部…')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSubPanel('history')}
                          title={t('提交记录')}
                          aria-label={t('提交记录')}
                          className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/60 hover:text-ink"
                        >
                          <History size={13} />
                          {scopedCommits.length > 0 && (
                            <span className="absolute -right-0.5 -top-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-seal px-0.5 text-[8px] leading-none text-white">
                              {scopedCommits.length > 9 ? '9+' : scopedCommits.length}
                            </span>
                          )}
                        </button>
                      </div>

                      {/* 随笔列表项 */}
                      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 space-y-2">
                        {essays.length === 0 ? (
                          <div className="flex h-full flex-col items-center justify-center py-12 text-center text-ink-faint">
                            <PenLine size={28} className="text-line-strong/60 mb-2" />
                            <p className="text-[12px]">{t('还没有随笔')}</p>
                            <p className="text-[10.5px] text-ink-faint mt-1 max-w-[260px]">
                              {t('随笔是目标级的灵感记录，随时记下你的思考与疑问，并可一键提交给 AI 整理。')}
                            </p>
                            <button
                              type="button"
                              onClick={startBlank}
                              className="mt-3 inline-flex items-center gap-1 rounded-md bg-seal/10 px-2.5 py-1 text-[11px] font-medium text-seal transition hover:bg-seal/20"
                            >
                              <Plus size={12} />
                              {t('记一条随笔')}
                            </button>
                          </div>
                        ) : (
                          essays.map((essay) => (
                            <div
                              key={essay.id}
                              onClick={() => openEssay(essay)}
                              className="group relative cursor-pointer rounded-lg border border-line bg-paper/60 p-2.5 transition hover:border-seal/45 hover:bg-paper hover:shadow-xs"
                            >
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="truncate text-[12px] font-medium text-ink-strong">
                                  {titleOf(essay)}
                                </span>
                                <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
                                  {timeLabel(essay.updatedAt)}
                                </span>
                              </div>
                              <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-soft">
                                {essayPreview(essay.text, 140) || t('（空随笔）')}
                              </p>
                              <div className="mt-1.5 flex items-center justify-between text-[10px] text-ink-faint">
                                <span>{t('{0} 字', essay.text.length)}</span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    removeEssay(essay.id)
                                  }}
                                  title={t('删除这条随笔')}
                                  aria-label={t('删除')}
                                  className="opacity-0 group-hover:opacity-100 flex h-5 w-5 items-center justify-center rounded text-ink-faint transition hover:bg-line/60 hover:text-seal-deep"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ) : (
                    /* ----- 随笔二级页面：随笔编辑（不能切换到预览模式） ----- */
                    <div className="flex min-h-0 flex-1 flex-col bg-card">
                      {/* 二级顶栏 */}
                      <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-card/70 px-2.5 py-1.5">
                        <button
                          type="button"
                          onClick={backToEssayList}
                          title={t('返回列表')}
                          aria-label={t('返回列表')}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/60 hover:text-ink"
                        >
                          <ArrowLeft size={13} />
                        </button>
                        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ink-strong">
                          {title || t('未命名随笔')}
                        </span>
                        {editingId && editingId !== '__blank__' && (
                          <button
                            type="button"
                            onClick={() => removeEssay(editingId)}
                            title={t('删除这条随笔')}
                            aria-label={t('删除')}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/60 hover:text-seal-deep"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={openCommitPanel}
                          disabled={!commitVisible}
                          title={
                            commitVisible
                              ? t('提交全部随笔：带上全部内容，AI 按与上次的差异统一整理')
                              : t('和上次提交相比没有变化')
                          }
                          className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-seal/10 px-1.5 text-[10.5px] font-medium text-seal-deep transition hover:bg-seal/15 disabled:cursor-default disabled:opacity-40"
                        >
                          <GitCommitHorizontal size={12} />
                          {t('提交全部…')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSubPanel('history')}
                          title={t('提交记录：快照与每次整理动过的笔记')}
                          aria-label={t('提交记录')}
                          className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/60 hover:text-ink"
                        >
                          <History size={13} />
                          {scopedCommits.length > 0 && (
                            <span className="absolute -right-0.5 -top-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-seal px-0.5 text-[8px] leading-none text-white">
                              {scopedCommits.length > 9 ? '9+' : scopedCommits.length}
                            </span>
                          )}
                        </button>
                      </div>

                      {/* 编辑内容 */}
                      <input
                        value={title}
                        onChange={(e) => rename(e.target.value)}
                        placeholder={t('标题（默认为日期，可改）')}
                        aria-label={t('随笔标题')}
                        className="shrink-0 border-b border-line bg-transparent px-3.5 py-2 text-[13px] font-medium text-ink-strong outline-none transition placeholder:font-normal placeholder:text-ink-faint focus:border-seal/40"
                      />
                      <EssayEditor
                        value={text}
                        onChange={change}
                        placeholder={t('随手记点什么…（支持 Markdown，停手即存）')}
                      />
                      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1 text-[10.5px] text-ink-faint">
                        <span>{editingId && editingId !== '__blank__' ? t('已自动保存') : t('写下第一个字，它就成了一条随笔')}</span>
                        <span className="ml-auto tabular-nums">{text.length ? t('{0} 字', text.length) : ''}</span>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ==================== 笔记 Tab ==================== */}
              {subPanel === 'main' && dockTab === 'note' && (
                <>
                  {noteTarget === null ? (
                    /* ----- 笔记一级页面：当前目标下的笔记列表（不跨目标，见 LearnWorkspace 的 dockNotes） ----- */
                    <div className="flex min-h-0 flex-1 flex-col bg-card">
                      {/* 操作与搜索栏 */}
                      <div className="flex shrink-0 items-center gap-2 border-b border-line/80 px-3 py-2 bg-paper/40">
                        <span className="shrink-0 text-[11.5px] font-medium text-ink-strong">
                          {t('笔记列表')}
                          <span className="ml-1 text-[10.5px] font-normal text-ink-faint">({filteredNotes.length})</span>
                        </span>
                        <div className="relative min-w-0 flex-1">
                          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-faint" />
                          <input
                            type="text"
                            value={noteSearch}
                            onChange={(e) => setNoteSearch(e.target.value)}
                            placeholder={t('搜索笔记或节点…')}
                            className="h-6 w-full rounded-md border border-line bg-paper/70 pl-6 pr-2 text-[11px] text-ink outline-none transition focus:border-seal/50"
                          />
                        </div>
                      </div>

                      {/* 笔记列表项 */}
                      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 space-y-2">
                        {filteredNotes.length === 0 ? (
                          <div className="flex h-full flex-col items-center justify-center py-12 text-center text-ink-faint">
                            <BookOpen size={28} className="text-line-strong/60 mb-2" />
                            <p className="text-[12px]">{noteSearch ? t('未找到匹配的笔记') : t('当前目标还没有笔记')}</p>
                            <p className="text-[10.5px] text-ink-faint mt-1 max-w-[260px]">
                              {t('笔记是节点级的，只列当前目标下的节点；在学习文档或右键菜单中可为节点记笔记。')}
                            </p>
                          </div>
                        ) : (
                          filteredNotes.map((item) => (
                            <div
                              key={item.nodeId + '\u0000' + item.name}
                              onClick={() => openNote(item)}
                              className="group relative cursor-pointer rounded-lg border border-line bg-paper/60 p-2.5 transition hover:border-seal/45 hover:bg-paper hover:shadow-xs"
                            >
                              {/* 只列当前目标：只需标明是哪个节点的笔记 */}
                              <div className="flex items-center gap-1.5 text-[10.5px] text-ink-faint">
                                <span className="truncate max-w-[220px] rounded bg-line/60 px-1 py-0.5 text-[10px] font-medium text-ink-soft">
                                  {item.nodeTitle || t('未知节点')}
                                </span>
                                <span className="ml-auto shrink-0 tabular-nums text-[10px] text-ink-faint">
                                  {timeLabel(item.updatedAt)}
                                </span>
                              </div>

                              <div className="mt-1 truncate text-[12px] font-medium text-ink-strong">
                                {item.name}
                              </div>

                              <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-soft">
                                {essayPreview(item.content, 140) || t('（空笔记）')}
                              </p>

                              <div className="mt-1.5 flex items-center justify-between text-[10px] text-ink-faint">
                                <span>{t('{0} 字', item.content.length)}</span>
                                <span className="text-seal/80 opacity-0 group-hover:opacity-100 transition text-[10.5px]">
                                  {t('查看 / 编辑 →')}
                                </span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ) : (
                    /* ----- 笔记二级页面：笔记编辑 / 预览（自由切换预览与编辑模式，不可提交） ----- */
                    <div className="flex min-h-0 flex-1 flex-col bg-card">
                      {/* 二级顶栏 */}
                      <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-card/70 px-2.5 py-1.5">
                        <button
                          type="button"
                          onClick={backToNoteList}
                          title={t('返回列表')}
                          aria-label={t('返回列表')}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/60 hover:text-ink"
                        >
                          <ArrowLeft size={13} />
                        </button>

                        {/* 节点归属面包屑 */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 text-[10px] text-ink-faint truncate">
                            <span>{currentNoteItem?.goalTitle || t('未知目标')}</span>
                            <span>/</span>
                            <span className="font-medium text-ink-soft">{currentNoteItem?.nodeTitle || t('未知节点')}</span>
                          </div>
                          <div className="truncate text-[12px] font-medium text-ink-strong leading-none mt-0.5">
                            {noteTarget.noteName}
                          </div>
                        </div>

                        {/* 自由切换预览或者编辑模式 */}
                        <button
                          type="button"
                          onClick={toggleNoteViewMode}
                          title={noteViewMode === 'preview' ? t('切换到编辑模式') : t('切换到预览模式')}
                          className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-line bg-paper/80 px-2 text-[10.5px] font-medium text-ink-soft transition hover:border-seal/40 hover:text-seal-deep"
                        >
                          {noteViewMode === 'preview' ? (
                            <>
                              <Edit3 size={11} className="text-seal" />
                              {t('编辑')}
                            </>
                          ) : (
                            <>
                              <Eye size={11} className="text-seal" />
                              {t('预览')}
                            </>
                          )}
                        </button>

                        {/* 在工作区中打开 */}
                        <button
                          type="button"
                          onClick={() => onOpenNote(noteTarget.nodeId, noteTarget.noteName)}
                          title={t('在主工作区打开此笔记')}
                          aria-label={t('在工作区打开')}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/60 hover:text-ink"
                        >
                          <ExternalLink size={12} />
                        </button>

                        {onDeleteNote && (
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteNote(noteTarget.nodeId, noteTarget.noteName)
                              backToNoteList()
                            }}
                            title={t('删除这份笔记')}
                            aria-label={t('删除')}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/60 hover:text-seal-deep"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>

                      {/* 笔记展示区：预览模式 vs 编辑模式 */}
                      {noteViewMode === 'preview' ? (
                        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 bg-paper/40">
                          {noteText.trim() ? (
                            <MarkdownView
                              html={renderNote(noteText)}
                              className="moji-md text-[12.5px] leading-relaxed text-ink"
                            />
                          ) : (
                            <p className="text-[11.5px] text-ink-faint py-4">{t('（笔记内容为空，点击上方「编辑」开始记录）')}</p>
                          )}
                        </div>
                      ) : (
                        <EssayEditor
                          value={noteText}
                          onChange={handleNoteTextChange}
                          placeholder={t('写点笔记…（支持 Markdown，停手即存）')}
                        />
                      )}

                      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1 text-[10.5px] text-ink-faint">
                        <span>{noteViewMode === 'edit' ? t('已自动保存') : t('只读预览模式')}</span>
                        <span className="ml-auto tabular-nums">{noteText.length ? t('{0} 字', noteText.length) : ''}</span>
                      </div>
                    </div>
                  )}
                </>
              )}

              {subPanel === 'commit' && (
                <div className="flex min-h-0 flex-1 flex-col bg-card">
                  <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
                    <p className="text-[11px] leading-relaxed text-ink-faint">
                      {t('每次提交都会带上当前的全部随笔；AI 按与上次相比的新增、修改与删除，统一整理进对应节点的笔记，整理结果会记在这次提交上。')}
                    </p>
                    <label className="mt-3 block text-[11px] font-medium text-ink-soft" htmlFor="essay-commit-message">
                      {t('提交说明')}
                    </label>
                    <input
                      id="essay-commit-message"
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                      placeholder={t('这次随笔在整理什么？')}
                      className="mt-1 w-full rounded-md border border-line bg-paper/70 px-2 py-1.5 text-[12px] text-ink outline-none transition focus:border-seal/50"
                    />
                    <div className="mt-3 flex items-baseline gap-2">
                      <span className="text-[11px] font-medium text-ink-soft">{t('本次快照')}</span>
                      <span className="text-[10.5px] text-ink-faint">{t('全部 {0} 条随笔', String(essays.length))}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-ink-faint">
                      <span>{t('新增 {0}', String(diff.added.length))}</span>
                      <span>·</span>
                      <span>{t('修改 {0}', String(diff.edited.length))}</span>
                      <span>·</span>
                      <span>{t('删除 {0}', String(diff.removed.length))}</span>
                      <span>·</span>
                      <span>{t('未变化 {0}', String(diff.unchanged.length))}</span>
                    </div>
                    <div className="mt-1.5 space-y-1.5">
                      {!diff.changed ? (
                        <p className="px-1 py-2 text-[11px] text-ink-faint">{t('和上次提交相比没有变化')}</p>
                      ) : (
                        <>
                          {diff.added.map((essay) => (
                            <div key={essay.id} className="rounded-lg border border-line bg-paper/60 px-2.5 py-2">
                              <div className="flex items-center gap-1.5">
                                <span className="rounded bg-ok/10 px-1 py-px text-[9.5px] text-ok-deep">{t('新增')}</span>
                                <span className="truncate text-[10.5px] text-ink-faint">{titleOf(essay)}</span>
                              </div>
                              <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-ink-soft">
                                {essayPreview(essay.text, 140)}
                              </p>
                            </div>
                          ))}
                          {diff.edited.map((essay) => (
                            <div key={essay.id} className="rounded-lg border border-line bg-paper/60 px-2.5 py-2">
                              <div className="flex items-center gap-1.5">
                                <span className="rounded bg-seal/10 px-1 py-px text-[9.5px] text-seal-deep">{t('已修改')}</span>
                                <span className="truncate text-[10.5px] text-ink-faint">{titleOf(essay)}</span>
                              </div>
                              <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-ink-soft">
                                {essayPreview(essay.text, 140)}
                              </p>
                            </div>
                          ))}
                          {diff.removed.map((r) => (
                            <div key={r.id} className="flex items-center gap-1.5 rounded-lg border border-line/70 bg-paper/40 px-2.5 py-2">
                              <span className="rounded bg-warn/10 px-1 py-px text-[9.5px] text-warn-deep">{t('已删除')}</span>
                              <span className="truncate text-[11px] text-ink-soft">{r.title || dateLabelOfEssay(r.createdAt)}</span>
                            </div>
                          ))}
                          {diff.unchanged.length > 0 && (
                            <p className="px-1 pt-1 text-[10.5px] leading-relaxed text-ink-faint">
                              {t('其余 {0} 条未变化，也会随快照一起交给 AI。', String(diff.unchanged.length))}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-line px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setSubPanel('main')}
                      className="h-7 rounded-md px-2.5 text-[11.5px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
                    >
                      {t('取消')}
                    </button>
                    <button
                      type="button"
                      onClick={submitCommit}
                      disabled={!diff.changed}
                      className="flex h-7 items-center gap-1.5 rounded-md bg-seal px-3 text-[11.5px] font-medium text-white shadow-sm transition hover:bg-seal-deep disabled:cursor-default disabled:opacity-40"
                    >
                      <GitCommitHorizontal size={13} />
                      {t('提交全部并整理')}
                    </button>
                  </div>
                </div>
              )}

              {subPanel === 'history' && (
                <div className="flex min-h-0 flex-1 flex-col bg-card">
                  <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
                    {scopedCommits.length === 0 ? (
                      <p className="px-2 py-4 text-[11px] leading-relaxed text-ink-faint">
                        {t('当前目标还没有随笔提交记录：提交一次，这里会沿时间轴留下快照与整理评论。')}
                      </p>
                    ) : (
                      /*
                       * timeline（用户定的）：一条竖线串起每次提交，节点上只摆
                       * 「日期 + 评论标题」两行小字——细节（动过的笔记、快照原文、
                       * 评论全文）点开详情再看，列表保持一眼能扫完。
                       */
                      <ol className="ml-1 border-l border-line pl-3.5">
                        {scopedCommits.map((commit) => (
                          <li key={commit.id} className="relative">
                            <span
                              aria-hidden="true"
                              className="absolute -left-[18.5px] top-2.5 h-2 w-2 rounded-full border border-seal/50 bg-seal/60"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setDetailId(commit.id)
                                setDetailBack('history')
                                setSubPanel('detail')
                              }}
                              title={t('点击查看这次提交的详细记录')}
                              className="mb-1 block w-full rounded-lg px-2 py-1.5 text-left transition last:mb-0 hover:bg-line/50"
                            >
                              <span className="flex w-full items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-strong">
                                  {essayCommentTitle(commit)}
                                </span>
                                <StatusBadge status={commit.status} />
                              </span>
                              <span className="mt-0.5 block text-[10.5px] tabular-nums text-ink-faint">
                                {timeLabel(commit.at)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </div>
              )}

              {subPanel === 'detail' && (
                <div className="flex min-h-0 flex-1 flex-col bg-card">
                  {activeCommit ? (
                    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
                      <div className="text-[10.5px] text-ink-faint">
                        {timeLabel(activeCommit.at)} · {t('{0} 条随笔', String(scopedSnapshot.length))}
                      </div>

                      {activeCommit.comment && (
                        <section className="mt-3">
                          <h4 className="text-[11px] font-medium text-ink-soft">{t('整理评论')}</h4>
                          {/* Agent 对这次提交的评论（Markdown，首行是标题，见 learn/essayCommits） */}
                          <MarkdownView
                            html={renderNote(activeCommit.comment)}
                            className="moji-agent-md mt-1.5 rounded-lg border border-line bg-paper/60 px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-soft"
                          />
                        </section>
                      )}

                      {activeCommit.status === 'running' && (
                        <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-paper/60 px-2.5 py-2 text-[11px] text-ink-soft">
                          <Loader2 size={12} className="animate-spin text-seal" />
                          {t('正在整理…整理完成后这里会列出动过的笔记')}
                        </div>
                      )}

                      {activeCommit.status === 'error' && (
                        <div className="mt-2 rounded-lg border border-warn/40 bg-warn/5 px-2.5 py-2 text-[11px] leading-relaxed text-warn-deep">
                          <p>{activeCommit.error || t('整理失败，可以重试')}</p>
                          <button
                            type="button"
                            onClick={() => onRetryCommit(activeCommit.id)}
                            className="mt-1.5 inline-flex h-6 items-center gap-1 rounded-md border border-warn/40 px-1.5 text-[10.5px] font-medium transition hover:bg-warn/10"
                          >
                            <RefreshCw size={11} />
                            {t('重试整理')}
                          </button>
                        </div>
                      )}

                      {activeCommit.status !== 'running' && (
                        <section className="mt-3">
                          <div className="flex items-baseline justify-between gap-2">
                            <h4 className="text-[11px] font-medium text-ink-soft">{t('整理结果')}</h4>
                            <span className="text-[10px] text-ink-faint">{changesSummary(activeCommit.changes)}</span>
                          </div>
                          <div className="mt-1.5 space-y-1">
                            {activeCommit.changes.length === 0 ? (
                              <p className="px-1 py-1.5 text-[11px] text-ink-faint">{t('这次整理没有改动任何笔记')}</p>
                            ) : (
                              activeCommit.changes.map((c) => (
                                <button
                                  key={c.nodeId + '\u0000' + c.noteName}
                                  type="button"
                                  onClick={() => onOpenNote(c.nodeId, c.noteName)}
                                  title={t('打开这份笔记')}
                                  className="flex w-full items-center gap-2 rounded-lg border border-line bg-paper/60 px-2 py-1.5 text-left transition hover:border-seal/40 hover:bg-paper"
                                >
                                  <FileText size={12} className="shrink-0 text-seal/70" />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[11.5px] text-ink">{c.nodeTitle || t('（未知节点）')}</span>
                                    <span className="block truncate text-[10px] text-ink-faint">{t('笔记「{0}」', c.noteName)}</span>
                                  </span>
                                  <span className="shrink-0 rounded bg-line/60 px-1.5 py-px text-[9.5px] text-ink-faint">
                                    {c.kind === 'created' ? t('新建') : t('更新')}
                                  </span>
                                </button>
                              ))
                            )}
                          </div>
                        </section>
                      )}

                      <section className="mt-3">
                        <h4 className="text-[11px] font-medium text-ink-soft">{t('快照')}</h4>
                        {/* 这次提交封存的全部随笔（见上面的 scopedSnapshot） */}
                        <div className="mt-1.5 space-y-1.5">
                          {scopedSnapshot.length === 0 ? (
                            <p className="px-1 py-1.5 text-[11px] text-ink-faint">
                              {t('这次提交里没有随笔')}
                            </p>
                          ) : (
                            scopedSnapshot.map((essay) => (
                              <div key={essay.id} className="rounded-lg border border-line bg-paper/50 px-2.5 py-2">
                                {/* 旧提交的快照没有标题：按提交日期回退（见 types 的 EssayCommit.snapshot） */}
                                <div className="truncate text-[10px] text-ink-faint">
                                  {essay.title || dateLabelOfEssay(essay.createdAt)}
                                </div>
                                <p className="mt-1 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-ink-soft">
                                  {essay.text}
                                </p>
                              </div>
                            ))
                          )}
                        </div>
                      </section>
                    </div>
                  ) : (
                    <p className="px-3 py-4 text-[11px] text-ink-faint">{t('这条提交记录已经不在了')}</p>
                  )}
                  {activeCommit && (
                    <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1.5 text-[10.5px] text-ink-faint">
                      <span className="min-w-0 flex-1 truncate">
                        {t('每次提交都带全部随笔；AI 只整理与上次相比新增、修改、删除的部分')}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSubPanel('main')}
                        className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-seal/10 px-2 text-[10.5px] font-medium text-seal-deep transition hover:bg-seal/15"
                      >
                        <PenLine size={11} />
                        {t('返回')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 右下角的改大小把手 */}
              <div
                onPointerDown={beginResize}
                title={t('拖动调整大小')}
                className="absolute bottom-0 right-0 z-10 h-3.5 w-3.5 cursor-nwse-resize touch-none"
                style={{
                  background:
                    'linear-gradient(135deg, transparent 0 46%, var(--color-line-strong) 46% 54%, transparent 54% 70%, var(--color-line-strong) 70% 78%, transparent 78%)',
                }}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
