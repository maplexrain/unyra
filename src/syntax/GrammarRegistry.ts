/**
 * TextMate 语法的**按需加载与缓存**（vscode-textmate + vscode-oniguruma）。
 *
 * 这是整套高亮里唯一碰 IO 的地方，三件事都在这里：
 * 1. **引擎**：vscode-oniguruma 的 wasm（约 500 KB）+ vscode-textmate 的 Registry。
 *    wasm 只在**第一次真的要高亮**时才 fetch，文档里没有代码块就一分钱不花。
 * 2. **按需加载**：语言 → 动态 import 那份语法。40 门语言各自是一个独立分包，
 *    谁被用到才下载谁；同一个语言第二次直接命中缓存（Map<languageId, Promise<IGrammar>>）。
 * 3. **依赖解析**：一份语法常 include 别的语法（HTML 里嵌 CSS/JS、LaTeX 里嵌 TeX）。
 *    这些「顺带的」语法由 @shikijs/langs 的模块一并带出来，我们按 scopeName 全部登记，
 *    所以 vscode-textmate 回头来要 `source.css` 时能直接给——不必自己写依赖表。
 *
 * 与上层的关系：SyntaxHighlighter 只依赖下面那个 GrammarRegistry 接口（一个 load 方法），
 * 因此用例可以塞一个假引擎进来，在 node 里把整条链路跑通，不必碰 wasm。
 */
import * as oniguruma from 'vscode-oniguruma'
import * as vsctm from 'vscode-textmate'
import type { IRawGrammar } from 'vscode-textmate'
import onigWasmUrl from 'vscode-oniguruma/release/onig.wasm?url'
import { LANGUAGES, languageIdForScope } from './LanguageAliases'

/**
 * 一段语法原始定义。我们只关心 scopeName（其余字段原样交给 vscode-textmate 消费），
 * 因此这里只声明它——@shikijs/langs 的 LanguageRegistration 结构比这大得多。
 */
export interface RawGrammarLike {
  name?: string
  scopeName: string
}

/** 语法模块：默认导出是**一个数组**——主语法 + 它依赖的那些语法 */
export interface GrammarModule {
  default: RawGrammarLike[]
}

/**
 * 语言 → 语法模块的加载函数。
 *
 * 写成静态的 `import('@shikijs/langs/xxx')`（而不是拼字符串）：打包器据此给每门语言
 * 切一个分包，用到才下载。语法本体来自 @shikijs/langs —— 就是 VS Code 生态里那份
 * TextMate 语法，**这里一行高亮正则都不写**。
 */
