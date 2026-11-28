import { describe, expect, it } from 'vitest'
import type { AgentPart, Conversation, WorkSession } from '../src/agent/types'
import type { WorkRunSlot } from '../src/learn/useAgent/session'
import { latestAgentVoiceActivity } from '../src/components/learn/workspace/agentVoiceActivity'

function channelMessage(text: string, ts: number) {
  return {
    id: `m${ts}`,
    kind: 'user' as const,
    direction: 'in' as const,
    from: { kind: 'user' as const, id: 'u1', name: 'Maxwell' },
    to: { kind: 'role' as const, id: 'tutor' as const, name: '导师龟' },
    text,
    ts,
  }
}

function conversation(patch: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    goalId: 'g1',
    title: '测试对话',
    createdAt: 1,
    updatedAt: 10,
    messages: [],
    channels: [],
    ...patch,
  } as unknown as Conversation
}

function workSession(name: string): WorkSession {
  return {
    id: 'w1',
    name,
    roleId: 'tutor',
    roleConversationId: 'c1',
    status: 'running',
    runs: 0,
    createdAt: 1,
    lastActiveAt: 1,
    runtimeMs: 0,
    systemPrompt: '',
    messages: [],
    execTrace: [],
  }
}

function run(patch: Partial<WorkRunSlot> = {}): WorkRunSlot {
  return {
    conversationId: 'c1',
    workId: 'w1',
    runId: 'r1',
    ts: 100,
    parts: [],
    ...patch,
  }
}

describe('latestAgentVoiceActivity', () => {
  it('私聊通道消息比 work 实时流新时，显示私聊短句', () => {
    const conv = conversation({ channels: [channelMessage('第一行\n---\n详细内容', 200)] })
    const activity = latestAgentVoiceActivity({
      conversations: [conv],
      workRuns: [run({ ts: 100, parts: [{ type: 'text', text: '正在写报告' } as AgentPart] })],
    })
    expect(activity?.kind).toBe('channel')
    expect(activity?.text).toBe('第一行')
    expect(activity?.at).toBe(200)
  })

  it('work 实时流比私聊消息新时，带上 work 名字与实际动作', () => {
    const conv = conversation({
      channels: [channelMessage('旧消息', 100)],
      works: { sessions: [workSession('调研')] },
    })
    const activity = latestAgentVoiceActivity({
      conversations: [conv],
      workRuns: [
        run({
          ts: 300,
          parts: [{ type: 'tool', id: 't1', name: 'web_search', args: '{}' } as AgentPart],
        }),
      ],
    })
    expect(activity?.kind).toBe('work')
    expect(activity?.text).toContain('调研 · ')
    expect(activity?.at).toBe(300)
  })

  it('思维流式正文比私聊消息新时，显示正文尾部；运行但无片段时兜底思考中', () => {
    const conv = conversation({
      channels: [channelMessage('私聊旧消息', 100)],
      inflight: { messageId: 'a1', startedAt: 400 },
    })
    const activity = latestAgentVoiceActivity({
      conversations: [conv],
      workRuns: [],
      streams: { c1: { parts: [{ type: 'text', text: '正在分析这段代码' } as AgentPart] } },
      running: { c1: true },
    })
    expect(activity).toMatchObject({ kind: 'mind', at: 400 })
    expect(activity?.text).toContain('正在分析这段代码')

    const empty = latestAgentVoiceActivity({
      conversations: [conversation({ inflight: { messageId: 'a2', startedAt: 500 } })],
      workRuns: [],
      running: { c1: true },
    })
    expect(empty?.kind).toBe('mind')
    expect(empty?.text).toBe('思考中…')
  })

  it('没有任何动态时返回 null，名册才能回退到 preview / 简介', () => {
    expect(latestAgentVoiceActivity({ conversations: [conversation()], workRuns: [] })).toBeNull()
  })
})
