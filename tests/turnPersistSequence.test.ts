/**
 * 「一轮 agent loop 从跑到收口」的落库时序复现。
 *
 * 症状驱动：有用户反馈「agent loop 执行完后消息列表里重复渲染消息」。
 * 数据上唯一能造成重复的形状是 conversation.messages 里同一条回复出现两次
 * （两个不同 id 或同 id 两条）。这里用真实模块按 useAgent 的时序跑一遍——
 * 增量落库（里程碑立即、正文节流）+ 收口 settle——钉住「最多只有一份」。
 */
import { describe, expect, it } from 'vitest'

import { runAgent } from '../src/agent/runtime'
import type { ResolvedProvider } from '../src/ai/client'
import type { AgentEvent, AgentPart, AgentTool, Conversation, ConversationMessage } from '../src/agent/types'
import { applyEvent } from '../src/learn/agent/events'
import { upsertAssistantInFlight, TURN_FLUSH_MS } from '../src/learn/agent/inflight'
import type { StreamChatOptions, StreamChatResult } from '../src/ai/types'

const provider = { id: 't', label: 'T', baseUrl: 'http://localhost', apiKey: 'k' } as ResolvedProvider
const executeTool: AgentTool = {
  name: 'execute',
  description: '执行一段 JS',
  parameters: { type: 'object' },
  run: async () => ({ ok: true, content: '（工具回执）' }),
}

function fakeStream(script: Array<{ content: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }>) {
  let hop = 0
  return async (opts: StreamChatOptions): Promise<StreamChatResult> => {
    const step = script[hop++]
    if (!step) throw new Error('剧本不够长')
    if (step.content) opts.onDelta?.({ content: step.content })
    return { content: step.content, reasoning: '', toolCalls: step.toolCalls ?? [], finishReason: 'stop' }
  }
}

describe('一轮 loop 的落库时序：增量 + 收口最多留一份', () => {
  it('里程碑立即落库 + 正文节流 + 收口：assistant 消息在会话里始终只有一条', async () => {
    const conv: Conversation = {
      id: 'c1',
      goalId: 'g1',
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '讲讲递归' }], ts: 0 }],
      createdAt: 0,
      updatedAt: 0,
      inflight: { messageId: 'a1', startedAt: 0 },
    }
    const assistantId = 'a1'
    const parts: AgentPart[] = []
    // useAgent 的 flushTurn：拿最新会话，按固定 id 整条替换落库
    const flush = () => {
      expect(conv.messages.length).toBeGreaterThan(0)
      const next = upsertAssistantInFlight(conv, { id: assistantId, role: 'assistant', parts: [...parts], ts: 1 })
      conv.messages = next.messages
      conv.updatedAt = next.updatedAt
    }
    let pendingThrottle: ReturnType<typeof setTimeout> | null = null
    const onEvent = (e: AgentEvent) => {
      applyEvent(parts, e)
      if (e.type === 'tool-call' || e.type === 'tool-result' || e.type === 'notice') flush()
      else if (e.type === 'text' || e.type === 'thinking') {
        if (!pendingThrottle) pendingThrottle = setTimeout(flush, TURN_FLUSH_MS)
      }
    }

    await runAgent({
      provider,
      model: 'test-model',
      system: 's',
      messages: [{ role: 'user', content: '讲讲递归' }],
      tools: [executeTool],
      ctx: { nodeId: 'n1', goalId: 'g1' },
      stream: fakeStream([
        { content: '先读笔记。', toolCalls: [{ id: 'call-1', name: 'execute', arguments: '{}' }] },
        { content: '读完，开讲。' },
      ]),
      onEvent,
    })
    if (pendingThrottle) clearTimeout(pendingThrottle)

    // 收口（finally）：settle=true 再落一次
    const settled = upsertAssistantInFlight(
      conv,
      { id: assistantId, role: 'assistant', parts, ts: 2 },
      true,
    )
    const assistantEntries = settled.messages.filter((m: ConversationMessage) => m.id === assistantId)
    expect(assistantEntries).toHaveLength(1)
    expect(settled.messages).toHaveLength(2)
    expect(settled.inflight).toBeUndefined()
    // 收口后的正文是完整的一份，没有因为「节流那份 + 收口这份」叠出两段
    const texts = assistantEntries[0].parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text)
    expect(texts.join('')).toBe('先读笔记。读完，开讲。')
  })
})
