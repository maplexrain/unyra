/**
 * 这个文件负责什么：文档区的「视图状态」——正文大纲与当前读到哪一节、
 * Ctrl + 滚轮的正文字号缩放，以及滚动位置的恢复与上报（useDocScroll 的调用点）。
 *
 * 三只钩子按职责分开，正文渲染在 DocBody 里、与它们无关：useDocOutline（大纲 + 跳转）、
 * useDocZoom（字号）、useDocScrollMemory（读到哪儿了）。判定口径 activeHeadingAt 单独
 * 放在文件头——滚动高亮与缩放锚点共用它，两处才不会各说各话（原本就在 NodeNote 里）。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import {
  SCALE_HUD_MS,
  SCALE_ZOOM_STEP,
  clampDocScale,
  getAppearance,
  setAppearance,
} from '../../../lib/appearance'
import { useDocScroll } from '../../../lib/docScroll'
import { flashHeading } from '../../../lib/headingFlash'
import {
  collectOutline,
  headingAt,
  headingJumpTarget,
  headingsOf,
  sameOutline,
  type OutlineNode,
} from '../../../lib/outline'
import { smoothScrollTo } from '../../../lib/smoothScroll'
import type { DocKind } from '../../../learn/types'

/** 点目录跳转时，标题落在容器顶部往下这么多像素处：别贴着上沿，也别离太远 */
const JUMP_GAP = 16
/** 判定「已经滚到这一节」时，允许标题越过容器顶部这么多像素 */
const ACTIVE_SLACK = 84
/* 字号缩放的手感（一格多少、提示亮多久）与对话区共用一份，见 lib/appearance */

/**
 * 正文里当前读到第几个标题：最后一个越过容器顶部的。
 * 滚动高亮与缩放锚点共用这一个口径，两处才不会各说各话。
 */
function activeHeadingAt(
  root: HTMLElement | null,
  box: HTMLElement,
): { index: number; el: HTMLElement } | null {
  const heads = headingsOf(root)
  const top = box.getBoundingClientRect().top
  let found: { index: number; el: HTMLElement } | null = null
  for (let i = 0; i < heads.length; i++) {
    // 要越过顶部一段才算「到了这一节」：刚好压线时人眼还在读上一节
    if (heads[i].getBoundingClientRect().top - top > ACTIVE_SLACK) break
    found = { index: i, el: heads[i] }
  }
  return found
}

/** 文档区的三只锚点元素：正文相对它们量尺寸、滚动与定位，由上层原样传进来 */
interface DocRefs {
  rootRef: RefObject<HTMLDivElement | null>
  scrollRef: RefObject<HTMLDivElement | null>
  bodyRef: RefObject<HTMLDivElement | null>
}

/** 抽大纲与跳转要看的：正文 HTML */
interface OutlineOpts extends DocRefs {
  html: string
}

/**
 * 正文大纲 + 当前读到哪一节。
 *
 * 返回的 outline / activeIndex / jumpTo 由渲染组件装进 OutlineHandle 交给上层
 * （悬浮大纲的入口在 DocFloat，见 components/learn/DocOutline 的说明）。
 */
