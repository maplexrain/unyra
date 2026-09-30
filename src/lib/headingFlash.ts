/**
 * 跳转命中标题时的高亮。
 *
 * 缓动滚到位之后，视口里往往同时有两个标题（上一节的尾巴 + 接下来这一节），
 * 只靠滚动停下很难一眼看出「到的就是这一个」。所以在目标标题上播一次
 * 落笔式的高亮（笔洗扫过 + 光晕荡开 + 左缘朱条 + 轻轻上提），把视线钉过去。
 *
 * 样式写在 index.css 的 .moji-head-hit 里；这里只管什么时候加上、什么时候摘掉。
 */

const FLASH_CLASS = 'moji-head-hit'

/** 与 index.css 里动画的时长一致（1.5s） */
const FLASH_MS = 1500

/** 每个标题上待执行的「摘掉高亮」定时器：同一个标题连点两次时，旧的要先取消 */
const timers = new WeakMap<HTMLElement, number>()

export function flashHeading(el: HTMLElement | null): void {
  if (!el) return
  const pending = timers.get(el)
  if (pending !== undefined) window.clearTimeout(pending)
  el.classList.remove(FLASH_CLASS)
  // 读一次布局，把「摘掉」和「加上」分成两次样式计算：
  // 同一个标题连点两次时，动画才会重播，而不是被当成没变过而忽略
  void el.offsetWidth
  el.classList.add(FLASH_CLASS)
  timers.set(
    el,
    window.setTimeout(() => {
      timers.delete(el)
      el.classList.remove(FLASH_CLASS)
    }, FLASH_MS),
  )
}
