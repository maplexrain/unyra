import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

interface CursorMeasure {
  visible: boolean
  left: number
  top: number
  height: number
  width: number
  isBlock: boolean
}

/**
 * 权威侦测当前是否处于 Vim 宽方块光标模式：
 * 优先以 Vim 状态机的权威状态为准，彻底杜绝 DOM 异步节点残留导致的模式识别滞后
 */
export function checkIsBlockCursor(view: EditorView): boolean {
  const cm = (view as any).cm
  if (cm?.state?.vim) {
    // Vim 处于 Insert 模式且未开启 Overwrite 替换模式时，权威判定为细竖线光标
    if (cm.state.vim.insertMode && !cm.state.overwrite) {
      return false
    }
    // Vim 处于 Normal / Visual / Replace 模式时为方块宽光标
    return true
  }
  // 未启用 Vim 时的后备探测
  const fatCursor = view.dom.querySelector('.cm-fat-cursor') as HTMLElement | null
  return Boolean(
    fatCursor ||
    (view.scrollDOM.classList.contains('cm-vimMode') && !view.dom.querySelector('.cm-cursor'))
  )
}

/**
 * 平滑直接平移与速度线残影虚拟光标插件：
 * 1. 严格使用 CodeMirror 6 的 requestMeasure 机制执行排版读取与写回；
 * 2. 主光标平滑快速响应，身披紧随其后的流光拖尾（Trail Follower）；
 * 3. 光标位移时实时激发高能速度线（Speed Lines）贯穿位移轨迹，配合起点消散残影（Ghost Echo），
 *    营造极具动漫冲刺与速度感的光影打字体验；
 * 4. 彻底隐藏浏览器原生 Caret 与原生突跳光标，避免任何视觉重叠干扰。
 */
class SmoothCursorPlugin {
  readonly view: EditorView
  private cursorEl: HTMLDivElement
  private trailEl: HTMLDivElement
  private effectPool: HTMLDivElement[] = []
  private blinkTimer: number | null = null
  private trailTimer: number | null = null
  private boundCm: any = null
  private lastLeft = 0
  private lastTop = 0
  private lastHeight = 18
  private lastWidth = 2.5
  private lastIsBlock = false
  private hasPosition = false

  private onVimModeChange = (ev?: { mode?: string; subMode?: string }) => {
    // 收到 Vim 模式切换事件时，立即在第 0 毫秒同步更新光标 DOM 形态，彻底杜绝切换滞后感
    if (ev?.mode === 'insert') {
      this.cursorEl.classList.remove('cm-cursor-block')
      this.cursorEl.style.width = '2.5px'
      this.trailEl.style.opacity = '0'
      this.lastIsBlock = false
    } else if (ev?.mode === 'normal' || ev?.mode === 'visual' || ev?.mode === 'replace') {
      this.cursorEl.classList.add('cm-cursor-block')
      this.lastIsBlock = true
    }
    this.scheduleMeasure()
    queueMicrotask(() => this.scheduleMeasure())
  }

  private ensureVimListener(): void {
    const cm = (this.view as any).cm
    if (cm && cm !== this.boundCm && typeof cm.on === 'function') {
      this.cleanupVimListener()
      this.boundCm = cm
      try {
        cm.on('vim-mode-change', this.onVimModeChange)
        cm.on('vim-command-done', this.onVimModeChange)
      } catch {
        // 安全容错
      }
    }
  }

