import { spawn, execFile, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

let hookProcess: ChildProcess | null = null
let triggerCallback: (() => void) | null = null
let isStarting = false
let windowQueryResolvers: Array<(rects: Array<{ x: number; y: number; width: number; height: number; title?: string }>) => void> = []
let snapResolvers: Array<(res: { imagePath: string; windows: Array<{ x: number; y: number; width: number; height: number; title?: string }> } | null) => void> = []
let activeSnapPath: string | null = null

const CSC_PATH = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe'

function getHelperExePath(): string {
  const candidates = [
    path.join(__dirname, 'screenHelper.exe'),
    path.join(__dirname, 'app', 'screenHelper.exe'),
    path.join(__dirname, '..', 'electron', 'app', 'screenHelper.exe'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

function getHelperCsPath(): string {
  const candidates = [
    path.join(__dirname, 'screenHelper.cs'),
    path.join(__dirname, 'app', 'screenHelper.cs'),
    path.join(__dirname, '..', 'electron', 'app', 'screenHelper.cs'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

/**
 * 确保 screenHelper.exe 原生助手存在；若不存在则自动调用系统内置 csc 瞬时编译
 */
function ensureHelperExe(): Promise<boolean> {
  const exePath = getHelperExePath()
  if (fs.existsSync(exePath)) {
    return Promise.resolve(true)
  }
  const csPath = getHelperCsPath()
  if (!fs.existsSync(csPath) || !fs.existsSync(CSC_PATH)) {
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    execFile(
      CSC_PATH,
      ['/nologo', '/optimize+', '/target:winexe', '/r:System.Drawing.dll', `/out:${exePath}`, csPath],
      (err) => {
        resolve(!err && fs.existsSync(exePath))
      },
    )
  })
}

/**
 * 启动全局双击反引号 (\`) 系统级快捷键监听与高速窗口探测助手：
 * - 纯底层低级键盘钩子，无条件调用 CallNextHookEx，绝不拦截/吃掉按键；
 * - 最小化、失焦、全屏游戏或任何应用中均能瞬间感应；
 * - 原生 BitBlt 毫秒级全屏高清硬件截屏，彻底杜绝 WebRTC 黑屏；
 * - 内置高性能 DWM 真实视口枚举，天然保持原生 Z-order。
 */
export async function startDoubleBackquoteShortcut(onTrigger: () => void): Promise<void> {
  triggerCallback = onTrigger
  if (process.platform !== 'win32' || hookProcess || isStarting) {
    return
  }

  isStarting = true
  const ok = await ensureHelperExe()
  if (!ok) {
    isStarting = false
    return
  }

  try {
    const exePath = getHelperExePath()
    const proc = spawn(exePath, [], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    })

    hookProcess = proc

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      const lines = text.split(/\r?\n/)

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue

        // 1. 全局双击反引号快捷键触发
        if (line === 'TRIGGER') {
          try {
            triggerCallback?.()
          } catch (err) {
            console.error('[DoubleBackquoteShortcut] trigger callback error:', err)
          }
        } else if (line.startsWith('WINJSON:')) {
          // 2. 高速独立窗口查询结果返回
          const jsonStr = line.slice(8)
          try {
            const list = JSON.parse(jsonStr)
            const resolvers = [...windowQueryResolvers]
            windowQueryResolvers = []
            for (const r of resolvers) {
              r(Array.isArray(list) ? list : [])
            }
          } catch {
            const resolvers = [...windowQueryResolvers]
            windowQueryResolvers = []
            for (const r of resolvers) r([])
          }
        } else if (line.startsWith('SNAP_OK:')) {
          // 3. 原生 BitBlt 截屏与瞬时窗口列表同步完成
          const jsonStr = line.slice(8)
          let windows: Array<{ x: number; y: number; width: number; height: number; title?: string }> = []
          try {
            const list = JSON.parse(jsonStr)
            windows = Array.isArray(list) ? list : []
          } catch {}
          const imgPath = activeSnapPath || ''
          const resolvers = [...snapResolvers]
          snapResolvers = []
          for (const r of resolvers) {
            r({ imagePath: imgPath, windows })
          }
        } else if (line.startsWith('SNAP_ERR:')) {
          const resolvers = [...snapResolvers]
          snapResolvers = []
          for (const r of resolvers) r(null)
        }
      }
    })

    proc.on('exit', () => {
      hookProcess = null
      isStarting = false
      const resolvers = [...windowQueryResolvers]
      windowQueryResolvers = []
      for (const r of resolvers) r([])
      const sResolvers = [...snapResolvers]
      snapResolvers = []
      for (const r of sResolvers) r(null)
    })

    proc.on('error', (err) => {
      console.warn('[DoubleBackquoteShortcut] helper error:', err)
      hookProcess = null
      isStarting = false
    })
  } catch (e) {
    console.warn('[DoubleBackquoteShortcut] spawn helper failed:', e)
    isStarting = false
  }
}

/**
 * 原生全屏截屏与 Z-order 窗口列表同步获取（由常驻 screenHelper 执行 BitBlt + DWM 枚举）
 */
export function snapViaHelper(
  physX: number,
  physY: number,
  physW: number,
  physH: number,
  filePath: string,
  timeoutMs = 1200,
): Promise<{ imagePath: string; windows: Array<{ x: number; y: number; width: number; height: number; title?: string }> } | null> {
  if (!hookProcess || hookProcess.killed || !hookProcess.stdin) {
    return Promise.resolve(null)
  }

  activeSnapPath = filePath

  return new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        resolve(null)
      }
    }, timeoutMs)

    snapResolvers.push((res) => {
      if (!done) {
        done = true
        clearTimeout(timer)
        resolve(res)
      }
    })

    try {
      hookProcess?.stdin?.write(`SNAP ${physX} ${physY} ${physW} ${physH} ${filePath}\n`)
    } catch {
      if (!done) {
        done = true
        clearTimeout(timer)
        resolve(null)
      }
    }
  })
}

/**
 * 0.5 毫秒级原生窗口列表实时查询（通过已常驻的 screenHelper 进程）
 */
export function queryWindowsViaHelper(
  timeoutMs = 150,
): Promise<Array<{ x: number; y: number; width: number; height: number; title?: string }>> {
  if (!hookProcess || hookProcess.killed || !hookProcess.stdin) {
    return Promise.resolve([])
  }

  return new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        resolve([])
      }
    }, timeoutMs)

    windowQueryResolvers.push((rects) => {
      if (!done) {
        done = true
        clearTimeout(timer)
        resolve(rects)
      }
    })

    try {
      hookProcess?.stdin?.write('WINDOWS\n')
    } catch {
      if (!done) {
        done = true
        clearTimeout(timer)
        resolve([])
      }
    }
  })
}

/**
 * 停止并释放全局快捷键与原生助手
 */
export function stopDoubleBackquoteShortcut(): void {
  triggerCallback = null
  if (hookProcess) {
    try {
      hookProcess.stdin?.write('EXIT\n')
    } catch {}
    try {
      hookProcess.kill()
    } catch {}
    hookProcess = null
  }
  isStarting = false
  windowQueryResolvers = []
  snapResolvers = []
}
