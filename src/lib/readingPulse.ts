/**
 * 有效阅读的「脉搏」：文档区最左边那条 2px 进度条的数据源。
 *
 * 为什么要单独一个模块、而不是直接把 activeMs 塞进组件 props：
 * 这条进度条**每秒都要动**，而它挂在文档区底部——文档区里是整篇正文。
 * 让正文跟着它每秒重渲染一次是不划算的。于是这里做一个极小的外部存储：
 * 采集器（learn/useReadingTracker）往这里发布，只有订阅了它的那一条进度条重渲染。
 * 这与 lib/clock 是同一套路子，踩过的坑也一样：**subscribe 必须是稳定的函数**，
 * 否则 React 会反复退订重订，把渲染绕成死循环（见 lib/clock 的文件头）。
 *
 * 刻度是六十进制的：一分钟一格，一格一种颜色；新的一分钟从上边长出来，
 * 把上一分钟的颜色盖掉。十格一轮回，所以颜色的循环周期是 10 分钟。
 */
import { useMemo, useSyncExternalStore } from 'react'

/** 一格的长度：一分钟 */
export const PULSE_MINUTE_MS = 60_000
/** 几格一轮回 */
export const PULSE_STEPS = 10

/**
 * 十格的颜色。
 *
 * 低饱和、中亮度的一圈色相：相邻两格离得够远（看得出换了一格），
 * 整体又不跳（2px 的一条，扎眼就毁了「不打扰」这件事）。
 * 不用主题的 --color-seal：那条太浓，十格都一个色也看不出「又走完一分钟」。
 */
export const PULSE_COLORS = [
  'hsl(8 42% 52%)',
  'hsl(28 44% 52%)',
  'hsl(45 40% 48%)',
  'hsl(78 30% 45%)',
  'hsl(140 26% 44%)',
  'hsl(172 30% 42%)',
  'hsl(198 34% 48%)',
  'hsl(222 34% 54%)',
  'hsl(258 28% 54%)',
  'hsl(300 26% 52%)',
]

export interface ReadingPulse {
  /** 这一场阅读的身份（换文档/换节点就换一个，进度条据此从头开始） */
  sessionId: string
  /**
   * 这一场是哪个目标的。
   *
   * 阅读账按目标分开（见 learn/reading 的 ReadingBook），而脉搏是**还没落盘**的那一段：
   * 顶栏要把它加到「当前目标今天读了多少」上，就得知道它属于谁——
   * 读到一半切到别的目标，那一段不能被算到人家头上。
   */
  goalId: string
  /** 这一场累计的**有效**毫秒（停表时不再增长；含已经交给 store 的部分） */
  activeMs: number
  /**
   * 其中还没写进 store 的那一段（结算间隔 30 秒）。
   *
   * 顶栏要显示「今天读了多久」时用它补上差额：store 里的数是 30 秒前的，
   * 而用户盯着看的这一会儿也应该算进去——不然数字会一跳一跳地"憋"着不动。
   */
  unsentMs: number
  /** 正在停表（失焦、切走、静默、AI 在写）：进度条暗下去，但不消失 */
  paused: boolean
}

const IDLE: ReadingPulse = { sessionId: '', goalId: '', activeMs: 0, unsentMs: 0, paused: true }
let current: ReadingPulse = IDLE
const listeners = new Set<() => void>()

/** 采集器每拍调用一次；值没变就不通知（避免无意义的重渲染） */
export function publishReadingPulse(next: ReadingPulse): void {
  if (
    next.sessionId === current.sessionId &&
    next.goalId === current.goalId &&
    next.activeMs === current.activeMs &&
    next.unsentMs === current.unsentMs &&
    next.paused === current.paused
  ) {
    return
  }
  current = next
  for (const listener of listeners) listener()
}

/** 采集器卸载时清空：进度条不该留着上一份文档的读数 */
export function clearReadingPulse(): void {
  publishReadingPulse(IDLE)
}

