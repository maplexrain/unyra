/**
 * 这个文件负责什么：沙箱类型契约的**memory（记忆）**组的宿主实现 MemoryOps
 * （工作 / 长期记忆，见 learn/memory）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

/* ---------- memory：记忆（工作 / 长期） ---------- */

/**
 * memory.*：记忆（见 learn/memory）。
 *
 * 两类：**工作**（目标级，只有本目标的会话读得到，agent 觉得是负担就能删）与
 * **长期**（跨目标，删除必须 `{ confirm: true }`）。返回普通对象，失败用 { error }
 * （与 res.* 同一约定）。
 */
export interface MemoryOps {
  /** 清单：type 可选过滤；工作记忆只回当前目标那一份 */
  list: (query?: Record<string, unknown>) => unknown
  /** 读一条全文（uuid）；看不见的条目按「没有」处理 */
  get: (uuid: string) => unknown
  /** 新建：{ type, title, keys?, content }（type 省略按 work） */
  create: (payload: Record<string, unknown>) => unknown
  /** 更新：只改给了的字段（title / keys / content / type） */
  update: (uuid: string, patch: Record<string, unknown>) => unknown
  /** 删除：长期记忆需要 { confirm: true } */
  remove: (uuid: string, opts?: Record<string, unknown>) => unknown
}

