/**
 * 这个文件负责系统层级全屏截图窗口（独立 BrowserWindow）的全部：
 * 桌面全屏采集、无黑闪开窗、画面加载、钉图/复制/保存中转与关窗。
 *
 * 类似 examWindow 与 traceWindow：与主窗口共用同一份渲染产物，通过 ?screenshotWindow=1 分支。
 * 覆盖整个目标显示器，置顶置显，零黑帧闪烁。
 */
import { BrowserWindow, desktopCapturer, ipcMain, screen, clipboard, nativeImage, dialog, type DesktopCapturerSource } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { t } from '../i18n'
import { DEV_SERVER_URL } from './startup'
import { attachConsoleForwarding } from './windows'
import { openPinWindow, type PinnedItemPayload } from './pinWindow'

let screenshotWindow: BrowserWindow | null = null
let capturedImageDataUrl: string | null = null
let capturedSystemRects: Array<{ x: number; y: number; width: number; height: number }> = []

function hostWindow(): BrowserWindow | null {
  const win = BrowserWindow.getAllWindows().find((w) => w !== screenshotWindow && !w.isDestroyed())
  return win ?? null
}

export async function openScreenshotWindow(): Promise<{ ok: boolean; error?: string }> {
  if (screenshotWindow && !screenshotWindow.isDestroyed()) {
    screenshotWindow.focus()
    return { ok: true }
  }

  try {
    // 1. 获取光标所在显示器或主显示器
    const cursorPoint = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursorPoint) || screen.getPrimaryDisplay()
    const { x, y, width, height } = display.bounds
    const scaleFactor = display.scaleFactor || 1

    // 2. 截取该显示器的完整高清桌面
    let sources: DesktopCapturerSource[] = []
    try {
      sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(width * scaleFactor),
          height: Math.round(height * scaleFactor),
        },
      })
    } catch (e) {
      console.warn('[Screenshot] desktopCapturer getSources error:', e)
    }

    let targetSource = sources.find((s) => s.display_id === display.id.toString())
    if (!targetSource || !targetSource.thumbnail || targetSource.thumbnail.isEmpty()) {
      targetSource = sources.find((s) => s.thumbnail && !s.thumbnail.isEmpty()) || sources[0]
    }

    if (targetSource && targetSource.thumbnail && !targetSource.thumbnail.isEmpty()) {
      capturedImageDataUrl = targetSource.thumbnail.toDataURL()
    } else {
      // 容错兜底：若系统级源为空或被安全会话阻断，从应用主窗口捕获画面，保证绝无黑屏
      const host = hostWindow()
      if (host && !host.isDestroyed()) {
        const pageImg = await host.webContents.capturePage()
        if (!pageImg.isEmpty()) {
          capturedImageDataUrl = pageImg.toDataURL()
        }
      }
    }

    if (!capturedImageDataUrl) {
      return { ok: false, error: t('未能获取屏幕截图画面') }
    }

    // 收集系统与窗口边界，供截图时自动窗口捕捉使用
    const sysRects: Array<{ x: number; y: number; width: number; height: number }> = []
    if (display.workArea) {
      sysRects.push({
        x: Math.max(0, display.workArea.x - display.bounds.x),
        y: Math.max(0, display.workArea.y - display.bounds.y),
        width: display.workArea.width,
        height: display.workArea.height,
      })
    }
    sysRects.push({
      x: 0,
      y: 0,
      width: display.bounds.width,
      height: display.bounds.height,
    })
    for (const w of BrowserWindow.getAllWindows()) {
      if (w !== screenshotWindow && !w.isDestroyed() && w.isVisible() && !w.isMinimized()) {
        const b = w.getBounds()
        sysRects.push({
          x: Math.max(0, b.x - display.bounds.x),
          y: Math.max(0, b.y - display.bounds.y),
          width: b.width,
          height: b.height,
        })
      }
    }
    capturedSystemRects = sysRects

    // 3. 创建贴合整个屏幕的顶层全屏无边框窗口（thickFrame: false 彻底禁用 Windows DWM 开窗缩放放大动画）
    const win = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: false,
      backgroundColor: '#111621',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      show: false, // 页面加载并绘制好首帧后再显示，彻底避免黑屏闪烁
      thickFrame: false, // 禁用 Windows 默认窗口动画 (WS_THICKFRAME)，避免开窗出现放大动画
      hasShadow: false, // 禁用系统阴影淡入动画
      roundedCorners: false, // 禁用 Windows 11 圆角动画
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })

    screenshotWindow = win
    attachConsoleForwarding(win)

    // 兜底超时显示：防止网络或首帧上报异常时窗口永久隐藏
    let hasShown = false
    const showTimeout = setTimeout(() => {
      if (!hasShown && screenshotWindow && !screenshotWindow.isDestroyed()) {
        hasShown = true
        screenshotWindow.showInactive()
        screenshotWindow.focus()
      }
    }, 1000)

    win.once('show', () => {
      hasShown = true
      clearTimeout(showTimeout)
    })

    win.on('closed', () => {
      hasShown = true
      clearTimeout(showTimeout)
      screenshotWindow = null
      capturedImageDataUrl = null
    })

    if (DEV_SERVER_URL) {
      await win.loadURL(DEV_SERVER_URL + '?screenshotWindow=1')
    } else {
      await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
        query: { screenshotWindow: '1' },
      })
    }

    return { ok: true }
  } catch (err) {
    if (screenshotWindow && !screenshotWindow.isDestroyed()) {
      screenshotWindow.destroy()
    }
    screenshotWindow = null
    capturedImageDataUrl = null
    return { ok: false, error: err instanceof Error ? err.message : t('截图窗口创建失败') }
  }
}

