/**
 * 这个文件负责什么：教学文档里的 **Tailwind 运行时**——把 Agent 写在正文里的工具类
 * （`class="grid grid-cols-2 gap-4"`）在渲染进程里现算成一份 CSS、注入 <head>，
 * 并把它**限定在文档正文这一块**里。导出（lib/exportDoc）与预览（components/MarkdownView）
 * 用的是这里同一份编译器。
 *
 * ## 为什么必须运行时算
 *
 * 文档是 Agent 在用户机器上现写的：类名不在任何源码文件里，构建期的 Tailwind 扫描
 * （@tailwindcss/vite 只扫 src/**）根本看不到它们。构建期能生成的只有「应用自己用过的那几十个类」，
 * 文档里写 bg-sunken 会一点样式都没有——这正是「提示词让模型用 Tailwind，界面上却没反应」的坑。
 * Tailwind 的核心编译器（tailwindcss/dist/lib.mjs）是纯 JS、不碰任何 node 内建模块，
 * 可以直接进渲染进程：初次 compile() 约 20ms（一次），之后每多一批类名 build() 只要几毫秒。
 *
 * ## 三件必须做对的事
 *
 * 1. **限定作用域**。算出来的 CSS 落在应用自己的页面上，不限定就会作用到整个界面
 *    （.flex / .grid / .p-4 满大街都是）。这里给正文容器挂上 DOC_TW_CLASS，
 *    再把每条选择器前缀成 `.moji-doc-tw.moji-doc-tw <原选择器>`：
 *    - 前缀里的那个类把作用范围钉死在文档正文里；
 *    - 同一个类**写两遍是有意的**：特异性抬到 (0,2,0)，
 *      压得住 .note-preview 那一层元素排版（.note-preview h2 是 (0,1,1)）。
 *      不抬这一档，`<h2 class="text-[19px]">` 的字号会被 .note-preview h2 盖掉——
 *      「写了 class 却没反应」里最难查的一类。
 * 2. **拆掉 @layer 的壳**。Tailwind 把工具类放进 @layer utilities，而 CSS 的层叠顺序是
 *    「无层级的规则赢过所有分层规则」：不拆壳，特异性再高也白搭。见 scopeDocCss。
 * 3. **主题跟着应用走**。文档里该写 bg-paper / text-ink / border-line 这些**应用自己的令牌**
 *    （深色模式自动跟随，见 styles/theme.css），所以编译器吃的是那份 @theme 块 + Tailwind 默认主题，
 *    而不是只有默认调色板。
 */
import DOC_THEME_CSS from './doc-theme.css?raw'
import APP_THEME_CSS from '../styles/theme.css?raw'
import TW_THEME_CSS from 'tailwindcss/theme.css?raw'
import TW_UTILITIES_CSS from 'tailwindcss/utilities.css?raw'

/** 挂在正文容器上的作用域类（MarkdownView 与导出件的 <main> 都带它） */
export const DOC_TW_CLASS = 'moji-doc-tw'

/**
 * 选择器前缀：同一个类写两遍是有意的，见文件头第 1 条。
 * 前缀与工具类自己那一个类相加是 (0,3,0)，比文档区里现有的一切规则都高。
 */
const SCOPE_SELECTOR = '.' + DOC_TW_CLASS + '.' + DOC_TW_CLASS

/* ---------- 编译入口 ---------- */

/**
 * 从应用主题文件里取出 `@theme { … }` 那一块。
 *
 * 为什么要「取出来」而不是整份塞进去：theme.css 里还有深色覆盖、各套扩展主题
 * （:root[data-theme='dark'] 这些），它们不该被复刻进文档那份样式表——
 * 文档里的颜色靠 var() 现取，深色模式由应用自己那套规则负责。
 */
