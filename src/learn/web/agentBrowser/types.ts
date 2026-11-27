/**
 * Agent Browser 的类型契约。
 *
 * 这是「智能体自己管理的浏览器」而不是文档区网页页签：会话由 AgentBrowserRuntime
 * 持有，页面由全局 AgentBrowserHost 常驻承载，智能体页里的「网页」页只是视口。
 */

export type AgentBrowserControl = 'agent' | 'user' | 'paused'

export type AgentBrowserPhase =
  | 'idle'
  | 'loading'
  | 'acting'
  | 'waiting_user'
  | 'paused'
  | 'done'
  | 'error'

export interface AgentBrowserOwner {
  goalId?: string | null
  /** 角色 id（tutor / researcher / designer ...） */
  role?: string
  /** 角色显示名，网页页直接展示，不必再查设置 */
  roleName?: string
  /** 当前 role 会话 id；同一 role 跨 work 共享浏览器 */
  conversationId?: string | null
}

export interface AgentBrowserActionInfo {
  id: number
  label: string
  detail?: string
  startedAt: number
  endedAt?: number
  ok?: boolean
  error?: string
}

export interface AgentBrowserSessionInfo {
  sessionId: string
  owner: AgentBrowserOwner
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
  /** 当前 owner 的活动会话 */
  active: boolean
}

export interface AgentBrowserRect {
  x: number
  y: number
  width: number
  height: number
}

export interface AgentBrowserViewport {
  sessionId: string
  rect: AgentBrowserRect
  visible: boolean
}

export interface AgentBrowserSnapshot {
  sessions: AgentBrowserSessionInfo[]
  /** 当前在「网页」页里展示的会话；空表示页面未打开 */
  shownSessionId: string | null
  viewport: AgentBrowserViewport | null
  version: number
}
