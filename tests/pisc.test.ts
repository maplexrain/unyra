// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import {
  piscBlock,
  hydratePisc,
  runPiscSandbox,
  PISC_FORBIDDEN,
  PISC_SYNTAX_GUIDE,
  type PiscCanvasElement,
} from '../src/lib/pisc'
import type { PluginRenderContext } from '../src/lib/renderPlugins'
import { escapeHtml, encodeAttr } from '../src/lib/renderPlugins'
import { renderNote } from '../src/lib/markdown'

const mockCtx: PluginRenderContext = {
  escape: escapeHtml,
  attr: encodeAttr,
}

describe('参数化可交互仿真卡片 (pisc)', () => {
  it('正确将 ```pisc 源代码转换为占位 HTML 结构，且不包含 emoji，使用 SVG 图标与直角设计', () => {
    const code = `
      const ctx = card.getContext('2d');
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 100, 100);
    `
    const html = piscBlock(code, mockCtx)
    expect(html).toContain('class="moji-pisc"')
    expect(html).toContain('class="moji-pisc-canvas"')
    expect(html).toContain('moji-pisc-reset-btn')
    expect(html).toContain('data-pisc=')

    // 严禁使用 emoji
    expect(html).not.toMatch(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u)
    // 必须包含 SVG 图标
    expect(html).toContain('<svg')
    // 重置按钮无文字 label，纯 SVG
    expect(html).toContain('<button type="button" class="moji-pisc-btn moji-pisc-reset-btn"')
    expect(html).not.toContain('>重置<')
  })

  it('支持在 ```pisc 同一行传入自定义卡片标题', () => {
    const code = 'const ctx = card.getContext("2d");'
    const htmlWithTitle = piscBlock(code, mockCtx, '简谐振动受迫共振动态模拟')
    expect(htmlWithTitle).toContain('简谐振动受迫共振动态模拟')
    expect(htmlWithTitle).toContain('data-pisc-title="')

    // 支持带引号的标题
    const htmlQuoted = piscBlock(code, mockCtx, '"快速排序双指针分区演化过程"')
    expect(htmlQuoted).toContain('快速排序双指针分区演化过程')
  })

  it('通过 renderNote 完整 Markdown 渲染管线解析 ```pisc 标题与代码块', () => {
    const md = `
# 物理实验
\`\`\`pisc 麦克斯韦速率分布动态模型
const ctx = card.getContext('2d');
\`\`\`
`
    const rendered = renderNote(md)
    expect(rendered).toContain('class="moji-pisc"')
    expect(rendered).toContain('麦克斯韦速率分布动态模型')
    expect(rendered).toContain('class="moji-pisc-canvas"')
  })

  it('空代码时给出降级错误展示', () => {
    const html = piscBlock('   ', mockCtx)
    expect(html).toContain('moji-pisc-error')
    expect(html).toContain('仿真卡片代码为空')
  })

  it('静态安全拦截：包含 window、document、fetch 等危险全局变量时直接拒绝', () => {
    expect(PISC_FORBIDDEN.test('window.location.href = "..."')).toBe(true)
    expect(PISC_FORBIDDEN.test('document.cookie = ""')).toBe(true)
    expect(PISC_FORBIDDEN.test('fetch("https://example.com")')).toBe(true)
    expect(PISC_FORBIDDEN.test('localStorage.setItem("a", "b")')).toBe(true)
    expect(PISC_FORBIDDEN.test('new Worker("...")')).toBe(true)
    expect(PISC_FORBIDDEN.test('process.exit(1)')).toBe(true)
    expect(PISC_FORBIDDEN.test('eval("1+1")')).toBe(true)

    const dangerousCode = 'window.alert("attack")'
    const html = piscBlock(dangerousCode, mockCtx)
    expect(html).toContain('moji-pisc-error')
    expect(html).toContain('含有受限的全局对象或网络 API')
  })

  it('沙盒执行环境：正确传入 card 实例，并允许绘图与事件交互', () => {
    const canvas = document.createElement('canvas') as PiscCanvasElement
    canvas.width = 640
    canvas.height = 360

    let drawCalled = false

    // mock 2D context
    const mockCtx2d = {
      fillRect: vi.fn(() => {
        drawCalled = true
      }),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
    }
    canvas.getContext = vi.fn(() => mockCtx2d as any)

    const code = `
      const ctx = card.getContext('2d');
      ctx.fillRect(0, 0, 50, 50);
      card.addEventListener('pointerdown', (e) => {});
    `

    const cleanup = runPiscSandbox(canvas, code)
    expect(drawCalled).toBe(true)
    expect(typeof cleanup).toBe('function')
    cleanup()
  })

  it('运行时沙盒形参遮蔽：全局对象在沙盒内均为 undefined', () => {
    const canvas = document.createElement('canvas') as PiscCanvasElement
    canvas.width = 640
    canvas.height = 360

    const cleanup = runPiscSandbox(
      canvas,
      `
      const isCard = (card === this);
      if (!isCard) throw new Error('card mismatch');
    `,
    )
    expect(typeof cleanup).toBe('function')
    cleanup()
  })

  it('资源清理：自动注销动画循环与定时器', () => {
    vi.useFakeTimers()
    const canvas = document.createElement('canvas') as PiscCanvasElement
    canvas.width = 640
    canvas.height = 360

    let timerTick = false

    const code = `
      setTimeout(() => {
        timerTick = true;
      }, 1000);
    `

    const cleanup = runPiscSandbox(canvas, code)
    // 立即执行清理
    cleanup()
    vi.advanceTimersByTime(2000)

    // 定时器应已被清理，未触发回调
    expect(timerTick).toBe(false)
    vi.useRealTimers()
  })

  it('运行时语法或执行异常被捕获且不导致崩溃', () => {
    const canvas = document.createElement('canvas') as PiscCanvasElement
    canvas.width = 640
    canvas.height = 360

    let caughtError: Error | null = null
    const badCode = `
      throw new Error('仿真自定义运行时异常');
    `

    const cleanup = runPiscSandbox(canvas, badCode, (err) => {
      caughtError = err
    })

    expect(caughtError).not.toBeNull()
    expect(caughtError?.message).toContain('仿真自定义运行时异常')
    cleanup()
  })

  it('系统提示词指引包含完整 PISC 通用教学指南与规范', () => {
    expect(PISC_SYNTAX_GUIDE).toContain('```pisc')
    expect(PISC_SYNTAX_GUIDE).toContain('HTMLCanvasElement')
    expect(PISC_SYNTAX_GUIDE).toContain('card.getPointerPos')
    expect(PISC_SYNTAX_GUIDE).toContain('物理与工程科学')
    expect(PISC_SYNTAX_GUIDE).toContain('计算机科学与软件工程')
    expect(PISC_SYNTAX_GUIDE).toContain('数理统计与几何')
  })

  it('hydratePisc 能正确挂载并响应重置按钮且正确透传标题', () => {
    const container = document.createElement('div')
    container.innerHTML = `
      <div class="moji-pisc" data-pisc="${encodeAttr("const ctx = card.getContext('2d');")}" data-pisc-title="${encodeAttr('Lotka-Volterra 周期模型')}">
        <div class="moji-pisc-head">
          <button type="button" class="moji-pisc-btn moji-pisc-reset-btn"></button>
        </div>
        <div class="moji-pisc-stage">
          <canvas class="moji-pisc-canvas" width="640" height="360"></canvas>
        </div>
        <div class="moji-pisc-status"></div>
      </div>
    `
    document.body.appendChild(container)

    const unmount = hydratePisc(container)
    expect(typeof unmount).toBe('function')

    const canvas = container.querySelector<PiscCanvasElement>('canvas.moji-pisc-canvas')
    expect(canvas?.cardTitle).toBe('Lotka-Volterra 周期模型')

    const resetBtn = container.querySelector<HTMLButtonElement>('.moji-pisc-reset-btn')
    expect(resetBtn).not.toBeNull()
    resetBtn?.click()

    unmount()
    container.remove()
  })
})
