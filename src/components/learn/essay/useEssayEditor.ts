/**
 * 随笔窗口的**编辑态与流转**（搬自 EssayDock，纯搬运）：
 *
 * - 顶部两个固定 Tab（随笔 / 笔记）与子面板（提交 / 历史 / 详情）；
 * - 随笔的编辑态：正在编辑哪条、正文与标题、去抖落库（停手 400ms 才写）、擦干净了删除；
 * - 笔记的编辑态：看哪条、正文、预览 / 编辑模式、去抖写入；
 * - persistState：这些界面状态一起写进 state.json（走宿主的 onGeometry；窗口几何
 *   属于窗口本身，由宿主把 getRect 递进来一起落盘）。
 *
 * 随笔与笔记两份编辑态**故意留在同一个 hook 里**：settle（收尾：没落库的写掉、
 * 擦干净的删掉）与 persistState（落盘）都同时摸两边的状态，拆成两个 hook 就要靠
 * 一层层回调互相穿针，晚绑定的时序一错就是「切页签丢一笔」。视图拆在
 * EssayList / EssayNoteTabs / EssayCommitPanel，窗口几何与变形在 EssayDock。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DockNoteItem, EssayDockRect, EssayDockState, EssayEntry } from '../../../learn/types'
import { dateLabelOfEssay } from './essayLabels'

/** 自动落库的去抖：一直在打字就不写盘，停手这么久才落一条（随笔与笔记同一个数） */
const SAVE_MS = 400

/** 窗口里的子块：提交确认 / 提交历史 / 某次提交的详情（主要列表/编辑由 tab 与二级状态决定） */
export type SubPanel = 'main' | 'commit' | 'history' | 'detail'

/** 随笔窗口编辑态需要的宿主数据与动作（都来自 EssayDock 的 props） */
export interface EssayEditorDeps {
  /** 这些随笔属于哪个目标（随笔是目标级的，见 learn/essays） */
  goalId: string
  /** 这个目标的随笔（新的在前） */
  essays: EssayEntry[]
  /** 上次存下来的窗口状态（恢复页签、正在编辑的随笔与笔记；没有就是全新开） */
  geometry: EssayDockState | null
  onGeometry: (state: EssayDockState) => void
  /** 写下第一个字时落一条（标题缺省取当天日期）；返回新条目的 id（空文本返回 null，什么都不做） */
  onCreate: (goalId: string, title: string, text: string) => string | null
  /** 改一条：给了谁改谁（正文 / 标题），去抖后调 */
  onUpdate: (goalId: string, id: string, patch: { text?: string; title?: string }) => void
  onDelete: (goalId: string, id: string) => void
  /** 当前目标下所有节点的笔记（不跨目标，见 LearnWorkspace 的 dockNotes） */
  allNotes: DockNoteItem[]
  /** 写入节点笔记 */
  onWriteNote?: (nodeId: string, noteName: string, content: string) => void
  /** 读当前窗口几何：persistState 落盘时把 rect 一起带上（rect 属于窗口，归 EssayDock 管） */
  getRect: () => EssayDockRect
}

export function useEssayEditor({
  goalId,
  essays,
  geometry,
  onGeometry,
  onCreate,
  onUpdate,
  onDelete,
  allNotes,
  onWriteNote,
  getRect,
}: EssayEditorDeps) {
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
        ...getRect(),
        activeTab: dockTabRef.current,
        essayEditingId: editingRef.current,
        noteTarget: noteTargetRef.current,
        noteViewMode: noteViewModeRef.current,
        ...patch,
      })
    },
    [onGeometry, getRect],
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

  return {
    /** 顶部固定 Tab：随笔 / 笔记 */
    dockTab,
    switchTab,
    /** 子面板（提交 / 历史 / 详情）与它的状态 */
    subPanel,
    setSubPanel,
    detailId,
    setDetailId,
    detailBack,
    setDetailBack,
    commitMessage,
    setCommitMessage,
    /* ---------- 随笔编辑态 ---------- */
    editingId,
    text,
    title,
    change,
    rename,
    startBlank,
    openEssay,
    backToEssayList,
    removeEssay,
    /** 收尾：没落库的写掉，擦干净的删掉（关窗 / 切 Tab / 卸载时调） */
    flush,
    settle,
    /* ---------- 笔记编辑态 ---------- */
    noteSearch,
    setNoteSearch,
    noteTarget,
    noteViewMode,
    toggleNoteViewMode,
    openNote,
    backToNoteList,
    currentNoteItem,
    filteredNotes,
    noteText,
    handleNoteTextChange,
    /** 打开窗口那一刻的恢复（接上最近编辑的随笔） */
    openInitial,
  }
}
