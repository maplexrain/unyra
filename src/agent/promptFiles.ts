/**
 * 提示词文件的持久化描述。
 *
 * - 内置文件是编译进代码的系统提示词分段（role / work 两层各一组），只读；
 * - 外置文件由用户在设置页新建，内容可写；
 * - 每个 agent、每一层各有一份顺序表：顺序就是注入顺序。`disabled` 里的 id 不注入。
 *
 * 这里只放纯类型与归一化，不 import 任何提示词内容；运行时装配在 learn/ai/promptFiles。
 */
import type { AgentProfileId } from './agentProfile'

export type PromptFileLayer = 'role' | 'work'

export interface ExternalPromptFile {
  id: string
  name: string
  layer: PromptFileLayer
  content: string
}

export interface PromptFileOrder {
  role?: string[]
  work?: string[]
}

export interface PromptFileSettings {
  external: ExternalPromptFile[]
  /** agentId -> 层 -> 有序 id 列表；缺省 = 内置默认顺序 */
  order?: Partial<Record<AgentProfileId, PromptFileOrder>>
  /** agentId -> 层 -> 停止注入的 id 列表 */
  disabled?: Partial<Record<AgentProfileId, PromptFileOrder>>
}

export const DEFAULT_PROMPT_FILE_SETTINGS: PromptFileSettings = {
  external: [],
}

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

function normalizeLayer(raw: unknown): PromptFileLayer {
  return raw === 'work' ? 'work' : 'role'
}

export function normalizePromptFileSettings(raw: unknown): PromptFileSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<PromptFileSettings>
  const external: ExternalPromptFile[] = []
  const seen = new Set<string>()
  if (Array.isArray(src.external)) {
    for (const item of src.external) {
      if (!item || typeof item !== 'object') continue
      const rec = item as Partial<ExternalPromptFile>
      const id = typeof rec.id === 'string' ? rec.id.trim() : ''
      const name = typeof rec.name === 'string' ? rec.name.trim() : ''
      const content = typeof rec.content === 'string' ? rec.content : ''
      if (!id || !name || seen.has(id)) continue
      seen.add(id)
      external.push({
        id,
        name: name.slice(0, 40),
        layer: normalizeLayer(rec.layer),
        content,
      })
    }
  }

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
    external,
    ...(Object.keys(order).length ? { order } : {}),
    ...(Object.keys(disabled).length ? { disabled } : {}),
  }
}
