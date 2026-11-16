import { docScrollElement, visibleDocBody } from '../../../lib/docDom'

interface CursorMeasure {
  visible: boolean
  left: number
  top: number
  width: number
  height: number
}

/**
 * 浏览模式下的 Vim 平滑虚拟光标与速度线拖尾控制器：
 * 1. 主光标平滑快速响应（200ms cubic-bezier），身披紧随其后的流光拖尾（240ms cubic-bezier）；
 * 2. 移动过程中暂停脉冲闪烁保持常亮，静止 450ms 后恢复优雅淡入淡出闪烁；
 * 3. 产生有效位移（dist >= 4）时实时激发高能速度线（Speed Lines）贯穿位移轨迹；
 * 4. 挂载于正文滚动容器内部，随内容自然滚动，零抖动零漂移。
 */
export class BrowseSmoothCursor {
  private cursorEl: HTMLDivElement | null = null
  private trailEl: HTMLDivElement | null = null
  private effectPool: HTMLDivElement[] = []
  private currentContainer: HTMLElement | null = null
  private blinkTimer: number | null = null
  private trailTimer: number | null = null
  private lastLeft = 0
  private lastTop = 0
  private hasPosition = false

  private ensureContainer(container: HTMLElement): void {
    if (this.currentContainer === container && this.cursorEl && this.trailEl) {
      return
    }

    this.destroy()
    this.currentContainer = container

    if (typeof window !== 'undefined' && container instanceof HTMLElement) {
      const s = window.getComputedStyle(container)
      if (s.position === 'static') {
        container.style.position = 'relative'
      }
    }

    // 1. 跟随残影光带（略带滞后感，在位移过程中拖出速度流光）
    const trail = document.createElement('div')
    trail.className = 'moji-browse-cursor-trail moji-browse-cursor-no-transition'
    trail.setAttribute('aria-hidden', 'true')
    trail.style.opacity = '0'
    container.appendChild(trail)
    this.trailEl = trail

    // 2. 主虚拟平滑光标
    const cursor = document.createElement('div')
    cursor.className = 'moji-browse-virtual-cursor moji-browse-cursor-no-transition'
    cursor.setAttribute('aria-hidden', 'true')
    cursor.style.opacity = '0'
    container.appendChild(cursor)
    this.cursorEl = cursor

    this.hasPosition = false
  }

  private stopBlink(): void {
    if (this.blinkTimer !== null) {
      window.clearTimeout(this.blinkTimer)
      this.blinkTimer = null
    }
  }

  private resetBlink(): void {
    this.stopBlink()
    this.cursorEl?.classList.remove('moji-browse-cursor-blink')
    this.blinkTimer = window.setTimeout(() => {
      this.cursorEl?.classList.add('moji-browse-cursor-blink')
    }, 450)
  }

  private spawnSpeedEffects(
    container: HTMLElement,
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

    const centerY0 = y0 + height / 2 - 1
    const centerY1 = y1 + height / 2 - 1
    const lineDx = x1 - x0
    const lineDy = centerY1 - centerY0
    const lineDist = Math.hypot(lineDx, lineDy)
    const angle = (Math.atan2(lineDy, lineDx) * 180) / Math.PI

    // 速度线容器：纯负责绝对定位与角度旋转
    const speedLine = document.createElement('div')
    speedLine.className = 'moji-browse-speed-line'
    speedLine.setAttribute('aria-hidden', 'true')
    speedLine.style.width = `${Math.max(8, Math.round(lineDist))}px`
    speedLine.style.transform = `translate3d(${Math.round(x0)}px, ${Math.round(centerY0)}px, 0) rotate(${angle}deg)`

    // 主射线流光
    const streak = document.createElement('div')
    streak.className = 'moji-browse-speed-streak'
    speedLine.appendChild(streak)

    // 大跨度跳跃时追加次级流光细线
    if (dist >= 32) {
      const subStreak = document.createElement('div')
      subStreak.className = 'moji-browse-speed-streak moji-browse-speed-substreak'
      speedLine.appendChild(subStreak)
    }

    container.appendChild(speedLine)
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

  private measureSelection(sel: Selection, body: HTMLElement, container: HTMLElement): CursorMeasure {
    if (sel.rangeCount === 0 || !sel.anchorNode || !body.contains(sel.anchorNode)) {
      return { visible: false, left: 0, top: 0, width: 0, height: 0 }
    }

    try {
      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      const boxRect = container.getBoundingClientRect()

      let left = rect.left - boxRect.left + container.scrollLeft
      let top = rect.top - boxRect.top + container.scrollTop
      let height = rect.height
      let width = 9.5

      // 尝试根据当前字符宽度精准自适应方块光标
      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        const textNode = range.startContainer as Text
        const offset = range.startOffset
        if (offset < (textNode.textContent?.length || 0)) {
          const charRange = document.createRange()
          charRange.setStart(textNode, offset)
          charRange.setEnd(textNode, offset + 1)
          const charRect = charRange.getBoundingClientRect()
          if (charRect && charRect.height > 0) {
            left = charRect.left - boxRect.left + container.scrollLeft
            top = charRect.top - boxRect.top + container.scrollTop
            height = charRect.height
            width = Math.max(7, Math.round(charRect.width))
          }
        }
      }

      if (height <= 0) {
        const parent = sel.focusNode instanceof HTMLElement ? sel.focusNode : sel.focusNode?.parentElement
        if (parent) {
          const pRect = parent.getBoundingClientRect()
          if (pRect.height > 0) {
            left = pRect.left - boxRect.left + container.scrollLeft
            top = pRect.top - boxRect.top + container.scrollTop
            height = Math.min(24, Math.max(16, pRect.height))
          }
        }
      }

      height = Math.max(16, Math.round(height))
      width = Math.max(8, Math.round(width))
      return { visible: true, left, top, width, height }
    } catch {
      return { visible: false, left: 0, top: 0, width: 0, height: 0 }
    }
  }

