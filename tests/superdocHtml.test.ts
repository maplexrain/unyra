/**
 * 超级文档内置语法的单元用例：<moji-markdown> 的缩进剥除与 moji:super 链接的解析。
 *
 * 错误形态都很安静：缩进没剥掉，用户写的 markdown 整段变成代码块；链接解析认不出，
 * 点击就落进「什么都不发生」——比报错更难查。
 */
import { describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'

import { dedentBlock, katexIframeCss } from '../src/lib/superdocHtml'
import { parseSuperHref, superLinkHref, superLinkMarkdown } from '../src/lib/nodeLink'

describe('dedentBlock（markdown 块的公共缩进剥除）', () => {
  it('剥掉公共缩进：HTML 里缩进排版的 markdown 不会被当成代码块', () => {
    expect(dedentBlock('\n    ## 标题\n    正文一行\n  ')).toBe('## 标题\n正文一行')
  })

  it('首尾空行剥掉，中间空行保留；没有缩进时原样（除首尾）', () => {
    expect(dedentBlock('\n\n第一段\n\n第二段\n\n')).toBe('第一段\n\n第二段')
  })

  it('空块（只有空白）回空串', () => {
    expect(dedentBlock('\n   \n\t\n')).toBe('')
  })

  it('各行的额外相对缩进保留：嵌套列表的层级不丢', () => {
    expect(dedentBlock('  - 甲\n    - 乙\n')).toBe('- 甲\n  - 乙')
  })
})

describe('moji:super 链接', () => {
  it('生成与解析 roundtrip：本节点形式（只有名字）', () => {
    const href = superLinkHref('对照组实验')
    expect(href).toBe('moji:super/' + encodeURIComponent('对照组实验'))
    expect(parseSuperHref(href)).toEqual({ nodeId: null, name: '对照组实验' })
  })

  it('生成与解析 roundtrip：跨节点形式（nodeId/名字）', () => {
    const md = superLinkMarkdown('那边的演示', '演示', '3f2a')
    expect(md).toBe('[那边的演示](moji:super/3f2a/' + encodeURIComponent('演示') + ')')
    expect(parseSuperHref('moji:super/3f2a/演示')).toEqual({ nodeId: '3f2a', name: '演示' })
  })

  it('手写没编码的中文也能解析；不合法的百分号编码不炸、原样返回', () => {
    expect(parseSuperHref('moji:super/句号器')).toEqual({ nodeId: null, name: '句号器' })
    const broken = parseSuperHref('moji:super/100%测试')
    expect(broken?.name).toBe('100%测试')
  })

  it('别的协议与空串返回 null', () => {
    expect(parseSuperHref('moji:node/abc')).toBeNull()
    expect(parseSuperHref('moji:doc/note')).toBeNull()
    expect(parseSuperHref('')).toBeNull()
    expect(parseSuperHref(null)).toBeNull()
  })
})

describe('超级文档里的公式：不带字体走', () => {
  it('去掉全部 @font-face（带字体进 opaque origin 必然 CORS 报错）', () => {
    const out = katexIframeCss(
      '@font-face{font-family:KaTeX_Main;src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2")}.katex{color:red}',
    )
    expect(out).not.toContain('@font-face')
    expect(out).not.toContain('woff2')
    // 版式规则一个字都不能少
    expect(out).toContain('.katex{color:red}')
  })

  it('改用 MathML：隐掉 .katex-html，放出 .katex-mathml', () => {
    const out = katexIframeCss('')
    expect(out).toContain('.katex-html{display:none !important}')
    expect(out).toContain('.katex-mathml{position:static')
    expect(out).toContain('.katex-display .katex-mathml{display:block}')
  })

  it('真盘上那份 katex.min.css 过完之后：一条 @font-face、一个 url() 都不剩', () => {
    // 直接用依赖里那份真文件：手写样例题测不出「正则漏了某种写法」
    const raw = readFileSync(new URL('../node_modules/katex/dist/katex.min.css', import.meta.url), 'utf-8')
    expect(raw).toContain('@font-face')
    expect(raw).toMatch(/KaTeX_[A-Za-z-]+\.woff2/)
    const out = katexIframeCss(raw)
    expect(out).not.toContain('@font-face')
    expect(out).not.toMatch(/KaTeX_[A-Za-z-]+\.(?:woff2?|ttf)/)
    expect(out).not.toMatch(/url\(/)
    // 公式的版式类还在（不然公式连排都排不出来）
    expect(out).toContain('.katex')
    expect(out).toContain('.katex-display')
  })
})
