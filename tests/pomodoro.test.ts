/**
 * 番茄钟的单元用例。
 *
 * 钉的是换成「纯计时器」之后定死的那几条：
 * 专注 → 休息 → 专注（休息 = 专注的 1/5）、**只能停不能暂停**、
 * **只有跑完的专注段才记账**（休息与半途停掉的不算）、切屏照走（时间只认墙上时钟）、
 * agent 只能读（api 面只剩 pomodoro.status，这一条由 scripts/agent-ops.test.ts 钉）。
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FOCUS_MINUTES,
  DEFAULT_GROUPS,
  LATE_GRACE_MS,
  MAX_FOCUS_MINUTES,
  MAX_GROUPS,
  MIN_FOCUS_MINUTES,
  emptyPomodoro,
  formatClock,
  normalizePomodoro,
  phaseMsOf,
  pomodoroDays,
  pomodoroStatus,
  remainingMsOf,
  restMsOf,
  startPomodoro,
  stopPomodoro,
  tickPomodoro,
} from '../src/learn/pomodoro'
import { studyDayOf } from '../src/learn/reading'

const MIN = 60_000
/** 2026-09-20 20:00（当地时间）：一整天都待在学习日 2026-09-20 里 */
const now = new Date(2026, 8, 20, 20, 0).getTime()
const begin = (focusMinutes = 25, groups = 3, at = now) =>
  startPomodoro(emptyPomodoro(), { focusMinutes, groups }, at).store

describe('开始：两个数就是全部设置', () => {
  it('默认 25 分钟 3 组，从第一组专注开始', () => {
    const { session } = startPomodoro(emptyPomodoro(), {}, now)
    expect(session.focusMinutes).toBe(DEFAULT_FOCUS_MINUTES)
    expect(session.groups).toBe(DEFAULT_GROUPS)
    expect([session.index, session.phase, session.phaseStartedAt]).toEqual([1, 'focus', now])
  })

  it('两个数都夹在量程里（滑块给不出界外值，读写盘与 agent 给得出）', () => {
    const low = startPomodoro(emptyPomodoro(), { focusMinutes: 5, groups: 0 }, now).session
    expect([low.focusMinutes, low.groups]).toEqual([MIN_FOCUS_MINUTES, 1])
    const high = startPomodoro(emptyPomodoro(), { focusMinutes: 999, groups: 99 }, now).session
    expect([high.focusMinutes, high.groups]).toEqual([MAX_FOCUS_MINUTES, MAX_GROUPS])
  })

  it('休息固定是专注的 1/5（不四舍五入到分钟）', () => {
    expect(restMsOf(25)).toBe(5 * MIN)
    expect(restMsOf(10)).toBe(2 * MIN)
    expect(restMsOf(90)).toBe(18 * MIN)
  })

  it('剩余时间按 phaseStartedAt 现算，不存秒表字段', () => {
    const { session } = startPomodoro(emptyPomodoro(), { focusMinutes: 25, groups: 3 }, now)
    expect(phaseMsOf(session)).toBe(25 * MIN)
    expect(remainingMsOf(session, now)).toBe(25 * MIN)
    expect(remainingMsOf(session, now + 5 * MIN)).toBe(20 * MIN)
    // 到点返回 0（不是负数）：界面据此收尾
    expect(remainingMsOf(session, now + 26 * MIN)).toBe(0)
  })
})

