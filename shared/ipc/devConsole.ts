/**
 * 开发者控制台的 IPC 契约：主进程与主窗口渲染进程的日志条目、开窗回执。
 *
 * 谁在用：主进程 electron/app/devLogs.ts 负责产出与缓存，electron/app/devConsoleWindow.ts
 * 负责开窗和推送；preload 的 devConsole 组与渲染层 DevConsoleWindow 负责消费。
 */

export type DevLogSource = 'main' | 'renderer'
export type DevLogLevel = 'debug' | 'log' | 'info' | 'warn' | 'error'

/** 一条开发者控制台日志。id 单调递增，渲染层用它做去重与排序。 */
export interface DevLogEntry {
  id: number
  ts: number
  source: DevLogSource
  level: DevLogLevel
  text: string
  /** 渲染进程日志的源位置（文件名:行号）；主进程日志没有 */
  origin?: string
}

/** 打开开发者控制台的回执。reused 为真表示没有新开，只是聚焦已经开着的那个。 */
export interface DevConsoleOpenResult {
  ok: boolean
  reused?: boolean
  error?: string
}
