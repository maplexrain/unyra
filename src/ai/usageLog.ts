/**
 * 用量台账：每一次完成的 AI 请求记一条账（谁、哪个模型、干什么、多少 token、多久）。
 *
 * 埋点在 ai/client 的两个出口（streamChatWith / chatCompleteWith）——那是所有请求
 * 唯一必经的两扇门；设置里的「用量」页是它唯一的读者（见 settings/UsagePanel）。
 *
 * 存储：users/{uid}/usage.json（跟用户走，与 setting.yaml 同一个前缀）。写是**防抖**的
 * （尾随 1.5s），内存里的一份永远是权威；换用户（hydrateUsageLog）先把待写的尾巴
 * 落到旧目录，再清缓存读新的——switchRoot 的「旧目录的数据不动」因此仍然成立。
 *
 * 只记**完成**的请求：网络失败 / 主动取消在 client 里抛错，没有 usage 可言，
 * 记一条空账反而会把命中率之类的统计搅浑。台账有上限（CAP 条），超出的最旧的丢——
 * 这是统计数据不是账本，没必要无限留。
 */

import { readJson, userRel, writeJson } from '../lib/storage'
import { settingsUid } from '../lib/userSettings'
import type { UsagePurpose } from './types'

/** 一条请求账。数值一律是服务端回报的口径；estimated = token 数是本地估的 */
export interface UsageRecord {
  /** 请求完成时刻（epoch ms） */
  ts: number
  providerId: string
  /** 提供商展示名：改名之后旧账保留旧名（不回头改写历史） */
  provider: string
  model: string
  purpose: UsagePurpose
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  estimated?: boolean
  /** 请求总耗时（wall-clock，含网络与排队） */
  ms: number
}

interface UsageFile {
  version: 1
  records: UsageRecord[]
}

const FILE = 'usage.json'
/** 台账上限：条数一到就把最旧的挤出去（一条账 ~150B，封顶不到 1MB） */
const CAP = 6000
/** 防抖写盘的间隔：统计页不是每秒都开，1.5s 足够把一次会话的零散请求并成一次写 */
const SAVE_DELAY_MS = 1500

let records: UsageRecord[] = []
/** 换用户前欠着的写盘：uid 记的是欠账当时的用户——换用户之后写错目录就糟了 */
let pending: { uid: string; records: UsageRecord[] } | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

const notify = (): void => {
  for (const l of listeners) l()
}

export function subscribeUsageLog(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** 当前台账（内存权威）。数组引用只在真变了时才换——useSyncExternalStore 靠这个跳过空渲染 */
export function getUsageRecords(): UsageRecord[] {
  return records
}

/** 磁盘上的东西可能被人手改过：字段形状对不上的一条都不认（与 normalizeLearnStore 同一条纪律） */
const isRecord = (v: unknown): v is UsageRecord => {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    typeof r.ts === 'number' &&
    typeof r.providerId === 'string' &&
    typeof r.provider === 'string' &&
    typeof r.model === 'string' &&
    typeof r.purpose === 'string' &&
    typeof r.input === 'number' &&
    typeof r.output === 'number' &&
    typeof r.ms === 'number'
  )
}

async function flushNow(): Promise<void> {
  if (!pending) return
  const { uid, records: list } = pending
  pending = null
  const file: UsageFile = { version: 1, records: list }
  const ok = await writeJson(userRel(uid, FILE), file)
  if (!ok) console.warn('[usageLog] 写盘失败：', FILE)
}

/** 载入某个用户的台账；uid 为 null（未登录/登出）清空。换用户前先落掉旧用户欠的写盘 */
export async function hydrateUsageLog(uid: string | null): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
    await flushNow()
  }
  records = []
  notify()
  if (!uid) return
  const raw = await readJson<UsageFile>(userRel(uid, FILE))
  const list = Array.isArray(raw?.records) ? raw.records : []
  records = list.filter(isRecord).slice(-CAP)
  notify()
}

/**
 * 记一条账。调用方（ai/client）在请求完成时调；当前没有用户作用域就丢弃——
 * 未登录时没有可以记账的目录。
 */
export function recordUsage(entry: Omit<UsageRecord, 'ts'> & { ts?: number }): void {
  const uid = settingsUid()
  if (!uid) return
  records = [...records, { ...entry, ts: entry.ts ?? Date.now() }].slice(-CAP)
  pending = { uid, records }
  notify()
  // 尾随防抖：计时器在跑就让这笔搭车（pending 每次都换成最新的全量）
  if (saveTimer === null) {
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flushNow()
    }, SAVE_DELAY_MS)
  }
}

/** 清空当前用户的台账（设置页的「清空」）：立刻落一份空文件，别让旧账下次启动长回来 */
export function clearUsageLog(): void {
  const uid = settingsUid()
  records = []
  notify()
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
    pending = null
  }
  if (uid) {
    const file: UsageFile = { version: 1, records: [] }
    void writeJson(userRel(uid, FILE), file)
  }
}
