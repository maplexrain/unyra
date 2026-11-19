/**
 * 智能体团队 (Agent Team) 类型契约
 */

export type AgentRoleType = 'leader' | 'researcher' | 'writer' | 'examiner' | 'reviewer' | 'custom'

export type AgentStatusType = 'active' | 'busy' | 'idle'

export interface TeamAgent {
  id: string
  name: string
  role: string
  roleType: AgentRoleType
  avatar: string
  avatarBg: string
  color: 'indigo' | 'emerald' | 'violet' | 'amber' | 'rose' | 'sky' | 'teal'
  status: AgentStatusType
  model: string
  systemPrompt: string
  capabilities: string[]
  description: string
  isLeader?: boolean
  isCustom?: boolean
  createdAt?: number
}

export interface ToolCallRecord {
  name: string
  args?: string
  result?: string
  ok?: boolean
}

export interface TeamMessage {
  id: string
  senderId: string // 'user' | agent.id
  senderName: string
  senderRole?: string
  avatar: string
  color?: string
  content: string
  thought?: string
  toolsCalled?: ToolCallRecord[]
  timestamp: number
  mentions?: string[] // agent IDs
  isGroupChat: boolean
  targetAgentId?: string // 仅当 1对1 专用聊天时设置
}

export type TeamChatSelection = 'group' | string // 'group' 或 agent.id
