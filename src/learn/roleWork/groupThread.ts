/**
 * 群聊评论串路由（纯函数）：给「这条 agent 群消息落在哪」一个唯一答案。
 *
 * 口径（与 roleWorkGuide / groupChat 的索引格式一致）：
 * - 最终 @用户 的汇报：留一级，不进评论串；
 * - 最近一条群消息已经在评论串里：继续原串（threadRootId = 该串根消息）；
 * - 最近不在串里、且这条 @ 了某位 role：以本条消息为主楼，新开一条串；
 * - 没有目标、也不是汇报：不造串。
 *
 * 索引严格 `通道id>消息id`，由 learn/groupChat 的 groupThreadIdOf 生成。
 */
import { groupThreadIdOf, threadRootIdOf } from '../groupChat'

export interface GroupThreadPlanInput {
  goalId: string
  /** 本条新消息的 id（主楼场景用它当根） */
  messageId: string
  /** 自己会话里最近一条群消息的 threadId（可能是一级主楼，也可能是评论） */
  latestThreadId?: string
  /** 正文是否 @ 了用户 */
  mentionsUser: boolean
  /** 正文 @ 到的 role（不含用户） */
  targetIds: readonly string[]
}

export interface GroupThreadPlan {
  threadId?: string
  threadRootId?: string
}

export function planGroupThread(input: GroupThreadPlanInput): GroupThreadPlan {
  const targets = input.targetIds
  // @用户 的最终汇报留在一级；即使当前在评论串里也不拖回去。
  if (input.mentionsUser) return {}
  const latestRoot = input.latestThreadId ? threadRootIdOf(input.latestThreadId) : null
  const latestIsValid =
    Boolean(input.latestThreadId && latestRoot) &&
    input.latestThreadId === groupThreadIdOf(input.goalId, latestRoot as string)
  if (latestIsValid) {
    return { threadId: input.latestThreadId, threadRootId: latestRoot as string }
  }
  if (targets.length === 0) return {}
  return { threadId: groupThreadIdOf(input.goalId, input.messageId) }
}
