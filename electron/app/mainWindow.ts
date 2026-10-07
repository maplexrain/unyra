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

/*
 * 守卫分心警告的「闪现置顶」：把窗口钉在最上层亮出来，但**不抢焦点**。
 *
 * 不走 show()+focus() 的原因：Windows 有前台锁（前台进程才有权转移焦点），
 * 守卫发警告时前台多半是别的应用，硬 focus 要么被系统拒掉要么行为不可预期；
 * setAlwaysOnTop + showInactive 不需要焦点许可——窗口就是浮在一切之上，
 * 用户看见、点一下，焦点自然回来。
 *
 * 置顶是**警告**，不是**常态**：拿到焦点（用户已经回来了）或超时（15s，没来）都解除，
 * 不然用户切去别的窗口查个东西，这窗口还一直压在上面。再次警告则重新计时。
 */
let flashTimer: NodeJS.Timeout | null = null

function endFlash(): void {
  if (flashTimer) {
    clearTimeout(flashTimer)
    flashTimer = null
  }
  const win = mainWindow()
  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(false)
    win.removeListener('focus', endFlash)
  }
}

export function flashMainWindow(ms = 15_000): void {
  const win = mainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.setAlwaysOnTop(true)
  win.showInactive()
  // 先摘再挂：连续两条警告不堆叠监听；endFlash 幂等，多绕几圈也无害
  win.removeListener('focus', endFlash)
  win.once('focus', endFlash)
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(endFlash, ms)
}