export const GRAMMAR_LOADERS: Record<string, () => Promise<GrammarModule>> = {
  javascript: () => import('@shikijs/langs/javascript'),
  typescript: () => import('@shikijs/langs/typescript'),
  jsx: () => import('@shikijs/langs/jsx'),
  tsx: () => import('@shikijs/langs/tsx'),
  python: () => import('@shikijs/langs/python'),
  rust: () => import('@shikijs/langs/rust'),
  go: () => import('@shikijs/langs/go'),
  java: () => import('@shikijs/langs/java'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  php: () => import('@shikijs/langs/php'),
  ruby: () => import('@shikijs/langs/ruby'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  swift: () => import('@shikijs/langs/swift'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  powershell: () => import('@shikijs/langs/powershell'),
  sql: () => import('@shikijs/langs/sql'),
  json: () => import('@shikijs/langs/json'),
  yaml: () => import('@shikijs/langs/yaml'),
  toml: () => import('@shikijs/langs/toml'),
  xml: () => import('@shikijs/langs/xml'),
  html: () => import('@shikijs/langs/html'),
  css: () => import('@shikijs/langs/css'),
  scss: () => import('@shikijs/langs/scss'),
  less: () => import('@shikijs/langs/less'),
  markdown: () => import('@shikijs/langs/markdown'),
  diff: () => import('@shikijs/langs/diff'),
  docker: () => import('@shikijs/langs/docker'),
  ini: () => import('@shikijs/langs/ini'),
  lua: () => import('@shikijs/langs/lua'),
  r: () => import('@shikijs/langs/r'),
  dart: () => import('@shikijs/langs/dart'),
  vue: () => import('@shikijs/langs/vue'),
  latex: () => import('@shikijs/langs/latex'),
  haskell: () => import('@shikijs/langs/haskell'),
  scala: () => import('@shikijs/langs/scala'),
  elixir: () => import('@shikijs/langs/elixir'),
  zig: () => import('@shikijs/langs/zig'),
  graphql: () => import('@shikijs/langs/graphql'),
}

/** vscode-textmate 的 IToken 在宿主侧的最小形状（行内偏移，不是全局偏移） */
export interface RawToken {
  startIndex: number
  endIndex: number
  scopes: string[]
}

/** 一份可以逐行喂的语法。vscode-textmate 的 IGrammar 正好是这个形状 */
export interface GrammarLike {
  tokenizeLine(line: string, prev: unknown, timeLimit?: number): { tokens: RawToken[]; ruleStack: unknown }
}

/** 语法仓库：上层只要这一个方法 */
export interface GrammarRegistry {
  load(languageId: string): Promise<GrammarLike | null>
}

/* ---------- 引擎（oniguruma wasm + textmate registry） ---------- */

let onigLibPromise: Promise<vsctm.IOnigLib> | null = null

/**
 * 取 oniguruma 的 wasm 并初始化。
 *
 * 地址要相对**页面**解析（同 lib/voice/whisper/runtime.ts 的处理）：打包后资源在
 * assets/ 下，dev 与 file:// 两种情形都靠 document.baseURI 兜住。
 * 失败不缓存（onigLibPromise 置回 null），下次再试——开发时依赖重新预打包会让
 * 旧地址短暂失效，缓存住失败就再也起不来了。
 */
function loadOniguruma(): Promise<vsctm.IOnigLib> {
  if (!onigLibPromise) {
    onigLibPromise = (async () => {
      const url = typeof document === 'undefined' ? onigWasmUrl : new URL(onigWasmUrl, document.baseURI).href
      const res = await fetch(url)
      if (!res.ok) throw new Error(`取不到 oniguruma 的 wasm（HTTP ${res.status}）`)
      await oniguruma.loadWASM(await res.arrayBuffer())
      return {
        createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
        createOnigString: (s: string) => new oniguruma.OnigString(s),
      }
    })().catch((err: unknown) => {
      onigLibPromise = null
      throw err
    })
  }
  return onigLibPromise
}

/**
 * 造一个 TextMate 语法仓库。
 *
 * 缓存分两层，各管一段：
 * - `rawByScope`：语法**原文**，按 scopeName 存。一份模块带出来的依赖也进这里，
 *   于是 embedded 语法（HTML 里的 CSS/JS）不必再单独安排加载；
 * - `pending`：`languageId → Promise<IGrammar>`。同一个语言被两个代码块同时要，
 *   只会加载一次（这正是「第一次出现 javascript 才加载，之后直接用缓存」那件事）。
 */
export function createTextMateRegistry(): GrammarRegistry {
  const rawByScope = new Map<string, RawGrammarLike>()
  const pending = new Map<string, Promise<GrammarLike | null>>()

  const loadRaw = async (languageId: string): Promise<void> => {
    const load = GRAMMAR_LOADERS[languageId]
    if (!load) return
    const mod = await load()
    for (const grammar of mod.default) rawByScope.set(grammar.scopeName, grammar)
  }

  const registry = new vsctm.Registry({
    onigLib: loadOniguruma(),
    loadGrammar: async (scopeName: string): Promise<IRawGrammar | null> => {
      const known = rawByScope.get(scopeName)
      if (known) return known as unknown as IRawGrammar
      const languageId = languageIdForScope(scopeName)
      if (!languageId) return null
      await loadRaw(languageId)
      const found = rawByScope.get(scopeName)
      return found ? (found as unknown as IRawGrammar) : null
    },
  })

  const load = (languageId: string): Promise<GrammarLike | null> => {
    const cached = pending.get(languageId)
    if (cached) return cached
    const def = LANGUAGES.find((l) => l.id === languageId)
    if (!def) return Promise.resolve(null)
    const task = (async () => {
      // 先自己把模块载进来（避免只靠 loadGrammar 回调那条路，顺序更直白）
      await loadRaw(languageId)
      const grammar = await registry.loadGrammar(def.scope)
      return (grammar as unknown as GrammarLike) ?? null
    })().catch((err: unknown) => {
      // 失败不留缓存：可能是开发期依赖重新预打包导致的短暂失效，下次重试即可
      pending.delete(languageId)
      console.warn(`[syntax] ${languageId} 的语法加载失败`, err)
      return null
    })
    pending.set(languageId, task)
    return task
  }

  return { load }
}

let shared: GrammarRegistry | null = null

/** 全应用共用的那一份（语法与其 tokenize 状态都贵，别每个代码块造一个） */
export function defaultGrammarRegistry(): GrammarRegistry {
  if (!shared) shared = createTextMateRegistry()
  return shared
}
