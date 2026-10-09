/**
 * 插件宿主：注册表 + 启用状态 + 装载。
 *
 * 插件分**类别**。类别是「一种扩展点」：Markdown 文档插件（文档里的语法与渲染，
 * 见 lib/renderPlugins）是目前唯一的一类，但宿主本身对类别一无所知——每类插件由
 * 自己的模块实现一份 PluginCategorySpec 注册进来（形状怎么校验、怎么向用户描述），
 * 宿主只负责登记、开关与装载。将来加「AI 工具」「导出格式」这类插件，不必动这里。
 *
 * 插件从哪来：**内置**（编译进包，见 lib/builtinPlugins 之类）与**用户装的**
 * （数据目录里的文件，见下）。两者在同一个注册表里，排在前面的先认领，撞了就在注册时报错。
 *
 * 启用状态存两份，各归其位：
 * - 内置插件的开关进 **appdata 的 global.yaml**：它跟机器走，不属于某一份数据目录；
 * - 用户插件的启用清单进 **数据目录**（`{root}/plugins/enabled.json`）：文件就在那儿，
 *   换一份数据目录就是换一批插件，上一个目录里的「已启用」不该跟过去。
 *
 * 默认值也不一样：**内置默认开**（plot 就是其中之一，它是文档能力的一部分），
 * **用户插件默认关**——那是一个能读到全部笔记的脚本，得由用户点一次。
 *
 * 生效时机：启动时装载一次，改了要**重启**。理由见 lib/markdown 的缓存注释与
 * lib/renderPlugins 的注册说明（marked 的扩展装上去摘不下来，渲染结果按源文缓存）。
 */
import { t } from '../i18n'
import type { PluginEntry as PluginFileEntry } from './native'
import { native } from './native'

/**
 * 插件类别。加新的一类时在这里加一个取值，并实现一份 spec（definePluginCategory）——
 * 宿主本身对类别一无所知。目前两类：
 * - markdown：文档里的一种语法 / 一段正文加工（lib/renderPlugins）；
 * - functional：给**应用**加一项能力（lib/functionalPlugins，目前是语音输入）。
 */
export type PluginCategory = 'markdown' | 'functional'

/** 所有插件共有的字段；各类插件在自己的 spec 里补上自己的钩子 */
export interface PluginBase {
  /** 唯一标识。用户插件的 id 默认取文件名 */
  id: string
  /** 给人看的名字（设置页里显示） */
  name?: string
  category: PluginCategory
  /** 内置：编译进包，用户删不掉，只能关 */
  builtin: boolean
  /** 没被显式开关过时的状态 */
  defaultEnabled: boolean
  /** 用户插件来自哪个文件（只用于显示与报错） */
  origin?: string
  /** 有二级配置页（设置页里点这一行进得去）。目前只有功能性插件会用它 */
  configurable?: boolean
}

export interface PluginCategorySpec {
  id: PluginCategory
  /** 设置页里的分类标题 */
  label: string
  /** 分类下面那句说明 */
  hint: string
  /** 把外部交来的对象校验成这一类插件的形状；不合法就抛一句能直接显示给用户的话 */
  normalize(raw: Record<string, unknown>, id: string): PluginBase
  /** 这个插件声称自己做了什么（设置页显示成一行摘要） */
  describe(plugin: PluginBase): string[]
}

const specs = new Map<PluginCategory, PluginCategorySpec>()
let defaultCategory: PluginCategory | null = null

/**
 * 类别模块在导入时登记自己。
 *
 * opts.fallback：用户插件不写 category 时按哪一类算。**只有 Markdown 文档插件该要它**
 * （数据目录里那些 .js 本来就是写文档语法的），而且必须显式声明——早先按「谁先登记谁算」，
 * 于是新加一类插件时，默认类别会随着 import 顺序悄悄换人。
 */
export function definePluginCategory(spec: PluginCategorySpec, opts?: { fallback?: boolean }): void {
  specs.set(spec.id, spec)
  if (opts?.fallback) defaultCategory = spec.id
}

export const pluginCategories = (): PluginCategorySpec[] => [...specs.values()]

export function pluginCategorySpec(id: PluginCategory): PluginCategorySpec {
  const spec = specs.get(id)
  if (!spec) throw new Error(t('未知的插件类别：{0}', id))
  return spec
}

/* ---------- 注册表 ---------- */

