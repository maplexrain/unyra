/**
 * 一位 role 的 **api 提示词**：role 层只有固定执行基座（tmp / work / chat + compact），
 * 另附一段 work 能力摘要（按 WORK_API_PLANES 派生，只用于判断该派什么活）。
 *
 * 领域 API、语法与工作流规程全部属于 work 层（见 workSystem）：role 只需要知道
 * `execute` 怎么调、work/chat 怎么用，以及 work 那边**有**什么；work 的具体签名
 * 不在 role 里展开。
 */

import { SANDBOX_API_CATALOG } from '../../agent/apiCatalog'
import { AGENT_API_PLANES, FIXED_API_PLANE, WORK_API_PLANES, WORK_FIXED_PLANE, type AgentProfileId, type AgentVoice } from '../../agent/agentProfile'
import { renderSplitApiDocumentation } from '../../agent/sandbox/apiPromptDoc'
import { apiDocKeysFor, workApiDocKeysFor, NODE_PATH_NOTE } from './agentSharedPrefix'
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

  const tailText = tail.join('\n\n')
  if (doc.variable) return { fixed: doc.fixed, variable: doc.variable + (tailText ? '\n\n' + tailText : '') }
  return { fixed: tailText ? doc.fixed + '\n\n' + tailText : doc.fixed, variable: '' }
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

  const tailText = tail.join('\n\n')
  if (doc.variable) return { fixed: doc.fixed, variable: doc.variable + (tailText ? '\n\n' + tailText : '') }
  return { fixed: tailText ? doc.fixed + '\n\n' + tailText : doc.fixed, variable: '' }
}

/**
 * role 眼里的 work 能力面：只列「work 沙箱持有、role 自己没有」的组与顶层函数。
 * 作用不是让 role 学签名，而是让它知道该派什么活，并且**不要直接调用**。
 *
 * 口径与 WORK_API_PLANES 同源；tmp / host 是 work 的固定组、wait / compact 两组都有，
 * 不再重复列。组标签取 api 目录，避免手写第二份中文能力表。
 */
export function workDelegationSectionFor(role: AgentProfileId): string {
  const plane = WORK_API_PLANES[role]
  const labelOf = new Map(SANDBOX_API_CATALOG.map((group) => [group.key, group.label]))
  const groups = plane.groups
    .filter((group) => !WORK_FIXED_PLANE.groups.includes(group))
    .map((group) => '`' + group + '`（' + (labelOf.get(group) ?? group) + '）')
  const tops = plane.topLevel
    .filter((name) => !WORK_FIXED_PLANE.topLevel.includes(name))
    .map((name) => '`' + name + '`')

  const surface = [
    groups.length ? '组：' + groups.join('、') + '。' : '',
    tops.length ? '顶层函数：' + tops.join('、') + '。' : '',
  ]
    .filter(Boolean)
    .join('\n')

  return [
    '### work 能做什么（只能委派，role 自己调不到）',
    '',
    '你的 work 沙箱按分工还持有这些 api：',
    '',
    surface,
    '',
    '具体方法（如 `exam.read`、`browser.waitFor`）由 work 在自己的沙箱里用 `api.<组>.__help()` 现查；你只需要判断该不该派、派给哪个 work。',
    '',
    '**这些 api 不在 role 的沙箱里**，role 这边只有 `tmp / work / chat` + `compact`（外加恒在的 `help`）。在 role 里直接写 `api.exam.read()` / `api.browser.waitFor()` 会被判「没有这个 api」。需要用时只能 `api.work.create` 新建、`api.work.send` 续用，让 work 在它自己的沙箱里调用；work 再用 `api.host.send` 把结果交回你。不要把 work 的能力当成自己可调的工具。',
  ]
    .filter((part) => part !== '')
    .join('\n')
}
