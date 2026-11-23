/**
 * 系统提示词里的 **execute api 速查的固定组 / 非固定组** 渲染（从 apiRegistry 投影，不手抄名单）。
 *
 * 为什么要拆两段：
 * 1. **固定组**是六位挂目标 role 逐位都有的执行基座（help / wait / compact + tmp / work / chat），
 *    内容与 role 无关，逐字节一致——放在共同基础前缀之后，跨 role 的缓存前缀能从 P0 一路
 *    命中到固定组末尾；设置页也把它单列为「固定组」。
 * 2. **非固定组**是各 role 按架构分工拿到的域（node / exam / classroom / browser …），
 *    只渲染实际持有的组；没持有的组连索引都不出现（提示词与运行时 apiAllow 同一口径）。
 *
 * 纪律：组块格式与 apiRegistry.renderCompactApiGroupBlocks 完全一致（`#### api.<组> — 名称`
 * + 组 usage + 每条 `- \`签名\` — 一句话 + trap`），这样既有的提示词对账用例不用改；
 * 固定组成员是**交集的顶层函数**，core 组的 help 恒在场，渲染时单独补。
 */

import { promotedGroups, renderCompactApiHeader, type ApiGroupDoc } from './apiRegistry'

/** 固定能力面的切分口径（来自 agent/agentProfile 的 FIXED_API_PLANE） */
export interface ApiPlaneSplit {
  /** 全员共同持有的组 key（如 tmp / team） */
  groups: readonly string[]
  /** 全员共同持有的 core 顶层函数名（如 wait / compact）；help 恒在场，不需要列 */
  topLevel: readonly string[]
}

export interface SplitApiDoc {
  /** 固定组：六位 role 共用，逐字节一致 */
  fixed: string
  /** 非固定组：本 role 专属；没有专属面时是空串 */
  variable: string
}

/** core 组恒在场的顶层函数（查帮助不该被任何裁剪拦掉） */
const ALWAYS_CORE = 'help'

/**
 * 把一位声部的速查切成固定组 / 非固定组两段。
 * allow 是 apiDocKeysFor(voice) 的口径：持有的组 key + core 顶层函数名 + 'core'。
 */
export function renderSplitApiDocumentation(
  allow: ReadonlySet<string>,
  split: ApiPlaneSplit,
): SplitApiDoc {
  const groups = promotedGroups()
  const core = groups.find((g) => g.key === 'core')

  /* ---------- 固定组 ---------- */
  // 交集成员理论上全员都有；仍按 allow 过一道，避免以后能力面改动时渲染出「没给却被宣传」的组
  const fixedTop = new Set<string>(
    [ALWAYS_CORE, ...split.topLevel].filter((name) => name === ALWAYS_CORE || allow.has(name)),
  )
  const fixedKeys = split.groups.filter((key) => allow.has(key))
  const fixedGroups = groups.filter((g) => g.key !== 'core' && fixedKeys.includes(g.key))
  const fixedIndex = [
    core && hasCore(fixedTop) ? '- 顶层函数：' + core.intro : '',
    ...fixedGroups.map(indexLine),
  ]
    .filter(Boolean)
    .join('\n')
  const fixedBlocks = [
    core ? renderGroupBlock(core, fixedTop) : '',
    ...fixedGroups.map((g) => renderGroupBlock(g)),
  ]
    .filter(Boolean)
    .join('\n\n')

  /* ---------- 非固定组 ---------- */
  // allow 里混着组名与顶层函数名：只有 core 组成员才算「非固定顶层」，且要排除固定成员与 help
  const coreNames = new Set((core?.apis ?? []).map((api) => api.name))
  const variableTop = new Set(
    [...allow].filter((name) => coreNames.has(name) && !fixedTop.has(name)),
  )
  const variableGroups = groups.filter(
    (g) => g.key !== 'core' && allow.has(g.key) && !split.groups.includes(g.key),
  )
  const variableIndex = [
    variableTop.size ? '- 顶层函数（专属）：' + [...variableTop].join(' / ') : '',
    ...variableGroups.map(indexLine),
  ]
    .filter(Boolean)
    .join('\n')
  const variableBlocks = [
    core && variableTop.size ? renderGroupBlock(core, variableTop) : '',
    ...variableGroups.map((g) => renderGroupBlock(g)),
  ]
    .filter(Boolean)
    .join('\n\n')

  const fixed = [
    renderCompactApiHeader(),
    '',
    '### 固定组（全员共用）',
    fixedIndex ? '**固定组索引**\n' + fixedIndex : '',
    '',
    fixedBlocks,
  ]
    .filter((part) => part !== '')
    .join('\n\n')

  const variable = variableIndex || variableBlocks
    ? ['### 非固定组（本 role 专属）',
        variableIndex ? '**非固定组索引**\n' + variableIndex : '',
        '',
        variableBlocks,
      ]
        .filter((part) => part !== '')
        .join('\n\n')
    : ''

  return { fixed, variable }
}

function hasCore(members: ReadonlySet<string>): boolean {
  return members.size > 0
}

function indexLine(group: ApiGroupDoc): string {
  return '- api.' + group.key + ' — ' + group.label + '：' + group.intro
}

/** 与 apiRegistry.renderCompactApiGroupBlocks 同格式；members 给定时只渲染其中的成员 */
function renderGroupBlock(group: ApiGroupDoc, members?: ReadonlySet<string>): string {
  const apis = members ? group.apis.filter((api) => members.has(api.name)) : group.apis
  if (!apis.length) return ''
  const lines = [
    (group.key === 'core' ? '#### 顶层函数（api.<name>）' : '#### api.' + group.key) + ' — ' + group.label,
  ]
  if (group.usage.trim()) lines.push(group.usage.trim())
  for (const api of apis) {
    lines.push('- `' + api.signature + '` — ' + api.summary + (api.trap ? '。' + api.trap : ''))
  }
  return lines.join('\n')
}
