/**
 * 文档解析与渲染的耗时分解（一把尺子，不是正确性用例）。
 *
 * 为什么写成一个用例：这条链（markdown → HTML → 交给 React）是**纯函数**，
 * 用 vitest 跑一次就能把各段耗时分开——不必去启动整个应用看整体数字。
 * 需要 DOM 的只有 DOMPurify.sanitize 一步（它要 new DOMParser 解析 HTML），
 * 这里把它换成直通，于是剩下的都是真实开销：正则扫描、marked 词法/渲染、
 * KaTeX 排版、缓存。
 *
 * 阈值故意定得很松（谁都能过，慢十倍的机器也过）：它是防退化的底线，不是成绩单。
 * 真正的读数打在下面的表里，给人看的；要数字请跑：
 *
 *   node node_modules/vitest/vitest.mjs run tests/markdownPerf.test.ts
 *
 * 与本仓库「不把时间写进断言」的约定不冲突：这里断言的是量级（比如「缓存命中必须
 * 比冷渲染快一个数量级以上」），不是具体毫秒数。
 */
import { describe, expect, it, vi } from 'vitest'

// DOMPurify 在 node 下拿不到 document（见文件头）。直通之后 renderNote 量的就是
// 「正则 + marked + KaTeX + 缓存」这一段。真实浏览器里 sanitize 还要再走一遍
// HTML 解析与树遍历，那一段的量法在启动打点里（见 electron/startup.ts）。
vi.mock('dompurify', () => ({ default: { sanitize: (html: string) => html } }))

import katex from 'katex'
import { marked } from 'marked'
import { normalizeMathDelimiters, renderNote } from '../src/lib/markdown'

/* ---------- 计时与取样 ---------- */

interface Reading {
  median: number
  min: number
}

/**
 * 取中位数。冷渲染要**每次换一份内容**：renderNote 里有缓存，同一份源文第二次是
 * 命中缓存（那是另一件事，单独量）。这里用一句 HTML 注释把内容顶开。
 */
function bench(fn: (i: number) => void, runs = 9): Reading {
  fn(-1) // 预热一趟：JIT、KaTeX 的宏表与字体度量都在这一趟里建起来
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn(i)
    times.push(performance.now() - t0)
  }
  times.sort((a, b) => a - b)
  return { median: times[Math.floor(times.length / 2)], min: times[0] }
}

const ms = (v: number): string => v.toFixed(2).padStart(8)

function report(title: string, rows: Array<[string, Reading, string?]>): void {
  console.log('\n' + title)
  for (const [name, r, note] of rows) {
    console.log('  ' + name.padEnd(34) + ms(r.median) + ' ms   (最快 ' + ms(r.min) + ')' + (note ? '  ' + note : ''))
  }
}

/* ---------- 素材：按真实文档的形状造 ---------- */

const paragraph =
  '求导的本质是**局部线性化**：把 $f(x)$ 在 $x_0$ 附近看成一条直线，' +
  '斜率就是 $f^\\prime(x_0)$。这一节要练的是「看到 $\\sqrt{x^2}=|x|$ 就知道要先分情况」。'

const display = '$$\\int_0^1 x^2 \\,\\mathrm{d}x = \\frac{1}{3},\\qquad \\lim_{n\\to\\infty}\\left(1+\\frac{1}{n}\\right)^n = e$$'

/**
 * 造一份 markdown：mathPerSection 个行内公式 + 每节一个行间公式，
 * 另有标题、列表、表格、代码块、引用——与 `docs/*.md`（实测 9~14 KB、20~40 个公式）同量级。
 */
function doc(sections: number, mathPerSection: number): string {
  const out: string[] = ['# 函数与图像\n']
  for (let i = 0; i < sections; i++) {
    out.push('\n## ' + (i + 1) + '. 第 ' + (i + 1) + ' 节\n')
    out.push(paragraph + '\n')
    out.push('\n' + display + '\n')
    out.push('\n- 要点一：$x^2$ 与 $\\frac{\\mathrm{d}}{\\mathrm{d}x}x^2=2x$；\n- 要点二：$\\lim_{x\\to 0}\\frac{\\sin x}{x}=1$\n')
    out.push('\n| 记号 | 读法 |\n| --- | --- |\n| $\\Delta x$ | 增量 |\n| $\\mathrm{d}x$ | 微分 |\n')
    out.push('\n```js\nconst slope = (f, x) => (f(x + 1e-6) - f(x)) / 1e-6\n```\n')
    out.push('\n> 引用一段：$\\varepsilon$-$\\delta$ 语言把「接近」说清楚了。\n')
    for (let k = 0; k < mathPerSection; k++) out.push('\n第 ' + k + ' 个式子：$\\frac{' + k + '}{x^{' + (k + 1) + '}}+\\sqrt{' + k + 'x}$。\n')
  }
  return out.join('')
}

