/**
 * 独立的系统级置顶贴图窗口（Pin Window）管理器：
 * 支持固定多个截图，每个固定截图均为完全独立的无边框置顶原生窗口。
 * 不附属于主窗口，独立拖拽、缩放、复制、保存和关闭。
 */
import { BrowserWindow, ipcMain, clipboard, nativeImage, dialog } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { t } from '../i18n'
import { DEV_SERVER_URL } from './startup'
import { attachConsoleForwarding } from './windows'

export interface PinnedItemPayload {
  id: string
  dataUrl: string
  width: number
  height: number
  x: number
  y: number
}

interface PinnedWindowRecord {
  id: string
  win: BrowserWindow
  data: PinnedItemPayload
}

const pinnedWindows = new Map<string, PinnedWindowRecord>()

export async function openPinWindow(item: PinnedItemPayload): Promise<{ ok: boolean; id: string }> {
  try {
    const win = new BrowserWindow({
      x: Math.round(item.x),
      y: Math.round(item.y),
      width: Math.max(80, Math.round(item.width)),
      height: Math.max(60, Math.round(item.height)),
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: false,
      resizable: true,
      hasShadow: true,
      show: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })

    attachConsoleForwarding(win)

    pinnedWindows.set(item.id, { id: item.id, win, data: item })

    win.on('closed', () => {
      pinnedWindows.delete(item.id)
    })

    if (DEV_SERVER_URL) {
      await win.loadURL(`${DEV_SERVER_URL}?pinWindow=${encodeURIComponent(item.id)}`)
    } else {
      await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
        query: { pinWindow: item.id },
      })
    }

    return { ok: true, id: item.id }
  } catch (err) {
    console.error('[PinWindow] open error:', err)
    return { ok: false, id: item.id }
  }
}

export function closePinWindow(id: string): void {
  const record = pinnedWindows.get(id)
  if (record && !record.win.isDestroyed()) {
    record.win.close()
  }
  pinnedWindows.delete(id)
}

export function closeAllPinWindows(): void {
  for (const record of pinnedWindows.values()) {
    if (!record.win.isDestroyed()) {
      record.win.close()
    }
  }
  pinnedWindows.clear()
}

export function registerPinIpc(): void {
  // 获取指定贴图窗口的数据
  ipcMain.handle('pin:getData', (_e, id: string) => {
    const record = pinnedWindows.get(id)
    return record?.data ?? null
  })

  // 关闭贴图窗口
  ipcMain.on('pin:close', (_e, id: string) => {
    closePinWindow(id)
  })

  // 复制贴图图像到剪贴板
  ipcMain.handle('pin:copy', (_e, id: string) => {
    const record = pinnedWindows.get(id)
    if (!record) return { ok: false, error: t('贴图不存在') }
    try {
      const img = nativeImage.createFromDataURL(record.data.dataUrl)
      const clip = clipboard as unknown as { writeImage?: (img: unknown) => void }
      if (typeof clip.writeImage === 'function') {
        clip.writeImage(img)
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : t('复制失败') }
    }
  })

  // 保存贴图到文件
  ipcMain.handle('pin:save', async (_e, id: string) => {
    const record = pinnedWindows.get(id)
    if (!record) return { ok: false, error: t('贴图不存在') }
    try {
      const suggestedName = `Pin_${Date.now()}.png`
      const res = await dialog.showSaveDialog(record.win, {
        title: t('保存贴图'),
        defaultPath: suggestedName,
        filters: [{ name: 'PNG Image', extensions: ['png'] }],
      })
      if (res.canceled || !res.filePath) return { ok: true, canceled: true }
      const base64Data = record.data.dataUrl.replace(/^data:image\/\w+;base64,/, '')
      await fsp.writeFile(res.filePath, Buffer.from(base64Data, 'base64'))
      return { ok: true, path: res.filePath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : t('保存失败') }
    }
  })

  // 鼠标滚轮缩放贴图窗口
  ipcMain.on('pin:zoom', (_e, payload: { id: string; zoomFactor: number }) => {
    const record = pinnedWindows.get(payload.id)
    if (!record || record.win.isDestroyed()) return
    const bounds = record.win.getBounds()
    const factor = Math.max(0.5, Math.min(3.0, payload.zoomFactor))
    const origWidth = record.data.width
    const origHeight = record.data.height
    const newWidth = Math.round(origWidth * factor)
    const newHeight = Math.round(origHeight * factor)
    record.win.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: Math.max(80, newWidth),
      height: Math.max(60, newHeight),
    })
  })
}
