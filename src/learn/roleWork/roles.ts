/**
 * role 会话的定位：`voice` 字段（缺省 = 导师）决定「这段对话是哪位 role」。
 *
 * role-work 之后**一个 agent 的 role 层始终只有一段会话**：同一目标下每位 role
 * 复用已有会话（`Conversation.voice` 判定），没有时才按 `cv:<role>:<goal>` 落一段。
 * 多个 work 的独立上下文在 Conversation.works 里，不另开 role 会话。
 */
import type { Conversation } from '../../agent/types'
import { AGENT_VOICES, LEGACY_VOICE_ALIAS, type AgentProfileId, type AgentVoice } from '../../agent/agentProfile'
import type { LearnStore } from '../types'

function normalizeVoice(v: string | undefined): AgentProfileId | null {
  if (!v) return null
  if ((AGENT_VOICES as readonly string[]).includes(v)) return v as AgentVoice
  return LEGACY_VOICE_ALIAS[v] ?? null
}

const CV_VOICE_RE = /^(?:cv|dv):([a-z]+):/

/** 会话的 role：voice 字段 > 确定性 id 的 role 段 > 导师 */
export function roleOfConversation(conv: Conversation | undefined | null): AgentProfileId {
  const byField = normalizeVoice(conv?.voice)
  if (byField) return byField
  return normalizeVoice(CV_VOICE_RE.exec(conv?.id ?? '')?.[1]) ?? 'tutor'
}

/** 一位 role 在目标下的工作会话 id（确定性；会话记录在首轮启动时才落库） */
export function roleConversationId(goalId: string, role: AgentVoice): string {
  return 'cv:' + role + ':' + goalId
}

/** 一位 role 在目标下的现有会话（按最近更新降序） */
export function roleConversationsOfGoal(store: LearnStore, goalId: string, role: AgentProfileId): Conversation[] {
  return store.conversations
    .filter((c) => c.goalId === goalId && roleOfConversation(c) === role)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0))
}

/** 解析 role 的会话：已有最新 → 它的 id；承接 role 没有则给确定性 id；导师没有则 null */
export function resolveRoleConversation(store: LearnStore, role: AgentProfileId, goalId: string | null | undefined): string | null {
  if (role === 'free' || !goalId) return null
  const latest = roleConversationsOfGoal(store, goalId, role)[0]
  if (latest) return latest.id
  if (role === 'tutor') return null
  return roleConversationId(goalId, role)
}

/**
 * 保证一位 role 在目标下**恰好一段**会话：已有（含历史随机 id）就复用最新的，
 * 没有才落确定性 id。所有「打开/切到 role」的入口都走这里，不再新建第二段。
 */
export function ensureRoleConversation(
  store: LearnStore,
  role: AgentVoice,
  goalId: string,
): { store: LearnStore; conversationId: string } {
  const existing = roleConversationsOfGoal(store, goalId, role)[0]
  if (existing) return { store, conversationId: existing.id }
  const id = roleConversationId(goalId, role)
  const now = Date.now()
  const conv: Conversation = {
    id,
    goalId,
    voice: role,
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
  return { store: { ...store, conversations: [...store.conversations, conv] }, conversationId: id }
}
