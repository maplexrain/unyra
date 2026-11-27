/**
 * 开发者控制台窗口（独立的第四个 BrowserWindow，`?devConsole=1` 分支）。
 *
 * 这个窗口只做一件事：把主进程与**主窗口渲染进程**的 console 日志实时摊开。
 * 它加载与主窗口同一份渲染产物，但 main.tsx 在 bootApp 之前就分流到
 * DevConsoleWindow，所以不会读用户数据、不会装插件、也不会改写任何落盘内容。
 *
 * 日志来源见 devLogs.ts：主进程 console 在启动最早处被捕获，主窗口渲染层由
 * windows.ts 在页面加载前挂 console-message。控制台晚开时先回放环形缓冲。
 */
import { BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { t } from '../i18n'
import { DEV_SERVER_URL } from './startup'
import { appIcon } from './icon'
import { mainWindow } from './mainWindow'
import { type DevConsoleOpenResult, type DevLogEntry } from '../../shared/ipc'
import { devLogSnapshot, subscribeDevLogs } from './devLogs'

let devConsoleWindow: BrowserWindow | null = null

function sendToDevConsole(channel: string, payload: unknown): void {
  const win = devConsoleWindow
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  try {
    win.webContents.send(channel, payload)
  } catch {
    // 页面正在销毁 / 重载时 send 可能抛；日志推送失败不该影响开窗本身
  }
}

/**
 * 打开开发者控制台。已经开着就恢复、聚焦，回 reused: true（不另开第二个，
 * 否则同一条日志会在两个窗口里各刷一遍，开发者分不清哪个是当前）。
 */
export async function openDevConsoleWindow(): Promise<DevConsoleOpenResult> {
  if (devConsoleWindow && !devConsoleWindow.isDestroyed()) {
    if (devConsoleWindow.isMinimized()) devConsoleWindow.restore()
    devConsoleWindow.show()
    devConsoleWindow.focus()
    return { ok: true, reused: true }
  }

  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 720,
    minHeight: 460,
    backgroundColor: '#0b0e14',
    title: t('归一 Unyra · 开发者控制台'),
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
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  devConsoleWindow = win
  win.setMenuBarVisibility(false)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const stopLogs = subscribeDevLogs((entry: DevLogEntry) => {
    sendToDevConsole('dev:entry', entry)
  })

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    stopLogs()
    if (devConsoleWindow === win) devConsoleWindow = null
  })

  // 页面加载完补一次快照：控制台渲染层的订阅可能晚于 did-finish-load 挂上
  win.webContents.once('did-finish-load', () => {
    sendToDevConsole('dev:logs', devLogSnapshot())
  })

  try {
    if (DEV_SERVER_URL) {
      const sep = DEV_SERVER_URL.includes('?') ? '&' : '?'
      await win.loadURL(`${DEV_SERVER_URL}${sep}devConsole=1`)
    } else {
      await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
        query: { devConsole: '1' },
      })
    }
    return { ok: true }
  } catch (err) {
    stopLogs()
    if (!win.isDestroyed()) win.destroy()
    devConsoleWindow = null
    return { ok: false, error: err instanceof Error ? err.message : t('开发者控制台窗口打不开') }
  }
}

/** 开发者控制台的 IPC：开窗只许主窗口发起，日志快照只许控制台窗口读取。 */
export function registerDevConsoleIpc(): void {
  ipcMain.handle('dev:open', (event) => {
    const host = mainWindow()
    if (!host || host.isDestroyed() || event.sender !== host.webContents) {
      return { ok: false, error: t('只能在主窗口打开开发者控制台') }
    }
    return openDevConsoleWindow()
  })

  ipcMain.handle('dev:logs', (event) => {
    if (!devConsoleWindow || devConsoleWindow.isDestroyed()) return []
    if (event.sender !== devConsoleWindow.webContents) return []
    return devLogSnapshot()
  })
}
