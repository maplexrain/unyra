// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  buildChipHtml,
  chipLabel,
  chipSvg,
  chipToken,
  parseChipJson,
  parseChipToken,
  splitChips,
} from '../src/lib/chipSyntax'

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
