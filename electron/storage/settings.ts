/**
 * 这个文件负责全局设置（跟机器走的那一份）：数据根目录、关窗行为、自动更新开关、内置插件开关，
 * 以及开窗用的主题底色。globalCache 这份模块级缓存与读写它的函数都在这里，不许拆开。
 *
 * 另：storage 各子模块共用的 errText / isMissing 与两个结果类型也放在这一份——它不依赖任何兄弟
 * 模块，是依赖图的最底层；为了这四行再开一个文件不值当。
 */
import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { getLocale, t } from '../i18n'

import type { CloseBehavior } from '../../shared/ipc'

// CloseBehavior 原先在这里也写了一份（与 electron/preload.ts、src/lib/native.ts 逐字重复）：
// 现在统一用 shared/ipc.ts，并按原样转出去（electron/storage.ts 仍在转它）。
export type { CloseBehavior }

export const CLOSE_BEHAVIORS: readonly CloseBehavior[] = ['ask', 'close', 'tray']

export const isCloseBehavior = (v: unknown): v is CloseBehavior =>
  typeof v === 'string' && (CLOSE_BEHAVIORS as readonly string[]).includes(v)

export interface GlobalSettings {
  version: 1
  /** 用户数据根目录。空串表示「用默认」——即 appdata 里的应用数据目录 */
  root: string
  /** 关窗行为。同样跟机器走：同一台机器上换个用户登录，关窗方式不该跟着变 */
  closeBehavior: CloseBehavior
  /**
   * 界面语言（'zh' 中文 / 'en' 英文）。跟机器走：语言是「这台机器上的人怎么读界面」，
   * 不该换一个用户登录就变回去。语言状态的拥有者是渲染层（src/i18n），
   * 这里只是默认值（系统语言）与落盘处。
   */
  uiLocale: 'zh' | 'en'
  /**
   * 要不要自动检查并下载更新。同样跟机器走：更新装在机器上，不是装在某个用户名下。
   * 关掉之后：启动时不查、轮询也不查（**连请求都不发**），
   * 设置里的「检查最新版本」仍然能在用户明确要求时查一次。
   */
  autoUpdate: boolean
  /**
   * 内置插件的开关：插件 id → 要不要开（只记被改过的那些，没记的按各自的默认值）。
   *
   * 为什么进全局设置：内置插件是编译进包里的代码，属于这台机器上的这个应用，
   * 不属于任何一份数据目录——用户插件（数据目录里的 .js）的启用清单因此另有其文件，
   * 见 electron/plugins.ts。
   */
  plugins: Record<string, boolean>
}

/** 全局设置文件名（appdata 内） */
const GLOBAL_FILE = 'global.yaml'
/** 会话文件名（appdata 内）。登录态是机器本地的，不进数据目录 */
const SESSION_FILE = 'session.json'

export type Result = { ok: true } | { ok: false; error: string }
export type ReadResult = { ok: true; content: string | null } | { ok: false; error: string }

export const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export const isMissing = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'

/* ---------- 全局设置 ---------- */

const globalPath = (): string => path.join(app.getPath('userData'), GLOBAL_FILE)
export const sessionPath = (): string => path.join(app.getPath('userData'), SESSION_FILE)

/** 默认根目录：appdata 中的应用数据目录 */
export const defaultRoot = (): string => app.getPath('userData')

/**
 * 启动窗口背景色：按「会话用户 → setting.yaml → appearance.theme」解析成纸色。
 *
 * backgroundColor 在第一帧渲染之前就生效——纯黑这类主题若先开浅色窗、等渲染层
 * 再换色，每次启动都白闪一下。跟随系统按主进程的 nativeTheme 解析成浅 / 深。
 * 会话文件、设置文件读不到（新装、未登录、手改损坏）一律回落默认纸色：
 * 这是开窗前的一次尽力而为，不该有任何抛出。
 */
