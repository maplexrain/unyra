/**
 * 采集器的闸门：**什么时候才计时**。
 *
 * 为什么要直接驱动 ReadingTracker：这些时序在界面上点不出来（切回来、在对话栏打字、
 * 导师栏抢主位、AI 写完、宽限用完、静默超时），而它的每个方法都收 now——于是可以拿假时钟
 * 一秒一秒地推，断言「这一段到底算进去多少毫秒」。
 * 规则的总口径见 docs/reading-and-checkin.md，采集与落盘的细节见 docs/reading-mechanism.md：
 *
 * - 表只在最近一次交互发生在**文档区里**、且离现在不到 IDLE_MS 时走；
 * - 打开 / 切到这份文档、文档切回主位：给 RESUME_GRACE_MS 宽限，宽限里没交互就停；
 * - 从别的应用切回来：不给宽限，必须有一次文档区交互；
 * - 文档不在中间主位（导师栏占着）：一律不算，窄栏里的交互也不作数。
 *
 * 停表有**两条命**：pause（这会儿没法读）与 waiting（看不出在读），两条都得能解除——
 * 「AI 写完文档之后」「切走页签又切回来之后」曾经卡在 pause 上，怎么滚都不再计时，
 * 所以下面专门盯着这两种回来的路。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IDLE_MS, RESUME_GRACE_MS, type ReadingDelta } from '../src/learn/reading'
import { ReadingTracker } from '../src/learn/useReadingTracker'

const SEC = 1000
const MIN = 60 * SEC
/** 用例的起点：把时钟钉死在这一刻，每一拍的 dt 才是整 1000 毫秒 */
const T0 = new Date(2026, 8, 22, 10, 0).getTime()

/*
 * 只冻 Date（不冻定时器）：采集器内部读时钟的地方只有构造器那几处，
 * 冻住之后「推 N 拍 = 正好 N 秒」，断言才写得成整数而不是「大约」。
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.useRealTimers()
})

/** 一份够用的假几何：一整篇没有标题的正文（measure 会给它一个「开头」节，时间才归得了账） */
function fakeDom(): { body: () => HTMLElement; scroll: () => HTMLElement } {
  const rect = { top: 0 }
  const scroll = { scrollTop: 0, clientHeight: 400, getBoundingClientRect: () => rect } as unknown as HTMLElement
  const body = {
    scrollHeight: 2000,
    getBoundingClientRect: () => rect,
    querySelectorAll: () => [],
  } as unknown as HTMLElement
  return { body: () => body, scroll: () => scroll }
}

function tracker(over: { knownToday?: () => boolean } = {}) {
  const deltas: ReadingDelta[] = []
  const dom = fakeDom()
  const t = new ReadingTracker({
    nodeId: 'n1',
    goalId: 'g1',
    doc: 'teaching',
    body: dom.body,
    scroll: dom.scroll,
    // 今天已经读过：不走 20 秒热身门槛，用例只盯新的闸门
    knownToday: over.knownToday ?? (() => true),
    onDelta: (d) => deltas.push(d),
  })
  // 「打开这份文档」：宽限从这一刻算起（构造里那次用的是真实时钟，这里把起点钉死）
  t.startGrace(T0)
  return { t, deltas }
}

/** 文档能读 / 不能读的三个开关（与 useReadingTracker 的 effect 同一个入口） */
const readable = (t: ReadingTracker, over: Partial<{ main: boolean; active: boolean; busy: boolean }>, now: number) =>
  t.setReadable({ main: true, active: true, busy: false, ...over }, now)

/**
 * 从 T0 起逐秒推 to 毫秒，在第 N 秒做一件事（**先走完这一拍再动作**：这一秒里发生了交互，
 * 这一秒就该算）。秒要连着走：跳过几秒再推，采集器会把那一跳当成「合盖睡过去了」而不计时。
 */
function run(t: ReadingTracker, to: number, at: Record<number, (now: number) => void> = {}): void {
  for (let now = T0 + SEC; now <= T0 + to; now += SEC) {
    t.beat(now)
    at[(now - T0) / SEC]?.(now)
  }
}

/** 结算到此刻，返回这一场一共算进去多少毫秒 */
function counted(t: ReadingTracker, deltas: ReadingDelta[], at: number): number {
  t.settle(at, true)
  return deltas.reduce((n, d) => n + d.activeMs, 0)
}

const kindsOf = (deltas: ReadingDelta[]): string[] => deltas.flatMap((d) => d.breaks).map((b) => b.kind)

