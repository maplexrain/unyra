/**
 * 开发者控制台的日志中枢：主进程 console 捕获、主窗口渲染进程 console 转发、
 * 环形缓冲与实时订阅。
 *
 * 这个文件**不碰窗口生命周期**（开窗在 devConsoleWindow.ts）：主窗口渲染进程的
 * console-message 从 windows.ts 挂上来，主进程的 console 在 main.ts 启动最早期
 * 装一次。这样控制台晚开也能从缓冲里回放之前的日志，开窗期间则实时推送。
 */
import { format } from 'node:util'
import type { BrowserWindow } from 'electron'
import type { DevLogEntry, DevLogLevel, DevLogSource } from '../../shared/ipc'

const MAX_ENTRIES = 2_000
const MAX_TEXT = 16_000

let entries: DevLogEntry[] = []
let nextId = 1
const listeners = new Set<(entry: DevLogEntry) => void>()
let mainCaptureInstalled = false

/** 截断过长日志，避免一条巨大的对象 inspect 把环形缓冲撑爆。 */
function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text
}

/** 把 console 的多参数按 util.format 的规则折成一条（%s、对象、Error 都能读）。 */
export function formatLogText(args: unknown[]): string {
  if (args.length === 0) return ''
  try {
    return clip(format(...args))
  } catch {
    return clip(args.map((arg) => (arg instanceof Error ? arg.stack ?? arg.message : String(arg))).join(' '))
  }
}

/**
 * 写入一条日志。导出给日志捕获与测试用；空消息不占缓冲。
 * 订阅者异常不能反过来把主进程日志链路打挂——这里静默丢掉那一份。
 */
export function recordDevLog(
  source: DevLogSource,
  level: DevLogLevel,
  text: string,
  origin?: string,
): DevLogEntry | null {
  const body = clip(text)
  if (!body.trim()) return null
  const entry: DevLogEntry = {
    id: nextId++,
    ts: Date.now(),
    source,
    level,
    text: body,
    ...(origin ? { origin } : {}),
  }
  entries.push(entry)
  if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES)
  for (const listener of [...listeners]) {
    try {
      listener(entry)
    } catch {
      // 订阅方（窗口已销毁 / 页面重载）自己收不到就算了，不能让日志链路断
    }
  }
  return entry
}

/** 当前缓冲的快照。控制台窗口打开时先回放这一份，再靠订阅接后续。 */
export function devLogSnapshot(): DevLogEntry[] {
  return entries.map((entry) => ({ ...entry }))
}

/** 订阅新日志。返回取消函数，窗口关闭时必须调用。 */
export function subscribeDevLogs(listener: (entry: DevLogEntry) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 主进程 console → 日志缓冲。
 *
 * 不替换 stdout/stderr：主进程里几乎所有模块都走 console，替换这几个方法足够，
 * 也不会影响 Electron 自己的终端输出。重复调用是幂等的。
 *
 * `[renderer] ...` 是 windows.ts 的 attachConsoleForwarding 把**渲染进程**日志
 * 回声到主进程终端的那一份；真正的渲染层日志已经由 attachRendererLogForwarding
 * 直接收下，这里跳过它，否则每条会在控制台里出现两遍。
 */
export function installMainLogCapture(): void {
  if (mainCaptureInstalled) return
  mainCaptureInstalled = true

  const methods: Array<{ name: 'log' | 'info' | 'debug' | 'warn' | 'error'; level: DevLogLevel }> = [
    { name: 'log', level: 'log' },
    { name: 'info', level: 'info' },
    { name: 'debug', level: 'debug' },
    { name: 'warn', level: 'warn' },
    { name: 'error', level: 'error' },
  ]

  for (const { name, level } of methods) {
    const original = console[name].bind(console)
    console[name] = (...args: unknown[]) => {
      const text = formatLogText(args)
      if (text && !text.startsWith('[renderer] ')) recordDevLog('main', level, text)
      original(...args)
    }
  }
}

/** 渲染进程 console-message 的新签名：单个 details 事件对象。 */
type RendererConsoleDetails = {
  message?: string
  level?: 'debug' | 'info' | 'warning' | 'error'
  lineNumber?: number
  sourceId?: string
}

function levelOf(level: RendererConsoleDetails['level']): DevLogLevel {
  if (level === 'error') return 'error'
  if (level === 'warning') return 'warn'
  if (level === 'info') return 'info'
  return 'debug'
}

/** 只给源文件名和行号，不带整条本地绝对路径——开发者控制台一行放得下。 */
function originOf(sourceId: string | undefined, line: number | undefined): string | undefined {
  if (!sourceId) return undefined
  const clean = sourceId.split(/[?#]/)[0]
  const name = clean.split(/[\\/]/).pop()
  return name ? `${name}:${line ?? 0}` : undefined
}

/**
 * 主窗口渲染进程 console → 日志缓冲。只给主窗口挂（卫星窗口不在这里出现），
 * 必须在页面 load 之前调用，才能把启动早期的报错也收进来。
 */
export function attachRendererLogForwarding(win: BrowserWindow): void {
  win.webContents.on('console-message', (details) => {
    const text = details.message ?? ''
    if (!text) return
    recordDevLog('renderer', levelOf(details.level), text, originOf(details.sourceId, details.lineNumber))
  })
}
