/**
 * 三平面 SuperAgent 核心类型契约
 *
 * 架构分层：
 * 1. Frontline Host：唯一面向用户的接待/分流中心，单轮调度，严格无长任务沙箱，负责意图理解、直答闲聊或秒级派发 Worker。
 * 2. Worker Pool：隔离工坊，负责深入长任务。拥有独立上下文与前缀门禁，结果零拷贝直出至前端。
 * 3. Mailbox & Blackboard：静默总线与共享黑板。Worker 产出静默入队 mailbox，随下次用户发消息前置注入 Host；元数据与产物索引沉淀至黑板。
 */

import type { AgentEvent, AgentTool, ConversationMessage } from '../types'
import type { ReasoningEffort, StreamFn } from '../../ai/types'
import type { ResolvedProvider } from '../../ai/client'

/** 隔离工坊 Worker 状态 */
export type WorkerStatus = 'idle' | 'running' | 'waiting_input' | 'done' | 'failed' | 'cancelled'

/** Worker 产物记录 */
export interface ArtifactRecord {
  id: string
  workerId: string
  title: string
  content: string
  kind: 'text' | 'code' | 'doc' | 'other'
  updatedAt: number
}

/** 控制面静默回执（Mailbox 条目） */
export interface WorkerReceipt {
  id: string
  workerId: string
  title: string
  status: 'done' | 'failed' | 'cancelled' | 'waiting_input'
  summary: string
  artifactIds: string[]
  ts: number
  /** 来源类型：内部 Worker 还是跨专家委派 */
  sourceType?: 'worker' | 'agent'
  sourceAgentId?: string
  sourceAgentName?: string
  delegationId?: string
}

/** 跨专家协作委派单输入契约 */
export interface DelegatedTaskInput {
  delegationId: string
  fromAgentId: string
  fromAgentName?: string
  task: string
  inputRefs?: string[]
  chain?: string[]
  hopCount?: number
  announceInChannel?: boolean
}

/** 跨专家协作委派单终态产出契约 */
export interface DelegationOutcome {
  delegationId: string
  status: 'done' | 'failed' | 'cancelled'
  summary: string
  artifactIds: string[]
  chatText?: string
}

/** 外置黑板条目（结构化索引） */
export interface BlackboardEntry {
  workerId: string
  title: string
  goal: string
  status: WorkerStatus
  summary: string
  artifactIds: string[]
  tags: string[]
  updatedAt: number
}

/** 隔离工坊 Worker 会话实体 */
export interface WorkerSession {
  id: string
  title: string
  goal: string
  status: WorkerStatus
  /** 工单挂起等待用户回答的提问提示（仅在 status === 'waiting_input' 时存在） */
  waitingPrompt?: string
  /** 完整的思考过程、工具调用与多跳历史（供 Worker 自行推理与 UI 折叠查看） */
  messages: ConversationMessage[]
  /** 面向人类的最新交付文本（剥离 mind 后的干净正文） */
  chatText: string
  /** 该 Worker 产出的所有结构化产物 */
  artifacts: ArtifactRecord[]
  createdAt: number
  updatedAt: number
  error?: string
}

/** SuperAgent 完整全局状态（单目标单一事实源） */
export interface SuperAgentState {
  id: string
  hostSystemPrompt: string
  hostMessages: ConversationMessage[]
  workers: Record<string, WorkerSession>
  mailbox: WorkerReceipt[]
  blackboard: BlackboardEntry[]
}

/** 运行时对外广播的强类型事件 */
export type SuperAgentEvent =
  | { type: 'host-start' }
  | { type: 'host-thinking'; delta: string }
  | { type: 'host-text-delta'; delta: string }
  | { type: 'host-tool-call'; id: string; name: string; args: string }
  | { type: 'host-tool-result'; id: string; name: string; result: string; ok: boolean }
  | { type: 'host-done'; content?: string; error?: string }
  | { type: 'worker-created'; worker: WorkerSession }
  | { type: 'worker-status'; workerId: string; status: WorkerStatus; error?: string }
  | { type: 'worker-mind-event'; workerId: string; event: AgentEvent; hop?: number }
  | { type: 'worker-chat-delta'; workerId: string; delta: string; hop?: number }
  | { type: 'worker-hop'; workerId: string; hop: number }
  | { type: 'worker-artifact-updated'; workerId: string; artifact: ArtifactRecord }
  | { type: 'worker-need-input'; workerId: string; prompt: string }
  | { type: 'mailbox-enqueued'; receipt: WorkerReceipt }

export interface SuperAgentEngineOptions {
  id?: string
  initialState?: Partial<SuperAgentState>
  provider: ResolvedProvider
  model: string
  effort?: ReasoningEffort
  contextWindow?: number
  /** 测试注入替身流，默认使用实际 client */
  chatFn?: StreamFn
  /** 工坊 Worker 可选工具集工厂（如 sandbox execute） */
  createWorkerTools?: (workerId: string) => AgentTool[]
  /** Frontline Host 额外控制面工具（如团队协作原语），稳定注入以满足前缀门禁 */
  extraHostTools?: AgentTool[]
  /** Worker 固化系统提示词（如角色专属工坊提示词），不传使用默认 */
  workerSystemPrompt?: string
  onEvent?: (event: SuperAgentEvent) => void
  onStateChange?: (state: SuperAgentState) => void
}
