/**
 * 番茄钟（pomodoro）：**一个纯计时器**。
 *
 * 与上一版的分别（需求定的）：以前是「导师排一份行动清单，用户挑一条开始」；
 * 现在是一个自己会走的计时器——专注 → 休息 → 专注……组数跑完就结束。
 * 用户只设两个数：一段专注多长（10~90 分钟，默认 25）、一次做几组（1~6，默认 3）。
 * 休息不必设：它就是专注的 1/5（25 → 5 分钟）。
 *
 * 四条定死的规则，改这个文件之前先读一遍：
 *
 * 1. **用户手里只有「停」**。点停止这一段就作废（不记账）；要接着跑只能重新开始，
 *    而重新开始会**重新算**（新的一段、从第一组起）。暂停不是用户按出来的——
 *    它只属于严格专注的守卫（见 learn/focusGuard）：判定人不在屏幕前就自动暂停
 *    计时与监控，回来一交互自动续上。pausedAt 因此只有一个写入口（pausePomodoro），
 *    界面上没有「暂停」按钮。
 * 2. **只有完整的专注段才记账**，休息段不算，半途停掉的不算。一组 = 一段专注。
 * 3. **切屏照走**：它记的是「你按下了一个计时器」，不是「你真的在学」——后者是有效阅读
 *    （见 learn/reading）的事。所以这里没有可见性判断、没有静默超时，时间照走。
 * 4. **agent 只能读**（api.pomodoro.status）：计时器怎么走，是用户按的按钮说了算。
 *
 * 倒计时不进 store 的秒表字段：只存每一段的**起点**，剩余时间由 now 现算。
 * 于是刷新、切页签、关掉应用再打开，计时都不会错位；也正因为这样，收尾必须在
 * 「发现已经到点」的那一刻补上（见 tickPomodoro），而不是靠一个 setTimeout。
 */

import { studyDayOf } from './reading'
import { clamp, num } from '../lib/num'

/* ---------- 可调的那几个数 ---------- */

/** 一段专注的长度（分钟）：滑块的量程与默认值 */
export const MIN_FOCUS_MINUTES = 10
export const MAX_FOCUS_MINUTES = 90
export const DEFAULT_FOCUS_MINUTES = 25
/** 一次做几组 */
export const MIN_GROUPS = 1
export const MAX_GROUPS = 6
export const DEFAULT_GROUPS = 3
/**
 * 休息 = 专注 ÷ 5。
 *
 * 为什么不给第二个旋钮：25 分钟专注配 5 分钟休息是这套方法的内核比例，
 * 多一个滑块只会多一个「把休息调成 1 分钟」把自己练废的口子。
 */
export const REST_DIVISOR = 5
/**
 * 到点之后还容许多久来收尾。
 *
 * 这个数只为一件事存在：把「应用没在跑」与「应用在跑、只是这一拍晚了」分开。
 * 窗口藏在后台时 Chromium 会把定时器节流到一分钟一次，机器短睡眠也会拖几拍，
 * 所以容差不能比一分钟还紧；反过来，超过它就意味着**那段时间应用根本不在**——
 * 那段专注不可信，宁可整段丢掉（连这一次会话一起），也不往记录里写没发生过的 25 分钟。
 */
export const LATE_GRACE_MS = 5 * 60_000
/** 记录留多少条（够 agent 回溯最近这些天，又不至于让 state.json 无限长） */
export const MAX_LOG = 120

export type PomodoroPhase = 'focus' | 'rest'

/** 正在跑的那一次会话：只存「每段从哪一刻开始」，其余全靠 now 现算 */
export interface PomodoroSession {
  /** 这一次会话是什么时候开始的（第一段的起点） */
  startedAt: number
  /** 这一段专注多长（分钟）：整场会话都用它，休息按 REST_DIVISOR 折算 */
  focusMinutes: number
  /** 这一次打算做几组 */
  groups: number
  /** 现在是第几组（1 起） */
  index: number
  /** 现在是专注还是休息 */
  phase: PomodoroPhase
  /** 当前这一段的起点（进休息、进下一组时改写） */
  phaseStartedAt: number
  /**
   * 守卫判离开而暂停的那一刻（null = 在跑）。暂停期间剩余时间**冻结在这一刻**，
   * 恢复时把 phaseStartedAt 往后挪暂停的时长——计时不知道自己停过。
   */
  pausedAt?: number | null
}

