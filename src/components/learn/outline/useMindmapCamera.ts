/*
 * 本文件负责：思维导图的**相机与画布手势**——平移/缩放的「真身」（ref）、手势期间
 * 直接写 DOM 与延迟提交回 state、鼠标/滚轮/空格键/中键手势、画布尺寸变化时的取景
 * 校正，以及自适应画布、归位、缩放按钮与「选中居中」的镜头落位。
 *
 * 原样搬自 MindmapView.tsx 主组件的相机区块（注释一并带走），按本仓库惯例收成
 * XxxDeps 单对象的逻辑 hook：宿主先声明选中状态与两份「最新数据」ref 再调本 hook，
 * hook 不关心选中是谁、怎么来的（空白点击只通过 deps 的三个入口说话）。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MINDMAP_MAX_ZOOM, MINDMAP_MIN_ZOOM, SELECT_ZOOM, centerPanFor } from './mindmapNav'
import { PADDING } from './mindmapTypes'
import type { MindmapNodeData } from './mindmapTypes'

/** 相机需要宿主提供的最小能力（都在宿主里先声明好，不存在晚绑定） */
export interface MindmapCameraDeps {
  /** 当前选中的节点 id（空白处按下时读它：非空才要清） */
  getSelectedId: () => string | null
  /** 空白处一点就取消选中 */
  clearSelection: () => void
  /** 空白处按下：收起开着的文档 tip */
  closeTip: () => void
  /** 画布尺寸变化时按选中节点重新取景：最新选中 id（宿主渲染时同步，ref 身份稳定） */
  selectedIdRef: { current: string | null }
  /** 画布尺寸变化时按选中节点重新取景：节点 id → 图层数据的最新快照（同上） */
  nodeIndexRef: { current: Map<string, MindmapNodeData> }
}

/**
 * 思维导图的相机。返回相机状态（渲染用）、两个挂点 ref（container / canvas）、
 * 与全部镜头动作；手势细节（拖动、滚轮、键盘、ResizeObserver）都关在本 hook 里。
 */
