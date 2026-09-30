/**
 * 缓动滚动定位。
 *
 * 不用 scrollIntoView({ behavior: 'smooth' })：时长与曲线由浏览器定死
 * （Chromium 约 300ms，远距离时就是「唰」地一闪而过），读者看不清自己
 * 是从哪儿跳到哪儿的。这里自己按帧推进：easeInOutCubic 缓入缓出，
 * 时长随距离伸缩，近处利落、远处从容。
 *
 * 目标位置用回调每帧重算，而不是开始前算一次：正文里的函数图像是
 * DOM 提交之后才异步画出来的，画完会把下面的标题整体往下推；
 * 只算一次的话，跳转就会停在错的地方。
 *
 * 到位之后还会盯一小会儿（见 SETTLE_MS）：内容晚到（图、资源图片）会把人顶走，
 * 那一刻的位移要当场补回来——「点一次没反应、要点好几次」就是它造成的。
 */

/** 缓入缓出：两端慢、中间快，起步和刹车都不突兀 */
const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** 距离 → 时长：太短看不出移动，太长等得心焦 */
function durationFor(distance: number): number {
  return Math.max(260, Math.min(700, 220 + distance * 0.28))
}

/**
 * 到位之后再盯这么久。
 *
 * 为什么需要盯：正文的长度**会变**——函数图像等到空闲时段才画（见 lib/plot），
 * 资源图片要经 IPC 读回字节再挂上去（见 lib/staticView），一张图就是几百像素。
 * 跳转那一刻它们还没有高度，人到了地方又被顶下去，于是成了「点一次没反应」。
 * 盯这一小会儿，位置自己变了就当场补回来。
 */
const SETTLE_MS = 1000
/** 误差超过这么多像素才纠正：一两个像素的抖动不值得再动一次滚动条 */
const SETTLE_TOL = 2
/** 位置被人动了这么多，就认为「用户接手了」：让位，绝不去抢滚动条 */
const SETTLE_YIELD = 3

/**
 * 把 box 缓动滚到 target() 指出的位置，返回「立刻停下」的函数。
 *
 * onArrive：真正滚到位之后回调一次（用来给命中的标题播高亮）。
 * 用户中途自己滚（滚轮 / 触摸 / 拖滚动条）就让位——动画和用户抢滚动条最招人烦，
 * 这种「半路被接管」的情况不算到位，不会回调。
 */
export function smoothScrollTo(
  box: HTMLElement,
  target: () => number,
  onArrive?: () => void,
): () => void {
  const clamp = (v: number) => Math.max(0, Math.min(v, box.scrollHeight - box.clientHeight))
  const start = box.scrollTop
  /** 我们最后写进去的位置：用来分辨「位置自己变了」与「别人动了它」 */
  let expected = start
  let settledAt = 0
  let raf = 0
  let stopped = false
  const t0 = performance.now()

  const stop = () => {
    if (stopped) return
    stopped = true
    if (raf) cancelAnimationFrame(raf)
    box.removeEventListener('wheel', stop)
    box.removeEventListener('touchstart', stop)
    box.removeEventListener('pointerdown', stop)
  }

  /**
   * 到位之后的小段盯梢（见 SETTLE_MS 的说明）。
   *
   * 两条判据：位置自己变了就纠正；**位置被别人改了就让位**——用户滚轮、键盘、
   * 拖滚动条一动，我们立刻收手。跟他抢滚动条，比没跳准更让人恼火。
   */
  const settle = () => {
    if (stopped) return
    if (Math.abs(box.scrollTop - expected) > SETTLE_YIELD) {
      stop()
      return
    }
    const to = clamp(target())
    if (Math.abs(to - expected) > SETTLE_TOL) {
      box.scrollTop = to
      expected = to
    }
    if (performance.now() - settledAt >= SETTLE_MS) {
      stop()
      return
    }
    raf = requestAnimationFrame(settle)
  }

  /** 到位：先给反馈（高亮那一笔），再开始盯梢。高亮挂在元素上，纠正位置时它跟着走 */
  const arrive = () => {
    settledAt = performance.now()
    onArrive?.()
    settle()
  }

  // 关掉动效偏好就直接到位：这一栏只是导航，没必要为它破例（位置照样要盯住）
  const reduce = box.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce) {
    box.scrollTop = clamp(target())
    expected = box.scrollTop
    arrive()
    return stop
  }

  box.addEventListener('wheel', stop, { passive: true })
  box.addEventListener('touchstart', stop, { passive: true })
  box.addEventListener('pointerdown', stop)

  const step = (now: number) => {
    if (stopped) return
    const to = clamp(target())
    const dist = to - start
    // 帧时间戳可能早于触发那一刻的 performance.now()（这一帧早已在生成中），
    // 夹一下，别让进度倒着走
    const p = Math.max(0, Math.min(1, (now - t0) / durationFor(Math.abs(dist))))
    box.scrollTop = start + dist * ease(p)
    expected = box.scrollTop
    if (p >= 1) {
      arrive()
      return
    }
    raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  return stop
}