const registry = new Map<string, PluginBase>()
/** 内置插件的**全量**清单：关掉的那些也要留在里面，设置页才列得出来 */
const builtins: PluginBase[] = []
const registryListeners: Array<(plugin: PluginBase) => void> = []
const removeListeners: Array<(plugin: PluginBase) => void> = []

/**
 * 每次注册/注销自增。文档渲染的缓存键里带着它——插件变了，同一段源文的产物
 * 就不再是同一个东西了（见 lib/markdown 的缓存注释）。
 */
let revision = 0

export const pluginsRevision = (): number => revision

/** 已登记的插件（不含被关掉的内置插件） */
export const plugins = (): PluginBase[] => [...registry.values()]

export function pluginsOf(category: PluginCategory): PluginBase[] {
  return [...registry.values()].filter((p) => p.category === category)
}

export const pluginById = (id: string): PluginBase | undefined => registry.get(id)

/** 内置插件的全量清单（含已关掉的） */
export const builtinPlugins = (): PluginBase[] => [...builtins]

/**
 * 订阅「有插件登记进来」。已经登记过的会先补一遍——订阅方（lib/markdown 用它把
 * marked 扩展装进去）因此不必关心自己是先启动还是后启动。
 */
export function onPluginRegistered(cb: (plugin: PluginBase) => void): void {
  registryListeners.push(cb)
  for (const p of registry.values()) cb(p)
}

/** 订阅「插件被注销」（关掉一个内置插件时，它留下的缓存与样式要一起收走） */
export function onPluginRemoved(cb: (plugin: PluginBase) => void): void {
  removeListeners.push(cb)
}

/**
 * 登记一个插件。id 与已有插件撞了就抛异常（调用方决定是报错还是跳过这件事）。
 * 各类自己的约束（围栏语言撞车之类）在各自的 spec.normalize 里顺带查。
 */
export function registerPlugin(raw: unknown, fallbackId = ''): PluginBase {
  if (!raw || typeof raw !== 'object') throw new Error(t('插件没有交出对象'))
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : fallbackId
  if (!id) throw new Error(t('插件缺少 id'))
  const category = (typeof o.category === 'string' ? o.category : defaultCategory) as PluginCategory | null
  if (!category) throw new Error(t('没有可用的插件类别'))
  const plugin = pluginCategorySpec(category).normalize(o, id)
  const dup = registry.get(plugin.id)
  if (dup) throw new Error(t('插件 id「{0}」已被「{1}」占用', plugin.id, dup.name ?? dup.id))
  registry.set(plugin.id, plugin)
  if (plugin.builtin && !builtins.some((p) => p.id === plugin.id)) builtins.push(plugin)
  revision++
  for (const cb of registryListeners) cb(plugin)
  return plugin
}

/**
 * 注销一个插件（目前只有「关掉一个内置插件」这一条路）。
 *
 * 注意 marked 扩展：那些是装到全局 marked 上的，**摘不下来**——所以只给内置插件用，
 * 而内置插件不许带 marked 扩展（见 lib/renderPlugins 的校验）。真需要关掉一个带
 * marked 扩展的插件，只能重启时别登记它。
 */
export function unregisterPlugin(id: string): boolean {
  const plugin = registry.get(id)
  if (!plugin) return false
  registry.delete(id)
  revision++
  for (const cb of removeListeners) cb(plugin)
  return true
}

/* ---------- 启用状态与装载 ---------- */

export interface PluginStatus {
  id: string
  /** builtin：编译进包；user：数据目录里的一个 .js */
  kind: 'builtin' | 'user'
  category: PluginCategory
  name: string
  /** 用户插件的文件名（内置插件没有） */
  file?: string
  bytes?: number
  mtime?: number
  /** 期望状态（开关摆在哪边） */
  enabled: boolean
  /** 本次运行里真的登记进来了 */
  active: boolean
  /** 没被开关过时的默认状态 */
  defaultEnabled: boolean
  /** 启用了却没装成时的一句话 */
  error?: string
  /** 这个插件做了什么（来自类别的 describe） */
  summary: string[]
  /** 有二级配置页（见 PluginBase.configurable） */
  configurable?: boolean
}

let statuses: PluginStatus[] = []
/** 清单本身读不出来时的一句话（数据目录建不出来、权限不对） */
let listError = ''
/** 用户插件目录（设置页要把它显示出来，好让用户知道往哪儿放文件） */
let pluginsDirPath = ''
/** 已经装载过一轮：切数据目录会再跑一次 boot，那时不能重装（注册表里已经有这些 id 了） */
let loaded = false

