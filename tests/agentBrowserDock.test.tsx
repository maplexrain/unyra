/**
 * 智能体页 Browser Dock：收起只是状态条，展开后可见真实会话、可接管/交还，
 * 关闭 Dock 不会关闭 session。
 */
// @vitest-environment happy-dom
import { createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentBrowserDock from '../src/components/learn/agent-team/AgentBrowserDock'
import { agentBrowserRuntime, type AgentBrowserOwner, type AgentBrowserWebview } from '../src/learn/web/agentBrowser'

const OWNER: AgentBrowserOwner = { goalId: 'g1', role: 'researcher', roleName: '调研龟', conversationId: 'cv:researcher:g1' }

function fakeWebview(): AgentBrowserWebview {
  return {
    executeJavaScript: vi.fn(async () => ({ ok: true })),
    capturePage: vi.fn(async () => ({ toDataURL: () => 'data:image/png;base64,AAAA' })),
    getWebContentsId: () => 88,
  }
}

async function seed() {
  const opening = agentBrowserRuntime.open(OWNER, 'https://example.com/a')
  await Promise.resolve()
  const session = agentBrowserRuntime.list(OWNER)[0]!
  agentBrowserRuntime.registerWebview(session.sessionId, fakeWebview())
  agentBrowserRuntime.handleWebviewEvent(session.sessionId, 'dom-ready')
  agentBrowserRuntime.handleWebviewEvent(session.sessionId, 'did-stop-loading')
  await opening
  return session
}

const roots: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = []

afterEach(() => {
  for (const { root, host } of roots) {
    act(() => root.unmount())
    host.remove()
  }
  roots.length = 0
  agentBrowserRuntime.closeAll()
})

function mount(ui: ReactElement): HTMLDivElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push({ root, host })
  act(() => root.render(ui))
  return host
}

function click(el: Element | null): void {
  if (!el) throw new Error('找不到要点击的元素')
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function byText(host: HTMLElement, text: string): HTMLElement | null {
  return [...host.querySelectorAll<HTMLElement>('button, div')].find((el) => el.textContent?.trim() === text) ?? null
}

describe('AgentBrowserDock', () => {
  it('收起时只显示状态条；点开后可看到 Dock 与接管按钮，关闭 Dock 不关闭会话', async () => {
    const session = await seed()
    const host = mount(createElement(AgentBrowserDock, { goalId: 'g1', focused: true }))

    const chip = host.querySelector('[title="打开智能体浏览器"]')
    expect(chip?.textContent).toContain('调研龟')
    click(chip)

    await act(async () => {})
    expect(host.querySelector('[data-agent-browser-dock]')).toBeTruthy()
    expect(host.textContent).toContain('智能体浏览器 · 调研龟')
    expect(byText(host, '接管')).toBeTruthy()

    click(host.querySelector('[title="收起（不中断浏览器）"]'))
    await act(async () => {})
    expect(agentBrowserRuntime.get(session.sessionId)).not.toBeNull()
    expect(host.querySelector('[data-agent-browser-dock]')).toBeNull()
  })

  it('接管后显示交还，停止后会话被关闭', async () => {
    const session = await seed()
    const host = mount(createElement(AgentBrowserDock, { goalId: 'g1', focused: true }))
    click(host.querySelector('[title="打开智能体浏览器"]'))
    await act(async () => {})
    expect(byText(host, '接管')).toBeTruthy()

    click(byText(host, '接管'))
    await act(async () => {})
    expect(byText(host, '交还')).toBeTruthy()
    expect(agentBrowserRuntime.get(session.sessionId)?.control).toBe('user')

    click(byText(host, '停止'))
    await act(async () => {})
    expect(agentBrowserRuntime.get(session.sessionId)).toBeNull()
  })

  it('不属于当前 goal 的会话不会出现在这个 Dock', async () => {
    await seed()
    const host = mount(createElement(AgentBrowserDock, { goalId: 'g2', focused: true }))
    expect(host.querySelector('[title="打开智能体浏览器"]')).toBeNull()
  })
})
