// @vitest-environment happy-dom
/**
 * 右侧固定状态面板：role mind 上下文账 + 当前 agent 的 work 状态与各自上下文账。
 */
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { MindInspector } from '../src/components/agent/panel/MindInspector'
import type { MessageUsage, WorkSession } from '../src/agent/types'

const usage: MessageUsage = {
  contextTokens: 1200,
  contextWindow: 8000,
  totalTokens: 1300,
  outputTokens: 100,
  cacheReadTokens: 900,
  cacheMissTokens: 300,
  estimated: false,
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

describe('MindInspector', () => {
  it('显示 role 上下文统计与 work 状态列表', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(MindInspector, {
          usages: [usage],
          subject: '导师龟',
          works: [work],
          activeWorkId: 'w1',
        }),
      )
    })
    const panel = host.querySelector('[data-mind-inspector]')
    expect(panel).not.toBeNull()
    expect(panel?.textContent).toContain('role 上下文')
    expect(panel?.textContent).toContain('15%')
    expect(panel?.textContent).toContain('work 层')
    expect(panel?.textContent).toContain('调研-1')
    expect(panel?.textContent).toContain('运行中')
    expect(panel?.textContent).toContain('上下文 15% · 1.2k')
    expect(panel?.querySelector('[data-work-dispatch-list]')).not.toBeNull()
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('没有 work 与 context 账时显示空态', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(createElement(MindInspector, { usages: [], works: [] }))
    })
    expect(host.textContent).toContain('尚无上下文账')
    expect(host.textContent).toContain('暂无 work')
    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