export const pluginStatuses = (): PluginStatus[] => statuses
export const pluginListError = (): string => listError
export const pluginDir = (): string => pluginsDirPath

/**
 * 最近一次读到的内置开关。给「同步问一句这个插件开着没有」用（见 builtinPluginOn）——
 * 界面上的按钮要在渲染期就知道该不该画，而读开关是异步的。
 */
let builtinToggles: Record<string, boolean> = {}

/** 内置插件的开关（只有被显式改过的那些在里面）；读不到就当空——内置保持默认 */
async function readBuiltinToggles(): Promise<Record<string, boolean>> {
  try {
    const res = await native().plugins.toggles()
    builtinToggles = res.ok ? res.toggles : {}
  } catch {
    builtinToggles = {}
  }
  return builtinToggles
}

/**
 * 内置插件此刻开着没有（同步）。没被显式开关过时用它自己的默认值；
 * 还没读到过开关（启动之前）也按默认值——对「默认关」的插件来说这是保守的那一侧。
 */
export function builtinPluginOn(id: string): boolean {
  const declared = builtins.find((p) => p.id === id)
  return builtinToggles[id] ?? declared?.defaultEnabled ?? false
}

/**
 * 「能不能开」的守卫：有些插件开了也没用（语音输入没有模型时就是），那就在**保存开关之前**
 * 问一句。守卫由插件自己登记（见 lib/voice/plugin），宿主不知道它为什么拦——只知道拦下来时
 * 要交给用户一句能照着做的话。
 */
const enableGuards = new Map<string, () => Promise<string | null>>()

export function setPluginEnableGuard(id: string, guard: () => Promise<string | null>): void {
  enableGuards.set(id, guard)
}

/** 问一句「现在能不能开这个插件」：能开给 null，不能给一句原因（设置页拿它把开关置灰） */
export async function pluginEnableBlocker(id: string): Promise<string | null> {
  const guard = enableGuards.get(id)
  if (!guard) return null
  try {
    return await guard()
  } catch {
    return t('暂时判断不了能不能启用（应用没跑在 Electron 里？）')
  }
}

/**
 * 按开关把不该开的内置插件注销掉。
 *
 * 为什么是「注销」而不是「一开始就不登记」：内置插件在模块导入时就登记了，
 * 而开关要从磁盘读（异步）。默认开着、读到 false 再摘掉，两条路都不会漏
 * （测试与任何没走 boot 的路径拿到的也是「默认开」这一份）。
 */
export function applyBuiltinToggles(toggles: Record<string, boolean>): void {
  for (const plugin of builtins) {
    const wanted = toggles[plugin.id] ?? plugin.defaultEnabled
    if (!wanted && registry.has(plugin.id)) unregisterPlugin(plugin.id)
  }
}

/**
 * 重新列一遍插件目录，并把「本次运行装没装成」的结果并进去。
 * 设置页每次打开都会调它：用户刚往目录里丢了文件，不必重启就能看见。
 */
export async function refreshPlugins(): Promise<PluginStatus[]> {
  let entries: PluginFileEntry[] = []
  let toggles: Record<string, boolean> = {}
  try {
    const res = await native().plugins.list()
    if (res.ok) {
      entries = res.entries
      pluginsDirPath = res.dir
      listError = ''
    } else {
      listError = res.error
    }
    toggles = await readBuiltinToggles()
  } catch {
    listError = t('列不出插件目录：应用没有跑在 Electron 里')
  }
  if (listError) {
    statuses = []
    return statuses
  }

  const byFile = new Map(statuses.filter((s) => s.kind === 'user').map((s) => [s.file as string, s]))
  const rows: PluginStatus[] = []

  // 内置插件：全量清单都在（关掉的也列出来，否则用户没法把它开回来）
  for (const plugin of builtins) {
    rows.push({
      id: plugin.id,
      kind: 'builtin',
      category: plugin.category,
      name: plugin.name ?? plugin.id,
      enabled: toggles[plugin.id] ?? plugin.defaultEnabled,
      active: registry.has(plugin.id),
      defaultEnabled: plugin.defaultEnabled,
      summary: describeOf(plugin),
      configurable: plugin.configurable === true,
    })
  }

  // 用户插件：目录里有什么就列什么
  for (const entry of entries) {
    const prev = byFile.get(entry.file)
    rows.push({
      id: entry.file,
      kind: 'user',
      category: (prev?.category ?? defaultCategory ?? 'markdown') as PluginCategory,
      name: prev?.name ?? entry.file,
      file: entry.file,
      bytes: entry.bytes,
      mtime: entry.mtime,
      enabled: entry.enabled,
      active: prev?.active ?? false,
      defaultEnabled: false,
      ...(prev?.error ? { error: prev.error } : {}),
      summary: prev?.summary ?? [],
    })
  }

  statuses = rows
  return statuses
}

