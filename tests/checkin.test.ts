/**
 * 打卡的单元用例。
 *
 * 钉的是需求里定死的那几条：一天 3 次机会、门槛不许放到白菜价、
 * 出题只能来自今天真正读到的内容、连续天数按学习日算（跨零点不劈天）。
 */
import { describe, expect, it } from 'vitest'

import {
  applyCheckinAttempt,
  applyExamCheckin,
  calendarLabel,
  CALENDAR_DAYS,
  checkinCalendar,
  checkinEligible,
  emptyCheckin,
  MAX_ATTEMPTS,
  MIN_DAY_MS,
  normalizeCheckin,
  remainingText,
  streakOf,
  type CheckinStore,
} from '../src/learn/checkin'
import { applyReadingDelta, emptyReading, studyDayOf, type ReadingStore } from '../src/learn/reading'

const MIN = 60_000
const now = new Date(2026, 8, 20, 20, 0).getTime()
const day = studyDayOf(now)

/** 造一份「今天读了 20 分钟、两节读透」的阅读记录 */
function readToday(activeMs = 20 * MIN, reach = 0.9): ReadingStore {
  const reading = applyReadingDelta(emptyReading(), {
    sessionId: 's1',
    nodeId: 'n1',
    doc: 'teaching',
    day,
    at: now,
    activeMs,
    minuteIndex: 0,
    minutes: [{ ms: activeMs, chars: 3000, marks: 1, gaps: 0 }],
    breaks: [],
    sections: [
      { key: 'a', text: '极限的直觉', index: 0, level: 2, ms: activeMs / 2, reach, marks: ['details'], firstAt: now, lastAt: now },
      { key: 'b', text: '三次方根', index: 1, level: 2, ms: activeMs / 2, reach, marks: [], firstAt: now, lastAt: now },
    ],
  })
  return reading
}

