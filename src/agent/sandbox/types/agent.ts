/**
 * agent 组（role 共用）：只读的智能体名录。
 * 这里的 ops 只暴露查询，不提供改名 / 建删——身份归设置页，不归沙箱。
 */
import type { AgentDirectoryEntry } from '../../agentListing'

export interface AgentListOps {
  /** 已注册 agent 的 id / 名称 / 简介 */
  list: () => AgentDirectoryEntry[]
}