  private cleanupVimListener(): void {
    if (this.boundCm && typeof this.boundCm.off === 'function') {
      try {
        this.boundCm.off('vim-mode-change', this.onVimModeChange)
        this.boundCm.off('vim-command-done', this.onVimModeChange)
      } catch {
        // 安全容错
      }
      this.boundCm = null
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.ensureVimListener()
    const k = e.key
    // 当按下 Vim 常见的模式切换按键时，立即在按键发生的最前端完成形态切换与快速排定
    if (
      k === 'i' ||
      k === 'I' ||
      k === 'a' ||
      k === 'A' ||
      k === 'o' ||
      k === 'O' ||
      k === 's' ||
      k === 'S' ||
      k === 'c' ||
      k === 'C'
    ) {
      const cm = (this.view as any).cm
      if (cm?.state?.vim && !cm.state.vim.insertMode) {
        this.cursorEl.classList.remove('cm-cursor-block')
        this.cursorEl.style.width = '2.5px'
        this.trailEl.style.opacity = '0'
        this.lastIsBlock = false
      }
      queueMicrotask(() => this.scheduleMeasure())
      requestAnimationFrame(() => this.scheduleMeasure())
    } else if (k === 'Escape') {
      const cm = (this.view as any).cm
      if (cm?.state?.vim && cm.state.vim.insertMode) {
        this.cursorEl.classList.add('cm-cursor-block')
        this.lastIsBlock = true
      }
      queueMicrotask(() => this.scheduleMeasure())
      requestAnimationFrame(() => this.scheduleMeasure())
    }
  }

  private measureReq = {
    read: (view: EditorView): CursorMeasure => {
      const sel = view.state.selection.main
      // 无论是单点光标还是多字选区（鼠标拖拽、Shift 扩选、Vim Visual 模式），
      // 虚拟光标始终紧跟活动端点（sel.head）进行精准定位、形态适配与平滑位移
      this.ensureVimListener()
      const isBlock = checkIsBlockCursor(view)

      const coords = view.coordsAtPos(sel.head)
      if (!coords) {
        if (this.hasPosition) {
          return {
            visible: true,
            left: this.lastLeft,
            top: this.lastTop,
            height: this.lastHeight,
            width: this.lastWidth,
            isBlock: this.lastIsBlock,
          }
        }
        requestAnimationFrame(() => this.scheduleMeasure())
        return { visible: false, left: 0, top: 0, height: 0, width: 2.5, isBlock: false }
      }

      const scrollerRect = view.scrollDOM.getBoundingClientRect()
      const left = coords.left - scrollerRect.left + view.scrollDOM.scrollLeft
      const top = coords.top - scrollerRect.top + view.scrollDOM.scrollTop
      const height = Math.max(14, coords.bottom - coords.top)

      let width = 2.5
      if (isBlock) {
        const fatCursor = view.dom.querySelector('.cm-fat-cursor') as HTMLElement | null
        if (fatCursor && fatCursor.offsetWidth > 4) {
          width = fatCursor.offsetWidth
        } else if (sel.head < view.state.doc.length) {
          const nextCoords = view.coordsAtPos(sel.head + 1)
          if (nextCoords && nextCoords.left > coords.left) {
            width = Math.max(8, nextCoords.left - coords.left)
          } else {
            const char = view.state.doc.sliceString(sel.head, sel.head + 1)
            width = /[\u4e00-\u9fa5\u3000-\u303f\uff01-\uff5e]/.test(char) ? 16 : 9.5
          }
        } else {
          width = 9.5
        }
      }

      return { visible: true, left, top, height, width, isBlock }
    },
    write: (measure: CursorMeasure) => {
      if (!measure.visible) {
        this.cursorEl.style.opacity = '0'
        this.trailEl.style.opacity = '0'
        this.clearEffects()
        this.stopBlink()
        this.hasPosition = false
        return
      }

      const { left, top, height, width, isBlock } = measure
      this.lastHeight = height
      this.lastWidth = width
      this.lastIsBlock = isBlock

      // 初次出现（或从无焦点恢复）时：瞬间落位，不产生跨越整个屏幕的滑动与速度线
      if (!this.hasPosition) {
        this.cursorEl.classList.add('cm-cursor-no-transition')
        this.trailEl.classList.add('cm-cursor-no-transition')

        this.cursorEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
        this.cursorEl.style.height = `${Math.round(height)}px`
        this.cursorEl.style.width = `${Math.round(width)}px`
        this.cursorEl.classList.toggle('cm-cursor-block', isBlock)

        this.trailEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
        this.trailEl.style.height = `${Math.round(height)}px`
        this.trailEl.style.width = `${Math.round(width)}px`
        this.trailEl.classList.toggle('cm-cursor-block', isBlock)

        this.lastLeft = left
        this.lastTop = top
        this.hasPosition = true
        this.cursorEl.style.opacity = this.view.hasFocus ? '1' : '0.45'
        this.trailEl.style.opacity = '0'

        this.resetBlink()
        requestAnimationFrame(() => {
          this.cursorEl.classList.remove('cm-cursor-no-transition')
          this.trailEl.classList.remove('cm-cursor-no-transition')
        })
        return
      }

      const dx = left - this.lastLeft
      const dy = top - this.lastTop
      const dist = Math.hypot(dx, dy)

      // 当产生有效位移时：触发精准对齐位移轨迹的速度线（Speed Lines）
      if (dist >= 4 && this.view.hasFocus) {
        this.spawnSpeedEffects(this.lastLeft, this.lastTop, left, top, height, dx, dy, dist)
      }

      // 无论位移距离多远（打字、点击、跨行跨段跳转、Vim 快捷键），主光标与跟随光带一律平滑滑移
      this.lastLeft = left
      this.lastTop = top

      this.cursorEl.classList.remove('cm-cursor-no-transition')
      this.cursorEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
      this.cursorEl.style.height = `${Math.round(height)}px`
      this.cursorEl.style.width = `${Math.round(width)}px`
      this.cursorEl.classList.toggle('cm-cursor-block', isBlock)
      this.cursorEl.style.opacity = this.view.hasFocus ? '1' : '0.45'

      // 拖尾光带（稍微滞后且宽度匹配，形成流动光弧拖尾）
      this.trailEl.classList.remove('cm-cursor-no-transition')
      this.trailEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
      this.trailEl.style.height = `${Math.round(height)}px`
      this.trailEl.style.width = `${Math.round(width)}px`
      this.trailEl.classList.toggle('cm-cursor-block', isBlock)
      // 在 Insert 模式或无明显位移的模式切换时，拖尾立即归零，保持细光标清爽纯净；方块模式位移时赋予清晰饱满的尾翼流光
      this.trailEl.style.opacity =
        this.view.hasFocus && dist >= 4 ? (isBlock ? '0.78' : '0.7') : '0'

      if (this.trailTimer !== null) window.clearTimeout(this.trailTimer)
      this.trailTimer = window.setTimeout(() => {
        this.trailEl.style.opacity = '0'
      }, 260)

      // 移动中保持常亮，静止后恢复优雅淡入淡出闪烁
      this.resetBlink()
    },
  }

  /** 生成精确对齐位移轨迹的高能速度线（Speed Line） */
  private spawnSpeedEffects(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    height: number,
    _dx: number,
    _dy: number,
    dist: number,
  ): void {
    // 限制池大小不超过 8 个元素，防爆防积压
    if (this.effectPool.length >= 8) {
      const oldest = this.effectPool.shift()
      oldest?.remove()
    }

    // 精确以光标垂直中心作为速度线起点与终点
    const centerY0 = y0 + height / 2 - 1
    const centerY1 = y1 + height / 2 - 1
    const lineDx = x1 - x0
    const lineDy = centerY1 - centerY0
    const lineDist = Math.hypot(lineDx, lineDy)
    const angle = (Math.atan2(lineDy, lineDx) * 180) / Math.PI

    // 1. 速度线外层容器：专门负责精准坐标 translate3d 与 rotate 定位，不运行 keyframe transform，绝不被冲刷丢失坐标
    const speedLine = document.createElement('div')
    speedLine.className = 'cm-smooth-speed-line'
    speedLine.setAttribute('aria-hidden', 'true')
    speedLine.style.width = `${Math.max(8, Math.round(lineDist))}px`
    speedLine.style.transform = `translate3d(${Math.round(x0)}px, ${Math.round(centerY0)}px, 0) rotate(${angle}deg)`

    // 2. 内部主流光射线：在容器坐标系内沿 X 轴高速冲刺并消散
    const streak = document.createElement('div')
    streak.className = 'cm-smooth-speed-line-streak'
    speedLine.appendChild(streak)

    // 3. 当位移跨度较大（如跨词跳转或点击）时，追加一根平行的次级流光细线，营造动漫级速度线层次
    if (dist >= 32) {
      const subStreak = document.createElement('div')
      subStreak.className = 'cm-smooth-speed-line-streak cm-smooth-speed-substreak'
      speedLine.appendChild(subStreak)
    }

    this.view.scrollDOM.appendChild(speedLine)
    this.effectPool.push(speedLine)

    const cleanup = () => {
      speedLine.remove()
      const idx = this.effectPool.indexOf(speedLine)
      if (idx !== -1) this.effectPool.splice(idx, 1)
    }

    streak.addEventListener('animationend', cleanup, { once: true })
    window.setTimeout(cleanup, 220)
  }

  private clearEffects(): void {
    for (const el of this.effectPool) {
      el.remove()
    }
    this.effectPool = []
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
    this.trailEl.style.opacity = '0'
    this.clearEffects()
    this.stopBlink()
  }
  private onScroll = () => this.scheduleMeasure()

  constructor(view: EditorView) {
    this.view = view

    // 1. 跟随残影光带（略宽于主光标，滞后跟随形成速度流光）
    this.trailEl = document.createElement('div')
    this.trailEl.className = 'cm-smooth-cursor-trail cm-cursor-no-transition'
    this.trailEl.setAttribute('aria-hidden', 'true')
    this.trailEl.style.opacity = '0'
    this.view.scrollDOM.appendChild(this.trailEl)

    // 2. 主虚拟平滑光标
    this.cursorEl = document.createElement('div')
    this.cursorEl.className = 'cm-smooth-virtual-cursor cm-cursor-no-transition'
    this.cursorEl.setAttribute('aria-hidden', 'true')
    this.cursorEl.style.opacity = '0'
    this.view.scrollDOM.appendChild(this.cursorEl)

    this.view.dom.addEventListener('focusin', this.onFocusIn)
    this.view.dom.addEventListener('focusout', this.onFocusOut)
    this.view.dom.addEventListener('keydown', this.onKeyDown, { capture: true })
    this.view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })

