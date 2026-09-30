import { renderNote } from './markdown'

/**
 * 超级文档的内置组件：<moji-markdown>…</moji-markdown>。
 *
 * 元素里直接写 markdown，渲染时按节点文档同一套管线（marked + DOMPurify，见
 * lib/markdown）解析成排版好的正文——标题、列表、代码块、表格、moji: 链接都认。
 * 这让「一段说明文字」不必退回手写 HTML：<p>、<strong> 一个个拼太费劲，
 * 也最容易写歪。
 *
 * 变换只发生在**渲染时刻**（SuperDocView 拼 srcDoc 与导出之前）：
 * 存进 store 的 HTML 原文一个字不动，用户在源码视图里看到的仍是自己写的
 * markdown——关掉渲染再看源码，内容不会「被替换掉」。
 *
 * 两个纪律（生成侧由提示词约定，见 learn/ai 的超级文档一节）：
 * - 内容**顶格写**：HTML 里缩进排版的 markdown，四格起会被当成代码块；
 *   渲染前这里还是会把公共缩进剥掉一道（dedentBlock），留一道保险。
 * - 内容里不要有裸的 `<`（要写 &lt;）：markdown 正文先要过一遍 HTML 解析，
 *   裸的 `<` 会被当成标签吃掉。
 */

export const MOJI_MARKDOWN_TAG = 'moji-markdown'

/** 去掉首尾空行与各行公共缩进；空块回空串 */
export function dedentBlock(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  if (!lines.length) return ''
  let indent: number | null = null
  for (const line of lines) {
    if (!line.trim()) continue
    const n = line.length - line.trimStart().length
    if (indent === null || n < indent) indent = n
  }
  if (!indent) return lines.join('\n')
  return lines.map((l) => (l.trim() ? l.slice(indent) : '')).join('\n')
}

/**
 * 注入超级文档 iframe 的 KaTeX 样式：**去掉 @font-face，改用浏览器原生 MathML 排**。
 *
 * 为什么必须这么改（两件事，缺一条都还是错的）：
 * 1. **字体根本加载不到**。iframe 是 sandbox 出来的 opaque origin（见 SuperDocView），
 *    而 katex.min.css 里的 `src:url(fonts/KaTeX_*.woff2)` 是**相对**地址——抄进 iframe 的
 *    文档之后它按宿主页面的地址解析：dev 下打到 Vite 的 SPA 回退（响应 200，内容却是
 *    index.html），打包版（file://）下直接打不开。控制台那一串
 *    「blocked by CORS policy / net::ERR_FAILED」就是它。
 * 2. 就算把地址补成绝对的也没用：opaque origin 的字体请求必须过 CORS，而 file://
 *    没有响应头可发。**所以要做的不是补地址，而是不要字体。**
 *
 * 办法与导出件（lib/export.css）一模一样，那边的理由已经写过一遍：
 * KaTeX 默认同时产出 `.katex-html`（靠它自己那 20 多个 woff2 才排得对）与
 * `.katex-mathml`（浏览器原生 MathML）。这里把前者隐掉、后者放出来——**零字体依赖**，
 * 公式由浏览器自己排，度量与字形都是对的。不隐掉 `.katex-html` 更糟：
 * 字体缺失时它不是「回落到衬线体」，而是散成一堆上下错位的 span。
 */
export function katexIframeCss(raw: string): string {
  // katex.min.css 里的 @font-face 都是平铺的单层块（没有嵌套的 {}），整块删掉即可
  return raw.replace(/@font-face\s*\{[^}]*\}/gi, '') + IFRAME_KATEX_MATHML
}

/** 与 lib/export.css 同一套规则（那边已验证过：导出的 HTML 在任何浏览器里都排得对） */
const IFRAME_KATEX_MATHML = [
  '.katex-html{display:none !important}',
  '.katex-mathml{position:static;clip:auto;width:auto;height:auto;overflow:visible;display:inline-block}',
  '.katex-mathml math{font-size:1.06em}',
  '.katex-display{margin:1.15em 0;padding:.25em 0;overflow-x:auto;overflow-y:hidden;text-align:center}',
  '.katex-display .katex-mathml{display:block}',
].join('')

/**
 * 把 html 里所有 <moji-markdown> 的内容渲染成 markdown。
 * 没有这类元素时原样返回（绝大多数文档零开销）；DOM 解析在渲染进程里做。
 */
export function renderEmbeddedMarkdown(html: string): string {
  if (!html || !new RegExp('<' + MOJI_MARKDOWN_TAG + '[\\s>/]', 'i').test(html)) return html
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const nodes = parsed.querySelectorAll(MOJI_MARKDOWN_TAG)
  if (!nodes.length) return html
  for (const el of Array.from(nodes)) {
    const raw = dedentBlock(el.textContent ?? '')
    el.innerHTML = raw ? renderNote(raw) : ''
  }
  const out = parsed.documentElement.outerHTML
  // parseFromString('text/html') 会丢掉 doctype：原文有的补回去，别让浏览器落到怪异模式
  return /<!doctype/i.test(html) ? '<!DOCTYPE html>\n' + out : out
}