function describeOf(plugin: PluginBase): string[] {
  try {
    return pluginCategorySpec(plugin.category).describe(plugin)
  } catch {
    return []
  }
}

/* ---------- 用户插件：编译 ---------- */

/**
 * 编译一个插件脚本。
 *
 * 脚本有两种交出插件对象的方式，任选其一：
 *   register({ id: 'mermaid', category: 'markdown', fences: ['mermaid'], render(src) { … } })
 *   module.exports = { … }
 * 之所以不认 ESM 的 export default：那要真的模块加载，就走不了 new Function 这条路
 * （理由见文件头与 lib/renderPlugins）。//# sourceURL 是给调试用的——报错时控制台里
 * 能看见是哪个插件文件。
 */
export function compilePlugin(source: string, file: string): PluginBase {
  const factory = new Function('register', 'module', 'exports', source + '\n//# sourceURL=moji-plugin/' + file + '\n')
  let declared: unknown = null
  const mod = { exports: {} as Record<string, unknown> }
  factory(
    (plugin: unknown) => {
      declared = plugin
    },
    mod,
    mod.exports,
  )
  const candidate = declared ?? mod.exports
  const value =
    candidate && typeof candidate === 'object' && 'default' in (candidate as Record<string, unknown>)
      ? (candidate as Record<string, unknown>).default
      : candidate
  if (!value || typeof value !== 'object') throw new Error(t('插件没有交出对象（需要调用 register({…})）'))
  return registerPlugin(value, file.replace(/\.js$/i, ''))
}

async function readSource(file: string): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  try {
    return await native().plugins.read(file)
  } catch {
    return { ok: false, error: t('读不到插件文件：应用没有跑在 Electron 里') }
  }
}

/* ---------- 启动时装载 ---------- */

/**
 * 启动时装载：读内置开关（把该关的关掉）→ 列出用户插件 → 把启用的那些编译登记。
 * 一个插件坏掉只影响它自己（status 里记下原因，设置页会显示），不打断启动。
 */
export async function loadPlugins(): Promise<void> {
  if (loaded) {
    await refreshPlugins()
    return
  }
  loaded = true
  applyBuiltinToggles(await readBuiltinToggles())
  // 先列一遍（拿到启用清单），再逐个编译；编译失败只记在自己那一行上
  await refreshPlugins()
  for (const status of statuses) {
    if (status.kind !== 'user' || !status.enabled) continue
    const src = await readSource(status.file as string)
    if (!src.ok) {
      status.error = src.error
      continue
    }
    try {
      const plugin = compilePlugin(src.content, status.file as string)
      status.active = true
      status.name = plugin.name ?? status.name
      status.category = plugin.category
      status.summary = describeOf(plugin)
    } catch (err) {
      status.error = err instanceof Error ? err.message : String(err)
    }
  }
  const active = statuses.filter((s) => s.active).length
  const failed = statuses.filter((s) => s.enabled && !s.active).length
  if (statuses.some((s) => s.kind === 'user')) {
    console.info(`[plugins] 已启用 ${active} 个插件${failed ? `，${failed} 个没装成` : ''}`)
  }
}

/** 开关一个插件；成功给 null，失败给一句错误。**重启后生效**。 */
export async function setPluginEnabled(id: string, enabled: boolean): Promise<string | null> {
  // 开的这一侧先过守卫：没准备好的插件不该被打开（见 setPluginEnableGuard）
  if (enabled) {
    const blocked = await pluginEnableBlocker(id)
    if (blocked) return blocked
  }
  const builtin = builtins.find((p) => p.id === id)
  try {
    const res = builtin ? await native().plugins.setToggle(id, enabled) : await native().plugins.setEnabled(id, enabled)
    if (!res.ok) return res.error ?? t('没能保存')
  } catch {
    return t('应用没有跑在 Electron 里')
  }
  await refreshPlugins()
  return null
}

/** 在系统文件管理器里打开用户插件目录；成功给 null */
export async function revealPluginDir(): Promise<string | null> {
  try {
    const res = await native().plugins.reveal()
    return res.ok ? null : (res.error ?? t('打不开插件目录'))
  } catch {
    return t('应用没有跑在 Electron 里')
  }
}
