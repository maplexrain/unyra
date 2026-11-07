/*
 * 这个文件负责：栏内**拖拽排序**的整段会话（跨格移动与分割不在这里——那是上层 onDrop 的事）。
 *
 * 纪律与手法：
 * - 按下只记位置，位移够 DRAG_MIN 才算「在拖」——十次里有九次是在点，不是拖；
 * - 拖动期间的让位预览与影子都**不写 React 以外的 state**：让位用 transform 补间，
 *   拖出栏的影子是一份克隆直接挂在 body 上（每帧写 style，走 state 会把整棵学习区带上）；
 * - 松手才算落位：先问对话输入框（docChipDrop），再问上层接不接手（onDrop），
 *   都不接才做栏内重排，并给「落下那一帧」掐补间（snap）+ 留一帧原位（settle）。
 */

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { TabPresence } from '../../../lib/tabPresence'
import type { LearnTab, TabRef } from '../../../learn/types'
import { dragSlotDelta } from '../../../learn/tabs'
import { docChipDrop, docChipHover, type ChipPayload } from '../../../lib/docChip'
import { DRAG_MIN, LIFT_PAD, TAB_GAP, type DragState, type TabRect } from './barGeometry'

interface UseTabBarDndDeps {
  tabs: LearnTab[]
  /** 栏上此刻画着的三份列表（含退场中的）：落位要在这份里算（见 endDrag） */
  presence: TabPresence<LearnTab>[]
  pinnedPresence: TabPresence<LearnTab>[]
  normalPresence: TabPresence<LearnTab>[]
  /** 栏的根元素与两条页签区：量矩形用（出栏判定 / 起手量页签矩形） */
  rootRef: RefObject<HTMLDivElement | null>
  stripRef: RefObject<HTMLDivElement | null>
  pinnedStripRef: RefObject<HTMLDivElement | null>
  /** 拖动中的位置（每次指针移动一次）。上层据此判断「落点在哪一格的哪一条边上」 */
  onDragMove: (tabId: string, x: number, y: number) => void
  /** 松手。返回 true = 上层接手了（拖到别格 / 拖到某格边上分割），本栏不做栏内重排 */
  onDrop: (tabId: string, ids: string[], x: number, y: number, commit: boolean) => boolean
  /** 拖动结束后给出的新顺序（页签 id 列表，只在栏内排序时用得上） */
  onReorder: (ids: string[]) => void
  /** 页签拖进对话输入框时交给它的那份信息；不给这条，页签就拖不进输入框 */
  docPayloadOf?: (ref: TabRef) => ChipPayload | null
}