const THEME_BACKGROUND: Record<string, string> = {
  light: '#f5f2eb',
  dark: '#17150f',
  sepia: '#f2ead7',
  amber: '#faf0e3',
  pink: '#fbf3f4',
  blue: '#eef3f7',
  green: '#f1f6ee',
  purple: '#f2f0f6',
  white: '#ffffff',
  graphite: '#1b1b1d',
  navy: '#10141f',
  contrast: '#000000',
  black: '#000000',
}

export function startupBackground(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionPath(), 'utf-8')) as { userId?: unknown } | null
    const userId = typeof raw?.userId === 'string' ? raw.userId : ''
    if (!userId) return THEME_BACKGROUND.light
    const settingPath = path.join(currentRoot(), 'users', userId, 'setting.yaml')
    const setting = parseYaml(fs.readFileSync(settingPath, 'utf-8')) as {
      appearance?: { theme?: unknown }
    } | null
    const theme = typeof setting?.appearance?.theme === 'string' ? setting.appearance.theme : 'system'
    const resolved = theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : theme
    return THEME_BACKGROUND[resolved] ?? THEME_BACKGROUND.light
  } catch {
    return THEME_BACKGROUND.light
  }
}

let globalCache: GlobalSettings | null = null

export function loadGlobal(): GlobalSettings {
  if (globalCache) return globalCache
  let root = ''
  let closeBehavior: CloseBehavior = 'ask'
  // 界面语言没存过时按系统语言猜（与 electron/i18n 的探测同一套）
  let uiLocale: 'zh' | 'en' = getLocale()
  // 默认开：装了新版本才修得上 bug，这是绝大多数人想要的默认
  let autoUpdate = true
  const plugins: Record<string, boolean> = {}
  try {
    const raw = parseYaml(fs.readFileSync(globalPath(), 'utf-8')) as Partial<GlobalSettings> | null
    if (raw && typeof raw.root === 'string') root = raw.root.trim()
    // 认不出来的值一律回落到默认：这份文件是给人看的，改坏了也不该弄得关不掉窗口
    if (raw && isCloseBehavior(raw.closeBehavior)) closeBehavior = raw.closeBehavior
    if (raw && (raw.uiLocale === 'zh' || raw.uiLocale === 'en')) uiLocale = raw.uiLocale
    if (raw && typeof raw.autoUpdate === 'boolean') autoUpdate = raw.autoUpdate
    if (raw && raw.plugins && typeof raw.plugins === 'object') {
      for (const [id, on] of Object.entries(raw.plugins)) if (typeof on === 'boolean') plugins[id] = on
    }
  } catch {
    // 文件不存在或损坏：用默认值，不算错误
  }
  globalCache = { version: 1, root, closeBehavior, uiLocale, autoUpdate, plugins }
  return globalCache
}

function persistGlobal(): void {
  const data = loadGlobal()
  fs.mkdirSync(path.dirname(globalPath()), { recursive: true })
  fs.writeFileSync(globalPath(), stringifyYaml(data, { lineWidth: 0 }), 'utf-8')
}

/** 当前生效的根目录 */
export function currentRoot(): string {
  return loadGlobal().root || defaultRoot()
}

/**
 * 切换根目录。空串表示恢复默认。
 * 落盘前先建目录并写一个探针文件：把不可写的路径存下来，只会让之后所有读写
 * 静默失败，不如当场告诉用户。
 *
 * 不迁移旧目录里的数据——换目录就是换一份数据，旧的原样留着。
 */
export async function setRoot(dir: unknown): Promise<{ ok: boolean; root: string; error?: string }> {
  const wanted = typeof dir === 'string' ? dir.trim() : ''
  const next = wanted || defaultRoot()
  try {
    await fsp.mkdir(next, { recursive: true })
    const probe = path.join(next, '.moji-write-test')
    await fsp.writeFile(probe, 'ok', 'utf-8')
    await fsp.rm(probe, { force: true })
  } catch (err) {
    return { ok: false, root: currentRoot(), error: t('目录不可写：{0}', errText(err)) }
  }
  // 整份替换会丢掉别的全局设置（如关窗行为），只改当前这一项
  globalCache = { ...loadGlobal(), root: wanted }
  try {
    persistGlobal()
  } catch (err) {
    return { ok: false, root: next, error: t('设置未能保存：{0}', errText(err)) }
  }
  return { ok: true, root: next }
}

