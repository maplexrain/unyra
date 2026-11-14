// @vitest-environment happy-dom
/**
 * 记忆模式的**纯 DOM 标记管线**（lib/memoryMask）的单元用例。
 *
 * 钉的是三条不变量——每一条都对应一次真实翻车：
 * 1. **不增殖**：反复调整（不同范围来回、刷新种子、重复 apply）后，正文文本一字不增。
 *    文本增殖的两条血案：TreeWalker 懒遍历边 replaceWith 边 nextNode（替换落树的照片
 *    会被再走一遍并再次切片）；pickSpaced 浮点步长相邻格撞出同一下标（同一片被包两次）。
 *    注意「遮罩 span 个数」**不是**稳定指标——unwrap+normalize 合并文本节点后片数合法地变，
 *    要钉的是 textContent 与被遮字符占比，不是 span 计数。
 * 2. **拉满全覆盖**：percent=100 时每一段的每一个可遮字符都在遮罩 span 里
 *    （链接/行内代码/chip/公式按设计不参与；代码块整块盖）。
 * 3. **无嵌套**：遮罩 span 不嵌套（嵌套 = 片内再切片，是增殖的前兆）。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { applyMemoryMasks, unwrapMemoryMasks } from '../src/lib/memoryMask'

const DOC_HTML = `
<h1>计算机网络 · 学习路线</h1>
<p>先明确这件事的交付物：这个目标要让你从「会调 API、出事只能重启」变成<strong>能判断一条链路在哪一层出了问题、慢在哪里、为什么慢</strong>。协议字段只是证据，判断力才是目标。</p>
<h2>这个目标覆盖什么</h2>
<ul>
  <li><strong>机制与推导</strong>：TCP/IP 五层模型、可靠传输怎么从零造出来、拥塞控制为什么长这样。</li>
  <li><strong>报文与行为</strong>：HTTP、DNS、TCP、UDP 的实际字段与 <code>curl</code> 真实行为。</li>
</ul>
<p><strong>不覆盖</strong>：路由交换设备的命令行配置、SDN 与数据中心组网。</p>
<pre><code>curl -v https://example.com</code></pre>
<blockquote><p>七站不是并列的目录，而是<strong>一条有依赖的链</strong>。</p></blockquote>
`

function makeBody(): { body: HTMLElement; original: string } {
  const body = document.createElement('div')
  body.className = 'note-preview'
  body.innerHTML = DOC_HTML
  document.body.appendChild(body)
  return { body, original: body.textContent ?? '' }
}

function maskStats(body: HTMLElement): { spans: number; maskedChars: number } {
  let maskedChars = 0
  for (const span of Array.from(body.querySelectorAll('.moji-mem-word'))) {
    maskedChars += (span.textContent ?? '').length
  }
  return { spans: body.querySelectorAll('.moji-mem-word').length, maskedChars }
}

/** 拉满之后还有哪些文字没被遮：收集遮罩外的非空文本节点（跳过设计上不参与的元素） */
function uncoveredTexts(body: HTMLElement): string[] {
  const out: string[] = []
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (parent.closest('.moji-mem-word')) return NodeFilter.FILTER_REJECT
      if (parent.closest('a, code, .katex, [data-token], sup')) return NodeFilter.FILTER_REJECT
      if (parent.closest('[data-memory-cover]')) return NodeFilter.FILTER_REJECT
      return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    out.push(n.nodeValue ?? '')
  }
  return out
}

/** 有没有嵌套遮罩：遮罩 span 的祖先里还有另一个遮罩 span */
function nestedMaskCount(body: HTMLElement): number {
  return Array.from(body.querySelectorAll('.moji-mem-word')).filter((s) =>
    Boolean(s.parentElement?.closest('.moji-mem-word')),
  ).length
}

beforeEach(() => {
  for (const el of Array.from(document.body.children)) el.remove()
})

describe('记忆模式标记管线 (lib/memoryMask)', () => {
  it('不变量一：不同范围来回调整 + 刷新种子 + 重复 apply，正文文本一字不增（不增殖）', () => {
    const { body, original } = makeBody()
    // 模拟用户来回拖 slider + 刷新分布 + 重复 apply
    for (const [percent, seed] of [
      [70, 1],
      [100, 1],
      [30, 2],
      [100, 2],
      [70, 2],
      [100, 1],
      [45, 3],
      [100, 3],
    ] as const) {
      unwrapMemoryMasks(body)
      applyMemoryMasks(body, { percent, seed })
      expect(body.textContent).toBe(original)
      expect(nestedMaskCount(body)).toBe(0)
    }
    unwrapMemoryMasks(body)
    expect(body.textContent).toBe(original)
  })

  it('不变量二：拉满全覆盖——每段的每个可遮字符都在遮罩 span 里（链接/行内代码除外）', () => {
    const { body } = makeBody()
    applyMemoryMasks(body, { percent: 100, seed: 42 })
    expect(uncoveredTexts(body)).toEqual([])
    const code = body.querySelector('code')
    expect(code?.textContent).toContain('curl')
    expect(code?.querySelector('.moji-mem-word')).toBeNull()
    expect(body.querySelector('pre')?.getAttribute('data-memory-cover')).toBe('')
  })

  it('部分覆盖：被遮字符占比近似跟随范围（30% 明显少于 100%，且不为零）', () => {
    const { body, original } = makeBody()
    const totalChars = (original ?? '').length
    applyMemoryMasks(body, { percent: 100, seed: 9 })
    const full = maskStats(body)
    unwrapMemoryMasks(body)
    applyMemoryMasks(body, { percent: 30, seed: 9 })
    const part = maskStats(body)
    expect(part.spans).toBeGreaterThan(0)
    expect(part.maskedChars).toBeLessThan(full.maskedChars)
    expect(Math.abs(part.maskedChars - totalChars * 0.3)).toBeLessThan(20)
  })

  it('重复 apply 幂等：同一种子同范围，被遮字符数与正文完全一致', () => {
    const { body, original } = makeBody()
    applyMemoryMasks(body, { percent: 60, seed: 7 })
    const first = maskStats(body)
    applyMemoryMasks(body, { percent: 60, seed: 7 })
    const second = maskStats(body)
    // span 个数不是稳定指标（normalize 合并文本节点后片数合法地变），
    // 钉的是被遮字符数与正文内容
    expect(second.maskedChars).toBe(first.maskedChars)
    expect(body.textContent).toBe(original)
  })
})
