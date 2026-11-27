/**
 * Agent Browser 会话池的纯逻辑用例：后台会话、owner 隔离、控制权、viewport、
 * 以及 target=_blank 的 guest 归属。不依赖真实 Electron webview。
 */
import { describe, expect, it, vi } from 'vitest'
import { AgentBrowserRuntime, type AgentBrowserWebview } from '../src/learn/web/agentBrowser'
import type { AgentBrowserOwner } from '../src/learn/web/agentBrowser'

function fakeWebview(result: unknown = { ok: true }) {
  let wcId = 71
  const executeJavaScript = vi.fn(async () => result)
  const capturePage = vi.fn(async () => ({ toDataURL: () => 'data:image/png;base64,AAAA' }))
  const wv: AgentBrowserWebview = {
    executeJavaScript,
    capturePage,
    getWebContentsId: () => wcId,
  }
  return { wv, executeJavaScript, capturePage, setWcId: (id: number) => (wcId = id) }
}

async function openWithFake(
  runtime: AgentBrowserRuntime,
  owner: AgentBrowserOwner,
  url: string,
  result: unknown = { ok: true },
) {
  const opening = runtime.open(owner, url)
  await Promise.resolve()
  const session = runtime.list(owner).find((s) => s.url === url)
  expect(session).toBeTruthy()
  const fake = fakeWebview(result)
  runtime.registerWebview(session!.sessionId, fake.wv)
  runtime.handleWebviewEvent(session!.sessionId, 'dom-ready')
  runtime.handleWebviewEvent(session!.sessionId, 'did-stop-loading')
  await opening
  return { sessionId: session!.sessionId, ...fake }
}

const OWNER: AgentBrowserOwner = { goalId: 'g1', role: 'researcher', roleName: '调研龟', conversationId: 'cv:researcher:g1' }

describe('AgentBrowserRuntime', () => {
  it('open 不创建 docArea 页签，只生成 b: 会话；tabs 可按 owner 列出并隔离', async () => {
    const runtime = new AgentBrowserRuntime()
    const { sessionId } = await openWithFake(runtime, OWNER, 'https://example.com/a')
    expect(sessionId.startsWith('b:')).toBe(true)

    const tabs = runtime.list(OWNER)
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({
      sessionId,
      url: 'https://example.com/a',
      owner: OWNER,
      active: true,
    })

    const other = runtime.list({ ...OWNER, role: 'tutor', conversationId: 'cv:tutor:g1' })
    expect(other).toEqual([])
  })

  it('重复打开同一 owner/URL 会复用会话，不重复创建', async () => {
    const runtime = new AgentBrowserRuntime()
    const first = await openWithFake(runtime, OWNER, 'https://example.com/a')
    const opening = runtime.open(OWNER, 'https://example.com/a')
    await opening
    expect(runtime.list(OWNER)).toHaveLength(1)
    expect(runtime.list(OWNER)[0].sessionId).toBe(first.sessionId)
  })

  it('控制权交给用户后，agent 的下一次动作会等待；交还后继续执行', async () => {
    const runtime = new AgentBrowserRuntime()
    const { sessionId, executeJavaScript } = await openWithFake(runtime, OWNER, 'https://example.com/a', { ok: 'executed' })

    runtime.setControl(sessionId, 'user')
    const pending = runtime.execute(sessionId, 'return 1', '读取正文')
    await new Promise((r) => setTimeout(r, 30))
    expect(executeJavaScript).not.toHaveBeenCalled()
    expect(runtime.get(sessionId)?.phase).toBe('waiting_user')

    runtime.setControl(sessionId, 'agent')
    await expect(pending).resolves.toEqual({ ok: 'executed' })
    expect(executeJavaScript).toHaveBeenCalledTimes(1)
    expect(runtime.get(sessionId)?.actions.at(-1)?.label).toBe('读取正文')
  })

  it('viewport 只记录当前展示矩形；关闭会话会清掉 dock/viewport', async () => {
    const runtime = new AgentBrowserRuntime()
    const { sessionId } = await openWithFake(runtime, OWNER, 'https://example.com/a')
    runtime.openDock(sessionId)
    runtime.setViewport(sessionId, { x: 12, y: 34, width: 480, height: 600 }, true)
    expect(runtime.getSnapshot().viewport).toMatchObject({ sessionId, visible: true, rect: { x: 12, y: 34 } })

    runtime.close(sessionId)
    expect(runtime.getSnapshot().sessions).toEqual([])
    expect(runtime.getSnapshot().dockSessionId).toBeNull()
    expect(runtime.getSnapshot().viewport).toBeNull()
  })

  it('guest 归属可反查 owner，target=_blank 不会落到用户页签', async () => {
    const runtime = new AgentBrowserRuntime()
    const { sessionId, wv } = await openWithFake(runtime, OWNER, 'https://example.com/a')
    runtime.rememberGuest(sessionId, wv)
    expect(runtime.ownerForGuest(71)).toEqual(OWNER)
    expect(runtime.ownerForGuest(999)).toBeNull()
  })

  it('收起 Dock 不关会话，并把用户接管交还给智能体', async () => {
    const runtime = new AgentBrowserRuntime()
    const { sessionId } = await openWithFake(runtime, OWNER, 'https://example.com/a')
    runtime.openDock(sessionId)
    runtime.setControl(sessionId, 'user')
    runtime.closeDock()
    expect(runtime.getSnapshot().dockSessionId).toBeNull()
    expect(runtime.get(sessionId)).toMatchObject({ control: 'agent' })
  })
})