describe('资格', () => {
  it('没读到 15 分钟：说清还差多少（这句话会直接显示在顶栏 tip 里）', () => {
    const store = readToday(5 * MIN)
    const e = checkinEligible(store, undefined, { now, titleOf: () => '极限' })
    expect(e.ok).toBe(false)
    expect(e.reason).toContain('还差 10 分钟')
    expect(e.chancesLeft).toBe(MAX_ATTEMPTS)
    expect(e.requiredMs).toBe(MIN_DAY_MS)
  })

  it('extraMs：还没落盘的那一段也算进「还差多久」（顶栏要每秒都在动）', () => {
    // store 里只有 5 分钟；这一场又读了 9 分 30 秒还没结算
    const store = readToday(5 * MIN)
    const before = checkinEligible(store, undefined, { now, titleOf: () => '极限' })
    expect(before.reason).toContain('还差 10 分钟')

    const after = checkinEligible(store, undefined, { now, titleOf: () => '极限', extraMs: 9.5 * MIN })
    expect(after.reason).toContain('还差 30 秒')
    // 判定本身读的仍然是 store：真把关在 checkin.settle
    expect(after.activeMs).toBe(5 * MIN + 9.5 * MIN)

    // 补够了就当场放行——「读够了」与「能打卡」该在同一秒成立
    const ok = checkinEligible(store, undefined, { now, titleOf: () => '极限', extraMs: 10 * MIN })
    expect(ok.ok).toBe(true)
  })

  it('remainingText：一分钟以上按分钟说，最后几十秒精确到秒', () => {
    expect(remainingText(10 * MIN)).toBe('10 分钟')
    expect(remainingText(MIN)).toBe('1 分钟')
    // 进一位（宁可说多一秒）：59.4 秒显示「60 秒」，正好一分钟才转成「1 分钟」
    expect(remainingText(59_400)).toBe('60 秒')
    expect(remainingText(1_001)).toBe('2 秒')
    expect(remainingText(0)).toBe('0 秒')
    expect(remainingText(-5_000)).toBe('0 秒')
  })

  it('时长够了但只扫过、没有读透的节 → 出不了题', () => {
    const reading = applyReadingDelta(emptyReading(), {
      sessionId: 's1',
      nodeId: 'n1',
      doc: 'teaching',
      day,
      at: now,
      activeMs: 20 * MIN,
      minuteIndex: 0,
      minutes: [{ ms: 20 * MIN, chars: 100, marks: 0, gaps: 0 }],
      breaks: [],
      sections: [{ key: 'a', text: '极限', index: 0, level: 2, ms: 20 * MIN, reach: 0.2, marks: [], firstAt: now, lastAt: now }],
    })
    const e = checkinEligible(reading, undefined, { now, titleOf: () => '极限' })
    expect(e.ok).toBe(false)
    expect(e.reason).toContain('太少')
  })

  it('时长与内容都够：给出题源、建议题数与门槛（门槛不低于 60%）', () => {
    const e = checkinEligible(readToday(), undefined, { now, titleOf: () => '极限' })
    expect(e.ok).toBe(true)
    expect(e.sources.map((s) => s.text)).toEqual(['极限的直觉', '三次方根'])
    expect(e.sources[0].title).toBe('极限')
    expect(e.suggestQuestions).toBe(3)
    expect(e.suggestThreshold).toBe(3)
  })

  it('今天已经打过卡：不再放行', () => {
    const first = applyCheckinAttempt(emptyCheckin(), { day, correct: 3, total: 3, threshold: 3, passed: true }, now)
    const e = checkinEligible(readToday(), first.store, { now, titleOf: () => '极限' })
    expect(e.ok).toBe(false)
    expect(e.reason).toContain('已经打过卡')
  })

  it('三次机会用完：不再放行', () => {
    let store: CheckinStore = emptyCheckin()
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      store = applyCheckinAttempt(store, { day, correct: 1, total: 4, threshold: 3, passed: false }, now + i).store
    }
    const e = checkinEligible(readToday(), store, { now, titleOf: () => '极限' })
    expect(e.ok).toBe(false)
    expect(e.chancesLeft).toBe(0)
    expect(e.reason).toContain('机会用完')
  })
})

describe('记一次结果', () => {
  it('门槛由我们复核：agent 说过了但没到门槛，不算过', () => {
    const out = applyCheckinAttempt(emptyCheckin(), { day, correct: 2, total: 4, threshold: 3, passed: true }, now)
    expect(out.day.passed).toBe(false)
    expect(out.day.attempts[0].passed).toBe(false)
    expect(out.day.attempts[0].threshold).toBe(3)
  })

  it('门槛不许低于 60%：给了 1 题也算成 60% 那一档', () => {
    const out = applyCheckinAttempt(emptyCheckin(), { day, correct: 2, total: 4, threshold: 1, passed: true }, now)
    expect(out.day.attempts[0].threshold).toBe(3)
    expect(out.day.passed).toBe(false)
  })

  it('通过后 attempts 上限仍是 3，passed 一旦为真就留着', () => {
    let store = emptyCheckin()
    for (let i = 0; i < 5; i += 1) {
      store = applyCheckinAttempt(store, { day, correct: 4, total: 4, threshold: 3, passed: true }, now + i).store
    }
    expect(store.days[day].attempts).toHaveLength(MAX_ATTEMPTS)
    expect(store.days[day].passed).toBe(true)
  })
})

