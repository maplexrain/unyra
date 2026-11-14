/**
 * Vim 命令大全页签的**打开通道**（agentFocus / explorerFocus 同一根模块级的线）：
 * 打开方（:vim / :cheat 命令、文档里的入口）够不着 React 组件，这里登记
 * LearnWorkspace 注入的实现，谁想开页签谁就调 openVimPage。
 *
 * （前身是 vimTutorState——闯关道场随教程功能一并删除，页签里只剩命令大全，
 * 打开通道收敛成无参的一份。）
 */

type VimPageOpener = () => void

let vimPageOpener: VimPageOpener | null = null

/** 登记页签打开器（由 useTabOpening 注入）；传 null 注销 */
export function setVimPageOpener(fn: VimPageOpener | null): void {
  vimPageOpener = fn
}

/** 打开 Vim 命令大全页签（全局一枚，从哪个入口打开都是切到它）；没人接就静默跳过 */
export function openVimPage(): void {
  vimPageOpener?.()
}
