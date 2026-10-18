/**
 * 随笔：文档区右下角那颗**悬浮按钮**，以及它展开之后的那扇小窗口。
 *
 * 三件事写在前面：
 *
 * 1. **按钮变成窗口**。收起时是一颗圆按钮（点它、或双击 Shift，见 lib/useDoubleShift），
 *    展开时按钮消失、窗口从同一个角落长出来（transform-origin 在右下，动画见下）。
 * 2. **没有「新建」**。随笔的粒度小到不值得一次确认：窗口一开就是空白编辑器，
 *    写下第一个字的那一刻它就成了一条（去抖 400ms 之后落库，见 learn/essays）。
 *    清空再写就是下一条；空文本永远不落盘，所以列表里不会出现空白条目。
 * 3. **左右布局**：左边按日期归堆的列表（可点开改、可删），右边是带 Markdown 高亮的输入区。
 *
 * 窗口能拖、能拉右下角改大小，几何存在 state.json（见 learn/types 的 EssayDockRect）：
 * 下次打开还在你摆的那个位置。**打开那一刻要重新夹一遍视口**——上次是 1440 宽的屏，
 * 这次可能只有 900，存下来的坐标必须当场收回来（见 clampRect）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { animate } from 'animejs'
import { ArrowLeft, PenLine, Trash2, X } from 'lucide-react'
import type { EssayDockRect, EssayEntry } from '../../../learn/types'
import {
  ESSAY_DOCK_MIN_H,
  ESSAY_DOCK_MIN_W,
  dayOfEssay,
  essayPreview,
  groupEssaysByDay,
  timeOfEssay,
} from '../../../learn/essays'
import { usePresence } from '../../../lib/presence'
import { t } from '../../../i18n'
import EssayEditor from './EssayEditor'

/** 默认尺寸：够一屏里同时看见列表与几行字，又不至于把正文全挡住 */
const DEFAULT_W = 620
const DEFAULT_H = 420
/** 自动落库的去抖：一直在打字就不写盘，停手这么久才落一条 */
const SAVE_MS = 400

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

