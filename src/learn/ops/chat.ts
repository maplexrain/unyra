/**
 * role 的 chat.send：把对话发到 user / agent / work 三种通道。
 *
 * 只有 role 注入这一组；work 注入的是 host.send（见 learn/ops/host）。
 * 通道流水由宿主落账，来源与时间戳由这里写死，模型不能改。
 */
import type { AgentProfileId } from '../../agent/agentProfile'
import type { ChannelMessage, ChannelPeer, Conversation, ConversationMessage } from '../../agent/types'
import type { ChatCallResult, ChatSandboxApi, ChatSendInput } from '../../agent/roleWork/types'
import { inboundEnvelope, outboundEnvelope, peerOf, stampLineOf, userPeer } from '../roleWork/channels'
import { deliverInbound, markRoleOutbound } from '../roleWork/dispatch'

export interface ChatOpsDeps {
  roleId: AgentProfileId
  roleName: string
  conversationId: string
  goalId?: string
  getConversation: (id: string) => Conversation | null
  appendChannel: (conversationId: string, msg: ChannelMessage) => void
  /** 用户通道的收件人（界面里的用户） */
  userPeer: () => ChannelPeer
  /** agent 通道解析目标 role 会话；返回 null 时不投递 */
  resolveRoleConversation: (role: AgentProfileId, goalId?: string | null) => string | null
  /** agent 通道没有现成会话时就地落一段（role-work 的独立会话） */
  ensureRoleConversation: (role: AgentProfileId, goalId: string) => string
  roleNameOf: (role: AgentProfileId) => string
  /** role 会话里的消息（messageId 引用 / 转发） */
  messageOf: (messageId: string) => ConversationMessage | null
  /** 附件解析（可异步：外链要先下载）；失败时返回 error，整笔拒绝 */
  resolveAttachments: (
    items: NonNullable<ChatSendInput['attachments']>,
  ) =>
    | { images?: ConversationMessage['images']; files?: ConversationMessage['files'] }
    | { error: string }
    | Promise<{ images?: ConversationMessage['images']; files?: ConversationMessage['files'] } | { error: string }>
  /** work 通道：委托给管理器（它自己负责落 outbound 流水） */
  sendToWork: (
    name: string,
    text: string,
    messageId?: string,
    attachments?: { images?: ConversationMessage['images']; files?: ConversationMessage['files'] },
  ) => ChatCallResult | Promise<ChatCallResult>
  /**
   * group 通道：落群聊流水，并把同一句话投给被 @ 的 role（它们各自的 mind 共用一条会话）。
   * 实现方负责检查正文确有 `@名字`；没有点名时只留在群里（不投给任何 role）。
   */
  sendToGroup: (input: {
    text: string
    mentions?: string[]
    messageId?: string
    attachments?: { images?: ConversationMessage['images']; files?: ConversationMessage['files'] }
  }) => ChatCallResult | Promise<ChatCallResult>
}

function quoteBlock(message: ConversationMessage | null): string {
  if (!message) return ''
  const text = message.parts.filter((p) => p.type === 'text').map((p) => p.text).join('').trim()
  const stamp = message.channel ?? {
    channel: 'user' as const,
    from: userPeer(),
    to: { kind: 'role' as const, id: '', name: '' },
    ts: message.ts,
    envelopeId: message.id,
  }
  return '【引用 ' + stampLineOf(stamp) + '】\n' + text
}

