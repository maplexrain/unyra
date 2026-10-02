/**
 * 子代理一次任务的执行器：还原它自己的历史 → 跑一个完整的 runAgent 循环 →
 * 提取交付与 token 账。框架无关（不 import React），测试用假流驱动。
 *
 * 与导师的运行时共用同一个 runAgent 循环、同一套事件累加（applyEvent）与
 * 历史还原（toChatHistory）——子代理的历史也必须逐字节镜像，前缀门禁按
 * `sub:{sessionId}` 分键记账，与导师的会话互不干扰。
 *
 * 并发模型下这场循环跑在后台：介入通道在「当前消息完整」的边界把导师的指令插进来
 * （半场落库与指令入账都发生在同一个点，toChatHistory 的镜像才不破）；收口时把
 * 最后一段 parts 固化成回复消息是管理器的事（finishRun），这里只负责跑与记账。
 */
import type { ReasoningEffort, StreamFn } from '../../ai/types'
import type { ResolvedProvider } from '../../ai/client'
import { runAgent } from '../runtime'
import { assertPrefixStable } from '../prefixGate'
import type { AgentEvent, AgentPart, AgentTool, ConversationMessage, MessageUsage } from '../types'
import { applyEvent } from '../../learn/agent/events'
import { toChatHistory } from '../../learn/agent/history'

export type SubRunStatus = 'complete' | 'incomplete' | 'interrupted' | 'error'

export interface SubRunOutcome {
  status: SubRunStatus
  /** 交付：最后一段（自上次边界以来）的正文。中断 / 出错 / 纯工具跳时为 null */
  delivery: string | null
  /** 自上次边界以来的 parts（管理器收口时固化成回复消息） */
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
  /**
   * 介入通道（并发 / 监督模型）：导师在循环跑动中插进来的指令。
   * pull 在「当前这条消息已完整」的边界被调；拉到非空时 runner 先 flush（半场落库）
   * 再 append（指令入账），两者与 runAgent 内部的历史推进发生在同一个点——
   * 会话账本与循环历史因此始终逐字节对齐，绝不打断半截输出。
   */
  injections?: {
    pull: () => string | null
    flush: (parts: AgentPart[]) => void
    append: (text: string) => void
  }
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
  let parts: AgentPart[] = []
  const tally = { context: 0, total: 0, output: 0, read: 0, miss: 0, estimated: false, tps: 0 }
  let sawNotice = false
  let errorMessage: string | undefined

  /** 边界动作：拉介入指令 → 半场落库 → 指令入账；三件事钉在同一个点 */
  const atBoundary = async (): Promise<string | null> => {
    if (!opts.injections) return null
    const text = opts.injections.pull()
    if (text === null) return null
    if (parts.length) {
      opts.injections.flush(parts)
      parts = []
    }
    opts.injections.append(text)
    return text
  }

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
    injections: atBoundary,
    ...(opts.stream ? { stream: opts.stream } : {}),
    onContext: (snapshot) => {
      // 前缀门禁按子会话分键：任务与介入只在会话消息末尾追加，还原出的历史必须只增不改
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
