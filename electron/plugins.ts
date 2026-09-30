/**
 * 插件目录（`{root}/plugins/`）：扫描、读取与启用状态。
 *
 * 为什么归主进程管，而不是复用 storage:* 那套相对路径读写：插件是**代码**。
 * 目录结构（只有一层 .js）与启用状态（enabled.json）属于应用，不该混进渲染层
 * 那套「什么都能写」的通用文件能力里——渲染层在这里只能做三件事：
 * 列出、读某个文件、开关。真正的执行在渲染层（见 src/lib/plugins.ts），
 * 主进程只负责把源码安全地递过去。
 *
 * 启用状态分两处，各归其位：目录里的 **enabled.json** 是用户插件的清单（文件就在这份
 * 数据目录里，跟着它走）；**内置插件**的开关进 appdata 的 global.yaml——那条通道是
 * plugins:toggles / plugins:setToggle，读写都转给 storage.ts。
 *
 * 只认单层 `*.js`：插件脚本拿不到 import（宿主用 new Function 编译，插件自己
 * import 不了包），支持子目录只会让人以为可以。要给插件用的重库由宿主白名单提供
 * （见 src/lib/renderPlugins 的 PLUGIN_LIBS）。
 */
import { ipcMain, shell } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { t } from './i18n'
import { currentRoot, pluginToggles, setPluginToggle } from './storage'

import type {
  PluginEntry, PluginListResult, PluginSourceResult,
} from '../shared/ipc'

// PluginEntry / PluginListResult / PluginSourceResult 原先在这里也写了一份
// （与 electron/preload.ts 逐字重复）：现在统一用 shared/ipc.ts，并按原样转出去。
export type {
  PluginEntry, PluginListResult, PluginSourceResult,
}

/** 数据根下的插件目录名 */
export const PLUGINS_DIR = 'plugins'
/** 启用清单的文件名（就放在插件目录里，跟着数据目录走） */
const ENABLED_FILE = 'enabled.json'

/**
 * 单个插件的大小上限。
 *
 * 不是安全边界（代码大小拦不住什么），是**防呆**：往这个目录里拖错文件
 * （打包好的整包、日志、图片）时，当场给一句「太大了」比读进来再报语法错清楚得多。
 */
const MAX_PLUGIN_BYTES = 512 * 1024

type Result = { ok: true } | { ok: false; error: string }

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const isMissing = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'

/** 插件目录的绝对路径 */
export const pluginsDir = (): string => path.join(currentRoot(), PLUGINS_DIR)

/**
 * 「插件文件名」→ 绝对路径。只认一层目录里的 .js 文件名，别的（子目录、别的扩展名、
 * 盘符、..）一律拒——渲染层传进来的东西不信任，这条通道只该碰插件目录。
 */
function pluginPath(file: unknown): string | null {
  if (typeof file !== 'string') return null
  const name = file.trim()
  if (!/^[A-Za-z0-9._-]+\.js$/i.test(name)) return null
  if (name.includes('..')) return null
  const base = path.resolve(pluginsDir())
  const full = path.resolve(base, name)
  return path.dirname(full) === base ? full : null
}

/** 建目录（首次打开设置页时就把目录备好，用户往里放文件即可） */
async function ensureDir(): Promise<string> {
  const dir = pluginsDir()
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

/** 读启用清单；读不出来（首次、手改坏了）一律当「一个都没启用」 */
async function readEnabled(): Promise<string[]> {
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(pluginsDir(), ENABLED_FILE), 'utf-8')) as {
      enabled?: unknown
    }
    return Array.isArray(raw?.enabled) ? raw.enabled.filter((f): f is string => typeof f === 'string') : []
  } catch {
    return []
  }
}

