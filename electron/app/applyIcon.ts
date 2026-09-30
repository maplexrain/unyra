/**
 * 这个文件负责把一枚已染色的图标应用到窗口与托盘上。
 *
 * 为什么从 icon.ts 里搬出来：这一件事要同时碰窗口（任务栏 / Alt-Tab）与托盘，
 * 而 icon.ts 又要给托盘那边提供 appIcon()——两边互相 import 就成环。
 * 拆开之后方向是单向的：applyIcon → tray → icon。
 *
 * icon.ts 仍然把原名转出去（`export { applyAppIcon } from './applyIcon'`），
 * 从那里取用它的调用方（electron/app/ipc.ts）不受影响。
 */
import { app, BrowserWindow } from 'electron'
import { currentTray } from './tray'

/**
 * 把一枚已染色的图标同时应用到窗口（任务栏 / Alt-Tab）与托盘。
 * Windows 走窗口图标；macOS 的 dock 图标走 app.dock（按平台惯例任务栏/坞站图标
 * 通常固定，这里听用户的：跟主题一起换）。
 */
export function applyAppIcon(image: Electron.NativeImage): void {
  if (process.platform === 'darwin') {
    app.dock?.setIcon(image)
    return
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.setIcon(image)
  }
  // 托盘按 16px 出图（与 createTray 的口径一致）
  currentTray()?.setImage(image.resize({ width: 16, height: 16 }))
}
