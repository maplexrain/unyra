/**
 * 有效阅读记录的单元用例。
 *
 * 钉的是三件事：
 * 1. 学习日的边界（跨零点学习不能被劈成两天，打卡的连续天数全靠它）；
 * 2. 增量能不能安全地「加上去」（重复结算、崩溃重放不许算两遍）；
 * 3. 文档被改写之后，锚还能不能认回原来那一节（认错节 = 计划说错话）。
 */
import { describe, expect, it } from 'vitest'

import {
  applyReadingDelta,
  docReadingOf,
  emptyReading,
  matchSections,
  compactReading,
  MAX_SESSIONS_TOTAL,
  readingDay,
  readingIndex,
  readingLine,
  readingSince,
  recentDays,
  looseSectionKey,
  sectionKey,
  seedSections,
  studyDayOf,
  type ReadingDelta,
  type ReadingStore,
  type SectionRead,
} from '../src/learn/reading'

/** 本地时间的时间戳（避免用 UTC 字符串，用例要跟机器时区无关） */
function local(y: number, m: number, d: number, h: number, min = 0): number {
  return new Date(y, m - 1, d, h, min, 0, 0).getTime()
}

function delta(over: Partial<ReadingDelta> = {}): ReadingDelta {
  return {
    sessionId: 's1',
    nodeId: 'n1',
    doc: 'teaching',
    day: '2026-09-20',
    at: local(2026, 9, 20, 10, 0),
    activeMs: 60_000,
    minuteIndex: 0,
    minutes: [{ ms: 60_000, chars: 400, marks: 0, gaps: 0 }],
    breaks: [],
    sections: [],
    ...over,
  }
}

function section(over: Partial<SectionRead> = {}): SectionRead {
  return {
    key: '极限',
    text: '极限',
    index: 0,
    level: 2,
    ms: 0,
    reach: 0,
    marks: [],
    firstAt: 0,
    lastAt: 0,
    ...over,
  }
}

describe('学习日', () => {
  it('凌晨四点前算前一天（23:40 学的那半小时不该被劈开）', () => {
    expect(studyDayOf(local(2026, 9, 20, 23, 40))).toBe('2026-09-20')
    expect(studyDayOf(local(2026, 9, 21, 0, 30))).toBe('2026-09-20')
    expect(studyDayOf(local(2026, 9, 21, 3, 59))).toBe('2026-09-20')
    expect(studyDayOf(local(2026, 9, 21, 4, 0))).toBe('2026-09-21')
    expect(studyDayOf(local(2026, 9, 21, 9, 0))).toBe('2026-09-21')
  })
})

