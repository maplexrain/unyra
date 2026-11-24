// @vitest-environment happy-dom
/**
 * work 消息内嵌窗口：默认收起，展开后在 role 对话底部显示 work 列表与只读消息。
 */
import { createElement, act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { InlineWorkWindow } from '../src/components/agent/panel/InlineWorkWindow'
import type { WorkSession } from '../src/agent/types'

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
      parts: [{ type: 'text', text: '调研中' }],
    },
  ],
  execTrace: [],
}

function Host({ onSelectWork = vi.fn() }: { onSelectWork?: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  return createElement(InlineWorkWindow, {
    works: [work],
    live: [],
    open,
    activeWorkId: 'w1',
    onToggle: () => setOpen((v) => !v),
    onSelectWork,
    setBubblePreview: vi.fn(),
  })
}

describe('InlineWorkWindow', () => {
  it('默认收起，只显示工作窗口标题；展开后显示 work 列表和消息', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(createElement(Host))
    })
    const window = host.querySelector('[data-inline-work-window]')
    expect(window).not.toBeNull()
    expect(window?.querySelector('button')?.getAttribute('aria-expanded')).toBe('false')
    expect(host.textContent).toContain('工作窗口')
    expect(host.textContent).toContain('展开查看 work 消息')
    expect(host.querySelector('[data-work-dispatch-list]')).toBeNull()
    expect(host.querySelector('[data-inline-work-messages]')).toBeNull()

    act(() => {
      window?.querySelector<HTMLButtonElement>('button')?.click()
    })
    expect(window?.querySelector('button')?.getAttribute('aria-expanded')).toBe('true')
    expect(host.textContent).toContain('work 列表')
    expect(host.textContent).toContain('调研-1')
    expect(host.textContent).toContain('调研中')
    expect(host.querySelector('[data-inline-work-messages]')).not.toBeNull()
    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
