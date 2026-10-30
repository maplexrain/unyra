import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FoldHorizontal, MessageSquare, OctagonX, Plus, ShieldAlert, X } from 'lucide-react'
import type { AgentTabRef } from '../../learn/types'
import { agentTabCloseBlock, agentTabKey, disambiguateTabTitles, type AgentTabCloseBlock } from '../../learn/agentTabs'
import { TAB_CLOSE_LABEL, type TabCloseMode } from '../../learn/tabs'
import { useClampToViewport, useDismissOn } from '../../lib/useDismiss'
import { TAB_EXIT_MS, useTabPresence } from '../../lib/tabPresence'
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
  /** 新建对话：在当前目标下新建一段对话并增加一个对话页签 */
  onNewConversation?: () => void
}

function blockHintOf(block: AgentTabCloseBlock): string {
  if (block === 'docs') return t('文档区还开着这个目标的页签，先关掉它们才能关闭导师')
  if (block === 'running') return t('导师正在运行，先停止这一轮再关闭')
  return ''
}

/** 拖动一个页签要挪动这么多像素才算「在拖」，低于它仍是点击 */
const DRAG_MIN = 4

/** 页签之间的间距，与下面那个 gap-[3px] 是一对 */
const TAB_GAP = 3

/**
 * 三种页签图标各自的**类型色**：颜色不跟主题变量走，只跟「这是哪一种页签」走——
 * 与文档区页签的 DocTypeIcon 同一条规矩（切到深色或粉色主题，灰的还是灰的、蓝的还是蓝的，
 * 靠颜色认「这一格是谁」才认得稳）。同一栏上三种页签并排，形状之外再给一层颜色级差：
 * 中性灰=固定聊天（栏的底座） / 教学蓝=目标级导师（它就是写教学文档的那位） /
 * 分身紫=子代理（派出去的分身）。
 *
 * 「在跑」不在这份颜色里——那是状态，由右边那颗呼吸点说（见下面的运行点）。
 */
