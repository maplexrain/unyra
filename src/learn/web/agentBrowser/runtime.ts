/**
 * 智能体浏览器会话池。
 *
 * 关键约束：
 * - 不碰 docArea / TabRef：agent 浏览器永远不生成网页页签，也不激活页面。
 * - 会话运行在全局 host 里，智能体页的「网页」页只负责把它的视口定位到屏幕。
 * - agent 只能操作自己 owner 的会话；用户网页页签由原来的 docArea 路径继续管理。
 */
import type {
  AgentBrowserActionInfo,
  AgentBrowserControl,
  AgentBrowserOwner,
  AgentBrowserPhase,
  AgentBrowserRect,
  AgentBrowserSessionInfo,
  AgentBrowserSnapshot,
  AgentBrowserViewport,
} from './types'

/** WebviewTag 中真正需要的结构；测试可以注入同形状的假对象。 */
export interface AgentBrowserWebview {
  executeJavaScript(code: string): Promise<unknown>
  capturePage(rect?: AgentBrowserRect): Promise<{ toDataURL(): string }>
  loadURL?(url: string): Promise<void>
  getURL?(): string
  getWebContentsId?(): number
}

interface ControlWaiter {
  resolve: () => void
  reject: (err: Error) => void
}

interface Session {
  sessionId: string
  owner: AgentBrowserOwner
  ownerKey: string
  url: string
  title: string
  favicon?: string
  loading: boolean
  phase: AgentBrowserPhase
  control: AgentBrowserControl
  currentAction?: string
  actions: AgentBrowserActionInfo[]
  createdAt: number
  lastActiveAt: number
  lastError?: string
  webview: AgentBrowserWebview | null
  domReady: boolean
  closed: boolean
  ready: Promise<void>
  resolveReady: () => void
  readyResolved: boolean
  controlWaiters: ControlWaiter[]
  actionSeq: number
}

const MAX_SESSIONS = 4
const MAX_SESSIONS_PER_OWNER = 2
const READY_TIMEOUT_MS = 12_000

let sessionSeq = 0

function nextSessionId(): string {
  sessionSeq += 1
  return `b:${Date.now().toString(36)}-${sessionSeq}`
}

function ownerKeyOf(owner: AgentBrowserOwner): string {
  return [owner.goalId ?? '', owner.role ?? '', owner.conversationId ?? ''].join('|')
}