describe('节的锚', () => {
  it('主锚保留编号（「1. 引入」与「2. 引入」不能撞成同一节），只去 Markdown 记号与空白', () => {
    expect(sectionKey('2.3 三次方根')).toBe('2.3三次方根')
    expect(sectionKey('## **三次方根**')).toBe('三次方根')
    expect(sectionKey('三次方根。')).toBe('三次方根')
    expect(sectionKey('Chain Rule')).toBe('chainrule')
    expect(sectionKey('1. 引入')).not.toBe(sectionKey('2. 引入'))
  })

  it('去编号的锚只在精确认不出时当候选', () => {
    expect(looseSectionKey('2.3 三次方根')).toBe('三次方根')
    expect(looseSectionKey('二、三次方根')).toBe('三次方根')
    expect(looseSectionKey('(1) 三次方根')).toBe('三次方根')
    expect(looseSectionKey('## 三次方根')).toBe('三次方根')
  })

  it('播种：整份文档的节都进来，未读的 reach 是 0（「没记录」与「读了 0 秒」是两件事）', () => {
    const seeds = seedSections([{ level: 2, text: '1. 引入' }, { level: 3, text: '1.1 例子' }], 1000)
    // 播种出来的锚与 sectionKey 同口径（保留编号），否则第一场会话就跟记录对不上
    expect(seeds.map((s) => s.key)).toEqual(['1.引入', '1.1例子'])
    expect(seeds.every((s) => s.reach === 0 && s.ms === 0)).toBe(true)
  })

  it('标题没动就精确认领（fuzzy=false）', () => {
    const recorded = [
      section({ key: sectionKey('1. 引入'), text: '1. 引入', index: 0, level: 2 }),
      section({ key: sectionKey('2. 三次方根'), text: '2. 三次方根', index: 1, level: 2 }),
    ]
    const matched = matchSections(recorded, [{ level: 2, text: '2. 三次方根' }])
    expect(matched[0].prev?.key).toBe(sectionKey('2. 三次方根'))
    expect(matched[0].fuzzy).toBe(false)
  })

  it('只改了编号：走去编号那一路，认回来并标 fuzzy', () => {
    const recorded = [section({ key: sectionKey('2. 三次方根'), text: '2. 三次方根', index: 1, level: 2 })]
    const matched = matchSections(recorded, [{ level: 2, text: '三次方根' }])
    expect(matched[0].prev).toBeTruthy()
    expect(matched[0].fuzzy).toBe(true)
  })

  it('整节换了名字：按「同层级里位置最近、且没被认领」兜底（中间插一节会让后面整体错位）', () => {
    const recorded = [
      section({ key: sectionKey('1. 引入'), text: '1. 引入', index: 0, level: 2 }),
      section({ key: sectionKey('2. 三次方根'), text: '2. 三次方根', index: 1, level: 2 }),
    ]
    const matched = matchSections(recorded, [{ level: 2, text: '全新的第一节' }, { level: 2, text: '2. 三次方根' }])
    expect(matched[0].prev?.text).toBe('1. 引入')
    expect(matched[0].fuzzy).toBe(true)
    // 第二节照旧精确认领：兜底不许把已经精确匹配过的节抢走
    expect(matched[1].prev?.text).toBe('2. 三次方根')
    expect(matched[1].fuzzy).toBe(false)
  })
})

describe('增量累加', () => {
  it('时长相加、reach 取最大、marks 取并集（增量语义：重复结算不会算两遍时长）', () => {
    let store: ReadingStore = emptyReading()
    store = applyReadingDelta(store, delta({ sections: [section({ ms: 30_000, reach: 0.4, marks: ['details'] })] }))
    store = applyReadingDelta(store, delta({ at: local(2026, 9, 20, 10, 1), sections: [section({ ms: 20_000, reach: 0.8, marks: ['ask'] })] }))
    const doc = docReadingOf(store, 'n1', 'teaching')
    expect(doc?.activeMs).toBe(120_000)
    expect(doc?.sections[0].ms).toBe(50_000)
    expect(doc?.sections[0].reach).toBe(0.8)
    expect(doc?.sections[0].marks).toEqual(['details', 'ask'])
  })

  it('同一场会话的多次结算并进同一条明细，分钟桶按索引相加', () => {
    let store = applyReadingDelta(emptyReading(), delta())
    store = applyReadingDelta(store, delta({ at: local(2026, 9, 20, 10, 2), activeMs: 30_000, minuteIndex: 1, minutes: [{ ms: 30_000, chars: 100, marks: 1, gaps: 0 }] }))
    expect(store.sessions).toHaveLength(1)
    expect(store.sessions[0].activeMs).toBe(90_000)
    expect(store.sessions[0].minutes.map((m) => m.ms)).toEqual([60_000, 30_000])
    expect(store.sessions[0].to).toBe(local(2026, 9, 20, 10, 2))
  })

  it('打开次数与学习日汇总', () => {
    let store = applyReadingDelta(emptyReading(), delta({ opens: 1 }))
    store = applyReadingDelta(store, delta({ at: local(2026, 9, 20, 10, 5), opens: 1 }))
    expect(store.nodes.n1.opens).toBe(2)
    expect(readingDay(store, '2026-09-20')?.activeMs).toBe(120_000)
    expect(readingDay(store, '2026-09-20')?.nodes).toEqual(['n1'])
  })

  it('每一节都读到过、且总时长够了，才算读完', () => {
    let store = applyReadingDelta(emptyReading(), delta({ activeMs: 70_000, sections: [section({ ms: 70_000, reach: 1 })] }))
    expect(docReadingOf(store, 'n1', 'teaching')?.doneAt).toBeTruthy()
    let partial = applyReadingDelta(
      emptyReading(),
      delta({ activeMs: 70_000, sections: [section({ ms: 40_000, reach: 1 }), section({ key: 'b', text: 'b', index: 1, ms: 30_000, reach: 0.2 })] }),
    )
    expect(docReadingOf(partial, 'n1', 'teaching')?.doneAt).toBeUndefined()
  })

  it('空增量（没有时长也没有打开事件）不进 store', () => {
    const store = applyReadingDelta(emptyReading(), delta({ activeMs: 0, minutes: [], opens: 0 }))
    expect(store.sessions).toHaveLength(0)
  })
})

