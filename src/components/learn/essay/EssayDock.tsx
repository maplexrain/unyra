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
 *
 * 拆分（纯搬运，行为与对外签名不变）：窗口几何与拖拽机制在 essayGeometry，显示口径
 * （日期 / 时间 / 标题）在 essayLabels，页签、子面板与全部编辑态（随笔的、笔记的）
 * 与落盘在 useEssayEditor；三块子页面分别挂在 EssayList（随笔列表）、EssayNoteTabs
 * （笔记两页）、EssayCommitPanel（提交 / 历史 / 详情）。本文件留入口按钮、圆→方变形、
 * 拖拽与收起时序、随笔编辑页与组装。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft,
  BookOpen,
  GitCommitHorizontal,
  History,
  PenLine,
  Trash2,
  X,
} from 'lucide-react'
import type { DockNoteItem, EssayCommit, EssayDockRect, EssayDockState, EssayEntry } from '../../../learn/types'
import { diffEssaysAgainst } from '../../../learn/essayCommits'
import { usePresence } from '../../../lib/presence'
import { t } from '../../../i18n'
import EssayEditor from './EssayEditor'
import { EssayList } from './EssayList'
import { EssayNoteTabs } from './EssayNoteTabs'
import { EssayCommitPanel, StatusBadge } from './EssayCommitPanel'
import {
  bindWindowDrag,
  boxOfButton,
  clampRect,
  CONTENT_DELAY_MS,
  defaultRect,
  MORPH_MS,
  PANEL_RADIUS,
  type Box,
} from './essayGeometry'
import { dateLabelOfEssay } from './essayLabels'
import { useEssayEditor } from './useEssayEditor'

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
  triggerRef?: React.RefObject<HTMLButtonElement | null>
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
  triggerRef,
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

  /** persistState 落盘时要带上当前窗口几何：rect 属于窗口本身，归 EssayDock 管（见 essayGeometry） */
  const getRect = useCallback(() => rectRef.current, [])

  /*
   * 窗口里的页签、子面板与全部编辑态（随笔的、笔记的）与落盘：
   * 整体在 useEssayEditor——settle 与 persistState 同时摸两边的状态，见那边的说明。
   */
  const {
    dockTab,
    switchTab,
    subPanel,
    setSubPanel,
    detailId,
    setDetailId,
    detailBack,
    setDetailBack,
    commitMessage,
    setCommitMessage,
    editingId,
    text,
    title,
    change,
    rename,
    startBlank,
    openEssay,
    backToEssayList,
    removeEssay,
    flush,
    settle,
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
    openInitial,
  } = useEssayEditor({
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
  })

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
      const btn = triggerRef?.current ?? btnRef.current
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
      const btn = triggerRef?.current ?? btnRef.current
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
    // setSubPanel 来自 useEssayEditor 的返回值（原来是本组件的 useState setter，天然稳定）：
    // 身份不变，补进依赖里只是让 lint 满意，不会多跑一次 effect
  }, [open, subPanel, detailBack, dockTab, editingId, noteTarget, setSubPanel, backToEssayList, backToNoteList, onOpenChange])

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
      if ((triggerRef?.current ?? btnRef.current)?.contains(target)) return
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
   * （快照原文在详情页看，见 EssayCommitPanel 的 scopedSnapshot。）
   */
  const scopedCommits = commits

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
      {!triggerRef && showEntry && (
        <button
          ref={btnRef}
          type="button"
          onClick={() => onOpenChange(true)}
          title={t('随笔（双击 Shift 也能唤出）')}
          aria-label={t('随笔')}
          aria-hidden={buttonHidden}
          tabIndex={buttonHidden ? -1 : 0}
          className={
            'no-print absolute bottom-4 right-4 z-30 flex h-11 w-11 items-center justify-center rounded-none border border-line-strong/70 bg-card/85 text-seal-deep shadow-[0_6px_20px_rgba(31,27,23,0.16)] backdrop-blur transition hover:border-seal/45 hover:bg-card hover:text-seal active:scale-95 ' +
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
                <div className="flex items-center rounded-none bg-paper/80 p-0.5 border border-line/60">
                  <button
                    type="button"
                    onClick={() => switchTab('essay')}
                    className={
                      'flex items-center gap-1.5 rounded-none px-2.5 py-1 text-[11px] font-medium transition ' +
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
                      'flex items-center gap-1.5 rounded-none px-2.5 py-1 text-[11px] font-medium transition ' +
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
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-none text-ink-faint transition hover:bg-line/60 hover:text-ink"
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
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-none text-ink-faint transition hover:bg-line/60 hover:text-ink"
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
                    /* ----- 随笔一级页面：随笔列表（见 EssayList） ----- */
                    <EssayList
                      essays={essays}
                      commitCount={scopedCommits.length}
                      commitVisible={commitVisible}
                      onStartBlank={startBlank}
                      onOpenCommitPanel={openCommitPanel}
                      onOpenHistory={() => setSubPanel('history')}
                      onOpenEssay={openEssay}
                      onRemoveEssay={removeEssay}
                    />
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
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-none text-ink-faint transition hover:bg-line/60 hover:text-ink"
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
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-none text-ink-faint transition hover:bg-line/60 hover:text-seal-deep"
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
                          className="flex h-6 shrink-0 items-center gap-1 rounded-none bg-seal/10 px-1.5 text-[10.5px] font-medium text-seal-deep transition hover:bg-seal/15 disabled:cursor-default disabled:opacity-40"
                        >
                          <GitCommitHorizontal size={12} />
                          {t('提交全部…')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSubPanel('history')}
                          title={t('提交记录：快照与每次整理动过的笔记')}
                          aria-label={t('提交记录')}
                          className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-none text-ink-faint transition hover:bg-line/60 hover:text-ink"
                        >
                          <History size={13} />
                          {scopedCommits.length > 0 && (
                            <span className="absolute -right-0.5 -top-0.5 flex h-3 min-w-3 items-center justify-center rounded-none bg-seal px-0.5 text-[8px] leading-none text-white">
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
                <EssayNoteTabs
                  noteSearch={noteSearch}
                  onSearchChange={setNoteSearch}
                  filteredNotes={filteredNotes}
                  onOpenNote={openNote}
                  noteTarget={noteTarget}
                  currentNoteItem={currentNoteItem}
                  noteText={noteText}
                  onNoteTextChange={handleNoteTextChange}
                  noteViewMode={noteViewMode}
                  onToggleViewMode={toggleNoteViewMode}
                  onBackToList={backToNoteList}
                  onOpenInWorkspace={onOpenNote}
                  onDeleteNote={onDeleteNote}
                />
              )}

              {/* 提交 / 历史 / 详情三块子页面：见 EssayCommitPanel */}
              {subPanel !== 'main' && (
                <EssayCommitPanel
                  subPanel={subPanel}
                  essays={essays}
                  commits={scopedCommits}
                  diff={diff}
                  activeCommit={activeCommit}
                  commitMessage={commitMessage}
                  onMessageChange={setCommitMessage}
                  onSubmit={submitCommit}
                  onOpenDetail={(id) => {
                    setDetailId(id)
                    setDetailBack('history')
                    setSubPanel('detail')
                  }}
                  onOpenNote={onOpenNote}
                  onRetryCommit={onRetryCommit}
                  onBackToMain={() => setSubPanel('main')}
                />
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