/**
 * 一条已完成的专注记录。
 *
 * 为什么记 at（结束时刻）而不是开始时刻：学习日是按**结束**那一刻归属的——
 * 23:50 开始、00:15 结束的那一段算第二天，与阅读记录的归属口径一致（见 learn/reading）。
 */
export interface PomodoroRecord {
  at: number
  minutes: number
  index: number
  groups: number
}

export interface PomodoroStore {
  version: number
  current: PomodoroSession | null
  log: PomodoroRecord[]
}

export function emptyPomodoro(): PomodoroStore {
  return { version: 2, current: null, log: [] }
}

/* ---------- 纯计算：时长、剩余、标签 ---------- */

/** 休息多长（毫秒）：不四舍五入到分钟——10 分钟专注的休息是 2 分钟，90 分钟的是 18 分钟 */
export function restMsOf(focusMinutes: number): number {
  return Math.round((clampMinutes(focusMinutes) * 60_000) / REST_DIVISOR)
}

/** 当前这一段的长度（毫秒） */
export function phaseMsOf(session: PomodoroSession): number {
  return session.phase === 'focus' ? clampMinutes(session.focusMinutes) * 60_000 : restMsOf(session.focusMinutes)
}

/** 当前这一段该在什么时刻结束 */
export function phaseEndsAt(session: PomodoroSession): number {
  return session.phaseStartedAt + phaseMsOf(session)
}

/** 剩余毫秒（没在跑就是 null）；已经到点返回 0，由调用方决定收尾。暂停期间冻结在暂停那一刻 */
export function remainingMsOf(session: PomodoroSession | null, now = Date.now()): number | null {
  if (!session) return null
  const frozenAt = session.pausedAt ?? now
  return Math.max(0, phaseEndsAt(session) - frozenAt)
}

export function phaseLabel(phase: PomodoroPhase): string {
  return phase === 'focus' ? '专注' : '休息'
}

/**
 * 毫秒 → mm:ss（界面与提示词共用，免得两处各写一遍）。
 * 用 ceil 而不是 floor：还剩 1ms 时该显示 00:01，显示成 00:00 会让人以为已经到点。
 */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
}

/* ---------- 用户按下的那两个按钮 ---------- */

/**
 * 开始：**重新算**。
 *
 * 已经在跑的那一次直接丢掉（不记账）——「只能停、不能暂停」这条规则的必然结果：
 * 重新开始不是「继续」，是新的一次。
 */
export function startPomodoro(
  store: PomodoroStore,
  input: { focusMinutes?: number; groups?: number } = {},
  now = Date.now(),
): { store: PomodoroStore; session: PomodoroSession } {
  const session: PomodoroSession = {
    startedAt: now,
    focusMinutes: clampMinutes(input.focusMinutes),
    groups: clampGroups(input.groups),
    index: 1,
    phase: 'focus',
    phaseStartedAt: now,
  }
  return { store: { ...store, current: session }, session }
}

/** 停止：当前这一段作废（不记账），要接着跑只能重新开始 */
export function stopPomodoro(store: PomodoroStore): PomodoroStore {
  if (!store.current) return store
  return { ...store, current: null }
}

/**
 * 暂停：守卫判「人不在」时由运行时调（见文件头规则 1——用户界面上没有这个按钮）。
 * 没在跑、或已经在暂停里，原样返回同一个 store（调用方据此不写盘）。
 */
export function pausePomodoro(store: PomodoroStore, now = Date.now()): PomodoroStore {
  const current = store.current
  if (!current || current.pausedAt) return store
  return { ...store, current: { ...current, pausedAt: now } }
}

/**
 * 恢复：把这一段的起点往后挪暂停的时长，然后当什么都没发生过。
 * 没在暂停里就是空操作（同一个 store 原样返回）。
 */
export function resumePomodoro(store: PomodoroStore, now = Date.now()): PomodoroStore {
  const current = store.current
  if (!current?.pausedAt) return store
  const pausedFor = Math.max(0, now - current.pausedAt)
  return {
    ...store,
    current: { ...current, phaseStartedAt: current.phaseStartedAt + pausedFor, pausedAt: null },
  }
}

export interface PomodoroTick {
  store: PomodoroStore
  /** 这一次收尾记下的专注段（新 → 旧，与 log 同序） */
  records: PomodoroRecord[]
  /** 组数跑完了（会话自然结束） */
  finished: boolean
  /** 应用不在的那段时间把整次会话丢掉了（见 LATE_GRACE_MS） */
  dropped: boolean
}

