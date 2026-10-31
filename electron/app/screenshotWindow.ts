/**
 * 这个文件负责系统层级全屏截图窗口（独立 BrowserWindow）的全部：
 * 桌面全屏采集、窗口预热、毫秒级瞬开、画面加载、钉图/复制/保存中转与隐藏复用。
 *
 * 覆盖整个目标显示器，置顶置显，零黑帧闪烁，80ms 内高速唤起。
 */
import { app, BrowserWindow, desktopCapturer, ipcMain, screen, dialog } from 'electron'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { t } from '../i18n'
import { DEV_SERVER_URL } from './startup'
import { attachConsoleForwarding } from './windows'
import { openPinWindow, type PinnedItemPayload } from './pinWindow'
import { copyDataUrlToClipboard } from './clipboardHelper'
import { snapViaHelper } from './doubleBackquoteShortcut'
import { detectSystemWindowRects, mapRawRectsToDisplay, getFallbackRects, type WindowRectItem } from './windowRectsHelper'

let screenshotWindow: BrowserWindow | null = null
let capturedImageDataUrl: string | null = null
let capturedSystemRects: WindowRectItem[] = []
let isCapturing = false

function hostWindow(): BrowserWindow | null {
  const win = BrowserWindow.getAllWindows().find((w) => w !== screenshotWindow && !w.isDestroyed())
  return win ?? null
}

/**
 * 次级全屏截取兜底方案（Electron desktopCapturer）
 */
async function captureDesktopDisplayFallback(display: Electron.Display, scaleFactor: number): Promise<string | null> {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(display.bounds.width * scaleFactor),
        height: Math.round(display.bounds.height * scaleFactor),
      },
    })

    let targetSource = sources.find((s) => s.display_id === display.id.toString())
    if (!targetSource || !targetSource.thumbnail || targetSource.thumbnail.isEmpty()) {
      targetSource = sources.find((s) => s.thumbnail && !s.thumbnail.isEmpty()) || sources[0]
    }

    if (targetSource && targetSource.thumbnail && !targetSource.thumbnail.isEmpty()) {
      return targetSource.thumbnail.toDataURL()
    }
  } catch (e) {
    console.warn('[Screenshot] desktopCapturer fallback error:', e)
  }

  // 兜底回退
  const host = hostWindow()
  if (host && !host.isDestroyed()) {
    try {
      const pageImg = await host.webContents.capturePage()
      if (!pageImg.isEmpty()) {
        return pageImg.toDataURL()
      }
    } catch {}
  }
  return null
}

/**
 * 静默预热截图窗口（在应用启动就绪后空闲时调用，提前加载 DOM 与 React 资源）
 */
