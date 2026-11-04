import { t } from '../i18n'

/**
 * 全局 Mermaid 图表全屏交互浮窗：
 * 支持鼠标滚轮缩放、鼠标按住拖拽平移、右上角比例控制与重置，点击空白处或 Esc 退出。
 * 遵循严格直角规范（rounded-none）。
 */

let activeCleanup: (() => void) | null = null

export function openMermaidModal(svgHtml: string): void {
  // 如果已有打开的浮窗，先关掉
  if (activeCleanup) {
    activeCleanup()
  }

  // 1. 创建顶层容器
  const modal = document.createElement('div')
  modal.className =
    'moji-mermaid-modal fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs select-none'
  modal.tabIndex = -1
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  modal.setAttribute('aria-label', t('查看图表完整视图'))

  // 2. 状态变量
  let translateX = 0
  let translateY = 0
  let isDragging = false
  let dragStartX = 0
  let dragStartY = 0
  let startTranslateX = 0
  let startTranslateY = 0
  let hasMoved = false

  // 3. 构建内部结构
  modal.innerHTML = `
    <div class="moji-mermaid-viewport absolute inset-0 flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing">
      <div class="moji-mermaid-canvas inline-block transition-transform duration-75 origin-center will-change-transform">
        ${svgHtml}
      </div>
    </div>
    <div class="moji-mermaid-toolbar no-print absolute top-4 right-4 z-10 flex items-center gap-1.5 border border-line-strong/80 bg-card/90 px-2 py-1 shadow-lg backdrop-blur select-none rounded-none text-ink">
      <span class="moji-mermaid-pct px-2 text-xs font-mono font-medium tabular-nums text-ink-strong cursor-pointer hover:text-seal" title="${t('点击切换比例')}">100%</span>
      <span aria-hidden="true" class="h-3.5 w-px bg-line-strong/60"></span>
      <button type="button" class="moji-mermaid-btn-zoom-out flex h-7 w-7 items-center justify-center text-ink-soft hover:bg-line/60 hover:text-ink rounded-none transition" title="${t('缩小 (滚轮向下)')}">
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      </button>
      <button type="button" class="moji-mermaid-btn-zoom-in flex h-7 w-7 items-center justify-center text-ink-soft hover:bg-line/60 hover:text-ink rounded-none transition" title="${t('放大 (滚轮向上)')}">
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
      </button>
      <button type="button" class="moji-mermaid-btn-reset flex h-7 w-7 items-center justify-center text-ink-soft hover:bg-line/60 hover:text-ink rounded-none transition" title="${t('居中重置')}">
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
      </button>
      <span aria-hidden="true" class="h-3.5 w-px bg-line-strong/60"></span>
      <button type="button" class="moji-mermaid-btn-close flex h-7 w-7 items-center justify-center text-ink-soft hover:bg-warn/15 hover:text-warn-deep rounded-none transition" title="${t('退出 (Esc 或点击空白处)')}">
        <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
    <div class="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 border border-line/60 bg-card/75 px-3 py-1 text-[11px] text-ink-faint shadow-xs backdrop-blur-xs select-none rounded-none">
      ${t('滚轮缩放 · 拖拽平移 · 点击空白或 Esc 退出')}
    </div>
  `

  const viewport = modal.querySelector<HTMLElement>('.moji-mermaid-viewport')!
  const canvas = modal.querySelector<HTMLElement>('.moji-mermaid-canvas')!
  const pctEl = modal.querySelector<HTMLElement>('.moji-mermaid-pct')!
  const zoomInBtn = modal.querySelector<HTMLElement>('.moji-mermaid-btn-zoom-in')!
  const zoomOutBtn = modal.querySelector<HTMLElement>('.moji-mermaid-btn-zoom-out')!
  const resetBtn = modal.querySelector<HTMLElement>('.moji-mermaid-btn-reset')!
  const closeBtn = modal.querySelector<HTMLElement>('.moji-mermaid-btn-close')!

  // 4. 解析固有自然尺寸并赋给 SVG，彻底解决 inline-block + width:100% 塌缩为 300px 的异常尺寸问题
  const svgEl = canvas.querySelector('svg')
  let naturalWidth = 0
  let naturalHeight = 0

  if (svgEl) {
    const vb = svgEl.getAttribute('viewBox')
    if (vb) {
      const parts = vb.trim().split(/[\s,]+/).map(Number)
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        naturalWidth = parts[2]
        naturalHeight = parts[3]
      }
    }
    if (!naturalWidth) {
      const w = parseFloat(svgEl.getAttribute('width') || '')
      if (w > 0 && Number.isFinite(w)) naturalWidth = w
    }
    if (!naturalHeight) {
      const h = parseFloat(svgEl.getAttribute('height') || '')
      if (h > 0 && Number.isFinite(h)) naturalHeight = h
    }
    if (!naturalWidth && svgEl.style.maxWidth && svgEl.style.maxWidth.endsWith('px')) {
      naturalWidth = parseFloat(svgEl.style.maxWidth)
    }

    if (naturalWidth > 0 && naturalHeight > 0) {
      svgEl.style.width = `${naturalWidth}px`
      svgEl.style.height = `${naturalHeight}px`
      svgEl.setAttribute('width', String(Math.round(naturalWidth)))
      svgEl.setAttribute('height', String(Math.round(naturalHeight)))
    } else if (naturalWidth > 0) {
      svgEl.style.width = `${naturalWidth}px`
      svgEl.style.height = 'auto'
      svgEl.setAttribute('width', String(Math.round(naturalWidth)))
    }

    svgEl.style.maxWidth = 'none'
    svgEl.style.maxHeight = 'none'
    svgEl.style.display = 'block'
    svgEl.style.pointerEvents = 'auto'
  }

  // 5. 根据全屏视口计算最佳自适应初始缩放比例（居中自适应展示，防止图表偏小）
  const vw = typeof window !== 'undefined' ? (window.innerWidth || 1024) : 1024
  const vh = typeof window !== 'undefined' ? (window.innerHeight || 768) : 768
  const availW = Math.max(300, vw - 120)
  const availH = Math.max(200, vh - 140)

  let autoFitScale = 1.0
  if (naturalWidth > 0 && naturalHeight > 0) {
    const fit = Math.min(availW / naturalWidth, availH / naturalHeight)
    // 保证清晰舒适可视，小图表放大（最高 2.5x），大图表缩放至完全可视（最低 0.2x）
    autoFitScale = Math.max(0.2, Math.min(fit, 2.5))
    autoFitScale = Math.round(autoFitScale * 100) / 100
  }

  let scale = autoFitScale

  const updateTransform = () => {
    canvas.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`
    pctEl.textContent = `${Math.round(scale * 100)}%`
  }

  const setScaleClamped = (nextScale: number) => {
    scale = Math.min(8.0, Math.max(0.1, nextScale))
    updateTransform()
  }

  const resetView = () => {
    // 如果当前已是自适应比例且不等于 1.0，则切到 100%；否则恢复自适应比例
    if (Math.abs(scale - autoFitScale) < 0.05 && autoFitScale !== 1.0) {
      scale = 1.0
    } else {
      scale = autoFitScale
    }
    translateX = 0
    translateY = 0
    updateTransform()
  }

  // 初始化应用初始位置与比例
  updateTransform()

  // 缩放按钮
  zoomInBtn.onclick = (e) => {
    e.stopPropagation()
    setScaleClamped(scale * 1.2)
  }
  zoomOutBtn.onclick = (e) => {
    e.stopPropagation()
    setScaleClamped(scale * 0.833)
  }
  pctEl.onclick = (e) => {
    e.stopPropagation()
    if (Math.abs(scale - 1.0) < 0.05) {
      scale = autoFitScale
    } else {
      scale = 1.0
    }
    updateTransform()
  }
  resetBtn.onclick = (e) => {
    e.stopPropagation()
    resetView()
  }

  // 关闭流程
  const close = () => {
    if (activeCleanup) {
      activeCleanup()
    }
  }

  closeBtn.onclick = (e) => {
    e.stopPropagation()
    close()
  }

  // 滚轮缩放
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.14 : 0.87
    setScaleClamped(scale * factor)
  }
  viewport.addEventListener('wheel', onWheel, { passive: false })

  // 拖拽平移
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    // 点击的是工具栏内部则忽略拖拽
    if ((e.target as HTMLElement).closest('.moji-mermaid-toolbar')) return

    isDragging = true
    hasMoved = false
    dragStartX = e.clientX
    dragStartY = e.clientY
    startTranslateX = translateX
    startTranslateY = translateY
    viewport.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!isDragging) return
    const dx = e.clientX - dragStartX
    const dy = e.clientY - dragStartY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasMoved = true
    }
    translateX = startTranslateX + dx
    translateY = startTranslateY + dy
    updateTransform()
  }

  const onPointerUp = (e: PointerEvent) => {
    if (!isDragging) return
    isDragging = false
    try {
      viewport.releasePointerCapture(e.pointerId)
    } catch {}

    // 如果未产生拖拽移动，且点击落在空白区域，退出浮窗
    if (!hasMoved) {
      const target = e.target as HTMLElement
      if (target === viewport || target === modal || (!svgEl?.contains(target) && !target.closest('.moji-mermaid-toolbar'))) {
        close()
      }
    }
  }

  viewport.addEventListener('pointerdown', onPointerDown)
  viewport.addEventListener('pointermove', onPointerMove)
  viewport.addEventListener('pointerup', onPointerUp)
  viewport.addEventListener('pointercancel', onPointerUp)

  // 键盘快捷键 (Esc 退出)
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }
  window.addEventListener('keydown', onKeyDown, true)

  document.body.appendChild(modal)
    modal.focus()

  activeCleanup = () => {
    viewport.removeEventListener('wheel', onWheel)
    viewport.removeEventListener('pointerdown', onPointerDown)
    viewport.removeEventListener('pointermove', onPointerMove)
    viewport.removeEventListener('pointerup', onPointerUp)
    viewport.removeEventListener('pointercancel', onPointerUp)
    window.removeEventListener('keydown', onKeyDown, true)
    modal.remove()
        activeCleanup = null
  }
}
