import { describe, expect, it } from 'vitest'
import {
  computeMermaidSvgMaxWidth,
  MERMAID_LANG,
  MERMAID_SYNTAX_GUIDE,
  mermaidBlock,
  mermaidFallback,
  mermaidFoldLimit,
  mermaidWrapWidth,
  shouldFoldMermaid,
} from '../src/lib/mermaid'
import type { PluginRenderContext } from '../src/lib/renderPlugins'

const mockCtx: PluginRenderContext = {
  escape: (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;'),
  attr: (s: string) => encodeURIComponent(s),
}

describe('Mermaid 图表渲染与尺寸自适应', () => {
  it('MERMAID_LANG 常量正确为 mermaid', () => {
    expect(MERMAID_LANG).toBe('mermaid')
  })

  describe('mermaidBlock 与 fallback', () => {
    it('空图表内容生成错误提示块', () => {
      const html = mermaidBlock('   ', mockCtx)
      expect(html).toContain('moji-mermaid-error')
      expect(html).toContain('图表内容为空')
    })

    it('有效图表代码生成占位容器并对属性编码', () => {
      const code = 'graph TD\nA-->B'
      const html = mermaidBlock(code, mockCtx)
      expect(html).toContain('class="moji-mermaid"')
      expect(html).toContain('data-mermaid="' + encodeURIComponent(code) + '"')
      expect(html).toContain('class="moji-mermaid-stage"')
    })

    it('mermaidFallback 正确转义错误信息与源代码', () => {
      const html = mermaidFallback('错误 <script>', '<svg>', mockCtx)
      expect(html).toContain('错误 &lt;script&gt;')
      expect(html).toContain('&lt;svg&gt;')
      expect(html).not.toContain('<script>')
    })
  })

  describe('computeMermaidSvgMaxWidth 尺寸控制', () => {
    it('当 Mermaid 输出了精确的 style.maxWidth 像素值时，优先采用并保持 min(100%, Xpx)', () => {
      expect(computeMermaidSvgMaxWidth('246px')).toBe('min(100%, 246px)')
      expect(computeMermaidSvgMaxWidth('312.8px')).toBe('min(100%, 313px)')
    })

    it('当 style 未定义像素值时，能从 viewBox 解析自然设计宽度', () => {
      expect(computeMermaidSvgMaxWidth('', '0 0 280 160')).toBe('min(100%, 280px)')
      expect(computeMermaidSvgMaxWidth(null, '-10 -10 450.4 300')).toBe('min(100%, 450px)')
    })

    it('当 style 与 viewBox 均未提供时，能从 width 属性中解析', () => {
      expect(computeMermaidSvgMaxWidth(null, null, '360')).toBe('min(100%, 360px)')
      expect(computeMermaidSvgMaxWidth(null, null, '360px')).toBe('min(100%, 360px)')
    })

    it('无法识别任何自然宽度时安全回退至 100%', () => {
      expect(computeMermaidSvgMaxWidth()).toBe('100%')
      expect(computeMermaidSvgMaxWidth('100%', 'invalid', '100%')).toBe('100%')
    })
  })

  /*
   * 标签折行宽度：mermaid 12.x 里 flowchart 的 nodeSpacing / rankSpacing / padding
   * 都被 dagre 布局上的默认值遮蔽了（设 0 到 160 都是同一个结果），真正能把图压矮的
   * 只有 wrappingWidth——默认 120 会把一行字从中间掰断，节点凭空多一行。
   */
  describe('标签折行宽度（mermaidWrapWidth）', () => {
    it('按容器宽度减去内边距，夹在 200–320 之间', () => {
      expect(mermaidWrapWidth(430)).toBe(320)
      expect(mermaidWrapWidth(300)).toBe(244)
      expect(mermaidWrapWidth(230)).toBe(200)
    })

    it('量不到容器宽度（隐藏着的常驻页）时退回默认值', () => {
      expect(mermaidWrapWidth(0)).toBe(240)
      expect(mermaidWrapWidth(Number.NaN)).toBe(240)
    })
  })

  /*
   * 超高图表先折起：竖链图的高度随节点数线性长，十来节就是一屏多，正文被整段顶走。
   * 阈值是「窗口的六成，且不超过 460px」——CSS 的 max-height 与这里必须同值
   * （见 styles/code.css 的 .moji-mermaid-tall）。
   */
  describe('超高图表折起阈值', () => {
    it('窗口矮时按六成算，窗口高时封顶 460px', () => {
      expect(mermaidFoldLimit(600)).toBe(348)
      expect(mermaidFoldLimit(900)).toBe(460)
      expect(mermaidFoldLimit(2000)).toBe(460)
    })

    it('正好等于阈值不折（只在真的超出一屏时才折）', () => {
      expect(shouldFoldMermaid(460, 900)).toBe(false)
      expect(shouldFoldMermaid(461, 900)).toBe(true)
    })

    it('同一个高度，窗口越矮越容易折', () => {
      expect(shouldFoldMermaid(400, 600)).toBe(true)
      expect(shouldFoldMermaid(400, 1000)).toBe(false)
    })
  })

  it('给导师的排版纪律写在指引里（否则模型会继续排十几节的竖链）', () => {
    expect(MERMAID_SYNTAX_GUIDE).toContain('不超过 8 个节点')
    expect(MERMAID_SYNTAX_GUIDE).toContain('六节以内')
  })
})
