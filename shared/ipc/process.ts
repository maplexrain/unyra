/**
 * 这个文件负责什么：IPC 契约的**base.process（进程管理）**通道组——进程创建参数、
 * 信息与创建/启动/状态/输出/停止/删除/清单/详情结果（见 electron/base/process.ts）。
 * 原先与其它组同写在 shared/ipc.ts，按通道组拆到这里；形状逐字未动，
 * 对外一律经门面 shared/ipc.ts 原样转出，调用方 import 路径不变。
 */

export interface BaseProcessCreateOpts {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
}

export interface BaseProcessInfo {
  process_id: string
  command: string
  args: string[]
  cwd: string
  running: boolean
  exited: boolean
  exitCode: number | null
  signal: string | null
  pid?: number
  startTime?: number
  exitTime?: number
}

export type BaseProcessCreateResult =
  | { ok: true; process_id: string; command: string; args: string[]; cwd: string }
  | { ok: false; error: string }

export type BaseProcessStartResult =
  | { ok: true; process_id: string; pid: number }
  | { ok: false; error: string }

export type BaseProcessStatusResult =
  | { ok: true; status: BaseProcessInfo }
  | { ok: false; error: string }

export type BaseProcessOutputResult =
  | { ok: true; stdout: string; stderr: string; text: string; offset: number; next_offset: number }
  | { ok: false; error: string }

export type BaseProcessStopResult =
  | { ok: true; process_id: string; stopped: boolean; message?: string }
  | { ok: false; error: string }

export type BaseProcessDeleteResult =
  | { ok: true; process_id: string; deleted: boolean; message?: string }
  | { ok: false; error: string }

export type BaseProcessListResult =
  | { ok: true; processes: BaseProcessInfo[] }
  | { ok: false; error: string }

export type BaseProcessGetResult =
  | { ok: true; process: BaseProcessInfo }
  | { ok: false; error: string }

