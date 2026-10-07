import { useEffect, useRef, useState } from 'react'
import { ArrowLeftToLine, ArrowRightToLine, FoldHorizontal, OctagonX, X } from 'lucide-react'
import type { AgentTabRef } from '../../learn/types'
import { agentTabCloseBlock, agentTabKey, type AgentTabCloseBlock } from '../../learn/agentTabs'
import { TAB_CLOSE_LABEL, type TabCloseMode } from '../../learn/tabs'
import { useClampToViewport, useDismissOn } from '../../lib/useDismiss'
import { t } from '../../i18n'

/**
 * agent 栏的页签条：与文档区同一套页签（TabBar 的样式与交互语言）。
 *
 * 一页签 = 一份独立的上下文与运行时——目标级导师一目标一枚（页签标题就是目标的标题），
 * 子代理会话一会话一枚（页签随时可关，任务在后台继续跑）。栏上**只有页签**：
 * 「正在辅导什么」等身份信息住在输入框下面的状态行（见 AgentPanel），这里不重复。
 *
 * 与文档区页签共有的四件事：文档区同款样式（active 页签从正文里长出来，底部两角
 * 反向圆角，见 workspace.css）、激活项自动滚到正中间、滚轮横滚（纵向滚轮也算横向）、
 * 右键菜单（关闭 / 关闭左侧 / 关闭右侧 / 关闭其他 / 全部关闭——每一枚都要过关闭守卫）。
 * 页签还多了**拖动排序**（栏内重排，不做跨格分割——agent 栏不分割）。
 */

interface Props {
  tabs: AgentTabRef[]
  activeId: string | null
  /** 页签标题：目标级显示目标的标题、子代理显示定义名（上层认得 store） */
  titleOf: (ref: AgentTabRef) => string
  /** 这一页签的导师 / 任务在不在跑（跑着的页签画一颗呼吸点，也参与关闭守卫） */
  runningOf: (ref: AgentTabRef) => boolean
  /** 关闭守卫的两项事实：目标级页签对应的目标在文档区有没有开着页签 */
  docTabsOf: (ref: AgentTabRef) => boolean
  onActivate: (key: string) => void
  /** 关闭（含守卫：拦下的页签由上层 toast 说明，本栏只管把意图递上去） */
  onClose: (key: string) => void
  /** 右键菜单按位置关一批（self/left/right/others/all），拦截同样在上层 */
  onCloseMode: (key: string, mode: TabCloseMode) => void
  /** 拖拽结束给出的新顺序（页签 key 列表） */
  onReorder: (keys: string[]) => void
}

const BLOCK_HINT: Record<Exclude<AgentTabCloseBlock, 'none'>, string> = {
  docs: '文档区还开着这个目标的页签，先关掉它们才能关闭导师',
  running: '导师正在运行，先停止这一轮再关闭',
}

/** 拖动一个页签要挪动这么多像素才算「在拖」，低于它仍是点击 */
const DRAG_MIN = 4

/** 页签之间的间距，与下面那个 gap-[3px] 是一对 */
const TAB_GAP = 3

/**
 * 目标级导师的页签图标：靶心。目标（goal）的靶子在正中，环一圈套一圈——
 * 与文档区页签的 DocTypeIcon 同一套 lucide 几何（24 视窗、2 描边、圆角端点），
 * 渲染成 13px。
 */
function GoalAgentIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={13}
      height={13}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={'shrink-0 ' + (className ?? '')}
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.5" fill="currentColor" />
    </svg>
  )
}

/**
 * 派生子代理的页签图标：一 node 出两支（share-2 的几何）——导师派出去的分身，
 * 源头与分身连成一张小网。与靶心并排摆在同一条栏上，级差一眼可辨。
 */
function SubAgentIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={13}
      height={13}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={'shrink-0 ' + (className ?? '')}
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.59 13.51l6.83 3.98" />
      <path d="M15.41 6.51l-6.82 3.98" />
    </svg>
  )
}

/** 拖动期间按 midpoints 现算「应该落到哪个位置」：与文档区 TabBar 同一套算法 */
function targetIndex(rects: Array<{ left: number; width: number }>, pointerX: number, from: number): number {
  let to = from
  if (pointerX > rects[from].left + rects[from].width / 2) {
    for (let i = from + 1; i < rects.length; i++) {
      if (pointerX < rects[i].left + rects[i].width / 2) break
      to = i
    }
  } else {
    for (let i = from - 1; i >= 0; i--) {
      if (pointerX > rects[i].left + rects[i].width / 2) break
      to = i
    }
  }
  return to
}

