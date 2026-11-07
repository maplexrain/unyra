/**
 * 这个文件负责什么：沙箱类型契约的**project（项目路径读写）**组——对已声明 project
 * 节点的真实路径做文件操作的宿主实现（见 learn/ops/project）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

/** 一条目录清单项（project.tree 的 entries） */
export interface ProjectTreeEntry {
  name: string
  isDirectory: boolean
  isFile: boolean
  size: number
  mtimeMs: number
}

/**
 * 项目路径读写（project.*，见 learn/ops/project）：对**已声明**的 project 节点
 * 的真实路径及其子树做文件操作。寻址一律 uuid + subPath（subPath 相对该项目的根，
 * '/' 分隔，空串 = 根）；越出已声明根的操作一律拒绝。
 */
export interface ProjectOps {
  list: () => Promise<Array<{ uuid: string; title: string; path: string; pathKind: string; resolved: string | null }>>
  tree: (uuid: string, subPath?: string) =>
    Promise<{ ok: true; path: string; entries: ProjectTreeEntry[] } | { ok: false; error: string }>
  read: (uuid: string, subPath: string, opts?: { encoding?: 'utf8' | 'base64'; maxBytes?: number; offset?: number }) =>
    Promise<{ ok: true; content: string; encoding: string; size: number; totalChars?: number } | { ok: false; error: string }>
  write: (uuid: string, subPath: string, content: string, opts?: { encoding?: 'utf8' | 'base64'; overwrite?: boolean }) =>
    Promise<{ ok: true; path: string; bytesWritten: number } | { ok: false; error: string }>
  edit: (uuid: string, subPath: string, edit: { content?: string; replace?: { target: string; replacement: string; all?: boolean }; append?: string }) =>
    Promise<{ ok: true; path: string; modified: boolean } | { ok: false; error: string }>
  mkdir: (uuid: string, subPath: string) => Promise<{ ok: true } | { ok: false; error: string }>
  move: (uuid: string, subPath: string, toSubPath: string) => Promise<{ ok: true } | { ok: false; error: string }>
  copy: (uuid: string, subPath: string, toSubPath: string, opts?: { overwrite?: boolean }) =>
    Promise<{ ok: true } | { ok: false; error: string }>
  delete: (uuid: string, subPath: string) => Promise<{ ok: true } | { ok: false; error: string }>
}

