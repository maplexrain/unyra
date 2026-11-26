/**
 * 六位挂目标 role（导师 / 调度 / 出卷 / 设计 / 调研 / 维修）系统提示词的**共同前缀（P0）**。
 *
 * 取舍纪律（用户定稿）：**提示词里暴露的 api 与工作流，取决于该 role 实际持有哪些**——
 * 不为了前缀缓存往 P0 里塞多余的组。所以 P0 只装「对六位 role 逐字为真」的内容：
 * 执行机制与沙箱纪律、通用纪律、说话方式、role 协作、通道、compact 规程。
 *
 * api 速查**不塞进 P0**，而是紧随 P0 拆成两段：
 * - **固定组**（help / compact + tmp / work / chat / agent）是六位 role 的交集，逐字节一致，
 *   跨 role 缓存前缀能从 P0 一路命中到固定组末尾；
 * - **非固定组**按 AGENT_API_PLANES 的实际持面渲染（apiDocKeysFor），没持有的组连索引都
 *   不出现；引用/交付纪律（CHIP_QUOTE_GUIDE / DELIVERY_LEDGER_GUIDE）跟着持有拼在后面。
 *
 * 顺序纪律不变：越不可变越靠前——P0 与固定组对相应 role 逐字节一致，专属能力面
 * 按 role 分化，末尾才是会随设置变化的附加提示词。改这里任何一行，六份提示词的前缀同时变。
 */

import { AGENT_API_PLANES, WORK_API_PLANES, type AgentProfileId, type AgentVoice } from '../../agent/agentProfile'
import { AGENT_COMMON_GUIDE } from './agentCommonGuide'
import { ROLE_COMPACTION_GUIDE, ROLE_CHANNEL_GUIDE, ROLE_WORK_GUIDE } from './roleWorkGuide'
import { promptBlock } from './promptFrames'

/**
 * 一位声部的速查文档键 = **它实际持有的组 + 放行的顶层函数名 + core 展示组**。
 * 渲染走 apiRegistry 的 allow 口径：组块按组名裁剪，core 顶层按裸函数名裁剪
 * （help 恒在场）——提示词速查与运行时 apiAllow 从同一份分工面算出，永不对不上。
 */
export function apiDocKeysFor(voice: AgentVoice): ReadonlySet<string> {
  const plane = AGENT_API_PLANES[voice]
  return new Set<string>([...plane.groups, ...plane.topLevel, 'core'])
}

/** work 的速查文档键：work 面（host / tmp / 领域组）+ 放行顶层 + core 展示组 */
export function workApiDocKeysFor(role: AgentProfileId): ReadonlySet<string> {
  const plane = WORK_API_PLANES[role]
  return new Set<string>([...plane.groups, ...plane.topLevel, 'core'])
}

/** 节点 path 寻址口径（只有持有 api.node 组的声部渲染，随 P1 速查附在后面） */
export const NODE_PATH_NOTE =
  "- path 寻址：'' = 当前节点；'极限' = 本目标标题；'极限/笔记' = 笔记；'#id' = 直接给节点 id。找不到时回执会列候选，照着改一次就对。"

/**
 * 全员共同前缀（P0-A）：所有 agent（六位团队角色、自由对话与外部自定义 role）系统提示词的绝对起始块。
 * **这里不能出现任何具体身份**（龟门、排行、角色名、职责路由都不行）：本段要原样套给外部自定义 agent。
 * 全部内容对所有 role 逐字为真，通篇不提未开放 API 组，确保从 token 0 起全员命中缓存。
 */
export const ALL_AGENTS_COMMON_PREFIX = promptBlock('agent_common', AGENT_COMMON_GUIDE)

/**
 * 角色层共同前缀全文（P0）：所有 role 的系统提示词都以它开头（逐字节一致）。
 * 块序：全员通用前缀 → 对外协作 → 通道 → compact 会话压缩规程。
 * P0 之后只紧跟**固定组 API 速查**（六位 role 逐字节一致），再往后是身份定位与分工；
 * 领域 API、排版、语法、工作流规程只进 work 提示词，不再进 role。
 */
export const SHARED_AGENT_PREFIX = [
  ALL_AGENTS_COMMON_PREFIX,
  promptBlock('collaboration_rules', ROLE_WORK_GUIDE),
  promptBlock('channel_rules', ROLE_CHANNEL_GUIDE),
  promptBlock('compaction_rules', ROLE_COMPACTION_GUIDE),
].join('\n\n')
