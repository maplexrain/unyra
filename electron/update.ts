/**
 * 自动更新（主进程侧）。
 *
 * 分发链：源码仓库 → 构建 → 传到**公开**的发布仓库（见 update-core 的 RELEASE_REPO）
 * → 客户端从 GitHub Releases 取版本信息与安装包。安装包是公开的，谁都能下载、
 * 谁都能升级——更新是应用自己的事，与任何账号或密钥无关。
 *
 * 什么时候去问更新源：
 * - 应用起来几秒后一次（给首屏与数据载入让路）；
 * - 之后**每 5 分钟**一次（POLL_INTERVAL_MS）：这个应用会被长期开着（关窗还能收进托盘），
 *   只在启动时查一次的话，挂着跑一天的人永远等不到新版本；
 * - 用户在设置里点「检查最新版本」时，任何时候都问。
 * 上面三种都走 shouldCheck()——关掉「自动检查更新」之后，自动的那两次连请求都不发。
 *
 * 状态机：
 *
 *   disabled     这个构建不参与自动更新（开发运行、非 Windows）
 *   idle         还没查过，或已是最新
 *   checking     正在问更新源
 *   available    查到了新版本，但还没开始下（关掉自动更新时才会停在这一档）
 *   downloading  后台下载中
 *   ready        下载完成且校验通过，顶栏出现入口，等用户点
 *   installing   用户点了「立即更新」，正在拉起安装程序
 *   error        出错了。只记下来，当前版本照常用；下一次轮询会自动再试
 *
 * 三条硬要求，都体现在下面的写法里：
 * 1. **不阻塞启动**：检查排在窗口出来之后（startUpdateChecks），且全程异步；
 * 2. **不打扰用户**：状态只是推给渲染层，显示什么由渲染层决定——下载完之前它不显示任何东西；
 * 3. **出错绝不伤到当前版本**：所有监听器只改状态，不抛、不退出、不删任何东西。
 *    新版本装在安装目录里，装不上时旧版本原封不动。
 *
 * 缓存：不自己管。electron-updater 的 pending 目录本就是单槽——登记着一份
 * update-info.json，发现哈希对不上就整个清掉重下（见 DownloadedUpdateHelper）。
 * 自己再叠一层「保留哪个版本」只会多一处会不一致的地方。
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import fs from 'node:fs'
import path from 'node:path'
import { autoUpdate as autoUpdateSetting, setAutoUpdate as persistAutoUpdate } from './storage'
import {
  FIRST_CHECK_DELAY_MS,
  POLL_INTERVAL_MS,
  failDetailOf,
  failReasonOf,
  notesText,
  releasePageUrl,
  shouldCheck,
  type CheckReason,
  type UpdateFail,
  type UpdatePhase,
} from './update-core'

export type { UpdatePhase }

/** 更新状态（形状在 electron/preload.ts 与 src/lib/native.ts 各声明一份，改动要同步） */
export interface UpdateState {
  phase: UpdatePhase
  /** 当前运行的版本 */
  current: string
  /** 发现的新版本 */
  version?: string
  /** 发布标题（GitHub Release 的标题） */
  releaseName?: string
  /** 更新说明（HTML，来自 Release 正文）。**渲染层负责消毒**，主进程不解析 HTML */
  notes?: string
  /** 安装包文件名：界面上要说清「下的是哪个包」 */
  fileName?: string
  /** 安装包体积（字节） */
  size?: number
  /** 已下载字节 */
  transferred?: number
  /** 下载速度（字节/秒） */
  bytesPerSecond?: number
  /** 下载进度 0-100；只在 downloading 时有意义 */
  percent?: number
  /** 失败归类 */
  reason?: UpdateFail
  /** 失败的原始信息：日志与设置页的详情用 */
  detail?: string
  /** 这次更新的发布页地址：想看完整说明时打开它 */
  releaseUrl?: string
  /** 最近一次检查**结束**的时间 */
  checkedAt?: number
}

