/**
 * 主题：把 TextMate 的 scopes 归成「令牌类型」，颜色交给 CSS——**语法只产 scopes，颜色只在这里定**。
 *
 * 两条设计，都是为了「换主题不重新解析」：
 * 1. 渲染出来的是 `<span class="tok tok-keyword">`，**不带颜色**；
 * 2. 颜色来自 CSS 变量（`--color-code-keyword` 这一套）。它们在 index.css 里按应用主题
 *    各有一份（浅色一套、深色族一套），所以切换浅色/深色是纯 CSS 的事，一个 token
 *    都不用重算——这比「重新映射 scope → color」还要省一步。
 *
 * 「自定义主题」= 给一份 CodeTheme（令牌类型 → 颜色）。它被写成**这块代码上的内联
 * CSS 变量**，于是同一份已高亮的 HTML 换个变量表就换了配色，依然不必重新 tokenize。
 */
import type { HighlightToken, HighlightedCode } from './SyntaxHighlighter'

/** 令牌类型：scope 归类的落点，也是 CSS 类名（`.tok-<type>`）与变量的后缀 */
export type TokenType =
  | 'plain'
  | 'comment'
  | 'string'
  | 'number'
  | 'constant'
  | 'keyword'
  | 'operator'
  | 'punctuation'
  | 'function'
  | 'type'
  | 'variable'
  | 'tag'
  | 'builtin'
  | 'meta'
  | 'invalid'

/**
 * scope 前缀 → 令牌类型，**从上到下先匹配上的赢**。
 *
 * 匹配方式是「拿令牌的 scope 栈从里往外找」（见 tokenTypeOf）：越靠里的 scope 越具体，
 * 所以 `keyword.operator.js` 会先撞上 keyword.operator 这一条，而不是笼统的 keyword。
 */
const SCOPE_RULES: ReadonlyArray<readonly [string, TokenType]> = [
  // 定义符要跟着它定义的东西走：`//` 是注释的一部分、引号是字符串的一部分，
  // 不写这几条的话它们会落到下面笼统的 punctuation 上，颜色就断层了
  ['punctuation.definition.comment', 'comment'],
  ['punctuation.definition.string', 'string'],
  ['punctuation.definition.tag', 'tag'],
  ['comment', 'comment'],
  ['string', 'string'],
  ['constant.numeric', 'number'],
  ['constant.character', 'string'],
  ['constant.language', 'constant'],
  ['constant', 'constant'],
  ['keyword.operator', 'operator'],
  ['keyword.control', 'keyword'],
  // const/let/function 这类在 TextMate 里是 storage.*：各家主题一律按关键字上色
  // （VS Code 的 Dark+/Light+ 都是），所以归 keyword 而不是 type。type 留给真正的类型名。
  ['storage', 'keyword'],
  ['keyword', 'keyword'],
  ['entity.name.function', 'function'],
  ['entity.name.type', 'type'],
  ['entity.name.class', 'type'],
  ['entity.name.tag', 'tag'],
  ['entity.other.attribute-name', 'tag'],
  ['entity.name', 'function'],
  ['entity.other', 'variable'],
  ['variable.function', 'function'],
  ['variable.parameter', 'variable'],
  ['variable', 'variable'],
  ['support.function', 'builtin'],
  ['support.class', 'type'],
  ['support.type', 'type'],
  ['support.constant', 'constant'],
  ['support', 'builtin'],
  ['meta.preprocessor', 'meta'],
  ['meta.decorator', 'meta'],
  ['meta.annotation', 'meta'],
  ['meta', 'meta'],
  ['punctuation', 'punctuation'],
  ['invalid', 'invalid'],
  // Markdown / 其它标记语言
  ['markup.heading', 'keyword'],
  ['markup.bold', 'type'],
  ['markup.italic', 'type'],
  ['markup.inserted', 'string'],
  ['markup.deleted', 'invalid'],
  ['markup', 'meta'],
]

/**
 * 拿令牌的 scope 栈定类型：**从最里层往外**找，第一个匹配上的规则说了算。
 * 一条都没有（比如纯文本、或者语法没给 scope）时给 'plain'——渲染时不上色。
 */
export function tokenTypeOf(scopes: readonly string[]): TokenType {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i]
    if (!scope) continue
    for (const [prefix, type] of SCOPE_RULES) {
      if (scope === prefix || scope.startsWith(prefix + '.')) return type
    }
  }
  return 'plain'
}

/* ---------- 主题 ---------- */

