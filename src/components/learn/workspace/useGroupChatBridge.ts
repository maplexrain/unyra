/**
 * 群聊与宿主 store 的桥：把群聊流水订阅、按目标过滤、用户发言投递从 AgentSlot 拆出来。
 *
 * 群聊是独立账本（learn/groupChat），role 的私聊 / mind 是另一套会话；这里只负责：
 * - 读群聊流水并按当前目标过滤；
 * - 用户群聊发言时先落群流水，再给被 @ 的 role 各投一条 `channel:'group'` 入站消息。
 *
 * 放在独立模块是为了让 AgentSlot 保持「读 props → 组织布局」的薄壳，不把通道细节堆回去。
 */
import { useMemo, useSyncExternalStore } from 'react'
import type { AgentVoice } from '../../../agent/agentProfile'
import type { ChannelMessage } from '../../../agent/types'
import type { LearnStore } from '../../../learn/types'
import { ensureRoleConversation } from '../../../learn/roleWork/roles'
import { groupPeer, inboundEnvelope, peerOf, userPeer } from '../../../learn/roleWork/channels'
import { deliverInbound } from '../../../learn/roleWork/dispatch'
import { mentionedRoleIdsOf, type MentionRole } from '../../../learn/roleWork/groupTargets'
import { appendGroupMessage, getGroupChatMessages, subscribeGroupChat } from '../../../learn/groupChat'
import type { GroupChatAgent } from '../../agent/panel/GroupChatPanel'

export interface GroupChatBridge {
  /** 当前目标下的群聊消息（从旧到新） */
  messages: ChannelMessage[]
  /** 用户群聊发言：@ 指定成员；无 @ 时默认投给调度龟。返回 false = 拒绝发送 */
  send: (text: string, targetIds: GroupChatAgent['id'][]) => boolean
}

export function useGroupChatBridge({
  goalId,
  agents,
  getLatest,
  set,
}: {
  goalId: string | null
  agents: GroupChatAgent[]
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
}): GroupChatBridge {
  const all = useSyncExternalStore(subscribeGroupChat, getGroupChatMessages, getGroupChatMessages)
  const messages = useMemo(
    () => (goalId ? all.filter((m) => m.kind === 'group' && m.goalId === goalId) : []),
    [all, goalId],
  )

  const send = (text: string, targetIds: GroupChatAgent['id'][]): boolean => {
    const trimmed = text.trim()
    // 群聊 @ 的分隔符就是名字后的空格：末尾的这一个空格不能被 trim 掉。
    const body = trimmed && /[ \u3000]$/.test(text) ? trimmed + ' ' : trimmed
    if (!body || !goalId) return false
    /*
     * 和 role 侧同一条纪律：正文里的 `@名字` 比调用方传的 targetIds 更可信。
     * 这样即使 UI / 模型把目标算错，@导师龟 也只会投给导师龟，不会误投设计龟。
     */
    const mentionRoles: MentionRole[] = agents.map((agent) => ({
      id: agent.id,
      names: [agent.name, ...(agent.aliases ?? [])].map((name) => name.trim()).filter(Boolean),
    }))
    const mentionedIds = mentionedRoleIdsOf(body, mentionRoles)
    const explicitMentions = mentionedIds.length > 0
    // 正文里出现 @ 却解析不到任何成员时拒绝，避免误投给默认调度龟；
    // 正文完全没有 @ 时才使用调用方给的默认目标（群聊 UI 传 dispatcher）。
    if (!explicitMentions && body.includes('@')) return false
    const targets = (explicitMentions ? mentionedIds : targetIds)
      .map((id) => agents.find((a) => a.id === id))
      .filter((a): a is GroupChatAgent => Boolean(a))
    if (!targets.length) return false
    const from = userPeer()
    const now = Date.now()
    const mentions = explicitMentions ? targets.map((a) => peerOf('agent', a.id, a.name)) : []
    const message: ChannelMessage = {
      id: 'g-' + crypto.randomUUID(),
      kind: 'group',
      direction: 'in',
      from,
      to: groupPeer(),
      text: body,
      ts: now,
      ...(mentions.length ? { mentions } : {}),
      goalId,
    }
    appendGroupMessage(message)
    for (const agent of targets) {
      const ensured = ensureRoleConversation(getLatest(), agent.id as AgentVoice, goalId)
      if (ensured.store !== getLatest()) set(ensured.store)
      const to = peerOf('agent', agent.id, agent.name)
      const inbound = inboundEnvelope({
        channel: 'group',
        from,
        to,
        text: body,
        id: message.id,
        ts: now,
        ...(mentions.length ? { mentions } : {}),
        goalId,
      })
      deliverInbound(
        {
          conversationId: ensured.conversationId,
          role: agent.id as AgentVoice,
          goalId,
          text: body,
          stamp: {
            channel: 'group',
            from,
            to,
            ts: now,
            envelopeId: message.id,
            goalId,
          },
          envelopeId: message.id,
        },
        inbound,
      )
    }
    return true
  }

  return { messages, send }
}
