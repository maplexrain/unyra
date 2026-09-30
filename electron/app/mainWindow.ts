/**
 * 这个文件负责「主窗口是哪一个」以及把它叫到前面来。
 *
 * 为什么从 windows.ts 里搬出来：托盘那边要用这两个函数（点托盘图标把窗口叫回来），
 * 而 windows.ts 又要用托盘那边的 attachCloseGuard——两边互相 import 就成环。
 * 这两个函数只依赖 electron 自己，谁都不依赖，放在中间最干净。
 *
 * windows.ts 仍然把原名转出去（`export { mainWindow, showMainWindow } from './mainWindow'`），
 * 从那里取用它们的调用方不受影响。
 */
import { BrowserWindow } from 'electron'

/** 主窗口。本应用只有一个窗口，一律取第一个 */
export function mainWindow(): BrowserWindow | null {
  const win = BrowserWindow.getAllWindows()[0]
  return win && !win.isDestroyed() ? win : null
}

export function showMainWindow(): void {
  const win = mainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
