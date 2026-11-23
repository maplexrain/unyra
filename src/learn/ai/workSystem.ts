/**
 * work 的系统提示词：没有人格，只有执行基座 + 本 role 的领域能力 + 具体做法 + 交付纪律。
 * 创建 work 时固化；role 之后改设置不影响已建 work（上下文独立）。
 */
import { EXECUTE_BASE_GUIDE, APP_DATA_GUIDE, SANDBOX_DISCIPLINE_GUIDE } from './executeGuide'
import { SHARED_DISCIPLINE } from './agentSharedPrefix'
import { WORK_COMMON_PREFIX, HOST_SEND_GUIDE, WORK_ROLE_BRIEF } from './workGuide'
import { SHARED_TYPOGRAPHY_GUIDE } from './typographyGuide'
import { workApiPromptPartsFor } from './apiPromptSections'
import { voiceCopyOf } from './voiceCopy'
import { compactWorkflowSection, workflowGuideFor } from './workflowsGuide'
import { FREE_CHAT_SEARCH_SECTION } from './freeChatCopy'
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
      WORK_COMMON_PREFIX,
      '',
      EXECUTE_BASE_GUIDE,
      '',
      APP_DATA_GUIDE,
      '',
      SANDBOX_DISCIPLINE_GUIDE,
      '',
      SHARED_DISCIPLINE,
      '',
      HOST_SEND_GUIDE,
    ].join('\n'),
    roleBrief: WORK_ROLE_BRIEF[role],
    typography,
    fixedApi: api.fixed,
    variableApi: api.variable,
    syntax: copy?.syntax.join('\n\n') ?? '',
    workflow,
    discipline: copy?.discipline.join('\n') ?? '',
  }
}

export function buildWorkSystem(role: AgentProfileId): string {
  const s = workSystemSections(role)
  return [s.base, s.roleBrief, s.typography, s.fixedApi, s.variableApi, s.syntax, s.workflow, s.discipline]
    .filter((part) => part.trim())
    .join('\n\n')
}