function themeBlockOf(css: string): string {
  const at = /(^|\n)[ \t]*@theme[ \t]*\{/.exec(css)
  if (!at) return ''
  const open = css.indexOf('{', at.index + at[0].length - 1)
  const end = matchBrace(css, open)
  return end < 0 ? '' : css.slice(at.index, end + 1).trim()
}

const APP_THEME = themeBlockOf(APP_THEME_CSS)

/**
 * 编译器的入口 CSS。顺序有讲究：
 * - 两条 @import 必须在最前（CSS 的规矩），默认主题先来；
 * - 应用主题在后，覆盖掉默认的 --font-sans 这类同名令牌；
 * - 文档附加主题（动画）最后。
 * 只 import theme 与 utilities，**不 import preflight**：应用自己那份 index.css 已经
 * 带了一份 preflight，再来一份只会把文档区的默认边距重置两遍。
 */
const ENTRY_CSS = [
  '@import "tailwindcss/theme.css" layer(theme);',
  '@import "tailwindcss/utilities.css" layer(utilities);',
  APP_THEME,
  DOC_THEME_CSS,
].join('\n')

interface TwCompiler {
  build(candidates: string[]): string
}

/**
 * 起一个编译器实例。
 *
 * **两条 @import 的内容由构建期以 ?raw 带进来**：渲染进程里没有文件系统可读，
 * Tailwind 默认那套「按路径找文件」在这里行不通，loadStylesheet 必须自己答。
 */
async function makeCompiler(): Promise<TwCompiler> {
  const { compile } = await import('tailwindcss')
  return (await compile(ENTRY_CSS, {
    base: '/',
    loadStylesheet: async (id: string) => {
      const content = id.includes('utilities') ? TW_UTILITIES_CSS : id.includes('theme') ? TW_THEME_CSS : null
      if (content === null) throw new Error('文档 Tailwind 不认识这个 @import：' + id)
      return { path: id, base: '/', content }
    },
  })) as TwCompiler
}

/**
 * 会话共用的那一个。
 *
 * 文档一篇篇打开，类名只增不减，而编译器自己带着增量：每多一批类名只要几毫秒。
 * 模块本身按需分包，加载只做一次（见文件末尾的预热）。
 */
let shared: Promise<TwCompiler> | null = null
function loadCompiler(): Promise<TwCompiler> {
  shared ??= makeCompiler()
  return shared
}

/* ---------- 候选类名 ---------- */

/**
 * 正文里出现过的类名。
 *
 * 从 DOM 上取而不是拿正则扫 HTML 源文：源文里还带着 `<style>`、`<script>`、
 * 被转义的代码示例，扫出来一半是噪音；DOM 上留下的就是**真的会参与样式**的那些。
 * （代价是插件渲染期写进 class 的类名也要单独收，见 MarkdownView 里调用的时机。）
 */
export function docClassCandidates(root: Element): string[] {
  const out = new Set<string>()
  const take = (el: Element): void => {
    const cls = el.getAttribute('class')
    if (!cls) return
    for (const token of cls.split(/\s+/)) if (token) out.add(token)
  }
  take(root)
  for (const el of root.querySelectorAll('[class]')) take(el)
  return [...out]
}

/* ---------- 注入 ---------- */

let injected: HTMLStyleElement | null = null
function styleElement(): HTMLStyleElement {
  if (injected?.isConnected) return injected
  const el = document.createElement('style')
  el.setAttribute('data-moji-doc-tailwind', '')
  document.head.appendChild(el)
  injected = el
  return el
}

/** 已经交给主编译器的类名：新的一批只把差集递进去（build 是增量的，回的是全量 CSS） */
const known = new Set<string>()
let pending: string[] = []
let flushing = false

/**
 * 把一批新类名交给编译器，产物写回那一块 <style>。
 *
 * 共用一个 <style> 而不是一篇文档一块：同一批工具类在不同文档里必须**同序**，
 * 拆成多块之后 p-2 与 px-4 谁赢就取决于哪篇文档先渲染了。
 */
function flush(): void {
  if (flushing) return
  flushing = true
  void (async () => {
    try {
      while (pending.length) {
        const batch = pending
        pending = []
        const compiler = await loadCompiler()
        styleElement().textContent = scopeDocCss(compiler.build(batch))
      }
    } catch (err) {
      // 样式算不出来不该让文档渲染不出来：正文照旧显示，只是没有 Tailwind 那层样式
      console.warn('[doc-tailwind] 文档 Tailwind 编译失败', err)
    } finally {
      flushing = false
    }
  })()
}

/**
 * 正文（重新）渲染之后调一次：收类名、按需重算样式。
 *
 * 同步返回，编译在后台跑——渲染那一帧不该等它。首次调用会触发编译器分包加载，
 * 因此模块导入时就先热一下（见文件末尾）。
 */
export function hydrateDocTailwind(root: Element): void {
  const fresh = docClassCandidates(root).filter((c) => !known.has(c))
  if (!fresh.length) return
  for (const c of fresh) known.add(c)
  pending.push(...fresh)
  flush()
}

/**
 * 一篇文档用到的 Tailwind CSS（导出用，见 lib/exportDoc）：**独占编译**，
 * 产物只有这一篇的类名，不带会话里攒下的其它文档。
 */
export async function docTailwindCss(root: Element): Promise<string> {
  const candidates = docClassCandidates(root)
  if (!candidates.length) return ''
  const compiler = await makeCompiler()
  return scopeDocCss(compiler.build(candidates))
}

/* ---------- CSS 后处理 ---------- */

interface CssNode {
  /** 规则头：选择器，或 `@media …` 这类 at-rule 的前奏；可能带前导空白与注释 */
  prelude: string
  /** 花括号里的内容；null = 以分号收尾的语句（`@layer a, b;`） */
  body: string | null
}

/** 配平花括号：返回 open 位置上那个 `{` 对应的 `}` 下标；找不到返回 -1 */
function matchBrace(css: string, open: number): number {
  let depth = 0
  for (let i = open; i < css.length; i++) {
    const ch = css[i]
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      i = end < 0 ? css.length : end + 1
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      for (i++; i < css.length && css[i] !== quote; i++) if (css[i] === '\\') i++
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  return -1
}

/**
 * 把一段 CSS 切成「头 + 块」的序列。
 *
 * 手写而不是上解析器：这里的输入只有 Tailwind 自己的产物（结构固定、没有嵌套声明），
 * 需要处理的字符状态就三种——注释、字符串、花括号。
 */
function parseCss(css: string): CssNode[] {
  const nodes: CssNode[] = []
  let prelude = ''
  let i = 0
  while (i < css.length) {
    const ch = css[i]
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      const stop = end < 0 ? css.length : end + 2
      prelude += css.slice(i, stop)
      i = stop
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      let j = i + 1
      while (j < css.length && css[j] !== quote) {
        if (css[j] === '\\') j++
        j++
      }
      prelude += css.slice(i, Math.min(j + 1, css.length))
      i = j + 1
      continue
    }
    if (ch === '{') {
      const end = matchBrace(css, i)
      if (end < 0) {
        prelude += css.slice(i)
        break
      }
      nodes.push({ prelude, body: css.slice(i + 1, end) })
      prelude = ''
      i = end + 1
      continue
    }
    if (ch === ';') {
      nodes.push({ prelude: prelude + ';', body: null })
      prelude = ''
      i++
      continue
    }
    prelude += ch
    i++
  }
  if (prelude.trim()) nodes.push({ prelude, body: null })
  return nodes
}

/** 前导空白与注释：加前缀时要把它们留在原位，别塞到选择器后面去 */
const TRIVIA = /^(?:\s|\/\*[\s\S]*?\*\/)*/

/**
 * 一条规则头「真正说的东西」：剥掉前导注释与空白之后剩下的部分。
 *
 * 判「这是不是 at-rule」必须用它，不能用 trim()——Tailwind 的产物第一行是它的版权注释，
 * 那条注释会并进紧随其后的 @layer theme 的规则头里；拿整段去 startsWith('@') 会判成普通选择器，
 * 于是 :root 那一块被加上文档作用域前缀，写成 `.moji-doc-tw.moji-doc-tw @layer theme {…}`——
 * 浏览器整块丢弃（@layer 不能出现在选择器后面），主题变量一个都不生效，
 * bg-paper 这种「工具类算了但变量没定义」的样式就会静默失效。
 */
function headOf(prelude: string): string {
  return prelude.slice((TRIVIA.exec(prelude)?.[0] ?? '').length).trim()
}

/** 顶层逗号切分选择器列表（`:is(a, b)` 与 `[a=","]` 里的逗号不算） */
function splitSelectors(selector: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i]
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (ch === '"' || ch === "'") {
      const quote = ch
      current += ch
      for (i++; i < selector.length && selector[i] !== quote; i++) {
        if (selector[i] === '\\') {
          current += selector[i]
          i++
        }
        current += selector[i] ?? ''
      }
      current += quote
      continue
    }
    if (ch === ',' && depth === 0) {
      out.push(current)
      current = ''
      continue
    }
    current += ch
  }
  out.push(current)
  return out
}

