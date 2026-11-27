// @vitest-environment happy-dom
/** 内嵌 work 状态块的最小渲染回归：两行内容、实时步骤与找不到 work 的退路。 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { WorkInline } from '../src/components/agent/panel/WorkInline'
import type { WorkSession } from '../src/agent/types'

function session(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: 'w-1',
    name: 'ml-onboarding',
    roleId: 'tutor',
    roleConversationId: 'c-1',
    status: 'running',
    runs: 1,
    createdAt: 1_000,
    lastActiveAt: 1_000,
    runningSince: Date.now() - 14_000,
    runtimeMs: 0,
    systemPrompt: '',
    messages: [],
    execTrace: [],
    ...overrides,
  }
}

function render(node: ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(node))
  return { host, root }
}

describe('WorkInline', () => {
  it('第一行显示标题 / work 名 / 状态 / 耗时，第二行显示实时思考，且没有边框与底色', () => {
    const { host, root } = render(
      createElement(WorkInline, {
        title: '机器学习入门',
        workRef: 'ml-onboarding',
        source: {
          sessions: [session()],
          live: [{ workId: 'w-1', runId: 'r-1', ts: 1, parts: [{ type: 'thinking', text: '正在拆解课程大纲' }] }],
        },
      }),
    )
    expect(host.textContent).toContain('机器学习入门')
    expect(host.textContent).toContain('ml-onboarding')
    expect(host.textContent).toContain('运行中')
    expect(host.textContent).toContain('00:14')
    expect(host.textContent).toContain('正在拆解课程大纲')
    expect(host.querySelector('[data-work-inline-line="thinking"]')).not.toBeNull()
    const rootEl = host.querySelector('[data-work-inline]') as HTMLElement
    expect(rootEl.className).not.toContain('border')
    expect(rootEl.className).not.toContain('bg-')
    act(() => root.unmount())
    host.remove()
  })

  it('引用不存在时保留标题与原始 work 名，并给出可读的未找到状态', () => {
    const { host, root } = render(
      createElement(WorkInline, { title: '调研进度', workRef: 'missing', source: { sessions: [], live: [] } }),
    )
    expect(host.textContent).toContain('调研进度')
    expect(host.textContent).toContain('未找到')
    expect(host.textContent).toContain('未找到 work「missing」')
    act(() => root.unmount())
    host.remove()
  })
})
