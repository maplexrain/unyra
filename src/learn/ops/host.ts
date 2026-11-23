/**
 * work 的唯一回传通道：host.send。
 *
 * 接收 role 固定为创建这个 work 的 role（由闭包绑定，模型改不了）；
 * 交付进 role 的 Work 通道流水，空闲就起 role 一轮，运行中排到跳边界注入。
 */
import type { AgentProfileId } from '../../agent/agentProfile'
import type { ChannelPeer, ConversationMessage, WorkSession } from '../../agent/types'
import type { HostCallResult, HostSandboxApi, HostSendInput } from '../../agent/roleWork/types'
import { inboundEnvelope, peerOf } from '../roleWork/channels'
import { deliverInbound } from '../roleWork/dispatch'

export interface HostOpsDeps {
  work: WorkSession
  roleName: string
  /** role 会话里的消息 id（host.send 回指任务时用） */
  roleMessage: (messageId: string) => ConversationMessage | null
  appendChannel: (conversationId: string, msg: ReturnType<typeof inboundEnvelope>) => void
}

export function createHostOps(deps: HostOpsDeps): HostSandboxApi {
  return {
    send: (input: HostSendInput): HostCallResult => {
      const text = input.text.trim()
      if (!text) return { ok: false, error: 'host.send 需要 text（交付全文）' }
      const messageId = input.messageId?.trim()
      if (messageId && !deps.roleMessage(messageId)) {
        return { ok: false, error: 'role 会话里找不到消息「' + messageId + '」' }
      }
      const from: ChannelPeer = peerOf('work', deps.work.id, deps.work.name)
      const to: ChannelPeer = peerOf('agent', deps.work.roleId as AgentProfileId, deps.roleName)
      const envelope = inboundEnvelope({ channel: 'work', from, to, text })
      deliverInbound(
        {
          conversationId: deps.work.roleConversationId,
          role: deps.work.roleId,
          text,
          stamp: {
            channel: 'work',
            from,
            to,
            ts: envelope.ts,
            envelopeId: envelope.id,
          },
          envelopeId: envelope.id,
          ...(messageId ? { mark: '工作交付' } : {}),
        },
        envelope,
      )
      return { ok: true, delivered: true }
    },
  }
}
