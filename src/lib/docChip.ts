/**
 * 页签 → 对话输入框的落点桥。
 *
 * 文档区的页签能被真正拖出来之后，要能「放进对话输入框」变成一枚引用；但 TabBar
 * 不认识 agent/ 层，输入框也不认识页签。输入框挂载时在这里登记一个落点（卡片元素
 * + 收下一份页签的回调），拖动层据此做悬停高亮与命中判定——与 lib/tabMark（棱形）、
 * lib/agentFocus（Ctrl+Q 聚焦）同一个套路：谁在谁登记，登记表不认识任何一方。
 */

/** 一份被拖进输入框的页签：label 是显示名，token 是发送时展开成的路径信息 */
export interface DocChipPayload {
  label: string
  token: string
}

interface DocChipTarget {
  /** 命中判定用的元素（输入卡片） */
  el: HTMLElement
  /** 悬停高亮开关（值不变时调用方的 setState 自然 bail，指针压着也不会每帧重渲染） */
  hover: (on: boolean) => void
  /** 松手收下：把这份页签变成输入框里的一枚 chip */
  receive: (doc: DocChipPayload) => void
}

let target: DocChipTarget | null = null

/** 输入框挂载时登记；传 null 注销（子会话模式下不登记——那里的输入框只读） */
export function registerDocChipTarget(t: DocChipTarget | null): void {
  if (target && target !== t) target.hover(false)
  target = t
}

/** 拖动中：指针压没压在输入框上（顺带维护悬停高亮）。x<0 表示强制熄灭 */
export function docChipHover(x: number, y: number): void {
  if (!target) return
  target.hover(x >= 0 && hits(x, y))
}

/** 松手：落点在输入框上就交给它，返回是否接住了（没接住拖动层继续走自己的落点判定） */
export function docChipDrop(x: number, y: number, doc: DocChipPayload): boolean {
  if (!target || !hits(x, y)) return false
  target.hover(false)
  target.receive(doc)
  return true
}

function hits(x: number, y: number): boolean {
  const r = target!.el.getBoundingClientRect()
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}
