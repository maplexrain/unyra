import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockWindows: any[] = []
let closeBehaviorValue = 'ask'

vi.mock('electron', () => {
  return {
    BrowserWindow: {
      getAllWindows: () => mockWindows,
      getFocusedWindow: () => null,
    },
    app: {
      quit: vi.fn(),
    },
    Menu: {
      buildFromTemplate: vi.fn(),
    },
    Tray: vi.fn(),
  }
})

vi.mock('../electron/storage', () => {
  return {
    closeBehavior: () => closeBehaviorValue,
  }
})

vi.mock('../electron/i18n', () => {
  return {
    t: (s: string) => s,
  }
})

vi.mock('../electron/app/icon', () => {
  return {
    appIcon: () => ({
      resize: () => ({ isEmpty: () => false }),
      isEmpty: () => false,
    }),
  }
})

import { mainWindow, setMainWindow, showMainWindow } from '../electron/app/mainWindow'
import { attachCloseGuard, hideToTray } from '../electron/app/tray'

describe('窗口管理与关窗最小化到托盘策略', () => {
  beforeEach(() => {
    mockWindows.length = 0
    setMainWindow(null)
    closeBehaviorValue = 'ask'
    vi.clearAllMocks()
  })

  it('当存在截图窗口等置顶辅助窗口且排在 getAllWindows 第一个时，mainWindow 能精准定位真实主窗口', () => {
    const screenshotWin = {
      id: 'screenshot',
      isDestroyed: () => false,
      hide: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      isMinimized: () => false,
      restore: vi.fn(),
    }
    const realMainWin = {
      id: 'main',
      isDestroyed: () => false,
      hide: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      isMinimized: () => false,
      restore: vi.fn(),
    }

    // 辅助窗口（如预热的截图窗口）在 Z-order 最前
    mockWindows.push(screenshotWin, realMainWin)

    // 若未注入主窗口引用，会误命中列表首位（辅助窗口）
    expect(mainWindow()?.id).toBe('screenshot')

    // 注入真实主窗口引用后
    setMainWindow(realMainWin as any)
    expect(mainWindow()?.id).toBe('main')

    // showMainWindow 必须唤醒真实主窗口，而非截图窗口
    showMainWindow()
    expect(realMainWin.show).toHaveBeenCalled()
    expect(realMainWin.focus).toHaveBeenCalled()
    expect(screenshotWin.show).not.toHaveBeenCalled()
  })

  it('主窗口销毁或置空时，mainWindow 能够安全回退', () => {
    const mainWin = {
      id: 'main',
      destroyed: false,
      isDestroyed: () => mainWin.destroyed,
    }
    const otherWin = {
      id: 'other',
      isDestroyed: () => false,
    }
    mockWindows.push(otherWin)
    setMainWindow(mainWin as any)
    expect(mainWindow()?.id).toBe('main')

    mainWin.destroyed = true
    expect(mainWindow()?.id).toBe('other')

    setMainWindow(null)
    expect(mainWindow()?.id).toBe('other')
  })

  it('hideToTray 可直接操作指定窗口，或回退至精准主窗口', () => {
    const winA = {
      id: 'winA',
      isDestroyed: () => false,
      hide: vi.fn(),
    }
    const winB = {
      id: 'winB',
      isDestroyed: () => false,
      hide: vi.fn(),
    }
    setMainWindow(winB as any)

    hideToTray(winA as any)
    expect(winA.hide).toHaveBeenCalled()
    expect(winB.hide).not.toHaveBeenCalled()

    hideToTray()
    expect(winB.hide).toHaveBeenCalled()
  })

  it('当关闭策略为 tray 时，触发窗口 close 事件应有效隐藏窗口收进托盘，而不是无响应', () => {
    closeBehaviorValue = 'tray'
    const closeListeners: Array<(e: any) => void> = []

    const win = {
      id: 'main',
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
      hide: vi.fn(),
      on: (event: string, cb: (e: any) => void) => {
        if (event === 'close') closeListeners.push(cb)
      },
    }

    setMainWindow(win as any)
    attachCloseGuard(win as any)

    expect(closeListeners.length).toBe(1)
    const event = { preventDefault: vi.fn() }
    closeListeners[0](event)

    // 关窗动作被拦截，同时窗口执行 hide() 收进托盘
    expect(event.preventDefault).toHaveBeenCalled()
    expect(win.hide).toHaveBeenCalled()
    // 不应触发询问事件
    expect(win.webContents.send).not.toHaveBeenCalled()
  })

  it('当存在辅助窗口且关闭策略为 tray 时，关窗拦截仍精准隐藏主窗口，不会误操作辅助窗口', () => {
    closeBehaviorValue = 'tray'
    const screenshotWin = {
      id: 'screenshot',
      isDestroyed: () => false,
      hide: vi.fn(),
    }
    const closeListeners: Array<(e: any) => void> = []
    const realMainWin = {
      id: 'main',
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: vi.fn(),
      },
      hide: vi.fn(),
      on: (event: string, cb: (e: any) => void) => {
        if (event === 'close') closeListeners.push(cb)
      },
    }

    mockWindows.push(screenshotWin, realMainWin)
    setMainWindow(realMainWin as any)
    attachCloseGuard(realMainWin as any)

    const event = { preventDefault: vi.fn() }
    closeListeners[0](event)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(realMainWin.hide).toHaveBeenCalled()
    expect(screenshotWin.hide).not.toHaveBeenCalled()
  })
})
