/**
 * work 的系统提示词：没有人格，只有执行基座 + 本 role 的领域能力 + 具体做法 + 交付纪律。
 * 每次运行由 promptFiles 按当前提示词文件顺序重新装配，不在创建时固化。
 */
import { WORK_BASE_GUIDE } from './workBase'
import { WORK_ROLE_BRIEF } from './workGuide'
import { SHARED_TYPOGRAPHY_GUIDE } from './typographyGuide'
import { workApiPromptPartsFor } from './apiPromptSections'
import { voiceCopyOf } from './voiceCopy'
import { compactWorkflowSection, workflowGuideFor } from './workflowsGuide'
import { FREE_CHAT_SEARCH_SECTION } from './freeChatCopy'
import { promptBlock } from './promptFrames'
import { AGENT_WORKFLOW_PLANES, type AgentProfileId } from '../../agent/agentProfile'

const CONTENT_ROLES: readonly AgentProfileId[] = ['tutor', 'examiner', 'designer']

export interface WorkSystemSections {
  /** 执行基座 + 固定组 API（work 的置顶段） */
  base: string
  /** 角色分工、排版、动态 API、语法、工作流与领域纪律 */
  capabilities: string
}

export type WorkSystemSectionId = keyof WorkSystemSections

/** 注入顺序（也是设置页文件项的默认顺序） */
export const WORK_SYSTEM_SECTION_ORDER: readonly WorkSystemSectionId[] = ['base', 'capabilities']

export const WORK_SYSTEM_SECTION_TITLES: Record<WorkSystemSectionId, string> = {
  base: '执行基座',
  capabilities: '能力规程',
}

export function workSystemSections(role: AgentProfileId): WorkSystemSections {
  const api = workApiPromptPartsFor(role)
  const copy = role === 'free' ? null : voiceCopyOf(role as Exclude<AgentProfileId, 'free'>)
  const typography = CONTENT_ROLES.includes(role) ? SHARED_TYPOGRAPHY_GUIDE : ''
  const workflowIds =
    role === 'free'
      ? []
      : AGENT_WORKFLOW_PLANES[role as Exclude<AgentProfileId, 'free'>].filter((id) => id !== 'compact')
  const workflow = [
    workflowGuideFor(new Set(workflowIds)).trim(),
    compactWorkflowSection().trim(),
    role === 'free' ? FREE_CHAT_SEARCH_SECTION.trim() : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const base = [WORK_BASE_GUIDE, promptBlock('tool_capabilities', api.fixed)].filter(Boolean).join('\n\n')
  const capabilities = [
    promptBlock('work_role', WORK_ROLE_BRIEF[role]),
    promptBlock('content_layout', typography),
    promptBlock('tool_capabilities', api.variable),
    promptBlock('content_syntax', copy?.syntax.join('\n\n') ?? ''),
    promptBlock('workflow_procedures', workflow),
    promptBlock('work_discipline', copy?.discipline.join('\n') ?? ''),
  ]
    .filter((part) => part.trim())
    .join('\n\n')
  return { base, capabilities }
}

export function buildWorkSystem(role: AgentProfileId): string {
  const s = workSystemSections(role)
  return [s.base, s.capabilities].filter((part) => part.trim()).join('\n\n')
}
