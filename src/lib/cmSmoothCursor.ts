import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

interface CursorMeasure {
  visible: boolean
  left: number
  top: number
  height: number
}

/**
 * 平滑移动与流光残影虚拟光标插件：
 * 1. 严格使用 CodeMirror 6 的 requestMeasure 机制执行排版读取与写回；
 * 2. 主光标平滑快速响应，身披跟随光带（Trail Follower）；
 * 3. 光标每次位移时在原位留下优雅消散的微光残影印记（Ghost Echo），
 *    营造媲美现代科幻编辑器的行云流水般的打字动效体验。
 */
class SmoothCursorPlugin {
  readonly view: EditorView
  private cursorEl: HTMLDivElement
  private trailEl: HTMLDivElement
  private echoPool: HTMLDivElement[] = []
  private blinkTimer: number | null = null
  private trailFadeTimer: number | null = null
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
        this.trailEl.style.opacity = '0'
        this.clearEchoes()
        this.stopBlink()
        this.hasPosition = false
        return
      }

      const { left, top, height } = measure

      // 初次出现（或从无焦点恢复）时：瞬间落位，不产生残影与跨越屏幕的滑动
      if (!this.hasPosition) {
        this.cursorEl.classList.add('cm-cursor-no-transition')
        this.trailEl.classList.add('cm-cursor-no-transition')

        this.cursorEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
        this.cursorEl.style.height = `${Math.round(height)}px`

        this.trailEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
        this.trailEl.style.height = `${Math.round(height)}px`

        this.lastLeft = left
        this.lastTop = top
        this.hasPosition = true
        this.cursorEl.style.opacity = '1'
        this.trailEl.style.opacity = '0'

        this.resetBlink()
        requestAnimationFrame(() => {
          this.cursorEl.classList.remove('cm-cursor-no-transition')
          this.trailEl.classList.remove('cm-cursor-no-transition')
        })
        return
      }

      const dist = Math.hypot(left - this.lastLeft, top - this.lastTop)
      const lineDist = Math.abs(top - this.lastTop)

      // 若跨多行大距离跳转（如点击很远位置或翻页），暂时禁用过渡与残影避免晃眼漂移
      if (dist > 220 || lineDist > 45) {
        this.cursorEl.classList.add('cm-cursor-no-transition')
        this.trailEl.classList.add('cm-cursor-no-transition')

        this.cursorEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
        this.cursorEl.style.height = `${Math.round(height)}px`

        this.trailEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
        this.trailEl.style.height = `${Math.round(height)}px`

        this.lastLeft = left
        this.lastTop = top
        this.cursorEl.style.opacity = '1'
        this.trailEl.style.opacity = '0'

        this.resetBlink()
        requestAnimationFrame(() => {
          this.cursorEl.classList.remove('cm-cursor-no-transition')
          this.trailEl.classList.remove('cm-cursor-no-transition')
        })
        return
      }

      // 如果发生了有效位移，在起始旧位置产生一抹消散残影印记（Ghost Echo）
      if (dist >= 3) {
        this.spawnGhostEcho(this.lastLeft, this.lastTop, height)
      }

      // 更新主光标位置（快速响应，率先到达）
      this.cursorEl.classList.remove('cm-cursor-no-transition')
      this.cursorEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
      this.cursorEl.style.height = `${Math.round(height)}px`
      this.cursorEl.style.opacity = '1'

      // 更新跟随残影层位置（滞后插值跟随，拉出流光尾迹）
      this.trailEl.classList.remove('cm-cursor-no-transition')
      this.trailEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
      this.trailEl.style.height = `${Math.round(height)}px`
      this.trailEl.style.opacity = '0.55'

      // 移动停止后淡出跟随残影层
      if (this.trailFadeTimer !== null) window.clearTimeout(this.trailFadeTimer)
      this.trailFadeTimer = window.setTimeout(() => {
        this.trailEl.style.opacity = '0'
      }, 160)

      this.lastLeft = left
      this.lastTop = top

      this.resetBlink()
    },
  }

  private onFocusIn = () => this.scheduleMeasure()
  private onFocusOut = () => {
    this.cursorEl.style.opacity = '0'
    this.trailEl.style.opacity = '0'
    this.clearEchoes()
    this.stopBlink()
    this.hasPosition = false
  }
  private onScroll = () => this.scheduleMeasure()

  constructor(view: EditorView) {
    this.view = view

    // 跟随残影光标（在底层）
    this.trailEl = document.createElement('div')
    this.trailEl.className = 'cm-smooth-cursor-trail cm-cursor-no-transition'
    this.trailEl.setAttribute('aria-hidden', 'true')
    this.trailEl.style.opacity = '0'

    // 主光标（在顶层）
    this.cursorEl = document.createElement('div')
    this.cursorEl.className = 'cm-smooth-virtual-cursor cm-cursor-no-transition'
    this.cursorEl.setAttribute('aria-hidden', 'true')
    this.cursorEl.style.opacity = '0'

    // 挂载至 CodeMirror 滚动容器内部
    this.view.scrollDOM.appendChild(this.trailEl)
    this.view.scrollDOM.appendChild(this.cursorEl)

    this.view.dom.addEventListener('focusin', this.onFocusIn)
    this.view.dom.addEventListener('focusout', this.onFocusOut)
    this.view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })

    this.scheduleMeasure()
  }

  /** 在旧位置生成一枚短命的消散残影印记 */
  private spawnGhostEcho(x: number, y: number, height: number): void {
    // 限制同时存在的残影数量不超过 4 个，保证极致性能
    if (this.echoPool.length >= 4) {
      const oldest = this.echoPool.shift()
      oldest?.remove()
    }

    const echo = document.createElement('div')
    echo.className = 'cm-smooth-cursor-echo'
    echo.setAttribute('aria-hidden', 'true')
    echo.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
    echo.style.height = `${Math.round(height)}px`

    this.view.scrollDOM.appendChild(echo)
    this.echoPool.push(echo)

    // 动画播完（180ms）自动移除
    window.setTimeout(() => {
      echo.remove()
      const idx = this.echoPool.indexOf(echo)
      if (idx !== -1) this.echoPool.splice(idx, 1)
    }, 180)
  }

  private clearEchoes(): void {
    for (const echo of this.echoPool) {
      echo.remove()
    }
    this.echoPool = []
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
    if (this.trailFadeTimer !== null) {
      window.clearTimeout(this.trailFadeTimer)
      this.trailFadeTimer = null
    }
    this.clearEchoes()
    this.view.dom.removeEventListener('focusin', this.onFocusIn)
    this.view.dom.removeEventListener('focusout', this.onFocusOut)
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
    this.cursorEl.remove()
    this.trailEl.remove()
  }
}

