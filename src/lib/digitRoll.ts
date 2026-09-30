/**
 * 跳字动画的纯逻辑：把一串会变的文本（顶栏计时器上的时间）切成「位」，并算出这一次哪几位变了。
 *
 * 为什么单独一个纯模块：动画本身只能在浏览器里看，但「哪几位该跳」是能钉死的逻辑——
 * 钉住它就不会写出「每秒把整串字都重跳一遍」那种看起来像在闪的实现。
 *
 * 对齐方式是**从右往左**：时间串的宽度会变（59:59 → 1:00:00 时左边多一位），
 * 而从右对齐时右边那些位仍然是同一批位，只有真正变了的那几位会被算进来。
 * 返回的序号也是「从右数第几位」，渲染时按同一个序号认节点。
 */

/** 这一次变了的位（从右数，0 = 个位那一格）。新增出来的位也算变了 */
export function changedDigits(prev: string, next: string): number[] {
  const out: number[] = []
  const n = Math.max(prev.length, next.length)
  for (let k = 0; k < n; k++) {
    if (prev[prev.length - 1 - k] !== next[next.length - 1 - k]) out.push(k)
  }
  return out
}

/** 把文本切成渲染用的位：从左到右排，每一项带着它**从右数**的序号（动画靠它找节点） */
export function digitSlots(text: string): Array<{ ch: string; fromEnd: number }> {
  return [...text].map((ch, i) => ({ ch, fromEnd: text.length - 1 - i }))
}
