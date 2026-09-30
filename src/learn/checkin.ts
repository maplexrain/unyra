/**
 * 打卡（checkin）：**用出题验证过的学习**，不是点一下签到。
 *
 * 规则（需求定死的部分）：
 * - 一天最多 3 次机会（首次 + 2 次重试）；
 * - 出题只能来自**今天有效阅读覆盖到的内容**——这条同时堵住两个作弊方向：
 *   刷时长的人答不出题，想纯签到的人没有题可出；
 * - 门槛由导师定（答对几题算过），但比率有下限，不许把门槛放到白菜价；
 * - 连续天数从学习日账本派生，不另存一份（两份必然分家）。
 *
 * 这个文件里没有「出题」也没有「判分」：出题由 agent 用阅读记录里的节做，
 * 判分由 agent 出题时自带的答案做，然后回来 report 一次结果（见 api.checkin.settle）。
 * 我们只负责三件事：能不能打卡、记下这一次的结果、算出连续多少天。
 */

import { SECTION_REACHED, readingDay, sessionsOf, studyDayOf, type ReadingRow, type ReadingStore } from './reading'
import { clamp, num } from '../lib/num'
import { t } from '../i18n'

/** 一天几次机会：首次 + 2 次重试 */
export const MAX_ATTEMPTS = 3
/** 当天有效阅读的下限：不够就别出题了（题会又空又虚） */
export const MIN_DAY_MS = 15 * 60_000

/**
 * 「还差多久」的写法：一分钟以上按分钟说，不到一分钟精确到秒。
 *
 * 为什么要到秒：这个数字现在每秒都在往下走，而打卡常常就卡在最后这几十秒——
 * 显示「还差 1 分钟」然后三十秒后才变，用户只会以为它坏了。
 */
export function remainingText(ms: number): string {
  const left = Math.max(0, ms)
  if (left >= 60_000) return t('{0} 分钟', Math.ceil(left / 60_000))
  return t('{0} 秒', Math.ceil(left / 1000))
}
/** 出题材料的下限：至少要有两节真正读到的内容 */
export const MIN_SOURCES = 2
/** 题目数量的上下限 */
export const MIN_QUESTIONS = 3
export const MAX_QUESTIONS = 6
/** 门槛比率的范围：0.6 是底线，不许再低 */
export const MIN_RATIO = 0.6
export const DEFAULT_RATIO = 0.75
/** 顶栏日历显示多少个学习日（4 周刚好铺满 7 列） */
export const CALENDAR_DAYS = 28

export interface CheckinAttempt {
  at: number
  correct: number
  total: number
  /** 这次要求答对几题（绝对题数，= ceil(total * ratio)） */
  threshold: number
  passed: boolean
  note?: string
  /** 这次出题覆盖了哪些节点 */
  nodeIds?: string[]
  /** 这次出题覆盖了哪些节（key），供「同一批内容别重复考」与复盘 */
  sectionKeys?: string[]
}

export interface CheckinDay {
  day: string
  passed: boolean
  /** 通过的时刻 */
  at?: number
  attempts: CheckinAttempt[]
  /**
   * 试卷通道：今天的打卡由哪张试卷的**首次考试**及格带来（见 applyExamCheckin）。
   *
   * 为什么不塞进 attempts：那个数组带着「出题通道」的假设——一天最多 3 次、
   * correct/total 是题数量级（写入与读回都按它夹）。考试的分数与满分是另一个量级，
   * 混进去会被夹坏；而且考试及格不该占掉出题的重试机会。两条通道各记各的。
   */
  exam?: { at: number; title: string; score: number; total: number }
}

export interface CheckinStore {
  version: number
  days: Record<string, CheckinDay>
  /** 历史最长连续天数：断了之后当前连续会归零，这个数留着 */
  best?: number
}

export function emptyCheckin(): CheckinStore {
  return { version: 1, days: {}, best: 0 }
}

