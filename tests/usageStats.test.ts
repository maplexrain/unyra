/**
 * 用量聚合的单元用例（见 ai/usageStats）。
 *
 * 钉的是几件「算错了界面只是一根柱子高一点」的事：命中率的口径
 * （没输入是「没数据」而不是 0%）、input 拆「缓存命中 + 新算」两截、
 * 每日分桶的补零、按模型归并与表头排序的升降序。
 */
import { describe, expect, it } from 'vitest'

import { byModel, byPurpose, dailyBuckets, dayKeyOf, filterRecords, sortModelRows, totalsOf } from '../src/ai/usageStats'
import type { UsageRecord } from '../src/ai/usageLog'

/** 造一条账：数值给的是好算的整数 */
const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  ts: 0,
  providerId: 'p1',
  provider: '甲',
  model: 'm1',
  purpose: 'chat',
  input: 100,
  output: 50,
  cacheRead: 0,
  cacheWrite: 0,
  ms: 1000,
  ...over,
})

describe('filterRecords', () => {
  const records = [
    rec({ ts: 100, providerId: 'p1', model: 'm1', purpose: 'chat' }),
    rec({ ts: 200, providerId: 'p2', provider: '乙', model: 'm2', purpose: 'guard' }),
    rec({ ts: 300, providerId: 'p1', model: 'm2', purpose: 'title' }),
  ]

  it('四个维度各自过滤，null 一律放行', () => {
    expect(filterRecords(records, { since: 150, providerId: null, model: null, purpose: null })).toHaveLength(2)
    expect(filterRecords(records, { since: null, providerId: 'p1', model: null, purpose: null })).toHaveLength(2)
    expect(filterRecords(records, { since: null, providerId: null, model: 'm2', purpose: null })).toHaveLength(2)
    expect(filterRecords(records, { since: null, providerId: null, model: null, purpose: 'chat' })).toHaveLength(1)
  })

  it('维度之间是「与」：叠上去只会更少', () => {
    expect(
      filterRecords(records, { since: 150, providerId: 'p1', model: 'm2', purpose: null }),
    ).toHaveLength(1)
    expect(filterRecords(records, { since: 999, providerId: null, model: null, purpose: null })).toHaveLength(0)
  })
})

describe('totalsOf', () => {
  it('命中率 = cacheRead / input；没有输入是「没数据」（null），不是 0%', () => {
    const t1 = totalsOf([rec({ input: 200, cacheRead: 50 })])
    expect(t1.hitRate).toBe(0.25)
    expect(t1.tokens).toBe(250)
    const t2 = totalsOf([rec({ input: 0, output: 30 })])
    expect(t2.hitRate).toBeNull()
  })

  it('夹住越界的命中率（个别网关的帧会自相矛盾），并数清估算条数', () => {
    const t = totalsOf([
      rec({ input: 100, cacheRead: 200, estimated: true }),
      rec({ input: 100, cacheRead: 10 }),
    ])
    expect(t.hitRate).toBe(1)
    expect(t.estimated).toBe(1)
    expect(t.requests).toBe(2)
  })
})

describe('每日分桶', () => {
  it('dayKeyOf 按本地时区取日（用本地 Date 构造，任何时区跑都一样）', () => {
    // 本地 2026-01-15 23:30：无论测试机在哪个时区，键都该是这一「本地日」
    const ts = new Date(2026, 0, 15, 23, 30).getTime()
    expect(dayKeyOf(ts)).toBe('2026-01-15')
  })

  it('days=null 只列有数据的天，按天升序', () => {
    const now = new Date(2026, 2, 10, 12).getTime()
    const a = new Date(2026, 2, 8, 9).getTime()
    const b = new Date(2026, 2, 9, 21).getTime()
    const buckets = dailyBuckets([rec({ ts: b }), rec({ ts: a })], null, now)
    expect(buckets.map((x) => x.day)).toEqual(['2026-03-08', '2026-03-09'])
  })

  it('days=N 从今天往回补零（今天含内），input 拆成缓存 + 新算两截', () => {
    const now = new Date(2026, 2, 10, 23).getTime()
    const today = new Date(2026, 2, 10, 8).getTime()
    const yesterday = new Date(2026, 2, 9, 8).getTime()
    const buckets = dailyBuckets(
      [rec({ ts: today, input: 100, cacheRead: 40 }), rec({ ts: yesterday, input: 0, output: 7 })],
      3,
      now,
    )
    expect(buckets.map((x) => x.day)).toEqual(['2026-03-08', '2026-03-09', '2026-03-10'])
    expect(buckets[0]).toMatchObject({ cacheRead: 0, inputFresh: 0, output: 0 })
    expect(buckets[1]).toMatchObject({ cacheRead: 0, inputFresh: 0, output: 7 })
    expect(buckets[2]).toMatchObject({ cacheRead: 40, inputFresh: 60, output: 50 })
  })
})

describe('byModel 与排序', () => {
  const records = [
    rec({ input: 100, output: 50, cacheRead: 20, ms: 1000 }),
    rec({ providerId: 'p1', input: 100, output: 50, cacheRead: 60, ms: 3000 }),
    rec({ providerId: 'p2', provider: '乙', model: 'm9', input: 10, output: 5, ms: 500 }),
  ]

  it('同提供商同模型归并成一行；不同提供商的同名模型是两行', () => {
    const rows = byModel(records)
    expect(rows).toHaveLength(2)
    const p1 = rows.find((r) => r.providerId === 'p1')
    expect(p1?.requests).toBe(2)
    expect(p1?.tokens).toBe(300)
    // 命中率是归并后重算的：20+60 / 200
    expect(p1?.hitRate ?? -1).toBeCloseTo(0.4)
  })

  it('sortModelRows：数字键升降序，model 键按字典序', () => {
    const rows = byModel(records)
    expect(sortModelRows(rows, 'tokens', -1).map((r) => r.model)).toEqual(['m1', 'm9'])
    expect(sortModelRows(rows, 'tokens', 1).map((r) => r.model)).toEqual(['m9', 'm1'])
    expect(sortModelRows(rows, 'model', 1).map((r) => r.model)).toEqual(['m1', 'm9'])
  })
})

describe('byPurpose', () => {
  it('按 token 总量降序', () => {
    const rows = byPurpose([
      rec({ purpose: 'title', input: 10, output: 5 }),
      rec({ purpose: 'chat', input: 100, output: 50 }),
      rec({ purpose: 'guard', input: 20, output: 10 }),
    ])
    expect(rows.map((r) => r.purpose)).toEqual(['chat', 'guard', 'title'])
    expect(rows[0].requests).toBe(1)
  })
})
