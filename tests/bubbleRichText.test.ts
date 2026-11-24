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

  it('@ 名字后没有空格不生成 mention；有空格才高亮', () => {
    expect(bubbleMarkdownSource('请 @导师龟，看这个', ['导师龟'])).toBe('请 @导师龟，看这个')
    expect(bubbleMarkdownSource('请 @导师龟', ['导师龟'])).toBe('请 @导师龟')
    expect(bubbleMarkdownSource('请 @导师龟\n看这个', ['导师龟'])).toBe('请 @导师龟\n看这个')
    expect(bubbleMarkdownSource('请 @导师龟 看这个', ['导师龟'])).toContain('moji:mention/')
  })

  it('代码块里的 @ 与 URL 保持原样', () => {
    const source = bubbleMarkdownSource('`@导师龟 https://example.com`', ['导师龟'])
    expect(source).toBe('`@导师龟 https://example.com`')
  })

  it('`@用户` 显示真实用户名，链接目标仍保留占位名', () => {
    const source = bubbleMarkdownSource('@用户 已完成', ['用户'], { 用户: '张三' })
    expect(source).toContain('@张三')
    expect(source).not.toContain('@用户')
    expect(source).toContain('moji:mention/%E7%94%A8%E6%88%B7')
  })
})