  /**
   * 更新虚拟光标位置与拖尾形态
   * @param sel 当前视窗选区
   * @param isVisual 当前是否处于可视选择模式
   */
  update(sel: Selection | null, isVisual: boolean): void {
    const body = visibleDocBody()
    const container = docScrollElement() || body

    if (!container || !body || !sel || (isVisual && !sel.isCollapsed)) {
      if (this.cursorEl) this.cursorEl.style.opacity = '0'
      if (this.trailEl) this.trailEl.style.opacity = '0'
      this.clearEffects()
      this.stopBlink()
      this.hasPosition = false
      return
    }

    this.ensureContainer(container)
    if (!this.cursorEl || !this.trailEl) return

    const measure = this.measureSelection(sel, body, container)
    if (!measure.visible) {
      this.cursorEl.style.opacity = '0'
      this.trailEl.style.opacity = '0'
      this.clearEffects()
      this.stopBlink()
      this.hasPosition = false
      return
    }

    const { left, top, width, height } = measure

    // 1. 初次落位：瞬间就绪，不产生横跨屏幕的突兀飞行动画与速度线
    if (!this.hasPosition) {
      this.cursorEl.classList.add('moji-browse-cursor-no-transition')
      this.trailEl.classList.add('moji-browse-cursor-no-transition')

      this.cursorEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
      this.cursorEl.style.width = `${Math.round(width)}px`
      this.cursorEl.style.height = `${Math.round(height)}px`
      this.cursorEl.style.opacity = '1'

      this.trailEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
      this.trailEl.style.width = `${Math.round(width)}px`
      this.trailEl.style.height = `${Math.round(height)}px`
      this.trailEl.style.opacity = '0'

      this.lastLeft = left
      this.lastTop = top
      this.hasPosition = true

      this.resetBlink()
      requestAnimationFrame(() => {
        this.cursorEl?.classList.remove('moji-browse-cursor-no-transition')
        this.trailEl?.classList.remove('moji-browse-cursor-no-transition')
      })
      return
    }

    const dx = left - this.lastLeft
    const dy = top - this.lastTop
    const dist = Math.hypot(dx, dy)

    // 2. 有效位移时：触发精准对齐位移轨迹的高能速度线（Speed Lines）
    if (dist >= 4) {
      this.spawnSpeedEffects(container, this.lastLeft, this.lastTop, left, top, height, dx, dy, dist)
    }

    this.lastLeft = left
    this.lastTop = top

    // 3. 主光标平滑快速响应：在位移过程中立即移除脉冲闪烁，保持常亮清晰可见！
    this.cursorEl.classList.remove('moji-browse-cursor-no-transition')
    this.cursorEl.classList.remove('moji-browse-cursor-blink')
    this.cursorEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
    this.cursorEl.style.width = `${Math.round(width)}px`
    this.cursorEl.style.height = `${Math.round(height)}px`
    this.cursorEl.style.opacity = '1'

    // 4. 跟随残影光带（稍微滞后形成流光尾翼）
    this.trailEl.classList.remove('moji-browse-cursor-no-transition')
    this.trailEl.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`
    this.trailEl.style.width = `${Math.round(width)}px`
    this.trailEl.style.height = `${Math.round(height)}px`
    this.trailEl.style.opacity = dist >= 4 ? '0.78' : '0'

    if (this.trailTimer !== null) window.clearTimeout(this.trailTimer)
    this.trailTimer = window.setTimeout(() => {
      if (this.trailEl) this.trailEl.style.opacity = '0'
    }, 260)

    // 5. 移动中保持常亮，静止 450ms 后恢复优雅淡入淡出闪烁
    this.resetBlink()
  }

  /** 清理所有 DOM 元素与定时器 */
  destroy(): void {
    this.stopBlink()
    if (this.trailTimer !== null) {
      window.clearTimeout(this.trailTimer)
      this.trailTimer = null
    }
    this.clearEffects()
    this.cursorEl?.remove()
    this.trailEl?.remove()
    this.cursorEl = null
    this.trailEl = null
    this.currentContainer = null
    this.hasPosition = false
  }
}
