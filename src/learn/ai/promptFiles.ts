/**
 * 提示词文件运行时：把「内置只读分段 + prompts/ 里的共用外置文件」按用户在 agent 设置页定下的顺序拼成系统提示词。
 *
 * 每次调用都重新取一遍当前设置与外置文件库，不做模块级缓存：用户调整顺序、启停，
 * 或在本地文件页签里编辑了某个 md 之后，下一轮立即生效。
 * 内置分段来自 promptSections / workSystem 的同一份装配来源，名称与正文不会分叉。
 */
import type { AgentProfileId } from '../../agent/agentProfile'
import type { PromptFileSettings, PromptFileLayer } from '../../agent/promptFiles'
import { getExternalPromptFiles } from '../../agent/promptFileStore'
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
  /** 外置文件在 prompts/ 下的文件名（含 .md）；内置项没有 */
  fileName?: string
  /** 当前顺序，从 1 开始 */
  order: number
  enabled: boolean
  content: string
}

interface FilePart {
  id: string
  name: string
  content: string
  fileName?: string
}

function builtinParts(agent: AgentProfileId, layer: PromptFileLayer): FilePart[] {
  if (layer === 'role') {
    return getAgentPromptSections(agent).map((section) => ({
      id: section.id,
      name: section.title,
      content: section.content,
    }))
  }
  const sections = workSystemSections(agent)
  return WORK_SYSTEM_SECTION_ORDER.map((id) => ({
    id: `work-${id}`,
    name: WORK_SYSTEM_SECTION_TITLES[id],
    content: sections[id],
  }))
}

/**
 * 外置文件是全员共用的：同一个文件在 role / work 两层都可见，
 * 各 agent 用自己那一层的 order / disabled 决定注入与否。
 */
function externalParts(): FilePart[] {
  return getExternalPromptFiles().map((file) => ({
    id: file.id,
    name: file.name,
    content: file.content,
    fileName: file.fileName,
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
 * 顺序表里没有的新文件自动排到末尾，不会因为用户没编辑过就消失。
 */
export function listPromptFiles(
  agent: AgentProfileId,
  layer: PromptFileLayer,
  settings: PromptFileSettings,
): PromptFileItem[] {
  const builtin = builtinParts(agent, layer)
  const external = externalParts()
  const all = [...builtin, ...external]
  const byId = new Map(all.map((part) => [part.id, part]))
  const configured = settings.order?.[agent]?.[layer]
  const ordered: FilePart[] = []
  if (Array.isArray(configured)) {
    for (const id of configured) {
      const part = byId.get(id)
      if (part) {
        ordered.push(part)
        byId.delete(id)
      }
    }
  }
  // 顺序表缺失 / 新增的内置分段与外置文件，按默认顺序补齐
  for (const part of all) {
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
    order: idx + 1,
    enabled: !disabled.has(part.id),
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
