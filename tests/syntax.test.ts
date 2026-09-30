/**
 * 代码块语法高亮（src/syntax）。
 *
 * 分两层钉：
 * - **纯逻辑**：语言识别、scope → 令牌类型、Tokens → HTML、主题变量——这些不碰引擎；
 * - **真引擎那一条**：用真的 vscode-textmate + 真的 JavaScript 语法跑一遍代码块，
 *   确认 scope 拿到手、并按我们那张表落到了预期的令牌类型上。这条最有价值——
 *   它证明的不是「我们的表长这样」，而是「真语法接进来之后整条链路是通的」。
 *
 * 引擎测试自带 oniguruma 的 wasm（从 node_modules 里读），不碰网络、不碰 DOM。
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as onigNs from 'vscode-oniguruma'
import * as vsctmNs from 'vscode-textmate'
import type { IRawGrammar } from 'vscode-textmate'
import jsGrammar from '@shikijs/langs/javascript'
import { languageOfClass } from '../src/lib/codeHighlight'
import { LANGUAGES, resolveLanguageId } from '../src/syntax/LanguageAliases'
import { GRAMMAR_LOADERS, type GrammarLike, type GrammarRegistry } from '../src/syntax/GrammarRegistry'
import { clearHighlightCache, highlight, type HighlightedCode } from '../src/syntax/SyntaxHighlighter'
import { AUTO_THEME, DARK_THEME, renderHighlight, themeStyleVars, tokenTypeOf } from '../src/syntax/Theme'

/* ---------- 语言识别 ---------- */

describe('语言识别（LanguageAliases）', () => {
  it('别名、大小写、scopeName 都认', () => {
    expect(resolveLanguageId('js')).toBe('javascript')
    expect(resolveLanguageId('JavaScript')).toBe('javascript')
    expect(resolveLanguageId('source.js')).toBe('javascript')
    expect(resolveLanguageId('ts')).toBe('typescript')
    expect(resolveLanguageId('py')).toBe('python')
    expect(resolveLanguageId('bash')).toBe('shellscript')
    expect(resolveLanguageId('sh')).toBe('shellscript')
    expect(resolveLanguageId('c++')).toBe('cpp')
    expect(resolveLanguageId('yml')).toBe('yaml')
    expect(resolveLanguageId('  md  ')).toBe('markdown')
  })

  it('认不出来一律 null —— 宁可不上色，也不按别的语言乱染', () => {
    expect(resolveLanguageId('')).toBeNull()
    expect(resolveLanguageId(undefined)).toBeNull()
    expect(resolveLanguageId('中文')).toBeNull()
    expect(resolveLanguageId('text')).toBeNull()
  })

  it('语言表与加载表一一对应（加语言时两边都要写）', () => {
    const ids = LANGUAGES.map((l) => l.id).sort()
    expect(Object.keys(GRAMMAR_LOADERS).sort()).toEqual(ids)
    for (const id of ids) expect(typeof GRAMMAR_LOADERS[id]).toBe('function')
  })
})

describe('从 <code class> 里认语言（lib/codeHighlight）', () => {
  it('marked 给的是 language-xxx；别名照样归一到 languageId', () => {
    expect(languageOfClass('language-js')).toBe('javascript')
    expect(languageOfClass('language-python hljs')).toBe('python')
    expect(languageOfClass('language-c++')).toBe('cpp')
  })

  it('没写语言 / 认不出来：null（按纯文本处理，不猜）', () => {
    expect(languageOfClass('')).toBeNull()
    expect(languageOfClass('prettyprint')).toBeNull()
    expect(languageOfClass('language-火星文')).toBeNull()
  })
})

/* ---------- scope → 令牌类型 ---------- */