const smoothCursorBaseTheme = EditorView.baseTheme({
  // 主虚拟光标：响应迅速、鲜亮纯净
  '.cm-smooth-virtual-cursor': {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '2px',
    backgroundColor: 'var(--color-seal)',
    borderRadius: '1px',
    pointerEvents: 'none',
    zIndex: 99,
    contain: 'layout paint style',
    willChange: 'transform, height',
    transition: 'transform 95ms cubic-bezier(0.16, 1, 0.3, 1), height 80ms ease, opacity 90ms ease',
    boxShadow: '0 0 5px color-mix(in srgb, var(--color-seal) 50%, transparent)',
  },
  // 跟随残影光带（Follower Trail）：稍带滞后感，拖出水银流光
  '.cm-smooth-cursor-trail': {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '3.5px',
    backgroundColor: 'color-mix(in srgb, var(--color-seal) 55%, transparent)',
    borderRadius: '1.5px',
    pointerEvents: 'none',
    zIndex: 98,
    contain: 'layout paint style',
    willChange: 'transform, height, opacity',
    transition: 'transform 165ms cubic-bezier(0.12, 0.85, 0.25, 1), height 80ms ease, opacity 140ms ease',
    boxShadow: '0 0 8px color-mix(in srgb, var(--color-seal) 60%, transparent)',
  },
  // 位移原位消散残影印记（Ghost Echo）：在起点原地优雅扩散渐隐
  '.cm-smooth-cursor-echo': {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '2.5px',
    backgroundColor: 'color-mix(in srgb, var(--color-seal) 50%, transparent)',
    borderRadius: '1px',
    pointerEvents: 'none',
    zIndex: 97,
    contain: 'layout paint style',
    boxShadow: '0 0 6px color-mix(in srgb, var(--color-seal) 45%, transparent)',
    animation: 'cm-ghost-echo-dissolve 180ms cubic-bezier(0.2, 0.8, 0.25, 1) forwards',
  },
  '@keyframes cm-ghost-echo-dissolve': {
    '0%': {
      opacity: 0.65,
      transform: 'scaleX(1)',
    },
    '100%': {
      opacity: 0,
      transform: 'scaleX(1.8)',
    },
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

/** 导出平滑虚拟光标与残影扩展 */
export function smoothCursor(): Extension {
  return [ViewPlugin.fromClass(SmoothCursorPlugin), smoothCursorBaseTheme]
}