export function closeScreenshotWindow(): void {
  if (screenshotWindow && !screenshotWindow.isDestroyed()) {
    screenshotWindow.close()
  }
  screenshotWindow = null
  capturedImageDataUrl = null
}

export function registerScreenshotIpc(): void {
  // 1. 触发系统级全屏截图开窗
  ipcMain.handle('screenshot:open', async () => openScreenshotWindow())

  // 2. 截图窗口获取当前冻结桌面图像
  ipcMain.handle('screenshot:getImage', () => {
    return capturedImageDataUrl
  })

  // 2.1 获取当前屏幕与系统窗口边界（用于窗口自动吸附/捕捉）
  ipcMain.handle('screenshot:getSystemRects', () => {
    return capturedSystemRects
  })

  // 3. 截图窗口首帧渲染就绪，无动画直接呈现并聚焦（showInactive 避免 DWM 开窗动画）
  ipcMain.on('screenshot:ready', () => {
    if (screenshotWindow && !screenshotWindow.isDestroyed()) {
      screenshotWindow.showInactive()
      screenshotWindow.focus()
    }
  })

  // 4. 退出 / 取消截图
  ipcMain.on('screenshot:close', () => {
    closeScreenshotWindow()
  })

  // 5. 确定：写入系统原生剪贴板并关闭截图窗口
  ipcMain.handle('screenshot:confirm', (_e, dataUrl: string) => {
    try {
      const img = nativeImage.createFromDataURL(dataUrl)
      const clip = clipboard as unknown as { writeImage?: (img: unknown) => void }
      if (typeof clip.writeImage === 'function') {
        clip.writeImage(img)
      }
      closeScreenshotWindow()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : t('写入剪贴板失败') }
    }
  })

  // 6. 指定（置顶贴图）：在主进程直接创建独立的系统置顶原生窗口，不作为主窗口的一部分
  ipcMain.on('screenshot:pin', async (_e, pinnedItem: unknown) => {
    try {
      const item = pinnedItem as PinnedItemPayload
      if (item && item.dataUrl) {
        await openPinWindow(item)
      }
    } catch (err) {
      console.error('[Screenshot] pin window open error:', err)
    }
    closeScreenshotWindow()
  })

  // 7. 下载 / 保存截图文件
  ipcMain.handle('screenshot:save', async (_e, payload: { suggestedName?: string; dataUrl: string }) => {
    try {
      const win = hostWindow()
      const defPath = payload.suggestedName || `Screenshot_${Date.now()}.png`
      const res = await dialog.showSaveDialog(screenshotWindow || (win as BrowserWindow), {
        title: t('保存截图'),
        defaultPath: defPath,
        filters: [{ name: 'PNG Image', extensions: ['png'] }],
      })
      if (res.canceled || !res.filePath) return { ok: true, canceled: true }
      const base64Data = payload.dataUrl.replace(/^data:image\/\w+;base64,/, '')
      await fsp.writeFile(res.filePath, Buffer.from(base64Data, 'base64'))
      closeScreenshotWindow()
      return { ok: true, path: res.filePath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : t('保存截图失败') }
    }
  })
}
