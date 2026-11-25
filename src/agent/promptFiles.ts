/**
 * 提示词文件的持久化描述。
 *
 * - 内置文件是编译进代码的系统提示词分段（role / work 两层各一组），只读；
 * - 外置文件是 `users/{uid}/prompts/*.md` 里的共用文件（见 agent/promptFileStore），
 *   内容住在磁盘上，不在这份设置里；
 * - 每个 agent、每一层各有一份顺序表：顺序就是注入顺序。`disabled` 里的 id 不注入。
 *
 * 这里只放纯类型与归一化，不 import 任何提示词内容；运行时装配在 learn/ai/promptFiles。
 */
import type { AgentProfileId } from './agentProfile'

export type PromptFileLayer = 'role' | 'work'

export interface PromptFileOrder {
  role?: string[]
  work?: string[]
}

export interface PromptFileSettings {
  /** agentId -> 层 -> 有序 id 列表；缺省 = 内置默认顺序 */
  order?: Partial<Record<AgentProfileId, PromptFileOrder>>
  /** agentId -> 层 -> 停止注入的 id 列表 */
  disabled?: Partial<Record<AgentProfileId, PromptFileOrder>>
}

export const DEFAULT_PROMPT_FILE_SETTINGS: PromptFileSettings = {}

const PROMPT_FILE_AGENTS: readonly AgentProfileId[] = [
  'free',
  'tutor',
  'dispatcher',
  'examiner',
  'designer',
  'researcher',
  'fixer',
]

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean))]
}

export function normalizePromptFileSettings(raw: unknown): PromptFileSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<PromptFileSettings>

  const order: Partial<Record<AgentProfileId, PromptFileOrder>> = {}
  const disabled: Partial<Record<AgentProfileId, PromptFileOrder>> = {}
  for (const id of PROMPT_FILE_AGENTS) {
    const rawOrder = src.order?.[id]
    const rawDisabled = src.disabled?.[id]
    if (rawOrder && typeof rawOrder === 'object') {
      const role = stringList(rawOrder.role)
      const work = stringList(rawOrder.work)
      if (role.length || work.length) order[id] = { ...(role.length ? { role } : {}), ...(work.length ? { work } : {}) }
    }
    if (rawDisabled && typeof rawDisabled === 'object') {
      const role = stringList(rawDisabled.role)
      const work = stringList(rawDisabled.work)
      if (role.length || work.length) disabled[id] = { ...(role.length ? { role } : {}), ...(work.length ? { work } : {}) }
    }
  }

  return {
    ...(Object.keys(order).length ? { order } : {}),
    ...(Object.keys(disabled).length ? { disabled } : {}),
  }
}