/** 日期分组标题：今天 / 昨天 / 10 月 12 日（跨年才带年份） */
function dayLabel(day: string): string {
  const now = Date.now()
  if (day === dayOfEssay(now)) return t('今天')
  if (day === dayOfEssay(now - 86_400_000)) return t('昨天')
  const [y, m, d] = day.split('-')
  const sameYear = String(new Date(now).getFullYear()) === y
  return sameYear
    ? t('{0} 月 {1} 日', String(Number(m)), String(Number(d)))
    : t('{0} 年 {1} 月 {2} 日', y, String(Number(m)), String(Number(d)))
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
  geometry,
  onGeometry,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  const { setOpen: setMounted, mounted, closing } = usePresence()
  const cardRef = useRef<HTMLDivElement | null>(null)

  // 开合时序交给 usePresence：退场动画播完才卸载（与其它浮层同一条规矩）
  useEffect(() => {
    setMounted(open)
  }, [open, setMounted])

  const [rect, setRect] = useState<EssayDockRect>(() => clampRect(geometry ?? defaultRect()))
  const rectRef = useRef(rect)
  /** 入口按钮那一刻的位置：窗口第一次打开时从这一角长出来（存过几何就不用它了） */
  const anchorRef = useRef<DOMRect | null>(null)

  /** 正在编辑哪一条；null = 空白编辑器（下一条随笔还没出生） */
  const [editingId, setEditingId] = useState<string | null>(null)
  const editingRef = useRef<string | null>(null)
  /** 这一条是从列表里点开的（是的话标题栏给一颗「回到空白」） */
  const [fromList, setFromList] = useState(false)
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
    setFromList(false)
    textRef.current = ''
    setText('')
  }, [settle])

  const openEssay = useCallback(
    (essay: EssayEntry) => {
      if (essay.id === editingRef.current) return
      settle()
      editingRef.current = essay.id
      setEditingId(essay.id)
      setFromList(true)
      textRef.current = essay.text
      setText(essay.text)
    },
    [settle],
  )

  const removeEssay = useCallback(
    (id: string) => {
      onDelete(goalId, id)
      if (id === editingRef.current) {
        editingRef.current = null
        setEditingId(null)
        setFromList(false)
        textRef.current = ''
        setText('')
      }
    },
    [goalId, onDelete],
  )

  /*
   * 打开：**从空白开始**（「随手记」的那一下），并把窗口重新夹进当前视口。
   * 关掉时收尾（把最后一下落库、删掉被擦空的条目）。
   */
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open === wasOpen.current) return
    wasOpen.current = open
    if (open) {
      startBlank()
      const anchor = anchorRef.current
      anchorRef.current = null
      const next = clampRect(geometry ?? defaultRect(anchor))
      rectRef.current = next
      setRect(next)
    } else {
      settle()
    }
    // geometry 只在「打开那一刻」读一次：拖过之后窗口自己就是最新的，不必跟着它重摆
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startBlank, settle])

  // 卸载（换目标、关学习区）也要把没落库的那一下写掉。
  // 走 ref：settle 的身份会随父组件重渲染变，直接写进依赖里会变成「每次变都 settle 一次」
  const settleRef = useRef(settle)
  useEffect(() => {
    settleRef.current = settle
  }, [settle])
  useEffect(() => () => settleRef.current(), [])

  /* ---------- 动画 ---------- */
  useEffect(() => {
    const el = cardRef.current
    if (!el || !mounted) return
    animate(el, { opacity: [0, 1], scale: [0.94, 1], y: [10, 0], duration: 240, ease: 'out(3)' })
  }, [mounted])

  useEffect(() => {
    const el = cardRef.current
    if (!el || !closing) return
    animate(el, { opacity: [1, 0], scale: [1, 0.97], y: [0, 6], duration: 120, ease: 'in(2)' })
  }, [closing])

  /* ---------- 拖动与改大小 ---------- */
  const beginDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
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
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      onGeometry(rectRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // Esc 收起（与其它浮层同一条规矩）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  const groups = groupEssaysByDay(essays)

  return (
    <>
      {/*
        入口：一颗悬浮圆按钮，贴在文档区右下角。
        窗口开着时它不出现——按需求「按钮自身变成窗口」，两者是同一个东西的两态。
      */}
      {showEntry && !open && (
        <button
          type="button"
          onClick={(e) => {
            anchorRef.current = e.currentTarget.getBoundingClientRect()
            onOpenChange(true)
          }}
          title={t('随笔（双击 Shift 也能唤出）')}
          aria-label={t('随笔')}
          className="no-print absolute bottom-4 right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-line-strong/70 bg-card/85 text-seal-deep shadow-[0_6px_20px_rgba(31,27,23,0.16)] backdrop-blur transition hover:border-seal/45 hover:bg-card hover:text-seal active:scale-95"
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
            className="no-print fixed z-[80]"
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
            role="dialog"
            aria-label={t('随笔')}
          >
            <div
              ref={cardRef}
              style={{ transformOrigin: '100% 100%' }}
              className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-line-strong bg-paper shadow-[0_24px_64px_rgba(31,27,23,0.28)]"
            >
              {/* 标题栏：拖动它挪窗口（按钮上不拖，免得点不着） */}
              <div
                onPointerDown={beginDrag}
                className="flex shrink-0 cursor-grab items-center gap-2 border-b border-line bg-card/70 px-3 py-2 active:cursor-grabbing"
              >
                <PenLine size={13} className="text-seal/80" />
                <span className="text-[12.5px] font-medium text-ink-strong">{t('随笔')}</span>
                <span className="text-[11px] text-ink-faint">
                  {essays.length ? t('{0} 条', essays.length) : ''}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  {fromList && (
                    <button
                      type="button"
                      onClick={startBlank}
                      title={t('回到空白：写下第一个字就是新的一条')}
                      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-ink-faint transition hover:bg-line/60 hover:text-ink"
                    >
                      <ArrowLeft size={12} />
                      {t('空白')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenChange(false)}
                    title={t('收起（Esc）')}
                    aria-label={t('收起')}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/60 hover:text-ink"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>

              <div className="flex min-h-0 flex-1">
                {/* 左：按日期归堆的列表 */}
                <div className="flex w-[172px] shrink-0 flex-col border-r border-line bg-sunken/40">
                  <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
                    {groups.length === 0 ? (
                      <p className="px-1.5 py-2 text-[11.5px] leading-relaxed text-ink-faint">
                        {t('还没有随笔。想到什么，写下来就是了。')}
                      </p>
                    ) : (
                      groups.map((group) => (
                        <div key={group.day} className="mb-1.5">
                          <div className="px-1.5 py-1 text-[10.5px] font-medium tracking-wide text-ink-faint">
                            {dayLabel(group.day)}
                          </div>
                          {group.items.map((essay) => {
                            const on = essay.id === editingId
                            return (
                              <div
                                key={essay.id}
                                className={
                                  'group/row relative rounded-md transition ' +
                                  (on ? 'bg-seal/10' : 'hover:bg-line/50')
                                }
                              >
                                <button
                                  type="button"
                                  onClick={() => openEssay(essay)}
                                  title={essayPreview(essay.text, 200)}
                                  className="flex w-full flex-col items-start gap-0.5 rounded-md px-1.5 py-1 pr-6 text-left"
                                >
                                  <span className="flex w-full items-baseline gap-1.5">
                                    <span className="shrink-0 text-[10.5px] tabular-nums text-ink-faint">
                                      {timeOfEssay(essay.createdAt)}
                                    </span>
                                    <span
                                      className={
                                        'truncate text-[11.5px] ' + (on ? 'text-seal-deep' : 'text-ink-soft')
                                      }
                                    >
                                      {essayPreview(essay.text, 40) || t('（空）')}
                                    </span>
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeEssay(essay.id)}
                                  title={t('删除这条随笔')}
                                  aria-label={t('删除')}
                                  className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-ink-faint opacity-0 transition hover:bg-seal/10 hover:text-seal-deep group-hover/row:opacity-100"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* 右：输入区（Markdown 高亮，自动落库） */}
                <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
                  <EssayEditor
                    value={text}
                    onChange={change}
                    placeholder={t('随手记点什么…（支持 Markdown，停手即存）')}
                  />
                  <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-1 text-[10.5px] text-ink-faint">
                    <span>{editingId ? t('已自动保存') : t('写下第一个字，它就成了一条随笔')}</span>
                    <span className="ml-auto tabular-nums">{text.length ? t('{0} 字', text.length) : ''}</span>
                  </div>
                </div>
              </div>

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
