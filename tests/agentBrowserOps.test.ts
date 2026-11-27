/**
 * agent 模式 browserOps：默认只操作自己的后台 session，open 不碰 docArea，
 * 用户页签不能成为缺省目标。
 */
import { describe, expect, it, vi } from 'vitest'
import { makeBrowserOps, type BrowserDeps } from '../src/learn/web/browserOps'
import { AgentBrowserRuntime, type AgentBrowserWebview } from '../src/learn/web/agentBrowser'
import type { AgentBrowserOwner } from '../src/learn/web/agentBrowser'
import type { LearnStore } from '../src/learn/types'

const OWNER: AgentBrowserOwner = { goalId: 'g1', role: 'researcher', roleName: '调研龟', conversationId: 'cv:researcher:g1' }

function fakeStore(): LearnStore {
  return { docArea: { layout: {} as never, groups: [], focus: null } } as unknown as LearnStore
}

function fakeWebview(): AgentBrowserWebview {
  return {
    executeJavaScript: vi.fn(async (script: string) => {
      if (script.includes('__agentIndex(')) {
        return { text: '[1] header', count: 1, title: '测试页', url: 'https://example.com/a' }
      }
      return { ok: true }
    }),
    capturePage: vi.fn(async () => ({ toDataURL: () => 'data:image/png;base64,AAAA' })),
    getWebContentsId: () => 101,
  }
}

async function setWebview(runtime: AgentBrowserRuntime, sessionId: string, wv: AgentBrowserWebview) {
  runtime.registerWebview(sessionId, wv)
  runtime.handleWebviewEvent(sessionId, 'dom-ready')
  runtime.handleWebviewEvent(sessionId, 'did-stop-loading')
}

describe('makeBrowserOps：智能体后台会话模式', () => {
  it('open 生成后台 session，不调用 openWebTab/activateTab；tabs 只列自己的会话', async () => {
    const runtime = new AgentBrowserRuntime()
    const store = fakeStore()
    const openWebTab = vi.fn(() => 'w:should-not-open')
    const activateTab = vi.fn()
    const closeTab = vi.fn()
    const deps: BrowserDeps = {
      getLatest: () => store,
      set: () => {},
      openWebTab,
      activateTab,
      closeTab,
      webMeta: {},
      agentBrowser: runtime,
    }
    const ops = makeBrowserOps(deps, 'g1', OWNER)
    const opening = ops.open('https://example.com/a')
    await Promise.resolve()
    const session = runtime.list(OWNER)[0]
    expect(session).toBeTruthy()
    await setWebview(runtime, session!.sessionId, fakeWebview())
    const opened = await opening

    expect(openWebTab).not.toHaveBeenCalled()
    expect(activateTab).not.toHaveBeenCalled()
    expect(opened).toMatchObject({ tabId: session!.sessionId, sessionId: session!.sessionId, url: 'https://example.com/a' })
    expect(ops.tabs().tabs).toEqual([
      expect.objectContaining({
        tabId: session!.sessionId,
        url: 'https://example.com/a',
        source: 'agent',
        group: 'agent',
        phase: expect.any(String),
        control: 'agent',
      }),
    ])
  })

  it('省略 tabId 时默认操作自己的活动会话；activate 只换活动会话，不切文档页签', async () => {
    const runtime = new AgentBrowserRuntime()
    const store = fakeStore()
    const openWebTab = vi.fn(() => 'w:user-tab')
    const activateTab = vi.fn()
    const deps: BrowserDeps = {
      getLatest: () => store,
      set: () => {},
      openWebTab,
      activateTab,
      closeTab: () => {},
      webMeta: {},
      agentBrowser: runtime,
    }
    const ops = makeBrowserOps(deps, 'g1', OWNER)
    const opening = ops.open('https://example.com/a')
    await Promise.resolve()
    const session = runtime.list(OWNER)[0]!
    const wv = fakeWebview()
    await setWebview(runtime, session.sessionId, wv)
    await opening

    await expect(ops.index()).resolves.toMatchObject({ count: 1 })
    expect(activateTab).not.toHaveBeenCalled()
    expect(ops.activate(session.sessionId)).toEqual({ ok: true })
    expect(activateTab).not.toHaveBeenCalled()
    expect(runtime.activeFor(OWNER)?.sessionId).toBe(session.sessionId)
  })

  it('close 只关闭自己的 b: 会话；用户 w: 页签会被拒绝', async () => {
    const runtime = new AgentBrowserRuntime()
    const store = fakeStore()
    const closeTab = vi.fn()
    const deps: BrowserDeps = {
      getLatest: () => store,
      set: () => {},
      openWebTab: () => 'w:x',
      activateTab: () => {},
      closeTab,
      webMeta: {},
      agentBrowser: runtime,
    }
    const ops = makeBrowserOps(deps, 'g1', OWNER)
    const opening = ops.open('https://example.com/a')
    await Promise.resolve()
    const session = runtime.list(OWNER)[0]!
    await setWebview(runtime, session.sessionId, fakeWebview())
    await opening

    expect(ops.close(session.sessionId)).toEqual({ ok: true })
    expect(runtime.list(OWNER)).toEqual([])
    expect(closeTab).not.toHaveBeenCalled()
    expect(() => ops.close('w:user-tab')).toThrow(/不属于智能体浏览器/)
  })
})
