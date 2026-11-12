import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

interface CursorMeasure {
  visible: boolean
  left: number
  top: number
  height: number
}

/**
 * 平滑直接平移的虚拟光标插件：
 * 1. 严格使用 CodeMirror 6 的 requestMeasure 机制执行排版读取与写回；
 * 2. 纯粹直接平移过渡（Direct Smooth Glide）：光标位移时以肉眼清晰可见的平滑轨道直接滑移至目标位置；
 * 3. 移动中保持高亮常亮，静止后恢复优雅淡入淡出呼吸闪烁；
 * 4. 彻底隐藏浏览器原生 Caret 与原生突跳光标，避免任何视觉重叠干扰。
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
      // 选区非空（用户正在选择多字）时隐藏虚拟光标，交由 drawSelection 绘制选区；选区为单点时光标立刻显现
      if (!sel.empty) {
        return { visible: false, left: 0, top: 0, height: 0 }
      }

      const coords = view.coordsAtPos(sel.head)
      if (!coords) {
        if (this.hasPosition) {
          return { visible: true, left: this.lastLeft, top: this.lastTop, height: 18 }
        }
        requestAnimationFrame(() => this.scheduleMeasure())
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
        this.cursorEl.classList.add('cm-cursor-no-transition')
        this.cursorEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
        this.cursorEl.style.height = `${Math.round(height)}px`

        this.lastLeft = left
        this.lastTop = top
        this.hasPosition = true
        this.cursorEl.style.opacity = this.view.hasFocus ? '1' : '0.45'

        this.resetBlink()
        requestAnimationFrame(() => {
          this.cursorEl.classList.remove('cm-cursor-no-transition')
        })
        return
      }

      // 无论位移距离多远（打字、点击、跨行跨段跳转），一律以肉眼清晰可见的 200ms 平滑轨道直接平移至目标位置
      this.lastLeft = left
      this.lastTop = top

      this.cursorEl.classList.remove('cm-cursor-no-transition')
      this.cursorEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
      this.cursorEl.style.height = `${Math.round(height)}px`
      this.cursorEl.style.opacity = this.view.hasFocus ? '1' : '0.45'

      // 移动中保持常亮，静止后恢复优雅淡入淡出闪烁
      this.resetBlink()
    },
  }

  private onFocusIn = () => {
    this.cursorEl.style.opacity = '1'
    this.scheduleMeasure()
  }
  private onFocusOut = (e: FocusEvent) => {
    const related = e.relatedTarget as Node | null
    if (related && this.view.dom.contains(related)) return
    // 失焦时保持幽雅半透 (0.45) 常驻，绝不隐藏，用户时刻清楚光标在哪
    this.cursorEl.style.opacity = '0.45'
    this.stopBlink()
  }
  private onScroll = () => this.scheduleMeasure()

  constructor(view: EditorView) {
    this.view = view

    // 虚拟平滑光标
    this.cursorEl = document.createElement('div')
    this.cursorEl.className = 'cm-smooth-virtual-cursor cm-cursor-no-transition'
    this.cursorEl.setAttribute('aria-hidden', 'true')
    this.cursorEl.style.opacity = '0'

    // 挂载至 CodeMirror 滚动容器内部
    this.view.scrollDOM.appendChild(this.cursorEl)

    this.view.dom.addEventListener('focusin', this.onFocusIn)
    this.view.dom.addEventListener('focusout', this.onFocusOut)
    this.view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })

    this.scheduleMeasure()
    // 布局异步完成时再次校准
    requestAnimationFrame(() => this.scheduleMeasure())
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
    }, 450)
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
  // 平滑虚拟光标：200ms 过渡时间，肉眼清晰可见直接滑移到目标位置
  '.cm-smooth-virtual-cursor': {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '2.5px',
    backgroundColor: 'var(--color-seal, #38bdf8)',
    borderRadius: '1.25px',
    pointerEvents: 'none',
    zIndex: 99,
    contain: 'layout paint style',
    willChange: 'transform, height',
    transition: 'transform 200ms cubic-bezier(0.18, 0.95, 0.25, 1), height 120ms ease, opacity 100ms ease',
    boxShadow: '0 0 8px color-mix(in srgb, var(--color-seal, #38bdf8) 70%, transparent)',
  },
  '.cm-cursor-no-transition': {
    transition: 'none !important',
  },
  '@keyframes cm-virtual-cursor-pulse': {
    '0%, 100%': { opacity: 1 },
    '50%': { opacity: 0 },
  },
  '.cm-smooth-virtual-cursor.cm-cursor-blink': {
    animation: 'cm-virtual-cursor-pulse 1.06s ease-in-out infinite',
  },
  // 彻底隐藏浏览器原生 Caret 与 CodeMirror 突变光标，由平滑虚拟光标独占渲染
  '.cm-content': {
    caretColor: 'transparent !important',
  },
  '.cm-cursor, .cm-dropCursor': {
    opacity: '0 !important',
    visibility: 'hidden !important',
  },
})

/** 导出平滑虚拟光标扩展 */
export function smoothCursor(): Extension {
  return [ViewPlugin.fromClass(SmoothCursorPlugin), smoothCursorBaseTheme]
}
