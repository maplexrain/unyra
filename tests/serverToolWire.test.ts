/**
 * DeepSeek 服务端联网工具的线协议：事件解析、最终清单、历史回传。
 * 直接按官方文档的字段形态钉住，避免改字段名时只坏线上、不坏测试。
 */
import { describe, expect, it } from 'vitest'
import {
  normalizeAnnotations,
  normalizeServerSteps,
  normalizeServerToolEvent,
  wireServerToolCalls,
} from '../src/ai/serverTools'
import { toChatHistory } from '../src/learn/agent/history'
import type { AgentPart, ConversationMessage } from '../src/agent/types'

const call = {
  id: 'call_1',
  type: 'web_search',
  kind: 'web_search',
  action: { type: 'search', queries: ['DeepSeek 官方文档'] },
  status: 'completed',
  signature: 'sig-1',
  sources: [{ url: 'https://api-docs.deepseek.com/', title: 'DeepSeek 文档', site_name: 'DeepSeek' }],
  step: 0,
}

describe('服务端联网工具线协议', () => {
  it('step_reasoning_done / call_started / call_completed 都解析成界面事件', () => {
    expect(normalizeServerToolEvent({ type: 'step_reasoning_done', step: 0 })).toEqual({ type: 'step_reasoning_done', step: 0 })
    const started = normalizeServerToolEvent({
      type: 'call_started',
      step: 1,
      call: { ...call, status: undefined, sources: undefined },
    })
    expect(started).toMatchObject({ type: 'call_started', step: 1, call: { id: 'call_1', status: 'running' } })
    const done = normalizeServerToolEvent({ type: 'call_completed', step: 1, call })
    expect(done).toMatchObject({ type: 'call_completed', step: 1, call: { status: 'completed', signature: 'sig-1' } })
  })

  it('最终 server_tool_calls 的步骤 / reasoning / 来源都可还原', () => {
    const steps = normalizeServerSteps([
      { index: 0, reasoning_content: '先搜官方说明。', calls: [call] },
      { index: 1, reasoning_content: '', calls: [{ ...call, id: 'call_2', kind: 'read_url', action: { type: 'read_link', url: 'https://example.com' } }] },
    ])
    expect(steps).toHaveLength(2)
    expect(steps[0].reasoningContent).toBe('先搜官方说明。')
    expect(steps[0].calls[0].sources?.[0]).toMatchObject({ siteName: 'DeepSeek' })
    expect(steps[1].calls[0].action.url).toBe('https://example.com')
  })

  it('annotations 还原成正文引用区间', () => {
    expect(normalizeAnnotations([
      { type: 'url_citation', url: 'https://example.com/a', title: 'A', start_index: 3, end_index: 8 },
      { url: '' },
    ])).toEqual([{ url: 'https://example.com/a', title: 'A', startIndex: 3, endIndex: 8 }])
  })

  it('历史回传只带 signature，不带仅展示用的 sources / page', () => {
    const wired = wireServerToolCalls(normalizeServerSteps([{ index: 0, reasoning_content: '想', calls: [call] }]))
    expect(wired[0]).toMatchObject({ index: 0, reasoning_content: '想', calls: [{ id: 'call_1', signature: 'sig-1' }] })
    expect(JSON.stringify(wired)).not.toContain('DeepSeek 文档')
    expect(JSON.stringify(wired)).not.toContain('sources')
  })

  it('界面上的 web 片段能重建为下一轮 assistant 的 server_tool_calls', () => {
    const user: ConversationMessage = { id: 'u', role: 'user', parts: [{ type: 'text', text: '查一下' }], ts: 0 }
    const parts: AgentPart[] = [
      { type: 'thinking', text: '先搜。' },
      {
        type: 'web',
        id: 'w1',
        step: 0,
        reasoning: '先搜官方说明。',
        call: {
          id: 'call_1',
          type: 'web_search',
          kind: 'web_search',
          action: { type: 'search', queries: ['DeepSeek'] },
          status: 'completed',
          signature: 'sig-1',
          sources: [{ url: 'https://example.com', title: '来源' }],
          step: 0,
        },
      },
      {
        type: 'web',
        id: 'w2',
        step: 0,
        call: {
          id: 'call_2',
          type: 'read_url',
          kind: 'read_url',
          action: { type: 'read_link', url: 'https://example.com/read' },
          status: 'completed',
          signature: 'sig-2',
          page: { url: 'https://example.com/read', title: '原文' },
          step: 0,
        },
      },
      { type: 'text', text: '查完了。' },
    ]
    const assistant: ConversationMessage = { id: 'a', role: 'assistant', parts, ts: 1 }
    const history = toChatHistory([user, assistant])
    const msg = history.find((m) => m.server_tool_calls?.length)
    expect(msg?.server_tool_calls).toHaveLength(1)
    expect(msg?.server_tool_calls?.[0].calls.map((c) => c.id)).toEqual(['call_1', 'call_2'])
    expect(msg?.server_tool_calls?.[0].calls[0].signature).toBe('sig-1')
    expect(msg?.server_tool_calls?.[0].reasoningContent).toBe('先搜官方说明。')
  })
})
