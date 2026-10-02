/**
 * 「把光标挪进地址栏」的那个槽（Ctrl+L 的落点，见 lib/shortcuts 的 web.newTab）。
 *
 * 地址栏在 WebToolbar 里、快捷键处理器在 LearnWorkspace 里，隔了好几层 props——
 * 用模块级槽传递（与 lib/outline 的 OutlineHandle 同款手法）：工具条挂载时装上、
 * 卸载时卸下，学习区只管喊一嗓子。
 */
let slot: (() => void) | null = null

export function setAddressFocus(fn: (() => void) | null): void {
  slot = fn
}

export function focusWebAddress(): void {
  slot?.()
}