describe('什么时候才计时', () => {
  it('刚打开就有 20 秒宽限；宽限里一次交互都没有，到点就停', () => {
    const { t, deltas } = tracker()
    run(t, MIN)
    expect(counted(t, deltas, T0 + MIN)).toBe(RESUME_GRACE_MS)
  })

  it('宽限里滚一下：证据续到 60 秒后，之后静默才停', () => {
    const { t, deltas } = tracker()
    run(t, 2 * MIN, { 10: (now) => t.docActive(now) })
    // 前 10 秒 + 交互之后的 60 秒
    expect(counted(t, deltas, T0 + 2 * MIN)).toBe(10 * SEC + IDLE_MS)
  })

  it('在对话栏打字：立刻停表，记成「不在读」而不是被打断', () => {
    const { t, deltas } = tracker()
    run(t, 2 * MIN, { 5: (now) => t.aside(now) })
    expect(counted(t, deltas, T0 + 2 * MIN)).toBe(5 * SEC)
    // away：不算 fragmentation，也不算 stalls（见 learn/attention）
    expect(kindsOf(deltas)).toEqual(['away'])
  })

  it('打完字回文档区：一次交互就接着走', () => {
    const { t, deltas } = tracker()
    run(t, 40 * SEC, { 5: (now) => t.aside(now), 30: (now) => t.docActive(now) })
    expect(counted(t, deltas, T0 + 40 * SEC)).toBe(5 * SEC + 10 * SEC)
  })

  it('从别的应用切回来：不接着算，要一次文档区交互（这就是过去白送的那段）', () => {
    const { t, deltas } = tracker()
    run(t, 50 * SEC, {
      5: (now) => t.suspend('blur', now),
      20: (now) => t.wake(now),
    })
    expect(counted(t, deltas, T0 + 50 * SEC)).toBe(5 * SEC)
    // 失焦那一段照旧算「被打断」，回来后等交互那段是 away
    expect(kindsOf(deltas)).toEqual(['blur', 'away'])
  })

  it('静默超时记成 idle（中性事实），不是 away', () => {
    const { t, deltas } = tracker()
    run(t, 2 * MIN, { 5: (now) => t.docActive(now) })
    expect(counted(t, deltas, T0 + 2 * MIN)).toBe(5 * SEC + IDLE_MS)
    expect(kindsOf(deltas)).toEqual(['idle'])
  })

  it('导师栏抢了主位：一律不算，窄栏里的滚动也不作数；切回主位再给 20 秒宽限', () => {
    const { t, deltas } = tracker()
    run(t, 2 * MIN, {
      5: (now) => readable(t, { main: false }, now),
      // 窄栏里滚动：不作数（它不该把表重新点着）
      20: (now) => t.docActive(now),
      60: (now) => readable(t, {}, now),
    })
    expect(counted(t, deltas, T0 + 2 * MIN)).toBe(5 * SEC + RESUME_GRACE_MS)
  })

  it('主位被抢走又还回来：文档区里的交互照旧作数（主位标志曾经没被重新点亮）', () => {
    const { t, deltas } = tracker()
    run(t, 45 * SEC, {
      5: (now) => readable(t, { main: false }, now),
      30: (now) => readable(t, {}, now),
      35: (now) => t.docActive(now),
    })
    // 开头 5 秒 + 还回来之后的 15 秒（宽限里 5 秒 + 交互续期后 10 秒）
    expect(counted(t, deltas, T0 + 45 * SEC)).toBe(20 * SEC)
    expect(kindsOf(deltas)).toEqual(['away'])
  })

  it('AI 写完这份文档之后：停表要解除，交互照旧作数（曾经卡在 pause 上）', () => {
    const { t, deltas } = tracker()
    run(t, 35 * SEC, {
      5: (now) => readable(t, { busy: true }, now),
      20: (now) => readable(t, {}, now),
      25: (now) => t.docActive(now),
    })
    expect(counted(t, deltas, T0 + 35 * SEC)).toBe(20 * SEC)
    // 写文档那一段既不算打断也不算卡住，只停表
    expect(kindsOf(deltas)).toEqual(['write'])
  })

  it('切走页签再切回来：同一条路，回来后交互仍作数，而且算「被打断」', () => {
    const { t, deltas } = tracker()
    run(t, 35 * SEC, {
      5: (now) => readable(t, { active: false }, now),
      20: (now) => readable(t, {}, now),
      25: (now) => t.docActive(now),
    })
    expect(counted(t, deltas, T0 + 35 * SEC)).toBe(20 * SEC)
    expect(kindsOf(deltas)).toEqual(['tab'])
  })

  it('今天第一次打开的文档：宽限算不出数——热身门槛本来就要一次交互', () => {
    const { t, deltas } = tracker({ knownToday: () => false })
    run(t, MIN)
    expect(counted(t, deltas, T0 + MIN)).toBe(0)
  })
})
