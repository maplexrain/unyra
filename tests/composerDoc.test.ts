// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { chipHtml, escapeHtml, serializeEditable } from '../src/lib/composerDoc'

/** 造一个编辑区：innerHTML 塞进去，序列化出来比对 */
function edit(html: string): string {
  const el = document.createElement('div')
  el.innerHTML = html
  return serializeEditable(el)
}

describe('composerDoc 序列化（contenteditable → 发送文本）', () => {
  it('纯文字原样收', () => {
    expect(edit('看看这道题')).toBe('看看这道题')
  })

  it('<br> 是换行；相邻文字不被吃掉', () => {
    expect(edit('第一行<br>第二行')).toBe('第一行\n第二行')
  })

  it('chip 展开成登记的路径信息（token），显示名不进发送文本', () => {
    const html = chipHtml({ label: '夹逼定理', token: '@docs/极限/夹逼定理.md' })
    expect(edit('看看 ' + html + ' 这份文档')).toBe('看看 @docs/极限/夹逼定理.md\u00A0 这份文档')
  })

  it('chip 的 title 与 token 都经过转义，名字里带引号/尖括号也安全', () => {
    const html = chipHtml({ label: '<a>"x"&y', token: '@docs/a"b<c>.md' })
    expect(html).toContain('data-token="@docs/a&quot;b&lt;c&gt;.md"')
    expect(html).toContain('&lt;a&gt;&quot;x&quot;&amp;y')
    // 反序列化回来 token 仍然是原样
    expect(edit(html)).toBe('@docs/a"b<c>.md\u00A0')
  })

  it('连续两枚 chip 中间隔着不换行空格，token 逐枚展开', () => {
    const html = chipHtml({ label: 'A', token: '@docs/a.md' }) + chipHtml({ label: 'B', token: '@docs/b.md' })
    expect(edit(html)).toBe('@docs/a.md\u00A0@docs/b.md\u00A0')
  })

  it('粘贴/拖放带进来的块级壳（div/p）按换行算，内容递归收', () => {
    expect(edit('<div>一段<div>二段</div></div>')).toBe('一段\n二段')
    expect(edit('<p>一段</p><p>二段</p>')).toBe('一段\n二段')
  })

  it('没登记 token 的 chip（畸形数据）展开成空串，不至于把整条消息发坏', () => {
    expect(edit('<span data-moji-doc-chip="1">残缺</span>')).toBe('')
  })

  it('escapeHtml：& 最先替换，不会二次转义', () => {
    expect(escapeHtml('<a href="x">&amp;')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;amp;')
  })
})
