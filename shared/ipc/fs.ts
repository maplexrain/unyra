/**
 * 这个文件负责什么：IPC 契约的**基础文件系统与 project:fs**通道组——base.files.* 的
 * 目录项/stat/读/写/编辑/清单结果，以及项目节点路径的文件操作（project:fs，见
 * learn/projects 与 electron/base/projectFiles）。
 * 原先与其它组同写在 shared/ipc.ts，按通道组拆到这里；形状逐字未动，
 * 对外一律经门面 shared/ipc.ts 原样转出，调用方 import 路径不变。
 */

/* ---------- 基础文件系统与进程管理 (base.files.* / base.process.*) ---------- */

export interface BaseFileEntry {
  name: string
  isDirectory: boolean
  isFile: boolean
  size: number
  mtimeMs: number
}

export interface BaseFileStat {
  exists: boolean
  isDirectory: boolean
  isFile: boolean
  size: number
  mtimeMs: number
  ctimeMs: number
}

export type BaseFileReadResult =
  | { ok: true; content: string; encoding: string; size: number; sizeBytes?: number; chars?: number; totalChars?: number }
  | { ok: false; error: string }

export type BaseFileWriteResult =
  | { ok: true; path: string; bytesWritten?: number }
  | { ok: false; error: string }

export interface BaseFileEditOpts {
  replace?: {
    target?: string
    replacement?: string
    old?: string
    new?: string
    find?: string
    search?: string
    replace?: string
    all?: boolean
  }
  edits?: Array<{
    target?: string
    replacement?: string
    old?: string
    new?: string
    find?: string
    search?: string
    replace?: string
    append?: string
    prepend?: string
    insert?: string
    after?: string
    before?: string
    all?: boolean
    [k: string]: unknown
  }>
  content?: string
  append?: string
  prepend?: string
  start?: number
  end?: number
}

export type BaseFileEditResult =
  | { ok: true; path: string; modified: boolean }
  | { ok: false; error: string }

export type BaseFileListResult =
  | { ok: true; path: string; entries: BaseFileEntry[] }
  | { ok: false; error: string }

export type BaseFileStatResult =
  | { ok: true; exists?: boolean; stat: BaseFileStat }
  | { ok: false; error: string }

export type BaseFileOpResult =
  | { ok: true }
  | { ok: false; error: string }

/* ---------- 项目节点路径的文件操作（project:fs，见 learn/projects 与 electron/base/projectFiles） ----------
 *
 * 谁在用：主进程 electron/base/projectFiles.ts（project:fs handler），渲染层 src/lib/projectFs
 * （画布的目录树展开 + agent 的 api.project.*）。
 *
 * 授权模型：**声明即授权**——渲染层每次调用随行一份 roots（此刻已声明并解析成功的
 * project 根），主进程把请求路径 resolve 后校验「落在某个根之内」才执行。两道校验
 * （渲染层收口 + 主进程白名单）之间不共享状态，roots 每次现取，节点删了/改路径立刻生效。
 */

export type ProjectFsOp =
  | { op: 'list'; path: string }
  | { op: 'stat'; path: string }
  | { op: 'read'; path: string; encoding?: 'utf8' | 'base64'; maxBytes?: number; offset?: number }
  | { op: 'write'; path: string; content: string; encoding?: 'utf8' | 'base64'; overwrite?: boolean }
  | { op: 'edit'; path: string; edit: { content?: string; replace?: { target: string; replacement: string; all?: boolean }; append?: string } }
  | { op: 'mkdir'; path: string }
  | { op: 'move'; path: string; to: string }
  | { op: 'copy'; path: string; to: string; overwrite?: boolean }
  | { op: 'delete'; path: string }

export type ProjectFsRequest = ProjectFsOp & {
  /** 本次调用允许的授权根（绝对路径；渲染层从 store 现取） */
  roots: string[]
}

export type ProjectFsResult =
  | { ok: true; op: 'list'; path: string; entries: BaseFileEntry[] }
  | { ok: true; op: 'stat'; path: string; exists: boolean; stat: BaseFileStat | null }
  | { ok: true; op: 'read'; content: string; encoding: string; size: number; totalChars?: number }
  | { ok: true; op: 'write'; path: string; bytesWritten: number }
  | { ok: true; op: 'edit'; path: string; modified: boolean }
  | { ok: true; op: 'mkdir' | 'move' | 'copy' | 'delete'; path: string }
  | { ok: false; error: string }

