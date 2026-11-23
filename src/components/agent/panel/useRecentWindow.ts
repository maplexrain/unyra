/**
 * 聊天列表的「最近一屏」窗口：只挂载最近 N 条，滚到顶部附近再往上补 M 条。
 *
 * 参考 Telegram / IM 的加载方式，而不是一次性把所有历史消息都塞进 DOM：
 * - 初始只渲染最近 INITIAL 条；总数少于此就全渲染（没有「加载更早」按钮）；
 * - 顶部放一条 1px 哨兵，IntersectionObserver 在离顶 120px 时触发 loadOlder；
 * - 补历史前记下 scrollHeight / scrollTop，渲染后用 scrollTop += 新增高度，
 *   视线不会因为上面插入一屏而跳走；
 * - 新消息到来时始终取尾部窗口，所以「永远显示最近的消息」。
 *
 * 这是纯展示窗口：数据仍在 store 里，搜索 / 定位 / 导出都不受切片影响。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const INITIAL = 30
const STEP = 30

export function useRecentWindow(total: number, resetKey: string) {
  const [count, setCount] = useState(INITIAL)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const anchorRef = useRef<{ el: HTMLElement; height: number; top: number } | null>(null)

  useEffect(() => {
    setCount(INITIAL)
  }, [resetKey])

  const start = Math.max(0, total - count)
  const hasOlder = start > 0

  const loadOlder = useCallback(() => {
    if (!hasOlder) return
    const el = sentinelRef.current?.closest('[data-message-scroll]')
    if (el instanceof HTMLElement) {
      anchorRef.current = { el, height: el.scrollHeight, top: el.scrollTop }
    }
    setCount((n) => Math.min(total, n + STEP))
  }, [hasOlder, total])

  // 在 DOM 长高之后补回滚动位置：先记住旧高度，再让浏览器按新高度重新布局。
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    anchorRef.current = null
    anchor.el.scrollTop = anchor.top + (anchor.el.scrollHeight - anchor.height)
  }, [count])

  useEffect(() => {
    if (!hasOlder || typeof IntersectionObserver === 'undefined') return
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const root = sentinel.closest('[data-message-scroll]')
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadOlder()
      },
      { root, rootMargin: '120px 0px 0px 0px', threshold: 0 },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [hasOlder, loadOlder, total, start])

  return { start, hasOlder, sentinelRef, loadOlder }
}
