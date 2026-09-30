/**
 * 代码块语言的识别：**Markdown 围栏里写的那个词 → languageId**。
 *
 * 这一层是纯数据 + 纯函数，不认识 TextMate、也不认识 DOM——好处是它能被单测直接钉住，
 * 而「怎么把这些语法加载进来」是另一件事（见 GrammarRegistry）。
 *
 * 里面那张表就是「支持哪些语言」的**唯一真值**：
 * - `id`：我们内部用的 languageId，也等于 @shikijs/langs 的模块名；
 * - `scope`：TextMate 的 scopeName（`source.js` 这种）。vscode-textmate 只认它，
 *   语法之间互相 include 时用的也是它；
 * - `aliases`：围栏里可能写的别的写法（js / ts / py / bash…）。
 *
 * 加一门语言＝在这里加一行 + 在 GrammarRegistry 的加载表里加一行（少哪一边，
 * 用例 tests/syntax.test.ts 会当场点出来）。语法本体来自 @shikijs/langs —— 那里面
 * 就是 VS Code 生态里那份 TextMate 语法，转换成了 ESM，**不需要自己写正则**。
 */

export interface LanguageDef {
  id: string
  /** TextMate 的 scopeName，vscode-textmate 认这个 */
  scope: string
  /** 给人看的名字（设置页/将来的语言标签用） */
  name: string
  /** 围栏里可能写的其它写法 */
  aliases: string[]
}

export const LANGUAGES: LanguageDef[] = [
  { id: 'javascript', scope: 'source.js', name: 'JavaScript', aliases: ['js', 'cjs', 'mjs', 'node'] },
  { id: 'typescript', scope: 'source.ts', name: 'TypeScript', aliases: ['ts', 'cts', 'mts'] },
  { id: 'jsx', scope: 'source.js.jsx', name: 'JSX', aliases: ['javascriptreact'] },
  { id: 'tsx', scope: 'source.tsx', name: 'TSX', aliases: ['typescriptreact'] },
  { id: 'python', scope: 'source.python', name: 'Python', aliases: ['py', 'python3'] },
  { id: 'rust', scope: 'source.rust', name: 'Rust', aliases: ['rs'] },
  { id: 'go', scope: 'source.go', name: 'Go', aliases: ['golang'] },
  { id: 'java', scope: 'source.java', name: 'Java', aliases: [] },
  { id: 'c', scope: 'source.c', name: 'C', aliases: [] },
  { id: 'cpp', scope: 'source.cpp', name: 'C++', aliases: ['c++', 'cc', 'cxx', 'hpp', 'hxx'] },
  { id: 'csharp', scope: 'source.cs', name: 'C#', aliases: ['cs', 'c#'] },
  { id: 'php', scope: 'source.php', name: 'PHP', aliases: [] },
  { id: 'ruby', scope: 'source.ruby', name: 'Ruby', aliases: ['rb'] },
  { id: 'kotlin', scope: 'source.kotlin', name: 'Kotlin', aliases: ['kt', 'kts'] },
  { id: 'swift', scope: 'source.swift', name: 'Swift', aliases: [] },
  { id: 'shellscript', scope: 'source.shell', name: 'Shell', aliases: ['sh', 'bash', 'zsh', 'shell', 'console'] },
  { id: 'powershell', scope: 'source.powershell', name: 'PowerShell', aliases: ['ps1', 'ps', 'pwsh'] },
  { id: 'sql', scope: 'source.sql', name: 'SQL', aliases: [] },
  { id: 'json', scope: 'source.json', name: 'JSON', aliases: [] },
  { id: 'yaml', scope: 'source.yaml', name: 'YAML', aliases: ['yml'] },
  { id: 'toml', scope: 'source.toml', name: 'TOML', aliases: [] },
  { id: 'xml', scope: 'text.xml', name: 'XML', aliases: [] },
  { id: 'html', scope: 'text.html.basic', name: 'HTML', aliases: ['htm'] },
  { id: 'css', scope: 'source.css', name: 'CSS', aliases: [] },
  { id: 'scss', scope: 'source.css.scss', name: 'SCSS', aliases: [] },
  { id: 'less', scope: 'source.css.less', name: 'Less', aliases: [] },
  { id: 'markdown', scope: 'text.html.markdown', name: 'Markdown', aliases: ['md', 'mdown'] },
  { id: 'diff', scope: 'source.diff', name: 'Diff', aliases: ['patch'] },
  { id: 'docker', scope: 'source.dockerfile', name: 'Dockerfile', aliases: ['dockerfile'] },
  { id: 'ini', scope: 'source.ini', name: 'INI', aliases: ['properties', 'conf', 'cfg'] },
  { id: 'lua', scope: 'source.lua', name: 'Lua', aliases: [] },
  { id: 'r', scope: 'source.r', name: 'R', aliases: [] },
  { id: 'dart', scope: 'source.dart', name: 'Dart', aliases: [] },
  { id: 'vue', scope: 'text.html.vue', name: 'Vue', aliases: [] },
  { id: 'latex', scope: 'text.tex.latex', name: 'LaTeX', aliases: ['tex'] },
  { id: 'haskell', scope: 'source.haskell', name: 'Haskell', aliases: ['hs'] },
  { id: 'scala', scope: 'source.scala', name: 'Scala', aliases: [] },
  { id: 'elixir', scope: 'source.elixir', name: 'Elixir', aliases: ['ex', 'exs'] },
  { id: 'zig', scope: 'source.zig', name: 'Zig', aliases: [] },
  { id: 'graphql', scope: 'source.graphql', name: 'GraphQL', aliases: ['gql'] },
]

/** id / scopeName / 别名 → languageId。查表用一张扁平的表，别名大小写不敏感 */
const BY_NAME = new Map<string, string>()
for (const lang of LANGUAGES) {
  BY_NAME.set(lang.id.toLowerCase(), lang.id)
  BY_NAME.set(lang.scope.toLowerCase(), lang.id)
  for (const alias of lang.aliases) BY_NAME.set(alias.toLowerCase(), lang.id)
}

/** scopeName → languageId（语法之间 include 时给 GrammarRegistry 用） */
const BY_SCOPE = new Map(LANGUAGES.map((l) => [l.scope.toLowerCase(), l.id]))

/**
 * 围栏里的语言标记 → languageId。**认不出来一律给 null**（按纯文本处理）。
 *
 * 为什么不做语言猜测：猜错比不高亮更糟——把一段 Python 按 JavaScript 染，
 * 得到的是看着像模像样、其实全错的颜色。没写语言就当纯文本，这是明说的规矩。
 */
export function resolveLanguageId(raw: string | null | undefined): string | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase()
  if (!key) return null
  return BY_NAME.get(key) ?? null
}

/** scopeName → languageId；不认识给 null（embedded 语法找上门时用） */
export function languageIdForScope(scope: string): string | null {
  return BY_SCOPE.get(scope.trim().toLowerCase()) ?? null
}

/** 给人看的语言名；认不出来就把原文还回去 */
export function languageName(languageId: string | null): string {
  if (!languageId) return '纯文本'
  return LANGUAGES.find((l) => l.id === languageId)?.name ?? languageId
}

/** 支持的语言有多少门（设置页/文档里报数用） */
export const languageCount = (): number => LANGUAGES.length