/* ---------- 关窗行为 ---------- */

/** 当前生效的关窗行为 */
export function closeBehavior(): CloseBehavior {
  return loadGlobal().closeBehavior
}

/**
 * 改关窗行为并落盘。认不出来的值忽略，调用方拿返回值当准。
 * 写不进去也只在这次运行里生效——这不值得让「关窗」这件事失败。
 */
export function setCloseBehavior(value: unknown): CloseBehavior {
  if (!isCloseBehavior(value)) return closeBehavior()
  const next: GlobalSettings = { ...loadGlobal(), closeBehavior: value }
  globalCache = next
  try {
    persistGlobal()
  } catch {
    // 存不下来：本次运行照样按新的来
  }
  return next.closeBehavior
}

/* ---------- 界面语言 ---------- */

/** 当前生效的界面语言（跟机器走；语言状态的拥有者是渲染层，这里只管默认值与落盘） */
export function uiLocale(): 'zh' | 'en' {
  return loadGlobal().uiLocale
}

/**
 * 存界面语言并落盘。认不出来的值忽略；写不进去也只在这次运行里生效——
 * 与关窗行为同一条纪律：不值得让一次点击失败。
 */
export function setUiLocale(value: unknown): 'zh' | 'en' {
  if (value !== 'zh' && value !== 'en') return uiLocale()
  const next: GlobalSettings = { ...loadGlobal(), uiLocale: value }
  globalCache = next
  try {
    persistGlobal()
  } catch {
    // 存不下来：本次运行照样按新的来
  }
  return next.uiLocale
}

/* ---------- 内置插件的开关 ---------- */

/** 内置插件的开关（只含被显式改过的那些 id） */
export function pluginToggles(): Record<string, boolean> {
  return { ...loadGlobal().plugins }
}

/**
 * 改一个内置插件的开关并落盘。开关要重启才生效（理由见 src/lib/plugins），
 * 所以这里只管把状态存对——写不进去就退回原值，免得界面显示的和实际的不一致。
 */
export function setPluginToggle(id: unknown, enabled: unknown): Record<string, boolean> {
  const current = loadGlobal().plugins
  if (typeof id !== 'string' || !id.trim() || typeof enabled !== 'boolean') return { ...current }
  const next: GlobalSettings = { ...loadGlobal(), plugins: { ...current, [id.trim()]: enabled } }
  globalCache = next
  try {
    persistGlobal()
  } catch {
    // 存不下来：本次运行照样按新的来
  }
  return { ...next.plugins }
}

/* ---------- 自动更新开关 ---------- */

/** 要不要自动检查并下载更新（默认开） */
export function autoUpdate(): boolean {
  return loadGlobal().autoUpdate
}

/**
 * 改自动更新开关并落盘。认不出来的值忽略（调用方拿返回值当准）；
 * 写不进去也只在这次运行里生效——这同样不值得让一次点击失败。
 */
export function setAutoUpdate(value: unknown): boolean {
  if (typeof value !== 'boolean') return autoUpdate()
  const next: GlobalSettings = { ...loadGlobal(), autoUpdate: value }
  globalCache = next
  try {
    persistGlobal()
  } catch {
    // 存不下来：本次运行照样按新的来
  }
  return next.autoUpdate
}

/* ---------- 选择目录 ---------- */

export async function pickRoot(): Promise<{ ok: boolean; canceled?: boolean; root?: string; error?: string }> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    title: t('选择用户数据存储位置'),
    defaultPath: currentRoot(),
    properties: ['openDirectory', 'createDirectory'],
  })
  const picked = filePaths?.[0]
  if (canceled || !picked) return { ok: false, canceled: true }
  return { ok: true, root: picked }
}