/**
 * 测试/换源用的更新地址（generic provider）。
 *
 * 设了它就完全不走 GitHub：把 latest.yml 与安装包放在一个本地 HTTP 目录里，
 * 就能在开发机上把「检查 → 下载 → 校验 → 待安装」整条链路真跑一遍
 * （见 docs/packaging-and-release.md「怎么验证更新链路」）。**打包版本也能用**，所以正式用户误设这个变量
 * 就等于换了一个更新源——这只是调试开关，不是给用户的功能。
 */
const feedOverride = (): string => (process.env.MOJI_UPDATE_FEED ?? '').trim()

/**
 * 这个构建参不参与自动更新。
 *
 * 非 Windows 一律不参与：目前只有 Windows 的 NSIS 安装包这一条链路，
 * 而 electron-updater 在别的平台上会换成 AppImage / Mac 更新器——那是不一样的东西，
 * 真出了对应平台的安装包时这里要跟着改。
 *
 * 开发运行默认不参与（app.isPackaged 为假）：天天开发的人不该每次启动都去问一遍
 * GitHub，而且开发目录里没有 app-update.yml。给了 MOJI_UPDATE_FEED 才参与。
 */
function updaterEnabled(): boolean {
  if (process.platform !== 'win32') return false
  return app.isPackaged || Boolean(feedOverride())
}

/* ---------- 状态 ---------- */

let state: UpdateState = { phase: 'idle', current: '0.0.0' }

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    win.webContents.send('update:state', state)
  }
}

/* ---------- 配置 ---------- */

let configured = false

