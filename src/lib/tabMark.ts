/**
 * 「在正文里按住右键横向划 → 页签栏上那颗棱形跟着走」这件事的接线。
 *
 * 按下与滑动发生在**文档区**（LearnWorkspace 的那一格），而棱形长在**页签栏**上（TabBar）——
 * 中间隔着 groups 的渲染层级，不能直接传值。沿用 lib/quoteFocus / lib/agentFocus 那套
 * 模块级回调：页签栏挂载时登记，文档区拖动时调用。
 *
 * 只有**焦点格**的页签栏会登记（那把守的格才是棱形该出现的地方）：分割成好几格之后，
 * 每格都有一条自己的栏，谁最后挂上谁说了算是不行的。
 *
 * 没有登记（页签栏还没挂起来）时静默失败——拖到一半页签栏被关掉，不该因此报错。
 */

let move: ((clientX: number) => void) | null = null
let reset: (() => void) | null = null

/** 登记棱形的两个动作；传 null 注销（组件卸载时用） */
export function setTabMarkHandlers(h: { move: (clientX: number) => void; reset: () => void } | null): void {
  move = h?.move ?? null
  reset = h?.reset ?? null
}

/** 拖动中：棱形跟到指针这一处（它会顺手把指针底下的页签切成当前页签） */
export function moveTabMark(clientX: number): void {
  move?.(clientX)
}

/** 松手：棱形回到当前页签正上方 */
export function resetTabMark(): void {
  reset?.()
}
