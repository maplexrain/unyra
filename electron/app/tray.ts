/**
 * 这个文件负责托盘与关窗行为：托盘的建立、收进托盘、退出，以及决定「点关闭按钮做什么」的拦截。
 *
 * 三个模块级状态（quitting / tray / trayHintShown）与读写它们的函数都在这一份里；
 * 需要跨模块读写的（main.ts 标记退出、icon.ts 换托盘图标）走下面的小读写口。
 */
import { app, BrowserWindow, Menu, Tray } from 'electron'
import { t } from '../i18n'
import { closeBehavior } from '../storage'
import { appIcon } from './icon'
import { mainWindow, showMainWindow } from './mainWindow'

/* ---------- 图标 / 托盘 / 关窗行为 ---------- */

/** 真的在退出。关窗拦截据此放行（见 attachCloseGuard） */
let quitting = false

/** 标记「正在退出」。装配层（main.ts 的 before-quit）用它放行关窗拦截——状态留在这个模块里 */
export function markQuitting(): void {
  quitting = true
}

let tray: Tray | null = null

/**
 * 托盘图标：程序一起来就建，一直留到退出。
 *
 * 「收进托盘」之后窗口就没了，托盘是唯一的入口，所以它不能等到第一次关窗才建；
 * 常驻的代价只是通知区多一个图标，换来的是「窗口不见了也知道程序还在」。
 */
export function createTray(): void {
  if (tray) return
  // 通知区按 16px 出图，先自己缩一次，比让系统缩更清楚
  const small = appIcon().resize({ width: 16, height: 16 })
  tray = new Tray(small.isEmpty() ? appIcon() : small)
  tray.setToolTip('归一 Unyra')
  rebuildTrayMenu()
  // 单击与双击都还原窗口：Windows 上两种习惯都有
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
  // 点气泡通知同样把窗口叫回来——通知的意义就是「回来」（见 showTrayBalloon）
  tray.on('balloon-click', () => showMainWindow())
}

/**
 * 建 / 重建托盘菜单。文案走 t()，而渲染层切换界面语言时主进程这边拿不到 React 的重渲染，
 * 所以 `ui-locale` 的处理器会再调一次（setContextMenu 幂等）；tooltip 是纯品牌词，不用换。
 */
export function rebuildTrayMenu(): void {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t('显示主窗口'), click: () => showMainWindow() },
      { label: t('收进托盘'), click: () => hideToTray() },
      { type: 'separator' },
      { label: t('退出'), click: () => quitApp() },
    ]),
  )
}

/**
 * 托盘实例。给 icon.ts 用：运行时染色之后要顺手把托盘上那枚也换掉（见 applyAppIcon）。
 * 状态留在这个模块里，因此只开这一个读口子。
 */
export function currentTray(): Tray | null {
  return tray
}

/**
 * 托盘气泡通知。守卫 agent 的分心警告与隐私熔断走它，而不是 `new Notification()`：
 * WinRT 的 toast 通知要求 AppUserModelID 在系统里注册过（打包安装后才有），
 * dev 未打包的实例上 AUMID 是个没注册的空号，toast 会被 Windows **静默丢弃**——
 * 「点了严格专注却一条通知都不来」就是这个。气泡（Win10+ 同样渲染成 toast）
 * 不依赖 AUMID 注册，dev 与打包都亮；「收进托盘」的提示用的也是这条路。
 *
 * 回是否真的发了：托盘不在或非 Windows 回 false，调用方退回 Notification。
 */
export function showTrayBalloon(title: string, body: string): boolean {
  if (!tray || process.platform !== 'win32') return false
  try {
    tray.displayBalloon({ title, content: body })
    return true
  } catch {
    // 系统关掉了气泡通知（专注助手/通知设置）：不是错误，让调用方走兜底
    return false
  }
}

let trayHintShown = false

/**
 * 收进托盘：只隐藏窗口，进程、渲染状态、正在跑的那一轮回答都留着。
 * 第一次收起来时给一个气泡——窗口「啪」地消失，不说一句会让人以为程序被关掉了。
 */
export function hideToTray(): void {
  const win = mainWindow()
  if (!win) return
  win.hide()
  if (trayHintShown || process.platform !== 'win32') return
  trayHintShown = true
  try {
    tray?.displayBalloon({
      title: t('归一仍在后台运行'),
      content: t('点托盘图标可以重新打开窗口；右键菜单里可以退出。'),
    })
  } catch {
    // 系统关掉了气泡通知：不是错误，也不再重试
  }
}

/** 退出：先放开关窗拦截，再交给 Electron 走正常退出流程（会触发 before-quit） */
export function quitApp(): void {
  quitting = true
  app.quit()
}

/**
 * 关窗拦截：点关闭按钮之后做什么，由「关窗行为」决定（见 storage.ts 的 closeBehavior）。
 *
 * 三种情况都要先把默认行为挡住——窗口一旦真的关掉，「收进托盘」就无从谈起了。
 * 「询问」交给渲染层弹窗：对话框是应用自己画的，风格与其余弹窗一致，
 * 也能带一个「不再询问」的勾选框（见 src/components/CloseDialog.tsx）。
 * 渲染进程已经没了的时候没得问，直接退出，免得留下一个关不掉的窗口。
 */
export function attachCloseGuard(win: BrowserWindow): void {
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    const policy = closeBehavior()
    if (policy === 'close') {
      quitApp()
      return
    }
    if (policy === 'tray') {
      hideToTray()
      return
    }
    if (win.isDestroyed() || win.webContents.isDestroyed()) {
      quitApp()
      return
    }
    win.webContents.send('window:closeRequested')
  })
}
