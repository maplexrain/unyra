// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { bubbleMarkdownSource } from '../src/lib/bubbleMarkdown'
import { renderNote } from '../src/lib/markdown'

describe('聊天气泡富文本', () => {
  it('解析 markdown、@角色与裸 URL', () => {
    const source = bubbleMarkdownSource('**收到**，请 @导师龟 看 https://example.com/a', ['导师龟'])
    const html = renderNote(source)
    expect(html).toContain('<strong>收到</strong>')
    expect(html).toContain('moji:mention/')
    expect(html).toContain('href="https://example.com/a"')
  })

  it('代码块里的 @ 与 URL 保持原样', () => {
    const source = bubbleMarkdownSource('`@导师龟 https://example.com`', ['导师龟'])
    expect(source).toBe('`@导师龟 https://example.com`')
  })
})