function configureUpdater(): void {
  if (configured) return
  configured = true

  state = { ...state, current: app.getVersion(), phase: updaterEnabled() ? 'idle' : 'disabled' }

  const feed = feedOverride()
  if (feed) {
    /*
     * 换源：写一份最小配置到 userData，再让 updater 从它读。
     * 为什么不用 autoUpdater.setFeedURL：那样只换了 provider，缓存目录名仍然来自
     * app-update.yml，测试源与正式源会抢同一个 pending 目录。走配置文件则连
     * updaterCacheDirName 一起换掉，两边互不干扰。
     * 也不能写进安装目录：那份 app-update.yml 在 resources/ 里，打包后不该被动。
     */
    const file = path.join(app.getPath('userData'), 'feed-override.yml')
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(
        file,
        'provider: generic\n' +
          'url: ' + JSON.stringify(feed) + '\n' +
          'updaterCacheDirName: unyra-updater-dev\n',
        'utf-8',
      )
      autoUpdater.updateConfigPath = file
    } catch (err) {
      console.error('[update] 写测试源配置失败：', err)
    }
    // 开发运行也能走这条链路（否则 isUpdaterActive 会直接把检查跳过去）
    autoUpdater.forceDevUpdateConfig = true
  }

  /*
   * **不由库来决定什么时候下**。默认是「查到就自己下」，但设置里给了「自动检查更新」
   * 这个开关：关掉之后查到的新版本应当停在「可下载」，由用户点一下再下。
   * 于是下载统一由 beginDownload() 发起，两条路（自动 / 手动）也就只有一个入口。
   */
  autoUpdater.autoDownload = false
  /*
   * **不在退出时装**。默认值是 true —— 那样用户随手关一次窗口就被换成了新版本，
   * 与「什么时候装由用户决定」冲突（尤其是关窗行为是「收进托盘」的用法，
   * 用户以为只是收起来了）。代价是没有点更新的用户会一直停在旧版本上；
   * 真觉得这样更新推不动，把这一行改成 true 即可，其余都不用动。
   */
  autoUpdater.autoInstallOnAppQuit = false
  /*
   * 明确写出来：allowDowngrade 平时是 false，但给它设 channel 的那个 setter
   * 会顺手把它置真。我们不设 channel，这里再钉一道，免得将来有人加了 channel
   * 就悄悄允许把用户降级回旧版本。
   */
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false
  // 我们只发完整安装包，不发 web installer（那种包自己没有签名校验）
  autoUpdater.disableWebInstaller = true
  // 不接日志就是全静音：出问题时终端里什么都看不到
  autoUpdater.logger = {
    info: (m?: unknown) => console.log('[update]', m),
    warn: (m?: unknown) => console.warn('[update]', m),
    error: (m?: unknown) => console.error('[update]', m),
  }

  autoUpdater.on('checking-for-update', () => setState({ phase: 'checking' }))
  autoUpdater.on('update-not-available', () =>
    setState({
      phase: 'idle',
      version: undefined,
      releaseName: undefined,
      notes: undefined,
      fileName: undefined,
      size: undefined,
      percent: undefined,
      transferred: undefined,
      bytesPerSecond: undefined,
      checkedAt: Date.now(),
    }),
  )
  autoUpdater.on('update-available', (info) => {
    // 安装包信息：文件名给界面显示，体积给进度条当分母（进度事件里还会再给一次 total）
    const fileInfo = info.files?.[0]
    const base: Partial<UpdateState> = {
      version: info.version,
      releaseName: info.releaseName ?? undefined,
      notes: notesText(info.releaseNotes),
      releaseUrl: releasePageUrl(info),
      fileName: typeof info.path === 'string' && info.path ? info.path : fileInfo?.url,
      size: typeof fileInfo?.size === 'number' ? fileInfo.size : undefined,
      reason: undefined,
      detail: undefined,
    }
    if (autoUpdateSetting()) beginDownload(base)
    else setState({ ...base, phase: 'available' })
  })
  autoUpdater.on('download-progress', (p) =>
    setState({
      phase: 'downloading',
      percent: Math.max(0, Math.min(100, Math.round(p.percent))),
      transferred: p.transferred,
      size: p.total > 0 ? p.total : state.size,
      bytesPerSecond: p.bytesPerSecond,
    }),
  )
  autoUpdater.on('update-downloaded', (info) =>
    setState({
      phase: 'ready',
      version: info.version,
      releaseName: info.releaseName ?? undefined,
      notes: notesText(info.releaseNotes),
      releaseUrl: releasePageUrl(info),
      fileName: typeof info.path === 'string' && info.path ? info.path : state.fileName,
      percent: 100,
      transferred: state.size,
      bytesPerSecond: undefined,
      reason: undefined,
      detail: undefined,
      checkedAt: Date.now(),
    }),
  )
  /*
   * 任何一步出错都只落到状态里。version 留着（如果是下载阶段挂的），
   * 这样界面上还能说出「1.0.2 没下下来」，而不是一句无头无尾的失败。
   * 下一次轮询还会自动再试一次——网络抖一下不该让更新永久停摆。
   */
  autoUpdater.on('error', (err) => {
    const reason = failReasonOf(err)
    const detail = failDetailOf(err)
    console.error('[update] 更新失败（' + reason + '）：', detail)
    setState({
      phase: 'error',
      reason,
      detail,
      percent: undefined,
      transferred: undefined,
      bytesPerSecond: undefined,
      checkedAt: Date.now(),
    })
  })
}

/* ---------- 动作 ---------- */

/**
 * 真的开始下。自动与手动两条路都走这里，免得「自动下时会清空进度、手动下时不会」
 * 这种不一致悄悄长出来。
 */
function beginDownload(patch: Partial<UpdateState> = {}): void {
  setState({ ...patch, phase: 'downloading', percent: 0, transferred: 0, bytesPerSecond: undefined })
  void autoUpdater.downloadUpdate().catch((err) => {
    // 失败通常已经由 error 事件报过；这里是兜底，免得状态永远卡在「下载中」
    setState({
      phase: 'error',
      reason: failReasonOf(err),
      detail: failDetailOf(err),
      checkedAt: Date.now(),
    })
  })
}

/**
 * 查一次。
 *
 * reason 决定的是「这次检查算不算打扰」：auto 要用户没关掉自动更新才查，
 * manual 是用户自己点的，任何时候都查。判据在 shouldCheck 里（纯逻辑，可测）。
 */
