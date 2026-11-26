/**
 * 提示词文件运行时：把「内置只读分段 + 用户显式加入当前 agent 的外置文件」按设置页定下的顺序
 * 拼成系统提示词。
 *
 * 外置文件只是候选库：共用文件在 `prompts/`，agent 专属文件在 `agents/{id}/prompts/`；
 * 只有出现在该 agent 该层的 order 数组里，才会进入这一层。新建文件不会自动全部应用。
 *
 * 每次调用都重新取一遍当前设置与外置文件库，不做模块级缓存：用户调整顺序、启停，
 * 或在本地文件页签里编辑了某个 xml 之后，下一轮立即生效。
 */
import type { AgentProfileId } from '../../agent/agentProfile'
import type { PromptFileSettings, PromptFileLayer } from '../../agent/promptFiles'
import { getExternalPromptFiles, type PromptFileScope } from '../../agent/promptFileStore'
import { getAgentPromptSections } from './promptSections'
import {
  WORK_SYSTEM_SECTION_ORDER,
  WORK_SYSTEM_SECTION_TITLES,
  workSystemSections,
} from './workSystem'

export interface PromptFileItem {
  id: string
  name: string
  layer: PromptFileLayer
  builtin: boolean
  /** 外置文件在 prompts/ 下的文件名（含 .xml；兼容旧 .md） */
  fileName?: string
  /** 外置文件的相对路径（含 .xml；页签打开本地文件时用） */
  relPath?: string
  /** 外置文件的归属：共用 / 某 agent 专属 */
  scope?: PromptFileScope
  /** 专属文件的 agent id */
  agentId?: string
  /** 当前顺序，从 1 开始 */
  order: number
  enabled: boolean
  /** 基座段：始终置顶且不可停用 */
  pinned?: boolean
  content: string
}

interface FilePart {
  id: string
  name: string
  content: string
  fileName?: string
  relPath?: string
  scope?: PromptFileScope
  agentId?: string
  pinned?: boolean
}

function builtinParts(agent: AgentProfileId, layer: PromptFileLayer): FilePart[] {
  if (layer === 'role') {
    return getAgentPromptSections(agent).map((section) => ({
      id: section.id,
      name: section.title,
      content: section.content,
      ...(section.pinned ? { pinned: true } : {}),
    }))
  }
  const sections = workSystemSections(agent)
  return WORK_SYSTEM_SECTION_ORDER.map((id) => ({
    id: `work-${id}`,
    name: WORK_SYSTEM_SECTION_TITLES[id],
    content: sections[id],
    ...(id === 'base' ? { pinned: true } : {}),
  }))
}

/**
 * 当前 agent 能看到的候选外置文件：共用 + 该 agent 的专属。
 * 是否真正注入由各层 order 决定，见 listPromptFiles。
 */
function externalParts(agent: AgentProfileId): FilePart[] {
  return getExternalPromptFiles(agent).map((file) => ({
    id: file.id,
    name: file.name,
    content: file.content,
    fileName: file.fileName,
    relPath: file.relPath,
    scope: file.scope,
    ...(file.agentId ? { agentId: file.agentId } : {}),
  }))
}

function disabledIds(
  agent: AgentProfileId,
  layer: PromptFileLayer,
  settings: PromptFileSettings,
): Set<string> {
  const list = settings.disabled?.[agent]?.[layer]
  return new Set(Array.isArray(list) ? list : [])
}

/**
 * 当前 agent 在某一层的全部文件（含停用项），按注入顺序排列。
 *
 * 内置分段始终在这一层里；外置文件只有显式出现在 order 中才算「已加入」。
 * 顺序表里没有的新内置分段会自动补到末尾；外置文件不会自动补——这正是
 * 「选择加入」与旧「建了文件就全部应用」的区别。
 */
export function listPromptFiles(
  agent: AgentProfileId,
  layer: PromptFileLayer,
  settings: PromptFileSettings,
): PromptFileItem[] {
  const builtin = builtinParts(agent, layer)
  const external = externalParts(agent)
  const all = [...builtin, ...external]
  const byId = new Map(all.map((part) => [part.id, part]))
  const configured = settings.order?.[agent]?.[layer]
  const ordered: FilePart[] = []
  // 基座段永远置顶：先放内置的 pinned 段，再认用户顺序，最后补其余内置段
  for (const part of builtin) {
    if (part.pinned && byId.has(part.id)) {
      ordered.push(part)
      byId.delete(part.id)
    }
  }
  if (Array.isArray(configured)) {
    for (const id of configured) {
      const part = byId.get(id)
      if (part) {
        ordered.push(part)
        byId.delete(id)
      }
    }
  }
  // 内置分段必须在；没被 order 提到就按默认顺序补齐。外置文件不补。
  for (const part of builtin) {
    if (byId.has(part.id)) {
      ordered.push(part)
      byId.delete(part.id)
    }
  }
  const disabled = disabledIds(agent, layer, settings)
  return ordered.map((part, idx) => ({
    id: part.id,
    name: part.name,
    layer,
    builtin: builtin.some((b) => b.id === part.id),
    ...(part.fileName ? { fileName: part.fileName } : {}),
    ...(part.relPath ? { relPath: part.relPath } : {}),
    ...(part.scope ? { scope: part.scope } : {}),
    ...(part.agentId ? { agentId: part.agentId } : {}),
    ...(part.pinned ? { pinned: true } : {}),
    order: idx + 1,
    enabled: part.pinned ? true : !disabled.has(part.id),
    content: part.content,
  }))
}

/** 按当前文件顺序与启停拼系统提示词；空内容的文件跳过。 */
export function buildPromptFileSystem(
  agent: AgentProfileId,
  layer: PromptFileLayer,
  settings: PromptFileSettings,
): string {
  return listPromptFiles(agent, layer, settings)
    .filter((file) => file.enabled && file.content.trim())
    .map((file) => file.content.trim())
    .join('\n\n')
}
