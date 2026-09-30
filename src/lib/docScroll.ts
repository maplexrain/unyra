import { useEffect, useRef } from 'react'

/**
 * 「这份文档读到哪儿了」的接法：**挂载（或第一次显示）时恢复，滚动时上报**。
 *
 * 两件事都有个反直觉的地方，收在这里免得各写各的：
 *
 * 1. **恢复要等它真的显示出来**。正文是常驻的（见 LearnWorkspace 的 DocPane）：
 *    display:none 的那一片没有排版，scrollTop 设了也留不住（scrollHeight 是 0）。
 *    所以恢复的时机是「第一次 active」，不是「挂载」——在源码视图里打开一份文档、
 *    过一会儿才切到预览，那一次恢复才算数。
 *
 * 2. **上报要节流、还要有死区**。滚动一秒能发几十次事件，而上层是写 store 的
 *    （虽然走 patchQuiet 不重渲染，也不该每秒写十次盘）；位置挪了不到 MIN_DELTA
 *    像素就当作没动——读到一半手抖一下不值得写盘。
 *
 * 恢复**只做一次**：之后再跟着 props 改，就会在用户正滚的时候被一个旧位置拽回去
 * （store 每落一次盘都会把「上次上报的位置」带回来）。
 */
const REPORT_MS = 700
/** 位置变化小于这么多像素不报 */
const MIN_DELTA = 24

export function useDocScroll(
  box: () => HTMLElement | null,
  initial: number | undefined,
  report: ((top: number) => void) | undefined,
  active: boolean,
): void {
  const restored = useRef(false)
  const lastSent = useRef<number | null>(null)
  const pending = useRef<number | null>(null)
  const timer = useRef<number | null>(null)

  /**
   * 最新的上报回调。
   *
   * 为什么必须经 ref：调用方传的是渲染体里现写的箭头函数（`(top) => …`），每一轮渲染
   * 都是新的身份。把它放进 effect 依赖，滚动监听就会**每渲染一轮**被拆掉重挂，
   * 而清理函数里还要补发一次 flush——「读着读着，每渲染一次就往 store 写一次滚动位置」
   * 就是这么来的。挂在 ref 上之后，监听只在元素或开关变化时重挂，
   * 而 flush 取到的仍是最新那一份闭包（回调的语义没变，只是取用的时机稳了）。
   */
  const reportRef = useRef(report)
  // 每轮渲染后刷新一次。不写在渲染体里：那是渲染期副作用，被丢弃的那一轮也会写进去
  useEffect(() => {
    reportRef.current = report
  })
  /** 有没有回调是「该不该挂监听」的结构条件：从无到有/从有到无时重挂一次，其余变化不重挂 */
  const hasReport = !!report

  // 恢复：第一次显示出来时做一次。等一帧再设——刚挂上时内容可能还在排版，
  // 那一刻的 scrollHeight 还不完整，设下去会被夹回一个更小的值
  useEffect(() => {
    if (restored.current || !active || !initial) return
    const el = box()
    if (!el) return
    restored.current = true
    const raf = window.requestAnimationFrame(() => {
      el.scrollTop = initial
    })
    // 排版的收尾（公式、图片、代码高亮）会再挪一次高度，补设一次更稳
    const late = window.setTimeout(() => {
      if (Math.abs(el.scrollTop - initial) > 2) el.scrollTop = initial
    }, 160)
    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(late)
    }
  }, [active, initial, box])

  // 上报：滚动停下 REPORT_MS 才发一次，且位置要挪够 MIN_DELTA
  useEffect(() => {
    if (!hasReport) return
    const el = box()
    if (!el) return
    const flush = () => {
      timer.current = null
      const top = pending.current
      pending.current = null
      if (top === null) return
      if (lastSent.current !== null && Math.abs(top - lastSent.current) < MIN_DELTA) return
      lastSent.current = top
      reportRef.current?.(top)
    }
    const onScroll = () => {
      pending.current = el.scrollTop
      if (timer.current !== null) return
      timer.current = window.setTimeout(flush, REPORT_MS)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      // 卸载 / 切走前把还没发出去的那一次补上：不补的话「读到最后一段就切走」那一下会丢
      if (timer.current !== null) window.clearTimeout(timer.current)
      flush()
    }
    // 依赖里只有「挂在哪个元素上」「这一片在不在眼前」「有没有回调」：
    // 回调的身份变化不再牵动监听的重挂（见 reportRef 的说明）
  }, [box, active, hasReport])
}
