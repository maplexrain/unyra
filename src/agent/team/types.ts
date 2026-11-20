/**
 * 多 Agent 协作与 TeamBus 核心类型契约
 *
 * 架构：
 * 1. TeamAgentProfile：每个专业 Agent 的静态画像、能力标签与沙箱权限白名单；
 * 2. ChannelMessage：协作频道（group）协作流，多 Agent 广播与用户主控视口；
 * 3. DelegationRecord：跨 Agent 异步委派单记录与结算账本；
 * 4. TeamState：多 Agent 团队全局状态（花名册、频道历史、委派记录）。
 */

import type { SuperAgentState } from '../super/types'

export type TeamAgentColor = 'indigo' | 'emerald' | 'violet' | 'amber' | 'rose' | 'sky' | 'teal'

export interface TeamAgentProfile {
  id: string
  name: string
  role: string
  roleType: 'leader' | 'researcher' | 'writer' | 'examiner' | 'director' | 'lab' | 'custom'
  avatar: string
  color: TeamAgentColor
  isLeader?: boolean
  description: string
  capabilities: string[]
  /** 该 Agent 的 Worker 允许调用的沙箱 API 组（硬禁 subagent） */
  allowedApiGroups: string[]
  /** 差异化 Frontline Host 角色提示词 */
  hostPromptRole: string
  /** 差异化 Worker 角色提示词 */
  workerPromptRole?: string
}

export interface DelegationRecord {
  id: string
  fromAgentId: string
  fromAgentName: string
  targetAgentId: string
  targetAgentName: string
  task: string
  inputRefs?: string[]
  chain: string[]
  hopCount: number
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
  summary?: string
  artifactIds?: string[]
  createdAt: number
  settledAt?: number
  error?: string
}

export interface ChannelMessage {
  id: string
  senderId: string // 'user' | agentId
  senderName: string
  avatar: string
  color?: string
  content: string
  timestamp: number
  isAnnouncement?: boolean
  delegationId?: string
  mentions?: string[]
  /** 指向可点开在右侧交付面板查看的 Agent ID 与 Worker ID */
  refAgentId?: string
  refWorkerId?: string
  briefSummary?: string
  /** 领取该消息的 Agent 列表（用于用户气泡下方显示认领者头像） */
  claimedBy?: Array<{ id: string; name: string; avatar: string; color?: string }>
  /** 消息引用/回复链路 */
  replyToId?: string
  replyToSender?: string
  replyToSnippet?: string
}

export interface TeamState {
  scopeId: string
  agents: TeamAgentProfile[]
  channelMessages: ChannelMessage[]
  delegations: Record<string, DelegationRecord>
  updatedAt: number
}

export type TeamEvent =
  | { type: 'channel-message'; message: ChannelMessage }
  | { type: 'delegation-created'; record: DelegationRecord }
  | { type: 'delegation-updated'; record: DelegationRecord }
  | { type: 'agent-state-changed'; agentId: string; state: SuperAgentState }
