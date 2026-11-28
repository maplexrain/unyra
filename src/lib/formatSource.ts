/**
 * 源码格式化：按文件后缀选 Prettier 解析器。
 *
 * 只加载当前文件需要的 parser/plugin，避免把整包 Prettier 塞进主 bundle。
 * 认不出的后缀（纯文本、日志、未知扩展名）返回 unsupported，由调用方提示，
 * 不做“猜格式”式改写——源码格式化最忌讳把不认识的文本重排坏。
 */

type PrettierCore = typeof import('prettier/standalone')
type PrettierPlugin = import('prettier').Plugin

interface ParserRecipe {
  parser: string
  plugins: Array<() => Promise<PrettierPlugin>>
}

export interface FormatSourceResult {
  ok: boolean
  /** 格式化后的文本（ok 为 true 时有效） */
  text?: string
  /** 用到的解析器名，便于状态提示 */
  parser?: string
  /** 不支持的原因 / 解析失败原因 */
  error?: string
}

const recipeCache = new Map<string, Promise<{ prettier: PrettierCore; recipe: ParserRecipe; plugins: PrettierPlugin[] } | null>>()

const pluginDefault = async (load: () => Promise<unknown>): Promise<PrettierPlugin> => {
  const mod = (await load()) as { default?: PrettierPlugin } | PrettierPlugin
  return ((mod as { default?: PrettierPlugin }).default ?? mod) as PrettierPlugin
}

function recipeFor(ext: string): ParserRecipe | null {
  switch (ext) {
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
    case '.json':
    case '.jsonc':
      return {
        parser: ext === '.json' || ext === '.jsonc' ? 'json' : 'babel',
        plugins: [
          () => pluginDefault(() => import('prettier/plugins/babel')),
          () => pluginDefault(() => import('prettier/plugins/estree')),
        ],
      }
    case '.ts':
    case '.tsx':
    case '.mts':
    case '.cts':
      return {
        parser: 'typescript',
        plugins: [
          () => pluginDefault(() => import('prettier/plugins/typescript')),
          () => pluginDefault(() => import('prettier/plugins/estree')),
        ],
      }
    case '.css':
    case '.scss':
    case '.less':
      return {
        parser: ext.slice(1),
        plugins: [() => pluginDefault(() => import('prettier/plugins/postcss'))],
      }
    case '.html':
    case '.htm':
    case '.svg':
      return {
        parser: 'html',
        plugins: [
          () => pluginDefault(() => import('prettier/plugins/html')),
          () => pluginDefault(() => import('prettier/plugins/babel')),
          () => pluginDefault(() => import('prettier/plugins/estree')),
        ],
      }
    case '.vue':
      return {
        parser: 'vue',
        plugins: [
          () => pluginDefault(() => import('prettier/plugins/html')),
          () => pluginDefault(() => import('prettier/plugins/babel')),
          () => pluginDefault(() => import('prettier/plugins/estree')),
        ],
      }
    case '.md':
    case '.markdown':
    case '.mdx':
      return {
        parser: ext === '.mdx' ? 'mdx' : 'markdown',
        plugins: [() => pluginDefault(() => import('prettier/plugins/markdown'))],
      }
    case '.yaml':
    case '.yml':
      return {
        parser: 'yaml',
        plugins: [() => pluginDefault(() => import('prettier/plugins/yaml'))],
      }
    default:
      return null
  }
}

function normalizeExt(ext?: string): string {
  if (!ext) return ''
  const raw = ext.trim().toLowerCase()
  const dot = raw.lastIndexOf('.')
  return dot >= 0 ? raw.slice(dot) : ''
}

/** 从路径 / 标签里取扩展名，供没有单独传 ext 的编辑器兜底 */
export function extOfPath(pathOrLabel?: string): string {
  if (!pathOrLabel) return ''
  const clean = pathOrLabel.split(/[?#]/)[0].split(/[/\\]/).pop() ?? ''
  const dot = clean.lastIndexOf('.')
  return dot >= 0 ? clean.slice(dot).toLowerCase() : ''
}

export function isSourceFormattable(ext?: string): boolean {
  return !!recipeFor(normalizeExt(ext))
}

async function loadRecipe(
  ext: string,
): Promise<{ prettier: PrettierCore; recipe: ParserRecipe; plugins: PrettierPlugin[] } | null> {
  const normalized = normalizeExt(ext)
  const recipe = recipeFor(normalized)
  if (!recipe) return null
  const existing = recipeCache.get(normalized)
  if (existing) return existing
  const loading = (async () => {
    const prettier = (await import('prettier/standalone')) as PrettierCore
    const plugins = await Promise.all(recipe.plugins.map((load) => load()))
    return { prettier, recipe, plugins }
  })()
  recipeCache.set(normalized, loading)
  // 加载失败不要把这个失败 promise 永久留在缓存里：下次点格式化还能重试。
  void loading.catch(() => recipeCache.delete(normalized))
  return loading
}

/**
 * 按后缀格式化文本。`ext` 应带点（如 `.tsx`）；不传时会从 `label` 推断。
 * 仅负责文本转换，不写文件、不碰编辑器状态。
 */
export async function formatSourceText(text: string, extOrPath?: string): Promise<FormatSourceResult> {
  const ext = normalizeExt(extOrPath) || extOfPath(extOrPath)
  if (!recipeFor(ext)) return { ok: false, error: `暂不支持格式化 ${ext || '该类型'} 文件` }
  try {
    const loaded = await loadRecipe(ext)
    if (!loaded) return { ok: false, error: `暂不支持格式化 ${ext || '该类型'} 文件` }
    const formatted = await loaded.prettier.format(text, {
      parser: loaded.recipe.parser,
      plugins: loaded.plugins,
      // 与仓库现有手写风格接近；不做激进重排，保留原有换行符。
      printWidth: 120,
      tabWidth: 2,
      useTabs: false,
      semi: false,
      singleQuote: true,
      trailingComma: 'all',
      endOfLine: 'auto',
    })
    return { ok: true, text: formatted, parser: loaded.recipe.parser }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** 保存时自动格式化的类型：源码 / 结构化文件；Markdown 正文重排会改变作者排版，不碰。 */
const AUTO_FORMAT_SKIP = new Set(['.md', '.markdown', '.mdx'])

/**
 * 保存钩子用的「能格式就格式，格式不了就原样」。
 *
 * 与编辑器里的手动格式化不同：保存是数据安全路径，Prettier 首次加载、语法错误、
 * 不支持的插件都不能把用户的保存挡下来——失败时一字不改，交给调用方照原稿写盘。
 */
export async function formatSourceOnSave(text: string, pathOrLabel: string): Promise<string> {
  const ext = extOfPath(pathOrLabel)
  if (!ext || AUTO_FORMAT_SKIP.has(ext) || !isSourceFormattable(ext)) return text
  const result = await formatSourceText(text, ext)
  return result.ok && result.text !== undefined ? result.text : text
}
