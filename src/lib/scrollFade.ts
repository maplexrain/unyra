/**
 * 这个文件负责什么：滚动容器两端的渐隐——什么时候该淡、以及那段 mask 怎么写。
 *
 * 为什么两端要**分开**判，而不是无脑「上下都淡」：
 * 渐隐是拿可见内容换的。静止在顶部时第一行的上沿被啃掉一截、静止在底部时最后一行
 * 同理，而「滚到头」恰恰是最该看清的地方。所以规则是：只有那一端确实还压着内容
 * （没到头）时才淡，到头即摘。
 *
 * 为什么「摘掉」这件事本身也重要：带 alpha 的 mask 会把滚动的整层拉进合成，
 * 正文字形会从次像素抗锯齿掉到灰度抗锯齿、看着略虚。停在顶部读第一段时不该付这个
 * 代价——上面那条规则顺带也解决了它。反过来，判据一定要稳（阈值 2px、一帧最多算一次），
 * 否则在端点附近来回抖，字形会一眼可见地闪。
 *
 * 为什么用 mask 而不是渐变幕布（原先聊天列表顶部那块 agent-msg-fade-curtain）：
 * 幕布只能「画一个已知的底色」，一旦底下是壁纸或半透明面板，它就和真实底色对不上，
 * 边缘会浮出一条色带——theme.css 里那条「有壁纸就 display:none」正是被这一点逼出来的。
 * mask 只动 alpha，底下是什么都不用管，壁纸下也照常成立。
 */
import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * 离端点多少像素以内算「到头了」。
 * 亚像素抖动（缩放、HiDPI 换行）会让 scrollTop 停在 0.5 这种值上，判据太紧就会闪。
 */
const EDGE_EPS = 2

/** 渐隐带的高度（px）：与原先顶部幕布的 h-12 同值，观感不用重新调 */
export const FADE_PX = 48

export interface ScrollEdges {
  /** 已经顶到头：上面没有内容压着，不需要上端渐隐 */
  atTop: boolean
  /** 已经到底：下面没有内容压着，不需要下端渐隐 */
  atBottom: boolean
}

/**
 * 盯着一个滚动容器的两端：滚到端点时对应那一端就不再渐隐。
 *
 * 独立挂在 `scroll` 上，而不是去复用 useScrollFollow 的 `pinned`：那个状态说的是
 * 「要不要跟着最新消息走」（阈值 32px，还是用户意图），渐隐要的是**几何事实**
 * （下面还剩几个像素）。两者在 32px 内会给出不同答案，混用会让边框亮灭早一步。
 */
export function useScrollEdges<T extends HTMLElement>(ref: RefObject<T | null>): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ atTop: true, atBottom: true })
  /**
   * 正在盯哪个节点。要记是因为容器**可能晚一拍才挂上**：LocalDoc / DocBody 在加载态
   * 走的是早返回，那一刻 ref 还是 null；只挂一次的话，正文出来之后永远接不上。
   */
  const watched = useRef<{ el: T; stop: () => void } | null>(null)

  // 每轮渲染对一次身份：换了节点才重挂，同一个节点直接返回（一次引用比较，可以忽略）
  useEffect(() => {
    const el = ref.current
    if (watched.current?.el === el) return
    watched.current?.stop()
    watched.current = null
    if (!el) return

    let frame = 0
    const read = () => {
      frame = 0
      const atTop = el.scrollTop <= EDGE_EPS
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= EDGE_EPS
      // 同一个值时返回旧对象：React 会跳过这次渲染，滚动过程中不会每帧重渲一次
      setEdges((prev) => (prev.atTop === atTop && prev.atBottom === atBottom ? prev : { atTop, atBottom }))
    }
    // 一帧最多读一次：scroll 一秒能发几十次，而这里只关心「过没过端点」
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(read)
    }

    el.addEventListener('scroll', schedule, { passive: true })
    /*
      内容长高不一定会触发 scroll（贴底时 scrollTop 可能没动），却在改变
      「下面还压不压着东西」：流式吐字、图片解码完、公式渲染完、工具卡展开都算。
      容器本身量一遍，内容那一层再量一遍。
    */
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    read()

    watched.current = {
      el,
      stop: () => {
        el.removeEventListener('scroll', schedule)
        ro.disconnect()
        if (frame) window.cancelAnimationFrame(frame)
      },
    }
    // 不给依赖数组：这个 effect 只做「节点身份变没变」的判断，每轮跑一次才接得住晚挂上的容器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })

  /*
    卸载时收尾（上面那个 effect 不返回 cleanup，它每轮都会跑）。
    这里必须把 watched 清空：StrictMode 会把 effect 挂载跑两遍，不清的话第二遍
    一眼看到「还是同一个节点」，就直接返回了——监听再也接不回来。
  */
  useEffect(
    () => () => {
      watched.current?.stop()
      watched.current = null
    },
    [],
  )

  return edges
}