export function createChatOps(deps: ChatOpsDeps): ChatSandboxApi {
  return {
    send: async (input) => {
      const channel = input.channel
      if (channel !== 'user' && channel !== 'agent' && channel !== 'work' && channel !== 'group') {
        return { ok: false, error: 'chat.send 的 channel 只能是 user / agent / work / group' }
      }
      // 群聊来源的任务必须沿群通道回复/委派：最近一条外部入站是 group 时，不能改成 user 私聊或 agent 私聊。
      // Work 通道不算外部来源（它只是 work 交回的过程消息），所以不在这里拦。
      const conversation = deps.getConversation(deps.conversationId)
      const lastInbound = [...(conversation?.channels ?? [])]
        .reverse()
        .find((m) => m.direction === 'in' && m.kind !== 'work')
      if (lastInbound?.kind === 'group' && (channel === 'user' || channel === 'agent')) {
        return {
          ok: false,
          error: '最近一条消息来自群聊：回复或委派都必须走 group 通道（正文显式 @目标名）',
        }
      }
      const text = input.text.trim()
      const messageId = input.messageId?.trim()
      if (!text && !messageId) return { ok: false, error: 'chat.send 需要 text 或 messageId' }
      const quoted = messageId ? deps.messageOf(messageId) : null
      if (messageId && !quoted) return { ok: false, error: '当前 role 会话里找不到消息「' + messageId + '」' }
      const body = [text, quoteBlock(quoted)].filter(Boolean).join('\n\n')
      const resolved = input.attachments?.length ? await deps.resolveAttachments(input.attachments) : undefined
      if (resolved && 'error' in resolved) return { ok: false, error: resolved.error }
      const attachments = resolved && !('error' in resolved) ? {
        ...(resolved.images?.length ? { images: resolved.images } : {}),
        ...(resolved.files?.length ? { files: resolved.files } : {}),
      } : undefined
      const from = peerOf('agent', deps.roleId, deps.roleName)

      if (channel === 'work') {
        if (!input.to) return { ok: false, error: 'chat.send 到 work 通道需要 to（work 名）' }
        const result = await deps.sendToWork(input.to, body, messageId, attachments)
        if (result.ok) markRoleOutbound(deps.conversationId)
        return result
      }

      if (channel === 'user') {
        const envelope = outboundEnvelope({
          channel: 'user',
          from,
          to: deps.userPeer(),
          text: body,
          ...(attachments && (attachments.images || attachments.files) ? { attachments } : {}),
          ...(messageId ? { quoteMessageId: messageId } : {}),
        })
        deps.appendChannel(deps.conversationId, envelope)
        markRoleOutbound(deps.conversationId)
        return { ok: true, channel, id: envelope.id }
      }

      if (channel === 'group') {
        if (!deps.goalId) return { ok: false, error: '当前 role 会话不挂在目标上，无法进入群聊' }
        const targets = [...(input.mentions ?? [])]
        if (input.to?.trim()) targets.push(input.to.trim())
        const result = await deps.sendToGroup({
          text: body,
          ...(targets.length ? { mentions: [...new Set(targets)] } : {}),
          ...(messageId ? { messageId } : {}),
          ...(attachments ? { attachments } : {}),
        })
        if (result.ok) markRoleOutbound(deps.conversationId)
        return result
      }

      const to = input.to as AgentProfileId | undefined
      if (!to) return { ok: false, error: 'chat.send 到 agent 通道需要 to（目标 role id）' }
      if (!deps.goalId) return { ok: false, error: '当前 role 会话不挂在目标上，无法建立 agent 通道' }
      const targetConvId =
        deps.resolveRoleConversation(to, deps.goalId) ?? deps.ensureRoleConversation(to, deps.goalId)
      const targetPeer = peerOf('agent', to, deps.roleNameOf(to))
      // 自己的通道流水也记一条 outbound：对话层要能看见「我发给了谁」
      deps.appendChannel(
        deps.conversationId,
        outboundEnvelope({
          channel: 'agent',
          from,
          to: targetPeer,
          text: body,
          ...(attachments && (attachments.images || attachments.files) ? { attachments } : {}),
          ...(messageId ? { quoteMessageId: messageId } : {}),
        }),
      )
      const envelope = inboundEnvelope({
        channel: 'agent',
        from,
        to: targetPeer,
        text: body,
        ...(attachments && (attachments.images || attachments.files) ? { attachments } : {}),
      })
      deliverInbound(
        {
          conversationId: targetConvId,
          role: to,
          goalId: deps.goalId,
          text: body,
          stamp: {
            channel: 'agent',
            from,
            to: targetPeer,
            ts: envelope.ts,
            envelopeId: envelope.id,
          },
          envelopeId: envelope.id,
          ...(attachments?.images ? { images: attachments.images } : {}),
          ...(attachments?.files ? { files: attachments.files } : {}),
        },
        envelope,
      )
      markRoleOutbound(deps.conversationId)
      return { ok: true, channel, to, id: envelope.id }
    },
  }
}
