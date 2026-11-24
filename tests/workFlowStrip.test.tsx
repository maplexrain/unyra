/** work 执行链顶栏：运行中提供手动终止入口，空闲时不显示 */
// @vitest-environment happy-dom
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkFlowStrip } from '../src/components/agent/panel/WorkFlowStrip'
import type { WorkSession } from '../src/agent/types'

const work = {
  id: 'w-1',
  name: '调研-1',
  roleId: 'tutor',
  roleConversationId: 'c-1',
  status: 'running',
  runs: 1,
  createdAt: 1,
  lastActiveAt: 1,
  runtimeMs: 0,
  systemPrompt: '',
  messages: [],
  execTrace: [{ at: 1, title: '读取资料' }],
} as WorkSession

const roots: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = []
afterEach(() => {
  for (const { root, host } of roots) {
    act(() => root.unmount())
    host.remove()
  }
  roots.length = 0
})

describe('WorkFlowStrip', () => {
  it('运行中先弹终止确认；强制终止才回调，不绕过确认', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    roots.push({ root, host })
    const onStop = vi.fn()
    const onStopWithStatement = vi.fn()
    act(() => {
      root.render(createElement(WorkFlowStrip, { work, running: true, onStop, onStopWithStatement }))
    })
    expect(host.textContent).toContain('执行中')
    const button = host.querySelector('button')
    expect(button?.textContent).toContain('终止')
    act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(host.textContent).toContain('终止 work「调研-1」')
    expect(onStop).not.toHaveBeenCalled()
    act(() => {
      host.querySelector<HTMLButtonElement>('[data-work-force-stop]')?.click()
    })
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onStopWithStatement).not.toHaveBeenCalled()
  })

  it('空闲时不渲染终止按钮', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    roots.push({ root, host })
    act(() => {
      root.render(createElement(WorkFlowStrip, { work, running: false, onStop: vi.fn() }))
    })
    expect(host.querySelector('button')).toBeNull()
  })
})
