/** 这个文件负责：落盘阅读记录的校验（state.json 会被手改，坏数据丢弃而不是整库报废）。 */

import { num } from '../../lib/num'
import { compactReading, emptyReading, pruneReading } from './aggregate'
import { studyDayOf } from './anchor'
import { MAX_SESSIONS_TOTAL } from './constants'
import type { BreakKind, DocReading, MarkKind, ReadingBook, ReadingSession, ReadingStore, SectionRead } from './types'

/* ---------- 落盘数据的校验（state.json 会被手改，坏数据丢弃而不是整库报废） ---------- */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** 从磁盘读回阅读记录；结构不认识的部分整块丢掉，认得的照收 */
export function normalizeReading(raw: unknown): ReadingStore {
  const out = emptyReading()
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  if (Array.isArray(r.sessions)) {
    for (const item of r.sessions.slice(0, MAX_SESSIONS_TOTAL)) {
      const s = normalizeSession(item)
      if (s) out.sessions.push(s)
    }
  }
  if (r.nodes && typeof r.nodes === 'object') {
    for (const [nodeId, rec] of Object.entries(r.nodes as Record<string, unknown>)) {
      if (!nodeId || !rec || typeof rec !== 'object') continue
      const n = rec as Record<string, unknown>
      const docs: Record<string, DocReading> = {}
      if (n.docs && typeof n.docs === 'object') {
        for (const [doc, d] of Object.entries(n.docs as Record<string, unknown>)) {
          if (!doc || !d || typeof d !== 'object') continue
          const dr = d as Record<string, unknown>
          docs[doc] = {
            sections: normalizeSections(dr.sections),
            activeMs: num(dr.activeMs),
            ...(typeof dr.words === 'number' ? { words: num(dr.words) } : {}),
            ...(typeof dr.doneAt === 'number' ? { doneAt: num(dr.doneAt) } : {}),
          }
        }
      }
      out.nodes[nodeId] = {
        docs,
        activeMs: num(n.activeMs),
        firstAt: num(n.firstAt),
        lastAt: num(n.lastAt),
        opens: num(n.opens),
      }
    }
  }
  if (r.days && typeof r.days === 'object') {
    for (const [day, d] of Object.entries(r.days as Record<string, unknown>)) {
      if (!DAY_RE.test(day) || !d || typeof d !== 'object') continue
      const dr = d as Record<string, unknown>
      out.days[day] = {
        day,
        activeMs: num(dr.activeMs),
        nodes: Array.isArray(dr.nodes) ? dr.nodes.filter((x): x is string => typeof x === 'string') : [],
        marks: num(dr.marks),
      }
    }
  }
  return compactReading(out)
}

/**
 * 读回**按目标**的阅读账本（见 ReadingBook）。
 *
 * 两条纪律与别的目标级数据一致：目标已经不在了的整本丢掉（那是它的账）；
 * 每本还要按活着的节点过一遍（同 pruneReading 的道理——节点没了，按它索引的记录就是空索引）。
 * 空账本不留在内存里：文件都不写，内存里留一个空壳只会让「有没有记录」的判断多一种情况。
 */
export function normalizeReadingBook(
  raw: unknown,
  aliveNodes: Set<string>,
  aliveGoals: Set<string>,
): ReadingBook {
  const byGoal: Record<string, ReadingStore> = {}
  const src = raw && typeof raw === 'object' ? (raw as { byGoal?: unknown }).byGoal : null
  if (!src || typeof src !== 'object') return { byGoal }
  for (const [goalId, one] of Object.entries(src as Record<string, unknown>)) {
    if (!goalId || !aliveGoals.has(goalId)) continue
    const rec = pruneReading(normalizeReading(one), aliveNodes)
    if (rec.sessions.length || Object.keys(rec.nodes).length || Object.keys(rec.days).length) {
      byGoal[goalId] = rec
    }
  }
  return { byGoal }
}

function normalizeSession(raw: unknown): ReadingSession | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r.id)
  const nodeId = str(r.nodeId)
  if (!id || !nodeId) return null
  const day = DAY_RE.test(str(r.day)) ? str(r.day) : studyDayOf(num(r.at) || num(r.from) || Date.now())
  return {
    id,
    nodeId,
    doc: str(r.doc) || 'teaching',
    day,
    from: num(r.from),
    to: num(r.to),
    activeMs: num(r.activeMs),
    minutes: Array.isArray(r.minutes)
      ? r.minutes.slice(0, 600).map((m) => {
          const t = (m ?? {}) as Record<string, unknown>
          return { ms: num(t.ms), chars: num(t.chars), marks: num(t.marks), gaps: num(t.gaps) }
        })
      : [],
    breaks: Array.isArray(r.breaks)
      ? r.breaks.slice(0, 60).flatMap((b) => {
          const t = (b ?? {}) as Record<string, unknown>
          const kind = str(t.kind) as BreakKind
          return ['blur', 'hidden', 'tab', 'idle', 'doc', 'exam', 'write', 'away'].includes(kind)
            ? [{ at: num(t.at), ms: num(t.ms), kind }]
            : []
        })
      : [],
    sections: normalizeSections(r.sections),
    ...(typeof r.planId === 'string' ? { planId: r.planId } : {}),
  }
}

function normalizeSections(raw: unknown): SectionRead[] {
  if (!Array.isArray(raw)) return []
  const out: SectionRead[] = []
  for (const item of raw.slice(0, 200)) {
    if (!item || typeof item !== 'object') continue
    const s = item as Record<string, unknown>
    const key = str(s.key)
    if (!key) continue
    out.push({
      key,
      text: str(s.text) || key,
      index: num(s.index),
      level: num(s.level) || 2,
      ms: num(s.ms),
      reach: clamp01(num(s.reach)),
      marks: Array.isArray(s.marks)
        ? (s.marks.filter((m): m is MarkKind => typeof m === 'string') as MarkKind[]).slice(0, 12)
        : [],
      firstAt: num(s.firstAt),
      lastAt: num(s.lastAt),
      ...(s.fuzzy === true ? { fuzzy: true } : {}),
    })
  }
  return out
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))