const AGENT_TAB_COLOR: Record<AgentTabRef['kind'], string> = {
  free: '#98928a',
  goal: '#4a8fd4',
  sub: '#a066d6',
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
  onNewConversation,
}: Props) {
  const stripRef = useRef<HTMLDivElement | null>(null)
  /**
   * 进出场（与文档区同一套，见 lib/tabPresence）：关掉的那枚要按住一会儿才放走，
   * 否则 React 一卸载节点，退场动画就没机会跑。栏上画的是这一份（含正在退场的），
   * 菜单与拖动仍旧只认活的 `tabs`。
   */
  const presence = useTabPresence(tabs, agentTabKey, TAB_EXIT_MS)
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
    // presence 也在依赖里：新开的那一枚比 props 晚一帧才进栏（见 lib/tabPresence 的手法）
  }, [activeId, presence])

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
      /*
       * 正在退场的那一枚不写回：算落位时要带上它（它还占着一个位置），
       * 写回时得摘掉——它下一帧就没了，不该被记进 state.json。
       */
      const alive = new Set(tabs.map(agentTabKey))
      onReorder(keys.filter((k) => alive.has(k)))
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
      // 与文档区同一条口径：落位在「栏上此刻画着的」这一份里算（含正在退场的那一枚）
      keys: presence.map((p) => p.key),
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

  /**
   * 栏上重名页签自动标序号：
   * 仅在当前可见的页签中存在重名时按从左到右的顺序追加 1, 2, ...
   * 单一页签保持原样。
   */
  const displayTitles = useMemo(() => {
    return disambiguateTabTitles(presence, (p) => p.key, (p) => titleOf(p.item))
  }, [presence, titleOf])

  /* ---------- 右键菜单 ---------- */

  const [menu, setMenu] = useState<{ x: number; y: number; key: string } | null>(null)
  const menuTab = menu ? tabs.find((tb) => agentTabKey(tb) === menu.key) : undefined
  const menuLabel = menuTab && menu ? (displayTitles.get(menu.key) ?? titleOf(menuTab)) : ''
  const isMenuLastGoalTab =
    menuTab?.kind === 'goal' &&
    tabs.filter((t) => t.kind === 'goal' && t.goalId === menuTab.goalId).length <= 1

  return (
    <>
      {/*
        与文档区页签栏同一套骨架：栏与正文之间一道下边框（绝对定位的一条线），
        选中的页签（z-10）用自己背景盖住脚下那一像素——页签是从正文里长出来的，
        不是浮在一条线上。底部两角再补反向圆角（moji-agent-tab-on，见 workspace.css）。
      */}
      <div
        className={
          'no-print relative flex shrink-0 items-stretch gap-2 pt-1.5 pb-0 ' +
          // 用 presence（含正在退场的那一枚）：关掉最后一枚时底色要跟着一起走
          (presence.length ? 'bg-paper-deep/40 ' : '') +
          (snap ? 'moji-tab-snap' : '')
        }
      >
        <div
          ref={stripRef}
          role="tablist"
          // 横向内边距住在滚动容器里（不在外栏上）：激活页签的反向圆角要伸出页签两侧，
          // 贴边那枚的方块必须落在滚动口之内（见 workspace.css 的 moji-tab-flare 说明）
          className="moji-tab-strip flex min-w-0 flex-1 items-end gap-[3px] overflow-x-auto px-2"
        >
          {presence.map(({ item: ref, leaving, exiting, entering }, i) => {
            const key = agentTabKey(ref)
            const on = key === activeId
            const running = runningOf(ref)
            /** 固定聊天页签：栏上常驻、最左，不能关闭也不能拖拽——交互面比普通页签小一圈 */
            const isFree = ref.kind === 'free'
            const isLastGoalTab =
              ref.kind === 'goal' &&
              tabs.filter((t) => t.kind === 'goal' && t.goalId === ref.goalId).length <= 1
            const block = agentTabCloseBlock(ref, { hasDocTabs: docTabsOf(ref), running })
            const closable = !isFree && block === 'none'
            // 守卫文案只对「想关却关不掉」的页签有意义；固定页签根本没有关闭键
            const blockHint = blockHintOf(block)
            const title = displayTitles.get(key) ?? titleOf(ref)
            const dragging = drag?.key === key
            const offset = dragging ? drag.dx : shiftOf(i)
            return (
              <div
                key={key}
                data-tab={key}
                role="tab"
                aria-selected={on}
                /*
                 * 正在退场的这一枚已经不算栏上的一员了：读屏与键盘都绕开它。
                 * 与文档区页签栏同一条规矩：挂 inert，不挂 aria-hidden——点关闭键那一下
                 * 焦点正停在这枚页签里，给「留住焦点的元素之祖先」挂 aria-hidden 会被
                 * 浏览器拦下（控制台报 Blocked aria-hidden…）；inert 才能把焦点一并收走。
                 */
                {...(leaving ? { inert: true } : { tabIndex: 0 })}
                title={title + (blockHint ? ' · ' + blockHint : '')}
                onClick={() => {
                  if (justDragged.current) return
                  onActivate(key)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onActivate(key)
                }}
                onPointerDown={(e) => {
                  if (!isFree) onTabDown(e, key, i)
                }}
                onPointerMove={(e) => onTabMove(e, key)}
                onPointerUp={() => endDrag(true)}
                onPointerCancel={() => endDrag(false)}
                onContextMenu={(e) => {
                  if (isFree) return
                  // 右键先在菜单里选中这一项：对着 A 右键却关掉 B，是最难解释的一类交互
                  e.preventDefault()
                  setMenu({ x: e.clientX, y: e.clientY, key })
                }}
                style={{ transform: offset ? 'translateX(' + offset + 'px)' : undefined }}
                className={
                  'moji-tab group relative flex h-7 min-w-[60px] max-w-[170px] shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-[12px] ' +
                  (on ? 'moji-tab-flare z-10 font-medium ' : '') +
                  (dragging
                    ? 'z-10 cursor-grabbing border-line-strong bg-card text-ink-strong shadow-md '
                    : 'transition-transform duration-150 ') +
                  (on
                    ? 'border-line-strong bg-card text-ink-strong'
                    : 'border-transparent text-ink-soft hover:bg-line/50 hover:text-ink') +
                  // 进出场：与文档区共用同一套 class（见 workspace.css 与 lib/tabPresence）
                  (entering ? ' moji-tab-in' : '') +
                  (exiting ? ' moji-tab-out' : '')
                }
              >
                {/*
                  类型标识：聊天页签保留 MessageSquare 图标，任务模式页签用 chip 样式的 task 替换图标
                */}
                {isFree ? (
                  <span
                    aria-hidden="true"
                    className="flex h-4 w-4 shrink-0 items-center justify-center"
                    style={{ color: AGENT_TAB_COLOR.free }}
                  >
                    <MessageSquare size={13} />
                  </span>
                ) : (
                  <span
                    aria-hidden="true"
                    className={
                      'shrink-0 rounded px-1.5 py-[1.5px] text-[9.5px] font-semibold leading-none tracking-tight select-none ' +
                      (ref.kind === 'sub'
                        ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300'
                        : 'bg-sky-500/15 text-sky-700 dark:text-sky-300')
                    }
                  >
                    task
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{title}</span>
                {running && (
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-seal" />
                )}
                {/*
                  关闭键固定在右端，鼠标扫过这一条页签时才亮出来（与文档区同一条规矩：
                  常驻的 × 是一排噪声）。被守卫拦着时它点不动，悬停提示说清为什么。
                  固定聊天页签没有关闭键：它就是这一栏的底座。
                */}
                {!isFree && (
                  <button
                    type="button"
                    disabled={!closable}
                    title={closable ? (isLastGoalTab ? t('关闭整个页签组') : t(TAB_CLOSE_LABEL.self)) : blockHint}
                    aria-label={isLastGoalTab ? t('关闭整个页签组') : t(TAB_CLOSE_LABEL.self)}
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
                )}
              </div>
            )
          })}
          {onNewConversation && (
            <button
              type="button"
              title={t('新建对话')}
              aria-label={t('新建对话')}
              onClick={onNewConversation}
              className="mb-0.5 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-t-md text-ink-faint transition hover:bg-line/50 hover:text-ink"
            >
              <Plus size={14} />
            </button>
          )}
        </div>

        {/*
          栏与正文之间的下边框：绝对定位的一条线（粗细与页签描边一致），
          选中的页签用 z-10 的背景把它盖掉——线在两侧继续、到这里「断开」。
        */}
        {!!presence.length && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-line-strong" />
        )}
      </div>

      {menu && menuTab && typeof document !== 'undefined' &&
        createPortal(
          <AgentTabMenu
            menu={menu}
            label={menuLabel}
            isLastGoalTab={isMenuLastGoalTab}
            count={tabs.filter((t) => t.kind !== 'free').length}
            otherCount={Math.max(0, tabs.filter((t) => t.kind !== 'free').length - 1)}
            onPick={(mode) => {
              onCloseMode(menu.key, mode)
              setMenu(null)
            }}
            onClose={() => setMenu(null)}
          />,
          document.body,
        )}
    </>
  )
}

