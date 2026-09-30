/**
 * 临时变量存储：给 Agent 用的键值暂存区。
 *
 * 存在的理由：Agent 有时要摆弄体积很大的中间数据（整篇笔记、一批题面、长推导结果），
 * 但它自己并不需要读这些内容——真读进来就等于每轮都把它们塞进上下文，既贵又占窗口。
 * 于是约定：写进去、按 key 引用、不读回。
 *
 * 三条特性：
 * 1. 每个值都带过期时间（ttl 毫秒，不传即永不过期）；
 * 2. 过期数据不做定时清理，而是在每次读写时顺手扫掉——模块本来就在动，清扫搭车即可，
 *    不需要定时器，也不会在没人用它的时候白跑；
 * 3. 存储位置与 chat.json 同级（见 learn/files 的 tmp.json），按节点分组。
 */
import type { LearnStore, TmpEntry, TmpStore } from '../learn/types'
import { isRecord } from './guards'

/** 一次 list 最多回多少条：键本身也可能很多，别把上下文顶爆 */
export const TMP_LIST_LIMIT = 100

/** 值的大小上限（字符），超过直接拒绝——防止有人把整个语料塞进来 */
export const TMP_VALUE_MAX_CHARS = 200_000

export interface TmpInfo {
  key: string
  /** 剩余存活毫秒数；永不过期为 null */
  remainingMs: number | null
  /** 值的字符长度（序列化后），便于判断该不该读 */
  chars: number
}

/** 序列化后的字符长度；不可序列化的值（函数、循环引用）返回 -1 */
function sizeOf(value: unknown): number {
  try {
    const json = JSON.stringify(value)
    return json === undefined ? 0 : json.length
  } catch {
    return -1
  }
}

/** 过期即失效：expiresAt 为 0 表示永不过期 */
const expired = (entry: TmpEntry, now: number): boolean => entry.expiresAt > 0 && entry.expiresAt <= now

/**
 * 一个节点的临时变量视图。每次操作都先清过期项，改动通过 onChange 冒泡出去落盘。
 */
export class TmpVars {
  /** 归属节点；仅用于报错与调试，逻辑上不依赖它 */
  readonly nodeId: string
  private entries: Record<string, TmpEntry>
  private readonly now: () => number
  private readonly onChange: ((next: Record<string, TmpEntry>) => void) | undefined

  constructor(opts: {
    nodeId?: string
    entries?: Record<string, TmpEntry>
    now?: () => number
    /** 有实际改动时回调（用于落盘） */
    onChange?: (next: Record<string, TmpEntry>) => void
  }) {
    this.nodeId = opts.nodeId ?? ''
    this.entries = opts.entries ?? {}
    this.now = opts.now ?? (() => Date.now())
    this.onChange = opts.onChange
  }

  /**
   * 扫掉过期项。返回是否有改动——每个公开方法都先调它，
   * 这就是「数据过期后，在模块活动时清理」的落点。
   */
  prune(): boolean {
    const now = this.now()
    let dirty = false
    for (const [key, entry] of Object.entries(this.entries)) {
      if (expired(entry, now)) {
        delete this.entries[key]
        dirty = true
      }
    }
    if (dirty) this.onChange?.(this.entries)
    return dirty
  }

  keys(): string[] {
    this.prune()
    return Object.keys(this.entries)
  }

  /** 取一条；不存在或已过期都返回 undefined */
  get(key: string): unknown {
    this.prune()
    const entry = this.entries[key]
    if (!entry) return undefined
    return entry.value
  }

  has(key: string): boolean {
    this.prune()
    return key in this.entries
  }

