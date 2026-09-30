/**
 * 注意力评级（attention）：把 reading 记下的**事实**折成一份可用得上的判断。
 *
 * 三条纪律（这个模块最容易跑偏的地方）：
 *
 * 1. **绝不落盘**。档位、分数、结论全是派生结果——公式一定会改，改公式不该动数据。
 *    界面上、提示词里出现的每一句，都可以随时用历史会话重算一遍。
 *
 * 2. **不把「思考」当「走神」**。停在一条公式上三分钟，很可能是在想。
 *    所以：
 *    - 静默（idle）只让计时停表，它的时长从不计入「中断」；
 *    - idle 单独记为 stalls，是**中性事实**（多半说明这段难），不是扣分项；
 *    - 只有真的离开（失焦、最小化、切走）才算 fragmentation。
 *    这条如果不守住，用户第一周就会学会「表演阅读」，数据从此全废。
 *
 * 3. **冷启动不给档位**。样本不足时返回 unknown + confidence: 'low'，
 *    只给事实句。用第一天的噪音去调教学策略，比没有评级更糟。
 *
 * 档位不是分数：分数会诱导优化，而这里要回答的是「下一段该教多久、怎么教」。
 */

import type { ReadingSession, ReadingStore } from './reading'
import { clamp } from '../lib/num'

/** 只看最近这段时间的会话：注意力是最近的状态，不是历史平均 */
export const ATTENTION_WINDOW_MS = 14 * 86_400_000
/** 最多回看这么多场（越近的越算数） */
export const ATTENTION_MAX_SESSIONS = 8
/** 样本门槛：不足就不给档位 */
export const ATTENTION_MIN_SESSIONS = 3
export const ATTENTION_MIN_MS = 15 * 60_000
/** 番茄钟在样本不足时的默认专注块长度（分钟） */
export const FOCUS_DEFAULT_MINUTES = 25

export type AttentionLevel = 'unknown' | 'focused' | 'steady' | 'fragmented' | 'drifting'

export const ATTENTION_LABEL: Record<AttentionLevel, string> = {
  unknown: '还没看出规律',
  focused: '专注',
  steady: '正常',
  fragmented: '断续',
  drifting: '心不在焉',
}

export interface AttentionDims {
  /** 每 10 分钟被打断几次（失焦/最小化/切走；不含静默） */
  fragmentation: number
  /** 最长的一段不被打断的有效阅读（毫秒） */
  continuityMs: number
  /** 阅读节奏：字/秒（与个人基线比较才有意义，绝对值只用来发现异常） */
  pace: number
  /** 每 10 分钟的交互印记数（展开折叠、提问、注解……）：深度的证据 */
  depth: number
  /** 会话后半段与前半段的活跃比：1 = 不衰减，< 0.5 = 明显掉 */
  decay: number
  /** 每 10 分钟的静默次数（中性事实：多半是卡住了） */
  stalls: number
  marks: number
  breaks: number
}

export interface Attention {
  level: AttentionLevel
  /** 'low' 表示样本不足：档位不可当真，只用 line 里的事实 */
  confidence: 'low' | 'ok'
  dims: AttentionDims
  /** 事实句（给用户看、也给 agent 看） */
  line: string
  /** 建议：怎么调整教法 / 下一段专注多久 */
  advice: string
  /** 建议的专注块长度（分钟）：番茄钟直接用它 */
  focusMinutes: number
  sampleMs: number
  sessions: number
}

/**
 * 只有这些中断才算「被打断」。
 *
 * 不算的两种：
 * - idle（静默）：人就在读的位置上，只是没动——中性事实，单独记 stalls；
 * - away（不在读）：切回来还没碰文档、在对话栏打字、导师栏占了主位。它不是被打断，
 *   也不是卡住，只说明「这段没在读」——所以它只用来切开连续段（见 longestStretch）。
 */
const REAL_BREAKS = new Set(['blur', 'hidden', 'tab', 'doc', 'exam'])

