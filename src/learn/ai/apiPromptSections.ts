/**
 * 一位 role 的 **api 提示词**：role 层只有固定执行基座（tmp / work / chat + compact）。
 *
 * 领域 API、语法与工作流规程全部属于 work 层（见 workSystem）：role 只需要知道
 * `execute` 怎么调、work/chat 怎么用。固定组仍由 FIXED_API_PLANE 统一渲染，保证
 * 六位团队 role 的前缀逐字节一致。
 */

import { AGENT_API_PLANES, FIXED_API_PLANE, WORK_API_PLANES, WORK_FIXED_PLANE, type AgentProfileId, type AgentVoice } from '../../agent/agentProfile'
import { renderSplitApiDocumentation } from '../../agent/sandbox/apiPromptDoc'
import { apiDocKeysFor, workApiDocKeysFor, API_PLANE_NOTE, NODE_PATH_NOTE } from './agentSharedPrefix'
import { CHIP_DELIVERY_GUIDE, DELIVERY_LEDGER_GUIDE } from './guides'

export interface ApiPromptParts {
  /** 固定组速查（六位执行声部逐字节一致，紧跟共同基础前缀） */
  fixed: string
  /** 非固定组速查 + 面注记；没有专属面时为空串 */
  variable: string
}

/** 按 role 的固定面拼出 api 提示词（领域面不再进 role prompt） */
export function apiPromptPartsFor(voice: AgentVoice): ApiPromptParts {
  const allow = apiDocKeysFor(voice)
  const doc = renderSplitApiDocumentation(allow, FIXED_API_PLANE)
  const holds = (group: string): boolean => AGENT_API_PLANES[voice].groups.includes(group)

  const tail: string[] = []
  if (holds('node')) tail.push(NODE_PATH_NOTE)
  if (holds('chip')) tail.push(CHIP_DELIVERY_GUIDE)
  else if (holds('delivery')) tail.push('交付登记纪律：\n' + DELIVERY_LEDGER_GUIDE)
  tail.push(API_PLANE_NOTE)

  const tailText = tail.join('\n\n')
  if (doc.variable) return { fixed: doc.fixed, variable: doc.variable + '\n\n' + tailText }
  return { fixed: doc.fixed + '\n\n' + tailText, variable: '' }
}

/** work 层的 api 两段：固定组 host/tmp + 按 role 派生的非固定组 */
export function workApiPromptPartsFor(role: AgentProfileId): ApiPromptParts {
  const allow = workApiDocKeysFor(role)
  const doc = renderSplitApiDocumentation(allow, WORK_FIXED_PLANE)
  const holds = (group: string): boolean => WORK_API_PLANES[role].groups.includes(group)

  const tail: string[] = []
  if (holds('node')) tail.push(NODE_PATH_NOTE)
  if (holds('chip')) tail.push(CHIP_DELIVERY_GUIDE)
  else if (holds('delivery')) tail.push('交付登记纪律：\n' + DELIVERY_LEDGER_GUIDE)
  tail.push(API_PLANE_NOTE)

  const tailText = tail.join('\n\n')
  if (doc.variable) return { fixed: doc.fixed, variable: doc.variable + '\n\n' + tailText }
  return { fixed: doc.fixed + '\n\n' + tailText, variable: '' }
}
