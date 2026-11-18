/**
 * vimSelectionPreserve: 在唤起全局 Vim 命令行或模态浮层时保持正文选区视觉高亮。
 *
 * 解决浏览器核心问题：
 * 当焦点进入全局命令行输入框后，原生 window.getSelection() / ::selection 样式
 * 会因容器失焦而被浏览器隐藏或折叠；
 * 配合 CSS Custom Highlight API 与 DOM 矩形叠加层，确保在整个命令输入期间
 * 选中文本的高亮样式 100% 保持可见。
 */

let overlayContainer: HTMLElement | null = null

export function preserveCurrentSelection(): void {
  if (typeof window === 'undefined') return

  document.documentElement.setAttribute('data-vim-command-open', 'true')

  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
    return
  }

  const range = sel.getRangeAt(0)

  // 1. 现代化方案：使用 CSS Custom Highlight API
  try {
    const cssGlobal = window.CSS as unknown as { highlights?: Map<string, any> }
    const HighlightConstructor = (window as unknown as { Highlight?: new (...args: any[]) => any }).Highlight
    if (cssGlobal?.highlights && HighlightConstructor) {
      cssGlobal.highlights.set('vim-selection', new HighlightConstructor(range))
    }
  } catch {}

  // 2. 视觉叠加层（保障在所有平台与容器失焦时均具备荧光背景）
  try {
    const rects = Array.from(range.getClientRects())
    if (rects.length > 0) {
      if (!overlayContainer) {
        overlayContainer = document.createElement('div')
        overlayContainer.id = 'vim-selection-overlay'
        overlayContainer.className = 'pointer-events-none fixed inset-0 z-[9990] overflow-hidden'
        document.body.appendChild(overlayContainer)
      }
      overlayContainer.innerHTML = ''

      rects.forEach((r) => {
        if (r.width <= 0 || r.height <= 0) return
        const box = document.createElement('div')
        box.className =
          'absolute rounded-[2px] bg-amber-400/35 dark:bg-amber-400/30 mix-blend-multiply dark:mix-blend-screen transition-opacity duration-150'
        box.style.left = `${r.left}px`
        box.style.top = `${r.top}px`
        box.style.width = `${r.width}px`
        box.style.height = `${r.height}px`
        overlayContainer?.appendChild(box)
      })
    }
  } catch {}
}

export function restoreOrClearPreservedSelection(): void {
  if (typeof window === 'undefined') return

  document.documentElement.removeAttribute('data-vim-command-open')

  try {
    const cssGlobal = window.CSS as unknown as { highlights?: Map<string, any> }
    cssGlobal?.highlights?.delete('vim-selection')
  } catch {}

  if (overlayContainer) {
    overlayContainer.remove()
    overlayContainer = null
  }
}
