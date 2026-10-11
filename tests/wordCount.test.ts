// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { countSourceWords, countVisibleWords, countVisibleWordsFromHtml } from '../src/lib/wordCount'

describe('wordCount 字数统计逻辑', () => {
  it('countSourceWords 统计源码字符数（排除空白字符）', () => {
    expect(countSourceWords('')).toBe(0)
    expect(countSourceWords('   \n\t ')).toBe(0)
    expect(countSourceWords('Hello World')).toBe(10)
    // '# 标题\n\n**加粗**' 包含: #, 标, 题, *, *, 加, 粗, *, * -> 9 字符
    expect(countSourceWords('# 标题\n\n**加粗**')).toBe(9)
  })

  it('countVisibleWordsFromHtml 从 HTML 字符串只统计可视文字（过滤标签与不可见内容）', () => {
    expect(countVisibleWordsFromHtml('')).toBe(0)
    const html = '<h1>标题</h1><p>这是一段<strong>加粗</strong>的正文。<script>console.log("bad")</script></p>'
    // 可视文字应为："标题这是一段加粗的正文。" -> 12 个字
    expect(countVisibleWordsFromHtml(html)).toBe(12)
  })

  it('countVisibleWordsFromHtml 剔除 KaTeX 内部隐藏的 MathML 标记', () => {
    const mathHtml = '<p>公式：<span class="katex"><span class="katex-mathml"><math>...</math></span><span class="katex-html">E = mc^2</span></span></p>'
    // 可视文字应包含："公式：E=mc^2" (9 字符：公, 式, ：, E, =, m, c, ^, 2)
    const count = countVisibleWordsFromHtml(mathHtml)
    expect(count).toBe(9)
  })

  it('countVisibleWords 传入 DOM 节点时准确统计可视文本', () => {
    const div = document.createElement('div')
    div.innerHTML = '<h2>段落一</h2><p>正文内容</p><div class="moji-run-menu"><button>运行</button></div>'
    // .moji-run-menu 被排除，只统计 "段落一正文内容" (7 字)
    expect(countVisibleWords(div)).toBe(7)
  })
})
