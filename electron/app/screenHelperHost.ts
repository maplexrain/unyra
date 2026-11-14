import { spawn, execFile, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'

let hookProcess: ChildProcess | null = null
let triggerCallback: (() => void) | null = null
let isStarting = false
let windowQueryResolvers: Array<(rects: Array<{ x: number; y: number; width: number; height: number; title?: string }>) => void> = []
let snapResolvers: Array<(res: { imagePath: string; windows: Array<{ x: number; y: number; width: number; height: number; title?: string }> } | null) => void> = []
/** IME_GET 的应答队列（前台窗口当前键盘布局 HKL；读不到 = null） */
let imeGetResolvers: Array<(hkl: number | null) => void> = []
/** IME_SET 的应答队列（投递成功与否；超时/出错 = false） */
let imeSetResolvers: Array<(ok: boolean) => void> = []
let activeSnapPath: string | null = null

const CSC_PATH = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe'

function getHelperExePath(): string {
  const unpackedDir = __dirname.replace('app.asar', 'app.asar.unpacked')
  const candidates = [
    path.join(unpackedDir, 'screenHelper.exe'),
    path.join(unpackedDir, 'app', 'screenHelper.exe'),
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
 * 确保 screenHelper.exe 原生助手存在；不存在或源码比产物新时，
 * 自动调用系统内置 csc 瞬时编译（.cs 改过而 exe 还是旧的，就必须重编，否则会一直跑过期逻辑）
 */
function ensureHelperExe(): Promise<boolean> {
  const exePath = getHelperExePath()
  // 打包模式下安装目录通常只读且不可直接写入，若预置已解压的 exe 存在则直接使用，不走运行时 csc
  if (app.isPackaged && fs.existsSync(exePath)) {
    return Promise.resolve(true)
  }
  const csPath = getHelperCsPath()
  if (!fs.existsSync(csPath) || !fs.existsSync(CSC_PATH)) {
    return Promise.resolve(fs.existsSync(exePath))
  }
  if (fs.existsSync(exePath) && fs.statSync(exePath).mtimeMs >= fs.statSync(csPath).mtimeMs) {
    return Promise.resolve(true)
  }

  return new Promise((resolve) => {
    execFile(
      CSC_PATH,
      ['/nologo', '/optimize+', '/target:winexe', '/r:System.Drawing.dll', `/out:${exePath}`, csPath],
      () => {
        // 编译失败但旧 exe 还在时退回旧版：助手熄火比版本旧半拍更伤
        resolve(fs.existsSync(exePath))
      },
    )
  })
}

/**
 * 启动全局截图快捷键（F1）监听与高速窗口探测助手：
 * - 纯底层低级键盘钩子，无条件调用 CallNextHookEx，绝不拦截/吃掉按键；
 * - 最小化、失焦、全屏游戏或任何应用中均能瞬间感应；
 * - 原生 BitBlt 毫秒级全屏高清硬件截屏，彻底杜绝 WebRTC 黑屏；
 * - 内置高性能 DWM 真实视口枚举，天然保持原生 Z-order。
 */
export async function startGlobalScreenshotShortcut(onTrigger: () => void): Promise<void> {
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

        // 1. 全局截图快捷键（F1）触发
        if (line === 'TRIGGER') {
          try {
            triggerCallback?.()
          } catch (err) {
            console.error('[ScreenHelperHost] trigger callback error:', err)
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
        } else if (line.startsWith('IME:')) {
          // 输入法查询应答（前台窗口当前键盘布局 HKL，十进制）
          const v = Number(line.slice(4))
          const resolvers = [...imeGetResolvers]
          imeGetResolvers = []
          for (const r of resolvers) r(Number.isFinite(v) && v > 0 ? v : null)
        } else if (line.startsWith('IME_ERR:')) {
          const getResolvers = [...imeGetResolvers]
          imeGetResolvers = []
          for (const r of getResolvers) r(null)
          const setResolvers = [...imeSetResolvers]
          imeSetResolvers = []
          for (const r of setResolvers) r(false)
        } else if (line === 'IME_OK') {
          const setResolvers = [...imeSetResolvers]
          imeSetResolvers = []
          for (const r of setResolvers) r(true)
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
      const gResolvers = [...imeGetResolvers]
      imeGetResolvers = []
      for (const r of gResolvers) r(null)
      const stResolvers = [...imeSetResolvers]
      imeSetResolvers = []
      for (const r of stResolvers) r(false)
    })

    proc.on('error', (err) => {
      console.warn('[ScreenHelperHost] helper error:', err)
      hookProcess = null
      isStarting = false
    })
  } catch (e) {
    console.warn('[ScreenHelperHost] spawn helper failed:', e)
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
 * 读回前台窗口当前键盘布局（HKL，十进制；读不到/助手不在 = null）。
 * vim 输入法自动切换用它记「进普通模式前用户用的哪套输入法」。
 */
export function queryImeViaHelper(timeoutMs = 300): Promise<number | null> {
  if (!hookProcess || hookProcess.killed || !hookProcess.stdin) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const resolver = (hkl: number | null) => {
      if (done) return
      done = true
      if (timer !== undefined) clearTimeout(timer)
      resolve(hkl)
    }
    timer = setTimeout(() => {
      if (!done) {
        done = true
        imeGetResolvers = imeGetResolvers.filter((r) => r !== resolver)
        resolve(null)
      }
    }, timeoutMs)

    imeGetResolvers.push(resolver)
    try {
      hookProcess?.stdin?.write('IME_GET\n')
    } catch {
      if (!done) {
        done = true
        if (timer !== undefined) clearTimeout(timer)
        resolve(null)
      }
    }
  })
}

/**
 * 给前台窗口换键盘布局（异步投递；true = 助手应答了投递，布局装没装成功另说）。
 */
export function setImeViaHelper(hkl: number, timeoutMs = 300): Promise<boolean> {
  if (!hookProcess || hookProcess.killed || !hookProcess.stdin || !Number.isFinite(hkl) || hkl <= 0) {
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const resolver = (ok: boolean) => {
      if (done) return
      done = true
      if (timer !== undefined) clearTimeout(timer)
      resolve(ok)
    }
    timer = setTimeout(() => {
      if (!done) {
        done = true
        imeSetResolvers = imeSetResolvers.filter((r) => r !== resolver)
        resolve(false)
      }
    }, timeoutMs)

    imeSetResolvers.push(resolver)
    try {
      hookProcess?.stdin?.write(`IME_SET ${Math.round(hkl)}\n`)
    } catch {
      if (!done) {
        done = true
        if (timer !== undefined) clearTimeout(timer)
        resolve(false)
      }
    }
  })
}

/**
 * 停止并释放全局快捷键与原生助手
 */
export function stopGlobalScreenshotShortcut(): void {
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
  imeGetResolvers = []
  imeSetResolvers = []
}
