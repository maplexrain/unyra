/*
 * 这个文件负责：文档区与 AI 对话栏「两列布局」的全部机制——
 * 拖分割线改宽度、收起 / 展开右侧栏（带 300ms 补间）、双击对调两栏。
 *
 * 它与界面的分工：这里管**状态与几何**（宽度、收起、拖动中的逐帧作画），
 * 骨架 JSX 在 SplitRow 里——两边靠一个对象（SideColumnsApi）连接，
 * 消费方解构出来的名字与拆分前完全一致，行为也一致。
 *
 * 性能上的三件大事都写在对应函数的注释里（paintDrag / onAgentResizeUp / setSide），
 * 动它们之前先读一遍：拖动每帧只碰六个元素的非继承内联样式；CSS 变量只在松手时
 * 按最终值写一次；收起补间那 300ms 冻主位宽度。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import {
  AGENT_WIDTH_DEFAULT,
  clampAgentWidth,
  getAppearance,
  setAppearance,
} from '../../../lib/appearance'
import { holdLayout, releaseLayout } from '../../../lib/layoutHold'
import { RESIZE_HINT_GAP, SIDE_ANIM_MS, SIDE_TOGGLE_INSET } from './constants'

/**
 * 学习区两列的全部状态与动作。SplitRow 与宿主组件都从这里拿：
 * 手写一份接口必然有一天两边不同步，让编译器替我们对账。
 */
export type SideColumnsApi = ReturnType<typeof useSideColumns>

/**
 * 学习区两列的机制。
 *
 * 拖动期间只改 state，不落盘——一次拖拽会经过几百个像素，每个都写一次设置文件
 * 既没必要也伤盘；松手时写最终值。夹取范围在 clampAgentWidth 里，
 * 界面与存储两边用的是同一个函数，不会出现「拖到 380 却存了 400」这种不一致。
 */
