/**
 * 一位执行声部的 **api 提示词两段**：固定组（全员共用）+ 非固定组（本声部专属）。
 *
 * 分段口径与设置页的「execute 开放的 api」完全同源：
 * - 固定组来自 agent/agentProfile 的 FIXED_API_PLANE（六位执行声部求交）；
 * - 非固定组按 AGENT_API_PLANES 的实际持面渲染（越权组连索引都不出现）；
 * - 面注记（node 寻址 / 引用与交付 / 主动获取 / 面外拒绝）跟着「持有」走，挂在非固定组尾部；
 *   没有专属面时（维修龟）附在固定组尾部——固定组块本身仍逐字节一致，缓存前缀不损失。
 *
 * 顺序纪律（用户定稿）：这两段排在共同基础之后、身份定位之前（内容声部在共同基础与固定组
 * 之间还先接一段共用排版与视觉规范，见 typographyGuide / promptSections）——模型先知道
 * 「内容长什么样、手里有什么」，再读「我是谁、我该干什么」。
 */

import { AGENT_API_PLANES, FIXED_API_PLANE, WORK_API_PLANES, WORK_FIXED_PLANE, type AgentProfileId, type AgentVoice } from '../../agent/agentProfile'
import { renderSplitApiDocumentation } from '../../agent/sandbox/apiPromptDoc'
import { apiDocKeysFor, workApiDocKeysFor, API_PLANE_NOTE, NODE_PATH_NOTE } from './agentSharedPrefix'
import { CHIP_DELIVERY_GUIDE, DELIVERY_LEDGER_GUIDE } from './guides'
import { PROACTIVE_SEEK_GUIDE } from './executeGuide'

export interface ApiPromptParts {
  /** 固定组速查（六位执行声部逐字节一致，紧跟共同基础前缀） */
  fixed: string
  /** 非固定组速查 + 面注记；没有专属面时为空串 */
  variable: string
}

/** 按声部实际持面拼出两段 api 提示词（导师 = tutor） */
export function apiPromptPartsFor(voice: AgentVoice): ApiPromptParts {
  const allow = apiDocKeysFor(voice)
  const doc = renderSplitApiDocumentation(allow, FIXED_API_PLANE)
  const holds = (group: string): boolean => AGENT_API_PLANES[voice].groups.includes(group)

  const tail: string[] = []
  // memory / skill / mcp 三查是导师专属面：跟着 non-fixed 组一起出现
  if (voice === 'tutor') tail.push(PROACTIVE_SEEK_GUIDE)
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
