/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import { openMermaidModal } from '../src/lib/mermaidModal'

describe('mermaidModal', () => {
  it('opens modal, renders svg and toolbar with rounded-none buttons', () => {
    const dummySvg = '<svg id="test-svg" width="300" height="200"><circle cx="50" cy="50" r="40" /></svg>'
    openMermaidModal(dummySvg)

    const modal = document.querySelector('.moji-mermaid-modal')
    expect(modal).not.toBeNull()
    expect(modal?.classList.contains('fixed')).toBe(true)

    // 检查右上角工具栏与比例
    const toolbar = modal?.querySelector('.moji-mermaid-toolbar')
    expect(toolbar).not.toBeNull()
    expect(toolbar?.classList.contains('rounded-none')).toBe(true)

    const pctEl = modal?.querySelector('.moji-mermaid-pct')
    expect(pctEl?.textContent).toBe('250%')

    // 检查 SVG 内容注入与自然尺寸解析
    const svg = modal?.querySelector<SVGElement>('svg#test-svg')
    expect(svg).not.toBeNull()
    expect(svg?.style.maxWidth).toBe('none')
    expect(svg?.style.width).toBe('300px')
    expect(svg?.style.height).toBe('200px')

    // 检查缩放控制按钮
    const zoomIn = modal?.querySelector<HTMLButtonElement>('.moji-mermaid-btn-zoom-in')
    zoomIn?.click()
    expect(pctEl?.textContent).toBe('300%')

    // 检查重置按钮恢复自适应尺寸
    const reset = modal?.querySelector<HTMLButtonElement>('.moji-mermaid-btn-reset')
    reset?.click()
    expect(pctEl?.textContent).toBe('250%')

    // 检查按 Escape 键关闭
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.querySelector('.moji-mermaid-modal')).toBeNull()
  })

  it('closes on close button click', () => {
    openMermaidModal('<svg id="s2"></svg>')
    const modal = document.querySelector('.moji-mermaid-modal')
    expect(modal).not.toBeNull()

    const closeBtn = modal?.querySelector<HTMLButtonElement>('.moji-mermaid-btn-close')
    closeBtn?.click()
    expect(document.querySelector('.moji-mermaid-modal')).toBeNull()
  })
})