export async function checkNow(reason: CheckReason = 'manual'): Promise<UpdateState> {
  configureUpdater()
  if (!shouldCheck(state.phase, reason, autoUpdateSetting())) return state
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    /*
     * 正常情况下失败已经由 error 事件报过了，这里是兜底：
     * 万一哪一版的 checkForUpdates 只 reject 不发事件，状态就会永远卡在
     * 「正在检查」，用户以后再也点不动这个按钮。
     */
    setState({
      phase: 'error',
      reason: failReasonOf(err),
      detail: failDetailOf(err),
      checkedAt: Date.now(),
    })
  }
  return state
}

/** 下载查到的那个新版本（设置里的「下载」按钮）。只有停在 available 时才有效 */
export function downloadNow(): UpdateState {
  configureUpdater()
  if (state.phase !== 'available') return state
  beginDownload()
  return state
}

/**
 * 装。只在下载完成（ready）之后允许——按钮也只在那个状态出现。
 *
 * quitAndInstall(true, true) = 静默装 + 装完自动启动：
 * 用户已经点过确认了，再给他看一遍安装向导没有意义，而且我们这个包是
 * 「有向导的」NSIS（oneClick: false），不静默的话会弹出一整套页面。
 * 关窗拦截不会挡住它：app.quit() 先发 before-quit，那里把 quitting 置真。
 */
export function installNow(): { ok: boolean } {
  configureUpdater()
  if (state.phase !== 'ready') return { ok: false }
  setState({ phase: 'installing' })
  try {
    autoUpdater.quitAndInstall(true, true)
    return { ok: true }
  } catch (err) {
    setState({
      phase: 'error',
      reason: 'install',
      detail: failDetailOf(err),
      checkedAt: Date.now(),
    })
    return { ok: false }
  }
}

/** 打开这次更新的发布页（地址由主进程给，不接受渲染层传 URL） */
async function openReleasePage(): Promise<boolean> {
  const url = state.releaseUrl
  if (!url || !url.startsWith('https://github.com/')) return false
  try {
    await shell.openExternal(url)
    return true
  } catch (err) {
    console.error('[update] 打开发布页失败：', err)
    return false
  }
}

/* ---------- 定时 ---------- */

let pollTimer: ReturnType<typeof setInterval> | null = null

/**
 * 排上启动后那次检查，并开一个 5 分钟的轮询。窗口创建之后调用——
 * **不 await、不阻塞**，失败也只是日志里多两行，用户那边什么都看不到。
 */
export function startUpdateChecks(delayMs: number = FIRST_CHECK_DELAY_MS): void {
  configureUpdater()
  if (state.phase === 'disabled') return
  setTimeout(() => void checkNow('auto'), delayMs)
  if (pollTimer) return
  /*
   * 间隔可以按环境变量改，用途只有一个：验证「挂着跑一天」这条链路时不必真等 5 分钟
   * （与 MOJI_UPDATE_FEED 同类，都是调试开关，不是给用户的功能）。
   */
  const override = Number(process.env.MOJI_UPDATE_POLL_MS)
  const interval = Number.isFinite(override) && override >= 1000 ? override : POLL_INTERVAL_MS
  pollTimer = setInterval(() => void checkNow('auto'), interval)
}

/* ---------- IPC ---------- */

export function registerUpdateIpc(): void {
  ipcMain.handle('update:state', () => {
    configureUpdater()
    return state
  })
  ipcMain.handle('update:check', () => checkNow('manual'))
  ipcMain.handle('update:download', () => downloadNow())
  ipcMain.handle('update:install', () => installNow())
  ipcMain.handle('update:openRelease', () => openReleasePage())

  // 「自动检查更新」是全局设置（appdata 的 global.yaml，见 storage.ts）
  ipcMain.handle('update:getAuto', () => autoUpdateSetting())
  ipcMain.handle('update:setAuto', (_e, value: unknown) => {
    const next = persistAutoUpdate(value)
    /*
     * 刚从「关」拨到「开」，而手上正好有一个查到但没下的版本：
     * 按新的意思把它下起来。否则要等到下一次轮询（最多 5 分钟）才动，
     * 用户会觉得开关没生效。
     */
    if (next && state.phase === 'available') beginDownload()
    return next
  })
}
