/**
 * useAgent 的**会话级副作用**：会话落库（persist）、起名与 work 管理器。
 *
 * work 管理器一段 role 对话一个、跨轮存活：role 在轮内 create/send 的 work 会继续在后台跑，
 * 交付通过 Work 通道回到 role（见 learn/roleWork/dispatch）。
 */
import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import type { AgentEvent, AgentPart, Conversation } from '../../agent/types'
import { agentNameOf, profileOf, type AgentProfileId } from '../../agent/agentProfile'
import { loadAgentSettings } from '../../agent/settings'
import { applyEvent } from '../agent/events'
import { createWorkManager, type WorkManager } from '../../agent/work/manager'
import { buildWorkSystem } from '../ai/workSystem'
import { conversationById } from '../graph'
import { generateConversationTitle, namingSource } from '../title'
import type { LearnStore } from '../types'
import { inboundEnvelope, outboundEnvelope, peerOf } from '../roleWork/channels'
import { deliverInbound, hasRoleWorkDispatcher } from '../roleWork/dispatch'
import { freeConversationById, mutateFreeConversation } from '../freeChat'

export interface WorkRunSlot {
  conversationId: string
  workId: string
  runId: string
  parts: AgentPart[]
}

/** 会话落库、起名与 work 管理器 */
export function useAgentSession(deps: {
  getLatest: () => LearnStore
  set: (store: LearnStore) => void
  workManagersRef: { current: Map<string, WorkManager> }
  setWorkRuns: Dispatch<SetStateAction<WorkRunSlot[]>>
}) {
  const { getLatest, set, workManagersRef, setWorkRuns } = deps

  const persist = useCallback(
    (next: Conversation) => {
      const s = getLatest()
      const exists = s.conversations.some((c) => c.id === next.id)
      const conversations = exists
        ? s.conversations.map((c) => (c.id === next.id ? next : c))
        : [...s.conversations, next]
      set({ ...s, conversations })
    },
    [getLatest, set],
  )

  const namingRef = useRef(new Set<string>())
  const nameConversation = useCallback(
    (conv: Conversation) => {
      if (conv.title || namingRef.current.has(conv.id)) return
      const goal = getLatest().goals.find((g) => g.id === conv.goalId)
      const source = namingSource(conv, goal?.question ?? '')
      if (!source) return
      namingRef.current.add(conv.id)
      void generateConversationTitle({ text: source })
        .then((title) => {
          const cur = conversationById(getLatest(), conv.id)
          if (!cur || cur.title) return
          persist({ ...cur, title })
        })
        .catch((err: unknown) => {
          console.warn('[agent] 对话起名失败', err)
        })
        .finally(() => namingRef.current.delete(conv.id))
    },
    [getLatest, persist],
  )

  const getOrCreateWorkManager = useCallback(
    (conversationId: string): WorkManager => {
      let m = workManagersRef.current.get(conversationId)
      if (!m) {
        const stored = conversationById(getLatest(), conversationId)
        const roleId = (stored?.voice ?? 'tutor') as AgentProfileId
        const roleName = agentNameOf(profileOf(loadAgentSettings(), roleId), roleId)
        m = createWorkManager({
          roleId,
          roleName,
          roleConversationId: conversationId,
          goalId: stored?.goalId,
          getWorks: () => conversationById(getLatest(), conversationId)?.works?.sessions ?? [],
          setWorks: (update) => {
            const cur = conversationById(getLatest(), conversationId)
            if (!cur) return
            const sessions = update(cur.works?.sessions ?? [])
            persist({ ...cur, works: sessions.length ? { sessions } : undefined })
          },
          buildSystem: (role) => buildWorkSystem(role),
          roleMessage: (messageId) =>
            conversationById(getLatest(), conversationId)?.messages.find((m) => m.id === messageId) ?? null,
          appendOutbound: (work, text, meta) => {
            const cur = conversationById(getLatest(), conversationId)
            if (!cur) return
            const from = peerOf('agent', roleId, roleName)
            const to = peerOf('work', work.id, work.name)
            const envelope = outboundEnvelope({
              channel: 'work',
              from,
              to,
              text,
              ...(meta.quoteMessageId ? { quoteMessageId: meta.quoteMessageId } : {}),
              ...(meta.auto ? { auto: true } : {}),
              ...(meta.extra ? { extra: meta.extra } : {}),
            })
            persist({ ...cur, channels: [...(cur.channels ?? []), envelope].slice(-200), updatedAt: Date.now() })
          },
          deliverToRole: (work, text, meta) => {
            const from = peerOf('work', work.id, work.name)
            const to = peerOf('agent', work.roleId, roleName)
            const envelope = inboundEnvelope({ channel: 'work', from, to, text, ...(meta.extra ? { extra: meta.extra } : {}) })
            deliverInbound(
              {
                conversationId: work.roleConversationId,
                role: work.roleId,
                text,
                stamp: { channel: 'work', from, to, ts: envelope.ts, envelopeId: envelope.id },
                envelopeId: envelope.id,
                ...(meta.quoteMessageId ? { mark: '工作交付' } : {}),
              },
              envelope,
            )
          },
          onEvent: (workId, runId, e) => {
            setWorkRuns((prev) => {
              const cur = prev.find((r) => r.runId === runId)
              const parts = cur ? [...cur.parts] : []
              applyEvent(parts, e)
              return cur
                ? prev.map((r) => (r.runId === runId ? { ...r, parts } : r))
                : [...prev, { conversationId, workId, runId, parts }]
            })
          },
          onRunEnd: (_workId, runId) => {
            setWorkRuns((prev) => prev.filter((r) => r.runId !== runId))
          },
        })
        workManagersRef.current.set(conversationId, m)
      }
      return m
    },
    [getLatest, persist, workManagersRef, setWorkRuns],
  )

  /**
   * 自由聊天（聊天龟）的 work 管理器：会话账本住 free-chat.json，不进 LearnStore。
   * 交付没有可注入的 role 轮次（free 的轮由 sendFree 串行发起），因此宿主把
   * Work 通道信封落进 channels，并追加一条 channel-message 助手消息；下一轮
   * 自由对话重建历史时，它会被还原成一条用户侧消息，聊天龟据此接活。
   */
  const getOrCreateFreeWorkManager = useCallback(
    (conversationId: string): WorkManager => {
      let m = workManagersRef.current.get(conversationId)
      if (!m) {
        const conv = () => freeConversationById(conversationId)
        const roleName = agentNameOf(profileOf(loadAgentSettings(), 'free'), 'free')
        m = createWorkManager({
          roleId: 'free',
          roleName,
          roleConversationId: conversationId,
          getWorks: () => conv()?.works?.sessions ?? [],
          setWorks: (update) => {
            const cur = conv()
            if (!cur) return
            const sessions = update(cur.works?.sessions ?? [])
            mutateFreeConversation(conversationId, (c) => ({
              ...c,
              works: sessions.length ? { sessions } : undefined,
              updatedAt: Date.now(),
            }))
          },
          buildSystem: (role) => buildWorkSystem(role),
          roleMessage: (messageId) => conv()?.messages.find((x) => x.id === messageId) ?? null,
          appendOutbound: (work, text, meta) => {
            mutateFreeConversation(conversationId, (c) => {
              const envelope = outboundEnvelope({
                channel: 'work',
                from: peerOf('agent', 'free', roleName),
                to: peerOf('work', work.id, work.name),
                text,
                ...(meta.quoteMessageId ? { quoteMessageId: meta.quoteMessageId } : {}),
                ...(meta.auto ? { auto: true } : {}),
              })
              return { ...c, channels: [...(c.channels ?? []), envelope].slice(-200), updatedAt: Date.now() }
            })
          },
          deliverToRole: (work, text) => {
            const from = peerOf('work', work.id, work.name)
            const to = peerOf('agent', 'free', roleName)
            const envelope = inboundEnvelope({ channel: 'work', from, to, text })
            // 与目标 role 同一条路径：通道落账 + 空闲立即起轮 / 运行中跳边界注入。
            // dispatcher 尚未注册（极端初始化阶段）才走旧的「留到下一轮」兜底；
            // 运行中返回 false 是「已排队」，不能再落一遍账。
            if (hasRoleWorkDispatcher()) {
              deliverInbound(
                {
                  conversationId,
                  role: 'free',
                  text,
                  stamp: { channel: 'work', from, to, ts: envelope.ts, envelopeId: envelope.id },
                  envelopeId: envelope.id,
                },
                envelope,
              )
              return
            }
            mutateFreeConversation(conversationId, (c) => ({
              ...c,
              channels: [...(c.channels ?? []), envelope].slice(-200),
              messages: [
                ...c.messages,
                {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  parts: [{ type: 'channel-message', channelId: envelope.id, text }],
                  ts: Date.now(),
                },
              ],
              updatedAt: Date.now(),
            }))
          },
          onEvent: (workId, runId, e) => {
            setWorkRuns((prev) => {
              const cur = prev.find((r) => r.runId === runId)
              const parts = cur ? [...cur.parts] : []
              applyEvent(parts, e)
              return cur
                ? prev.map((r) => (r.runId === runId ? { ...r, parts } : r))
                : [...prev, { conversationId, workId, runId, parts }]
            })
          },
          onRunEnd: (_workId, runId) => {
            setWorkRuns((prev) => prev.filter((r) => r.runId !== runId))
          },
        })
        workManagersRef.current.set(conversationId, m)
      }
      return m
    },
    [workManagersRef, setWorkRuns],
  )

  return { persist, namingRef, nameConversation, getOrCreateWorkManager, getOrCreateFreeWorkManager }
}

/** 给 work 的实时事件补一条（宿主用来在页签上渲染） */
export function workEventSlot(
  prev: WorkRunSlot[],
  conversationId: string,
  workId: string,
  runId: string,
  e: AgentEvent,
): WorkRunSlot[] {
  const cur = prev.find((r) => r.runId === runId)
  const parts = cur ? [...cur.parts] : []
  applyEvent(parts, e)
  return cur
    ? prev.map((r) => (r.runId === runId ? { ...r, parts } : r))
    : [...prev, { conversationId, workId, runId, parts }]
}
