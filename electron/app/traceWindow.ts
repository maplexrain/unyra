/**
 * 这个文件负责上下文轨迹窗口（第三个 BrowserWindow）的开窗与状态推送。
 *
 * 与考试窗口（examWindow.ts）同一套结构：与主窗口**同一份渲染产物**，靠查询参数
 * `?contextTrace=1` 分支；preload 也共用一份。差别只有一条——轨迹是**纯只读**的：
 * 没有关窗确认、没有全屏、没有回发事件，主进程只做两件事：开窗、把主窗口推来的
 * 会话数据原样转发（**不解释载荷**）。
 *
 * 数据所有权照旧刻死：会话数据只在主窗口那侧（store + chat.json），轨迹窗口收到的
 * 是每次变化的完整快照（Conversation 的 JSON，全部可结构化克隆）。窗口开着期间
 * 主窗口随数据变化持续 push，轨迹永远反映当前会话的最新原样。
 */
import { BrowserWindow, Menu, ipcMain } from 'electron'
import path from 'node:path'
import { t } from '../i18n'
import { startupBackground } from '../storage'
import { DEV_SERVER_URL } from './startup'
import { appIcon } from './icon'
import { attachConsoleForwarding, hardenLinks } from './windows'

let traceWindow: BrowserWindow | null = null
/** 开窗时主窗口递来的那份会话数据：页面加载完补发一次（不保证送达，见 openTraceWindow） */
let traceInitialState: unknown

/** 发给轨迹窗口。没开、或正在销毁就丢掉 */
function sendToTrace(channel: string, payload: unknown): void {
  if (!traceWindow || traceWindow.isDestroyed()) return
  if (traceWindow.webContents.isDestroyed()) return
  traceWindow.webContents.send(channel, payload)
}

/** 发给主窗口。主窗口已经不在了就静默丢掉 */
function sendToHost(channel: string, payload: unknown): void {
  const win = hostWindow()
  if (!win || win.webContents.isDestroyed()) return
  win.webContents.send(channel, payload)
}

/** 主窗口 = 轨迹窗口之外的那一个（取法与 examWindow.hostWindow 同一条理由） */
function hostWindow(): BrowserWindow | null {
  const win = BrowserWindow.getAllWindows().find((w) => w !== traceWindow && !w.isDestroyed())
  return win ?? null
}

/**
 * 开轨迹窗口。已经开着就把它叫到前面来（reused: true）并**换数据**——轨迹窗口永远
 * 只跟一段会话走，主窗口切了会话再点「打开轨迹」，应该看到新会话而不是旧的。
 */
export async function openTraceWindow(payload: unknown): Promise<{ ok: boolean; reused?: boolean; error?: string }> {
  if (traceWindow && !traceWindow.isDestroyed()) {
    if (traceWindow.isMinimized()) traceWindow.restore()
    traceWindow.focus()
    traceInitialState = payload
    sendToTrace('trace:state', payload)
    return { ok: true, reused: true }
  }

  traceInitialState = payload

  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 980,
    height: 780,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: startupBackground(),
    title: t('归一 Unyra · 上下文轨迹'),
    icon: appIcon(),
    show: false,
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 14, y: 16 },
        }
      : {
          frame: false,
        }),
    webPreferences: {
      // 与主窗口同一个 preload：渲染层靠 ?contextTrace=1 分辨自己是哪一侧
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  traceWindow = win

  win.once('ready-to-show', () => win.show())
  attachConsoleForwarding(win)
  hardenLinks(win.webContents)

  // 允许划词后右键菜单复制
  win.webContents.on('context-menu', (_e, params) => {
    if (!params.selectionText) return
    const menu = Menu.buildFromTemplate([
      { role: 'copy', label: t('复制') },
      { type: 'separator' },
      { role: 'selectAll', label: t('全选') },
    ])
    menu.popup({ window: win })
  })

  win.on('closed', () => {
    traceWindow = null
    traceInitialState = undefined
    // 报给主窗口：它据此停止随数据变化的无谓推送（推送本身落在已关窗口会被丢弃，但省下的是渲染侧的序列化）
    sendToHost('trace:windowClosed', {})
  })

  // 页面加载完补发一次开窗时的数据（监听挂得晚就漏了——可靠的是主窗口随数据变化 push）
  win.webContents.once('did-finish-load', () => {
    if (traceInitialState !== undefined) sendToTrace('trace:state', traceInitialState)
  })

  try {
    if (DEV_SERVER_URL) {
      await win.loadURL(DEV_SERVER_URL + '?contextTrace=1')
    } else {
      await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { contextTrace: '1' } })
    }
    return { ok: true }
  } catch (err) {
    // 加载失败把半成品收掉：不 destroy 的话之后每次 open 都走进 reused，点了没反应
    if (!win.isDestroyed()) win.destroy()
    traceWindow = null
    return { ok: false, error: err instanceof Error ? err.message : t('轨迹窗口打不开') }
  }
}

/** 轨迹窗口的 IPC：只进不出——开窗、推送，没有回发通道（轨迹是只读的） */
export function registerTraceIpc(): void {
  ipcMain.handle('trace:open', (_e, payload: unknown) => openTraceWindow(payload))
  ipcMain.on('trace:push', (_e, payload: unknown) => sendToTrace('trace:state', payload))
}
