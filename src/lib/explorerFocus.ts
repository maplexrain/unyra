/**
 * 「切换左侧资源管理器展开 / 收起」的全局接线（与 agentFocus 同一路数）：
 *
 * 资源管理器的收起 / 展开状态（窄条 ↔ 完整栏）住在 ExplorerSidebar 内部，
 * 而调用方（Vim 冒号命令 :resources）在 lib 层、够不到组件状态——
 * 于是一根模块级的线：侧栏挂载时把「切换」动作登记进来，命令随时喊。
 */
let toggler: (() => boolean) | null = null

/** 登记切换实现（由 ExplorerSidebar 注入）；返回值 = 切换后是否展开。传 null 注销 */
export function setExplorerToggleHandler(fn: (() => boolean) | null): void {
  toggler = fn
}

/**
 * 切换资源管理器的窄条 ↔ 完整栏。
 * 返回切换后的展开与否；侧栏不在场（纯阅读等场景）返回 null——调用方好说清「没人接」。
 */
export function toggleExplorer(): boolean | null {
  return toggler ? toggler() : null
}
