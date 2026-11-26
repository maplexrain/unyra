// @vitest-environment happy-dom
/**
 * mind 的两块界面：
 * 1. 顶部上下文账（当前占用 + 累计输入/输出）；
 * 2. role 消息列表底部的 work 内嵌窗口（默认收起由 AgentPanel 控制）。
 */
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { useMessageList } from '../src/components/agent/panel/useMessageList'
import type { MessageListProps } from '../src/components/agent/panel/MessageList'
import { isWorkDispatchMessage } from '../src/components/agent/panel/workDispatch'
import { workEventSlot, type WorkRunSlot } from '../src/learn/useAgent/session'
import type { AgentEvent, ConversationMessage, MessageUsage } from '../src/agent/types'

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const usage: MessageUsage = {
  contextTokens: 1200,
  contextWindow: 8000,
  totalTokens: 1300,
  outputTokens: 100,
  cacheReadTokens: 900,
  cacheMissTokens: 300,
  estimated: false,
}

const workMessage: ConversationMessage = {
  id: 'a1',
  role: 'assistant',
  ts: 1_700_000_000_000,
  usage,
  parts: [
    { type: 'text', text: '已经派给调研龟。' },
    {
      type: 'tool',
      id: 't1',
      name: 'execute',
      args: JSON.stringify({
        description: '派一个调研 work',
        body: 'await api.work.send({ name: "调研-1", text: "查一下" })',
      }),
      result: '{"ok":true,"name":"调研-1"}',
      ok: true,
      status: 'done',
    },
  ],
}

function TestHost(props: Partial<MessageListProps>) {
  const content = useMessageList({
    messages: [],
    summaryStart: 0,
    summary: null,
    summaryOpen: false,
    setSummaryOpen: vi.fn(),
    streaming: null,
    running: false,
    loopLabel: '',
    flashId: null,
    msgRefs: { current: new Map() },
    setBubblePreview: vi.fn(),
    ...props,
  })
  return createElement('div', { 'data-testid': 'mind-container' }, content)
}

function render(props: Partial<MessageListProps>) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(createElement(TestHost, props))
  })
  return {
    host,
    root,
    cleanup: () => {
      act(() => root.unmount())
      host.remove()
    },
  }
}