export function useMindmapCamera(
  { getSelectedId, clearSelection, closeTip, selectedIdRef, nodeIndexRef }: MindmapCameraDeps,
  totalWidth: number,
  totalHeight: number,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const isDraggingRef = useRef(false)
  const isSpacePressedRef = useRef(false)
  const isMiddleDownRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  const [pan, setPan] = useState({ x: PADDING, y: PADDING })
  const [zoom, setZoom] = useState(1)

  /**
   * 相机的**真身**是这两个 ref，state 只是它的一个快照。
   *
   * 为什么不能反过来（渲染时 `panRef.current = pan`）：拖动期间 DOM 上的位置永远比
   * state 新——一次 mousemove 就走一次 setState 的话，鼠标每动 1px 都要把整棵导图
   * （每张卡片、每条曲线的四条 path）重新协调一遍，一秒钟上百次，这就是「拖起来卡卡的」
   * 的来源。所以手势期间只改 ref + 直接写 DOM，松手才把结果交回 state。
   *
   * 而 `panRef.current = pan` 那种写法在拖动中是有害的：拖动期间任何一次无关的重渲染
   * （悬停、tip、选中）都会把 ref 拽回拖动开始时的旧值，镜头当场跳回去。
   * 方向必须只有一条：ref → DOM / ref → state。
   */
  const panRef = useRef(pan)
  const zoomRef = useRef(zoom)
  useEffect(() => {
    panRef.current = pan
    zoomRef.current = zoom
  }, [pan, zoom])

  /** 被平移缩放的那一层。相机的一切都写在这一个元素的 style 上 */
  const canvasRef = useRef<HTMLDivElement | null>(null)

  /**
   * 「手势（拖动 / 滚轮）正在自己管镜头」：这段时间 DOM 上的 transform 才是真身，
   * 重渲染不许把它盖掉（见下面那个 layout effect）。
   */
  const gestureRef = useRef(false)

  /**
   * 是否正在平移。**必须有 state**（而 ref 不够）：它要改卡片与连线的类名——
   * 拖动时光标不动、画面在动，指针底下的卡片一直在换，每一张新悬停的卡片都会起一段
   * 150ms 的位移 / 辉光补间（还带着 backdrop-blur），一拖起来就是连着好几张在同时补间。
   * 拖的时候用户手里是「抓住」的，本来也不指望卡片再来给悬停反馈，索性整段关掉。
   *
   * 代价是拖动开始与结束各一次渲染——这点开销远小于沿途不停起停的那些补间。
   */
  const [panning, setPanning] = useState(false)

  /**
   * 与上面那个 state 同义，给**事件回调**读。
   *
   * 回调（onMouseUp）里读不到刚 set 进去的 state（那要等一次渲染），而它要判断的正是
   * 「这一趟到底进没进过平移态」——一次纯点击不该走提交那一步。
   * 两份值必须一起改，所以它只在 beginPan / onMouseUp 两处被写。
   */
  const panningRef = useRef(false)

  /** 把 ref 里的相机写进画布的 style——**这一帧唯一的写入口** */
  const paintCamera = useCallback(() => {
    const el = canvasRef.current
    if (!el) return
    const p = panRef.current
    // translate3d 而不是 translate：先把它推上合成层（配合 will-change），
    // 平移就只剩 GPU 上的位移，卡片那些 backdrop-blur 不会被逐帧重算一遍
    el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${zoomRef.current})`
  }, [])

  /** 一帧最多画一次：鼠标回报率可以远高于帧率（游戏鼠标 1000Hz），逐事件写是白费 */
  const paintRafRef = useRef<number | null>(null)
  const schedulePaint = useCallback(() => {
    if (paintRafRef.current !== null) return
    paintRafRef.current = requestAnimationFrame(() => {
      paintRafRef.current = null
      paintCamera()
    })
  }, [paintCamera])

  /** 手势把结果交回 state 的定时器（滚轮是连续事件，等它停下来再提交） */
  const commitTimerRef = useRef<number | null>(null)

  const cancelCommitTimer = useCallback(() => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current)
      commitTimerRef.current = null
    }
  }, [])

  /**
   * 手势结束（或滚轮停了）：把 ref 的相机交回 state，并解掉「手势 owns 镜头」。
   *
   * 顺序要紧：先落 state 再解标记。反过来会先渲染出一帧旧的 state（镜头跳回原处），
   * 而那时标记已经解掉，layout effect 也不会再把它救回来。
   */
  const commitCamera = useCallback(() => {
    if (paintRafRef.current !== null) {
      cancelAnimationFrame(paintRafRef.current)
      paintRafRef.current = null
    }
    cancelCommitTimer()
    paintCamera()
    gestureRef.current = false
    setPan({ ...panRef.current })
    setZoom(zoomRef.current)
  }, [paintCamera, cancelCommitTimer])

  /**
   * 滚轮是连续事件：每一下都提交就没意义了（那正是卡顿的来源），
   * 等手上停下来再交回 state。期间缩放百分比那个读数会慢半拍，
   * 但那半拍里用户的眼睛在画布上，不在工具栏上。
   */
  const scheduleCommit = useCallback(() => {
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current)
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null
      commitCamera()
    }, 140)
  }, [commitCamera])

  /**
   * 拖动期间把这一层提到自己的合成层；松手后**留一小会儿**再撤。
   *
   * 提到合成层是拖动顺滑的关键：这层里每张卡片都带 `backdrop-blur`，不提升的话
   * 每移动一像素，浏览器都要把底下的背景重新模糊一遍；提升之后它是一张现成的贴图，
   * 平移只是 GPU 上的一次位移。前提是背景本身不动——这里正是如此（网格底 + 壁纸都是静的）。
   *
   * 松手后不立刻撤：连续几下小拖动是最常见的用法，每下都撤了又提会反复重建图层，
   * 而重建本身就要卡一下。
   */
  const promoteTimerRef = useRef<number | null>(null)
  const promoteCanvas = useCallback((on: boolean) => {
    const el = canvasRef.current
    if (!el) return
    if (promoteTimerRef.current !== null) {
      window.clearTimeout(promoteTimerRef.current)
      promoteTimerRef.current = null
    }
    if (on) {
      el.style.willChange = 'transform'
      return
    }
    promoteTimerRef.current = window.setTimeout(() => {
      promoteTimerRef.current = null
      el.style.willChange = ''
    }, 400)
  }, [])

  useEffect(
    () => () => {
      if (paintRafRef.current !== null) cancelAnimationFrame(paintRafRef.current)
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current)
      if (promoteTimerRef.current !== null) window.clearTimeout(promoteTimerRef.current)
    },
    [],
  )

  /**
   * 每次渲染之后，只要手势还握着镜头，就把 DOM 上的值重新写回去。
   *
   * 拖动期间的一次悬停、一次选中、一个 tip 展开都会让 React 重渲染，而 style 里的
   * transform 来自 state（旧值）——不补这一下，画面就会在拖动中途跳回起点。
   * 用 layout effect 而不是 effect：它跑在浏览器绘制之前，补得上看不见。
   */
  useLayoutEffect(() => {
    if (gestureRef.current) paintCamera()
  })

  // 是否处于平滑过渡动画中（自适应画布、归位、按钮缩放时启用，鼠标拖拽与滚轮缩放保持 0 延迟即时追踪）
  const [isTransitioning, setIsTransitioning] = useState(false)
  const transitionTimerRef = useRef<number | null>(null)

  /**
   * 起一段补间动画（自适应画布 / 归位 / 缩放按钮）。
   *
   * 它同时是「镜头交给谁」的交接点：一动补间就解掉手势对镜头的所有权，并撤掉手势
   * 还没交回的那次延迟提交——否则滚轮刚停、补间刚开始，那次迟到的提交会把镜头
   * 按到手势的终值上，补间当场被截断（看着像动画只播了一半）。
   */
  const triggerTransition = useCallback(() => {
    gestureRef.current = false
    cancelCommitTimer()
    setIsTransitioning(true)
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current)
    }
    transitionTimerRef.current = window.setTimeout(() => {
      setIsTransitioning(false)
    }, 240)
  }, [cancelCommitTimer])

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) {
        window.clearTimeout(transitionTimerRef.current)
      }
    }
  }, [])

  const lastMiddleClickRef = useRef(0)

  // 调节相机缩放和坐标，直到窗口能够完整显示思维导图
  const fitView = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const padX = 72
    const padY = 72
    const scaleX = (rect.width - padX) / totalWidth
    const scaleY = (rect.height - padY) / totalHeight
    const newZoom = Math.min(MINDMAP_MAX_ZOOM, Math.max(MINDMAP_MIN_ZOOM, Math.min(scaleX, scaleY)))
    const roundedZoom = Math.round(newZoom * 100) / 100
    const nextPan = {
      x: (rect.width - totalWidth * roundedZoom) / 2,
      y: (rect.height - totalHeight * roundedZoom) / 2,
    }
    triggerTransition()
    panRef.current = nextPan
    zoomRef.current = roundedZoom
    setZoom(roundedZoom)
    setPan(nextPan)
  }, [totalWidth, totalHeight, triggerTransition])

  /**
   * 把某个节点摆到画面正中，缩放回到**选中档**（见 SELECT_ZOOM）。
   *
   * 需求原文先说了「改为 100% 缩放，节点显示在垂直和水平居中位置」，随后又改成
   * 「选中时的相机缩放加到一百二」——所以现在是 **120%、居中**。
   *
   * 从前那条「按包围盒算一个缩放，把节点连同子级收进画面」的路子早就删掉了：
   * 那样每次选中的倍率都不一样，在节点之间跳来跳去时，眼睛要找的成了缩放比例而不是节点。
   * 现在无论从哪儿跳过来，倍率都是同一个数，镜头只负责把目标搬到正中间——
   * 要看更大的范围自己滚轮拉远，要看细节就拉近，镜头不自作主张。
   */
  const centerOnNode = useCallback(
    (target: MindmapNodeData) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const nextPan = centerPanFor(target, rect, SELECT_ZOOM)
      triggerTransition()
      panRef.current = nextPan
      zoomRef.current = SELECT_ZOOM
      setZoom(SELECT_ZOOM)
      setPan(nextPan)
    },
    [triggerTransition],
  )

  /**
   * 预览节点获得焦点时，相机缩放改为 100% (1.0)，并将文档居中
   */
  const centerOnPreview = useCallback(
    (target: MindmapNodeData) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      // 预览节点获得焦点时相机缩放固定为 100% (1.0)
      const PREVIEW_ZOOM = 1.0
      // 垂直与水平绝对居中 (verticalRatio = 0.5)
      const nextPan = centerPanFor(target, rect, PREVIEW_ZOOM, 0.5)
      triggerTransition()
      panRef.current = nextPan
      zoomRef.current = PREVIEW_ZOOM
      setZoom(PREVIEW_ZOOM)
      setPan(nextPan)
    },
    [triggerTransition],
  )

  /**
   * 这一次按下之后**有没有真的拖动过**。连线上的按下会同时开启平移（见 onMouseDown），
   * 拖完松手浏览器照样会补一个 click——不靠它挡一下，「从连线上拖着画面走」会变成跳节点。
   */
  const dragMovedRef = useRef(false)

  // 鼠标拖拽平移画布（支持中键滚轮拖动与按住空格键+左键拖动）
  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      dragMovedRef.current = false
      const target = e.target as HTMLElement
      if (target.closest('[data-preview-close]')) return
      const onCard = !!target.closest('[data-mm-card]')
      // 连线上的按下不算「点空白」：点线要跳到另一端，而那一头要靠当前选中是谁来判断，
      // 这里要是先把选中清掉，点线的语义就没了。
      const onEdge = !!target.closest('[data-mm-edge]')

      /**
       * 只是「按下了」：记个起点，**什么都不改**。
       *
       * 平移态（换光标 / 提图层 / 关掉悬停反馈）要等到指针真的走过阈值才进
       * （见 onMouseMove）——按下即进入的话，一次纯点击也会让底下的卡片
       * 收一下辉光再放回去，看着像闪了一下。
       */
      const armDrag = () => {
        dragStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: panRef.current.x,
          panY: panRef.current.y,
        }
      }

      // 按住空格键 + 鼠标左键按下：拖拽平移画布
      if (e.button === 0 && isSpacePressedRef.current) {
        e.preventDefault()
        isDraggingRef.current = true
        armDrag()
        return
      }

      // 中键按下：按住中键拖拽平移相机视角；双击中键恢复全图居中
      if (e.button === 1) {
        e.preventDefault()
        isMiddleDownRef.current = true
        const now = Date.now()
        if (now - lastMiddleClickRef.current < 380) {
          fitView()
          lastMiddleClickRef.current = 0
          return
        }
        lastMiddleClickRef.current = now
        isDraggingRef.current = true
        armDrag()
        return
      }

      if (getSelectedId() !== null && !onCard && !onEdge) {
        // 空白处一点就取消选中
        clearSelection()
      }
      if (target.closest('button, a, input')) return
      if (!onCard) closeTip()

      // 鼠标左键不再直接拖动相机视角，改为仅按住空格+左键或按住鼠标中键拖动；左键用于点击与选中交互
      if (e.button === 0) return
    },
    [fitView, getSelectedId, clearSelection, closeTip],
  )

  /**
   * 真的开始拖了：进平移态。
   *
   * 这一刻是「镜头交给手势」的交接点，四件事一起做：
   * 掐掉上一颗按钮点出来的过渡（那 240ms 里镜头跟着过渡走，拖起来发飘）、
   * 撤掉滚轮还没交回的那次延迟提交（它到点就会把镜头所有权抢走）、
   * 把这层提到合成层（见 promoteCanvas）、换成「抓住」的光标。
   */
  const beginPan = useCallback(() => {
    setIsTransitioning(false)
    setPanning(true)
    panningRef.current = true
    cancelCommitTimer()
    gestureRef.current = true
    promoteCanvas(true)
    // 光标直接写 DOM：改 state 要等一次渲染，而「抓住」的反馈必须是当场就有的
    if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
  }, [cancelCommitTimer, promoteCanvas])

  /**
   * 拖动中：只改 ref + 排一帧绘制，**不碰 state**。
   * 鼠标回报率可以远高于帧率，一个 setState 就是整棵导图重协调一遍——那是卡顿的来源。
   */
  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return
      const dx = e.clientX - dragStartRef.current.x
      const dy = e.clientY - dragStartRef.current.y
      if (!dragMovedRef.current) {
        // 几像素的抖动不算拖：手指在触控板上总会晃，那一下仍然是「点击」
        if (Math.abs(dx) + Math.abs(dy) <= 4) return
        dragMovedRef.current = true
        beginPan()
      }
      panRef.current = {
        x: dragStartRef.current.panX + dx,
        y: dragStartRef.current.panY + dy,
      }
      schedulePaint()
    },
    [beginPan, schedulePaint],
  )

  const onMouseUp = useCallback(() => {
    isMiddleDownRef.current = false
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    if (containerRef.current) {
      containerRef.current.style.cursor = isSpacePressedRef.current ? 'grab' : ''
    }
    // 没进过平移态（只是点了一下，或者滚轮手势还没结束）：没有要交回的相机
    if (!gestureRef.current || !panningRef.current) return
    panningRef.current = false
    setPanning(false)
    promoteCanvas(false)
    // 一次提交：把手势期间写在 DOM 上的结果交回 state，两边对齐
    commitCamera()
  }, [promoteCanvas, commitCamera])

  // 监听空格键按下与释放：支持按住空格键+左键拖拽平移画布，以及全局 mouseup 兜底
  useEffect(() => {
    const isInputTarget = (target: EventTarget | null) => {
      if (!target || !(target instanceof HTMLElement)) return false
      const tag = target.tagName.toLowerCase()
      return tag === 'input' || tag === 'textarea' || target.isContentEditable
    }

    const isVisible = () => {
      const el = containerRef.current
      if (!el) return false
      return el.offsetWidth > 0 && el.offsetHeight > 0
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !isInputTarget(e.target)) {
        if (!isVisible()) return
        isSpacePressedRef.current = true
        if (containerRef.current && !isDraggingRef.current) {
          containerRef.current.style.cursor = 'grab'
        }
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false
        if (containerRef.current && !isDraggingRef.current) {
          containerRef.current.style.cursor = ''
        }
      }
    }

    const handleWindowBlur = () => {
      isSpacePressedRef.current = false
      isMiddleDownRef.current = false
      if (containerRef.current && !isDraggingRef.current) {
        containerRef.current.style.cursor = ''
      }
    }

    const handleWindowMouseUp = (e: MouseEvent) => {
      if (e.button === 1 || (e.buttons & 4) === 0) {
        isMiddleDownRef.current = false
      }
      if (isDraggingRef.current) {
        onMouseUp()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleWindowBlur)
    window.addEventListener('mouseup', handleWindowMouseUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleWindowBlur)
      window.removeEventListener('mouseup', handleWindowMouseUp)
    }
  }, [onMouseUp])

  /**
   * 画面尺寸发生变化时自动校正相机位置：
   * 当侧栏展开/收起、分屏调整或窗口尺寸改变时，如果当前有选中的节点，自动将其重新定位到水平居中、垂直40%；
   * 若无选中节点，则按尺寸变化量等量平移，确保视觉中心点不偏移出画面，防止镜头切边或被遮挡。
   *
   * 采用与手势/滚轮一致的 ref + RAF + 防抖提交策略，避免尺寸过渡动画（如侧栏 300ms 过渡）过程中
   * 逐帧调用 setPan 触发大量 React 重渲染导致与 DOM transform 冲突发生画面抽搐。
   */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let prevWidth = el.clientWidth
    let prevHeight = el.clientHeight

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width <= 0 || height <= 0) {
        prevWidth = 0
        prevHeight = 0
        return
      }

      // 若先前处于隐藏状态（尺寸 <= 0），仅记录新尺寸，不触发平移
      if (prevWidth <= 0 || prevHeight <= 0) {
        prevWidth = width
        prevHeight = height
        return
      }

      const diffW = width - prevWidth
      const diffH = height - prevHeight
      // 忽略小于 0.5px 的亚像素微小抖动
      if (Math.abs(diffW) < 0.5 && Math.abs(diffH) < 0.5) return

      if (!isDraggingRef.current) {
        const curSelectedId = selectedIdRef.current
        const target = curSelectedId ? nodeIndexRef.current.get(curSelectedId) : null
        let nextPan: { x: number; y: number }
        if (target) {
          if (target.isPreview) {
            const fitZoomX = (width - 80) / target.width
            const fitZoomY = (height - 80) / target.height
            const desiredZoom = Math.max(MINDMAP_MIN_ZOOM, Math.min(MINDMAP_MAX_ZOOM, Math.min(fitZoomX, fitZoomY, 1.0)))
            setZoom(desiredZoom)
            zoomRef.current = desiredZoom
            nextPan = centerPanFor(target, { width, height }, desiredZoom, 0.5)
          } else {
            nextPan = centerPanFor(target, { width, height }, zoomRef.current, 0.4)
          }
        } else {
          nextPan = {
            x: panRef.current.x + diffW / 2,
            y: panRef.current.y + diffH / 2,
          }
        }
        // 尺寸变动期间关闭 CSS transition，避免动画帧与 CSS 补间冲突导致抽搐
        setIsTransitioning(false)
        gestureRef.current = true
        panRef.current = nextPan
        schedulePaint()
        scheduleCommit()
      }
      prevWidth = width
      prevHeight = height
    })

    ro.observe(el)
    return () => ro.disconnect()
    // selectedIdRef / nodeIndexRef 是宿主的 ref（身份恒定），列出只为过 exhaustive-deps
  }, [schedulePaint, scheduleCommit, selectedIdRef, nodeIndexRef])

  // 监听容器原生 wheel 事件并关闭 passive，以便 preventDefault 生效并消除浏览器警告；
  // 同时以鼠标所在位置为锚点进行缩放，使镜头向鼠标所指的目标精准推进或拉远
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      const targetEl = e.target as HTMLElement | null
      const isInsidePreview = Boolean(targetEl?.closest('[data-preview-card], [data-preview-scroll]'))

      // 按住鼠标滚轮（鼠标中键）时禁用滚轮滚动，防止拖动画面的过程中意外触发缩放或滚动
      if (isMiddleDownRef.current || (e.buttons & 4) !== 0) {
        e.preventDefault()
        return
      }

      // 如果滚轮事件发生在文档预览卡片内部且未按住 Ctrl/Cmd，则允许卡片正文区域正常原生滚动浏览，不拦截亦不平移画布
      if (isInsidePreview && !e.ctrlKey && !e.metaKey) {
        return
      }

      e.preventDefault()

      // 按住 Ctrl / Cmd 才能滚轮缩放
      if (e.ctrlKey || e.metaKey) {
        if (Math.abs(e.deltaY) < 0.1) return

        const rect = el.getBoundingClientRect()
        const cursorX = e.clientX - rect.left
        const cursorY = e.clientY - rect.top

        // 缩放比率：支持平滑触控板与传统滚轮步进，向上滚放大，向下滚缩小
        const factor = Math.min(1.25, Math.max(0.8, Math.exp(-e.deltaY * 0.0018)))
        const curZoom = zoomRef.current
        const curPan = panRef.current

        const rawNextZoom = curZoom * factor
        // 限制大纲视图的缩放最大尺度为 120%
        const nextZoom = Math.min(MINDMAP_MAX_ZOOM, Math.max(MINDMAP_MIN_ZOOM, Math.round(rawNextZoom * 1000) / 1000))
        if (Math.abs(nextZoom - curZoom) < 0.0001) return

        // 以鼠标光标所在点为锚点：缩放前后鼠标指针下的画布世界坐标保持不动，镜头随鼠标朝向推进或拉远
        const nextPanX = cursorX - ((cursorX - curPan.x) / curZoom) * nextZoom
        const nextPanY = cursorY - ((cursorY - curPan.y) / curZoom) * nextZoom

        setIsTransitioning(false)
        gestureRef.current = true
        panRef.current = { x: nextPanX, y: nextPanY }
        zoomRef.current = nextZoom
        schedulePaint()
        scheduleCommit()
      } else {
        // 普通滚轮：让相机朝上朝下移动；按住 Shift 朝左右移动
        // 减少鼠标滚轮位移量（系数 0.4），位移更细腻可控
        const WHEEL_PAN_SPEED = 0.4
        setIsTransitioning(false)
        gestureRef.current = true

        if (e.shiftKey) {
          // Shift + 滚轮：左右移动相机视角
          const rawDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
          const delta = rawDelta * WHEEL_PAN_SPEED
          panRef.current = {
            x: panRef.current.x - delta,
            y: panRef.current.y,
          }
        } else {
          // 垂直移动：上下移动相机视角
          panRef.current = {
            x: panRef.current.x - e.deltaX * WHEEL_PAN_SPEED,
            y: panRef.current.y - e.deltaY * WHEEL_PAN_SPEED,
          }
        }
        schedulePaint()
        scheduleCommit()
      }
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', handleWheel)
    }
  }, [schedulePaint, scheduleCommit])

  const zoomIn = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const curZoom = zoomRef.current
    const curPan = panRef.current
    const nextZoom = Math.min(MINDMAP_MAX_ZOOM, Math.round((curZoom + 0.15) * 100) / 100)
    if (nextZoom === curZoom) return
    const nextPan = {
      x: cx - ((cx - curPan.x) / curZoom) * nextZoom,
      y: cy - ((cy - curPan.y) / curZoom) * nextZoom,
    }
    triggerTransition()
    panRef.current = nextPan
    zoomRef.current = nextZoom
    setPan(nextPan)
    setZoom(nextZoom)
  }, [triggerTransition])

  const zoomOut = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const curZoom = zoomRef.current
    const curPan = panRef.current
    const nextZoom = Math.max(MINDMAP_MIN_ZOOM, Math.round((curZoom - 0.15) * 100) / 100)
    if (nextZoom === curZoom) return
    const nextPan = {
      x: cx - ((cx - curPan.x) / curZoom) * nextZoom,
      y: cy - ((cy - curPan.y) / curZoom) * nextZoom,
    }
    triggerTransition()
    panRef.current = nextPan
    zoomRef.current = nextZoom
    setPan(nextPan)
    setZoom(nextZoom)
  }, [triggerTransition])

  const resetZoom = useCallback(() => {
    triggerTransition()
    const nextPan = { x: PADDING, y: PADDING }
    panRef.current = nextPan
    zoomRef.current = 1
    setZoom(1)
    setPan(nextPan)
  }, [triggerTransition])

  const onDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input')) return
    fitView()
  }, [fitView])

  return {
    /** 根容器（网格底、收手势的那一层） */
    containerRef,
    /** 被平移缩放的画布层 */
    canvasRef,
    /** 相机快照（渲染用；真身在 panRef/zoomRef 里，见上） */
    pan,
    zoom,
    /** 读「最新缩放」的挂点：toggleTip 量 tip 尖角位置时要除回 zoom */
    zoomRef,
    /** 这一次按下之后有没有真的拖动过（连线的 click 靠它挡掉拖完补发的 click） */
    dragMovedRef,
    isTransitioning,
    panning,
    fitView,
    centerOnNode,
    centerOnPreview,
    zoomIn,
    zoomOut,
    resetZoom,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onDoubleClick,
  }
}