describe('scope 归类（Theme.tokenTypeOf）', () => {
  const type = (scope: string) => tokenTypeOf(['source.js', scope])

  it('最常见的几类', () => {
    expect(type('comment.line.double-slash.js')).toBe('comment')
    expect(type('string.quoted.double.js')).toBe('string')
    expect(type('constant.numeric.decimal.js')).toBe('number')
    expect(type('keyword.operator.assignment.js')).toBe('operator')
    expect(type('entity.name.function.js')).toBe('function')
    expect(type('variable.other.constant.js')).toBe('variable')
    expect(type('support.function.console.js')).toBe('builtin')
  })

  it('最里层的 scope 说了算：operator 压过 keyword、定义符跟着它定义的东西', () => {
    expect(type('keyword.operator.assignment.js')).toBe('operator')
    expect(type('punctuation.definition.comment.js')).toBe('comment')
    expect(type('punctuation.definition.string.begin.js')).toBe('string')
    expect(type('punctuation.terminator.statement.js')).toBe('punctuation')
  })

  it('const/let 这类 storage.* 按关键字上色（各家主题的惯例）', () => {
    expect(type('storage.type.js')).toBe('keyword')
  })

  it('什么都没有的 scope 给 plain：渲染时不上色', () => {
    expect(tokenTypeOf([])).toBe('plain')
    expect(tokenTypeOf(['source.unknown'])).toBe('plain')
  })
})

/* ---------- Tokens → HTML ---------- */

const token = (text: string, scope: string, startIndex = 0) => ({ text, scopes: ['source.x', scope], startIndex })

describe('Tokens → HTML（Theme.renderHighlight）', () => {
  const code = (lines: HighlightedCode['lines']): HighlightedCode => ({ code: '', languageId: 'x', lines, plain: false })

  it('相邻同类型的令牌合并成一个 span（少一半节点）', () => {
    const html = renderHighlight(code([[token('const', 'storage.type.x'), token(' ', 'source.x'), token('a', 'variable.other.x')]])).html
    // 空格是 plain（不上色），所以它把两边分开了
    expect(html).toBe('<span class="tok tok-keyword">const</span> <span class="tok tok-variable">a</span>')
  })

  it('同类型相邻则合并', () => {
    const html = renderHighlight(code([[token('a', 'variable.other.x'), token('b', 'variable.other.x', 1)]])).html
    expect(html).toBe('<span class="tok tok-variable">ab</span>')
  })

  it('文字一律转义：代码里的尖括号不会变成标签', () => {
    const html = renderHighlight(code([[token('<b>&"x"', 'string.quoted.x')]])).html
    expect(html).toContain('&lt;b&gt;&amp;&quot;x&quot;')
    expect(html).not.toContain('<b>')
  })

  it('多行：行与行用换行接上，不额外包元素（保持 <pre> 里的空白语义）', () => {
    const html = renderHighlight(code([[token('a', 'variable.other.x')], [token('b', 'variable.other.x')]])).html
    expect(html).toBe('<span class="tok tok-variable">a</span>\n<span class="tok tok-variable">b</span>')
  })

  it('plain（没高亮）时原样转义输出', () => {
    const rendered = renderHighlight({ code: 'a < b', languageId: null, lines: [], plain: true })
    expect(rendered.html).toBe('a &lt; b')
    expect(rendered.style).toEqual({})
  })
})

describe('主题（Theme）', () => {
  it('默认主题不给内联变量：颜色全部来自 index.css，跟着应用主题走', () => {
    expect(themeStyleVars(AUTO_THEME)).toEqual({})
  })

  it('自定义/自带主题给出一组 CSS 变量，换主题不必重新 tokenize', () => {
    const vars = themeStyleVars(DARK_THEME)
    expect(vars['--color-code-keyword']).toBe('#c678dd')
    expect(vars['--color-code-string']).toBe('#98c379')
    // 同一份已高亮的 HTML，配上不同的变量表就是不同的配色
    const html = renderHighlight({ code: '', languageId: 'x', lines: [[token('a', 'variable.other.x')]], plain: false })
    expect(html.style).toEqual({})
  })
})

/* ---------- 真引擎（vscode-textmate + VS Code 的 JavaScript 语法） ---------- */

const oniguruma = (onigNs as unknown as { default?: typeof onigNs }).default ?? onigNs
const vsctm = (vsctmNs as unknown as { default?: typeof vsctmNs }).default ?? vsctmNs

let engine: Promise<GrammarRegistry> | null = null

