/**
 * 导出文档的单元用例。
 *
 * 钉的是三件事，它们错了都不会当场报错，只会让用户拿到一个坏文件：
 * 1. 建议文件名——标题里的 / \ : * ? " < > | 会让保存对话框直接失败，
 *    而以 . 或空格结尾、或叫 CON 的名字在 Windows 上根本存不下来；
 * 2. 转义——标题与元信息是从学习数据里来的字符串，进 HTML 之前必须转义；
 * 3. 自足性——导出件**不能引用任何外部资源**（样式、字体、图片），
 *    否则「发给别人」这件事就只剩一个空壳。
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import {
  EXPORT_FORMATS,
  escapeHtml,
  exportFileName,
  fileBaseName,
  formatInfo,
  standaloneHtml,
} from '../src/lib/exportDoc'
/*
 * vitest 会把 .css 一律短路成空模块（连 ?raw 也一样，打开 css: true 也不行），
 * 而 exportDoc 里的 EXPORT_CSS 正是那句 ?raw 导入——不替它一把，
 * 「样式内嵌了吗」这条用例就会拿到空串、在什么都没检查的情况下变绿。
 * 应用构建里没这回事：产物中就是这段 CSS 原文（见 dist 里的 export-title 字样）。
 */
vi.mock('../src/lib/export.css?raw', async () => {
  const { readFileSync } = await import('node:fs')
  return { default: readFileSync(new URL('../src/lib/export.css', import.meta.url), 'utf-8') }
})

/** 直接读盘的这一份用来单独检查样式表本身（有没有外部引用） */
const EXPORT_CSS = readFileSync(new URL('../src/lib/export.css', import.meta.url), 'utf-8')

describe('建议文件名', () => {
  it('换成空格并压掉连续空白', () => {
    expect(fileBaseName('极限/夹逼定理')).toBe('极限 夹逼定理')
    expect(fileBaseName('a:b*c?d"e<f>g|h')).toBe('a b c d e f g h')
    expect(fileBaseName('  多个   空格  ')).toBe('多个 空格')
  })

  it('反斜杠与冒号同样要换掉（Windows 上这两个最常踩）', () => {
    expect(fileBaseName('a\\b:c')).toBe('a b c')
  })

  it('结尾的句点与空格去掉（Windows 会悄悄丢掉它们）', () => {
    expect(fileBaseName('第一章。.')).toBe('第一章。')
    expect(fileBaseName('名字 ... ')).toBe('名字')
  })

  it('空标题给一个能用的名字，而不是空文件名', () => {
    expect(fileBaseName('')).toBe('未命名文档')
    expect(fileBaseName('   ')).toBe('未命名文档')
    expect(fileBaseName('///')).toBe('未命名文档')
  })

  it('Windows 的保留设备名要躲开，带后缀也一样', () => {
    expect(fileBaseName('CON')).toBe('文档-CON')
    expect(fileBaseName('com1')).toBe('文档-com1')
    expect(fileBaseName('console')).toBe('console')
  })

  it('超长标题截断到 64 个字符', () => {
    expect(fileBaseName('字'.repeat(200))).toHaveLength(64)
  })

  it('后缀跟着格式走', () => {
    expect(exportFileName('夹逼定理', 'md')).toBe('夹逼定理.md')
    expect(exportFileName('夹逼定理', 'html')).toBe('夹逼定理.html')
    expect(exportFileName('夹逼定理', 'pdf')).toBe('夹逼定理.pdf')
  })
})

describe('格式清单', () => {
  it('三种格式的 id 与后缀都不重样', () => {
    expect(EXPORT_FORMATS.map((f) => f.id)).toEqual(['md', 'html', 'pdf'])
    expect(new Set(EXPORT_FORMATS.map((f) => f.ext)).size).toBe(3)
  })

  it('认不出的格式退回第一项，而不是抛异常', () => {
    expect(formatInfo('nope' as 'md').id).toBe('md')
  })
})

describe('转义', () => {
  it('五个字符一个不少', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
  })

  it('标题里的标签不会变成真的标签', () => {
    const html = standaloneHtml({
      title: '<script>alert(1)</script>',
      meta: [],
      body: '<p>正文</p>',
      theme: 'light',
      stamp: '2026-02-11 10:00',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('整页 HTML', () => {
  const html = standaloneHtml({
    title: '夹逼定理',
    meta: ['极限 / 夹逼定理', '教学文档', '1200 字'],
    body: '<h2>定理</h2><p>设 $a_n$ 满足…</p>',
    theme: 'dark',
    stamp: '2026-02-11 10:00',
  })

  it('配色写在 html 上，深色导出件照深色来', () => {
    expect(html).toContain('data-theme="dark"')
    expect(standaloneHtml({ title: 't', meta: [], body: '', theme: 'light', stamp: '' })).toContain(
      'data-theme="light"',
    )
  })

  it('标题与元信息都在，正文原样放进去', () => {
    expect(html).toContain('<h1 class="export-title">夹逼定理</h1>')
    expect(html).toContain('<span>极限 / 夹逼定理</span>')
    expect(html).toContain('<h2>定理</h2><p>设 $a_n$ 满足…</p>')
    expect(html).toContain('由 归一 Unyra 导出')
  })

  it('样式内嵌在文件里，没有第二个请求', () => {
    expect(html).toContain('<style>')
    expect(html).toContain('.note-preview h1')
    // 正文样式表里不能出现 url(…)：那意味着它要去取字体或图片，而导出件必须能离线打开
    expect(EXPORT_CSS).not.toMatch(/url\(/)
    expect(EXPORT_CSS).not.toContain('@import')
  })

  it('公式走 MathML：KaTeX 的 HTML 那份被隐掉，字体依赖因此为零', () => {
    expect(EXPORT_CSS).toMatch(/\.katex-html\s*\{\s*display:\s*none/)
    expect(EXPORT_CSS).toMatch(/\.katex-mathml\s*\{[^}]*position:\s*static/)
  })

  it('没有元信息时不渲染那一格空壳', () => {
    expect(standaloneHtml({ title: 't', meta: [], body: '', theme: 'light', stamp: '' })).not.toContain(
      'class="export-meta"',
    )
  })

  it('正文里的 Tailwind 样式跟着文件走，作用域类挂在这一列上', () => {
    const withCss = standaloneHtml({
      title: 't',
      meta: [],
      body: '<div class="grid grid-cols-2">x</div>',
      docCss: '.moji-doc-tw.moji-doc-tw .grid {display: grid}',
      theme: 'light',
      stamp: '',
    })
    expect(withCss).toContain('class="note-preview moji-doc-tw"')
    expect(withCss).toContain('.moji-doc-tw.moji-doc-tw .grid')
    // 没给就没有那第二块 <style>（正文一个工具类都没有时不该多出一段空样式）
    expect(withCss.split('<style>').length - 1).toBe(2)
    expect(html.split('<style>').length - 1).toBe(1)
  })
})
