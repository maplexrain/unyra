/**
 * 群聊成员表：从名册顺序生成，供 useGroupChatBridge / GroupChatPanel 共用。
 *
 * 抽成独立模块只为把 AgentSlot 的体量留在红线内；逻辑仍是那一句
 * 「除 free 外的 role + 自定义名 / 头像 / 运行态」。
 */
import { AGENT_ROSTER_META, AGENT_ROSTER_ORDER, type AgentVoiceStats } from '../agent-team/agentRoster'
import { DEFAULT_AGENT_NAME } from '../../../agent/agentProfile'
import { t } from '../../../i18n'
import type { GroupChatAgent } from '../../agent/panel/GroupChatPanel'

export function groupAgentsOf({
  agentNames,
  agentAvatarIds,
  voiceStats,
}: {
  agentNames?: Partial<Record<string, string>>
  agentAvatarIds: Partial<Record<string, string>>
  voiceStats: Partial<Record<string, AgentVoiceStats>>
}): GroupChatAgent[] {
  return AGENT_ROSTER_ORDER.filter((id) => id !== 'free').map((id) => ({
    id,
    name: agentNames?.[id]?.trim() || DEFAULT_AGENT_NAME[id],
    duty: t(AGENT_ROSTER_META[id].blurb),
    aliases: [DEFAULT_AGENT_NAME[id]],
    avatarId: agentAvatarIds[id],
    running: Boolean(voiceStats[id]?.running),
  }))
}
