/**
 * 实时分栏预览的**事件总线**：开关（toggle）与两列对调（swap）两条广播。
 *
 * 单独一个文件，因为这里全是函数导出——混进组件文件会触发
 * react(only-export-components)（fast refresh 只认纯组件文件）。
 * Vim :preview 命令（lib/vimCommands）、文档悬浮组的预览按钮（DocFloat）
 * 与各处快捷键都从这里喊；LiveSplitPreview 实例各自订阅，收不到广播的
 * 卸载态实例在重挂时从 localStorage 读回状态（见 LiveSplitPreview 的 loadPreviewState）。
 *
 * 广播可以**点名**（key = LiveSplitPreview 的 storageKey）：编辑器常驻化之后每一份
 * 文档的编辑器都挂在 DOM 里，「教学文档切进编辑模式自动展开分栏」这类动作只想
 * 作用于眼前那一份——点名广播只命中 storageKey 对得上的实例，别把用户在其它页签上
 * 收好的分栏状态也一起翻掉。不点名 = 全员广播（:preview 的老语义）。
 */

type PreviewToggleListener = (forceState?: boolean, key?: string) => void
const previewListeners = new Set<PreviewToggleListener>()

/** 开 / 关分栏预览（forceState 缺省 = 各实例自己翻转；key 给了 = 只命中那一份） */
export function toggleEditorPreview(forceState?: boolean, key?: string): void {
  for (const listener of previewListeners) {
    listener(forceState, key)
  }
}

export function subscribeEditorPreview(listener: PreviewToggleListener): () => void {
  previewListeners.add(listener)
  return () => {
    previewListeners.delete(listener)
  }
}

/**
 * 对调编辑与预览两列位置的广播（Vim :preview switch）：与开关广播分开一条，
 * 因为它不改变「开没开」，只翻转左右——混进开关监听的话签名与语义都要拧着写。
 */
const previewSwapListeners = new Set<() => void>()

export function swapEditorPreview(): void {
  for (const listener of previewSwapListeners) {
    listener()
  }
}

export function subscribeEditorPreviewSwap(listener: () => void): () => void {
  previewSwapListeners.add(listener)
  return () => {
    previewSwapListeners.delete(listener)
  }
}