/** 真的语法仓库：wasm 从 node_modules 读，语法用 JS 的那一份。做成注入用的假 registry 形状 */
function realEngine(): Promise<GrammarRegistry> {
  if (!engine) {
    engine = (async () => {
      const buf = fs.readFileSync('node_modules/vscode-oniguruma/release/onig.wasm')
      await oniguruma.loadWASM(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
      // 语法原文来自 @shikijs/langs（VS Code 那份 TextMate 语法），形状与 IRawGrammar 对齐
      const pool = new Map(jsGrammar.map((g) => [g.scopeName, g as unknown as IRawGrammar]))
      const registry = new vsctm.Registry({
        onigLib: Promise.resolve({
          createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
          createOnigString: (s: string) => new oniguruma.OnigString(s),
        }),
        loadGrammar: async (scope: string) => pool.get(scope) ?? null,
      })
      const grammar = await registry.loadGrammar('source.js')
      const handle = grammar as unknown as GrammarLike
      return { load: async (id: string) => (id === 'javascript' ? handle : null) }
    })()
  }
  return engine
}

describe('真语法跑一遍（端到端）', () => {
  it('const a = 1 // 注释 → 关键字、变量、数字、注释各就各位', async () => {
    clearHighlightCache()
    const result = await highlight('const a = 1 // 注释', 'js', await realEngine())
    expect(result.plain).toBe(false)
    expect(result.languageId).toBe('javascript')
    const kinds = result.lines[0].map((t) => [t.text, tokenTypeOf(t.scopes)] as const)
    expect(kinds).toContainEqual(['const', 'keyword'])
    expect(kinds).toContainEqual(['a', 'variable'])
    expect(kinds).toContainEqual(['1', 'number'])
    // 行注释里的中文也归 comment
    expect(kinds.some(([text, kind]) => text.includes('注释') && kind === 'comment')).toBe(true)

    const html = renderHighlight(result).html
    expect(html).toContain('<span class="tok tok-keyword">const</span>')
    expect(html).toContain('tok-number')
  })

  it('多行注释跨行也对（ruleStack 串起了上下文）', async () => {
    clearHighlightCache()
    const result = await highlight('/* 开头\n还在注释里 */\nconst x = 2', 'js', await realEngine())
    const second = result.lines[1].map((t) => tokenTypeOf(t.scopes))
    expect(second).toContain('comment')
    const third = result.lines[2].map((t) => [t.text, tokenTypeOf(t.scopes)] as const)
    expect(third).toContainEqual(['const', 'keyword'])
  })
})

/* ---------- 缓存与退化 ---------- */

describe('缓存与退化', () => {
  const fakeGrammar: GrammarLike = {
    tokenizeLine: (line: string) => ({
      tokens: line ? [{ startIndex: 0, endIndex: line.length, scopes: ['source.x', 'keyword.control.x'] }] : [],
      ruleStack: null,
    }),
  }

  it('同一段代码只 tokenize 一次；语法也只加载一次', async () => {
    clearHighlightCache()
    const calls: string[] = []
    const registry: GrammarRegistry = {
      load: async (id: string) => {
        calls.push(id)
        return fakeGrammar
      },
    }
    const first = await highlight('let a = 1', 'ts', registry)
    const second = await highlight('let a = 1', 'ts', registry)
    expect(calls).toEqual(['typescript'])
    expect(second).toBe(first) // 命中缓存，连对象都是同一个
  })

  it('不认识的语言：不去问语法，直接纯文本', async () => {
    let asked = 0
    const registry: GrammarRegistry = { load: async () => ((asked++, fakeGrammar)) }
    const result = await highlight('随便什么', '这不是语言', registry)
    expect(result.plain).toBe(true)
    expect(asked).toBe(0)
  })

  it('太大的代码块不高亮（否则主线程会被一段几千行的日志按住）', async () => {
    let asked = 0
    const registry: GrammarRegistry = { load: async () => ((asked++, fakeGrammar)) }
    const huge = Array.from({ length: 3200 }, (_, i) => 'line ' + i).join('\n')
    const result = await highlight(huge, 'js', registry)
    expect(result.plain).toBe(true)
    expect(asked).toBe(0)
  })

  it('语法加载失败：退回纯文本，不抛给调用方', async () => {
    clearHighlightCache()
    const registry: GrammarRegistry = { load: async () => null }
    const result = await highlight('const a = 1', 'js', registry)
    expect(result.plain).toBe(true)
    expect(result.languageId).toBe('javascript')
  })
})
