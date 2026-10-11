import { describe, expect, it } from 'vitest'
import { splitParagraphs } from '../src/components/agent/panel/paragraphBuffer'

describe('splitParagraphs 消息分段切分', () => {
  it('空文本返回空数组', () => {
    expect(splitParagraphs('')).toEqual([])
    expect(splitParagraphs('   \n\n  ')).toEqual([])
  })

  it('按空行（双换行）分割多个段落', () => {
    const text = '第一段文字。\n\n第二段文字。\n\n第三段文字。'
    const res = splitParagraphs(text)
    expect(res).toEqual(['第一段文字。', '第二段文字。', '第三段文字。'])
  })

  it('按单换行符分割独立段落', () => {
    const text = '行一\n行二\n行三'
    const res = splitParagraphs(text)
    expect(res).toEqual(['行一', '行二', '行三'])
  })

  it('保护代码围栏不被内部换行切断', () => {
    const text = '说明文字\n```ts\nconst a = 1\nconst b = 2\n```\n结语'
    const res = splitParagraphs(text)
    expect(res).toEqual([
      '说明文字',
      '```ts\nconst a = 1\nconst b = 2\n```',
      '结语',
    ])
  })

  it('保护独立公式块（$$）不被内部换行切断', () => {
    const text = '前言\n$$\n\\int_0^1 x dx = \\frac{1}{2}\n$$\n后语'
    const res = splitParagraphs(text)
    expect(res).toEqual([
      '前言',
      '$$\n\\int_0^1 x dx = \\frac{1}{2}\n$$',
      '后语',
    ])
  })

  it('保护 Markdown 表格整块输出', () => {
    const text = '表格如下：\n| 表头1 | 表头2 |\n|---|---|\n| 内容A | 内容B |\n完'
    const res = splitParagraphs(text)
    expect(res).toEqual([
      '表格如下：',
      '| 表头1 | 表头2 |\n|---|---|\n| 内容A | 内容B |',
      '完',
    ])
  })

  it('保护引用块（>）整块输出', () => {
    const text = '引言：\n> 第一行引用\n> 第二行引用\n回复。'
    const res = splitParagraphs(text)
    expect(res).toEqual([
      '引言：',
      '> 第一行引用\n> 第二行引用',
      '回复。',
    ])
  })

  describe('流式模式 (streaming: true)', () => {
    it('末尾未闭合的单行留在缓冲区，不作为段落输出', () => {
      const text = '段落一已闭合\n正在写第二段'
      const res = splitParagraphs(text, { streaming: true })
      expect(res).toEqual(['段落一已闭合'])
    })

    it('末尾出现换行符时，立即累加输出该段落', () => {
      const text = '段落一已闭合\n第二段也写完了\n'
      const res = splitParagraphs(text, { streaming: true })
      expect(res).toEqual(['段落一已闭合', '第二段也写完了'])
    })

    it('未闭合的代码块在流式期间留在缓冲区中', () => {
      const text = '开始：\n```python\nprint("hello")'
      const res = splitParagraphs(text, { streaming: true })
      expect(res).toEqual(['开始：'])
    })

    it('代码块闭合且遇到换行时，立即输出整块代码', () => {
      const text = '开始：\n```python\nprint("hello")\n```\n'
      const res = splitParagraphs(text, { streaming: true })
      expect(res).toEqual(['开始：', '```python\nprint("hello")\n```'])
    })

    it('流式结束后（streaming: false），末尾缓冲区内容全部输出', () => {
      const text = '段落一已闭合\n第二段没有结尾换行'
      const res = splitParagraphs(text, { streaming: false })
      expect(res).toEqual(['段落一已闭合', '第二段没有结尾换行'])
    })
  })
})