/**
 * 到点收尾：**只在「已经过了这一段该结束的时刻」之后调用**（界面每秒发现一次）。
 *
 * 为什么一次调用要写成循环：一拍可能跨过好几个端点（机器睡了两分钟醒来、
 * 后台节流把一拍拖到一分钟）。循环让状态永远与墙上时钟对齐，而不是一次挪一格。
 * 但每一段都要单独过 LATE_GRACE_MS 那一关：晚了太多就说明应用当时不在，
 * 那一段不作数（整次会话一起收掉，免得留下一个「从 3 小时前开始跑」的会话）。
 *
 * 没有任何事发生时会原样返回同一个 store（对象身份不变）：调用方据此判断要不要 set，
 * 避免每秒往 store 里写一次同样的东西。
 */
export function tickPomodoro(store: PomodoroStore, now = Date.now(), graceMs = LATE_GRACE_MS): PomodoroTick {
  let current = store.current
  // 暂停中的会话不推进：倒计时冻结在 pausedAt，恢复时起点整体后挪（见 resumePomodoro）
  if (current?.pausedAt) return { store, records: [], finished: false, dropped: false }
  const done: PomodoroRecord[] = []
  let finished = false
  let dropped = false
  while (current) {
    const end = phaseEndsAt(current)
    if (now < end) break
    if (now - end > graceMs) {
      current = null
      dropped = true
      break
    }
    if (current.phase === 'focus') {
      done.push({ at: end, minutes: current.focusMinutes, index: current.index, groups: current.groups })
      if (current.index >= current.groups) {
        current = null
        finished = true
        break
      }
      current = { ...current, phase: 'rest', phaseStartedAt: end }
    } else {
      current = { ...current, phase: 'focus', index: current.index + 1, phaseStartedAt: end }
    }
  }
  /*
   * 什么都没动（还没到点）：原样返回**同一个** store，调用方据此判断不必写盘。
   * 判据必须是「current 有没有换过对象」而不是「有没有记下新的一段」——
   * 休息跑完翻到下一组专注时一笔记录都不产生，但那是一次实实在在的状态推进，
   * 按记录数提前返回会把它连同后面所有组一起吞掉（真写错过一次，用例钉住了）。
   */
  if (done.length === 0 && !dropped && current === store.current) {
    return { store, records: [], finished: false, dropped: false }
  }
  // 新记录排在最前：log 一律「新 → 旧」，与阅读会话的顺序口径一致
  const records = [...done].reverse()
  return {
    store: { ...store, current, log: records.length ? [...records, ...store.log].slice(0, MAX_LOG) : store.log },
    records,
    finished,
    dropped,
  }
}

/* ---------- 读数：给界面，也给 agent ---------- */

export interface PomodoroStatus {
  session: PomodoroSession | null
  /** 这一段的剩余毫秒（没在跑就是 null）；到点是 0，界面据此收尾 */
  remainingMs: number | null
  /** 这一段的长度（画进度条用）；没在跑就是 null */
  phaseMs: number | null
  /** 已经到点、还没收尾 */
  over: boolean
  /** 守卫判离开而暂停中（计时冻结，恢复等交互） */
  paused: boolean
  /** 今天完成了几组专注、共多少分钟 */
  todayRounds: number
  todayMinutes: number
}

export function pomodoroStatus(store: { pomodoro?: PomodoroStore }, now = Date.now()): PomodoroStatus {
  const p = store.pomodoro ?? emptyPomodoro()
  const session = p.current
  const remainingMs = remainingMsOf(session, now)
  const day = studyDayOf(now)
  const today = p.log.filter((r) => studyDayOf(r.at) === day)
  return {
    session,
    remainingMs,
    phaseMs: session ? phaseMsOf(session) : null,
    over: remainingMs !== null && remainingMs <= 0 && !session?.pausedAt,
    paused: !!session?.pausedAt,
    todayRounds: today.length,
    todayMinutes: today.reduce((n, r) => n + r.minutes, 0),
  }
}