describe('有界与查询', () => {
  it('明细超上限时丢最旧的，但汇总不缩水', () => {
    let store: ReadingStore = emptyReading()
    for (let i = 0; i < MAX_SESSIONS_TOTAL + 5; i += 1) {
      store = applyReadingDelta(store, delta({ sessionId: 's' + i, at: local(2026, 9, 20, 10, 0) + i * 1000 }))
    }
    expect(store.sessions.length).toBeLessThanOrEqual(MAX_SESSIONS_TOTAL)
    expect(store.nodes.n1.activeMs).toBe((MAX_SESSIONS_TOTAL + 5) * 60_000)
  })

  it('一个节点最多留 40 场会话', () => {
    let store: ReadingStore = emptyReading()
    for (let i = 0; i < 50; i += 1) store = applyReadingDelta(store, delta({ sessionId: 's' + i, at: local(2026, 9, 20, 9, 0) + i * 1000 }))
    expect(store.sessions.filter((s) => s.nodeId === 'n1').length).toBeLessThanOrEqual(40)
  })

  it('学习日索引只留最近 90 天', () => {
    const days: ReadingStore['days'] = {}
    for (let i = 0; i < 120; i += 1) {
      const day = '2026-' + String(Math.floor(i / 28) + 1).padStart(2, '0') + '-' + String((i % 28) + 1).padStart(2, '0')
      days[day] = { day, activeMs: 1000, nodes: [], marks: 0 }
    }
    const out = compactReading({ version: 1, sessions: [], nodes: {}, days })
    expect(Object.keys(out.days).length).toBe(90)
  })

  it('readingIndex 给出未读的节（计划侧说「第 3 节还没看」靠它）', () => {
    const store = applyReadingDelta(
      emptyReading(),
      delta({ sections: [section({ key: 'a', text: '第一节', ms: 30_000, reach: 0.9 }), section({ key: 'b', text: '第二节', index: 1, reach: 0.1 })] }),
    )
    const rows = readingIndex(store, (id) => (id === 'n1' ? '极限' : undefined))
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('极限')
    expect(rows[0].docs[0]).toMatchObject({ doc: 'teaching', read: 1, total: 2, done: false })
    expect(rows[0].unread).toEqual(['第二节'])
  })

  it('readingSince 走学习日索引（明细被滚掉也不缩水），recentDays 补齐空白日', () => {
    const store = applyReadingDelta(emptyReading(), delta())
    const since = readingSince(store, local(2026, 9, 20, 0, 0), local(2026, 9, 20, 23, 0))
    expect(since.activeMs).toBe(60_000)
    expect(since.days).toBe(1)
    const days = recentDays(store, 3, local(2026, 9, 22, 12, 0))
    expect(days.map((d) => d.day)).toEqual(['2026-09-20', '2026-09-21', '2026-09-22'])
    expect(days[0].activeMs).toBe(60_000)
    expect(days[1].activeMs).toBe(0)
  })

  it('readingLine 说的是事实，不出现评判词', () => {
    const store = applyReadingDelta(emptyReading(), delta({ sections: [section({ ms: 60_000, reach: 1 })] }))
    const line = readingLine(store.nodes.n1)
    expect(line).toContain('有效阅读 1 分钟')
    expect(line).toContain('读到 1/1 节')
    expect(line).not.toMatch(/专注|走神|注意/)
  })
})
