/**
 * 这个文件负责主窗口尺寸与位置的记忆：状态文件的路径与形状、读回来、以及把变化写回去。
 * 写盘的节流与「关闭时同步落盘」的取舍见下面各自函数的说明。
 */
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json')

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

const DEFAULT_STATE: WindowState = { width: 1280, height: 860, isMaximized: false }

export async function loadWindowState(): Promise<WindowState> {
  try {
    const raw = JSON.parse(await fsp.readFile(STATE_FILE(), 'utf-8')) as Partial<WindowState>
    const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
    return {
      width: num(raw.width, DEFAULT_STATE.width),
      height: num(raw.height, DEFAULT_STATE.height),
      x: typeof raw.x === 'number' ? raw.x : undefined,
      y: typeof raw.y === 'number' ? raw.y : undefined,
      isMaximized: Boolean(raw.isMaximized),
    }
  } catch {
    // 文件不存在或损坏：用默认值，不算错误
    return { ...DEFAULT_STATE }
  }
}

/** 记住窗口尺寸与位置（节流写盘，避免拖动时频繁 IO） */
export function attachWindowStatePersistence(win: BrowserWindow): void {
  let normalBounds = win.getBounds()
  let timer: ReturnType<typeof setTimeout> | null = null

  const snapshot = (): WindowState => {
    const isMaximized = win.isMaximized()
    // 最大化时 getBounds 给的是屏幕尺寸，要保留最大化前的普通尺寸
    if (!isMaximized) normalBounds = win.getBounds()
    return { ...normalBounds, isMaximized }
  }

  const save = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void fsp.writeFile(STATE_FILE(), JSON.stringify(snapshot(), null, 2), 'utf-8').catch(() => {})
    }, 400)
  }

  win.on('resize', save)
  win.on('move', save)
  win.on('maximize', save)
  win.on('unmaximize', save)
  // 关闭时同步落盘，避免节流窗口内的最后一次改动丢失
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    try {
      fs.writeFileSync(STATE_FILE(), JSON.stringify(snapshot(), null, 2), 'utf-8')
    } catch {
      // 写不进去就放弃记忆，不影响退出
    }
  })
}