describe('收尾：专注 → 休息 → 专注，组数跑完就结束', () => {
  it('一组专注跑完：记一笔、翻到休息，组号不动', () => {
    const out = tickPomodoro(begin(), now + 25 * MIN)
    expect(out.records).toHaveLength(1)
    expect(out.records[0]).toMatchObject({ at: now + 25 * MIN, minutes: 25, index: 1, groups: 3 })
    expect(out.store.current).toMatchObject({ phase: 'rest', index: 1, phaseStartedAt: now + 25 * MIN })
    expect(out.store.log).toHaveLength(1)
    expect(out.finished).toBe(false)
    expect(out.dropped).toBe(false)
  })

  it('休息跑完回到下一组专注（休息不记账）', () => {
    const first = tickPomodoro(begin(), now + 25 * MIN).store
    const out = tickPomodoro(first, now + 30 * MIN)
    expect(out.records).toHaveLength(0)
    expect(out.store.log).toHaveLength(1)
    expect(out.store.current).toMatchObject({ phase: 'focus', index: 2, phaseStartedAt: now + 30 * MIN })
  })

  it('三组跑完：current 清空、finished，而且正好记三笔（休息不算）', () => {
    let store = begin(25, 3)
    let records = 0
    let finished = false
    // 端点：专注1 25、休息1 30、专注2 55、休息2 60、专注3 85（跑完即结束，后面没有休息）
    for (const m of [25, 30, 55, 60, 85]) {
      const out = tickPomodoro(store, now + m * MIN)
      store = out.store
      records += out.records.length
      finished = finished || out.finished
    }
    expect(records).toBe(3)
    expect(finished).toBe(true)
    expect(store.current).toBeNull()
    // log 一律「新 → 旧」
    expect(store.log.map((r) => [r.index, r.minutes])).toEqual([
      [3, 25],
      [2, 25],
      [1, 25],
    ])
  })

  it('还没到点：原样返回同一个 store（调用方据此决定不写盘）', () => {
    const store = begin()
    const out = tickPomodoro(store, now + 10 * MIN)
    expect(out.store).toBe(store)
    expect(out.records).toEqual([])
    expect(out.finished).toBe(false)
    expect(out.dropped).toBe(false)
  })

  it('切屏照走：中间一次 tick 都没有，到点那一下照样算数', () => {
    const out = tickPomodoro(begin(25, 1), now + 25 * MIN + 2_000)
    expect(out.records).toHaveLength(1)
    expect(out.finished).toBe(true)
  })

  it('晚得太多（应用当时不在）：整次会话丢掉，绝不写没发生过的 25 分钟', () => {
    const store = begin()
    const out = tickPomodoro(store, now + 25 * MIN + LATE_GRACE_MS + 1)
    expect(out.dropped).toBe(true)
    expect(out.records).toEqual([])
    expect(out.store.current).toBeNull()
    expect(out.store.log).toEqual([])
  })
})

describe('停止：这一段作废，重新开始就是重新算', () => {
  it('半途停掉的那一段不进 log', () => {
    const stopped = stopPomodoro(begin())
    expect(stopped.current).toBeNull()
    expect(stopped.log).toEqual([])
  })

  it('休息期间停：已经记下的那些留（跑完的专注段是事实）', () => {
    const store = tickPomodoro(begin(), now + 25 * MIN).store
    const stopped = stopPomodoro(store)
    expect(stopped.current).toBeNull()
    expect(stopped.log).toHaveLength(1)
  })

  it('重新开始：组号回到 1、起点是现在（没有「继续」这条路径）', () => {
    const stopped = stopPomodoro(begin(50, 4))
    const out = startPomodoro(stopped, { focusMinutes: 50, groups: 4 }, now + 10 * MIN)
    expect(out.session).toMatchObject({ index: 1, phase: 'focus', focusMinutes: 50, groups: 4, phaseStartedAt: now + 10 * MIN })
  })

  it('没在跑时停：原样返回同一个 store', () => {
    const store = emptyPomodoro()
    expect(stopPomodoro(store)).toBe(store)
  })
})

