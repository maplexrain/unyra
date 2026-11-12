import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

/**
 * 平滑移动的虚拟光标插件：
 * 在 CodeMirror 滚动容器中注入一层平滑过渡的虚拟光标（Caret），
 * 光标移动（输入、光标键、点击定位、行间跳转）时具有丝滑的位移动画。
 */
class SmoothCursorPlugin {
  readonly view: EditorView
  private cursorEl: HTMLDivElement
  private blinkTimer: number | null = null
  private lastLeft = 0
  private lastTop = 0
  private hasPosition = false

  constructor(view: EditorView) {
    this.view = view

    this.cursorEl = document.createElement('div')
    this.cursorEl.className = 'cm-smooth-virtual-cursor'
    this.cursorEl.setAttribute('aria-hidden', 'true')
    this.cursorEl.style.opacity = '0'

    // 将虚拟光标挂载至 CodeMirror 的滚动容器内部（cm-scroller）
    this.view.scrollDOM.appendChild(this.cursorEl)

    // 初始位置计算
    this.updatePosition()
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.geometryChanged ||
      update.viewportChanged ||
      update.focusChanged
    ) {
      this.updatePosition()
    }
  }

  private updatePosition(): void {
    const sel = this.view.state.selection.main
    // 选区非空（拖选文本）时，隐藏虚拟光标以避免与高亮选区干扰
    if (!this.view.hasFocus || !sel.empty) {
      this.cursorEl.style.opacity = '0'
      this.stopBlink()
      return
    }

    const coords = this.view.coordsAtPos(sel.head)
    if (!coords) {
      this.cursorEl.style.opacity = '0'
      return
    }

    const scrollerRect = this.view.scrollDOM.getBoundingClientRect()
    const left = coords.left - scrollerRect.left + this.view.scrollDOM.scrollLeft
    const top = coords.top - scrollerRect.top + this.view.scrollDOM.scrollTop
    const height = Math.max(14, coords.bottom - coords.top)

    // 若跨行大距离跳转（如点击很远位置或翻页），暂时禁用过渡动画以避免长途滑越
    if (this.hasPosition) {
      const dist = Math.hypot(left - this.lastLeft, top - this.lastTop)
      if (dist > 280) {
        this.cursorEl.style.transition = 'none'
        void this.cursorEl.offsetHeight // 触发重排使 none 生效
        this.cursorEl.style.transition = ''
      }
    }

    this.lastLeft = left
    this.lastTop = top
    this.hasPosition = true

    this.cursorEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
    this.cursorEl.style.height = `${Math.round(height)}px`
    this.cursorEl.style.opacity = '1'

    // 重置闪烁：移动中保持常亮，静止 500ms 后恢复优雅淡入淡出闪烁
    this.resetBlink()
  }

  private resetBlink(): void {
    this.stopBlink()
    this.cursorEl.classList.remove('cm-cursor-blink')
    this.blinkTimer = window.setTimeout(() => {
      if (this.view.hasFocus && this.view.state.selection.main.empty) {
        this.cursorEl.classList.add('cm-cursor-blink')
      }
    }, 500)
  }

  private stopBlink(): void {
    if (this.blinkTimer !== null) {
      window.clearTimeout(this.blinkTimer)
      this.blinkTimer = null
    }
  }

  destroy(): void {
    this.stopBlink()
    this.cursorEl.remove()
  }
}

const smoothCursorBaseTheme = EditorView.baseTheme({
  '.cm-smooth-virtual-cursor': {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '2px',
    backgroundColor: 'var(--color-seal)',
    borderRadius: '1px',
    pointerEvents: 'none',
    zIndex: 90,
    willChange: 'transform, height',
    transition: 'transform 85ms cubic-bezier(0.12, 0.9, 0.22, 1), height 65ms ease, opacity 100ms ease',
    boxShadow: '0 0 4px color-mix(in srgb, var(--color-seal) 45%, transparent)',
  },
  '@keyframes cm-virtual-cursor-pulse': {
    '0%, 100%': { opacity: 1 },
    '50%': { opacity: 0 },
  },
  '.cm-smooth-virtual-cursor.cm-cursor-blink': {
    animation: 'cm-virtual-cursor-pulse 1.06s ease-in-out infinite',
  },
  // 隐藏 CodeMirror 原生生硬突变光标，由虚拟光标接管渲染
  '.cm-cursor, .cm-dropCursor': {
    opacity: '0 !important',
  },
})

/** 导出平滑虚拟光标扩展 */
export function smoothCursor(): Extension {
  return [ViewPlugin.fromClass(SmoothCursorPlugin), smoothCursorBaseTheme]
}
