// @vitest-environment happy-dom
/**
 * mind 的两块新界面：
 * 1. 顶部上下文账（当前占用 + 累计输入/输出）；
 * 2. 启动 work 的 execute 消息后面的只读 work 观察列表，点击进入二级页。
 */
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { useMessageList } from '../src/components/agent/panel/useMessageList'
import type { MessageListProps } from '../src/components/agent/panel/MessageList'
import { isWorkDispatchMessage } from '../src/components/agent/panel/workDispatch'
import type { ConversationMessage, MessageUsage, WorkSession } from '../src/agent/types'

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

const work: WorkSession = {
  id: 'w1',
  name: '调研-1',
  roleId: 'tutor',
  roleConversationId: 'c1',
  status: 'running',
  runs: 2,
  createdAt: 1_700_000_000_000,
  lastActiveAt: 1_700_000_100_000,
  runtimeMs: 0,
  systemPrompt: '',
  messages: [
    {
      id: 'wm1',
      role: 'assistant',
      ts: 1_700_000_050_000,
      usage,
      parts: [{ type: 'text', text: '调研中' }],
    },
  ],
  execTrace: [],
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

describe('mind 上下文账与 work 观察列表', () => {
  it('顶部显示当前上下文占用与累计消耗', () => {
    const r = render({ messages: [workMessage], mind: true, usages: [usage], agentName: '导师龟' })
    const summary = r.host.querySelector('[data-mind-context-summary]')
    expect(summary).not.toBeNull()
    expect(summary?.textContent).toContain('上下文占用')
    expect(summary?.textContent).toContain('15%')
    expect(summary?.textContent).toContain('累计输入 1.3k')
    expect(summary?.textContent).toContain('输出 100')
    r.cleanup()
  })

  it('work 上下文固定挂在对话列表最下方；与最新一条消息是否派发 work 无关', () => {
    const r = render({
      messages: [workMessage],
      mind: true,
      usages: [usage],
      agentName: '导师龟',
      works: [work],
      onOpenMindWork: vi.fn(),
    })
    const list = r.host.querySelector('[data-work-dispatch-list]')
    expect(list).not.toBeNull()
    expect(list?.textContent).toContain('已派发的 work')
    expect(list?.textContent).toContain('调研-1')
    expect(list?.textContent).toContain('仅界面观察 · 不进上下文')
    expect(list?.textContent).toContain('上下文 15% · 1.2k')

    const plain: ConversationMessage = {
      id: 'a2',
      role: 'assistant',
      ts: 1_700_000_000_000,
      parts: [{ type: 'text', text: '没有派 work。' }],
    }
    r.cleanup()
    const r2 = render({ messages: [plain], mind: true, works: [work] })
    expect(r2.host.querySelector('[data-work-dispatch-list]')).not.toBeNull()
    r2.cleanup()
  })

  it('点击 work 卡片进入二级页回调；work 自身统计也是同一套 usage', () => {
    const onOpenMindWork = vi.fn()
    const r = render({
      messages: [workMessage],
      mind: true,
      usages: [usage],
      works: [work],
      onOpenMindWork,
    })
    const card = r.host.querySelector('[data-work-id="w1"]') as HTMLButtonElement | null
    expect(card).not.toBeNull()
    act(() => card?.click())
    expect(onOpenMindWork).toHaveBeenCalledWith('w1')
    r.cleanup()
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