/**
 * 按两端的开关拼出 mask-image。**两端都到头时返回 undefined**（即完全不挂 mask）：
 * 这一层不进合成，字形保持清晰。
 *
 * 渐变里那个 #000 是随便挑的：mask 用的是它的 alpha 通道（`mask-mode` 默认 alpha），
 * 颜色本身不参与计算。
 */
export function fadeMask(edges: ScrollEdges, size: number = FADE_PX): string | undefined {
  if (edges.atTop && edges.atBottom) return undefined
  if (edges.atTop) {
    return `linear-gradient(to bottom, #000 0, #000 calc(100% - ${size}px), transparent 100%)`
  }
  if (edges.atBottom) {
    return `linear-gradient(to bottom, transparent 0, #000 ${size}px, #000 100%)`
  }
  return `linear-gradient(to bottom, transparent 0, #000 ${size}px, #000 calc(100% - ${size}px), transparent 100%)`
}

export interface HorizontalScrollEdges {
  /** 已经顶到左头：左边没有内容压着，不需要左端渐隐 */
  atLeft: boolean
  /** 已经到右头：右边没有内容压着，不需要右端渐隐 */
  atRight: boolean
}

/** 水平渐隐带的宽度（px） */
export const HORIZONTAL_FADE_PX = 28

/**
 * 盯着一个横向滚动容器的两端：滚到端点时对应那一端就不再渐隐。
 */
export function useHorizontalScrollEdges<T extends HTMLElement>(ref: RefObject<T | null>): HorizontalScrollEdges {
  const [edges, setEdges] = useState<HorizontalScrollEdges>({ atLeft: true, atRight: true })
  const watched = useRef<{ el: T; stop: () => void } | null>(null)

  useEffect(() => {
    const el = ref.current
    if (watched.current?.el === el) return
    watched.current?.stop()
    watched.current = null
    if (!el) return

    let frame = 0
    const read = () => {
      frame = 0
      const atLeft = el.scrollLeft <= EDGE_EPS
      const atRight = el.scrollWidth - el.scrollLeft - el.clientWidth <= EDGE_EPS
      setEdges((prev) => (prev.atLeft === atLeft && prev.atRight === atRight ? prev : { atLeft, atRight }))
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(read)
    }

    el.addEventListener('scroll', schedule, { passive: true })
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    read()

    watched.current = {
      el,
      stop: () => {
        el.removeEventListener('scroll', schedule)
        ro.disconnect()
        if (frame) window.cancelAnimationFrame(frame)
      },
    }
  })

  useEffect(
    () => () => {
      watched.current?.stop()
      watched.current = null
    },
    [],
  )

  return edges
}

/**
 * 按横向两端的开关拼出 mask-image（用于 TabBar 等横向溢出提醒）。
 */
export function horizontalFadeMask(edges: HorizontalScrollEdges, size: number = HORIZONTAL_FADE_PX): string | undefined {
  if (edges.atLeft && edges.atRight) return undefined
  if (edges.atLeft) {
    return `linear-gradient(to right, #000 0, #000 calc(100% - ${size}px), transparent 100%)`
  }
  if (edges.atRight) {
    return `linear-gradient(to right, transparent 0, #000 ${size}px, #000 100%)`
  }
  return `linear-gradient(to right, transparent 0, #000 ${size}px, #000 calc(100% - ${size}px), transparent 100%)`
}
