/**
 * token 用量的展示口径。
 *
 * 三个数各有用处，别混：
 * - 单条回复：这一轮最后一跳的输入（= 此刻上下文占用）与命中率；
 * - 整个对话：所有回复累加的总量，以及按输入量加权的平均命中率
 *   （直接对每条命中率求平均会让「只发了一句话」的那条与「读了一整篇笔记」
 *   的那条一样重，明显失真）。
 */
import type { MessageUsage } from '../agent/types'

/** 1234 → 1.2k；1000000 → 1M；不到一千就原样 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  if (n < 100_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  if (n < 1_000_000) return Math.round(n / 1000) + 'k'
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
}

export function formatPercent(rate: number): string {
  return Math.round(rate * 100) + '%'
}

/** 单条回复的命中率；没有输入就没有命中率 */
export function hitRateOf(u: MessageUsage): number | null {
  const total = u.cacheReadTokens + u.cacheMissTokens
  return total > 0 ? u.cacheReadTokens / total : null
}

export interface UsageTotals {
  input: number
  output: number
  cacheRead: number
  cacheMiss: number
  contextTokens: number
  contextWindow: number
  estimated: boolean
  messages: number
}

/** 把一个对话里所有回复的账合起来 */
export function totalUsage(list: MessageUsage[]): UsageTotals | null {
  if (!list.length) return null
  const sum: UsageTotals = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheMiss: 0,
    contextTokens: 0,
    contextWindow: 0,
    estimated: false,
    messages: list.length,
  }
  for (const u of list) {
    sum.input += u.totalTokens
    sum.output += u.outputTokens
    sum.cacheRead += u.cacheReadTokens
    sum.cacheMiss += u.cacheMissTokens
    // 上下文占用取最后一条：那才是「现在」
    sum.contextTokens = u.contextTokens
    if (u.contextWindow) sum.contextWindow = u.contextWindow
    sum.estimated = sum.estimated || u.estimated
  }
  return sum
}

/** 加权平均命中率：命中量 ÷ 输入量 */
export function averageHitRate(t: UsageTotals): number | null {
  const total = t.cacheRead + t.cacheMiss
  return total > 0 ? t.cacheRead / total : null
}

/** 上下文占用百分比；窗口未知时返回 null（界面只显示绝对值） */
export function contextRatio(t: { contextTokens: number; contextWindow: number }): number | null {
  if (!t.contextWindow || t.contextTokens <= 0) return null
  return Math.min(1, t.contextTokens / t.contextWindow)
}
