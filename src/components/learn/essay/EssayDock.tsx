/**
 * 随笔：文档区右下角那颗**悬浮按钮**，以及它展开之后的那扇小窗口。
 *
 * 四件事写在前面：
 *
 * 1. **按钮变成窗口**。收起时是一颗圆按钮（点它、或双击 Shift，见 lib/useDoubleShift），
 *    点开的那一刻它不再是「消失 + 另弹一块」：窗口从按钮的位置与尺寸出发，圆角从正圆
 *    过渡到方角，边长大到窗口大小（动的是 left / top / width / height / border-radius，
 *    不是等比缩放——那会把字拉变形）。收起时原路缩回按钮，动画播完才卸载（见 lib/presence）。
 * 2. **没有「新建」**。随笔的粒度小到不值得一次确认：写下第一个字，它当场成一条
 *    （去抖 400ms 之后落库，见 learn/essays）。清空再写就是下一条；空文本永远不落盘。
 *    打开窗口时**自动接上今天那条**（今天已经写过就继续写它），没有才是一张白纸。
 * 3. **顶部下拉选随笔**（用户定的）：不再在左边占一列列表——窗口只有一扇，正文才是主角。
 *    下拉里按日期列（同一天有多条时带序号），另有一项「空白（新的一条）」。
 * 4. **提交像 git**（见 learn/essayCommits）：把这一批随笔封成快照，交给 Agent 整理进
 *    知识树对应节点的笔记；整理结果（新建 / 更新了哪几份笔记）记在这次提交上，
 *    历史与详情都在同一个窗口里看。快照是自足的：之后随笔再改，回看仍是当时的原样。
 *
 * 窗口能拖、能拉右下角改大小，几何存在 state.json（见 learn/types 的 EssayDockRect）：
 * 下次打开还在你摆的那个位置。**打开那一刻要重新夹一遍视口**——上次是 1440 宽的屏，
 * 这次可能只有 900，存下来的坐标必须当场收回来（见 clampRect）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft,
  FileText,
  GitCommitHorizontal,
  History,
  Loader2,
  PenLine,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import type { EssayCommit, EssayDockRect, EssayEntry } from '../../../learn/types'
import { ESSAY_DOCK_MIN_H, ESSAY_DOCK_MIN_W, essayPreview, dayOfEssay } from '../../../learn/essays'
import { changesSummary } from '../../../learn/essayCommits'
import { usePresence } from '../../../lib/presence'
import { t } from '../../../i18n'
import EssayEditor from './EssayEditor'

/** 默认尺寸：够一屏里读一段、写一段，又不至于把正文全挡住 */
const DEFAULT_W = 620
const DEFAULT_H = 420
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

/** 窗口里的四块：写随笔 / 提交确认 / 提交历史 / 某次提交的详情 */
type Panel = 'edit' | 'commit' | 'history' | 'detail'

/**
 * 没存过几何时的位置：**从按钮那一角长出来**（窗口的右下角贴着按钮的右下角）。
 * 量不到按钮（双击 Shift 唤出的、或此刻不在教学文档上）就退回视口右下角。
 */
function defaultRect(anchor?: DOMRect | null): EssayDockRect {
  const w = Math.min(DEFAULT_W, Math.max(ESSAY_DOCK_MIN_W, window.innerWidth - 96))
  const h = Math.min(DEFAULT_H, Math.max(ESSAY_DOCK_MIN_H, window.innerHeight - 140))
  const right = anchor ? anchor.right + 4 : window.innerWidth - 20
  const bottom = anchor ? anchor.bottom + 4 : window.innerHeight - 20
  return { x: right - w, y: bottom - h, w, h }
}