describe('读数：给界面，也给 agent', () => {
  it('今天几组多少分钟，以及「该收尾了」那个标记', () => {
    const out = tickPomodoro(begin(25, 3), now + 25 * MIN)
    const s = pomodoroStatus({ pomodoro: out.store }, now + 25 * MIN)
    expect([s.todayRounds, s.todayMinutes]).toEqual([1, 25])
    expect([s.over, s.remainingMs]).toEqual([false, 5 * MIN])
    // 休息也到点了：这一刻 over 为真，界面该来收尾
    const late = pomodoroStatus({ pomodoro: out.store }, now + 30 * MIN)
    expect([late.over, late.remainingMs]).toEqual([true, 0])
  })

  it('没在跑：remainingMs 与 phaseMs 都是 null', () => {
    const s = pomodoroStatus({ pomodoro: emptyPomodoro() }, now)
    expect([s.session, s.remainingMs, s.phaseMs, s.over]).toEqual([null, null, null, false])
  })

  it('归属按结束那一刻的学习日算（凌晨一点结束的算前一天）', () => {
    const late = new Date(2026, 8, 21, 0, 40).getTime()
    expect(studyDayOf(late)).toBe('2026-09-20')
    const store = startPomodoro(emptyPomodoro(), { focusMinutes: 25, groups: 1 }, late - 25 * MIN).store
    const out = tickPomodoro(store, late)
    expect(studyDayOf(out.records[0].at)).toBe('2026-09-20')
    expect(pomodoroStatus({ pomodoro: out.store }, late).todayRounds).toBe(1)
    expect(pomodoroStatus({ pomodoro: out.store }, late + 86_400_000).todayRounds).toBe(0)
  })

  it('最近七天：没跑的日子补零，今天在最前', () => {
    const out = tickPomodoro(begin(25, 2), now + 25 * MIN)
    const days = pomodoroDays({ pomodoro: out.store }, now + 25 * MIN, 7)
    expect(days).toHaveLength(7)
    expect(days[0]).toEqual({ day: studyDayOf(now), rounds: 1, minutes: 25 })
    expect(days.slice(1).every((d) => d.rounds === 0 && d.minutes === 0)).toBe(true)
  })
})

describe('落盘数据的校验', () => {
  it('旧结构（导师排计划那一版）一律丢掉：宁可从头攒，也不要假数据', () => {
    const back = normalizePomodoro({
      version: 1,
      plan: { createdAt: now, actions: [{ id: 'a1', title: '复习极限', minutes: 25 }] },
      current: { id: 'r1', actionId: 'a1', title: '复习极限', minutes: 25, startedAt: now, status: 'running' },
      log: [{ id: 'r0', actionId: 'a1', title: '复习极限', minutes: 25, startedAt: now, endedAt: now, status: 'done' }],
    })
    expect(back.current).toBeNull()
    expect(back.log).toEqual([])
  })

  it('正在跑的那一段活着回来（关掉应用再打开，计时接着走）', () => {
    // 跑完第一组专注之后正处在休息里（休息 5 分钟，从 25 分到 30 分）
    const store = tickPomodoro(begin(25, 3), now + 25 * MIN).store
    const back = normalizePomodoro(JSON.parse(JSON.stringify(store)))
    expect(back.current).toMatchObject({ phase: 'rest', index: 1, groups: 3, phaseStartedAt: now + 25 * MIN })
    expect(back.log).toHaveLength(1)
    expect(back.log[0]).toMatchObject({ minutes: 25, index: 1, groups: 3 })
  })

  it('坏数据不拖垮：起点读不出来就丢，越界的值夹回来', () => {
    expect(normalizePomodoro(null).current).toBeNull()
    expect(normalizePomodoro({ current: { startedAt: 0, phaseStartedAt: 0 } }).current).toBeNull()
    const back = normalizePomodoro({
      current: { startedAt: now, phaseStartedAt: now, focusMinutes: 999, groups: 99, index: 42, phase: 'x' },
    })
    expect(back.current).toMatchObject({ focusMinutes: MAX_FOCUS_MINUTES, groups: MAX_GROUPS, index: MAX_GROUPS, phase: 'focus' })
  })
})

describe('显示', () => {
  it('mm:ss 向上取整（还剩 0.6 秒也显示 1 秒），负数按 0', () => {
    expect(formatClock(25 * MIN)).toBe('25:00')
    expect(formatClock(59_400)).toBe('01:00')
    expect(formatClock(1)).toBe('00:01')
    expect(formatClock(-5)).toBe('00:00')
  })


})