function subscribeReadingPulse(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function readReadingPulse(): ReadingPulse {
  return current
}

/** 订阅这场阅读的脉搏；只有用它渲染的那一小块会跟着每秒重渲染 */
export function useReadingPulse(): ReadingPulse {
  return useSyncExternalStore(subscribeReadingPulse, readReadingPulse)
}

export interface PulseFrame {
  /** 第几分钟（从 0 起，整场阅读的累计） */
  minute: number
  /** 这一分钟走了多少（0~1） */
  fraction: number
  /** 十格里的第几格（0~9）：颜色就是它 */
  step: number
  /** 这一分钟的颜色 */
  color: string
  /** 上一分钟的颜色（垫在下面，被新的一格从左往右盖掉）；第一分钟为 null */
  previous: string | null
}

/* ---------- 今天已落盘多少：给顶栏那两个数字用 ---------- */

/**
 * 今天已经写进 store 的有效毫秒。
 *
 * 为什么要单独发布一份：阅读记录是 patchQuiet 写的（只改 ref、不重渲染），
 * 于是**渲染快照里的阅读数据永远是旧的**——顶栏那个「今天读了多少」要等到别的动作
 * 触发一次 set（比如切文档）才会跳一下。用户看到的就是「只有切文档才更新」。
 *
 * 结算发生时由学习区把新的日累计发布到这里，配上这一场的脉搏（还没结算的那一段），
 * 顶栏就能每秒自己往上走。day 一起发布是为了跨零点（04:00）时能分辨这是哪一天的数字。
 *
 * 已落盘的这三个数（哪个目标 / 哪一天 / 多少毫秒）。它们是**同一次结算里一起发布**的，
 * 本来就只有一份：于是存成一份快照、发布时**整份换新**，读的人拿到的永远是同一个对象。
 */
let publishedDay: { goalId: string; day: string; ms: number } = { goalId: '', day: '', ms: 0 }

/**
 * 发布「某个目标今天已经落盘多少」。
 *
 * 目标 id 一起发布：阅读账按目标分开之后，「今天读了多少」必须说清是哪一门课的
 * （见 learn/reading 的 ReadingBook）。顶栏按当前目标读它，别的目标读到的是另一笔。
 */
export function publishReadingDay(goalId: string, day: string, ms: number): void {
  if (goalId === publishedDay.goalId && day === publishedDay.day && ms === publishedDay.ms) return
  publishedDay = { goalId, day, ms }
  for (const listener of listeners) listener()
}

/**
 * 读当下这一份。
 *
 * useSyncExternalStore 要的 getSnapshot 必须是稳定函数、且返回稳定身份：这里返回的就是
 * 上面那一份快照本身（没发布过就一直是同一个对象），于是 React 不会把它当成每秒都在变。
 */
function readReadingDay(): { goalId: string; day: string; ms: number } {
  return publishedDay
}

/**
 * 订阅「某个目标今天已落盘多少」；只有用它渲染的那一小块跟着变。
 *
 * 为什么只开一份订阅：这三个数是**同一次发布**里一起变的，原来对同一个 store 连开三个
 * useSyncExternalStore，同一拍就被通知三次、读三次。合成一份之后每秒只被通知一次，
 * 读到的三个值与原来逐字相同（键、类型、语义都没变）。
 * useMemo 再稳一层：依赖是那份快照本身（没变就不换），于是返回对象的**身份**也只在数字
 * 真的变了时才换——不再每次渲染都新建一个对象（谁把它放进依赖，谁就每轮重算一遍）。
 */
export function useReadingDay(): { goalId: string; day: string; ms: number } {
  const snap = useSyncExternalStore(subscribeReadingPulse, readReadingDay)
  return useMemo(() => ({ goalId: snap.goalId, day: snap.day, ms: snap.ms }), [snap])
}

/* ---------- 「现在结算一次」：打卡判定要读 store，不能读还没结算的那一段 ---------- */

const settleRequests = new Set<() => void>()

/**
 * 登记一个「立刻结算」的把手（采集器挂载时登记、卸载时撤销）。
 *
 * 用途：打卡前先把这一场结算掉。门槛复核读的是 store，而 store 每 30 秒才更新一次；
 * 不先结算的话，顶栏显示「已经读够了」而点下去被拒，是最让人恼火的那种不一致。
 */
export function onSettleRequest(fn: () => void): () => void {
  settleRequests.add(fn)
  return () => {
    settleRequests.delete(fn)
  }
}

/** 让当前所有在跑的采集器立刻结算一次（有数据的才会真的写） */
export function requestReadingSettle(): void {
  for (const fn of [...settleRequests]) fn()
}

/**
 * 把「这一场读了多少毫秒」折成一条进度条的当前样子。
 * 纯函数，边界（0、59.9s、整分钟、跨轮回）由单测钉住。
 */
export function pulseFrame(activeMs: number): PulseFrame | null {
  if (!Number.isFinite(activeMs) || activeMs <= 0) return null
  const minute = Math.floor(activeMs / PULSE_MINUTE_MS)
  const step = minute % PULSE_STEPS
  return {
    minute,
    fraction: (activeMs % PULSE_MINUTE_MS) / PULSE_MINUTE_MS,
    step,
    color: PULSE_COLORS[step],
    previous: minute > 0 ? PULSE_COLORS[(minute - 1) % PULSE_STEPS] : null,
  }
}