/**
 * 一条规则头 → 带上作用域前缀的规则头。
 *
 * 前后空白与注释留在原位（产物照样是人能读的 CSS，将来要排查样式时不必先过一道格式化），
 * 只给选择器本身加前缀。
 */
function scopedPrelude(prelude: string): string {
  const leading = TRIVIA.exec(prelude)?.[0] ?? ''
  const rest = prelude.slice(leading.length)
  const trailing = /\s*$/.exec(rest)?.[0] ?? ''
  const selector = rest.slice(0, rest.length - trailing.length)
  if (!selector.trim()) return prelude
  const prefixed = splitSelectors(selector)
    .map((part) => (part.trim() ? SCOPE_SELECTOR + ' ' + part.trim() : part))
    .join(', ')
  return leading + prefixed + trailing
}

/** 这些 at-rule 的内容不是选择器（`0% { … }`、`from { … }` 之类），不许加前缀 */
const OPAQUE_AT_RULES =
  /^@(?:-[a-z]+-)?(?:keyframes|font-face|font-feature-values|property|counter-style|page|viewport)\b/i

/** 递归给工具类加前缀；at-rule 只往下钻「里面还是选择器」的那几种 */
function scopeRules(css: string): string {
  let out = ''
  for (const node of parseCss(css)) {
    if (node.body === null) {
      out += node.prelude
      continue
    }
    const head = headOf(node.prelude)
    if (head.startsWith('@')) {
      if (OPAQUE_AT_RULES.test(head)) out += node.prelude + '{' + node.body + '}'
      else out += node.prelude + '{' + scopeRules(node.body) + '}'
      continue
    }
    out += scopedPrelude(node.prelude) + '{' + node.body + '}'
  }
  return out
}

