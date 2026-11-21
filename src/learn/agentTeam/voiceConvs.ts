/**
 * 声部会话的定位与命名（agent team 的团队分工落在会话层的那一半）：
 * - 会话的 voice 字段（缺省 = 导师）决定「这段对话是谁在说话」；
 * - 承接声部（命题官 / 判卷官 / 资料员）在**一个目标下各有一段工作会话**：委托承接、
 *   系统侧触发（阅卷 / 出卷……）与用户直接对话都落在它上面；
 * - 还没建过的承接会话用**确定性 id** 兜底（`cv:<voice>:<goalId>`）：委托在 delegate
 *   时刻解析目标、状态查询要拿到同一个 id，回合真正启动时 runTurn 才把会话记录落库。
 */

import type { Conversation } from '../../agent/types'
import { AGENT_VOICES, type AgentProfileId, type AgentVoice } from '../../agent/agentProfile'
import type { LearnStore } from '../types'

/** 确定性会话 id 里自带的声部段（cv:<voice>:<goalId>） */
const CV_VOICE_RE = /^cv:([a-z]+):/

/**
 * 会话的声部：**voice 字段 > 确定性 id > 导师**。
 *
 * 老数据没有 voice 字段，全部兜到导师；承接声部的会话即使字段漏标（中间版本写盘、
 * 旧构建创建），确定性 id 里也带着声部段——在这里愈合，分组 / 委托定向 / 界面路由
 * 就不会把命题官的工作会话错当成导师对话。
 */
export function voiceOfConversation(conv: Conversation | undefined | null): AgentProfileId {
  const v = conv?.voice
  if (v) return v
  const idVoice = CV_VOICE_RE.exec(conv?.id ?? '')?.[1] as AgentVoice | undefined
  return idVoice && (AGENT_VOICES as readonly string[]).includes(idVoice) ? idVoice : 'tutor'
}

/** 一位承接声部在目标下的工作会话 id（确定性；会话记录在首轮启动时才落库） */
export function voiceConversationId(goalId: string, voice: AgentVoice): string {
  return 'cv:' + voice + ':' + goalId
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