/**
 * 页签的右键菜单：关闭 / 关闭（强制） / 关闭其他 / 关闭其他（强制） / 全部关闭。
 */
function AgentTabMenu({
  menu,
  label,
  isLastGoalTab,
  count,
  otherCount,
  onPick,
  onClose,
}: {
  menu: { x: number; y: number }
  label: string
  isLastGoalTab?: boolean
  count: number
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
      className="moji-in-soft fixed z-[90] min-w-[200px] max-w-[240px] rounded-lg border border-line-strong bg-card p-1 shadow-[0_12px_36px_rgba(31,27,23,0.24)]"
    >
      {/* 抬头：这一下是对着哪一位导师 */}
      <div className="truncate px-2.5 py-1 text-[10.5px] text-ink-faint" title={label}>
        {label}
      </div>

      <span aria-hidden="true" className="my-1 block h-px bg-line" />

      {/* 关闭当前导师 */}
      <button type="button" role="menuitem" onClick={() => onPick('self')} className={ROW}>
        <span className={ICON}>
          <X size={13} className="text-ink-soft" />
        </span>
        {isLastGoalTab ? t('关闭页签组') : t(TAB_CLOSE_LABEL.self)}
      </button>

      {/* 关闭（强制）：连同文档区关联的tab一起关闭 */}
      <button
        type="button"
        role="menuitem"
        title={t('连同文档区关联的页签一起关闭')}
        onClick={() => onPick('force')}
        className={ROW}
      >
        <span className={ICON}>
          <ShieldAlert size={13} className="text-seal" />
        </span>
        {t(TAB_CLOSE_LABEL.force)}
      </button>

      {/* 关闭其他 / 关闭其他（强制）：仅在存在其他可关闭页签时显示 */}
      {otherCount > 0 && (
        <>
          <span aria-hidden="true" className="my-1 block h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            onClick={() => onPick('others')}
            className={ROW}
          >
            <span className={ICON}>
              <FoldHorizontal size={13} className="text-ink-soft" />
            </span>
            {t(TAB_CLOSE_LABEL.others)}
            <span className={COUNT}>{otherCount}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            title={t('连同文档区关联的页签一起关闭')}
            onClick={() => onPick('forceOthers')}
            className={ROW}
          >
            <span className={ICON}>
              <FoldHorizontal size={13} className="text-seal" />
            </span>
            {t(TAB_CLOSE_LABEL.forceOthers)}
            <span className={COUNT}>{otherCount}</span>
          </button>
        </>
      )}

      {/* 全部关闭：仅在可关闭页签数大于1时显示（仅剩1个时与关闭无差别） */}
      {count > 1 && (
        <>
          <span aria-hidden="true" className="my-1 block h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            title={t('关闭所有导师页签')}
            onClick={() => onPick('all')}
            className={ROW + ' text-seal-deep hover:bg-seal/10'}
          >
            <span className={ICON}>
              <OctagonX size={13} />
            </span>
            {t(TAB_CLOSE_LABEL.all)}
            <span className={COUNT}>{count}</span>
          </button>
        </>
      )}
    </div>
  )
}

const ROW =
  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink transition hover:bg-line/60 disabled:cursor-not-allowed disabled:opacity-40'
const ICON = 'flex h-4 w-4 shrink-0 items-center justify-center'
const COUNT = 'ml-auto shrink-0 text-[10.5px] tabular-nums text-ink-faint'
