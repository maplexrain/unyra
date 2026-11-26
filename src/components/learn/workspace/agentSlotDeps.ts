/**
 * AgentSlot 的宿主依赖形状。
 *
 * 从 AgentSlot 拆出来（文件体积门禁）：这个组件已经是「名册 + 对话 + 设置 + 群聊」的
 * 装配层，依赖多到足以单独成文件；类型留在这里，AgentSlot 只保留渲染与交互。
 */
import type { Dispatch, SetStateAction } from 'react'
import type { AgentTabRef, DocView, LearnStore, TabRef } from '../../../learn/types'
import type { Conversation } from '../../../agent/types'
import type { ReasoningEffort } from '../../../ai/types'
import type { loadAgentSettings } from '../../../agent/settings'
import type { useAgent } from '../../../learn/useAgent'
import type { useWorkflowStarters } from './useWorkflowStarters'

type AgentApi = ReturnType<typeof useAgent>
type StartersApi = ReturnType<typeof useWorkflowStarters>
type AgentSettings = ReturnType<typeof loadAgentSettings>

/**
 * agent 栏（左侧 Agent 列表——上块声部名册 + 下块当前声部对话历史 + 中间 keepalive 面板）需要的宿主能力与派生值。
 */
export interface AgentSlotDeps {
  store: LearnStore
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  agent: AgentApi
  /** 仅聊天模式的会话列表（learn/freeChat） */
  freeChats: Conversation[]
  currentFreeConvId: string | null
  setFreeConvId: Dispatch<SetStateAction<string | null>>
  onToast: (msg: string) => void
  openTab: (ref: TabRef, preferredView?: DocView) => void
  effort: ReasoningEffort
  setGlobalEffort: (next: ReasoningEffort) => void
  hasKey: boolean
  providerName: string
  vision: boolean
  agentSettings: AgentSettings
  setSettingsEpoch: Dispatch<SetStateAction<number>>
  /** 常挂面板的列表 = 全部页签 */
  agentPanes: AgentTabRef[]
  activeAgentTab: AgentTabRef
  activeAgentTabId: string | null
  activateAgentTab: (key: string) => void
  openAgentTab: (ref: AgentTabRef, activate?: boolean) => void
  selectTutorGoal: (goalId: string) => void
  handleNewGoalConversation?: (goalId?: string) => void
  removeConversation: (conversationId: string) => void
  newConversationIn?: (tab: AgentTabRef) => void
  selectConversationIn: (tab: AgentTabRef, conversationId: string) => void
  pruneImagesOf: (s: LearnStore) => void
  startSuperLab: StartersApi['startSuperLab']
  newExam: StartersApi['newExam']
  shouldWaitInLine: (convId: string) => boolean
  /** 宿主 Tab 页签是否当前可见（agentTeam 页签后台保活时降为 false，切回再激活） */
  tabActive?: boolean
  /** 若由目标专属智能体团队页签挂载，则固定绑定到该目标（仅聊天仍跨目标共享） */
  tabGoalId?: string
  /** 是否将左右侧栏折叠状态持久化到 localStorage（传送窗格中置为 false，避免影响原页签） */
  persistLayout?: boolean
}
