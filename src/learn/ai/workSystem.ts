/**
 * work 的系统提示词：没有人格，只有执行基座 + 本 role 的领域能力 + 具体做法 + 交付纪律。
 * 每次运行由 promptFiles 按当前提示词文件顺序重新装配，不在创建时固化。
 */
import { EXECUTE_BASE_GUIDE, APP_DATA_GUIDE, SANDBOX_DISCIPLINE_GUIDE } from './executeGuide'
import { SHARED_DISCIPLINE } from './agentSharedPrefix'
import { WORK_COMMON_PREFIX, HOST_SEND_GUIDE, WORK_ROLE_BRIEF } from './workGuide'
import { SHARED_TYPOGRAPHY_GUIDE } from './typographyGuide'
import { workApiPromptPartsFor } from './apiPromptSections'
import { voiceCopyOf } from './voiceCopy'
import { compactWorkflowSection, workflowGuideFor } from './workflowsGuide'
import { FREE_CHAT_SEARCH_SECTION } from './freeChatCopy'
import { promptBlock } from './promptFrames'
import { AGENT_WORKFLOW_PLANES, type AgentProfileId } from '../../agent/agentProfile'

const CONTENT_ROLES: readonly AgentProfileId[] = ['tutor', 'examiner', 'designer']

export interface WorkSystemSections {
  base: string
  roleBrief: string
  typography: string
  fixedApi: string
  variableApi: string
  syntax: string
  workflow: string
  discipline: string
}

export type WorkSystemSectionId = keyof WorkSystemSections

/** 注入顺序（也是设置页文件项的默认顺序） */
export const WORK_SYSTEM_SECTION_ORDER: readonly WorkSystemSectionId[] = [
  'base',
  'roleBrief',
  'typography',
  'fixedApi',
  'variableApi',
  'syntax',
  'workflow',
  'discipline',
]

export const WORK_SYSTEM_SECTION_TITLES: Record<WorkSystemSectionId, string> = {
  base: '执行基座与通用纪律',
  roleBrief: '角色分工',
  typography: '排版规范',
  fixedApi: '固定组 API 能力面',
  variableApi: '动态 API 能力面',
  syntax: '领域语法',
  workflow: '工作流规程',
  discipline: '领域纪律',
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
  return {
    base: [
      promptBlock('work_identity', WORK_COMMON_PREFIX),
      promptBlock('execution_rules', EXECUTE_BASE_GUIDE),
      promptBlock('app_data_rules', APP_DATA_GUIDE),
      promptBlock('sandbox_rules', SANDBOX_DISCIPLINE_GUIDE),
      promptBlock('general_discipline', SHARED_DISCIPLINE),
      promptBlock('delivery_rules', HOST_SEND_GUIDE),
    ]
      .filter(Boolean)
      .join('\n\n'),
    roleBrief: promptBlock('work_role', WORK_ROLE_BRIEF[role]),
    typography: promptBlock('content_layout', typography),
    fixedApi: promptBlock('tool_capabilities', api.fixed),
    variableApi: promptBlock('tool_capabilities', api.variable),
    syntax: promptBlock('content_syntax', copy?.syntax.join('\n\n') ?? ''),
    workflow: promptBlock('workflow_procedures', workflow),
    discipline: promptBlock('work_discipline', copy?.discipline.join('\n') ?? ''),
  }
}

export function buildWorkSystem(role: AgentProfileId): string {
  const s = workSystemSections(role)
  return [s.base, s.roleBrief, s.typography, s.fixedApi, s.variableApi, s.syntax, s.workflow, s.discipline]
    .filter((part) => part.trim())
    .join('\n\n')
}
