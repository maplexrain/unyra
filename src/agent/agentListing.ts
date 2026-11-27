/**
 * 已注册智能体的只读名录：内置 role + 自由对话 + 外部 agent。
 *
 * `api.agent.list`、智能体名册与设置页共用同一份 id / 名称 / 简介口径；
 * 外部 agent 只读目录配置，不在这里改任何文件。
 */
import {
  AGENT_ROLE_IDS,
  agentNameOf,
  bioOf,
  profileOf,
  type AgentProfileId,
} from './agentProfile'
import { getExternalAgents } from './externalAgentStore'
import type { AgentSettings } from './settings'

export interface AgentDirectoryEntry {
  id: string
  name: string
  bio: string
}

function builtinEntry(settings: AgentSettings, id: AgentProfileId): AgentDirectoryEntry {
  const profile = profileOf(settings, id)
  return { id, name: agentNameOf(profile, id), bio: bioOf(profile, id) }
}

/** 当前工作区里可寻址的全部 agent（内置在前，外部在后，顺序稳定） */
export function listRegisteredAgents(settings: AgentSettings): AgentDirectoryEntry[] {
  return [
    ...AGENT_ROLE_IDS.map((id) => builtinEntry(settings, id)),
    builtinEntry(settings, 'free'),
    ...getExternalAgents().map((agent) => ({
      id: agent.id,
      name: agent.name,
      bio: agent.bio?.trim() || '',
    })),
  ]
}
