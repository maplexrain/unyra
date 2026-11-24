/**
 * role-work 的通道派发器。
 *
 * 与旧 team 注册表的区别：这里没有「委托、排队、承接、complete」——只有**通道消息**
 * 和「目标空闲就起一轮 / 运行中就在跳边界注入」。启动一轮永远是宿主（useAgent）的事，
 * 本模块只负责落账、排队与唤醒，经 getter 取最新宿主闭包。
 */
import type { AgentProfileId } from '../../agent/agentProfile'
import type { ChannelMessage, ChannelStamp, ConversationMessage } from '../../agent/types'
import { channelTextOf } from './channels'

export interface RoleTurnRequest {
  conversationId: string
  role: AgentProfileId
  goalId?: string
  /** 入站正文（纯文本；模型历史里会补来源戳） */
  text: string
  stamp: ChannelStamp
  /** 通道流水 id（注入片段与历史镜像用） */
  envelopeId: string
  hidden?: boolean
  mark?: string
  images?: ConversationMessage['images']
  files?: ConversationMessage['files']
  /** Work / role 转发带来的交付账；随入站消息落到 mind 消息里 */
  delivery?: ChannelMessage['delivery']
}

export interface RoleWorkDispatcher {
  isConversationRunning: (conversationId: string) => boolean
  /** 目标 role 在当前目标下的会话；没有就 null（不自动建，交给宿主决定） */
  resolveRoleConversation: (role: AgentProfileId, goalId?: string | null) => string | null
  /** 起一轮；宿主负责按 role 走 runTurn / sendFree */
  startRoleTurn: (req: RoleTurnRequest) => void
  /** 只追加通道流水，不起轮（chat.send 的出站消息） */
  appendChannel: (conversationId: string, envelope: ChannelMessage) => void
  /**
   * 静默入站：把消息只追加到目标会话的上下文，不启动一轮、不进排队。
   * 通道流水由 deliverInbound 先落；没有实现时退化为「只落通道流水」——老宿主不会因此崩，
   * 但上下文里看不到。
   */
  appendSilentInbound?: (req: RoleTurnRequest, envelope: ChannelMessage) => void
}

let dispatcherGetter: (() => RoleWorkDispatcher | null) | null = null

export function setRoleWorkDispatcher(next: (() => RoleWorkDispatcher | null) | null): void {
  dispatcherGetter = next
}

/** 宿主是否已注册（free 的 work 交付决定走通道还是落旧账的判据） */
export function hasRoleWorkDispatcher(): boolean {
  return dispatcherGetter?.() != null
}

function dispatcherOf(): RoleWorkDispatcher | null {
  return dispatcherGetter?.() ?? null
}

/** 等跳边界注入的通道消息（键 = role 会话） */
const pending = new Map<string, Array<{ req: RoleTurnRequest; stamp: ChannelStamp }>>()

/** 静默汇报：目标正在跑时先挂起，等这一轮收口后只写上下文，不起新轮 */
const silentPending = new Map<string, Array<{ req: RoleTurnRequest; envelope: ChannelMessage }>>()

export function resetChannelRegistry(): void {
  pending.clear()
  silentPending.clear()
}

export function enqueueInjection(req: RoleTurnRequest): number {
  const list = pending.get(req.conversationId) ?? []
  list.push({ req, stamp: req.stamp })
  pending.set(req.conversationId, list)
  return list.length
}

/** 取走一条待注入消息；返回给 runtime 的 user 正文已经带来源戳 */
export function takeChannelInjection(conversationId: string): { envelopeId: string; text: string } | null {
  const list = pending.get(conversationId)
  const first = list?.shift()
  if (!first) return null
  if (!list?.length) pending.delete(conversationId)
  return { envelopeId: first.req.envelopeId, text: channelTextOf(first.stamp, first.req.text) }
}

export function hasChannelInjection(conversationId: string): boolean {
  return (pending.get(conversationId)?.length ?? 0) > 0
}

/**
 * 投递一条入站消息：先落通道流水，再按目标忙闲决定起轮或排队。
 * silent = true 时只落流水 + 写进目标上下文，既不排队也不起轮。
 * 返回 true = 已起轮，false = 排队 / 静默 / 无宿主。
 */
export function deliverInbound(
  req: RoleTurnRequest,
  envelope: ChannelMessage,
  opts?: { silent?: boolean },
): boolean {
  const host = dispatcherOf()
  if (!host) return false
  host.appendChannel(req.conversationId, envelope)
  if (opts?.silent) {
    // 目标正在跑：先挂起，等这一轮收口后由 flushChannelInbox 只写上下文，绝不插队起轮。
    // 空闲时直接写进 messages；下一轮组历史时自然带上 channel stamp。
    if (host.isConversationRunning(req.conversationId)) {
      const list = silentPending.get(req.conversationId) ?? []
      list.push({ req, envelope })
      silentPending.set(req.conversationId, list)
    } else {
      host.appendSilentInbound?.(req, envelope)
    }
    return false
  }
  if (host.isConversationRunning(req.conversationId)) {
    enqueueInjection(req)
    return false
  }
  host.startRoleTurn(req)
  return true
}

/** 一轮收口：若还有没消费的通道消息且会话空闲，接续下一轮（不丢消息） */
export function flushChannelInbox(conversationId: string): void {
  const host = dispatcherOf()
  if (!host || host.isConversationRunning(conversationId)) return
  // 先把挂起的静默汇报写进上下文；它们只入历史，不改变「下面要不要起下一轮」。
  const silent = silentPending.get(conversationId)
  if (silent?.length) {
    silentPending.delete(conversationId)
    for (const item of silent) host.appendSilentInbound?.(item.req, item.envelope)
  }
  const list = pending.get(conversationId)
  const first = list?.shift()
  if (!first) return
  if (!list?.length) pending.delete(conversationId)
  host.startRoleTurn(first.req)
}
