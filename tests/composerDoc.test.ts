// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { buildChipHtml, chipToken, parseChipToken } from '../src/lib/chipSyntax'
import { expandChipTokens, serializeEditable } from '../src/lib/composerDoc'

/** 造一个编辑区：innerHTML 塞进去，序列化出来比对 */
function edit(html: string): string {
  const el = document.createElement('div')
  el.innerHTML = html
  return serializeEditable(el)
}

/** chip 的 DOM 形态（buildChipHtml 产出的那一段） */
const chipHtml = (path: string, title: string): string => buildChipHtml({ type: 'doc', path, title })

const TOKEN = '#[{"type":"doc", "path":"docs/极限/夹逼定理.md", "title":"夹逼定理"}]'

describe('composerDoc 序列化（contenteditable → 发送文本）', () => {
  it('纯文字原样收', () => {
    expect(edit('看看这道题')).toBe('看看这道题')
  })

  it('<br> 是换行；相邻文字不被吃掉', () => {
    expect(edit('第一行<br>第二行')).toBe('第一行\n第二行')
  })

  it('chip 展开成登记的 #[{…}] token，显示名不进发送文本', () => {
    const html = chipHtml('docs/极限/夹逼定理.md', '夹逼定理')
    expect(edit('看看 ' + html + ' 这份文档')).toBe('看看 ' + TOKEN + '\u00A0 这份文档')
  })

  it('chip 的属性与文字都经过转义，名字里带引号/尖括号也安全', () => {
    const html = buildChipHtml({ type: 'doc', path: 'docs/a"b<c>.md', title: '<x>&y' })
    expect(html).toContain('&lt;x&gt;&amp;y')
    // 序列化只取 data-token（token 本身是 JSON，引号在里面已按 JSON 规则转义）
    const token = /data-token="([^"]*)"/.exec(html)?.[1] ?? ''
    const decoded = token.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    expect(parseChipToken(decoded)).toEqual({ type: 'doc', path: 'docs/a"b<c>.md', title: '<x>&y' })
  })

  it('连续两枚 chip 中间隔着不换行空格，token 逐枚展开', () => {
    const html = chipHtml('docs/a.md', 'A') + chipHtml('docs/b.md', 'B')
    expect(edit(html)).toBe(
      '#[{"type":"doc", "path":"docs/a.md", "title":"A"}]\u00A0#[{"type":"doc", "path":"docs/b.md", "title":"B"}]\u00A0',
    )
  })

  it('粘贴/拖放带进来的块级壳（div/p）按换行算，内容递归收', () => {
    expect(edit('<div>一段<div>二段</div></div>')).toBe('一段\n二段')
    expect(edit('<p>一段</p><p>二段</p>')).toBe('一段\n二段')
  })

  it('没登记 token 的 chip（畸形数据）展开成空串，不至于把整条消息发坏', () => {
    expect(edit('<span data-moji-doc-chip="1">残缺</span>')).toBe('')
  })

  it('expandChipTokens：编辑区里完整的 #[{…}] 就地变成 chip 元素；解析不开的不动', () => {
    const root = document.createElement('div')
    const good = chipToken({ type: 'doc', path: 'docs/a.md' })
    root.textContent = '先看 ' + good + ' 再说，这截不是引用：#[{type:"???"}]'
    expandChipTokens(root)
    const chips = root.querySelectorAll('[data-moji-doc-chip]')
    expect(chips).toHaveLength(1)
    expect(root.textContent).toContain('再说，这截不是引用：#[{type:"???"}]')
    expect(parseChipToken(chips[0].getAttribute('data-token') ?? '')).toEqual({ type: 'doc', path: 'docs/a.md' })
  })

  it('expandChipTokens：纯文字的编辑区原样保留', () => {
    const root = document.createElement('div')
    root.textContent = '没有引用的一段话'
    expandChipTokens(root)
    expect(root.querySelectorAll('[data-moji-doc-chip]')).toHaveLength(0)
    expect(root.textContent).toBe('没有引用的一段话')
  })

  it('chipToken：键序固定，同一份东西永远编出同一段文本', () => {
    expect(TOKEN).toBe(chipToken({ type: 'doc', path: 'docs/极限/夹逼定理.md', title: '夹逼定理' }))
  })
})