export default function AgentTabStrip({
  tabs,
  activeId,
  titleOf,
  runningOf,
  docTabsOf,
  onActivate,
  onClose,
  onCloseMode,
  onReorder,
}: Props) {
  const stripRef = useRef<HTMLDivElement | null>(null)
  /**
   * 激活的页签要**尽量落在正中间**（与文档区同一套算法，见 TabBar 的同名 effect）：
   * 不用 scrollIntoView——它只保证「露出来」，而且会连祖先容器一起滚。
   */
  useEffect(() => {
    if (!activeId) return
    const strip = stripRef.current
    if (!strip) return
    const el = [...strip.querySelectorAll<HTMLElement>('[data-tab]')].find(
      (n) => n.dataset.tab === activeId,
    )
    if (!el) return
    const sr = strip.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    const max = strip.scrollWidth - strip.clientWidth
    const target = strip.scrollLeft + (er.left + er.width / 2 - (sr.left + sr.width / 2))
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    strip.scrollTo({ left: Math.max(0, Math.min(max, target)), behavior: still ? 'auto' : 'smooth' })
  }, [activeId])

  /*
   * 滚轮横滚：鼠标的纵向滚轮也滚这条栏（触摸板的横向手势本来就能滚）。
   * React 的 onWheel 是被动监听，preventDefault 会被浏览器拒——走原生监听、
   * passive: false（文档区的 TabBar 也是同一条路，见它的 wheel 效果）。
   */
  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const dx = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (!dx || !el.scrollWidth || el.scrollWidth <= el.clientWidth) return
      el.scrollLeft += dx
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /* ---------- 拖动排序（栏内重排；算法与文档区一致，没有跨格分割这一层） ---------- */

  const [drag, setDrag] = useState<{ key: string; from: number; to: number; dx: number; width: number } | null>(null)
  /** 刚刚拖完的这一下不算「点击」（pointerup 之后浏览器补的那个 click） */
  const justDragged = useRef(false)
  const dragRef = useRef<{
    key: string
    from: number
    startX: number
    width: number
    rects: Array<{ left: number; width: number }>
    keys: string[]
  } | null>(null)
  const [snap, setSnap] = useState(false)
  const snapTimer = useRef(0)

  const shiftOf = (i: number): number => {
    if (!drag) return 0
    const step = drag.width + TAB_GAP
    if (drag.to > drag.from && i > drag.from && i <= drag.to) return -step
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return step
    return 0
  }

  const endDrag = (commit: boolean) => {
    const d = dragRef.current
    dragRef.current = null
    // 越过 DRAG_MIN（drag 非 null）才算拖过：普通点击不压掉接下来的 click
    const wasDragging = drag !== null
    if (wasDragging) justDragged.current = true
    if (d && wasDragging && commit && drag && drag.to !== drag.from) {
      const keys = [...d.keys]
      const [moved] = keys.splice(d.from, 1)
      keys.splice(drag.to, 0, moved)
      // 落位那一帧不许补间（moji-tab-snap），否则整条栏会从「让位中」抽回原位再滑回来
      setSnap(true)
      window.clearTimeout(snapTimer.current)
      snapTimer.current = window.setTimeout(() => setSnap(false), 50)
      onReorder(keys)
    }
    setDrag(null)
  }

  const onTabDown = (e: React.PointerEvent, key: string, index: number) => {
    if (e.button !== 0) return
    justDragged.current = false
    const strip = stripRef.current
    if (!strip) return
    const els = [...strip.querySelectorAll<HTMLElement>('[data-tab]')]
    const rects = els.map((el) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, width: r.width }
    })
    dragRef.current = {
      key,
      from: index,
      startX: e.clientX,
      width: rects[index]?.width ?? 0,
      rects,
      keys: tabs.map(agentTabKey),
    }
  }

  const onTabMove = (e: React.PointerEvent, key: string) => {
    const d = dragRef.current
    if (!d || d.key !== key) return
    const dx = e.clientX - d.startX
    if (!drag) {
      if (Math.abs(dx) < DRAG_MIN) return
      setDrag({ key, from: d.from, to: d.from, dx: 0, width: d.width })
    }
    const to = targetIndex(d.rects, e.clientX, d.from)
    setDrag((prev) => (prev ? { ...prev, to, dx } : prev))
  }

  /* ---------- 右键菜单 ---------- */

  const [menu, setMenu] = useState<{ x: number; y: number; key: string } | null>(null)
  const menuTab = menu ? tabs.find((tb) => agentTabKey(tb) === menu.key) : undefined
  const menuLabel = menuTab ? titleOf(menuTab) : ''
  const menuIndex = menu ? tabs.findIndex((tb) => agentTabKey(tb) === menu.key) : -1

  return (
    <>
      {/*
        与文档区页签栏同一套骨架：栏与正文之间一道下边框（绝对定位的一条线），
        选中的页签（z-10）用自己背景盖住脚下那一像素——页签是从正文里长出来的，
        不是浮在一条线上。底部两角再补反向圆角（moji-agent-tab-on，见 workspace.css）。
      */}
      <div
        className={
          'no-print relative flex shrink-0 items-stretch gap-2 px-2 pt-1.5 pb-0 ' +
          (tabs.length ? 'bg-paper/40 ' : '') +
          (snap ? 'moji-tab-snap' : '')
        }
      >
        <div
          ref={stripRef}
          role="tablist"
          className="moji-tab-strip flex min-w-0 flex-1 items-end gap-[3px] overflow-x-auto"
        >
          {tabs.map((ref, i) => {
            const key = agentTabKey(ref)
            const on = key === activeId
            const running = runningOf(ref)
            const block = agentTabCloseBlock(ref, { hasDocTabs: docTabsOf(ref), running })
            const closable = block === 'none'
            const title = titleOf(ref)
            const dragging = drag?.key === key
            const offset = dragging ? drag.dx : shiftOf(i)
            return (
              <div
                key={key}
                data-tab={key}
                role="tab"
                aria-selected={on}
                tabIndex={0}
                title={title + (closable ? '' : '（' + t(BLOCK_HINT[block]) + '）')}
                onClick={() => {
                  if (justDragged.current) return
                  onActivate(key)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onActivate(key)
                }}
                onPointerDown={(e) => onTabDown(e, key, i)}
                onPointerMove={(e) => onTabMove(e, key)}
                onPointerUp={() => endDrag(true)}
                onPointerCancel={() => endDrag(false)}
                onContextMenu={(e) => {
                  // 右键先在菜单里选中这一项：对着 A 右键却关掉 B，是最难解释的一类交互
                  e.preventDefault()
                  setMenu({ x: e.clientX, y: e.clientY, key })
                }}
                style={{ transform: offset ? 'translateX(' + offset + 'px)' : undefined }}
                className={
                  'moji-tab group relative flex h-7 min-w-[120px] max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-[12px] ' +
                  (on ? 'moji-agent-tab-on z-10 font-medium ' : '') +
                  (dragging
                    ? 'z-10 cursor-grabbing border-line-strong bg-card text-ink-strong shadow-md '
                    : 'transition-transform duration-150 ') +
                  (on
                    ? 'border-line-strong bg-card text-ink-strong'
                    : 'border-transparent text-ink-soft hover:bg-line/50 hover:text-ink')
                }
              >
                {ref.kind === 'goal' ? (
                  <GoalAgentIcon className={running ? 'text-seal' : ''} />
                ) : (
                  <SubAgentIcon className={running ? 'text-seal' : ''} />
                )}
                <span className="min-w-0 flex-1 truncate">{title}</span>
                {running && (
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-seal" />
                )}
                {/*
                  关闭键固定在右端，鼠标扫过这一条页签时才亮出来（与文档区同一条规矩：
                  常驻的 × 是一排噪声）。被守卫拦着时它点不动，悬停提示说清为什么。
                */}
                <button
                  type="button"
                  disabled={!closable}
                  title={closable ? t(TAB_CLOSE_LABEL.self) : t(BLOCK_HINT[block])}
                  aria-label={t(TAB_CLOSE_LABEL.self)}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(key)
                  }}
                  className={
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded transition focus-visible:opacity-100 group-hover:opacity-70 ' +
                    (closable
                      ? 'opacity-0 hover:bg-line-strong/60'
                      : 'cursor-not-allowed opacity-0 group-hover:opacity-40')
                  }
                >
                  <X size={11} />
                </button>
              </div>
            )
          })}
        </div>

        {/*
          栏与正文之间的下边框：绝对定位的一条线（粗细与页签描边一致），
          选中的页签用 z-10 的背景把它盖掉——线在两侧继续、到这里「断开」。
        */}
        {!!tabs.length && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-line-strong" />
        )}
      </div>

      {menu && menuTab && (
        <AgentTabMenu
          menu={menu}
          label={menuLabel}
          count={tabs.length}
          leftCount={Math.max(0, menuIndex)}
          rightCount={Math.max(0, tabs.length - menuIndex - 1)}
          otherCount={Math.max(0, tabs.length - 1)}
          onPick={(mode) => {
            onCloseMode(menu.key, mode)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}

/**
 * 页签的右键菜单：与文档区 TabMenu 同一套骨架与文案（TAB_CLOSE_LABEL），
 * 少了收藏那一组——导师页签没有可收藏的形态。
 */
function AgentTabMenu({
  menu,
  label,
  count,
  leftCount,
  rightCount,
  otherCount,
  onPick,
  onClose,
}: {
  menu: { x: number; y: number }
  label: string
  count: number
  leftCount: number
  rightCount: number
  otherCount: number
  onPick: (mode: TabCloseMode) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useDismissOn({ onClose })
  useClampToViewport(ref, menu)

  return (
    <div
      ref={ref}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      className="moji-in-soft fixed z-[70] min-w-[196px] rounded-lg border border-line-strong bg-card p-1 shadow-[0_12px_36px_rgba(31,27,23,0.24)]"
    >
      {/* 抬头：这一下是对着哪一位导师（与文档区菜单同一条规矩） */}
      <div className="truncate px-2.5 py-1 text-[10.5px] text-ink-faint" title={label}>
        {label}
      </div>

      <span aria-hidden="true" className="my-1 block h-px bg-line" />

      <button type="button" role="menuitem" onClick={() => onPick('self')} className={ROW}>
        <span className={ICON}>
          <X size={13} className="text-ink-soft" />
        </span>
        {t(TAB_CLOSE_LABEL.self)}
      </button>

      <span aria-hidden="true" className="my-1 block h-px bg-line" />
      <button type="button" role="menuitem" disabled={leftCount === 0} onClick={() => onPick('left')} className={ROW}>
        <span className={ICON}>
          <ArrowLeftToLine size={13} className="text-seal" />
        </span>
        {t(TAB_CLOSE_LABEL.left)}
        <span className={COUNT}>{leftCount}</span>
      </button>
      <button type="button" role="menuitem" disabled={rightCount === 0} onClick={() => onPick('right')} className={ROW}>
        <span className={ICON}>
          <ArrowRightToLine size={13} className="text-seal" />
        </span>
        {t(TAB_CLOSE_LABEL.right)}
        <span className={COUNT}>{rightCount}</span>
      </button>
      <button type="button" role="menuitem" disabled={otherCount === 0} onClick={() => onPick('others')} className={ROW}>
        <span className={ICON}>
          <FoldHorizontal size={13} className="text-seal" />
        </span>
        {t(TAB_CLOSE_LABEL.others)}
        <span className={COUNT}>{otherCount}</span>
      </button>

      <span aria-hidden="true" className="my-1 block h-px bg-line" />
      <button
        type="button"
        role="menuitem"
        title={t('这一格里的页签全部关掉（含当前这一个）')}
        onClick={() => onPick('all')}
        className={ROW + ' text-seal-deep hover:bg-seal/10'}
      >
        <span className={ICON}>
          <OctagonX size={13} />
        </span>
        {t(TAB_CLOSE_LABEL.all)}
        <span className={COUNT}>{count}</span>
      </button>
    </div>
  )
}

const ROW =
  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink transition hover:bg-line/60 disabled:cursor-not-allowed disabled:opacity-40'
const ICON = 'flex h-4 w-4 shrink-0 items-center justify-center'
const COUNT = 'ml-auto shrink-0 text-[10.5px] tabular-nums text-ink-faint'