describe('mind 上下文账与 work 消息内联', () => {
  it('mind 列表顶部不再画上下文统计（统计搬到右侧固定面板）', () => {
    const r = render({ messages: [workMessage], mind: true, agentName: '导师龟' })
    expect(r.host.querySelector('[data-mind-context-summary]')).toBeNull()
    r.cleanup()
  })

  it('work 消息按时间戳并入 role 消息之间，并带 work 标识，不再有独立窗口', () => {
    const before: ConversationMessage = {
      id: 'r1',
      role: 'user',
      ts: 100,
      parts: [{ type: 'text', text: '先派活' }],
    }
    const after: ConversationMessage = {
      id: 'r2',
      role: 'assistant',
      ts: 300,
      parts: [{ type: 'text', text: '收到交付' }],
    }
    const workItem = {
      m: {
        id: 'wm1',
        role: 'assistant' as const,
        ts: 200,
        parts: [{ type: 'text', text: '调研中间结果' }],
      } satisfies ConversationMessage,
      workId: 'w1',
      workName: '调研-1',
      ts: 200,
      order: 0,
    }
    const r = render({
      messages: [before, after],
      mind: true,
      agentName: '导师龟',
      workMessages: [workItem],
    })
    const ids = Array.from(r.host.querySelectorAll('[data-mind-message-id]')).map((el) =>
      el.getAttribute('data-mind-message-id'),
    )
    expect(ids).toEqual(['r1', 'wm1', 'r2'])
    const workRow = r.host.querySelector('[data-work-message="w1"]')
    expect(workRow).not.toBeNull()
    expect(workRow?.getAttribute('data-mind-ts')).toBe('200')
    expect(workRow?.textContent).toContain('work ·')
    expect(workRow?.textContent).toContain('调研-1')
    expect(workRow?.textContent).toContain('调研中间结果')
    expect(r.host.querySelector('[data-inline-work-window]')).toBeNull()
    expect(r.host.querySelector('[data-work-dispatch-list]')).toBeNull()
    r.cleanup()
  })

  it('多条 work 的消息各自带来源混入 mind 列表，同一条 work 内按 order 而不是发送时刻排', () => {
    const r1: ConversationMessage = { id: 'r1', role: 'user', ts: 100, parts: [{ type: 'text', text: '开始' }] }
    const r2: ConversationMessage = { id: 'r2', role: 'assistant', ts: 500, parts: [{ type: 'text', text: '结束' }] }
    const a0 = {
      m: { id: 'a0', role: 'assistant' as const, ts: 300, parts: [{ type: 'text', text: 'A 先完成' }] } satisfies ConversationMessage,
      workId: 'wa',
      workName: '调研-A',
      ts: 300,
      order: 0,
    }
    const a1 = {
      m: { id: 'a1', role: 'assistant' as const, ts: 200, parts: [{ type: 'text', text: 'A 后补发' }] } satisfies ConversationMessage,
      workId: 'wa',
      workName: '调研-A',
      ts: 200,
      order: 1,
    }
    const b0 = {
      m: { id: 'b0', role: 'assistant' as const, ts: 250, parts: [{ type: 'text', text: 'B 中间结果' }] } satisfies ConversationMessage,
      workId: 'wb',
      workName: '调研-B',
      ts: 250,
      order: 0,
    }
    const r = render({ messages: [r1, r2], mind: true, agentName: '导师龟', workMessages: [a1, b0, a0] })
    const ids = Array.from(r.host.querySelectorAll('[data-mind-message-id]')).map((el) =>
      el.getAttribute('data-mind-message-id'),
    )
    // A 的两条消息原始 ts 倒挂，但时间线按 order 修正排序值；B 按自己的时间插在前面。
    expect(ids).toEqual(['r1', 'b0', 'a0', 'a1', 'r2'])
    const rows = Array.from(r.host.querySelectorAll('[data-work-message]'))
    expect(rows.map((el) => el.getAttribute('data-work-message'))).toEqual(['wb', 'wa', 'wa'])
    expect(rows.map((el) => el.getAttribute('data-mind-ts'))).toEqual(['250', '300', '200'])
    expect(rows[0]?.textContent).toContain('调研-B')
    expect(rows[1]?.textContent).toContain('调研-A')
    r.cleanup()
  })

  it('chat 层不渲染 work 时间线消息', () => {
    const workItem = {
      m: {
        id: 'wm1',
        role: 'assistant' as const,
        ts: 200,
        parts: [{ type: 'text', text: '调研中间结果' }],
      } satisfies ConversationMessage,
      workId: 'w1',
      workName: '调研-1',
      ts: 200,
      order: 0,
    }
    const r = render({ messages: [workMessage], mind: false, workMessages: [workItem] })
    expect(r.host.querySelector('[data-work-message]')).toBeNull()
    r.cleanup()
  })

  it('work 实时槽位重放同一个事件不会重复追加', () => {
    const prev: WorkRunSlot[] = [
      {
        conversationId: 'c1',
        workId: 'w1',
        runId: 'r1',
        ts: 1,
        parts: [{ type: 'thinking', text: '参考' }],
      },
    ]
    const e: AgentEvent = { type: 'thinking', delta: '说明' }
    const a = workEventSlot(prev, 'c1', 'w1', 'r1', e)
    const b = workEventSlot(prev, 'c1', 'w1', 'r1', e)
    expect(prev[0]?.parts).toEqual([{ type: 'thinking', text: '参考' }])
    expect(a[0]?.parts).toEqual([{ type: 'thinking', text: '参考说明' }])
    expect(b[0]?.parts).toEqual(a[0]?.parts)
  })

  it('只有 create / send / chat.send 到 work 才算派发；kill 与普通 execute 不算', () => {
    expect(isWorkDispatchMessage(workMessage)).toBe(true)
    const kill: ConversationMessage = {
      ...workMessage,
      parts: [
        {
          type: 'tool',
          id: 't2',
          name: 'execute',
          args: JSON.stringify({ body: 'await api.work.kill("调研-1")' }),
          result: 'ok',
          ok: true,
          status: 'done',
        },
      ],
    }
    expect(isWorkDispatchMessage(kill)).toBe(false)
    expect(
      isWorkDispatchMessage({
        ...workMessage,
        parts: [
          {
            type: 'tool',
            id: 't3',
            name: 'execute',
            args: JSON.stringify({ body: 'await api.work.list()' }),
            result: 'ok',
            ok: true,
            status: 'done',
          },
        ],
      }),
    ).toBe(false)
  })
})