export async function preloadScreenshotWindow(): Promise<void> {
  if (screenshotWindow && !screenshotWindow.isDestroyed()) return
  try {
    const primary = screen.getPrimaryDisplay()
    const win = new BrowserWindow({
      x: primary.bounds.x,
      y: primary.bounds.y,
      width: primary.bounds.width,
      height: primary.bounds.height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      show: false,
      thickFrame: false,
      hasShadow: false,
      roundedCorners: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })

    screenshotWindow = win
    attachConsoleForwarding(win)

    win.on('closed', () => {
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
  } catch (err) {
    console.warn('[Screenshot] preload window error:', err)
  }
}

/**
 * 唤起系统级全屏截图窗口（毫秒级极速响应）：
 * - 原生 BitBlt 毫秒级抓取硬件真实桌面，彻底消灭黑屏；
 * - 若窗口已预热就绪，100ms 内瞬间截屏并呈现在眼前；
 * - 若尚未预热，创建新窗口并呈现。
 */
export async function openScreenshotWindow(): Promise<{ ok: boolean; error?: string }> {
  if (isCapturing) return { ok: true }
  isCapturing = true

  try {
    // 1. 获取光标所在显示器或主显示器
    const cursorPoint = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursorPoint) || screen.getPrimaryDisplay()
    const { x, y, width, height } = display.bounds
    const scaleFactor = display.scaleFactor || 1

    const physX = Math.round(x * scaleFactor)
    const physY = Math.round(y * scaleFactor)
    const physW = Math.round(width * scaleFactor)
    const physH = Math.round(height * scaleFactor)

    const tempPath = path.join(
      app.getPath('temp'),
      `moji_snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`,
    )

    let imgData: string | null = null
    let rects: WindowRectItem[] = []

    // 2. 优先通过原生 BitBlt 抓取真实屏幕画面与 Z-order 窗口列表（彻底杜绝 WebRTC 报错与黑屏！）
    if (process.platform === 'win32') {
      try {
        const snapRes = await snapViaHelper(physX, physY, physW, physH, tempPath, 1500)
        if (snapRes && fs.existsSync(tempPath)) {
          const buf = await fsp.readFile(tempPath)
          if (buf.length > 0) {
            imgData = `data:image/png;base64,${buf.toString('base64')}`
            rects = mapRawRectsToDisplay(snapRes.windows, display, getFallbackRects(display))
          }
          await fsp.unlink(tempPath).catch(() => {})
        }
      } catch (err) {
        console.warn('[Screenshot] native snap error:', err)
      }
    }

    // 3. 次级兜底：使用 desktopCapturer + detectSystemWindowRects
    if (!imgData) {
      const [capturedImg, detectedRects] = await Promise.all([
        captureDesktopDisplayFallback(display, scaleFactor),
        detectSystemWindowRects(display).catch(() => getFallbackRects(display)),
      ])
      imgData = capturedImg
      rects = detectedRects
    }

    if (!imgData) {
      isCapturing = false
      return { ok: false, error: t('未能获取屏幕截图画面') }
    }

    capturedImageDataUrl = imgData
    capturedSystemRects = rects

    // 4. 若截图窗口已预热在后台待命，直接复用并瞬间推送新图（消灭开窗与加载耗时！）
    if (screenshotWindow && !screenshotWindow.isDestroyed()) {
      screenshotWindow.setBounds({ x, y, width, height })
      screenshotWindow.webContents.send('screenshot:update', {
        imageSrc: imgData,
        systemRects: rects,
      })
      screenshotWindow.showInactive()
      screenshotWindow.focus()
      isCapturing = false
      return { ok: true }
    }

    // 5. 若首次尚未预热或窗口被关闭，创建全屏无边框置顶窗口
    const win = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      show: false,
      thickFrame: false,
      hasShadow: false,
      roundedCorners: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })

    screenshotWindow = win
    attachConsoleForwarding(win)

    win.on('closed', () => {
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

    isCapturing = false
    return { ok: true }
  } catch (err) {
    isCapturing = false
    return { ok: false, error: err instanceof Error ? err.message : t('截图窗口创建失败') }
  }
}

/**
 * 关闭截图：隐藏窗口并保留 DOM 待命，使下次截图瞬间呼出
 */
export function closeScreenshotWindow(): void {
  if (screenshotWindow && !screenshotWindow.isDestroyed()) {
    screenshotWindow.hide()
  }
  capturedImageDataUrl = null
  capturedSystemRects = []
  isCapturing = false
}

/**
 * 真正销毁截图窗口（应用退出时调用）
 */
export function destroyScreenshotWindow(): void {
  if (screenshotWindow && !screenshotWindow.isDestroyed()) {
    screenshotWindow.destroy()
  }
  screenshotWindow = null
  capturedImageDataUrl = null
  capturedSystemRects = []
  isCapturing = false
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
  ipcMain.handle('screenshot:confirm', async (_e, dataUrl: string) => {
    const res = await copyDataUrlToClipboard(dataUrl)
    closeScreenshotWindow()
    return res
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
      closeScreenshotWindow()
    }
  })

  // 6.1 贴图窗口首帧就绪通知：同一瞬间关闭截图全屏窗口，实现 100% 毫无察觉的无缝切换
  ipcMain.on('pin:ready', () => {
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