/**
 * **按目标分开**的打卡账本：目标 id → 那个目标的账（见 learn/types 的 LearnStore.checkin）。
 *
 * 与阅读账本同一个理由（见 learn/reading 的 ReadingBook）：打卡是「今天这门课学了没」，
 * 学两门课就该有两条连续天数、两道门槛。账本按目标落在各自目录（`{目标}/checkin.json`），
 * 删目标即随之消失。
 */
export interface CheckinBook {
  byGoal: Record<string, CheckinStore>
}

/** 某个目标的打卡账；没有就是 undefined（读的地方按 `?? emptyCheckin()` 兜底） */
export function checkinOfGoal(book: CheckinBook | undefined, goalId: string): CheckinStore | undefined {
  return goalId ? book?.byGoal?.[goalId] : undefined
}

/** 写回某个目标的那一份（其它目标原样不动） */
export function withGoalCheckin(book: CheckinBook | undefined, goalId: string, next: CheckinStore): CheckinBook {
  return { byGoal: { ...(book?.byGoal ?? {}), [goalId]: next } }
}

export function checkinDay(store: CheckinStore | undefined, day: string): CheckinDay | undefined {
  return store?.days[day]
}

/** 当天还剩几次机会 */
export function chancesLeft(store: CheckinStore | undefined, day: string): number {
  const attempts = checkinDay(store, day)?.attempts.length ?? 0
  return Math.max(0, MAX_ATTEMPTS - attempts)
}

/** 出题的题源：今天真正读到过的节（按节点分组） */
export interface CheckinSource {
  nodeId: string
  title: string
  doc: string
  key: string
  text: string
  /** 当天在这一节上花的时间（毫秒）与覆盖比例 */
  ms: number
  reach: number
}

export interface CheckinEligibility {
  ok: boolean
  /** 不能打卡的原因（能打卡时为 undefined） */
  reason?: string
  day: string
  /** 当天有效阅读毫秒 */
  activeMs: number
  requiredMs: number
  chancesLeft: number
  /** 建议的题目数量（3~6） */
  suggestQuestions: number
  /** 建议的通过门槛（绝对题数） */
  suggestThreshold: number
  sources: CheckinSource[]
  /** 今天读过的节点概览（导师出题时心里有数） */
  rows: ReadingRow[]
}

/**
 * 今天能不能打卡、要考什么。
 *
 * 注意 reason 的措辞：它是**给用户看**的（顶栏 tip 里就显示这一句），
 * 所以要说「还差什么」，不要写「不符合条件」。
 */