export function useDocOutline({ bodyRef, scrollRef, html }: Omit<OutlineOpts, 'rootRef'>) {
  /** 正在跑的跳转动画的「立刻停下」；新一轮跳转、卸载时都要先停掉旧的 */
  const cancelScroll = useRef<(() => void) | null>(null)
  /** 正文大纲；正文里没有标题时为空 */
  const [outline, setOutline] = useState<OutlineNode[]>([])
  /** 当前读到第几个标题（-1 = 还没到第一个） */
  const [activeIndex, setActiveIndex] = useState(-1)

  /**
   * 正文落地后再抽大纲。放在 layout effect 里是因为子组件的 layout effect
   * 先于父组件执行——MarkdownView 正是在那时把 html 写进容器的，
   * 走到这里 DOM 已是最终内容；晚一帧才抽的话，大纲会先空一下再冒出来。
   */
  useLayoutEffect(() => {
    const next = collectOutline(bodyRef.current)
    // AI 逐字写作时正文每变一次都会走到这里，标题没变就别换数组引用，
    // 免得下面的滚动监听跟着反复重挂
    setOutline((prev) => (sameOutline(prev, next) ? prev : next))
  }, [html, bodyRef])

  /** 正文滚动时标出当前读到哪一节：取最后一个越过容器顶部的标题 */
  useEffect(() => {
    const box = scrollRef.current
    if (!box || !outline.length) return
    let raf = 0
    const measure = () => {
      raf = 0
      setActiveIndex(activeHeadingAt(bodyRef.current, box)?.index ?? -1)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }
    box.addEventListener('scroll', onScroll, { passive: true })
    measure()
    return () => {
      box.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [outline, bodyRef, scrollRef])

  // 卸载（切节点会重挂本组件）时停掉还在跑的滚动动画
  useEffect(
    () => () => {
      cancelScroll.current?.()
    },
    [],
  )

  /** 点目录里的标题：缓动滚到那一节，到位后把标题高亮一下 */
  const jumpTo = (index: number) => {
    const box = scrollRef.current
    if (!box) return
    cancelScroll.current?.()
    cancelScroll.current = smoothScrollTo(
      box,
      () => {
        const head = headingAt(bodyRef.current, index)
        // 标题暂时取不到（正文正在被整体重写）就停在原地，别把读者甩到别处
        if (!head) return box.scrollTop
        return headingJumpTarget(box, head, JUMP_GAP)
      },
      // 停在半路时（用户自己接手滚动）不闪：闪了反而像在催人
      () => flashHeading(headingAt(bodyRef.current, index)),
    )
  }

  return { outline, activeIndex, jumpTo }
}

/** 正文字号缩放：返回当前系数与右下角那条比例提示的状态（说明见下面那个 effect） */
export function useDocZoom({ rootRef, bodyRef, scrollRef }: DocRefs) {
  /** 正文文字大小系数：Ctrl + 滚轮调，存在外观设置里，换节点、重开都还在 */
  const [docScale, setDocScale] = useState(() => getAppearance().docScale)
  /** 右下角的比例提示：显示一会儿再淡出 */
  const [zoomPct, setZoomPct] = useState(100)
  const [zoomHud, setZoomHud] = useState(false)
  const zoomTimer = useRef<number | null>(null)
  /** 缩放前记下当前这一节离容器顶部的距离，缩放后把它贴回原处 */
  const zoomAnchor = useRef<{ index: number; offset: number } | null>(null)

  /**
   * Ctrl + 滚轮调正文字号。
   *
   * 只认 Ctrl / Cmd（触控板双指缩放走的也是带 ctrlKey 的 wheel 事件）；
   * 不按修饰键就原样让给滚动，别抢。preventDefault 顺便挡掉浏览器自带的缩放。
   */
  useEffect(() => {
    // 监听挂在整个文档显示区（含左侧目录栏）而不是只挂正文容器：
    // 同一片区域里 Ctrl + 滚轮的行为要一致，不能左边缩放、右边做别的
    const area = rootRef.current
    const box = scrollRef.current
    if (!area || !box) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      // 把各种来源的 delta 折算成「格」：像素模式一格约 100，行模式一格约 3 行；
      // 触控板双指缩放的 delta 小而密，按比例折算手感才和滚轮一致
      const unit = e.deltaMode === 1 ? 3 : 100
      const notches = Math.max(-3, Math.min(3, -e.deltaY / unit))
      if (!notches) return
      const prev = getAppearance().docScale
      const next = clampDocScale(prev * SCALE_ZOOM_STEP ** notches)
      // 先记下当前这一节在视口里的位置：字号一变正文就重排，
      // 不记的话读着读着就会往上漂走（见下面的 layout effect）
      const at = activeHeadingAt(bodyRef.current, box)
      zoomAnchor.current = at
        ? { index: at.index, offset: at.el.getBoundingClientRect().top - box.getBoundingClientRect().top }
        : null
      if (next !== prev) {
        setAppearance({ ...getAppearance(), docScale: next })
        setDocScale(next)
      }
      // 到顶/到底时数值不再变，但比例提示照给——否则会以为滚轮没生效
      setZoomPct(Math.round(next * 100))
      setZoomHud(true)
      if (zoomTimer.current !== null) window.clearTimeout(zoomTimer.current)
      zoomTimer.current = window.setTimeout(() => {
        zoomTimer.current = null
        setZoomHud(false)
      }, SCALE_HUD_MS)
    }
    area.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      area.removeEventListener('wheel', onWheel)
      if (zoomTimer.current !== null) window.clearTimeout(zoomTimer.current)
    }
  }, [rootRef, bodyRef, scrollRef])

  /**
   * 字号变了：把刚才记下的那一节贴回原来的位置。
   * 放在 layout effect 里（DOM 已按新字号重排、但还没上屏），所以看不见跳动。
   */
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current
    zoomAnchor.current = null
    const box = scrollRef.current
    if (!anchor || !box) return
    const head = headingAt(bodyRef.current, anchor.index)
    if (!head) return
    box.scrollTop += head.getBoundingClientRect().top - box.getBoundingClientRect().top - anchor.offset
  }, [docScale, bodyRef, scrollRef])

  return { docScale, zoomPct, zoomHud }
}

/**
 * 读到哪儿了：切文档回到顶部，滚动时报给上层（节流在上层那层钩子里）。
 *
 * 常驻的正文在 display:none 时设不住 scrollTop，所以恢复的时机是「第一次显示出来」
 * （useDocScroll 内部那套，见 lib/docScroll）。
 */
export function useDocScrollMemory({
  scrollRef,
  scrollTop,
  onScrollTop,
  active,
  nodeId,
  docKind,
  docNote,
}: {
  scrollRef: RefObject<HTMLDivElement | null>
  /** 上一次读到哪儿（px）与滚动到哪儿了的上报：见 lib/docScroll */
  scrollTop?: number
  onScrollTop?: (top: number) => void
  active: boolean
  /** 文档身份三件套（node.id / doc.kind / doc.note）：换一样就回到顶部 */
  nodeId: string
  docKind: DocKind
  docNote?: string
}) {
  // 新挂载时回到顶部。切节点、切文档都会换掉本组件的 key（见 LearnWorkspace），
  // 所以这里实际只在挂载时跑一次；保留它，是为了不依赖上层那个 key 也仍然从头读起。
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    // 换笔记也要回到顶部：同一个节点的两份笔记是两份不同的内容
  }, [nodeId, docKind, docNote, scrollRef])

  /*
   * 读到哪儿了：滚一下报一次（节流在上层那层钩子里），下一次打开回到这一段。
   * 常驻的正文在 display:none 时设不住 scrollTop，所以恢复的时机是「第一次显示出来」。
   */
  /**
   * 取滚动容器的那只回调必须是**稳定**的：useDocScroll 拿它当 effect 依赖，
   * 每轮渲染现写的箭头会让滚动监听被反复拆掉重挂（而拆的时候还要补发一次位置上报，
   * 等于每次重渲染都往 store 里写一次滚动位置）。容器本身是常驻的（见上面的 scrollRef），
   * 所以它可以一直取同一个。
   */
  const scrollBox = useCallback(() => scrollRef.current, [scrollRef])
  useDocScroll(scrollBox, scrollTop, onScrollTop, active)
}
