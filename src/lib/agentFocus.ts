/**
 * 「把光标放进导师输入框」这件事的接线。
 *
 * 触发方在别处（快捷键 Ctrl+Q 住在学习区），而那个 textarea 在对话面板里，
 * 中间隔着好几层——沿用 lib/quoteFocus / lib/docHost 那套模块级回调：
 * 面板挂载时登记，按键时调用。没有登记（面板还没挂）时静默失败。
 */
let target: (() => void) | null = null

/** 登记聚焦实现；返回清理用（传 null 注销） */
export function setAgentFocusHandler(fn: (() => void) | null): void {
  target = fn
}

/** 请求把光标放进输入框；返回是否真的有人接 */
export function focusAgentInput(): boolean {
  if (!target) return false
  target()
  return true
}