export function attentionOf(
  /** **某一个目标**的阅读账（见 learn/reading 的 ReadingBook）：跨目标的节奏混在一起没有意义 */
  store: ReadingStore | undefined,
  opts: { nodeId?: string; now?: number } = {},
): Attention {
  const now = opts.now ?? Date.now()
  const since = now - ATTENTION_WINDOW_MS
  const all = (store?.sessions ?? [])
    .filter((s) => s.to >= since && (!opts.nodeId || s.nodeId === opts.nodeId))
    .sort((a, b) => b.to - a.to)
  const list = all.slice(0, ATTENTION_MAX_SESSIONS)
  const sampleMs = list.reduce((n, s) => n + s.activeMs, 0)
  const dims = measure(list)
  const enough = list.length >= ATTENTION_MIN_SESSIONS && sampleMs >= ATTENTION_MIN_MS
  const level = enough ? rate(dims) : 'unknown'
  const confidence: 'low' | 'ok' = enough ? 'ok' : 'low'
  return {
    level,
    confidence,
    dims,
    line: describeLine(list, dims, sampleMs, confidence),
    advice: advise(level, dims, confidence),
    focusMinutes: focusMinutesOf(level, dims, enough),
    sampleMs,
    sessions: list.length,
  }
}

/** 把若干场会话折成五个维度；全是「每 10 分钟」口径，方便与时长解耦 */
function measure(list: ReadingSession[]): AttentionDims {
  let activeMs = 0
  let breaks = 0
  let stalls = 0
  let chars = 0
  let marks = 0
  let continuity = 0
  let decaySum = 0
  let decayN = 0
  for (const s of list) {
    activeMs += s.activeMs
    chars += s.minutes.reduce((n, m) => n + m.chars, 0)
    marks += s.sections.reduce((n, x) => n + x.marks.length, 0)
    for (const b of s.breaks) {
      // 只认落在这一场窗口里的中断：越界的是脏数据（手改过的 state.json）
      if (b.at < s.from || b.at > s.to) continue
      if (b.kind === 'idle') stalls += 1
      else if (REAL_BREAKS.has(b.kind)) breaks += 1
    }
    continuity = Math.max(continuity, longestStretch(s))
    const half = Math.floor(s.minutes.length / 2)
    if (s.minutes.length >= 6 && half > 0) {
      const head = avg(s.minutes.slice(0, half).map((m) => m.ms))
      const tail = avg(s.minutes.slice(half).map((m) => m.ms))
      if (head > 0) {
        decaySum += Math.min(1.5, tail / head)
        decayN += 1
      }
    }
  }
  const per10 = (n: number) => (activeMs > 0 ? round1((n * 600_000) / activeMs) : 0)
  return {
    fragmentation: per10(breaks),
    continuityMs: continuity,
    pace: activeMs > 0 ? round1(chars / (activeMs / 1000)) : 0,
    depth: per10(marks),
    decay: decayN ? round2(decaySum / decayN) : 1,
    stalls: per10(stalls),
    marks,
    breaks,
  }
}

/**
 * 一场会话里最长的一段「连续阅读」。
 *
 * 按真的中断把它切成几段，每段再扣掉落在里面的静默时间——静默是停表，
 * 不是读（见文件头第 2 条）。最后用这一场的有效时长封顶：切分与扣减都只是估算，
 * 不该算出比「真正在读的时间」还长的连续段。
 */
function longestStretch(s: ReadingSession): number {
  const clip = (b: { at: number; ms: number }): [number, number] => [b.at, b.at + Math.max(0, b.ms)]
  /** 真的被打断：把这一场切成几段 */
  const spans = s.breaks.filter((b) => REAL_BREAKS.has(b.kind)).map(clip)
  /*
   * 「不在读」（away）同样切开——读八分钟、跟导师打八分钟字、再读八分钟，
   * 那不是连续十六分钟。那些时间本身也从各段里扣掉。
   */
  const away = s.breaks.filter((b) => b.kind === 'away').map(clip)
  /*
   * 静默（idle）只扣掉那一段、**不切**：人还停在这一页上想，阅读在精神上是连着的
   * （文件头第 2 条：不把「思考」当「走神」）。
   */
  const idle = s.breaks.filter((b) => b.kind === 'idle').map(clip)
  const splits: Array<[number, number]> = [...spans, ...away].sort((a, b) => a[0] - b[0])
  const cuts: Array<[number, number]> = [...spans, ...away, ...idle]
  let cursor = s.from
  let best = 0
  for (const [at, end] of splits) {
    const stop = Math.min(Math.max(at, cursor), s.to)
    best = Math.max(best, stop - cursor - overlap(cuts, cursor, stop))
    cursor = Math.max(cursor, Math.min(end, s.to))
  }
  best = Math.max(best, s.to - cursor - overlap(cuts, cursor, s.to))
  return Math.max(0, Math.min(best, s.activeMs))
}