function matchesOwner(session: Session, owner?: AgentBrowserOwner): boolean {
  if (!owner) return true
  if (owner.goalId !== undefined && owner.goalId !== null && owner.goalId !== session.owner.goalId) {
    return false
  }
  if (owner.role && owner.role !== session.owner.role) return false
  if (owner.conversationId && owner.conversationId !== session.owner.conversationId) return false
  return true
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function publicSession(session: Session, activeId: string | null): AgentBrowserSessionInfo {
  return {
    sessionId: session.sessionId,
    owner: session.owner,
    url: session.url,
    title: session.title,
    ...(session.favicon ? { favicon: session.favicon } : {}),
    loading: session.loading,
    phase: session.phase,
    control: session.control,
    ...(session.currentAction ? { currentAction: session.currentAction } : {}),
    actions: session.actions.slice(-12),
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    ...(session.lastError ? { lastError: session.lastError } : {}),
    active: activeId === session.sessionId,
  }
}

export class AgentBrowserRuntime {
  private readonly sessions = new Map<string, Session>()
  private readonly activeByOwner = new Map<string, string>()
  private readonly guestSessions = new Map<number, string>()
  private readonly listeners = new Set<() => void>()
  private shownSessionId: string | null = null
  private viewport: AgentBrowserViewport | null = null
  private version = 0
  private snapshot: AgentBrowserSnapshot = { sessions: [], shownSessionId: null, viewport: null, version: 0 }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): AgentBrowserSnapshot => this.snapshot

  private emit(): void {
    this.version += 1
    this.snapshot = {
      sessions: [...this.sessions.values()].map((s) =>
        publicSession(s, this.activeByOwner.get(s.ownerKey) ?? null),
      ),
      shownSessionId: this.shownSessionId,
      viewport: this.viewport,
      version: this.version,
    }
    for (const listener of this.listeners) listener()
  }

  private buildSession(owner: AgentBrowserOwner, url: string): Session {
    let resolveReady = () => {}
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve
    })
    return {
      sessionId: nextSessionId(),
      owner: { ...owner },
      ownerKey: ownerKeyOf(owner),
      url,
      title: '',
      loading: true,
      phase: 'loading',
      control: 'agent',
      actions: [],
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      webview: null,
      domReady: false,
      closed: false,
      ready,
      resolveReady,
      readyResolved: false,
      controlWaiters: [],
      actionSeq: 0,
    }
  }

  private markReady(session: Session): void {
    if (session.readyResolved) return
    session.readyResolved = true
    session.resolveReady()
  }

  private async waitReady(session: Session): Promise<void> {
    await Promise.race([
      session.ready,
      new Promise<void>((resolve) => setTimeout(resolve, READY_TIMEOUT_MS)),
    ])
  }

  async open(owner: AgentBrowserOwner, url: string): Promise<{ sessionId: string; url: string }> {
    const key = ownerKeyOf(owner)
    const existing = [...this.sessions.values()].find(
      (s) => !s.closed && s.ownerKey === key && s.url === url,
    )
    if (existing) {
      this.setActive(existing.sessionId)
      await this.waitReady(existing)
      if (existing.closed) throw new Error('智能体浏览器会话已被关闭：' + existing.sessionId)
      return { sessionId: existing.sessionId, url: existing.url }
    }

    this.evictForCapacity(key)
    const session = this.buildSession(owner, url)
    session.actions.push({
      id: ++session.actionSeq,
      label: '打开网页',
      detail: url,
      startedAt: Date.now(),
    })
    session.currentAction = '打开网页'
    this.sessions.set(session.sessionId, session)
    this.activeByOwner.set(key, session.sessionId)
    this.emit()

    await this.waitReady(session)
    if (session.closed) throw new Error('智能体浏览器会话已被关闭：' + session.sessionId)
    if (session.actions[0]) {
      session.actions[0].endedAt = Date.now()
      session.actions[0].ok = true
      session.currentAction = undefined
      session.lastError = undefined
      if (session.control !== 'agent') {
        session.phase = session.control === 'paused' ? 'paused' : 'waiting_user'
      } else if (session.loading) {
        session.phase = 'loading'
      } else {
        session.phase = 'idle'
      }
      this.emit()
    }
    return { sessionId: session.sessionId, url: session.url }
  }

  private evictForCapacity(ownerKey: string): void {
    const alive = (): Session[] => [...this.sessions.values()].filter((s) => !s.closed)
    const sameOwner = alive().filter((s) => s.ownerKey === ownerKey)
    if (sameOwner.length >= MAX_SESSIONS_PER_OWNER) {
      const victim = sameOwner
        .filter((s) => s.control === 'agent' && s.phase !== 'acting')
        .sort((a, b) => a.lastActiveAt - b.lastActiveAt)[0]
      if (!victim) throw new Error('当前智能体已有 2 个浏览器会话在忙，先关一个再开')
      this.close(victim.sessionId)
    }
    if (alive().length >= MAX_SESSIONS) {
      const victim = alive()
        .filter((s) => s.ownerKey !== ownerKey && s.control === 'agent' && s.phase !== 'acting')
        .sort((a, b) => a.lastActiveAt - b.lastActiveAt)[0]
      if (!victim) throw new Error('智能体浏览器已有 4 个会话在忙，先关一个再开')
      this.close(victim.sessionId)
    }
  }

  list(owner?: AgentBrowserOwner): AgentBrowserSessionInfo[] {
    const activeId = this.activeByOwner.get(owner ? ownerKeyOf(owner) : '') ?? null
    const list = [...this.sessions.values()]
      .filter((s) => !s.closed && matchesOwner(s, owner))
      .sort((a, b) => a.createdAt - b.createdAt)
    return list.map((s) => publicSession(s, activeId))
  }

  get(sessionId: string): AgentBrowserSessionInfo | null {
    const s = this.sessions.get(sessionId)
    if (!s || s.closed) return null
    return publicSession(s, this.activeByOwner.get(s.ownerKey) ?? null)
  }

  activeFor(owner: AgentBrowserOwner): AgentBrowserSessionInfo | null {
    const key = ownerKeyOf(owner)
    const activeId = this.activeByOwner.get(key)
    if (activeId) {
      const s = this.sessions.get(activeId)
      if (s && !s.closed) return publicSession(s, activeId)
    }
    const first = this.list(owner)[0]
    return first ?? null
  }

  setActive(sessionId: string): void {
    const s = this.requireSession(sessionId)
    this.activeByOwner.set(s.ownerKey, sessionId)
    s.lastActiveAt = Date.now()
    this.emit()
  }

  showSession(sessionId: string): void {
    const s = this.requireSession(sessionId)
    const prev = this.shownSessionId ? this.sessions.get(this.shownSessionId) : null
    // 用户从 A 切到 B：A 的接管状态不能把 A 的智能体永久卡住
    if (prev && prev.sessionId !== sessionId && prev.control === 'user') {
      this.setControl(prev.sessionId, 'agent')
    }
    if (this.viewport && this.viewport.sessionId !== sessionId) this.viewport = null
    this.shownSessionId = sessionId
    this.activeByOwner.set(s.ownerKey, sessionId)
    s.lastActiveAt = Date.now()
    this.emit()
  }

  hideSession(): void {
    if (this.shownSessionId === null && this.viewport === null) return
    const shown = this.shownSessionId ? this.sessions.get(this.shownSessionId) : null
    // 关掉「网页」页 = 用户不再直接操作；接管权交还给智能体，避免 work 永久卡在等待
    if (shown && shown.control === 'user') this.setControl(shown.sessionId, 'agent')
    if (this.viewport && this.viewport.sessionId === this.shownSessionId) this.viewport = null
    this.shownSessionId = null
    this.emit()
  }

  close(sessionId: string | string[]): void {
    const ids = Array.isArray(sessionId) ? sessionId : [sessionId]
    for (const id of ids) {
      const s = this.sessions.get(id)
      if (!s || s.closed) continue
      s.closed = true
      s.webview = null
      s.phase = 'done'
      s.currentAction = undefined
      // 关会话时唤醒 open 的 ready 等待，让调用方立即看到「已关闭」而不是等超时
      s.resolveReady()
      for (const [wcId, sid] of this.guestSessions) {
        if (sid === id) this.guestSessions.delete(wcId)
      }
      for (const waiter of s.controlWaiters) waiter.reject(new Error('智能体浏览器会话已关闭'))
      s.controlWaiters = []
      this.sessions.delete(id)
      if (this.activeByOwner.get(s.ownerKey) === id) this.activeByOwner.delete(s.ownerKey)
      if (this.shownSessionId === id) this.shownSessionId = null
      if (this.viewport?.sessionId === id) this.viewport = null
    }
    this.emit()
  }

  closeAll(): void {
    this.close([...this.sessions.keys()])
  }

  /** 供 browserOps 在关闭前检查 owner，避免别的 agent 误关/误操作。 */
  isOwnedBy(sessionId: string, owner: AgentBrowserOwner): boolean {
    const s = this.sessions.get(sessionId)
    return !!s && !s.closed && matchesOwner(s, owner)
  }

  private requireSession(sessionId: string): Session {
    const s = this.sessions.get(sessionId)
    if (!s || s.closed) throw new Error('没有这个智能体浏览器会话：' + sessionId)
    return s
  }

  registerWebview(sessionId: string, webview: AgentBrowserWebview | null): void {
    const s = this.sessions.get(sessionId)
    if (!s || s.closed) return
    s.webview = webview
    if (webview && s.domReady) this.markReady(s)
    if (webview) this.rememberGuest(sessionId, webview)
  }

  /** dom-ready 后 webContents id 才稳定；用于把 target=_blank 的弹窗接回自己的会话。 */
  rememberGuest(sessionId: string, webview: AgentBrowserWebview | null): void {
    if (!webview || typeof webview.getWebContentsId !== 'function') return
    try {
      const id = webview.getWebContentsId()
      if (Number.isFinite(id)) this.guestSessions.set(id, sessionId)
    } catch {
      // webview 还没 attach，dom-ready 后还会再登记一次
    }
  }

  ownerForGuest(webContentsId: number): AgentBrowserOwner | null {
    const sessionId = this.guestSessions.get(webContentsId)
    if (!sessionId) return null
    const s = this.sessions.get(sessionId)
    return s && !s.closed ? { ...s.owner } : null
  }

  webviewOf(sessionId: string): AgentBrowserWebview | null {
    return this.sessions.get(sessionId)?.webview ?? null
  }

  handleWebviewEvent(sessionId: string, event: string, payload?: unknown): void {
    const s = this.sessions.get(sessionId)
    if (!s || s.closed) return
    s.lastActiveAt = Date.now()
    if (event === 'dom-ready') {
      s.domReady = true
      this.markReady(s)
    } else if (event === 'did-start-loading') {
      s.loading = true
      s.lastError = undefined
      if (s.control === 'agent' && s.phase !== 'acting') s.phase = 'loading'
    } else if (event === 'did-stop-loading') {
      s.loading = false
      if (s.control === 'agent' && s.phase === 'loading') s.phase = 'idle'
      this.markReady(s)
    } else if (event === 'did-navigate' || event === 'did-navigate-in-page') {
      const url = (payload as { url?: string } | undefined)?.url
      if (url) s.url = url
    } else if (event === 'page-title-updated') {
      const title = (payload as { title?: string } | undefined)?.title
      if (title) s.title = title
    } else if (event === 'page-favicon-updated') {
      const favicons = (payload as { favicons?: string[] } | undefined)?.favicons
      if (favicons?.[0]) s.favicon = favicons[0]
    } else if (event === 'did-fail-load') {
      const p = payload as { errorDescription?: string; isMainFrame?: boolean } | undefined
      if (p?.isMainFrame === false) return
      s.loading = false
      s.phase = 'error'
      s.lastError = p?.errorDescription || '页面加载失败'
    } else if (event === 'render-process-gone') {
      s.loading = false
      s.phase = 'error'
      s.lastError = '网页渲染进程已退出'
    }
    this.emit()
  }

  setControl(sessionId: string, control: AgentBrowserControl): void {
    const s = this.requireSession(sessionId)
    s.control = control
    s.lastActiveAt = Date.now()
    if (control === 'user') s.phase = 'waiting_user'
    else if (control === 'paused') s.phase = 'paused'
    else s.phase = s.loading ? 'loading' : 'idle'
    if (control === 'agent') {
      for (const waiter of s.controlWaiters) waiter.resolve()
      s.controlWaiters = []
    }
    this.emit()
  }

  setViewport(sessionId: string, rect: AgentBrowserRect, visible: boolean): void {
    const s = this.sessions.get(sessionId)
    if (!s || s.closed) return
    const next = { sessionId, rect: { ...rect }, visible }
    const cur = this.viewport
    if (
      cur &&
      cur.sessionId === next.sessionId &&
      cur.visible === next.visible &&
      cur.rect.x === next.rect.x &&
      cur.rect.y === next.rect.y &&
      cur.rect.width === next.rect.width &&
      cur.rect.height === next.rect.height
    ) {
      return
    }
    this.viewport = next
    this.emit()
  }

  clearViewport(sessionId?: string): void {
    if (!this.viewport) return
    if (sessionId && this.viewport.sessionId !== sessionId) return
    this.viewport = null
    this.emit()
  }

  private async waitForAgentControl(session: Session): Promise<void> {
    while (session.control !== 'agent') {
      if (session.closed) throw new Error('智能体浏览器会话已关闭')
      await new Promise<void>((resolve, reject) => {
        session.controlWaiters.push({ resolve, reject })
      })
    }
  }

  private beginAction(session: Session, label: string, detail?: string): AgentBrowserActionInfo {
    const action: AgentBrowserActionInfo = {
      id: ++session.actionSeq,
      label,
      ...(detail ? { detail } : {}),
      startedAt: Date.now(),
    }
    session.actions.push(action)
    if (session.actions.length > 50) session.actions.splice(0, session.actions.length - 50)
    session.currentAction = label
    session.phase = 'acting'
    session.lastActiveAt = Date.now()
    this.emit()
    return action
  }

  private finishAction(session: Session, action: AgentBrowserActionInfo, err?: unknown): void {
    action.endedAt = Date.now()
    action.ok = !err
    if (err) action.error = errorMessage(err)
    session.currentAction = undefined
    if (err) {
      session.phase = 'error'
      session.lastError = errorMessage(err)
    } else {
      session.lastError = undefined
      if (session.control !== 'agent') {
        session.phase = session.control === 'paused' ? 'paused' : 'waiting_user'
      } else if (session.loading) {
        session.phase = 'loading'
      } else {
        session.phase = 'idle'
      }
    }
    this.emit()
  }

  async execute(sessionId: string, code: string, label: string, detail?: string): Promise<unknown> {
    const session = this.requireSession(sessionId)
    await this.waitForAgentControl(session)
    if (session.closed) throw new Error('智能体浏览器会话已关闭')
    const action = this.beginAction(session, label, detail)
    try {
      let webview = session.webview
      if (!webview) {
        await this.waitForWebview(session)
        webview = session.webview
      }
      if (!webview) throw new Error('网页尚未挂载，稍后重试')
      const result = await webview.executeJavaScript(code)
      this.finishAction(session, action)
      return result
    } catch (err) {
      this.finishAction(session, action, err)
      throw err
    }
  }

  async capturePage(sessionId: string, rect?: AgentBrowserRect): Promise<{ toDataURL(): string }> {
    const session = this.requireSession(sessionId)
    await this.waitForAgentControl(session)
    const webview = session.webview ?? (await this.waitForWebview(session))
    if (!webview) throw new Error('网页尚未挂载，稍后重试')
    return await webview.capturePage(rect)
  }

  private async waitForWebview(session: Session): Promise<AgentBrowserWebview> {
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (!session.webview && !session.closed && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    if (session.closed) throw new Error('智能体浏览器会话已关闭')
    if (!session.webview) throw new Error('网页尚未挂载，稍后重试')
    return session.webview
  }
}

/** 全局单例：LearnWorkspace 的 browser deps 与 App 根部的 host 都从这里取。 */
export const agentBrowserRuntime = new AgentBrowserRuntime()
