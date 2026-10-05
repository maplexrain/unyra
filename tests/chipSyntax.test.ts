// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  buildChipHtml,
  chipLabel,
  chipSvg,
  chipToken,
  escapeHtml,
  maskChipTokens,
  parseChipJson,
  parseChipToken,
  restoreChipTokens,
  splitChips,
} from '../src/lib/chipSyntax'
import { renderNote } from '../src/lib/markdown'
import { hydrateChipTokens } from '../src/lib/docChip'

const doc = { type: 'doc' as const, path: 'docs/极限/夹逼定理.md', title: '夹逼定理' }

describe('chipSyntax：#[{…}] 的编解码', () => {
  it('chipToken：键序固定，同一份东西永远编出同一段文本', () => {
    expect(chipToken(doc)).toBe('#[{"type":"doc", "path":"docs/极限/夹逼定理.md", "title":"夹逼定理"}]')
    // 空字段不进 token
    expect(chipToken({ type: 'exam', examId: 'e1', attemptId: 'a1' })).toBe(
      '#[{"type":"exam", "examId":"e1", "attemptId":"a1"}]',
    )
  })

  it('parseChipToken：严格 JSON 直接过，往返一致', () => {
    const token = chipToken(doc)
    expect(parseChipToken(token)).toEqual(doc)
  })

  it('web chip：url 进 token、往返一致；显示名 title 优先、域名兜底；图标是青色地球', () => {
    const web = { type: 'web' as const, url: 'https://docs.python.org/3/', title: 'Python 文档' }
    expect(chipToken(web)).toBe('#[{"type":"web", "url":"https://docs.python.org/3/", "title":"Python 文档"}]')
    expect(parseChipToken(chipToken(web))).toEqual(web)
    // 没写 title：显示域名（不甩一个长网址进 chip）
    expect(chipLabel(web)).toBe('Python 文档')
    expect(chipLabel({ type: 'web', url: 'https://docs.python.org/3/' })).toBe('docs.python.org')
    expect(chipSvg('web')).toContain('#2aa1b8')
  })

  it('parseChipJson：宽松解析——裸键名、单引号、全角引号、尾逗号都修', () => {
    expect(parseChipJson(`{type:'doc', path:'docs/a.md',}`)).toEqual({ type: 'doc', path: 'docs/a.md' })
    expect(parseChipJson('{type：“doc”， path：“docs/a.md”}')).toEqual({ type: 'doc', path: 'docs/a.md' })
    expect(parseChipJson('{"type":"doc"}')).toEqual({ type: 'doc' })
  })

  it('parseChipJson：类型不认识 / 不是对象 / 解析不开 → null', () => {
    expect(parseChipJson('{type:"banana"}')).toBeNull()
    expect(parseChipJson('"doc"')).toBeNull()
    expect(parseChipJson('{type:"doc"')).toBeNull()
    expect(parseChipJson('')).toBeNull()
  })

  it('splitChips：文字与 chip 交替；长得像 chip 但解析不开的原样留在文字里', () => {
    const text = `先看 ${chipToken(doc)} 这份文档，然后 #[{type:"???"}] 再说。`
    const segs = splitChips(text)
    expect(segs).toHaveLength(3)
    expect(segs[0]).toEqual({ kind: 'text', text: '先看 ' })
    expect(segs[1]).toMatchObject({ kind: 'chip', payload: doc })
    expect(segs[2]).toEqual({ kind: 'text', text: ' 这份文档，然后 #[{type:"???"}] 再说。' })
  })

  it('splitChips：没有 chip 时原样一段文字', () => {
    expect(splitChips('就一句话')).toEqual([{ kind: 'text', text: '就一句话' }])
  })
})

describe('chipSyntax：DOM 形态与显示名', () => {
  it('buildChipHtml：身份、payload、token 三样都在属性里，且都经过转义', () => {
    const html = buildChipHtml({ type: 'doc', path: 'docs/a"b<c>.md', title: '<x>&y' })
    expect(html).toContain('data-moji-doc-chip="1"')
    expect(html).toContain('data-chip="{&quot;type&quot;:&quot;doc&quot;')
    expect(html).toContain('&lt;x&gt;&amp;y')
    // 属性按 HTML 规则反转义回来，还是原来那份 payload
    const attr = (name: string): string => {
      const m = new RegExp('data-' + name + '="([^"]*)"').exec(html)
      return (m?.[1] ?? '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
    }
    expect(parseChipJson(attr('chip'))).toEqual({ type: 'doc', path: 'docs/a"b<c>.md', title: '<x>&y' })
    expect(parseChipToken(attr('token'))).toEqual({ type: 'doc', path: 'docs/a"b<c>.md', title: '<x>&y' })
  })

  it('chipLabel：title 优先，缺了按类型兜底（路径取文件名）', () => {
    expect(chipLabel(doc)).toBe('夹逼定理')
    expect(chipLabel({ type: 'doc', path: 'docs/极限/导数.md' })).toBe('导数.md')
    expect(chipLabel({ type: 'exam' })).toBe('试卷')
    expect(chipLabel({ type: 'attempt' })).toBe('试卷副本')
    expect(chipLabel({ type: 'note', note: '错题本' })).toBe('错题本')
  })

  it('chipSvg：一颗带类型色的 SVG', () => {
    const svg = chipSvg('note')
    expect(svg).toContain('<svg')
    expect(svg).toContain('#d9962e')
  })
})

describe('chipSyntax：markdown 隔离（mask/restore）', () => {
  // 病灶原文：token 里的裸网址会被 GFM 自动链接包成 <a>，把 token 拆碎在相邻文本节点里
  const LINKED = '* #[{"type":"web","url":"https://x.com/search?q=AI&src=typed_query&f=live"}] —— AI 搜索页'

  it('maskChipTokens：解析得开的 token 换成哨兵，解析不开的原样留着', () => {
    const { masked, tokens } = maskChipTokens(`前 ${chipToken(doc)} 中 #[{type:"???"}] 后`)
    expect(tokens).toEqual([chipToken(doc)])
    expect(masked).toBe('前 \uE0000\uE001 中 #[{type:"???"}] 后')
  })

  it('restoreChipTokens：哨兵换回转义过的 token；认不出的哨兵消失', () => {
    expect(restoreChipTokens('<p>\uE0000\uE001</p>', [chipToken(doc)])).toBe('<p>' + escapeHtml(chipToken(doc)) + '</p>')
    expect(restoreChipTokens('<p>\uE0007\uE001</p>', [])).toBe('<p></p>')
  })

  it('端到端：不掩蔽时 renderNote 把 token 拆出 <a>；掩蔽复原后 token 完整、能被 hydrate 成 chip', () => {
    // 复现病灶：裸渲染，token 中段进了链接
    expect(renderNote(LINKED)).toContain('<a ')
    // 掩蔽 → 渲染 → 复原
    const { masked, tokens } = maskChipTokens(LINKED)
    const html = restoreChipTokens(renderNote(masked), tokens)
    expect(html).not.toContain('<a ')
    expect(html).toContain('&quot;type&quot;:&quot;web&quot;')
    // 落到 DOM 里 hydrate：token 完整地待在一个文本节点里，换得出 chip
    const host = document.createElement('div')
    host.innerHTML = html
    const cleanup = hydrateChipTokens(host)
    const chip = host.querySelector('[data-moji-doc-chip]')
    expect(chip).not.toBeNull()
    expect(chip?.getAttribute('data-chip')).toContain('x.com/search')
    expect(host.querySelector('.moji-chip-label')?.textContent).toBe('x.com')
    cleanup()
  })
})
