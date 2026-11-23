/**
 * work 一次任务的执行器：还原它自己的历史 → 跑一个完整 runAgent 循环 →
 * 提取交付与 token 账。框架无关（不 import React），测试用假流驱动。
 *
 * 与 role 的运行时共用同一个 runAgent 循环、同一套事件累加（applyEvent）与
 * 历史还原（toChatHistory）；work 的历史也必须逐字节镜像，前缀门禁按
 * `work:{workId}` 分键记账，与 role 的会话互不干扰。
 */
import type { ReasoningEffort, StreamFn } from '../../ai/types'
import type { ResolvedProvider } from '../../ai/client'
import { runAgent, type AgentInjection } from '../runtime'
import { assertPrefixStable } from '../prefixGate'
import type { AgentEvent, AgentPart, AgentTool, ConversationMessage, MessageUsage } from '../types'
import { applyEvent } from '../../learn/agent/events'
import { toChatHistory } from '../../learn/agent/history'

export type WorkRunStatus = 'complete' | 'incomplete' | 'interrupted' | 'error'

export interface WorkRunOutcome {
  status: WorkRunStatus
  /** 交付：最后一段（自上次边界以来）的正文。中断 / 出错 / 纯工具跳时为 null */
  delivery: string | null
  /** 自上次边界以来的 parts（管理器收口时固化成回复消息） */
  parts: AgentPart[]
  usage: MessageUsage | null
  error?: string
}

export interface WorkRunOptions {
  system: string
  /** work 会话 id：前缀门禁按它分键 */
  workId: string
  /** 会话此刻的全部消息，**含刚追加的任务**（最后一条应是这条任务） */
  messages: ConversationMessage[]
  /** 历史里引用的图片与附件文本（不传 = 只还原文字；work 不该丢 role 转来的附件） */
  images?: Map<string, { mime: string; data: string }>
  files?: Map<string, string>
  tools: AgentTool[]
  provider: ResolvedProvider
  model: string
  effort?: ReasoningEffort
  contextWindow: number
  signal?: AbortSignal
  onEvent?: (e: AgentEvent) => void
  /** role 在 work 跑动中补的指令：在「当前消息完整」的边界插入 */
  injections?: {
    pull: () => string | null
    flush: (parts: AgentPart[]) => void
    append: (text: string) => void
  }
  stream?: StreamFn
}

/** 交付 = 最后一段（工具全部执行完之后）的正文 */
export function deliveryOf(parts: AgentPart[]): string | null {
  let lastTool = -1
  parts.forEach((p, i) => {
    if (p.type === 'tool') lastTool = i
  })
  const text = parts
    .slice(lastTool + 1)
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('')
    .trim()
  return text || null
}

export async function runWorkTask(opts: WorkRunOptions): Promise<WorkRunOutcome> {
  let parts: AgentPart[] = []
  const tally = { context: 0, total: 0, output: 0, read: 0, miss: 0, estimated: false, tps: 0 }
  let sawNotice = false
  let errorMessage: string | undefined

  const atBoundary = async (): Promise<AgentInjection | null> => {
    if (!opts.injections) return null
    const text = opts.injections.pull()
    if (text === null) return null
    if (parts.length) {
      opts.injections.flush(parts)
      parts = []
    }
    opts.injections.append(text)
    return { role: 'user', content: text }
  }

  await runAgent({
    provider: opts.provider,
    model: opts.model,
    system: opts.system,
    messages: toChatHistory(opts.messages, opts.images, opts.files ? { files: opts.files } : undefined),
    tools: opts.tools,
    ctx: { nodeId: null, goalId: '' },
    signal: opts.signal,
    ...(opts.effort ? { reasoningEffort: opts.effort } : {}),
    injections: atBoundary,
    ...(opts.stream ? { stream: opts.stream } : {}),
    onContext: (snapshot) => {
      assertPrefixStable(
        'work:' + opts.workId,
        snapshot.messages,
        snapshot.tools as Parameters<typeof assertPrefixStable>[2],
      )
    },
    onEvent: (e) => {
      if (e.type === 'notice') sawNotice = true
      if (e.type === 'error') errorMessage = e.message
      if (e.type === 'usage') {
        tally.context = e.usage.input
        tally.total += e.usage.input
        tally.output += e.usage.output
        tally.read += e.usage.cacheRead
        tally.miss += Math.max(0, e.usage.input - e.usage.cacheRead)
        tally.estimated = tally.estimated || e.usage.estimated === true
        if (e.usage.tps) tally.tps = e.usage.tps
      }
      applyEvent(parts, e)
      opts.onEvent?.(e)
    },
  })

  const status: WorkRunStatus = opts.signal?.aborted
    ? 'interrupted'
    : errorMessage
      ? 'error'
      : sawNotice
        ? 'incomplete'
        : 'complete'
  const usage: MessageUsage | null = tally.total
    ? {
        contextTokens: tally.context,
        contextWindow: opts.contextWindow,
        totalTokens: tally.total,
        outputTokens: tally.output,
        cacheReadTokens: tally.read,
        cacheMissTokens: tally.miss,
        estimated: tally.estimated,
        ...(tally.tps ? { tps: tally.tps } : {}),
      }
    : null
  return {
    status,
    delivery: status === 'interrupted' ? null : deliveryOf(parts),
    parts,
    usage,
    ...(errorMessage ? { error: errorMessage } : {}),
  }
}
