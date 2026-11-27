/**
 * 智能体页第三个「网页」页：只有当前对话有浏览器会话时才出现入口；
 * 页面本身占满工作区，可接管/交还/暂停/停止，停止最后一个会话后页面消失。
 */
// @vitest-environment happy-dom
import { createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentBrowserPage from '../src/components/agent/panel/AgentBrowserPage'
import { AgentViewTabs } from '../src/components/agent/panel/AgentViewTabs'
import {
  browserSessionsOf,
  useAgentBrowserTab,
  type AgentBrowserTabScope,
} from '../src/components/agent/panel/useAgentBrowserTab'
import {
  agentBrowserRuntime,
  type AgentBrowserOwner,
  type AgentBrowserWebview,
} from '../src/learn/web/agentBrowser'

const OWNER: AgentBrowserOwner = {
  goalId: 'g1',
  role: 'researcher',
  roleName: '调研龟',
  conversationId: 'cv:researcher:g1',
}
const SCOPE = { id: OWNER.conversationId, goalId: OWNER.goalId }

function fakeWebview(): AgentBrowserWebview {
  return {
    executeJavaScript: vi.fn(async () => ({ ok: true })),
    capturePage: vi.fn(async () => ({ toDataURL: () => 'data:image/png;base64,AAAA' })),
    getWebContentsId: () => 88,
  }
}

async function seed(owner: AgentBrowserOwner = OWNER, url = 'https://example.com/a') {
  const opening = agentBrowserRuntime.open(owner, url)
  await Promise.resolve()
  const session = agentBrowserRuntime.list(owner)[0]!
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

function BrowserTabProbe({ scope }: { scope: AgentBrowserTabScope }) {
  const tab = useAgentBrowserTab(scope)
  return createElement(
    'button',
    {
      'data-browser-probe': 'true',
      'data-count': tab.sessions.length,
      'data-open': tab.open ? 'true' : 'false',
      onClick: () => tab.setOpen(!tab.open),
    },
    '网页',
  )
}

describe('智能体浏览器第三个页面', () => {
  it('没有会话时不渲染网页页签；有会话时出现入口并报告数量', () => {
    const empty = mount(createElement(AgentViewTabs, { active: 'chat', browserCount: 0, onSelect: () => {} }))
    expect(empty.querySelector('[data-agent-view-tab="web"]')).toBeNull()

    const onSelect = vi.fn()
    const withBrowser = mount(
      createElement(AgentViewTabs, { active: 'chat', browserCount: 2, onSelect }),
    )
    const tab = withBrowser.querySelector('[data-agent-view-tab="web"]')
    expect(tab).toBeTruthy()
    expect(tab?.textContent).toContain('网页')
    expect(tab?.textContent).toContain('2')
    click(tab)
    expect(onSelect).toHaveBeenCalledWith('web')
  })

  it('入口只跟当前对话的会话走；会话全关后页面状态自动退回', async () => {
    await seed()
    const host = mount(createElement(BrowserTabProbe, { scope: SCOPE }))
    const probe = host.querySelector('[data-browser-probe="true"]')
    expect(probe?.getAttribute('data-count')).toBe('1')
    expect(probe?.getAttribute('data-open')).toBe('false')

    click(probe)
    await act(async () => {})
    expect(probe?.getAttribute('data-open')).toBe('true')

    agentBrowserRuntime.closeAll()
    await act(async () => {})
    expect(probe?.getAttribute('data-count')).toBe('0')
    expect(probe?.getAttribute('data-open')).toBe('false')
  })

  it('页面可见；接管后显示交还，停止最后一个会话后页面消失', async () => {
    const session = await seed()
    const host = mount(
      createElement(AgentBrowserPage, { scope: SCOPE, active: true }),
    )

    expect(host.querySelector('[data-agent-browser-page]')).toBeTruthy()
    expect(host.textContent).toContain('智能体浏览器 · 调研龟')
    expect(byText(host, '接管')).toBeTruthy()

    click(byText(host, '接管'))
    await act(async () => {})
    expect(agentBrowserRuntime.get(session.sessionId)?.control).toBe('user')
    expect(byText(host, '交还')).toBeTruthy()

    click(byText(host, '停止'))
    await act(async () => {})
    expect(agentBrowserRuntime.get(session.sessionId)).toBeNull()
    expect(host.querySelector('[data-agent-browser-page]')).toBeNull()
  })

  it('只收当前对话的会话：别的会话、别的 target 都不会串进这一页', async () => {
    await seed()
    const all = agentBrowserRuntime.getSnapshot().sessions
    expect(browserSessionsOf(all, SCOPE)).toHaveLength(1)
    expect(browserSessionsOf(all, { id: 'cv:researcher:other', goalId: 'g1' })).toHaveLength(0)
    expect(browserSessionsOf(all, { id: OWNER.conversationId, goalId: 'g2' })).toHaveLength(0)
    expect(browserSessionsOf(all, { id: null, goalId: 'g1' })).toHaveLength(0)
  })
})