    this.ensureVimListener()
    this.scheduleMeasure()
    // 布局异步完成时再次校准
    requestAnimationFrame(() => this.scheduleMeasure())
  }

  update(update: ViewUpdate): void {
    this.ensureVimListener()
    const curIsBlock = checkIsBlockCursor(this.view)
    if (
      update.docChanged ||
      update.selectionSet ||
      update.geometryChanged ||
      update.viewportChanged ||
      update.focusChanged ||
      curIsBlock !== this.lastIsBlock
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
    if (this.trailTimer !== null) {
      window.clearTimeout(this.trailTimer)
      this.trailTimer = null
    }
    this.clearEffects()
    this.cleanupVimListener()
    this.view.dom.removeEventListener('focusin', this.onFocusIn)
    this.view.dom.removeEventListener('focusout', this.onFocusOut)
    this.view.dom.removeEventListener('keydown', this.onKeyDown, { capture: true })
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
    this.cursorEl.remove()
    this.trailEl.remove()
  }
}

const smoothCursorBaseTheme = EditorView.baseTheme({
  // 速度线容器：纯负责绝对定位与角度旋转，不带 keyframe transform，绝不被动画冲刷坐标
  '.cm-smooth-speed-line': {
    position: 'absolute',
    top: 0,
    left: 0,
    height: '2px',
    pointerEvents: 'none',
    zIndex: 96,
    transformOrigin: '0 50%',
    contain: 'layout paint style',
    willChange: 'transform',
  },
  // 主速度线流光：在容器坐标系内沿 X 轴高速冲刺并消散，营造强烈的速度感与位移惯性
  '.cm-smooth-speed-line-streak': {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    borderRadius: '1px',
    transformOrigin: '0 50%',
    background:
      'linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--color-seal, #38bdf8) 60%, transparent) 25%, var(--color-seal, #38bdf8) 85%, #ffffff 100%)',
    boxShadow:
      '0 0 6px var(--color-seal, #38bdf8), 0 0 10px color-mix(in srgb, var(--color-seal, #38bdf8) 70%, transparent)',
    animation: 'cm-speed-line-streak 190ms cubic-bezier(0.12, 0.9, 0.25, 1) forwards',
  },
  // 次级速度线：轻微向上偏移 3px，更细更透，营造动漫级速度线爆发感
  '.cm-smooth-speed-substreak': {
    top: '-3px',
    height: '1px',
    opacity: '0.6',
    background:
      'linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--color-seal, #38bdf8) 40%, transparent) 30%, var(--color-seal, #38bdf8) 90%)',
    animation: 'cm-speed-line-streak 170ms cubic-bezier(0.12, 0.9, 0.25, 1) forwards',
  },
  '@keyframes cm-speed-line-streak': {
    '0%': {
      opacity: '0.95',
      transform: 'scaleX(0.15)',
    },
    '30%': {
      opacity: '1',
      transform: 'scaleX(1)',
    },
    '100%': {
      opacity: '0',
      transform: 'scaleX(1.04)',
    },
  },
  // 跟随残影光带（Follower Trail）：略带滞后感，在位移过程中拖出水银般的流光速度感，形态切换极速响应（70ms）
  '.cm-smooth-cursor-trail': {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '3px',
    backgroundColor: 'color-mix(in srgb, var(--color-seal, #38bdf8) 50%, transparent)',
    borderRadius: '1.5px',
    pointerEvents: 'none',
    zIndex: 98,
    contain: 'layout paint style',
    willChange: 'transform, height, width, opacity',
    transition:
      'transform 240ms cubic-bezier(0.12, 0.85, 0.22, 1), width 70ms ease, border-radius 70ms ease, height 120ms ease, opacity 140ms ease',
    boxShadow: '0 0 8px color-mix(in srgb, var(--color-seal, #38bdf8) 60%, transparent)',
  },
  // 宽方块模式拖尾：与主宽光标等宽，呈现高质量的宽方块流光位移残影
  '.cm-smooth-cursor-trail.cm-cursor-block': {
    backgroundColor: 'color-mix(in srgb, var(--color-seal, #38bdf8) 65%, transparent)',
    borderRadius: '2px',
    boxShadow: '0 0 14px color-mix(in srgb, var(--color-seal, #38bdf8) 70%, transparent)',
  },
  // 主虚拟平滑光标：位移平滑直接平移，形态（宽/细）切换极速利落响应（70ms）
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
    willChange: 'transform, height, width',
    transition:
      'transform 200ms cubic-bezier(0.18, 0.95, 0.25, 1), width 70ms ease, border-radius 70ms ease, height 120ms ease, opacity 100ms ease',
    boxShadow: '0 0 8px color-mix(in srgb, var(--color-seal, #38bdf8) 70%, transparent)',
  },
  // Vim 宽方块主光标：覆盖目标字符，圆角 2px，带高能微光阴影
  '.cm-smooth-virtual-cursor.cm-cursor-block': {
    backgroundColor: 'color-mix(in srgb, var(--color-seal, #38bdf8) 75%, transparent)',
    borderRadius: '2px',
    boxShadow: '0 0 10px color-mix(in srgb, var(--color-seal, #38bdf8) 60%, transparent)',
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
  // 彻底隐藏浏览器原生 Caret、CodeMirror 突变光标与 Vim 静态 fat-cursor，由平滑虚拟光标独占渲染，彻底消除双光标冲突
  '.cm-content': {
    caretColor: 'transparent !important',
  },
  '.cm-cursor, .cm-dropCursor': {
    opacity: '0 !important',
    visibility: 'hidden !important',
  },
  '.cm-fat-cursor': {
    opacity: '0 !important',
    background: 'transparent !important',
    border: 'none !important',
    outline: 'none !important',
    boxShadow: 'none !important',
    color: 'transparent !important',
    pointerEvents: 'none !important',
  },
})

/** 导出平滑虚拟光标扩展 */
export function smoothCursor(): Extension {
  return [ViewPlugin.fromClass(SmoothCursorPlugin), smoothCursorBaseTheme]
}
