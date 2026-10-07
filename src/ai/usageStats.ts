/**
 * 用量台账的纯聚合：过滤、按天分桶、按模型/用途归并、排序。
 *
 * 单独成模块（而不写在 UsagePanel 里）：这些全是纯函数，可以被单元测试钉住——
 * 命中率的口径（cacheRead / input，没输入就是「没数据」而不是 0%）、
 * 每日分桶的补零、input 拆成「缓存命中 + 新算」两截，这些算错了界面上
 * 只是一根柱子高一点，谁也说不清哪里不对。
 */

import type { UsageRecord } from './usageLog'
import type { UsagePurpose } from './types'

/** 用量页的四个过滤维度；null = 不过滤这一维 */
export interface UsageFilter {
  /** 只看这个时刻之后的（epoch ms）；null = 全部 */
  since: number | null
  providerId: string | null
  model: string | null
  purpose: UsagePurpose | null
}

export function filterRecords(records: UsageRecord[], f: UsageFilter): UsageRecord[] {
  return records.filter(
    (r) =>
      (f.since === null || r.ts >= f.since) &&
      (f.providerId === null || r.providerId === f.providerId) &&
      (f.model === null || r.model === f.model) &&
      (f.purpose === null || r.purpose === f.purpose),
  )
}

export interface UsageTotals {
  requests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** input + output（台账里没有独立的总数，展示时现加） */
  tokens: number
  /** cacheRead / input；一条输入都没有时为 null——「没数据」与「全没命中」是两回事 */
  hitRate: number | null
  ms: number
  /** token 数是本地估算的请求条数（界面给个「约」的提示） */
  estimated: number
}

export function totalsOf(records: UsageRecord[]): UsageTotals {
  const t: UsageTotals = {
    requests: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tokens: 0,
    hitRate: null,
    ms: 0,
    estimated: 0,
  }
  for (const r of records) {
    t.requests++
    t.input += r.input
    t.output += r.output
    t.cacheRead += r.cacheRead
    t.cacheWrite += r.cacheWrite
    t.tokens += r.input + r.output
    t.ms += r.ms
    if (r.estimated) t.estimated++
  }
  t.hitRate = t.input > 0 ? Math.min(1, Math.max(0, t.cacheRead / t.input)) : null
  return t
}

/** 本地时区的 yyyy-mm-dd：按天分桶的键（界面上显示成 M-d） */
export function dayKeyOf(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export interface DayBucket {
  day: string
  /** 命中缓存的那部分输入 */
  cacheRead: number
  /** 全价重算的那部分输入（input − cacheRead，夹到 0：个别网关的帧会自相矛盾） */
  inputFresh: number
  output: number
}

/**
 * 按天分桶。days 非空：以 now 所在的一天为终点往前补零（今天含内）——
 * 「近 7 天」的图表该有 7 根柱子，没有数据的天是 0 高而不是缺一根；
 * days 为 null（「全部」）：只列有数据的天，按天升序，日期跨度可能很大。
 */
export function dailyBuckets(records: UsageRecord[], days: number | null, now: number): DayBucket[] {
  const map = new Map<string, DayBucket>()
  for (const r of records) {
    const key = dayKeyOf(r.ts)
    const b = map.get(key) ?? { day: key, cacheRead: 0, inputFresh: 0, output: 0 }
    b.cacheRead += r.cacheRead
    b.inputFresh += Math.max(0, r.input - r.cacheRead)
    b.output += r.output
    map.set(key, b)
  }
  if (days === null) {
    return [...map.values()].sort((a, b) => (a.day < b.day ? -1 : 1))
  }
  const DAY = 86_400_000
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const out: DayBucket[] = []
  for (let i = days - 1; i >= 0; i--) {
    const day = dayKeyOf(start.getTime() - i * DAY)
    out.push(map.get(day) ?? { day, cacheRead: 0, inputFresh: 0, output: 0 })
  }
  return out
}

/** 按模型归并的一行（同一家提供商的同一个模型算一行） */
export interface ModelRow {
  providerId: string
  provider: string
  model: string
  requests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  tokens: number
  hitRate: number | null
  ms: number
}

export function byModel(records: UsageRecord[]): ModelRow[] {
  const map = new Map<string, ModelRow>()
  for (const r of records) {
    const key = r.providerId + '\u0000' + r.model
    const row =
      map.get(key) ??
      ({
        providerId: r.providerId,
        provider: r.provider,
        model: r.model,
        requests: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        tokens: 0,
        hitRate: null,
        ms: 0,
      } satisfies ModelRow)
    row.requests++
    row.input += r.input
    row.output += r.output
    row.cacheRead += r.cacheRead
    row.cacheWrite += r.cacheWrite
    row.tokens += r.input + r.output
    row.ms += r.ms
    map.set(key, row)
  }
  const rows = [...map.values()]
  for (const row of rows) row.hitRate = row.input > 0 ? Math.min(1, Math.max(0, row.cacheRead / row.input)) : null
  return rows
}

export type ModelSortKey = 'model' | 'requests' | 'input' | 'output' | 'tokens' | 'hitRate' | 'ms'

/** 表头点击的排序。dir=1 升序、-1 降序；键值相同时保持原顺序（Array.sort 稳定） */
export function sortModelRows(rows: ModelRow[], key: ModelSortKey, dir: 1 | -1): ModelRow[] {
  const cmp = (a: ModelRow, b: ModelRow): number => {
    if (key === 'model') return a.model.localeCompare(b.model) * dir
    const av = a[key] ?? 0
    const bv = b[key] ?? 0
    return (av - bv) * dir
  }
  return [...rows].sort(cmp)
}

/** 按用途归并（token 总量降序）：用途就七种，一排小条画得下 */
export function byPurpose(records: UsageRecord[]): Array<{ purpose: UsagePurpose; requests: number; tokens: number }> {
  const map = new Map<UsagePurpose, { purpose: UsagePurpose; requests: number; tokens: number }>()
  for (const r of records) {
    const row = map.get(r.purpose) ?? { purpose: r.purpose, requests: 0, tokens: 0 }
    row.requests++
    row.tokens += r.input + r.output
    map.set(r.purpose, row)
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens)
}
