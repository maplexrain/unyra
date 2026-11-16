/**
 * 这个文件负责全局设置（跟机器走的那一份）：数据根目录、关窗行为、自动更新开关与更新策略、
 * 内置插件开关，以及开窗用的主题底色。globalCache 这份模块级缓存与读写它的函数都在这里，不许拆开。
 *
 * 另：storage 各子模块共用的 errText / isMissing 与两个结果类型也放在这一份——它不依赖任何兄弟
 * 模块，是依赖图的最底层；为了这四行再开一个文件不值当。
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { app } from 'electron'
import { isUpdateChannel } from '../update-core'
import { getLocale, t } from '../i18n'
import { getUserDataDir } from './userData'

import type { CloseBehavior, NoticeSettings, UpdateChannel } from '../../shared/ipc'

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
  uiLocale: string
  /**
   * 要不要自动检查并下载更新。同样跟机器走：更新装在机器上，不是装在某个用户名下。
   * 关掉之后：启动时不查、轮询也不查（**连请求都不发**），
   * 设置里的「检查最新版本」仍然能在用户明确要求时查一次。
   */
  autoUpdate: boolean
  /**
   * 更新策略（正式版 / 尝鲜版）：按哪一档接收新版本，同样跟机器走。
   * 默认正式版——最稳；想要尝鲜的人自己去设置里切（判据与语义见 update-core 的注释）。
   */
  updateChannel: UpdateChannel
  /**
   * 内置插件的开关：插件 id → 要不要开（只记被改过的那些，没记的按各自的默认值）。
   *
   * 为什么进全局设置：内置插件是编译进包里的代码，属于这台机器上的这个应用，
   * 不属于任何一份数据目录——用户插件（数据目录里的 .js）的启用清单因此另有其文件，
   * 见 electron/plugins.ts。
   */
  plugins: Record<string, boolean>
  /**
   * 远程公告在本机的状态（要不要自动弹、上次弹时的版本号、读过哪些 id）。
   *
   * 为什么进全局设置：公告是应用级的，跟机器走——同一台机器换个用户登录不该又弹一遍，
   * 用户关掉自动弹出也该对这台机器上的所有用户生效。语义见 shared/ipc 的 NoticeSettings。
   */
  notice: NoticeSettings
}

/** 公告状态的默认值：每次打开都弹（autoShow=true），还没弹过（版本号为空） */
export const DEFAULT_NOTICE: NoticeSettings = { autoShow: true, shownVersion: '', readIds: [] }

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

const globalPath = (): string => path.join(getUserDataDir(), GLOBAL_FILE)
/** 上一份写成功的内容。主文件被外部弄坏时退到它 */
const globalBackupPath = (): string => globalPath() + '.bak'
/**
 * 主文件在、但读不出来时它的原文（半截 / 编码坏 / 权限）。
 *
 * 为什么要留着：这份文件里 root 是「用户的数据到底在哪」的唯一线索。读不出来不等于没配过，
 * 一旦按默认值继续跑并写回去，用户的目录设置就永久消失了——issue #143 报的正是这个。
 */
let globalUnreadable = ''
/** 这一轮是从 .bak 读出来的：那就绝不能用坏掉的主文件去覆盖那份好备份 */
let globalFromBackup = false

/**
 * 读全局设置文件，主文件读不出来时退到 .bak。
 *
 * 「空文件」也算坏：writeFileSync 被杀在中途时留下的正是 0 字节，parseYaml('') 不报错、
 * 只返回 null——这正是它以前能一路静默回落的原因。
 */
function readGlobalFile(): Partial<GlobalSettings> | null {
  let text: string
  try {
    text = fs.readFileSync(globalPath(), 'utf-8')
  } catch (err) {
    // 文件不存在（第一次运行）不算坏。读不出来（权限 / 坏扇区）要留证据
    if (!isMissing(err)) globalUnreadable = '[无法读取] ' + errText(err)
    return readGlobalBackup()
  }
  if (!text.trim()) {
    globalUnreadable = text
    return readGlobalBackup()
  }
  try {
    return parseYaml(text) as Partial<GlobalSettings> | null
  } catch {
    globalUnreadable = text
    return readGlobalBackup()
  }
}