/** 夹进视口：窗口不许被拖到看不见的地方（拖出去就再也抓不回来了） */
function clampRect(r: EssayDockRect): EssayDockRect {
  const maxW = Math.max(ESSAY_DOCK_MIN_W, window.innerWidth - 24)
  const maxH = Math.max(ESSAY_DOCK_MIN_H, window.innerHeight - 24)
  const w = Math.min(Math.max(ESSAY_DOCK_MIN_W, r.w), maxW)
  const h = Math.min(Math.max(ESSAY_DOCK_MIN_H, r.h), maxH)
  return {
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
  /** 从提交详情里打开一份被整理过的笔记 */
  onOpenNote: (nodeId: string, noteName: string) => void
  /** 上次存下来的窗口几何（没有就用默认位置） */
  geometry: EssayDockRect | null
  onGeometry: (rect: EssayDockRect) => void
  /** 写下第一个字时落一条；返回新条目的 id（空文本返回 null，什么都不做） */
  onCreate: (goalId: string, text: string) => string | null
  onUpdate: (goalId: string, id: string, text: string) => void
  onDelete: (goalId: string, id: string) => void
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
}: Props) {
  // 退场要等变形播完才卸载：130ms 那套默认时序会把缩回去的动画切掉一半
  const { setOpen: setMounted, mounted } = usePresence(false, MORPH_MS + 20)
  const btnRef = useRef<HTMLButtonElement | null>(null)

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

  /** 现在看的是窗口里的哪一块 */
  const [panel, setPanel] = useState<Panel>('edit')
  /** 正在看哪一条提交；null = 没打开详情 */
  const [detailId, setDetailId] = useState<string | null>(null)
  /** 详情是从哪儿进去的：返回时回到那儿（历史 / 刚提交完的编辑页） */
  const [detailBack, setDetailBack] = useState<'edit' | 'history'>('history')
  /** 提交说明（打开提交页时给一句默认的） */
  const [commitMessage, setCommitMessage] = useState('')

  /** 正在编辑哪一条；null = 空白编辑器（下一条随笔还没出生） */
  const [editingId, setEditingId] = useState<string | null>(null)
  const editingRef = useRef<string | null>(null)
  const [text, setText] = useState('')
  const textRef = useRef('')

  /** 还没落库的那一次改动 */
  const pendingRef = useRef<{ id: string | null; text: string } | null>(null)
  const timerRef = useRef<number | null>(null)

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const p = pendingRef.current
    pendingRef.current = null
    if (!p) return
    if (p.id) {
      // 改成空 = 这条随笔被擦干净了：不写空文本，留给 settle 去删（见下）
      if (p.text.trim()) onUpdate(goalId, p.id, p.text)
      return
    }
    if (!p.text.trim()) return
    const id = onCreate(goalId, p.text)
    if (id) {
      editingRef.current = id
      setEditingId(id)
    }
  }, [goalId, onCreate, onUpdate])

  /**
   * 收尾：把没落库的那一下写掉，再把「被擦干净的那一条」删掉。
   * 切到别的随笔、关窗口、卸载都走它——空文本不该在列表里留一行空白。
   */
  const settle = useCallback(() => {
    flush()
    const id = editingRef.current
    if (id && !textRef.current.trim()) {
      onDelete(goalId, id)
      editingRef.current = null
      setEditingId(null)
    }
  }, [flush, goalId, onDelete])

  const queue = useCallback((next: string) => {
    pendingRef.current = { id: editingRef.current, text: next }
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
      queue(next)
    },
    [queue],
  )

  /** 空白编辑器：下一条随笔从这儿开始 */
  const startBlank = useCallback(() => {
    settle()
    editingRef.current = null
    setEditingId(null)
    textRef.current = ''
    setText('')
    setPanel('edit')
  }, [settle])

  const openEssay = useCallback(
    (essay: EssayEntry) => {
      if (essay.id !== editingRef.current) {
        settle()
        editingRef.current = essay.id
        setEditingId(essay.id)
        textRef.current = essay.text
        setText(essay.text)
      }
      setPanel('edit')
    },
    [settle],
  )

  const removeEssay = useCallback(
    (id: string) => {
      // 先掐掉去抖：否则 400ms 后 flush 会把这句「已删除的正文」又写成一条新随笔
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      pendingRef.current = null
      onDelete(goalId, id)
      if (id === editingRef.current) {
        editingRef.current = null
        setEditingId(null)
        textRef.current = ''
        setText('')
      }
    },
    [goalId, onDelete],
  )

  /**
   * 打开那一刻接上**今天那条**：今天已经写过，就接着写它（一条随笔是一天的流水账，
   * 不该每开一次窗口就另起一条）；今天还没写，才给一张白纸。
   * 用 ref 读最新清单：把 essays 写进下面的依赖会让「写一个字」就重跑一次打开逻辑。
   */
  const essaysRef = useRef(essays)
  useEffect(() => {
    essaysRef.current = essays
  }, [essays])

  const openInitial = useCallback(() => {
    setPanel('edit')
    setDetailId(null)
    const today = dayOfEssay(Date.now())
    const hit = essaysRef.current.find((e) => dayOfEssay(e.createdAt) === today)
    if (!hit) {
      startBlank()
      return
    }
    settle()
    editingRef.current = hit.id
    setEditingId(hit.id)
    textRef.current = hit.text
    setText(hit.text)
  }, [settle, startBlank])

  /*
   * 打开：接上今天那条，然后**从按钮那颗圆长出来**；关掉时收尾并缩回按钮。
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
      const next = clampRect(geometry ?? defaultRect(btn?.getBoundingClientRect() ?? null))
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
    const onUp = () => {
      setMoving(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      onGeometry(rectRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
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
    const onUp = () => {
      setMoving(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      onGeometry(rectRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // Esc：在子页面里先退回编辑页；已经在编辑页了才收起窗口
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (panel === 'detail') {
        setPanel(detailBack)
        return
      }
      if (panel !== 'edit') {
        setPanel('edit')
        return
      }
      onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, panel, detailBack, onOpenChange])

  /* ---------- 提交 ---------- */
  /** 还没提交的随笔：最近一次提交之后写过 / 改过的 */
  const lastCommitAt = commits[0]?.at ?? 0
  const pending = essays.filter((e) => e.updatedAt > lastCommitAt)
  /** 编辑器里的字与已经落库的那一份不一样（刚敲下、去抖还没写进去） */
  const storedText = editingId ? (essays.find((e) => e.id === editingId)?.text ?? '') : ''
  const dirty = text.trim() !== storedText.trim()
  const commitVisible = pending.length > 0 || dirty

  const openCommitPanel = () => {
    // 去抖中的正文先落库，否则刚写的最后一句不会进快照
    flush()
    setCommitMessage(t('随笔整理 · {0}', dateLabelOfEssay(Date.now())))
    setPanel('commit')
  }

  const submitCommit = () => {
    const id = onCommit(commitMessage.trim())
    if (!id) return
    setDetailId(id)
    setDetailBack('edit')
    setPanel('detail')
  }

  const activeCommit = detailId ? commits.find((c) => c.id === detailId) ?? null : null

  const backFromPanel = () => {
    if (panel === 'detail') {
      setPanel(detailBack)
      return
    }
    setPanel('edit')
  }

  const panelTitle = panel === 'commit' ? t('提交随笔') : panel === 'history' ? t('提交记录') : activeCommit?.message ?? t('提交详情')

  /** 下拉里的那一行：日期；同一天有多条时带个序号，免得选不清 */
  const optionLabel = (essay: EssayEntry): string => {
    const day = dayOfEssay(essay.createdAt)
    const same = essays.filter((x) => dayOfEssay(x.createdAt) === day)
    if (same.length <= 1) return dateLabelOfEssay(essay.createdAt)
    return dateLabelOfEssay(essay.createdAt) + ' · ' + (same.findIndex((x) => x.id === essay.id) + 1)
  }

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
              {/* 顶栏：编辑时是下拉 + 提交 + 历史；子页面里是返回 + 标题。整条都能拖动挪窗口 */}
              <div
                onPointerDown={beginDrag}
                className="flex shrink-0 cursor-grab items-center gap-1.5 border-b border-line bg-card/70 px-2.5 py-1.5 active:cursor-grabbing"
              >
                <PenLine size={13} className="shrink-0 text-seal/80" />
                {panel === 'edit' ? (
                  <>
                    <select
                      value={editingId ?? ''}
                      onChange={(e) => {
                        const v = e.target.value
                        if (!v) {
                          startBlank()
                          return
                        }
                        const found = essays.find((x) => x.id === v)
                        if (found) openEssay(found)
                      }}
                      title={t('选择要编辑的随笔')}
                      className="h-6 min-w-0 max-w-[150px] flex-1 cursor-pointer rounded-md border border-line bg-paper/70 px-1 text-[11px] text-ink-soft outline-none transition hover:border-line-strong focus:border-seal/50"
                    >
                      <option value="">{t('空白（新的一条）')}</option>
                      {essays.map((essay) => (
                        <option key={essay.id} value={essay.id}>
                          {optionLabel(essay)}
                        </option>
                      ))}
                    </select>
                    {editingId && (
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
                    <span className="min-w-0 flex-1" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={openCommitPanel}
                      disabled={!commitVisible}
                      title={
                        commitVisible
                          ? t('提交这批随笔：封存快照，交给 AI 整理进对应节点的笔记')
                          : t('还没有写过的内容，先写点什么再提交')
                      }
                      className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-seal/10 px-1.5 text-[10.5px] font-medium text-seal-deep transition hover:bg-seal/15 disabled:cursor-default disabled:opacity-40"
                    >
                      <GitCommitHorizontal size={12} />
                      {t('提交…')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPanel('history')}
                      title={t('提交记录：快照与每次整理动过的笔记')}
                      aria-label={t('提交记录')}
                      className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/60 hover:text-ink"
                    >
                      <History size={13} />
                      {commits.length > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-seal px-0.5 text-[8px] leading-none text-white">
                          {commits.length > 9 ? '9+' : commits.length}
                        </span>
                      )}
                    </button>
                  </>
                ) : (
                  <>
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
                    {panel === 'detail' && activeCommit && <StatusBadge status={activeCommit.status} />}
                  </>
                )}
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

              {panel === 'edit' && (
                <>
                  <div className="flex min-h-0 flex-1 flex-col bg-card">
                    <EssayEditor
                      value={text}
                      onChange={change}
                      placeholder={t('随手记点什么…（支持 Markdown，停手即存）')}
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1 text-[10.5px] text-ink-faint">
                    <span>{editingId ? t('已自动保存') : t('写下第一个字，它就成了一条随笔')}</span>
                    <span className="ml-auto tabular-nums">{text.length ? t('{0} 字', text.length) : ''}</span>
                  </div>
                </>
              )}

              {panel === 'commit' && (
                <div className="flex min-h-0 flex-1 flex-col bg-card">
                  <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
                    <p className="text-[11px] leading-relaxed text-ink-faint">
                      {t('提交后 AI 会按内容把这些随笔整理进对应节点的笔记；整理结果会记在这次提交上，随时可以回看。')}
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
                      <span className="text-[10.5px] text-ink-faint">{t('{0} 条随笔', String(pending.length))}</span>
                    </div>
                    <div className="mt-1.5 space-y-1.5">
                      {pending.length === 0 ? (
                        <p className="px-1 py-2 text-[11px] text-ink-faint">{t('没有新的随笔可以提交')}</p>
                      ) : (
                        pending.map((essay) => (
                          <div key={essay.id} className="rounded-lg border border-line bg-paper/60 px-2.5 py-2">
                            <div className="text-[10.5px] text-ink-faint">{dateLabelOfEssay(essay.createdAt)}</div>
                            <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-ink-soft">
                              {essayPreview(essay.text, 140)}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-line px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setPanel('edit')}
                      className="h-7 rounded-md px-2.5 text-[11.5px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
                    >
                      {t('取消')}
                    </button>
                    <button
                      type="button"
                      onClick={submitCommit}
                      disabled={pending.length === 0}
                      className="flex h-7 items-center gap-1.5 rounded-md bg-seal px-3 text-[11.5px] font-medium text-white shadow-sm transition hover:bg-seal-deep disabled:cursor-default disabled:opacity-40"
                    >
                      <GitCommitHorizontal size={13} />
                      {t('提交并整理')}
                    </button>
                  </div>
                </div>
              )}

              {panel === 'history' && (
                <div className="flex min-h-0 flex-1 flex-col bg-card">
                  <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                    {commits.length === 0 ? (
                      <p className="px-2 py-4 text-[11px] leading-relaxed text-ink-faint">
                        {t('还没有提交记录：把随笔提交一次，这里会留下快照与每次整理动过的笔记。')}
                      </p>
                    ) : (
                      commits.map((commit) => (
                        <button
                          key={commit.id}
                          type="button"
                          onClick={() => {
                            setDetailId(commit.id)
                            setDetailBack('history')
                            setPanel('detail')
                          }}
                          className="mb-1 flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-line/50"
                        >
                          <span className="flex w-full items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-strong">
                              {commit.message}
                            </span>
                            <StatusBadge status={commit.status} />
                          </span>
                          <span className="flex w-full items-center gap-2 text-[10.5px] text-ink-faint">
                            <span>{timeLabel(commit.at)}</span>
                            <span>·</span>
                            <span>{t('{0} 条随笔', String(commit.snapshot.length))}</span>
                            {commit.status === 'done' && (
                              <>
                                <span>·</span>
                                <span className="min-w-0 truncate">{changesSummary(commit.changes)}</span>
                              </>
                            )}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {panel === 'detail' && (
                <div className="flex min-h-0 flex-1 flex-col bg-card">
                  {activeCommit ? (
                    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
                      <div className="text-[10.5px] text-ink-faint">
                        {timeLabel(activeCommit.at)} · {t('{0} 条随笔', String(activeCommit.snapshot.length))}
                      </div>

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
                        <div className="mt-1.5 space-y-1.5">
                          {activeCommit.snapshot.map((essay) => (
                            <div key={essay.id} className="rounded-lg border border-line bg-paper/50 px-2.5 py-2">
                              <div className="text-[10px] text-ink-faint">{dateLabelOfEssay(essay.createdAt)}</div>
                              <p className="mt-1 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-ink-soft">
                                {essay.text}
                              </p>
                            </div>
                          ))}
                        </div>
                      </section>
                    </div>
                  ) : (
                    <p className="px-3 py-4 text-[11px] text-ink-faint">{t('这条提交记录已经不在了')}</p>
                  )}
                  {activeCommit && (
                    <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1.5 text-[10.5px] text-ink-faint">
                      <span className="min-w-0 flex-1 truncate">
                        {t('提交后仍可继续写；下次提交只整理新增和改动')}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPanel('edit')}
                        className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-seal/10 px-2 text-[10.5px] font-medium text-seal-deep transition hover:bg-seal/15"
                      >
                        <PenLine size={11} />
                        {t('继续写随笔')}
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
