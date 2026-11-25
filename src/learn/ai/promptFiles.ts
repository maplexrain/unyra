/**
 * 提示词文件运行时：把「内置只读分段 + 外置可写文件」按用户在 agent 设置页定下的顺序拼成系统提示词。
 *
 * 每次调用都重新取一遍当前设置，不做模块级缓存：用户调整顺序或启停后，下一轮立即生效。
 * 内置分段来自 promptSections / workSystem 的同一份装配来源，名称与正文不会分叉。
 */
import type { AgentProfileId } from '../../agent/agentProfile'
import type { PromptFileSettings, PromptFileLayer } from '../../agent/promptFiles'
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
  /** 当前顺序，从 1 开始 */
  order: number
  enabled: boolean
  content: string
}

interface BuiltinPart {
  id: string
  name: string
  content: string
}

function builtinParts(agent: AgentProfileId, layer: PromptFileLayer): BuiltinPart[] {
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

function externalParts(layer: PromptFileLayer, settings: PromptFileSettings): BuiltinPart[] {
  return settings.external
    .filter((file) => file.layer === layer)
    .map((file) => ({ id: file.id, name: file.name, content: file.content }))
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
  const external = externalParts(layer, settings)
  const all = [...builtin, ...external]
  const byId = new Map(all.map((part) => [part.id, part]))
  const configured = settings.order?.[agent]?.[layer]
  const ordered: BuiltinPart[] = []
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
