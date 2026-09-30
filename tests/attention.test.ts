/**
 * 注意力评级的单元用例。
 *
 * 钉的是三条纪律：冷启动不给档位、静默不算走神、评级只输出事实句与建议。
 * 这几条一旦破了，用户第一周就会学会表演阅读，数据从此全废。
 */
import { describe, expect, it } from 'vitest'

import { attentionOf, ATTENTION_LABEL } from '../src/learn/attention'
import type { ReadingSession, ReadingStore } from '../src/learn/reading'

const MIN = 60_000
const now = new Date(2026, 8, 20, 21, 0).getTime()

function session(over: Partial<ReadingSession> = {}): ReadingSession {
  const activeMs = over.activeMs ?? 20 * MIN
  const minutes = over.minutes ?? Array.from({ length: Math.round(activeMs / MIN) }, () => ({ ms: MIN, chars: 400, marks: 0, gaps: 0 }))
  return {
    id: 's' + Math.random().toString(36).slice(2),
    nodeId: 'n1',
    doc: 'teaching',
    day: '2026-09-20',
    from: now - activeMs,
    to: now,
    activeMs,
    minutes,
    breaks: [],
    sections: [],
    ...over,
  }
}

const store = (list: ReadingSession[]): ReadingStore => ({ version: 1, sessions: list, nodes: {}, days: {} })

describe('冷启动', () => {
  it('样本不足时不给档位，只给事实句', () => {
    const only = attentionOf(store([session()]), { now })
    expect(only.level).toBe('unknown')
    expect(only.confidence).toBe('low')
    expect(only.advice).toContain('先照常')
    expect(only.focusMinutes).toBe(25)

    const two = attentionOf(store([session(), session({ from: now - 3600_000, to: now - 3000_000 })]), { now })
    expect(two.level).toBe('unknown')
  })

  it('三场且够 15 分钟才给档位', () => {
    const list = [0, 1, 2].map((i) => session({ from: now - (i + 1) * 3600_000, to: now - (i + 1) * 3600_000 + 20 * MIN }))
    const a = attentionOf(store(list), { now })
    expect(a.confidence).toBe('ok')
    expect(a.sessions).toBe(3)
    expect(Object.keys(ATTENTION_LABEL)).toContain(a.level)
  })
})

describe('档位', () => {
  it('长时间不被打断 + 有交互印记 → 专注', () => {
    const list = [0, 1, 2].map((i) =>
      session({
        from: now - (i + 1) * 3600_000,
        to: now - (i + 1) * 3600_000 + 30 * MIN,
        activeMs: 30 * MIN,
        minutes: Array.from({ length: 30 }, () => ({ ms: MIN, chars: 400, marks: 0, gaps: 0 })),
        sections: [{ key: 'a', text: 'a', index: 0, level: 2, ms: 30 * MIN, reach: 1, marks: ['details', 'ask'], firstAt: now, lastAt: now }],
      }),
    )
    const a = attentionOf(store(list), { now })
    expect(a.level).toBe('focused')
    expect(a.dims.continuityMs).toBeGreaterThanOrEqual(20 * MIN)
    expect(a.focusMinutes).toBeGreaterThanOrEqual(25)
    expect(a.line).toContain('最长连续')
  })

  it('频繁切走 → 断续或心不在焉', () => {
    const list = [0, 1, 2].map((i) => {
      const from = now - (i + 1) * 3600_000
      return session({
        from,
        to: from + 20 * MIN,
        // 每 90 秒被切走一次（20 分钟里 12 次）
        breaks: Array.from({ length: 12 }, (_, k) => ({ at: from + k * 90_000, ms: 20_000, kind: 'blur' as const })),
      })
    })
    const a = attentionOf(store(list), { now })
    expect(['fragmented', 'drifting']).toContain(a.level)
    expect(a.dims.fragmentation).toBeGreaterThan(3)
    expect(a.focusMinutes).toBeLessThanOrEqual(15)
  })
})

describe('静默不是走神', () => {
  it('idle 只进 stalls，不进 fragmentation，也不扣连续时长', () => {
    const list = [0, 1, 2].map((i) =>
      session({
        from: now - (i + 1) * 3600_000,
        to: now - (i + 1) * 3600_000 + 25 * MIN,
        activeMs: 25 * MIN,
        minutes: Array.from({ length: 25 }, () => ({ ms: MIN, chars: 400, marks: 0, gaps: 0 })),
        breaks: [{ at: now - (i + 1) * 3600_000 + 8 * MIN, ms: 3 * MIN, kind: 'idle' }],
        sections: [{ key: 'a', text: 'a', index: 0, level: 2, ms: 25 * MIN, reach: 1, marks: [], firstAt: now, lastAt: now }],
      }),
    )
    const a = attentionOf(store(list), { now })
    // 静默是「每 10 分钟几次」的口径：3 场 25 分钟里各停一次 = 0.4 次/10 分钟
    expect(a.dims.fragmentation).toBe(0)
    expect(a.dims.stalls).toBeGreaterThan(0)
    expect(a.dims.continuityMs).toBeGreaterThan(10 * MIN)
    expect(a.level).toBe('focused')
  })
})

describe('「不在读」既不是走神也不是卡住', () => {
  it('away 不进 fragmentation、不进 stalls，但会把连续段切开', () => {
    // 一场 24 分钟：读 8 分钟 → 在对话栏跟导师打字 8 分钟（away）→ 再读 8 分钟
    const from = now - 3600_000
    const mid = (i: number) => !(i >= 8 && i < 16)
    const s = session({
      from,
      to: from + 24 * MIN,
      activeMs: 16 * MIN,
      minutes: Array.from({ length: 24 }, (_, i) => ({ ms: mid(i) ? MIN : 0, chars: 400, marks: 0, gaps: 0 })),
      breaks: [{ at: from + 8 * MIN, ms: 8 * MIN, kind: 'away' }],
      sections: [{ key: 'a', text: 'a', index: 0, level: 2, ms: 16 * MIN, reach: 1, marks: [], firstAt: now, lastAt: now }],
    })
    const a = attentionOf(store([s, s, s]), { now })
    expect(a.dims.fragmentation).toBe(0)
    expect(a.dims.stalls).toBe(0)
    // 断开之前是 8 分钟：不切的话这一场会被算成「连续 16 分钟」
    expect(a.dims.continuityMs).toBeLessThanOrEqual(8 * MIN)
    // 档位也不该因此掉下来：它不是被打断
    expect(['focused', 'steady']).toContain(a.level)
  })
})

describe('样本口径', () => {
  it('只看节点自己的会话（给了 nodeId 就过滤）', () => {
    const list = [0, 1, 2].map((i) => session({ nodeId: i === 0 ? 'n2' : 'n1', from: now - (i + 1) * 3600_000, to: now - (i + 1) * 3600_000 + 20 * MIN }))
    expect(attentionOf(store(list), { now, nodeId: 'n1' }).sessions).toBe(2)
    expect(attentionOf(store(list), { now }).sessions).toBe(3)
  })

  it('太久以前的会话不算数（注意力说的是最近）', () => {
    const old = session({ from: now - 30 * 86_400_000, to: now - 30 * 86_400_000 + 20 * MIN })
    expect(attentionOf(store([old, old, old]), { now }).sessions).toBe(0)
  })
})
