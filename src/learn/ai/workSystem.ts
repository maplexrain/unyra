/**
 * work 的系统提示词：没有人格，只有执行基座 + 本 role 的领域能力 + 交付纪律。
 * 创建 work 时固化；role 之后改设置不影响已建 work（上下文独立）。
 */
import { EXECUTE_BASE_GUIDE, APP_DATA_GUIDE, SANDBOX_DISCIPLINE_GUIDE } from './executeGuide'
import { SHARED_DISCIPLINE } from './agentSharedPrefix'
import { WORK_COMMON_PREFIX, HOST_SEND_GUIDE } from './workGuide'
import { SHARED_TYPOGRAPHY_GUIDE } from './typographyGuide'
import { workApiPromptPartsFor } from './apiPromptSections'
import { voiceCopyOf } from './voiceCopy'
import { compactWorkflowSection } from './workflowsGuide'
import type { AgentProfileId } from '../../agent/agentProfile'

const CONTENT_ROLES: readonly AgentProfileId[] = ['tutor', 'examiner', 'designer']

export interface WorkSystemSections {
  base: string
  typography: string
  fixedApi: string
  variableApi: string
  syntax: string
  workflow: string
}

export function workSystemSections(role: AgentProfileId): WorkSystemSections {
  const api = workApiPromptPartsFor(role)
  const copySyntax = role === 'free' ? [] : voiceCopyOf(role as Exclude<AgentProfileId, 'free'>).syntax
  const typography = CONTENT_ROLES.includes(role) ? SHARED_TYPOGRAPHY_GUIDE : ''
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
    typography,
    fixedApi: api.fixed,
    variableApi: api.variable,
    syntax: copySyntax.join('\n\n'),
    workflow: compactWorkflowSection(),
  }
}

export function buildWorkSystem(role: AgentProfileId): string {
  const s = workSystemSections(role)
  return [s.base, s.typography, s.fixedApi, s.variableApi, s.syntax, s.workflow]
    .filter((part) => part.trim())
    .join('\n\n')
}