export function useTabBarDnd({
  tabs,
  presence,
  pinnedPresence,
  normalPresence,
  rootRef,
  stripRef,
  pinnedStripRef,
  onDragMove,
  onDrop,
  onReorder,
  docPayloadOf,
}: UseTabBarDndDeps) {
  const [drag, setDrag] = useState<DragState | null>(null)
  /**
   * 落下那一帧：被拖的那一项先留在手指底下，下一帧再滑进它的位置。
   *
   * offset 是「它此刻在哪儿」相对**重排之后**的落点还差多少（见 endDrag）。
   * 少了这一帧，松手的一瞬间它会横着抽出去再滑回来——位移是整段拖动距离，
   * 而落位又整格整格地挪，两个差着整整一格。
   */
  const [settle, setSettle] = useState<{ id: string; offset: number } | null>(null)
  /**
   * 落下那一帧不许补间。
   *
   * 其余页签在拖动期间的位移**正好等于**重排之后的位置：清掉位移，它们本来就在原地。
   * 可 CSS 过渡是按「过渡前算出来的 transform」补间的，若不掐掉，浏览器会以为
   * 它们该从「再退一格」的地方滑回来——整条栏在松手时抽一下，就是这么来的。
   */
  const [snap, setSnap] = useState(false)
  /** 上面那个「下一帧」的把手：卸载、或连着拖两次时要能取消 */
  const raf = useRef(0)
  const dragRef = useRef<{
    id: string
    isPinned: boolean
    from: number
    startX: number
    width: number
    /** 拖动开始时每个页签的位置与宽度（见 TabRect） */
    rects: TabRect[]
    moved: boolean
    /** 最近一次算出来的落点与位移。松开时以它为准，而不是再读一遍 React 状态 */
    to: number
    dx: number
    /** 抓取点相对页签的偏移：影子跟指针保持按下那一刻的相对位置 */
    grabX: number
    grabY: number
    lifted: boolean
  } | null>(null)
  /**
   * 刚刚拖完的这一下不算「点击」。
   *
   * pointerup 之后浏览器还会补一个 click，而那时拖动状态已经清掉了——不单独记一笔，
   * 松手就会把刚拖过去的那一项**激活**（拖一下顺带换了文档，没人想要这个副作用）。
   */
  const justDragged = useRef(false)

  /**
   * 页签被拖出栏之后跟着指针走的那枚影子：一份克隆直接挂在 body 上（每帧写 style）。
   * 走 state 会把整棵学习区带上重渲染（棱形同一条纪律）。松手/回栏/卸载都要摘掉。
   */
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const removeGhost = () => {
    ghostRef.current?.remove()
    ghostRef.current = null
  }

  /* 卸载时把没跑完的「下一帧」撤掉（它里面是 setState）；拖到一半的影子与输入框高亮一并收掉 */
  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current)
    ghostRef.current?.remove()
    ghostRef.current = null
    docChipHover(-1, -1)
  }, [])

  /* ---------- 拖动排序 ---------- */

  /**
   * 按下：只记位置，不动顺序。
   *
   * 一按下就把自己挪走是不行的——用户十次里有九次是在**点**页签而不是拖它，
   * 只有位移超过 DRAG_MIN 才真的进入拖动状态（见 onPointerMove）。
   * 指针捕获挂在页签自己身上：手指/鼠标划到栏外面（甚至划过视图开关）时，
   * 事件仍然回到这一条上，拖动不会因为划出去而断掉。
   */
  const onTabDown = (e: React.PointerEvent<HTMLDivElement>, id: string, from: number, isPinned: boolean) => {
    if (e.button !== 0) return
    const el = e.currentTarget
    const container = isPinned ? pinnedStripRef.current : stripRef.current
    const rects: TabRect[] = [...(container?.querySelectorAll<HTMLElement>('[data-tab]') ?? [])].map((node) => {
      const r = node.getBoundingClientRect()
      return { id: node.dataset.tab ?? '', left: r.left, width: r.width }
    })
    justDragged.current = false
    dragRef.current = {
      id,
      isPinned,
      from,
      startX: e.clientX,
      width: el.getBoundingClientRect().width,
      rects,
      moved: false,
      to: from,
      dx: 0,
      grabX: 0,
      grabY: 0,
      lifted: false,
    }
    el.setPointerCapture(e.pointerId)
  }

  const onTabMove = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    const d = dragRef.current
    if (!d || d.id !== id) return
    const dx = e.clientX - d.startX
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_MIN) return
      d.moved = true
      // 抓取点相对页签的偏移量一次：影子此后与指针保持这个相对位置（跟棱形同一条纪律）
      const r = e.currentTarget.getBoundingClientRect()
      d.grabX = e.clientX - r.left
      d.grabY = e.clientY - r.top
    }
    /*
     * 在栏内还是在栏外：栏内沿用原来的跟手位移与让位预览；出了栏页签就**真的被拖了出来**
     * ——一枚一模一样的影子跟着指针满窗口走，栏里那枚退成淡淡的占位。
     * 出栏的判定留 LIFT_PAD 的余量防抖，回栏的判定不留（回得更紧）：在边界上抖动不会来回闪。
     */
    const root = rootRef.current
    const inBar = (() => {
      if (!root) return false
      const r = root.getBoundingClientRect()
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    })()
    const lifted = d.lifted
      ? !inBar
      : (() => {
          if (inBar || !root) return false
          const r = root.getBoundingClientRect()
          return (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top - LIFT_PAD ||
            e.clientY > r.bottom + LIFT_PAD
          )
        })()
    if (lifted) {
      if (!d.lifted) {
        d.lifted = true
        // 影子 = 这一枚页签的克隆：样式宽窄一模一样，只把拖动位移清掉
        const g = document.createElement('div')
        const clone = e.currentTarget.cloneNode(true) as HTMLElement
        clone.style.transform = ''
        g.appendChild(clone)
        g.style.cssText =
          'position:fixed;z-index:90;pointer-events:none;width:' + d.width + 'px;' +
          'border-radius:6px;overflow:hidden;opacity:.96;transform:rotate(-.5deg);' +
          'box-shadow:0 14px 32px rgba(31,27,23,.30);'
        document.body.appendChild(g)
        ghostRef.current = g
        // 光标不必另设：指针捕获在页签上，页签拖动态自带的 cursor-grabbing 会跟着捕获走
      }
      const g = ghostRef.current
      if (g) {
        g.style.left = e.clientX - d.grabX + 'px'
        g.style.top = e.clientY - d.grabY + 'px'
      }
    } else if (d.lifted) {
      d.lifted = false
      removeGhost()
    }
    if (d.lifted) {
      // 影子模式下栏里风平浪静：被拖的那枚回槽（淡显），其余不让位。状态不变就不必重渲染
      d.to = d.from
      d.dx = 0
      setDrag((cur) =>
        cur && cur.id === d.id && cur.lifted
          ? cur
          : { id: d.id, isPinned: d.isPinned, from: d.from, to: d.from, dx: 0, width: d.width, lifted: true },
      )
    } else {
      // 落点 = 指针越过了其余页签里多少个的中点。被拖的那个自己不参与比较
      let to = 0
      for (const r of d.rects) {
        if (r.id === d.id) continue
        if (e.clientX > r.left + r.width / 2) to++
      }
      d.to = to
      d.dx = dx
      setDrag({ id: d.id, isPinned: d.isPinned, from: d.from, to, dx, width: d.width, lifted: false })
    }
    // 报给上层：它据此判断「指针现在落在哪一格的哪一条边上」（见 onDrop 与 LearnWorkspace）
    onDragMove(d.id, e.clientX, e.clientY)
    // 输入卡片的高亮跟着指针走：压在上面就亮起来，告诉用户「松手就放这里」
    docChipHover(e.clientX, e.clientY)
  }

  const endDrag = (commit: boolean, x = 0, y = 0) => {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    removeGhost()
    docChipHover(-1, -1)
    if (!d?.moved) return
    justDragged.current = true
    /*
     * 落位要在**栏上此刻画着的**那一份里算：拖动时量到的下标（from / to）就是这一份的下标，
     * 正在退场的那一枚还占着位置，算进去才不会错开一格。
     * 写回之前再把退场中的摘掉——它们下一帧就没了，不该被记进 state.json。
     */
    const pinnedShown = pinnedPresence.map((p) => p.key)
    const normalShown = normalPresence.map((p) => p.key)
    const alive = new Set(presence.filter((p) => !p.leaving).map((p) => p.key))
    let orderPinned = pinnedShown
    let orderNormal = normalShown
    if (commit && !d.lifted && d.to !== d.from) {
      if (d.isPinned) {
        const next = [...pinnedShown]
        const [moved] = next.splice(d.from, 1)
        next.splice(d.to, 0, moved)
        orderPinned = next
      } else {
        const next = [...normalShown]
        const [moved] = next.splice(d.from, 1)
        next.splice(d.to, 0, moved)
        orderNormal = next
      }
    }
    const ids = [...orderPinned, ...orderNormal].filter((id) => alive.has(id))
    /*
     * 先问对话输入框：页签落在输入卡片上 = 把这份文档交给导师（变成一枚引用）。
     * 接住了就到此为止——这不是排序也不是分屏，本栏什么都不用做。
     */
    if (commit && docPayloadOf) {
      const ref = tabs.find((tab) => tab.id === d.id)?.ref
      const payload = ref ? docPayloadOf(ref) : null
      if (payload && docChipDrop(x, y, payload)) return
    }
    /*
     * 先问上层接不接手：拖到**别格**（或别格的边上）是「移动 / 分割」，
     * 与栏内排序是两件事，而只有上层知道别的格在哪。接手了就直接返回——
     * 这一项已经从本栏消失了，再播一次归位动画只会让它闪一下。
     */
    if (onDrop(d.id, ids, x, y, commit)) return
    if (!commit || d.to === d.from) return
    /*
     * 落下这一帧是整段拖动里最容易出错的一帧。两件事必须**同时**发生：
     * 1. 页签按新顺序重排——DOM 顺序变了，每个页签的落位也跟着挪；
     * 2. 拖动期间的位移清掉——清掉之后它们恰好落在该在的地方。
     *
     * 麻烦在于过渡是拿「过渡前的 transform」补间的：重排让页签的**落位**挪了一格，
     * 而 transform 又在同一帧里从 ±一格变成 0，浏览器于是认定「它得从两格前滑回来」。
     * 于是：
     * - 让过位的那些页签：这一帧的过渡先掐掉（见 snap）。它们本来就在原地，补了反而跳；
     * - 被拖的那一项：把「手指底下的位置」原样保留一帧（见 settle），下一帧才放开过渡，
     *   让它从那儿滑进自己的位置——这一段的距离才是它真正剩下的那点路。
     */
    setSettle({ id: d.id, offset: d.dx - dragSlotDelta(d.rects.map((r) => r.width), d.from, d.to, TAB_GAP) })
    setSnap(true)
    if (raf.current) cancelAnimationFrame(raf.current)
    // 两帧：第一帧把这次重排画上去，第二帧（已经画完）才放开过渡
    raf.current = requestAnimationFrame(() => {
      raf.current = requestAnimationFrame(() => {
        raf.current = 0
        setSnap(false)
        setSettle(null)
      })
    })
    onReorder(ids)
  }

  return { drag, settle, snap, justDragged, onTabDown, onTabMove, endDrag }
}
