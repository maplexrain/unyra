import { describe, expect, it } from 'vitest'
import { extOfPath, formatSourceText, isSourceFormattable } from '../src/lib/formatSource'

describe('源码格式化', () => {
  it('按 .tsx 后缀选择 TypeScript 解析器', async () => {
    const result = await formatSourceText('export default {kind:"doc-component",component:({slots={}})=><div>{slots.title}</div>}', '.tsx')
    expect(result.ok).toBe(true)
    expect(result.parser).toBe('typescript')
    expect(result.text).toContain('export default {')
    expect(result.text).toContain('doc-component')
    expect(result.text).toContain('<div>')
  })

  it('按 .json / .md 后缀选择对应格式', async () => {
    const json = await formatSourceText('{"a":1,"b":[2,3]}', '.json')
    expect(json.ok).toBe(true)
    expect(json.parser).toBe('json')
    expect(() => JSON.parse(json.text!)).not.toThrow()

    const md = await formatSourceText('# 标题\n\n- 一\n- 二', '.md')
    expect(md.ok).toBe(true)
    expect(md.parser).toBe('markdown')
    expect(md.text).toContain('# 标题')
  })

  it('CSS / Vue 走各自的解析器，而不是一律当 HTML', async () => {
    const css = await formatSourceText('.a{color:red}', '.css')
    expect(css.ok).toBe(true)
    expect(css.parser).toBe('css')
    expect(css.text).toContain('color: red')

    const vue = await formatSourceText('<template><div>{{ msg }}</div></template>', '.vue')
    expect(vue.ok).toBe(true)
    expect(vue.parser).toBe('vue')
    expect(vue.text).toContain('<template>')
  })

  it('从文件路径取后缀，并拒绝未知文本类型', async () => {
    expect(extOfPath('doc-design/doc-component--x.tsx')).toBe('.tsx')
    expect(isSourceFormattable('.tsx')).toBe(true)
    expect(isSourceFormattable('.txt')).toBe(false)
    const result = await formatSourceText('plain text', '.txt')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('暂不支持')
  })
})
