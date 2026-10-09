/**
 * 文档 Tailwind 运行时（见 lib/docTailwind）。
 *
 * 钉住的是**转换本身**，不是 Tailwind 能生成什么：
 * - 每一条工具类的选择器都必须带上作用域前缀，且不能再待在 @layer utilities 里
 *   （分层规则输给一切无层级规则，不拆壳特异性再高也没用）；
 * - 主题令牌、@property、@keyframes 这些**不能**加前缀（加到 :root 上深色模式就废了）；
 * - 候选类名从 DOM 上收，重复的只算一个。
 *
 * 最后一条是整条管线的联调用例：真起一个 Tailwind 编译器，看 bg-paper 这类
 * **应用自己的令牌**认不认——这是「提示词让模型写 bg-paper，界面上却是白底」的防线。
 */
import { describe, expect, it } from 'vitest'
import { DOC_TW_CLASS, docClassCandidates, docTailwindCss, scopeDocCss } from '../src/lib/docTailwind'

/** 假的正文根：只需要 getAttribute 与 querySelectorAll（node 环境里没有 DOM） */
function fakeRoot(classes: string[], nested: string[] = []): Element {
  return {
    getAttribute: (name: string) => (name === 'class' ? classes.join(' ') : null),
    querySelectorAll: () => nested.map((c) => ({ getAttribute: () => c })),
  } as unknown as Element
}

describe('文档 Tailwind · CSS 转换', () => {
  it('工具类去壳加前缀，令牌与关键帧原样留着', () => {
    const input = [
      '@layer theme{',
      ':root, :host {--color-ink: #2e2a25}',
      '}',
      '@layer utilities{',
      '.flex {display: flex}',
      '.md\\:grid-cols-2 {grid-template-columns: repeat(2, minmax(0, 1fr))}',
      '@media (hover: hover) {.hover\\:bg-sunken:hover {background-color: var(--color-sunken)}}',
      ':where(.space-y-2 > :not(:last-child)) {margin-block-start: calc(var(--spacing) * 2)}',
      '}',
      '@keyframes pulse {50% {opacity: .5}}',
      '@property --tw-border-style {syntax: "*"; inherits: false}',
      '@layer properties{',
      '@supports (display: grid) {*, ::before {--tw-border-style: solid}}',
      '}',
    ].join('')

    const out = scopeDocCss(input)
    const scope = '.' + DOC_TW_CLASS + '.' + DOC_TW_CLASS

    // 去壳：产物里不再有 utilities 这一层（theme / properties 那两层要留着）
    expect(out).not.toContain('@layer utilities')
    expect(out).toContain('@layer theme')
    // 每一条工具类都带前缀，转义过的类名与伪类原样保留
    expect(out).toContain(scope + ' .flex {display: flex}')
    expect(out).toContain(scope + ' .md\\:grid-cols-2 {')
    expect(out).toContain(scope + ' .hover\\:bg-sunken:hover {')
    // :where(...) 开头的那一类（space-y / divide-*）同样吃前缀
    expect(out).toContain(scope + ' :where(.space-y-2 > :not(:last-child)) {')
    // @media 里外都要加：前奏不带前缀，里面那条带上
    expect(out).toContain('@media (hover: hover) {' + scope + ' ')
    // 令牌落在 :root 上，**不能**被搬进文档作用域（搬了深色模式的覆盖就盖不住它）
    expect(out).toContain(':root, :host {--color-ink: #2e2a25}')
    // 关键帧里的 50% 不是选择器，@property 同理
    expect(out).toContain('@keyframes pulse {50% {opacity: .5}}')
    expect(out).toContain('@property --tw-border-style {syntax: "*"; inherits: false}')
    expect(out).not.toContain(scope + ' 50%')
  })

  it('选择器列表逐条加前缀，:is() 里的逗号不算分隔', () => {
    const out = scopeDocCss('@layer utilities{.a, :is(.b, .c) {color: red}}')
    const scope = '.' + DOC_TW_CLASS + '.' + DOC_TW_CLASS
    expect(out).toBe(scope + ' .a, ' + scope + ' :is(.b, .c) {color: red}')
  })

  it('第一行是版权注释时，@layer theme 不会被误当成选择器（真实产物的形状）', () => {
    // Tailwind 的产物长这样：版权注释并进紧随其后的 @layer theme 的规则头里。
    // 误判的代价是整块 :root 变量被加前缀后失效——bg-paper 会静默变成透明。
    const input = [
      '/*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com */',
      '@layer theme {',
      '  :root, :host {--color-paper: #f5f2eb}',
      '}',
      '@layer utilities {',
      '  /* 工具类也可能带注释 */',
      '  .grid {display: grid}',
      '}',
    ].join('\n')
    const out = scopeDocCss(input)
    expect(out).toContain('@layer theme {')
    expect(out).not.toContain('.moji-doc-tw.moji-doc-tw @layer theme')
    expect(out).toContain(':root, :host {--color-paper: #f5f2eb}')
    // 注释留在原位，工具类照旧加前缀
    expect(out).toContain('/* 工具类也可能带注释 */')
    expect(out).toContain('.' + DOC_TW_CLASS + '.' + DOC_TW_CLASS + ' .grid {')
  })

  it('层外冒出来的顶层规则也加前缀（兜底）', () => {
    const out = scopeDocCss('.stray {color: red}')
    expect(out).toBe('.' + DOC_TW_CLASS + '.' + DOC_TW_CLASS + ' .stray {color: red}')
  })
})

describe('文档 Tailwind · 候选类名', () => {
  it('从根与后代身上收类名，重复的只算一个', () => {
    const root = fakeRoot(['moji-doc-tw', 'flex'], ['flex gap-4', 'bg-sunken'])
    expect(docClassCandidates(root)).toEqual(['moji-doc-tw', 'flex', 'gap-4', 'bg-sunken'])
  })
})

describe('文档 Tailwind · 编译', () => {
  it('应用自己的令牌与文档动画都认，产物全部限定在正文里', async () => {
    const css = await docTailwindCss(
      fakeRoot(['grid', 'grid-cols-2', 'gap-4', 'bg-paper', 'text-ink', 'border-line', 'animate-doc-rise']),
    )
    const scope = '.' + DOC_TW_CLASS + '.' + DOC_TW_CLASS
    expect(css).toContain(scope + ' .grid')
    expect(css).toContain('var(--color-paper)')
    // 变量本身也得有定义，而且必须落在 :root 上（进了作用域前缀那一块就等于没定义）
    expect(css).toContain('--color-paper: #f5f2eb')
    expect(css).toMatch(/:root, :host \{[^}]*--color-paper/)
    expect(css).toContain('var(--color-ink)')
    expect(css).toContain('var(--color-line)')
    // 文档附加主题里的动画（见 lib/doc-theme.css）
    expect(css).toContain('@keyframes doc-rise')
    expect(css).not.toContain('@layer utilities')
    // 没有前缀的工具类一个都不该漏出去
    expect(css).not.toMatch(/(^|\n)\.grid \{/)
  })

  it('一篇没有类名的文档不产出样式', async () => {
    expect(await docTailwindCss(fakeRoot([]))).toBe('')
  })
})