export function checkinEligible(
  /** 这个目标的阅读账（见 learn/reading 的 ReadingBook） */
  reading: ReadingStore | undefined,
  /** 这个目标的打卡账 */
  checkin: CheckinStore | undefined,
  opts: {
    now?: number
    titleOf?: (nodeId: string) => string | undefined
    /**
     * 还没写进 store 的那一段有效阅读（毫秒）。
     *
     * 为什么要留这个口子：store 每 30 秒才结算一次，而顶栏那个「还差多久」要每秒都在动。
     * 判定本身仍然只认 store——真把关在 checkin.settle；这里补进来的只是**显示**，
     * 让「读够了」与「能打卡」在同一秒里成立。
     */
    extraMs?: number
  } = {},
): CheckinEligibility {
  const now = opts.now ?? Date.now()
  const day = studyDayOf(now)
  const titleOf = opts.titleOf ?? ((id: string) => id)
  const activeMs = (readingDay(reading, day)?.activeMs ?? 0) + Math.max(0, opts.extraMs ?? 0)
  const chances = chancesLeft(checkin, day)
  const passed = !!checkinDay(checkin, day)?.passed

  const sources: CheckinSource[] = []
  const byNode = new Map<string, number>()
  const dayStart = now - 86_400_000
  for (const s of sessionsOf(reading, { since: dayStart })) {
    if (s.day !== day) continue
    for (const sec of s.sections) {
      if (sec.reach < SECTION_REACHED) continue
      if (sec.ms <= 0 && !sec.marks.length) continue
      sources.push({
        nodeId: s.nodeId,
        title: titleOf(s.nodeId) ?? s.nodeId,
        doc: s.doc,
        key: sec.key,
        text: sec.text,
        ms: sec.ms,
        reach: sec.reach,
      })
      byNode.set(s.nodeId, (byNode.get(s.nodeId) ?? 0) + 1)
    }
  }
  // 同一个节可能被多场会话重复登记（同一场里也只是加了两次时长）——按节点+节去重
  const seen = new Set<string>()
  const unique = sources.filter((s) => {
    const k = s.nodeId + '\u0001' + s.key
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const total = clamp(Math.round(unique.length), MIN_QUESTIONS, MAX_QUESTIONS)
  const threshold = Math.max(1, Math.ceil(total * DEFAULT_RATIO))

  const base = {
    day,
    activeMs,
    requiredMs: MIN_DAY_MS,
    chancesLeft: chances,
    suggestQuestions: total,
    suggestThreshold: threshold,
    sources: unique,
    rows: [],
  }
  if (passed) return { ...base, ok: false, reason: t('今天已经打过卡了') }
  if (chances <= 0) return { ...base, ok: false, reason: t('今天的机会用完了，明天再来') }
  if (activeMs < MIN_DAY_MS) {
    return { ...base, ok: false, reason: t('今天的有效阅读还差 {0}', remainingText(MIN_DAY_MS - activeMs)) }
  }
  if (unique.length < MIN_SOURCES) {
    return { ...base, ok: false, reason: t('今天读到的东西还太少，出不了题（至少读透两节）') }
  }
  return { ...base, ok: true }
}

/**
 * 记一次打卡结果。
 *
 * 校验放在这里而不是信 agent：题目数量、门槛比率、机会次数都要过一遍，
 * 不合格就原样返回并说明原因（agent 会看到那句话，可以改）。
 * 通过时顺带把连续天数的最佳值刷新——它在 CheckinStore 里是唯一被冗余存储的数，
 * 因为「历史最长」在明细被清掉之后就无法重算了。
 */
export function applyCheckinAttempt(
  store: CheckinStore,
  input: {
    day: string
    correct: number
    total: number
    threshold: number
    passed: boolean
    note?: string
    nodeIds?: string[]
    sectionKeys?: string[]
  },
  now = Date.now(),
): { store: CheckinStore; ok: boolean; reason?: string; day: CheckinDay } {
  const day = store.days[input.day] ?? { day: input.day, passed: false, attempts: [] }
  const total = clamp(Math.round(input.total), 1, 20)
  const correct = clamp(Math.round(input.correct), 0, total)
  const minThreshold = Math.ceil(total * MIN_RATIO)
  const threshold = clamp(Math.round(input.threshold) || minThreshold, minThreshold, total)
  // 通过与否由我们按门槛判一遍：agent 说「过了」但没到门槛时以我们为准
  const passed = input.passed && correct >= threshold
  const attempt: CheckinAttempt = {
    at: now,
    correct,
    total,
    threshold,
    passed,
    ...(input.note ? { note: input.note.slice(0, 300) } : {}),
    ...(input.nodeIds?.length ? { nodeIds: input.nodeIds.slice(0, 8) } : {}),
    ...(input.sectionKeys?.length ? { sectionKeys: input.sectionKeys.slice(0, 40) } : {}),
  }
  const nextDay: CheckinDay = {
    day: input.day,
    passed: day.passed || passed,
    ...(day.passed || passed ? { at: day.at ?? now } : {}),
    attempts: [...day.attempts, attempt].slice(0, MAX_ATTEMPTS),
  }
  const days = { ...store.days, [input.day]: nextDay }
  const current = streakOf({ ...store, days }, now).current
  return {
    store: { version: store.version, days, best: Math.max(store.best ?? 0, current) },
    ok: true,
    day: nextDay,
  }
}

/**
 * 打卡的另一种方式（需求）：这个目标的试卷**第一次考试**就达到及格线（卷面 ≥ 60%），
 * 今天自动打卡——「用出题验证过的学习」不只有导师出题一条路，系统判分的卷子同样是证据。
 *
 * 与 applyCheckinAttempt 分开成两个入口的理由：出题通道的 attempts 数组带着
 * 「一天 3 次、题数量级」的假设（写入与读回都按它夹），考试的分数与满分是另一个量级，
 * 混进去会被夹坏。所以试卷通道单独记在 CheckinDay.exam 上，与出题的重试机会互不侵占。
 *
 * 调用方（learn/graph 的 applyGradeResult）负责「是这份卷子的第一次考试」与
 * 「今天还没打过」这两条前置；这里只复核及格线——分数不够就不记账，理由回给调用方。
 */
export function applyExamCheckin(
  store: CheckinStore,
  input: { day: string; at: number; title: string; score: number; total: number },
): { store: CheckinStore; ok: boolean; reason?: string; day: CheckinDay } {
  const day = store.days[input.day] ?? { day: input.day, passed: false, attempts: [] }
  if (day.passed) return { store, ok: false, reason: t('今天已经打过卡了'), day }
  const total = clamp(Math.round(input.total), 1, 10_000)
  const score = clamp(Math.round(input.score), 0, total)
  const threshold = Math.max(1, Math.ceil(total * MIN_RATIO))
  if (score < threshold) return { store, ok: false, reason: '没到及格线（' + score + '/' + total + '）', day }
  const nextDay: CheckinDay = {
    day: input.day,
    passed: true,
    at: day.at ?? input.at,
    attempts: day.attempts,
    exam: {
      at: input.at,
      title: input.title.slice(0, 80),
      score,
      total,
    },
  }
  const days = { ...store.days, [input.day]: nextDay }
  const current = streakOf({ ...store, days }, input.at).current
  return {
    store: { version: store.version, days, best: Math.max(store.best ?? 0, current) },
    ok: true,
    day: nextDay,
  }
}

/** 连续打卡天数：从今天（或昨天）往前数，中间断了就停 */
export function streakOf(
  store: CheckinStore | undefined,
  now = Date.now(),
): { current: number; best: number; days: CheckinDay[] } {
  const days = store?.days ?? {}
  const passedDays = Object.values(days)
    .filter((d) => d.passed)
    .sort((a, b) => (a.day < b.day ? 1 : -1))
  const today = studyDayOf(now)
  const yesterday = studyDayOf(now - 86_400_000)
  let current = 0
  if (days[today]?.passed || days[yesterday]?.passed) {
    let probe = days[today]?.passed ? now : now - 86_400_000
    for (let i = 0; i < 400; i += 1) {
      const day = studyDayOf(probe)
      if (!days[day]?.passed) break
      current += 1
      probe -= 86_400_000
    }
  }
  return { current, best: Math.max(store?.best ?? 0, current), days: passedDays }
}

export interface CheckinCalendarCell {
  day: string
  /** 日期数字（日历格子上显示的那个） */
  label: number
  state: 'passed' | 'failed' | 'none'
  today?: boolean
}

/**
 * 顶栏日历的数据：连续 span 个学习日（早 → 晚，最后一个是今天）。
 * 只给「过了 / 试过没过 / 没动」，不把有效阅读时长画进去——
 * 日历是打卡的账本，阅读时长在别的面板里说。
 */
export function checkinCalendar(
  store: CheckinStore | undefined,
  now = Date.now(),
  span = CALENDAR_DAYS,
): CheckinCalendarCell[] {
  const today = studyDayOf(now)
  const out: CheckinCalendarCell[] = []
  for (let i = span - 1; i >= 0; i -= 1) {
    const day = studyDayOf(now - i * 86_400_000)
    const rec = store?.days[day]
    const state: CheckinCalendarCell['state'] = rec?.passed
      ? 'passed'
      : rec?.attempts?.length
        ? 'failed'
        : 'none'
    out.push({ day, label: Number(day.slice(8, 10)), state, ...(day === today ? { today: true } : {}) })
  }
  return out
}

/** 日历标题（如「2026 年 9 月」）：按最后一个格子的月份来，跨月时用户也看得懂 */
export function calendarLabel(cells: CheckinCalendarCell[]): string {
  const last = cells[cells.length - 1]?.day ?? studyDayOf(Date.now())
  return t('{0} 年 {1} 月', last.slice(0, 4), Number(last.slice(5, 7)))
}

/* ---------- 落盘数据的校验 ---------- */

/**
 * 读回**按目标**的打卡账本（见 CheckinBook）：目标没了的整本丢掉，空账本不进内存
 * （与 learn/reading 的 normalizeReadingBook 同一条纪律）。
 */
export function normalizeCheckinBook(raw: unknown, aliveGoals: Set<string>): CheckinBook {
  const byGoal: Record<string, CheckinStore> = {}
  const src = raw && typeof raw === 'object' ? (raw as { byGoal?: unknown }).byGoal : null
  if (!src || typeof src !== 'object') return { byGoal }
  for (const [goalId, one] of Object.entries(src as Record<string, unknown>)) {
    if (!goalId || !aliveGoals.has(goalId)) continue
    const rec = normalizeCheckin(one)
    if (Object.keys(rec.days).length) byGoal[goalId] = rec
  }
  return { byGoal }
}

/** 从磁盘读回打卡账本；题目数量、门槛、机会次数都按现行规则重新夹一遍 */
export function normalizeCheckin(raw: unknown): CheckinStore {
  const out = emptyCheckin()
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  const days = r.days && typeof r.days === 'object' ? (r.days as Record<string, unknown>) : {}
  for (const [day, d] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !d || typeof d !== 'object') continue
    const dr = d as Record<string, unknown>
    const attempts: CheckinAttempt[] = []
    if (Array.isArray(dr.attempts)) {
      for (const a of dr.attempts.slice(0, MAX_ATTEMPTS)) {
        if (!a || typeof a !== 'object') continue
        const ar = a as Record<string, unknown>
        const total = clamp(num(ar.total), 1, 20)
        const correct = clamp(num(ar.correct), 0, total)
        const threshold = clamp(num(ar.threshold) || Math.ceil(total * MIN_RATIO), Math.ceil(total * MIN_RATIO), total)
        attempts.push({
          at: num(ar.at),
          correct,
          total,
          threshold,
          passed: ar.passed === true && correct >= threshold,
          ...(typeof ar.note === 'string' ? { note: ar.note.slice(0, 300) } : {}),
          ...(Array.isArray(ar.nodeIds) ? { nodeIds: ar.nodeIds.filter((x): x is string => typeof x === 'string').slice(0, 8) } : {}),
          ...(Array.isArray(ar.sectionKeys) ? { sectionKeys: ar.sectionKeys.filter((x): x is string => typeof x === 'string').slice(0, 40) } : {}),
        })
      }
    }
    // 试卷通道（applyExamCheckin 写的）：分数与满分是卷面的量级，不走出题通道那套夹取
    const examRaw = dr.exam && typeof dr.exam === 'object' ? (dr.exam as Record<string, unknown>) : null
    let exam: CheckinDay['exam'] | undefined
    if (examRaw) {
      const total = clamp(Math.round(num(examRaw.total)), 1, 10_000)
      exam = {
        at: num(examRaw.at),
        title: typeof examRaw.title === 'string' ? examRaw.title.slice(0, 80) : '',
        score: clamp(Math.round(num(examRaw.score)), 0, total),
        total,
      }
    }
    const passed = dr.passed === true || attempts.some((a) => a.passed) || !!exam
    out.days[day] = {
      day,
      passed,
      ...(passed ? { at: num(dr.at) || attempts.find((a) => a.passed)?.at || exam?.at || 0 } : {}),
      attempts,
      ...(exam ? { exam } : {}),
    }
  }
  out.best = num(r.best)
  return out
}