describe('连续天数', () => {
  const at = (daysAgo: number) => now - daysAgo * 86_400_000

  it('从今天往前数，断了就停；历史最长留着', () => {
    let store: CheckinStore = emptyCheckin()
    for (const d of [0, 1, 2, 4, 5]) {
      const t = at(d)
      store = applyCheckinAttempt(store, { day: studyDayOf(t), correct: 4, total: 4, threshold: 3, passed: true }, t).store
    }
    const s = streakOf(store, now)
    expect(s.current).toBe(3)
    expect(s.best).toBe(3)
  })

  it('今天还没打、昨天打了：连续不断（凌晨看的是同一天）', () => {
    const t = at(1)
    const store = applyCheckinAttempt(emptyCheckin(), { day: studyDayOf(t), correct: 4, total: 4, threshold: 3, passed: true }, t).store
    expect(streakOf(store, now).current).toBe(1)
  })

  it('前天打的、昨天断了：连续归零', () => {
    const t = at(2)
    const store = applyCheckinAttempt(emptyCheckin(), { day: studyDayOf(t), correct: 4, total: 4, threshold: 3, passed: true }, t).store
    expect(streakOf(store, now).current).toBe(0)
    expect(streakOf(store, now).best).toBe(1)
  })
})

describe('日历', () => {
  const at = (daysAgo: number) => now - daysAgo * 86_400_000

  it('连续 4 周、最后一个是今天；过/没过/没动三种状态都认得出来', () => {
    let store: CheckinStore = emptyCheckin()
    store = applyCheckinAttempt(store, { day: studyDayOf(at(1)), correct: 4, total: 4, threshold: 3, passed: true }, at(1)).store
    store = applyCheckinAttempt(store, { day: studyDayOf(at(2)), correct: 1, total: 4, threshold: 3, passed: false }, at(2)).store
    const cells = checkinCalendar(store, now)
    expect(cells).toHaveLength(CALENDAR_DAYS)
    expect(cells[cells.length - 1].today).toBe(true)
    expect(cells[cells.length - 1].day).toBe(day)
    expect(cells[cells.length - 2].state).toBe('passed')
    expect(cells[cells.length - 3].state).toBe('failed')
    expect(cells[cells.length - 4].state).toBe('none')
    expect(calendarLabel(cells)).toMatch(/^\d{4} 年 \d{1,2} 月$/)
  })
})

describe('试卷通道：首次考试及格自动打卡', () => {
  it('及格了：exam 记录写上、当天算打过、连续天数跟着涨（不占出题通道的机会）', () => {
    const out = applyExamCheckin(emptyCheckin(), {
      day,
      at: now,
      title: '导数第一次测验',
      score: 72,
      total: 100,
    })
    expect(out.ok).toBe(true)
    expect(out.day.passed).toBe(true)
    expect(out.day.exam).toMatchObject({ title: '导数第一次测验', score: 72, total: 100, at: now })
    // 出题通道的 attempts 一条不动：两条通道互不侵占
    expect(out.day.attempts).toHaveLength(0)
    expect(streakOf(out.store, now).current).toBe(1)
    // 60% 是及格线：正好压线也算过
    const edge = applyExamCheckin(emptyCheckin(), { day, at: now, title: '压线', score: 60, total: 100 })
    expect(edge.ok).toBe(true)
  })

  it('没到及格线：不记账，理由说得清', () => {
    const out = applyExamCheckin(emptyCheckin(), { day, at: now, title: '考砸了', score: 59, total: 100 })
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('及格线')
    expect(out.store.days[day]).toBeUndefined()
  })

  it('今天已经打过卡：不再重复记', () => {
    const first = applyExamCheckin(emptyCheckin(), { day, at: now, title: '卷一', score: 90, total: 100 })
    const again = applyExamCheckin(first.store, { day, at: now + 1, title: '卷二', score: 95, total: 100 })
    expect(again.ok).toBe(false)
    expect(again.store.days[day].exam?.title).toBe('卷一')
  })

  it('读回：exam 字段与 passed/at 一起活着回来（normalize 的白名单要认得它）', () => {
    const out = applyExamCheckin(emptyCheckin(), { day, at: now, title: '导数第一次测验', score: 85, total: 100 })
    const back = normalizeCheckin(JSON.parse(JSON.stringify(out.store)))
    expect(back.days[day].passed).toBe(true)
    expect(back.days[day].at).toBe(now)
    expect(back.days[day].exam).toEqual(out.store.days[day].exam)
  })
})