/** 最近 n 天的汇总（含今天，新 → 旧）：agent 回答「我最近番茄钟怎么样」用它 */
export function pomodoroDays(
  store: { pomodoro?: PomodoroStore },
  now = Date.now(),
  days = 7,
): Array<{ day: string; rounds: number; minutes: number }> {
  const p = store.pomodoro ?? emptyPomodoro()
  const byDay = new Map<string, { rounds: number; minutes: number }>()
  for (const r of p.log) {
    const day = studyDayOf(r.at)
    const cur = byDay.get(day) ?? { rounds: 0, minutes: 0 }
    cur.rounds += 1
    cur.minutes += r.minutes
    byDay.set(day, cur)
  }
  const out: Array<{ day: string; rounds: number; minutes: number }> = []
  // 学习日的边界是凌晨 4 点（见 learn/reading），所以「往前一天」不能拿现在硬减 86_400_000：
  // 从**今天中午**往回退 n 天，那一刻必然落在前 n 个学习日里（中午离两头的边界都够远）。
  const noon = new Date(now)
  noon.setHours(12, 0, 0, 0)
  for (let i = 0; i < Math.max(1, days); i++) {
    const day = studyDayOf(noon.getTime() - i * 86_400_000)
    const hit = byDay.get(day) ?? { rounds: 0, minutes: 0 }
    out.push({ day, rounds: hit.rounds, minutes: hit.minutes })
  }
  return out
}

/* ---------- 落盘数据的校验 ---------- */

/**
 * 从磁盘读回番茄钟。
 *
 * **旧结构（导师排计划那一版：plan / actionId / title）一律丢掉**：
 * 那一版的一条记录是「导师排的行动跑完了」，语义与现在的「第几组专注」不是一回事，
 * 硬套过来只会得到一批 index=0、groups=0 的假数据。宁可从头攒。
 *
 * 正在跑的那一次**保留原样**（带着 phaseStartedAt）：剩余时间由 now 现算，
 * 于是关掉应用再打开，计时接着走；而它是不是「太久没管了」由 tickPomodoro 判。
 */
export function normalizePomodoro(raw: unknown): PomodoroStore {
  const out = emptyPomodoro()
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  out.current = normalizeSession(r.current)
  if (Array.isArray(r.log)) {
    for (const item of r.log.slice(0, MAX_LOG)) {
      const rec = normalizeRecord(item)
      if (rec) out.log.push(rec)
    }
  }
  return out
}

function normalizeSession(raw: unknown): PomodoroSession | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const groups = clampGroups(r.groups)
  const phase: PomodoroPhase = r.phase === 'rest' ? 'rest' : 'focus'
  const startedAt = num(r.startedAt)
  const phaseStartedAt = num(r.phaseStartedAt)
  // 起点是 0（读不出来）就整条丢掉：计时全靠它，留着只会得到一个从 1970 年跑起的倒计时
  if (startedAt <= 0 || phaseStartedAt <= 0) return null
  return {
    startedAt,
    focusMinutes: clampMinutes(r.focusMinutes),
    groups,
    index: Math.min(groups, Math.max(1, Math.round(num(r.index)) || 1)),
    phase,
    phaseStartedAt,
    // 暂停时刻也留着：关掉应用时正被守卫暂停着，回来依旧冻结（没人给它恢复，见 LearnWorkspace）
    ...(typeof r.pausedAt === 'number' && r.pausedAt > 0 ? { pausedAt: r.pausedAt } : {}),
  }
}

function normalizeRecord(raw: unknown): PomodoroRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const at = num(r.at)
  if (at <= 0) return null
  const groups = clampGroups(r.groups)
  return {
    at,
    minutes: clampMinutes(r.minutes),
    index: Math.min(groups, Math.max(1, Math.round(num(r.index)) || 1)),
    groups,
  }
}

/**
 * 读出可用的整数：**没给**（undefined / NaN）才回落默认值，给了就越界的归夹取管。
 *
 * 为什么不能写 `Math.round(v) || fallback`：那正好把 **0 当成「没给」**，
 * 于是 groups: 0 变 3、focusMinutes: 0 变 25——它本该被夹到量程下限（1 / 10）。
 * 这两个数来自滑块时不会出界，但读盘时会（旧文件、手改过的文件），夹取是最后一道防线。
 */
const roundOr = (v: unknown, fallback: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.round(v)
}
const clampMinutes = (v: unknown) => clamp(roundOr(v, DEFAULT_FOCUS_MINUTES), MIN_FOCUS_MINUTES, MAX_FOCUS_MINUTES)
const clampGroups = (v: unknown) => clamp(roundOr(v, DEFAULT_GROUPS), MIN_GROUPS, MAX_GROUPS)