export function useSideColumns() {
  /**
   * 两栏谁占主位：对话在左（主位）还是文档在左。双击分割线对调（见 swapSides）。
   * 与 agentWidth 是同一种状态：本地一份（即时反馈） + 设置里一份（下次打开还这样）。
   */
  const [agentLeft, setAgentLeft] = useState(() => getAppearance().agentLeft)
  const [agentWidth, setAgentWidth] = useState(() => getAppearance().agentWidth || AGENT_WIDTH_DEFAULT)
  /** 正在拖：拖动期间禁掉文字选择与所有过渡，否则会框选到正文、面板还会跟手延迟 */
  const [resizingAgent, setResizingAgent] = useState(false)
  /** 两列那一行的总宽：左格自适应、没有自己的定值，它的读数只能由行宽减出右格来 */
  const [rowWidth, setRowWidth] = useState(0)
  const rowRef = useRef<HTMLDivElement | null>(null)
  /**
   * 拖动中的几个读数：**数字与位置都直接写 DOM**，不走 React。
   *
   * 这一整套（不 setState + 直接改内联样式）是「拖分割线跟不跟手」的关键：
   * 每一帧都 setState 的话，React 要把整棵学习区（正文、侧栏、顶栏）重渲染一遍，
   * 一帧十几毫秒就没了——手感上就是「拖不动、一顿一顿」。宽度读数只是两个数字，
   * 更没必要为它重渲染。
   */
  const hints = useRef<{
    left: HTMLDivElement | null
    leftNum: HTMLSpanElement | null
    right: HTMLDivElement | null
    rightNum: HTMLSpanElement | null
  }>({ left: null, leftNum: null, right: null, rightNum: null })
  const agentDrag = useRef<{
    startX: number
    startWidth: number
    moved: boolean
    rowWidth: number
    /** 右格（定宽那格）装的是不是文档：对调之后宽度的落点跟着换 */
    rightIsDoc: boolean
    /** 收起按钮 wrapper 的 right 原值：拖动期间被内联覆盖，松手要按它恢复 */
    btnRight: string
  } | null>(null)
  /** 右格外层（定宽那格）与它的内层：拖动中每帧直写内联宽度，见 paintDrag 里为什么不动 CSS 变量 */
  const docColRef = useRef<HTMLDivElement | null>(null)
  const agentColRef = useRef<HTMLDivElement | null>(null)
  const docInnerRef = useRef<HTMLDivElement | null>(null)
  const agentInnerRef = useRef<HTMLDivElement | null>(null)
  /** 分隔线把手与收起按钮：都骑在 var(--side-w) 上，拖动中同样直写内联 right */
  const handleRef = useRef<HTMLDivElement | null>(null)
  const sideBtnRef = useRef<HTMLDivElement | null>(null)
  /**
   * 两列行的几何，**按下那一刻量一次**：横向拖动期间它不变（顶上没有会动的东西）。
   * 有了这份缓存，拖动中的每次作画都只写不读——写在样式之后再反手去量（rect / clientWidth）
   * 会强制浏览器把排版同步做完，而指针事件一帧可能来好几个（鼠标回报率远高于刷新率），
   * 每个事件量一次就是「一顿一顿」的直接由来。
   */
  const dragRect = useRef<{ top: number; height: number } | null>(null)
  /** 待作画的宽度与指针 y：rAF 合帧用（一帧画一次，多余的指针事件只更新数字） */
  const pendingPaint = useRef<{ width: number; y: number } | null>(null)
  const paintRaf = useRef<number | null>(null)

  /**
   * 拖动读数的四个挂点：元素在 SplitRow 里渲染，ref 从那里交回来。
   * 不把 hints 这个 ref 本体交给外面——props 在 React 的纪律里不可变，
   * 对它的赋值必须发生在持有它的这一层（lint 的 immutability 规则说的就是这个）。
   */
  const setHintRef = {
    left: (el: HTMLDivElement | null) => {
      hints.current.left = el
    },
    leftNum: (el: HTMLSpanElement | null) => {
      hints.current.leftNum = el
    },
    right: (el: HTMLDivElement | null) => {
      hints.current.right = el
    },
    rightNum: (el: HTMLSpanElement | null) => {
      hints.current.rightNum = el
    },
  }

  /**
   * 拖动中的一次作画。**每帧只碰六个元素的内联样式，而且全是非继承属性**
   * （右格外层与内层的 width、分隔线与收起按钮的 right、两个读数的 left/right/top）——
   * 非继承属性变了，重新计算样式只落在这一个元素上；内容的重排则交给浏览器按
   * 最终宽度做（拖动期间内容实时跟着手，见 setSide 里「不冻宽」的取舍说明）。
   *
   * 为什么**不**写 --side-w：它是挂在两列那一行上的**继承**属性，每帧改它，
   * Chrome 得把整棵子树（几千个元素的正文、整列对话）全部重新计算样式——
   * 一帧 90ms、拖起来卡住的就是它。CSS 变量只在松手那一刻按最终值写一次
   * （见 onAgentResizeUp），整场拖动的全子树样式重算就只有那一次。
   */
  const paintDrag = (width: number, clientY: number): void => {
    const drag = agentDrag.current
    if (!drag) return
    const w = width + 'px'
    const outer = drag.rightIsDoc ? docColRef.current : agentColRef.current
    if (outer) outer.style.width = w
    // 内层跟着外层一起走（类名读的 var 拖动期间不动它，内联补上）：内容实时跟着手
    const inner = drag.rightIsDoc ? docInnerRef.current : agentInnerRef.current
    if (inner) inner.style.width = w
    if (handleRef.current) handleRef.current.style.right = w
    if (sideBtnRef.current) sideBtnRef.current.style.right = w
    const h = hints.current
    const r = dragRect.current
    const y = r ? Math.min(Math.max(clientY - r.top, 20), Math.max(20, r.height - 20)) : null
    if (h.left) {
      if (y !== null) h.left.style.top = y + 'px'
      h.left.style.right = width + RESIZE_HINT_GAP + 'px'
    }
    if (h.right) {
      if (y !== null) h.right.style.top = y + 'px'
      h.right.style.left = Math.max(0, drag.rowWidth - width + RESIZE_HINT_GAP) + 'px'
    }
    // 左格的宽度读数用按下时量好的行宽减出来；此刻读 clientWidth 会强制同步排版
    if (h.leftNum) h.leftNum.textContent = Math.max(0, drag.rowWidth - width) + ' px'
    if (h.rightNum) h.rightNum.textContent = width + ' px'
  }

  const onAgentResizeDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const row = rowRef.current
      // 先把要读的都读完（行宽、行的几何），再开始写样式——顺序反了就是强制同步排版
      const total = row?.clientWidth ?? 0
      const box = row?.getBoundingClientRect()
      dragRect.current = box ? { top: box.top, height: box.height } : null
      agentDrag.current = {
        startX: e.clientX,
        startWidth: agentWidth,
        moved: false,
        rowWidth: total,
        rightIsDoc: agentLeft,
        btnRight: getAppearance().sideCollapsed ? SIDE_TOGGLE_INSET + 'px' : 'var(--side-w)',
      }
      setRowWidth(total)
      // 读数先摆到位再亮出来：亮出来那一帧就带着正确的数字与纵向位置
      paintDrag(agentWidth, e.clientY)
      setResizingAgent(true)
      // 挂上「先别量」的门：拖动期间 ResizeObserver 们每帧都会被叫醒，让它们先跳过
      // （对话定位条那趟全页测量是其中最贵的，见 lib/layoutHold 与 useMsgRail）
      holdLayout()
    },
    [agentWidth, agentLeft],
  )

  const onAgentResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = agentDrag.current
    if (!drag) return
    // 面板在右边：指针往左走（clientX 变小）应当变宽，所以是「起点宽度 - 位移」
    const width = clampAgentWidth(drag.startWidth - (e.clientX - drag.startX))
    /*
     * 合帧作画：指针事件一帧可能来好几个，画一次就够——多余的只更新待画数字。
     * 作画本身只写不读（几何都来自按下时的缓存），一帧至多一次排版，全部留给浏览器。
     */
    pendingPaint.current = { width, y: e.clientY }
    if (paintRaf.current === null) {
      paintRaf.current = window.requestAnimationFrame(() => {
        paintRaf.current = null
        const p = pendingPaint.current
        pendingPaint.current = null
        if (p && agentDrag.current) paintDrag(p.width, p.y)
      })
    }
    // 挪过 2px 才算「真的在分配宽度」：双击对调时指针也会抖那么一下，
    // 那一下不该闪出读数。一旦走过就保持到松手，拖回原点也不闪断
    if (!drag.moved && Math.abs(e.clientX - drag.startX) >= 2) {
      drag.moved = true
      const h = hints.current
      for (const box of [h.left, h.right]) {
        if (box) box.style.visibility = 'visible'
      }
    }
  }, [])

  const onAgentResizeUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = agentDrag.current
      if (!drag) return
      // 撤掉拖动期间的内联覆盖：外层格与分隔线的真身是类名里的 var(--side-w)，
      // 收起按钮的 right 由 React 管——各自回到原路（见 drag.btnRight）
      const outer = drag.rightIsDoc ? docColRef.current : agentColRef.current
      if (outer) outer.style.width = ''
      const inner = drag.rightIsDoc ? docInnerRef.current : agentInnerRef.current
      if (inner) inner.style.width = ''
      if (handleRef.current) handleRef.current.style.right = ''
      if (sideBtnRef.current) sideBtnRef.current.style.right = drag.btnRight
      agentDrag.current = null
      dragRect.current = null
      pendingPaint.current = null
      if (paintRaf.current !== null) {
        window.cancelAnimationFrame(paintRaf.current)
        paintRaf.current = null
      }
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      setResizingAgent(false)
      // 放门：被拦下的测量在下一帧补跑——那时宽度已经排定。放在「没拖动就早退」之前：
      // 双击对调那一下同样走按下 / 抬起，门不能只挂不摘
      releaseLayout()
      // 没拖动就别写设置：双击那条线对调时也会走一遍按下 / 抬起，没必要为此写一次盘
      if (!drag.moved) return
      const settled = clampAgentWidth(drag.startWidth - (e.clientX - drag.startX))
      setAgentWidth(settled)
      /*
       * CSS 变量按最终值写**一次**。变量挂在两列那一行上、整个子树都继承它，
       * 写它意味着一次全子树的重新计算样式——拖动期间为了跟手一次都不写，
       * 松手这一次是收尾的必要代价，换来的是整场拖动每帧只重算五个元素。
       */
      rowRef.current?.style.setProperty('--side-w', settled + 'px')
      setAppearance({ ...getAppearance(), agentWidth: settled })
    },
    [],
  )

  /**
   * 右侧那一栏收起了没有（见 lib/appearance 的 sideCollapsed）。
   *
   * 与 agentLeft 是同一种状态：本地一份（即时反馈） + 设置里一份（下次打开还这样）。
   * 收起/展开是一次「点一下就完事」的动作，没有拖动那样「松手才写盘」的必要，所以立即落盘。
   */
  const [sideCollapsed, setSideCollapsed] = useState(() => getAppearance().sideCollapsed)
  /* ---------- 纯净阅读模式 ---------- */

  /**
   * 纯净阅读：两侧栏、页签栏与顶栏一起收起，只留正文（见 LearnWorkspace）。
   *
   * 状态放在这里而不是宿主里，是因为它**要与两列的几何一起算**：进入时哪一栏让位
   * 取决于此刻是谁占着右边那一格，补间那 300ms 还要单独记一笔（见 pureMoving）。
   * 它**不落盘**：重启回来该是正常布局——它不是一种偏好，是一次「现在想安静看会儿」。
   */
  const [pure, setPureState] = useState(false)
  /**
   * 纯净阅读的补间正在走（进出都算）。
   *
   * 它只为一件事存在：**这 300ms 里几处几何不能中途换挡**——让位的导师栏要保持
   * 「定宽 + 负外边距」那副身子、该裁的溢出要一直裁着，直到补间走完才换回 flex-1
   * （半路换会让它当场跳一下，见 SplitRow）。
   *
   * 正文那一格**不冻**——这一点与 setSide 里 animMainWidth 的做法相反，是有意为之：
   * 冻住的话，动画里格子已经长大、正文却还停在旧宽度上贴着一边，腾出来的那块地方
   * 就是一片空白，等补间结束才「唰」地填满（用户报的就是这一下）。纯净阅读要的正好是
   * 「看着它长开」，宁可让正文跟着格子每帧重排一次。
   */
  const [pureMoving, setPureMoving] = useState(false)
  const pureTimer = useRef<number | null>(null)
  /**
   * 右侧栏正在收起 / 展开的那一小会儿（补间期间）。
   *
   * 那一格只在**补间期间与收起之后**加 overflow-hidden：平时必须是 visible 的——
   * 文档区右上角那块 tip（最宽的有 520px）、对话栏里的模型选择器都会超出那一格的宽度，
   * 裁掉它们比「溢出到隔壁一点」糟得多。收起时无所谓（那一格本来就是 0 宽，什么都看不见）。
   */
  const [sideAnimating, setSideAnimating] = useState(false)
  /**
   * 补间期间主位那一格的内容宽度（px）；null = 不冻。
   * 见 setSide 里那段说明：不冻住的话，那 300ms 每一帧都在给正文排一次版。
   */
  const [animMainWidth, setAnimMainWidth] = useState<number | null>(null)
  const sideAnimTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (sideAnimTimer.current !== null) window.clearTimeout(sideAnimTimer.current)
      // 拖到一半卸载（切页面等）：把排着的作画撤掉、门放下，别留一个永远量不了的界面
      if (pureTimer.current !== null) window.clearTimeout(pureTimer.current)
      if (paintRaf.current !== null) window.cancelAnimationFrame(paintRaf.current)
      releaseLayout()
    },
    [],
  )
  /** 这一格此刻要不要裁掉溢出（收起时一直裁，展开时只在补间那 300ms 里裁） */
  const sideClip = sideCollapsed || sideAnimating
  /**
   * 补间期间主位那一格被冻住的宽度（px）；null = 不冻，正文照常跟着格子走（见 setSide）。
   * 只管收起 / 展开那 300ms：拖动期间不冻——用户盯着看的拖动，内容跟着手比省排版要紧
   * （不冻的代价是重文档拖动时每帧一趟正文重排，见 paintDrag 里「不冻宽」的取舍说明）。
   */
  const frozenMain = sideAnimating ? animMainWidth : null
  /**
   * 收起 / 展开右侧那一栏。
   *
   * 收的是「占着右边那一格的东西」——agentLeft 时是文档栏，否则是对话栏（见 SplitRow 的类名）。
   * 与双击分割线对调两栏是两件事：那个换位置，这个只改宽度。
   */
  const setSide = useCallback((collapsed: boolean) => {
    // 从设置里现取一次现状再写：与 agentWidth 一样，本地 state 只是这一份的镜像。
    // 状态已经对了就什么都不做——自动弹开与快捷键都会调它，没必要为一次空操作跑动画
    if (getAppearance().sideCollapsed === collapsed) return
    /*
     * 补间期间把**主位那一格的正文冻在原来的宽度**上（那一格此刻正被对面挤宽 / 挤窄）。
     *
     * 不冻的话，那 300ms 里每一帧都要给整篇正文重新排行盒——几千个元素、公式、代码块，
     * 一帧十几毫秒，看着就是「展开时卡一下」。对面那一格早就这么做了（它保持定宽滑出去），
     * 这里补上另一半：主位那一格定宽 + 外层裁掉溢出，等补间走完再放开，
     * 那时正文只重排**一次**（这一下是必须的，它确实变宽了）。
     */
    const row = rowRef.current
    setAnimMainWidth(row ? Math.max(0, row.clientWidth - (collapsed ? 0 : getAppearance().agentWidth)) : null)
    setSideCollapsed(collapsed)
    setAppearance({ ...getAppearance(), sideCollapsed: collapsed })
    // 补间期间先裁着溢出（见 sideClip），等那 300ms 走完再放开
    setSideAnimating(true)
    if (sideAnimTimer.current !== null) window.clearTimeout(sideAnimTimer.current)
    sideAnimTimer.current = window.setTimeout(() => {
      sideAnimTimer.current = null
      setSideAnimating(false)
      setAnimMainWidth(null)
    }, SIDE_ANIM_MS)
  }, [])
  const toggleSide = useCallback(() => setSide(!getAppearance().sideCollapsed), [setSide])
  /**
   * 展开右侧那一栏（已经展开就什么都不做）。
   *
   * 两个「自动弹开」的入口共用它：导师开始干活（宿主里那个 effect）、Ctrl+Q 要把光标
   * 放进输入框。收着的那一栏等于不存在——这时候把用户要的东西留在里面，
   * 他只会以为没反应。
   */
  const expandSide = useCallback(() => setSide(false), [setSide])
  /**
   * 两列对调：文档区与 AI 对话栏换边（双击两列中间那条线）。
   *
   * 换的只是**位置**，不是宽度：左格照样自适应、右格照样是 agentWidth，
   * 所以对调之后（默认就是对话在左）对话栏占左边那一大块，文档落进右边那条窄的。
   * 与拖动不同，这个开关触发一次就是最终结果，没有「松手」那一刻，立即写进设置。
   *
   * 参数是「谁进主位」：true = 对话栏，false = 文档栏。写成显式目标而不是取反，
   * 是为了调用方不必自己读一遍此刻的状态（当下的入口只有双击分隔线的 swapSides）。
   */
  const swapTo = useCallback(
    (next: boolean) => {
      const apply = () => {
        setAgentLeft(next)
        /*
         * 对调时**把右侧栏展开**：换过去的那一栏是用户接下来要看的东西，
         * 若还收着，他会看到「主位换成了刚看过的那一栏，而想看的那个不见了」——
         * 而那颗用来展开的按钮这时在屏幕最右边，很容易被当成没反应。
         */
        setSideCollapsed(false)
        setAppearance({ ...getAppearance(), agentLeft: next, sideCollapsed: false })
      }
      // 走 View Transitions：浏览器把改动前后各拍一张快照，再让两列从旧位置补间到新位置，
      // 于是看着是「滑过去」而不是「唰地换掉」（两列的 view-transition-name 见 index.css）。
      // 老运行时没有这条 API，退回直接换位，功能不受影响。
      const vt = (document as Document & { startViewTransition?: (cb: () => void) => unknown })
        .startViewTransition
      if (typeof vt !== 'function') {
        apply()
        return
      }
      // flushSync：快照要在同一帧里拍到改完之后的 DOM，否则浏览器拍到的是旧样子
      vt.call(document, () => flushSync(apply))
    },
    [],
  )
  const swapSides = useCallback(() => swapTo(!agentLeft), [swapTo, agentLeft])

  /**
   * 进出纯净阅读。
   *
   * 它只翻状态（外加记一笔「补间中」）——几何怎么变由 SplitRow 按 pure / pureMoving 算，
   * 这里一格都不碰。正文那一格的宽度因此是**跟着补间一路长开的**：
   * 用户看到的就是阅读区一点点占满，而不是先空着、最后一下填上。
   */
  const setPure = (on: boolean) => {
    if (pure === on) return
    setPureState(on)
    // 补间走完之前不许换挡（见 pureMoving）；到点了再放开
    setPureMoving(true)
    if (pureTimer.current !== null) window.clearTimeout(pureTimer.current)
    pureTimer.current = window.setTimeout(() => {
      pureTimer.current = null
      setPureMoving(false)
    }, SIDE_ANIM_MS)
  }
  /** 快捷键、悬浮组那颗按钮与 Esc 都走它：一个键在两个方向上是同一个动作 */
  const togglePure = () => setPure(!pure)

  return {
    agentLeft,
    agentWidth,
    sideCollapsed,
    sideClip,
    frozenMain,
    pure,
    pureMoving,
    setPure,
    togglePure,
    resizingAgent,
    rowWidth,
    rowRef,
    docColRef,
    agentColRef,
    docInnerRef,
    agentInnerRef,
    handleRef,
    sideBtnRef,
    setHintRef,
    onAgentResizeDown,
    onAgentResizeMove,
    onAgentResizeUp,
    toggleSide,
    expandSide,
    swapSides,
  }
}
