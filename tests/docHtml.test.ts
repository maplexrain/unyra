/**
 * HTML 为主的正文怎么写、渲染器就得怎么认（见 learn/ai/guides 的「正文写作」与 docs/rendering.md）。
 *
 * 提示词给模型的三条承诺，这里是它们的对账：
 * 1. HTML 块**原样透传**（class 一个不改，交给 lib/docTailwind 现算样式）；
 * 2. 块级元素里用**空行**隔出来的 Markdown 会照常解析，并落进那个容器里；
 * 3. **公式是例外**：$…$ 在 HTML 块里同样渲染（从前的图注坏就坏在这一条上），
 *    而代码里的 $ 依旧是字面量。
 */
import { describe, expect, it, vi } from 'vitest'

// renderNote 里 DOMPurify.sanitize 需要 document（node 下没有）：换成直通
vi.mock('dompurify', () => ({ default: { sanitize: (html: string) => html } }))

import { renderNote } from '../src/lib/markdown'

const katexCount = (html: string): number => (html.match(/class="katex"/g) ?? []).length

describe('HTML 为主的正文', () => {
  it('空行隔出来的 Markdown 落进那个容器里，行内语法照常解析', () => {
    const out = renderNote(
      [
        '<div class="my-5 grid grid-cols-2 gap-5">',
        '',
        '<div class="rounded-lg bg-sunken p-4">',
        '',
        '**定义**：瞬时变化率。',
        '',
        '</div>',
        '',
        '<div class="rounded-lg bg-card p-4">',
        '',
        '几何意义：切线斜率。',
        '',
        '</div>',
        '',
        '</div>',
      ].join('\n'),
    )
    // 两层容器都留着（class 是导师写的，一个字都不改）
    expect(out).toContain('<div class="my-5 grid grid-cols-2 gap-5">')
    expect(out).toContain('<div class="rounded-lg bg-sunken p-4">')
    // 中间那段 Markdown 变成了容器里的 <p>，加粗也解析了
    expect(out).toContain('<div class="rounded-lg bg-sunken p-4"><p><strong>定义</strong>：瞬时变化率。</p>')
    expect(out).toContain('<div class="rounded-lg bg-card p-4"><p>几何意义：切线斜率。</p>')
  })

  it('HTML 块里的 $…$ 照样渲染成公式（图注最常踩这一条）', () => {
    const out = renderNote(
      '<figure class="md-fig"><svg viewBox="0 0 40 40"></svg>\n<figcaption>图 1：$y = x^2$ 的切线</figcaption></figure>',
    )
    expect(out).toContain('<figcaption>')
    expect(out).toContain('的切线</figcaption>')
    expect(out).toContain('class="katex"')
    // 公式源码不见了，说明真的渲染过而不是原样透传
    expect(out).not.toContain('$y = x^2$')
  })

  it('代码里的 $ 是字面量，不渲染公式', () => {
    const out = renderNote('<div class="p-4">\n<code>echo $HOME</code>\n</div>')
    expect(out).toContain('echo $HOME')
    expect(katexCount(out)).toBe(0)
  })

  it('没有公式的 HTML 块逐字透传（这条路上零开销、零改动）', () => {
    const raw = '<div class="flex items-center gap-3"><span class="h-6 w-6 rounded-full bg-seal">1</span></div>'
    expect(renderNote(raw).trim()).toBe(raw)
  })
})