const small = doc(6, 4) // ≈ 真实教学文档
const big = doc(30, 6) // ≈ 十倍

/** 带 \`\`\`plot 代码块的那一份：真实教学文档里图像往往比公式还占地方（见 lib/plot.ts 的挂载） */
function withPlotBlocks(n: number): string {
  const spec = '{"title":"导数的图景","data":[{"fn":"x^2-2*x+2"}]}'
  return (
    doc(6, 4) +
    Array.from({ length: n }, () => '\n```' + 'plot\n' + spec + '\n```\n').join('')
  )
}

/** 输出的 HTML 有多大：这一步决定后面 React 往 DOM 里塞多少东西 */
function htmlStats(source: string): { html: number; tags: number } {
  const html = renderNote(source + '\n<!-- stats -->\n')
  return { html: html.length, tags: (html.match(/<[a-z]/g) ?? []).length }
}

describe('文档解析渲染的耗时分解', () => {
  it('各段耗时（读数打在表里）', () => {
    const src = small
    const normalized = normalizeMathDelimiters(src)

    report('一份教学文档（' + (src.length / 1024).toFixed(1) + ' KB，' + (src.match(/\$/g) ?? []).length / 2 + ' 个公式）', [
      ['normalizeMathDelimiters', bench(() => normalizeMathDelimiters(src))],
      ['marked.parse（含 KaTeX）', bench((i) => marked.parse(normalized + '\n<!-- b' + i + ' -->\n', { async: false }))],
      ['renderNote（全链，含缓存写）', bench((i) => renderNote(src + '\n<!-- r' + i + ' -->\n'))],
      ['renderNote 命中缓存', bench(() => renderNote(src))],
    ])

    const bigNormalized = normalizeMathDelimiters(big)
    report('十倍的文档（' + (big.length / 1024).toFixed(1) + ' KB）', [
      ['normalizeMathDelimiters', bench(() => normalizeMathDelimiters(big))],
      ['marked.parse（含 KaTeX）', bench((i) => marked.parse(bigNormalized + '\n<!-- b' + i + ' -->\n', { async: false }))],
      ['renderNote（全链）', bench((i) => renderNote(big + '\n<!-- r' + i + ' -->\n'), 5)],
    ])

    const s = htmlStats(src)
    console.log(
      '\n输出体量：' + (src.length / 1024).toFixed(1) + ' KB markdown → ' +
        (s.html / 1024).toFixed(1) + ' KB HTML（' + (s.html / src.length).toFixed(1) + ' 倍）、' +
        s.tags + ' 个元素',
    )

    // 量级底线（防退化）：一份教学文档的解析渲染在几百毫秒内必须完成，缓存命中必须近乎免费
    expect(bench((i) => renderNote(src + '\n<!-- g' + i + ' -->\n')).median).toBeLessThan(500)
    expect(bench(() => renderNote(src)).median).toBeLessThan(1)
  })

  it('这条链的开销几乎全在公式上：文字体量相同、公式数量不同就是全部差别', () => {
    const formula = '\\frac{\\sqrt{x^2+1}}{x-1} + \\int_0^1 e^{-t^2}\\,\\mathrm{d}t'

    /** 同样一句正文，只是少掉公式：用来分离「文字量」与「公式数量」 */
    const noMath = (n: number): string =>
      '# 标题\n\n' + Array.from({ length: n }, (_, i) => '第 ' + i + ' 个：一个不含公式的中文句子，长度与带公式的那句接近。').join('\n') + '\n'
    const withMath = (n: number): string =>
      '# 标题\n\n' + Array.from({ length: n }, (_, i) => '第 ' + i + ' 个：一个不含公式的中文句子，长度与带公式的那句接近：$' + formula + '$。').join('\n') + '\n'

    const flat = (n: number): Reading => bench((i) => renderNote(noMath(n) + '\n<!-- f' + i + ' -->\n'))
    const math = (n: number): Reading => bench((i) => renderNote(withMath(n) + '\n<!-- m' + i + ' -->\n'))

    report('60 段同样长的正文：带公式 / 不带公式', [
      ['不带公式', flat(60)],
      ['带 60 个公式', math(60)],
      ['单独一个 KaTeX 公式（热）', bench(() => katex.renderToString(formula, { throwOnError: false }))],
    ])

    // 边际成本：公式从 30 个加到 90 个，多出来的时间除以 60
    const few = math(30).median
    const many = math(90).median
    const perFormula = (many - few) / 60
    console.log(
      '\n  边际成本：每多一个行内公式 +' + perFormula.toFixed(3) + ' ms（30 个 ' + few.toFixed(2) + ' ms → 90 个 ' + many.toFixed(2) + ' ms）',
    )
    console.log('  纯文字的 60 段：' + flat(60).median.toFixed(2) + ' ms → 解析文字本身几乎不要钱')
    /*
     * KaTeX 的宏表（buildKatexCharMacros）是**模块导入时**建好的（见 markdown.ts 顶部），
     * 所以「第一个公式特别贵」并不出现在渲染里——那一笔算在渲染层脚本求值那一档。
     */

    const one = htmlStats('$' + formula + '$')
    console.log('  一个行内公式的 HTML：' + one.html + ' 字节、' + one.tags + ' 个元素')
    console.log('  → 这也是「解析只要几毫秒、排版要几百毫秒」的原因：产出比源文大两个数量级，全都要进 DOM')

    // 松到 2 ms（实测 0.25）：这是「防退化」，不是「必须多快」
    expect(perFormula).toBeLessThan(2)
    expect(flat(60).median).toBeLessThan(math(60).median)
  })

  it('切页签：第二次进同一份文档不再解析，要付的是 DOM 那一笔', () => {
    const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
    const time = (src: string): number => {
      const t0 = performance.now()
      renderNote(src)
      return performance.now() - t0
    }

    // 「切走再切回来」= 同一份源文再渲染一次。缓存按**源文**命中（见 markdown.ts 的 renderCache）
    const tabs = Array.from({ length: 6 }, (_, i) => doc(6, 4) + '\n<!-- tab' + i + ' -->\n')
    time(doc(6, 4) + '\n<!-- 预热，不污染下面这六份 -->\n')
    const cold = tabs.map(time)
    const hot = tabs.map(time)

    console.log('\n切页签：6 份文档，每份各进两次')
    console.log('  第一次进（解析 + KaTeX）：中位 ' + median(cold).toFixed(2) + ' ms  ' + cold.map((v) => v.toFixed(1)).join(' / '))
    console.log('  第二次进（命中缓存）：   中位 ' + median(hot).toFixed(2) + ' ms  ' + hot.map((v) => v.toFixed(1)).join(' / '))

    /*
     * 每切一次**必须重做**的 DOM 活儿（node 里量不到耗时，但能数清「要碰多少个节点」）：
     *   innerHTML 重建整篇 → hydrateAnnotations / markLearnLinks / hydratePlots / hydrateStaticFiles
     *   依次在这棵树上扫一遍（见 MarkdownView.tsx 的①）。
     * 这些数字就是切页签时那几百毫秒的原料——解析那一笔已经在缓存里了。
     */
    const withPlots = withPlotBlocks(3)
    const html = renderNote(withPlots + '\n<!-- stats -->\n')
    const count = (re: RegExp): number => (html.match(re) ?? []).length
    console.log(
      '\n  每切一次要重建/扫的 DOM（' + (withPlots.length / 1024).toFixed(1) + ' KB markdown → ' + (html.length / 1024).toFixed(1) + ' KB HTML）：\n' +
        '    元素 ' + count(/<[a-z]/g) + ' 个\n' +
        '    链接 ' + count(/<a /g) + ' 个（markLearnLinks 逐个查）\n' +
        '    公式 ' + count(/class="katex"/g) + ' 个\n' +
        '    函数图像占位 ' + count(/data-plot=/g) + ' 个（每个都要动态 import function-plot 再画一张 SVG）\n' +
        '    标题 ' + count(/<h[1-6][ >]/g) + ' 个（collectOutline 逐个读）',
    )

    // 缓存必须真的命中：第二次进同一条页签要近乎免费（实测 0.00 ms）
    expect(median(hot)).toBeLessThan(1)
    // 第一遍各份文档都得付一次解析（实测每份 8~12 ms）
    expect(median(cold)).toBeGreaterThan(median(hot))
  })
})
