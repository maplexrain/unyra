/**
 * 热身门槛与「今天读没读过」的单元用例。
 *
 * 门槛的语义容易写歪成两种：① 把「过线前的 20 秒」扣掉（那是折扣，不是门槛）；
 * ② 只要动过鼠标就算（那「看一眼就走」照样记账）。两条都在这里钉死。
 */
import { describe, expect, it } from 'vitest'

import {
  applyReadingDelta,
  emptyReading,
  readToday,
  studyDayOf,
  warmupDone,
  WARMUP_MS,
  type ReadingDelta,
} from '../src/learn/reading'

const now = new Date(2026, 8, 20, 21, 0).getTime()

function delta(over: Partial<ReadingDelta> = {}): ReadingDelta {
  return {
    sessionId: 's1',
    nodeId: 'n1',
    doc: 'teaching',
    day: studyDayOf(now),
    at: now,
    activeMs: 60_000,
    minuteIndex: 0,
    minutes: [{ ms: 60_000, chars: 400, marks: 0, gaps: 0 }],
    breaks: [],
    sections: [{ key: 'a', text: '极限', index: 0, level: 2, ms: 30_000, reach: 0.8, marks: [], firstAt: now, lastAt: now }],
    ...over,
  }
}

describe('热身门槛', () => {
  it('今天已读过：直接算，不看时长与交互', () => {
    expect(warmupDone({ knownToday: true, interacted: false, activeMs: 0 })).toBe(true)
  })

  it('今天没读过：要**动过** 且 读够 20 秒，两条都占', () => {
    expect(warmupDone({ knownToday: false, interacted: true, activeMs: WARMUP_MS })).toBe(false)
    expect(warmupDone({ knownToday: false, interacted: true, activeMs: WARMUP_MS + 1 })).toBe(true)
    // 只挂着不动：读了一小时也不算
    expect(warmupDone({ knownToday: false, interacted: false, activeMs: 3_600_000 })).toBe(false)
  })

  it('是门槛不是折扣：刚好过线那一刻，前面那 20 秒也一起算（由调用方保留缓冲）', () => {
    // 这条钉的是**语义**：函数本身只说「过没过」，不清零、不截断
    const before = warmupDone({ knownToday: false, interacted: true, activeMs: WARMUP_MS - 1 })
    const after = warmupDone({ knownToday: false, interacted: true, activeMs: WARMUP_MS + 1 })
    expect([before, after]).toEqual([false, true])
  })
})

describe('今天读过没有', () => {
  it('今天的会话里出现过这个节点 + 这份文档 → 算读过', () => {
    const store = applyReadingDelta(emptyReading(), delta())
    expect(readToday(store, 'n1', 'teaching', now)).toBe(true)
    // 同一节点的另一份文档没读过
    expect(readToday(store, 'n1', 'note:我的笔记', now)).toBe(false)
    // 别的节点没读过
    expect(readToday(store, 'n2', 'teaching', now)).toBe(false)
  })

  it('明细滚掉之后仍认得出来（看这份文档最后一次被读到的时间戳）', () => {
    const reading = applyReadingDelta(emptyReading(), delta())
    const store = { ...reading, sessions: [] }
    expect(readToday(store, 'n1', 'teaching', now)).toBe(true)
  })

  it('昨天读过不算今天：换个日子就重新过门槛', () => {
    const yesterday = now - 86_400_000
    const reading = applyReadingDelta(emptyReading(), delta({ day: studyDayOf(yesterday), at: yesterday }))
    const store = reading
    expect(readToday(store, 'n1', 'teaching', now)).toBe(false)
    expect(readToday(store, 'n1', 'teaching', yesterday)).toBe(true)
  })

  it('没记录（新用户、没读过的文档）→ 不算', () => {
    expect(readToday(emptyReading(), 'n1', 'teaching', now)).toBe(false)
    expect(readToday(undefined, 'n1', 'teaching', now)).toBe(false)
  })
})
