/**
 * 子代理的类型契约——实现搬进了 agent/types（它们是 Conversation.subagents 的持久化
 * 契约，与 ConversationMessage 同住一处），这里原样再转出一次：
 * 从 './types'（或 'agent/subagent/types'）取用这些符号的调用方一行都不用改。
 */
export type {
  SubAgentBucket,
  SubAgentDef,
  SubAgentSession,
  SubAgentStatus,
} from '../types'