  /** 写一条。value 会深拷贝一份再存，调用方后续改动不影响已存的副本 */
  set(key: string, value: unknown, ttlMs?: number): void {
    this.prune()
    if (!key.trim()) throw new Error('key 不能为空')
    const chars = sizeOf(value)
    if (chars < 0) throw new Error('value 必须是可 JSON 序列化的数据')
    if (chars > TMP_VALUE_MAX_CHARS) {
      throw new Error(`value 太大（${chars} 字符，上限 ${TMP_VALUE_MAX_CHARS}）`)
    }
    const ttl = typeof ttlMs === 'number' && Number.isFinite(ttlMs) ? Math.floor(ttlMs) : 0
    if (ttl < 0) throw new Error('ttlMs 不能为负数')
    const now = this.now()
    this.entries[key] = {
      value: structuredClone(value),
      expiresAt: ttl > 0 ? now + ttl : 0,
      createdAt: now,
    }
    this.onChange?.(this.entries)
  }

  /** 删一条；返回它原本是否存在（过期的算不存在） */
  del(key: string): boolean {
    this.prune()
    if (!(key in this.entries)) return false
    delete this.entries[key]
    this.onChange?.(this.entries)
    return true
  }

  /** 清空本节点的全部临时变量 */
  clear(): number {
    this.prune()
    const n = Object.keys(this.entries).length
    if (n) {
      this.entries = {}
      this.onChange?.(this.entries)
    }
    return n
  }

  /** 只列键与元信息，不带值——列清单本身不应该把大内容带进上下文 */
  list(): TmpInfo[] {
    this.prune()
    const now = this.now()
    return Object.entries(this.entries)
      .sort((a, b) => b[1].createdAt - a[1].createdAt)
      .slice(0, TMP_LIST_LIMIT)
      .map(([key, entry]) => ({
        key,
        remainingMs: entry.expiresAt > 0 ? Math.max(0, entry.expiresAt - now) : null,
        chars: sizeOf(entry.value),
      }))
  }
}

/** 从 store 里取某个节点的临时变量表；没有就返回空表（不写回 store） */
export function tmpEntriesOf(store: LearnStore, nodeId: string): Record<string, TmpEntry> {
  return store.tmp?.[nodeId] ?? {}
}

/** 把某个节点的临时变量表写回 store（返回新 store，遵循不可变更新约定） */
export function withTmpEntries(
  store: LearnStore,
  nodeId: string,
  entries: Record<string, TmpEntry>,
): LearnStore {
  const tmp: TmpStore = { ...(store.tmp ?? {}), [nodeId]: entries }
  return { ...store, tmp }
}

/** 丢掉指定节点的临时变量（节点被删时调用） */
export function withoutTmpNodes(tmp: TmpStore | undefined, nodeIds: Set<string>): TmpStore {
  const out: TmpStore = {}
  for (const [nodeId, bucket] of Object.entries(tmp ?? {})) {
    if (!nodeIds.has(nodeId)) out[nodeId] = bucket
  }
  return out
}

/** 丢掉挂在已不存在节点上的临时变量（导入的数据对不上时调用） */
export function pruneTmpToNodes(tmp: TmpStore, nodeIds: Set<string>): TmpStore {
  const out: TmpStore = {}
  for (const [nodeId, bucket] of Object.entries(tmp)) {
    if (nodeIds.has(nodeId) && Object.keys(bucket).length) out[nodeId] = bucket
  }
  return out
}

/** 读盘时把任意来源的数据规范成临时变量表：坏数据一律丢掉，不让它拖垮整份数据 */
export function normalizeTmpStore(raw: unknown): TmpStore {
  if (!isRecord(raw)) return {}
  const out: TmpStore = {}
  for (const [nodeId, bucket] of Object.entries(raw)) {
    if (!isRecord(bucket)) continue
    const entries: Record<string, TmpEntry> = {}
    for (const [key, value] of Object.entries(bucket)) {
      if (!key.trim()) continue
      if (!isRecord(value)) continue
      const expiresAt = Number(value.expiresAt)
      const createdAt = Number(value.createdAt)
      entries[key] = {
        value: value.value,
        expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : 0,
        createdAt: Number.isFinite(createdAt) ? createdAt : 0,
      }
    }
    if (Object.keys(entries).length) out[nodeId] = entries
  }
  return out
}
