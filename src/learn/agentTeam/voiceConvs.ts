/**
 * 声部会话的定位与命名（agent team 的团队分工落在会话层的那一半）：
 * - 会话的 voice 字段（缺省 = 导师）决定「这段对话是谁在说话」；
 * - 承接声部（调度员 / 出卷师 / 设计师 / 调研员 / 维修员）在**一个目标下各有一段工作会话**：系统侧
 *   触发（阅卷 / 出卷……）与用户直接对话落在普通会话（`cv:` 前缀）上；
 * - **委托会话**（`dv:` 前缀）按「委托者」另开：`dv:<承接声部>:<委托者声部>:<goalId>`——
 *   被委托的声部为每一位委托它的声部各留一段专属会话，同一委托者的后续委托复用同一段
 *   （确定性 id 天然复用）；委托会话不接受用户输入（见 AgentPanel 的 chatLocked）；
 * - 还没建过的会话用**确定性 id** 兜底：委托在 delegate 时刻解析目标、状态查询要拿到
 *   同一个 id，回合真正启动时 runTurn 才把会话记录落库；
 * - 已退役声部（grader）的老会话按 LEGACY_VOICE_ALIAS 映射到承接者，不归错桶。
 */

import type { Conversation } from '../../agent/types'
import { AGENT_VOICES, LEGACY_VOICE_ALIAS, type AgentProfileId, type AgentVoice } from '../../agent/agentProfile'
import type { LearnStore } from '../types'

/** 声部段 / voice 字段的归一：现役声部原样过，已退役声部映射到承接者，其余不认 */
function normalizeVoice(v: string | undefined): AgentProfileId | null {
  if (!v) return null
  if ((AGENT_VOICES as readonly string[]).includes(v)) return v as AgentVoice
  return LEGACY_VOICE_ALIAS[v] ?? null
}

/** 确定性会话 id 里自带的声部段（cv:<voice>:… / dv:<voice>:<from>:…——第一段都是承接声部） */
const CV_VOICE_RE = /^(?:cv|dv):([a-z]+):/

/**
 * 会话的声部：**voice 字段 > 确定性 id > 导师**。
 *
 * 老数据没有 voice 字段，全部兜到导师；承接声部的会话即使字段漏标（中间版本写盘、
 * 旧构建创建），确定性 id 里也带着声部段——在这里愈合，分组 / 委托定向 / 界面路由
 * 就不会把命题官的工作会话错当成导师对话。
 */
export function voiceOfConversation(conv: Conversation | undefined | null): AgentProfileId {
  const byField = normalizeVoice(conv?.voice)
  if (byField) return byField
  const idVoice = normalizeVoice(CV_VOICE_RE.exec(conv?.id ?? '')?.[1])
  return idVoice ?? 'tutor'
}

/** 一位承接声部在目标下的工作会话 id（确定性；会话记录在首轮启动时才落库） */
export function voiceConversationId(goalId: string, voice: AgentVoice): string {
  return 'cv:' + voice + ':' + goalId
}

/**
 * 委托会话 id：`dv:<承接声部>:<委托者声部>:<goalId>`（确定性）。
 * 被委托的声部**按委托者分会**——同一位委托者的后续委托复用同一段会话（id 相同即复用），
 * 不同委托者互不串台。会话记录在承接轮真正启动时才落库。
 */
export function delegationConversationId(goalId: string, voice: AgentVoice, fromVoice: AgentProfileId): string {
  return 'dv:' + voice + ':' + fromVoice + ':' + goalId
}

/** 这段会话是不是委托会话（dv: 前缀）：委托会话不接受用户输入，界面上要标类别 */
export function isDelegationConversation(conv: Conversation | undefined | null): boolean {
  return Boolean(conv?.id.startsWith('dv:'))
}

/** 委托会话 id 里的委托者声部段（普通会话返回 null） */
export function delegatorVoiceOf(conv: Conversation | undefined | null): AgentProfileId | null {
  if (!conv?.id.startsWith('dv:')) return null
  const seg = conv.id.split(':')[2]
  return seg && (AGENT_VOICES as readonly string[]).includes(seg) ? (seg as AgentProfileId) : null
}

/** 一位声部在目标下的现有会话（按最近更新降序） */
export function voiceConversationsOfGoal(
  store: LearnStore,
  goalId: string,
  voice: AgentProfileId,
): Conversation[] {
  return store.conversations
    .filter((c) => c.goalId === goalId && voiceOfConversation(c) === voice)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0))
}

/**
 * 解析一位声部「当前」的承接会话：
 * - free：不挂目标，取最近活跃的那段自由聊天（调用方接线，这里不管）；
 * - tutor：目标下最新的导师会话，没有则 null（目标还没开过对话）；
 * - 承接声部：目标下现有的最新工作会话，没有则给确定性 id（首轮启动时落库）。
 */
export function resolveVoiceConversation(
  store: LearnStore,
  voice: AgentProfileId,
  goalId: string | null | undefined,
): string | null {
  if (voice === 'free' || !goalId) return null
  const latest = voiceConversationsOfGoal(store, goalId, voice)[0]
  if (latest) return latest.id
  if (voice === 'tutor') return null
  return voiceConversationId(goalId, voice)
}
