import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

interface CursorMeasure {
  visible: boolean
  left: number
  top: number
  height: number
}

/**
 * 平滑移动的虚拟光标插件：
 * 在 CodeMirror 滚动容器中注入一层平滑过渡的虚拟光标（Caret），
 * 严格使用 CodeMirror 6 的 requestMeasure 机制执行排版读取与写回，
 * 绝不在 update 同步周期读取 DOM 布局（避免 "Reading the editor layout isn't allowed during an update"）。
 */
class SmoothCursorPlugin {
  readonly view: EditorView
  private cursorEl: HTMLDivElement
  private blinkTimer: number | null = null
  private lastLeft = 0
  private lastTop = 0
  private hasPosition = false

  private measureReq = {
    read: (view: EditorView): CursorMeasure => {
      const sel = view.state.selection.main
      // 选区非空（拖选文本）或非焦点时隐藏虚拟光标
      if (!view.hasFocus || !sel.empty) {
        return { visible: false, left: 0, top: 0, height: 0 }
      }

      const coords = view.coordsAtPos(sel.head)
      if (!coords) {
        return { visible: false, left: 0, top: 0, height: 0 }
      }

      const scrollerRect = view.scrollDOM.getBoundingClientRect()
      const left = coords.left - scrollerRect.left + view.scrollDOM.scrollLeft
      const top = coords.top - scrollerRect.top + view.scrollDOM.scrollTop
      const height = Math.max(14, coords.bottom - coords.top)

      return { visible: true, left, top, height }
    },
    write: (measure: CursorMeasure) => {
      if (!measure.visible) {
        this.cursorEl.style.opacity = '0'
        this.stopBlink()
        this.hasPosition = false
        return
      }

      const { left, top, height } = measure

      // 初次出现（或从无焦点恢复）时：瞬间落位，不产生跨越整个屏幕的滑动
      if (!this.hasPosition) {
        this.cursorEl.style.transition = 'none'
        this.cursorEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
        this.cursorEl.style.height = `${Math.round(height)}px`
        void this.cursorEl.offsetHeight // 强制触发同步回流以应用 transition: none
        this.cursorEl.style.transition = ''
        this.lastLeft = left
        this.lastTop = top
        this.hasPosition = true
        this.cursorEl.style.opacity = '1'
        this.resetBlink()
        return
      }

      // 若跨行大距离跳转（如点击很远位置或翻页），暂时禁用过渡避免晃眼漂移
      const dist = Math.hypot(left - this.lastLeft, top - this.lastTop)
      if (dist > 280) {
        this.cursorEl.style.transition = 'none'
        void this.cursorEl.offsetHeight
        this.cursorEl.style.transition = ''
      }

      this.lastLeft = left
      this.lastTop = top

      this.cursorEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
      this.cursorEl.style.height = `${Math.round(height)}px`
      this.cursorEl.style.opacity = '1'

      this.resetBlink()
    },
  }

  private onFocusIn = () => this.scheduleMeasure()
  private onFocusOut = () => {
    this.cursorEl.style.opacity = '0'
    this.stopBlink()
    this.hasPosition = false
  }
  private onScroll = () => this.scheduleMeasure()

  constructor(view: EditorView) {
    this.view = view

    this.cursorEl = document.createElement('div')
    this.cursorEl.className = 'cm-smooth-virtual-cursor'
    this.cursorEl.setAttribute('aria-hidden', 'true')
    this.cursorEl.style.opacity = '0'

    // 挂载至 CodeMirror 滚动容器内部
    this.view.scrollDOM.appendChild(this.cursorEl)

    this.view.dom.addEventListener('focusin', this.onFocusIn)
    this.view.dom.addEventListener('focusout', this.onFocusOut)
    this.view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })

    this.scheduleMeasure()
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.geometryChanged ||
      update.viewportChanged ||
      update.focusChanged
    ) {
      this.scheduleMeasure()
    }
  }

  private scheduleMeasure(): void {
    this.view.requestMeasure(this.measureReq)
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
    this.view.dom.removeEventListener('focusin', this.onFocusIn)
    this.view.dom.removeEventListener('focusout', this.onFocusOut)
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
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