function readGlobalBackup(): Partial<GlobalSettings> | null {
  try {
    const text = fs.readFileSync(globalBackupPath(), 'utf-8')
    if (!text.trim()) return null
    const raw = parseYaml(text) as Partial<GlobalSettings> | null
    if (raw) globalFromBackup = true
    return raw
  } catch {
    return null
  }
}
export const sessionPath = (): string => path.join(getUserDataDir(), SESSION_FILE)

/** 默认根目录：appdata 中的应用数据目录 */
export const defaultRoot = (): string => getUserDataDir()

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
    let isDark = false
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require('electron')
      isDark = electron?.nativeTheme?.shouldUseDarkColors ?? false
    } catch {
      // not in electron
    }
    const resolved = theme === 'system' ? (isDark ? 'dark' : 'light') : theme
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
  let uiLocale: string = getLocale()
  // 默认开：装了新版本才修得上 bug，这是绝大多数人想要的默认
  let autoUpdate = true
  // 默认正式版：最稳的那一档；尝鲜要用户自己在设置里明确切过去
  let updateChannel: UpdateChannel = 'stable'
  const plugins: Record<string, boolean> = {}
  // 公告状态：认不出来的字段一律回落到默认（每次打开都弹、没读过任何一条）
  let notice: NoticeSettings = { ...DEFAULT_NOTICE }
  const raw = readGlobalFile()
  if (raw && typeof raw.root === 'string') root = raw.root.trim()
  // 认不出来的值一律回落到默认：这份文件是给人看的，改坏了也不该弄得关不掉窗口
  if (raw && isCloseBehavior(raw.closeBehavior)) closeBehavior = raw.closeBehavior
  if (raw && (raw.uiLocale === 'zh' || raw.uiLocale === 'en')) uiLocale = raw.uiLocale
  if (raw && typeof raw.autoUpdate === 'boolean') autoUpdate = raw.autoUpdate
  if (raw && isUpdateChannel(raw.updateChannel)) updateChannel = raw.updateChannel
  if (raw && raw.plugins && typeof raw.plugins === 'object') {
    for (const [id, on] of Object.entries(raw.plugins)) if (typeof on === 'boolean') plugins[id] = on
  }
  if (raw && raw.notice && typeof raw.notice === 'object') notice = normalizeNotice(raw.notice)
  globalCache = { version: 1, root, closeBehavior, uiLocale, autoUpdate, updateChannel, plugins, notice }
  return globalCache
}

/**
 * 把从磁盘读到的公告状态收敛成一份**永远合法**的值。
 *
 * 这份文件是给人看的，手改坏了（比如把 readIds 写成字符串）不该让公告模块拿到
 * 一个奇怪的形状——它要跨 IPC 传、还要参与渲染层的判定，字段类型必须钉死。
 */
function normalizeNotice(raw: Partial<NoticeSettings> | null | undefined): NoticeSettings {
  const autoShow = typeof raw?.autoShow === 'boolean' ? raw.autoShow : DEFAULT_NOTICE.autoShow
  const shownVersion = typeof raw?.shownVersion === 'string' ? raw.shownVersion.trim() : ''
  const readIds = Array.isArray(raw?.readIds)
    ? raw.readIds.filter((id): id is string => typeof id === 'string' && !!id.trim())
    : []
  return { autoShow, shownVersion, readIds }
}

function persistGlobal(): void {
  const data = loadGlobal()
  const target = globalPath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  /*
    主文件是坏的那一份：先原样留一份证据再覆盖。用户还能把它发过来，我们也还能从里面
    用肉眼捞出 root 那一行（这正是 #143 里最要紧、却已经找不回来的信息）。
  */
  if (globalUnreadable) {
    try {
      fs.writeFileSync(target + '.corrupt-' + Date.now() + '.txt', globalUnreadable, 'utf-8')
    } catch {
      // 留不下证据也不该挡住这次正常写入
    }
    globalUnreadable = ''
  }
  const text = stringifyYaml(data, { lineWidth: 0 })
  /*
    先写 .tmp 再改名：中途被杀（更新时 quitAndInstall、任务管理器、断电）只会留下一个
    没人认的 tmp，主文件仍是上一份完整内容。直接 writeFileSync 被截断的后果是整份设置
    ——含 root——读不出来，而下一次保存会把默认值写回去，用户的数据目录设置就此永久消失。
  */
  const tmp = target + '.tmp'
  fs.writeFileSync(tmp, text, 'utf-8')
  // 上一份留成 .bak。从备份恢复的这一轮不覆盖它：那会把唯一一份好的副本换成坏的
  if (!globalFromBackup) {
    try {
      fs.copyFileSync(target, globalBackupPath())
    } catch {
      // 第一次写：还没有旧文件
    }
  }
  fs.renameSync(tmp, target)
  globalFromBackup = false
}

