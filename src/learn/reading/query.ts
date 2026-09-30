/** 这个文件负责：阅读账的读取侧——派生视图（单点查询、按目标汇总、区间与趋势），都是纯函数。 */

import { studyDayOf } from './anchor'
import { SECTION_REACHED } from './constants'
import type { DaySummary, DocReading, NodeReading, ReadingSession, ReadingStore } from './types'

/* ---------- 查询（派生视图，都是纯函数） ---------- */

export function readingOf(store: ReadingStore | undefined, nodeId: string): NodeReading | undefined {
  return store?.nodes[nodeId]
}

export function docReadingOf(
  store: ReadingStore | undefined,
  nodeId: string,
  doc: string,
): DocReading | undefined {
  return store?.nodes[nodeId]?.docs[doc]
}

export function readingDay(store: ReadingStore | undefined, day: string): DaySummary | undefined {
  return store?.days[day]
}

export function sessionsOf(store: ReadingStore | undefined, opts: { nodeId?: string; since?: number } = {}): ReadingSession[] {
  const list = store?.sessions ?? []
  return list.filter(
    (s) => (!opts.nodeId || s.nodeId === opts.nodeId) && (!opts.since || s.to >= opts.since),
  )
}

export interface ReadingRow {
  nodeId: string
  title: string
  activeMs: number
  lastAt: number
  opens: number
  /** 各文档：读到几节 / 共几节 */
  docs: Array<{ doc: string; read: number; total: number; activeMs: number; done: boolean }>
  /** 还没读到的节（取教学文档），计划侧据此说「第 3 节还没看」 */
  unread: string[]
}

/** 一个目标下每个节点的阅读情况（计划与界面都用它） */
export function readingIndex(
  store: ReadingStore | undefined,
  titleOf: (nodeId: string) => string | undefined,
  nodeIds?: string[],
): ReadingRow[] {
  const nodes = store?.nodes ?? {}
  const ids = nodeIds ?? Object.keys(nodes)
  const rows: ReadingRow[] = []
  for (const nodeId of ids) {
    const rec = nodes[nodeId]
    if (!rec) continue
    const docs = Object.entries(rec.docs).map(([doc, d]) => ({
      doc,
      read: d.sections.filter((s) => s.reach >= SECTION_REACHED).length,
      total: d.sections.length,
      activeMs: d.activeMs,
      done: !!d.doneAt,
    }))
    const main = rec.docs.teaching
    rows.push({
      nodeId,
      title: titleOf(nodeId) ?? nodeId,
      activeMs: rec.activeMs,
      lastAt: rec.lastAt,
      opens: rec.opens,
      docs,
      unread: (main?.sections ?? []).filter((s) => s.reach < SECTION_REACHED).map((s) => s.text),
    })
  }
  return rows.sort((a, b) => b.lastAt - a.lastAt)
}

/**
 * 这个目标**最近一次浏览**的时刻（各节点 lastAt 取最大；从没读过回 0）。
 *
 * 顶栏两个 tip（有效阅读 / 打卡）的目标 tab 都按它降序排：最近在读的那门课排最前，
 * 翻 tip 的人大概率正是要找它。落盘的 lastAt 最多滞后一个结算周期（30 秒），
 * 排序用途下这点滞后无所谓。
 */
export function lastBrowseAtOf(store: ReadingStore | undefined): number {
  let last = 0
  for (const n of Object.values(store?.nodes ?? {})) if (n.lastAt > last) last = n.lastAt
  return last
}

/**
 * 区间聚合：给「这周读了多久」这类问题。
 *
 * 总时长与天数走**学习日索引**（它单调累加，明细被滚掉也不会缩水）；
 * 节点分布走明细会话（日索引里没记 per-node 的时长）。
 * 明细上限是 400 场，超出之后这里的分节点数字会偏小——总量不受影响。
 */
export function readingSince(
  store: ReadingStore | undefined,
  from: number,
  to: number,
): { activeMs: number; days: number; byNode: Record<string, number> } {
  const byNode: Record<string, number> = {}
  const daySet = new Set<string>()
  const lo = studyDayOf(from)
  const hi = studyDayOf(to)
  let activeMs = 0
  for (const d of Object.values(store?.days ?? {})) {
    if (d.day < lo || d.day > hi) continue
    daySet.add(d.day)
    activeMs += d.activeMs
  }
  for (const s of store?.sessions ?? []) {
    if (s.to < from || s.from > to) continue
    byNode[s.nodeId] = (byNode[s.nodeId] ?? 0) + s.activeMs
    daySet.add(s.day)
  }
  return { activeMs, days: daySet.size, byNode }
}

/** 最近 n 个学习日（早 → 晚，最后一个是今天）：日历与趋势用 */
export function recentDays(store: ReadingStore | undefined, n: number, now: number): DaySummary[] {
  const out: DaySummary[] = []
  for (let i = n - 1; i >= 0; i -= 1) {
    const day = studyDayOf(now - i * 86_400_000)
    out.push(store?.days[day] ?? { day, activeMs: 0, nodes: [], marks: 0 })
  }
  return out
}

/** 给人（与 agent）看的一句话：事实，不带评判 */
export function readingLine(rec: NodeReading | undefined, docLabel?: string): string {
  if (!rec || !rec.activeMs) return '还没有阅读记录'
  const mins = Math.round(rec.activeMs / 60_000)
  const docs = Object.entries(rec.docs)
  const main = docLabel ? rec.docs[docLabel] : docs.sort((a, b) => b[1].activeMs - a[1].activeMs)[0]?.[1]
  const read = main?.sections.filter((s) => s.reach >= SECTION_REACHED).length ?? 0
  const total = main?.sections.length ?? 0
  const bits = ['有效阅读 ' + mins + ' 分钟，打开 ' + rec.opens + ' 次']
  if (total) bits.push('读到 ' + read + '/' + total + ' 节')
  const last = new Date(rec.lastAt)
  bits.push('最后一次 ' + last.toISOString().slice(0, 16).replace('T', ' '))
  return bits.join('；')
}
