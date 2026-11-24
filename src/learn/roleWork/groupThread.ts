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
import type { ChannelStamp } from '../../agent/types'
import { groupThreadIdOf, threadRootIdOf } from '../groupChat'

/**
 * 回复时该沿哪条串：以这一轮收到的群消息为准，而不是角色会话里「最后一条群消息」。
 *
 * 后者会把「对某条一级主楼的回执」误当成一条新主楼——尤其是调度龟刚把任务派到
 * 导师龟、导师龟马上回执时，会话里最新一条其实已经是这条派单主楼；如果中间又
 * 插入了别的群消息，按「最新」找还会漂到别的串。来源消息自带的 threadId 是唯一
 * 可靠的锚点：在评论串里回执就继续原串，一级派单则沿派单主楼开出的串。
 *
 * 非群聊轮次保留旧的 latestThreadId 兜底（私聊 / work 被唤醒后往群里发消息的历史
 * 行为不变）。
 */
export function replyThreadIdOf(input: {
  /** 本轮入站消息的来源信息；只有 group 通道的 threadId 能当锚点 */
  channel?: ChannelStamp
  /** 旧兜底：角色会话里最近一条群消息的 threadId */
  latestThreadId?: string
}): string | undefined {
  if (input.channel?.channel === 'group') {
    if (input.channel.threadId) return input.channel.threadId
    if (input.channel.threadRootId && input.channel.goalId) {
      return groupThreadIdOf(input.channel.goalId, input.channel.threadRootId)
    }
    return undefined
  }
  return input.latestThreadId
}

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
