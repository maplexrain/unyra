/**
 * 高亮的**纯逻辑**：一段代码 + languageId → Tokens（带 TextMate scopes）。
 *
 * 这里不碰 DOM、不碰颜色、不碰 React——想换渲染方式（DOM / canvas / 原生控件），
 * 或者想换主题，都不必动这个文件。反过来，这个文件也不认识「代码块」长什么样。
 *
 * 对外就一个函数：
 *
 *     highlight(code, 'js') → { languageId: 'javascript', lines: [[…token…]], plain: false }
 *
 * 语言标识先过 LanguageAliases（js → javascript），再交给 GrammarRegistry 拿语法
 * （按需加载 + 缓存），最后逐行喂给 vscode-textmate。行与行之间要传 ruleStack，
 * 语法才能记住「上一行开了一个多行注释/字符串」——这也是为什么必须整块一起 tokenize，
 * 而不是每行单独来一次。
 */
import type { GrammarRegistry } from './GrammarRegistry'
import { resolveLanguageId } from './LanguageAliases'

/** 一段文字与它的 scopes。startIndex 是**行内**偏移 */
export interface HighlightToken {
  text: string
  scopes: string[]
  startIndex: number
}

export interface HighlightedCode {
  /** 源文原样带着：渲染纯文本、或者将来做复制按钮时都要用 */
  code: string
  /** 归一后的 languageId；null = 没认出语言（纯文本） */
  languageId: string | null
  /** 一行一个数组，顺序与源码一致 */
  lines: HighlightToken[][]
  /** true = 没有高亮（不认识的语言 / 太大 / 引擎失败），调用方按纯文本渲染 */
  plain: boolean
}

/**
 * 太大的代码块不高亮。
 *
 * 不设这道闸的后果不是「慢一点」，而是**卡住**：tokenize 是同步 CPU 活，
 * 一份几千行的日志文件会让主线程停住好几百毫秒。阈值按行数与字符数双封顶，
 * 超了就保持纯文本——正文照样看得见，只是没有颜色。
 */
const MAX_LINES = 3000
const MAX_CHARS = 150_000

/** 缓存 tokenization 结果：同一段代码（AI 消息反复重渲染、切页签切回来）不重复解析 */
const CACHE_MAX_ENTRIES = 128
const CACHE_MAX_CHARS = 4 * 1024 * 1024

const cache = new Map<string, HighlightedCode>()
let cacheChars = 0

const cacheKey = (languageId: string, code: string): string => languageId + '\u0000' + code

function cacheGet(key: string): HighlightedCode | undefined {
  const hit = cache.get(key)
  if (hit === undefined) return undefined
  // 命中后重新插入：Map 的插入顺序当 LRU，队首即最久未用
  cache.delete(key)
  cache.set(key, hit)
  return hit
}

function cacheSet(key: string, value: HighlightedCode, weight: number): void {
  cache.set(key, value)
  cacheChars += weight
  while ((cache.size > CACHE_MAX_ENTRIES || cacheChars > CACHE_MAX_CHARS) && cache.size > 1) {
    const oldest = cache.keys().next().value as string
    const dropped = cache.get(oldest)
    cache.delete(oldest)
    cacheChars -= dropped ? dropped.code.length : 0
  }
}

/** 清空缓存（用例用；正常运行时不需要） */
export function clearHighlightCache(): void {
  cache.clear()
  cacheChars = 0
}

const plainResult = (code: string, languageId: string | null): HighlightedCode => ({
  code,
  languageId,
  lines: [],
  plain: true,
})

/**
 * 把代码切成带 scopes 的令牌。
 *
 * registry 可以注入（用例里塞一个假语法，node 下就能跑完整条链路）；
 * 不注入时用应用共用的那一份，而那一份会按需加载语法与 wasm。
 */
export async function highlight(
  code: string,
  languageId?: string | null,
  registry?: GrammarRegistry,
): Promise<HighlightedCode> {
  const id = resolveLanguageId(languageId)
  if (!id || !code.trim()) return plainResult(code, id)

  const key = cacheKey(id, code)
  const cached = cacheGet(key)
  if (cached) return cached

  const lineCount = countLines(code)
  if (lineCount > MAX_LINES || code.length > MAX_CHARS) return plainResult(code, id)

  const reg = registry ?? (await import('./GrammarRegistry')).defaultGrammarRegistry()
  let grammar
  try {
    grammar = await reg.load(id)
  } catch (err) {
    console.warn('[syntax] 语法加载失败', err)
    return plainResult(code, id)
  }
  if (!grammar) return plainResult(code, id)

  try {
    const lines = tokenizeLines(grammar, code)
    const result: HighlightedCode = { code, languageId: id, lines, plain: false }
    cacheSet(key, result, code.length)
    return result
  } catch (err) {
    // 语法自己炸了（极端输入）：退回纯文本，不要连累整篇文档
    console.warn('[syntax] tokenize 失败', err)
    return plainResult(code, id)
  }
}

/** 数行数：不 split，避免为一门大代码块先造一个数组 */
function countLines(code: string): number {
  let n = 1
  for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) n++
  return n
}

/** 逐行 tokenize：ruleStack 串起上下文（多行注释、多行字符串靠它） */
function tokenizeLines(grammar: { tokenizeLine(line: string, prev: unknown, timeLimit?: number): { tokens: Array<{ startIndex: number; endIndex: number; scopes: string[] }>; ruleStack: unknown } }, code: string): HighlightToken[][] {
  const out: HighlightToken[][] = []
  let ruleStack: unknown = null
  // 末尾那个换行不该多切出一空行（代码块本身不带换行的语义）
  const text = code.endsWith('\n') ? code.slice(0, -1) : code
  for (const line of text.split('\n')) {
    const { tokens, ruleStack: next } = grammar.tokenizeLine(line, ruleStack)
    ruleStack = next
    const row: HighlightToken[] = []
    for (const token of tokens) {
      if (token.endIndex <= token.startIndex) continue
      row.push({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes, startIndex: token.startIndex })
    }
    out.push(row)
  }
  return out
}