/** 当前生效的根目录 */
export function currentRoot(): string {
  return loadGlobal().root || defaultRoot()
}

/* ---------- 数据根 × 安装目录的风险检测 ---------- */

/**
 * 安装目录（exe 所在目录）。开发态返回 null：exe 在 node_modules 的 electron 里，
 * 「安装目录」这个概念不存在，校验只会误伤。
 */
function installDirOf(): string | null {
  if (!app.isPackaged) return null
  try {
    return fs.realpathSync(path.dirname(app.getPath('exe')))
  } catch {
    return null
  }
}

/** 路径归一：resolve + 去尾分隔符；Windows 另做小写（不分区大小写） */
function normPath(p: string): string {
  const resolved = path.resolve(p).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** 数据根 × 安装目录的风险类型（形状与 shared/ipc 的 RootRisk 一致） */
export type RootRisk = 'inside-install-dir' | 'contains-install-dir'

/**
 * 数据根与安装目录的**互相包含**检测（shared/ipc 的 RootRisk）。
 *
 * 为什么要拦：更新走 electron-updater + NSIS 静默安装，会先静默卸载旧版本——
 * 卸载器清整个安装目录。数据根只要与安装目录有包含关系（在里面、或者把它包住了），
 * 更新那一刻数据就会（或可能）被一并删掉。`deleteAppDataOnUninstall: false` 只保护
 * appdata 里的 userData（global.yaml 所在地），管不到用户自选的数据根——这正是
 * 用户反馈「更新后数据没了」的根因。根在 `setRoot` 入口处拒绝是最便宜的解。
 */
export function dataRootRiskOf(root: string): RootRisk | null {
  const installDir = installDirOf()
  if (!installDir || !root.trim()) return null
  let r: string
  try {
    r = normPath(fs.realpathSync(root))
  } catch {
    r = normPath(root)
  }
  const i = normPath(installDir)
  if (r === i || r.startsWith(i + path.sep)) return 'inside-install-dir'
  if (i.startsWith(r + path.sep)) return 'contains-install-dir'
  return null
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
  // 安装目录的包含关系先于可写性检查：目录还没建就能判定，不必先把雷埋下去
  const risk = dataRootRiskOf(next)
  if (risk === 'inside-install-dir') {
    return {
      ok: false,
      root: currentRoot(),
      error: t('数据目录不能放在软件安装目录里：更新软件时安装目录会被整个清空，数据会一并删除。请选择安装目录之外的位置。'),
    }
  }
  if (risk === 'contains-install-dir') {
    return {
      ok: false,
      root: currentRoot(),
      error: t('数据目录不能包含软件安装目录：更新时安装目录会被整个清空，数据同样危在旦夕。请把两者分开存放。'),
    }
  }
  try {
    await fsp.mkdir(next, { recursive: true })
    const probe = path.join(next, '.unyra-write-test')
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
export function uiLocale(): string {
  return loadGlobal().uiLocale
}

/**
 * 存界面语言并落盘。写不进去也只在这次运行里生效——
 * 与关窗行为同一条纪律：不值得让一次点击失败。
 */
export function setUiLocale(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return uiLocale()
  const clean = value.trim()
  const next: GlobalSettings = { ...loadGlobal(), uiLocale: clean }
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

/* ---------- 更新策略（正式版 / 尝鲜版） ---------- */

/** 当前更新策略（默认 stable 正式版） */
export function updateChannel(): UpdateChannel {
  return loadGlobal().updateChannel
}

/**
 * 改更新策略并落盘。认不出来的值忽略（调用方拿返回值当准）；
 * 写不进去也只在这次运行里生效——与其余几项同一条纪律。
 */
export function setUpdateChannel(value: unknown): UpdateChannel {
  if (!isUpdateChannel(value)) return updateChannel()
  const next: GlobalSettings = { ...loadGlobal(), updateChannel: value }
  globalCache = next
  try {
    persistGlobal()
  } catch {
    // 存不下来：本次运行照样按新的来
  }
  return next.updateChannel
}

/* ---------- 公告（远程公告的本地状态） ---------- */

/** 当前生效的公告状态（一份拷贝，调用方改它不影响缓存） */
export function noticeSettings(): NoticeSettings {
  const n = loadGlobal().notice
  return { ...n, readIds: [...n.readIds] }
}

/**
 * 改公告状态并落盘。**按字段合并**：渲染层每次只改自己关心的那一项
 * （勾一下「不再自动弹出」、或把已弹版本号追平），不关心的一次都不该动——
 * 整份替换会让两个并发的写入互相覆盖。
 *
 * 与其余几项同一条纪律：认不出来的值忽略，写不进去也只在本次运行里生效，
 * 不因为一次落盘失败就打断界面。
 */
export function setNoticeSettings(patch: Partial<NoticeSettings>): NoticeSettings {
  const cur = loadGlobal().notice
  const next: NoticeSettings = normalizeNotice({
    autoShow: typeof patch.autoShow === 'boolean' ? patch.autoShow : cur.autoShow,
    shownVersion: typeof patch.shownVersion === 'string' ? patch.shownVersion : cur.shownVersion,
    readIds: Array.isArray(patch.readIds) ? patch.readIds : cur.readIds,
  })
  globalCache = { ...loadGlobal(), notice: next }
  try {
    persistGlobal()
  } catch {
    // 存不下来：本次运行照样按新的来
  }
  return { ...next, readIds: [...next.readIds] }
}

/* ---------- 选择目录 ---------- */

async function pickDirectoryNativeOS(defaultPath?: string): Promise<{ ok: boolean; canceled?: boolean; root?: string; error?: string }> {
  const { execFile } = await import('node:child_process')
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      const script = `
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = '选择用户数据存储位置'
$d.ShowNewFolderButton = $true
${defaultPath ? `$d.SelectedPath = '${defaultPath.replace(/'/g, "''")}'` : ''}
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $d.SelectedPath
}
`
      execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { timeout: 120000 }, (err, stdout) => {
        if (err) {
          resolve({ ok: false, error: err.message })
        } else {
          const picked = stdout.trim()
          if (!picked) resolve({ ok: false, canceled: true })
          else resolve({ ok: true, root: picked })
        }
      })
    })
  } else if (process.platform === 'darwin') {
    return new Promise((resolve) => {
      const script = 'POSIX path of (choose folder with prompt "选择用户数据存储位置")'
      execFile('osascript', ['-e', script], { timeout: 120000 }, (err, stdout) => {
        if (err) {
          resolve({ ok: false, canceled: true })
        } else {
          const picked = stdout.trim()
          if (!picked) resolve({ ok: false, canceled: true })
          else resolve({ ok: true, root: picked })
        }
      })
    })
  }
  return { ok: false, error: t('当前服务端环境不支持调用系统原生目录弹窗') }
}

export async function pickRoot(): Promise<{ ok: boolean; canceled?: boolean; root?: string; error?: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron')
    if (electron?.dialog?.showOpenDialog) {
      const win = electron.BrowserWindow?.getFocusedWindow?.() ?? electron.BrowserWindow?.getAllWindows?.()[0] ?? undefined
      const { canceled, filePaths } = await electron.dialog.showOpenDialog(win!, {
        title: t('选择用户数据存储位置'),
        defaultPath: currentRoot(),
        properties: ['openDirectory', 'createDirectory'],
      })
      const picked = filePaths?.[0]
      if (canceled || !picked) return { ok: false, canceled: true }
      return { ok: true, root: picked }
    }
  } catch {
    // not in electron
  }

  try {
    return await pickDirectoryNativeOS(currentRoot())
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}
