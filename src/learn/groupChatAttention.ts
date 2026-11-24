/**
 * 群消息推送 → 智能体群聊页的跳转信号。
 *
 * App 层的推送组件只负责「有人 @用户」这件事；LearnWorkspace 负责把对应的
 * agentTeam 页签打开；AgentSlot 负责在页签本身落到正确目标后把群聊页选中。
 * 三个位置不在同一棵子树，因此用一个很小的模块级 pending + 订阅来传。
 */
export interface GroupChatOpenRequest {
  goalId: string
  messageId?: string
  /** 同一目标连续点两次也要能重新触发 */
  nonce: number
}

let pending: GroupChatOpenRequest | null = null
const listeners = new Set<(req: GroupChatOpenRequest) => void>()

/** App 推送点击：记下目标并通知当前挂着的页面。 */
export function requestOpenGroupChat(goalId: string, messageId?: string): void {
  const req: GroupChatOpenRequest = { goalId, messageId, nonce: Date.now() }
  pending = req
  for (const fn of listeners) fn(req)
}

export function subscribeOpenGroupChat(fn: (req: GroupChatOpenRequest) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * 目标页签挂载 / 已经挂载时取走一次待打开请求。
 * 只有目标匹配才取走，避免另一个目标的常驻 AgentSlot 把请求吞掉。
 */
export function consumeOpenGroupChat(goalId: string | null): GroupChatOpenRequest | null {
  if (!pending || !goalId || pending.goalId !== goalId) return null
  const req = pending
  pending = null
  return req
}