/**
 * Tailwind 的产物 → 只作用于文档正文的那一份。
 *
 * - `@layer utilities { … }` **去壳**再逐条加前缀（去壳的理由见文件头第 2 条）；
 * - 其余顶层块（@layer theme 的 :root 令牌、@property、@keyframes、@layer properties 的
 *   `*` 重置）原样留着：主题变量必须落在 :root 上，深色模式的覆盖才盖得住它；
 *   这些规则与文档区无关，全局生效反而与应用自己那份产物完全一致。
 * - 兜底：万一将来 Tailwind 把某条工具类吐在层外，顶层选择器同样加前缀——
 *   宁可多限定一层，也不要让它作用到整个界面。
 */
export function scopeDocCss(css: string): string {
  let out = ''
  for (const node of parseCss(css)) {
    if (node.body === null) {
      out += node.prelude
      continue
    }
    const head = headOf(node.prelude)
    const layer = /^@layer\s+([\w.-]+)/.exec(head)
    if (layer && layer[1] === 'utilities') {
      out += scopeRules(node.body)
      continue
    }
    if (head.startsWith('@')) {
      out += node.prelude + '{' + node.body + '}'
      continue
    }
    out += scopedPrelude(node.prelude) + '{' + node.body + '}'
  }
  return out
}

/* ---------- 预热 ---------- */

/**
 * 导入即热一次编译器：文档是应用的主界面，第一次打开就在眼前，
 * 而那一次分包加载（约 200KB JS）落在渲染那一帧上是看得见的卡顿。
 * 空闲时先把它拉起来，真正要编译时只剩几毫秒的 build。
 */
if (typeof requestIdleCallback === 'function') requestIdleCallback(() => void loadCompiler().catch(() => {}))
else setTimeout(() => void loadCompiler().catch(() => {}), 1500)