export interface CodeTheme {
  id: string
  name: string
  /** 令牌类型 → 颜色。空对象＝交给应用主题的 CSS 变量（默认那一份就是这样） */
  colors: Partial<Record<TokenType, string>>
}

/** 令牌类型 → CSS 变量名。变量在 index.css 里按主题各有一份 */
const VAR_OF: Record<TokenType, string> = {
  plain: '',
  comment: '--color-code-comment',
  string: '--color-code-string',
  number: '--color-code-number',
  constant: '--color-code-number',
  keyword: '--color-code-keyword',
  operator: '--color-code-punct',
  punctuation: '--color-code-punct',
  function: '--color-code-function',
  type: '--color-code-type',
  variable: '--color-code-variable',
  tag: '--color-code-tag',
  builtin: '--color-code-builtin',
  meta: '--color-code-meta',
  invalid: '--color-code-invalid',
}

/** 默认主题：跟随应用（颜色全部来自 index.css 的变量，浅色/深色自动跟着变） */
export const AUTO_THEME: CodeTheme = { id: 'auto', name: '跟随应用主题', colors: {} }

/**
 * 两套自带配色（One Light / One Dark 的调子）。它们**不是**默认——
 * 默认跟随应用主题；这两套是「自定义主题」的样板，也能给导出件或将来的
 * 「代码配色」选项直接用。
 */
export const LIGHT_THEME: CodeTheme = {
  id: 'light',
  name: '浅色',
  colors: {
    comment: '#a0a1a7',
    string: '#50a14f',
    number: '#986801',
    keyword: '#a626a4',
    function: '#4078f2',
    type: '#c18401',
    variable: '#e45649',
    tag: '#e45649',
    builtin: '#0184bc',
    meta: '#4078f2',
    operator: '#6e665b',
    punctuation: '#6e665b',
  },
}

export const DARK_THEME: CodeTheme = {
  id: 'dark',
  name: '深色',
  colors: {
    comment: '#5c6370',
    string: '#98c379',
    number: '#d19a66',
    keyword: '#c678dd',
    function: '#61afef',
    type: '#e5c07b',
    variable: '#e06c75',
    tag: '#e06c75',
    builtin: '#56b6c2',
    meta: '#61afef',
    operator: '#abb2bf',
    punctuation: '#abb2bf',
  },
}

export const CODE_THEMES: CodeTheme[] = [AUTO_THEME, LIGHT_THEME, DARK_THEME]

/** 主题 → 该写到代码块上的内联 CSS 变量（默认主题是空的：让它走 index.css） */
export function themeStyleVars(theme: CodeTheme = AUTO_THEME): Record<string, string> {
  const style: Record<string, string> = {}
  for (const [type, color] of Object.entries(theme.colors) as Array<[TokenType, string]>) {
    const name = VAR_OF[type]
    if (name && color) style[name] = color
  }
  return style
}

/* ---------- Tokens → HTML ---------- */

export interface RenderedCode {
  /** 代码本体（已转义、已包 span），放进 <code> 里 */
  html: string
  /** 要写到这块代码上的内联变量（自定义主题用；默认主题是空对象） */
  style: Record<string, string>
}

const HTML_ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/**
 * 文本转义。渲染这一层自己带一份，免得语法层反过来依赖渲染/插件那些模块
 * （另一份在 lib/htmlEscape，导出与插件渲染共用它；两份转的是同样的五个字符）。
 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] as string)
}

/**
 * Tokens → HTML。**UI 只做这一件事**，tokenization 与颜色都不在这里。
 *
 * 相邻且同类型的令牌会合并成一个 span：一份语法正常的代码，这样能少掉大约一半的
 * 节点（`const` 与它后面的空格常被切成两段同类型令牌）。
 */
export function renderHighlight(code: HighlightedCode, theme: CodeTheme = AUTO_THEME): RenderedCode {
  if (code.plain) return { html: escapeHtml(code.code), style: {} }
  const lines = code.lines.map(renderLine)
  return { html: lines.join('\n'), style: themeStyleVars(theme) }
}

function renderLine(row: HighlightToken[]): string {
  let html = ''
  let buffer = ''
  let current: TokenType | null = null
  const flush = () => {
    if (!buffer) return
    // plain（没归到任何一类）不包 span：包了只会多出一堆没用的节点
    const wrap = current && current !== 'plain'
    html += wrap ? `<span class="tok tok-${current}">${escapeHtml(buffer)}</span>` : escapeHtml(buffer)
    buffer = ''
  }
  for (const token of row) {
    const type = tokenTypeOf(token.scopes)
    if (type !== current) {
      flush()
      current = type
    }
    buffer += token.text
  }
  flush()
  return html
}