async function writeEnabled(list: string[]): Promise<Result> {
  try {
    await ensureDir()
    const data = { version: 1, enabled: [...new Set(list)].sort() }
    await fsp.writeFile(path.join(pluginsDir(), ENABLED_FILE), JSON.stringify(data, null, 2), 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

/**
 * 列出插件目录里的 .js。enabled.json 不是插件，不列。
 * 按文件名排序：设置页里的顺序要稳定，不然每次刷新都在跳。
 */
async function listPlugins(): Promise<PluginListResult> {
  let dir: string
  try {
    dir = await ensureDir()
  } catch (err) {
    return { ok: false, error: t('插件目录建不出来：{0}', errText(err)) }
  }
  try {
    const names = (await fsp.readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && /\.js$/i.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b))
    const enabled = new Set(await readEnabled())
    const entries: PluginEntry[] = []
    for (const file of names) {
      const stat = await fsp.stat(path.join(dir, file)).catch(() => null)
      if (!stat) continue
      entries.push({ file, bytes: stat.size, mtime: stat.mtimeMs, enabled: enabled.has(file) })
    }
    return { ok: true, dir, entries }
  } catch (err) {
    return { ok: false, error: t('插件目录读不出来：{0}', errText(err)) }
  }
}

/** 读一个插件的源码。渲染层只在「这个文件是启用状态」时才会来读它。 */
async function readPluginSource(file: unknown): Promise<PluginSourceResult> {
  const full = pluginPath(file)
  if (!full) return { ok: false, error: t('插件文件名不合法') }
  try {
    const stat = await fsp.stat(full)
    if (!stat.isFile()) return { ok: false, error: t('这不是一个文件') }
    if (stat.size > MAX_PLUGIN_BYTES) {
      return { ok: false, error: t('插件文件太大了（{0} KB，上限 {1} KB）', Math.round(stat.size / 1024), MAX_PLUGIN_BYTES / 1024) }
    }
    return { ok: true, content: await fsp.readFile(full, 'utf-8') }
  } catch (err) {
    if (isMissing(err)) return { ok: false, error: t('插件文件不在了') }
    return { ok: false, error: t('插件读不出来：{0}', errText(err)) }
  }
}

/**
 * 开关一个插件。写的是 enabled.json，**当场不生效**：插件在启动时注册一次，
 * 改完要重启（理由见 src/lib/renderPlugins 的注册说明）。
 */
async function setPluginEnabled(file: unknown, enabled: unknown): Promise<Result> {
  const full = pluginPath(file)
  if (!full) return { ok: false, error: t('插件文件名不合法') }
  const name = path.basename(full)
  const on = enabled === true
  if (on) {
    const exists = await fsp.stat(full).then((s) => s.isFile()).catch(() => false)
    if (!exists) return { ok: false, error: t('插件文件不在了') }
  }
  const list = await readEnabled()
  const next = on ? [...list, name] : list.filter((f) => f !== name)
  return writeEnabled(next)
}

/** 在系统文件管理器里打开插件目录（用户要往里放文件） */
async function revealPlugins(): Promise<Result> {
  try {
    const dir = await ensureDir()
    const err = await shell.openPath(dir)
    return err ? { ok: false, error: err } : { ok: true }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

/* ---------- IPC 注册 ---------- */

export function registerPluginIpc(): void {
  ipcMain.handle('plugins:list', () => listPlugins())
  ipcMain.handle('plugins:read', (_e, file: unknown) => readPluginSource(file))
  ipcMain.handle('plugins:setEnabled', (_e, file: unknown, enabled: unknown) => setPluginEnabled(file, enabled))
  ipcMain.handle('plugins:reveal', () => revealPlugins())
  // 内置插件（编译进包的那些）：全量清单在渲染层，主进程只存开关。
  // 它们跟机器走，因此落在 appdata 的 global.yaml（见 storage.ts 的 pluginToggles）。
  ipcMain.handle('plugins:toggles', () => ({ ok: true, toggles: pluginToggles() }))
  ipcMain.handle('plugins:setToggle', (_e, id: unknown, enabled: unknown) => {
    if (typeof id !== 'string' || !id.trim() || typeof enabled !== 'boolean') {
      return { ok: false, error: t('插件标识不合法') }
    }
    setPluginToggle(id, enabled)
    return { ok: true }
  })
}