/** 落在 [from, to) 里的所有区间总长（区间可能互相重叠，先并再算） */
function overlap(spans: Array<[number, number]>, from: number, to: number): number {
  const clipped = spans
    .map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  let total = 0
  let cursor = from
  for (const [a, b] of clipped) {
    const start = Math.max(a, cursor)
    if (b > start) {
      total += b - start
      cursor = b
    }
  }
  return total
}

/**
 * 五维 → 档位。这是一份**起步用的启发式**，不是真理；所以它只输出四档 + 维度，
 * 让 agent 能看着维度自己判断。阈值改这里，历史数据不用动。
 */
function rate(d: AttentionDims): AttentionLevel {
  let score = 0
  if (d.fragmentation <= 0.5) score += 2
  else if (d.fragmentation <= 2) score += 1
  else if (d.fragmentation > 4) score -= 1
  if (d.fragmentation > 6) score -= 1
  if (d.continuityMs >= 20 * 60_000) score += 2
  else if (d.continuityMs >= 10 * 60_000) score += 1
  else if (d.continuityMs < 4 * 60_000) score -= 1
  if (d.decay >= 0.8) score += 1
  else if (d.decay <= 0.5) score -= 1
  if (d.depth >= 2) score += 1
  // 节奏异常：太快像扫读，太慢更像卡住（都不是「专注」的好证据）
  if (d.pace > 25) score -= 1
  else if (d.pace > 0 && d.pace < 0.5) score -= 1
  if (score >= 4) return 'focused'
  if (score >= 2) return 'steady'
  if (score >= 0) return 'fragmented'
  return 'drifting'
}

function focusMinutesOf(level: AttentionLevel, d: AttentionDims, enough: boolean): number {
  if (!enough) return FOCUS_DEFAULT_MINUTES
  const fromContinuity = Math.round(d.continuityMs / 60_000)
  // 建议略长于「现在能连续坐住的时间」：够得着，但不至于每次都失败
  let minutes = clamp(Math.round(fromContinuity * 1.2) || FOCUS_DEFAULT_MINUTES, 10, 45)
  if (level === 'fragmented') minutes = Math.min(minutes, 15)
  if (level === 'drifting') minutes = Math.min(minutes, 10)
  return minutes
}

function describeLine(
  list: ReadingSession[],
  d: AttentionDims,
  sampleMs: number,
  confidence: 'low' | 'ok',
): string {
  if (!list.length) return '还没有足够的阅读记录'
  const mins = Math.round(sampleMs / 60_000)
  const head =
    '最近 ' + list.length + ' 段阅读共 ' + mins + ' 分钟：最长连续 ' + Math.round(d.continuityMs / 60_000) + ' 分钟'
  const tail =
    '，每 10 分钟被打断 ' + d.fragmentation + ' 次（静默 ' + d.stalls + ' 次），节奏 ' + d.pace + ' 字/秒'
  const deep = d.marks ? '，展开/提问 ' + d.marks + ' 次' : ''
  const conf = confidence === 'low' ? '（样本还少，先当参考）' : ''
  return head + tail + deep + conf
}

function advise(level: AttentionLevel, d: AttentionDims, confidence: 'low' | 'ok'): string {
  if (confidence === 'low') return '先照常进行：连着攒几段阅读再定专注时长'
  switch (level) {
    case 'focused':
      return '可以按 ' + Math.round(d.continuityMs / 60_000) + ' 分钟以上的块安排；这类块适合放推导与难点'
    case 'steady':
      return '按 25 分钟左右的块安排，中间穿插一道题比纯讲更稳'
    case 'fragmented':
      return '切得太碎：先用 10~15 分钟的短块 + 一道小题收口，别一上来讲长推导'
    case 'drifting':
      return '先降难度或换题型（提问、例子、小题），把一段读进去再往前推'
    default:
      return '先照常进行'
  }
}

function avg(list: number[]): number {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0
}
const round1 = (v: number) => Math.round(v * 10) / 10
const round2 = (v: number) => Math.round(v * 100) / 100
