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
}

export interface RoleWorkDispatcher {
  isConversationRunning: (conversationId: string) => boolean
  /** 目标 role 在当前目标下的会话；没有就 null（不自动建，交给宿主决定） */
  resolveRoleConversation: (role: AgentProfileId, goalId?: string | null) => string | null
  /** 起一轮；宿主负责按 role 走 runTurn / sendFree */
  startRoleTurn: (req: RoleTurnRequest) => void
  /** 只追加通道流水，不起轮（chat.send 的出站消息） */
  appendChannel: (conversationId: string, envelope: ChannelMessage) => void
}

let dispatcherGetter: (() => RoleWorkDispatcher | null) | null = null

export function setRoleWorkDispatcher(next: (() => RoleWorkDispatcher | null) | null): void {
  dispatcherGetter = next
}

function dispatcherOf(): RoleWorkDispatcher | null {
  return dispatcherGetter?.() ?? null
}

/** 等跳边界注入的通道消息（键 = role 会话） */
const pending = new Map<string, Array<{ req: RoleTurnRequest; stamp: ChannelStamp }>>()

/** 这一轮是否已经用 chat.send 对外说过话（收口兜底用） */
const spoke = new Set<string>()

export function resetChannelRegistry(): void {
  pending.clear()
  spoke.clear()
}

/** chat.send 成功落账后打点：这一轮不再自动补发 */
export function markRoleOutbound(conversationId: string): void {
  spoke.add(conversationId)
}

export function roleOutboundMade(conversationId: string): boolean {
  return spoke.has(conversationId)
}

/** 一轮真正开始时清掉上一轮的标记 */
export function clearRoleOutbound(conversationId: string): void {
  spoke.delete(conversationId)
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
 * 返回 true = 已起轮，false = 排队 / 无宿主。
 */
export function deliverInbound(req: RoleTurnRequest, envelope: ChannelMessage): boolean {
  const host = dispatcherOf()
  if (!host) return false
  host.appendChannel(req.conversationId, envelope)
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
  const list = pending.get(conversationId)
  const first = list?.shift()
  if (!first) return
  if (!list?.length) pending.delete(conversationId)
  host.startRoleTurn(first.req)
}
