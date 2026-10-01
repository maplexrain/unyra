/**
 * 子代理一次任务的执行器：还原它自己的历史 → 跑一个完整的 runAgent 循环 →
 * 提取交付与 token 账。框架无关（不 import React），测试用假流驱动。
 *
 * 与导师的运行时共用同一个 runAgent 循环、同一套事件累加（applyEvent）与
 * 历史还原（toChatHistory）——子代理的历史也必须逐字节镜像，前缀门禁按
 * `sub:{sessionId}` 分键记账，与导师的会话互不干扰。
 */
import type { ReasoningEffort, StreamFn } from '../../ai/types'
import type { ResolvedProvider } from '../../ai/client'
import { runAgent } from '../runtime'
import { assertPrefixStable } from '../prefixGate'
import type { AgentEvent, AgentPart, AgentTool, MessageUsage } from '../types'
import { applyEvent } from '../../learn/agent/events'
import { toChatHistory } from '../../learn/agent/history'
import type { ConversationMessage } from '../types'

export type SubRunStatus = 'complete' | 'incomplete' | 'interrupted' | 'error'

export interface SubRunOutcome {
  status: SubRunStatus
  /** 交付：最后一段正文（没有工具调用的那一跳）。中断 / 出错 / 纯工具跳时为 null */
  delivery: string | null
  parts: AgentPart[]
  usage: MessageUsage | null
  /** 出错时的原文（status === 'error' 时有） */
  error?: string
}

export interface SubRunOptions {
  def: { system: string }
  /** 会话 id：前缀门禁按它分键 */
  sessionId: string
  /** 会话此刻的全部消息，**含刚追加的任务**（最后一条应是这条任务） */
  messages: ConversationMessage[]
  tools: AgentTool[]
  provider: ResolvedProvider
  model: string
  effort?: ReasoningEffort
  contextWindow: number
  signal?: AbortSignal
  onEvent?: (e: AgentEvent) => void
  /** 测试注入替身流，从而不联网驱动整个循环 */
  stream?: StreamFn
}

/**
 * 交付 = 最后一段（工具全部执行完之后）的正文。
 *
 * 「只有最终消息能进导师上下文」落在这一处：中间跳的观察与工具卡片留在这份 parts 里
 * （子会话视图可以翻），但只有最后那截文字会被交出去。被截断的输出也算交付——
 * 流式里已经吐出来的正文是真内容，调用方会用「不完整」标记让导师自己决定怎么办。
 */
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

export async function runSubAgentTask(opts: SubRunOptions): Promise<SubRunOutcome> {
  const parts: AgentPart[] = []
  const tally = { context: 0, total: 0, output: 0, read: 0, miss: 0, estimated: false, tps: 0 }
  let sawNotice = false
  let errorMessage: string | undefined

  await runAgent({
    provider: opts.provider,
    model: opts.model,
    system: opts.def.system,
    /**
     * 历史还原与导师同一条纪律：会话消息（含刚追加的任务）→ toChatHistory。
     * 子代理不收图片与文件附件，这两路天然为空。
     */
    messages: toChatHistory(opts.messages),
    tools: opts.tools,
    // 子代理的 execute 不用 ctx（没有「当前节点」概念），给个空壳满足形状
    ctx: { nodeId: null, goalId: '' },
    signal: opts.signal,
    ...(opts.effort ? { reasoningEffort: opts.effort } : {}),
    ...(opts.stream ? { stream: opts.stream } : {}),
    onContext: (snapshot) => {
      // 前缀门禁按子会话分键：任务只在会话消息末尾追加，还原出的历史必须只增不改
      assertPrefixStable(
        'sub:' + opts.sessionId,
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

  const status: SubRunStatus = opts.signal?.aborted
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
