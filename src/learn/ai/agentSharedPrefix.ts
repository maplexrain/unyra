/**
 * 六位挂目标 role（导师 / 调度 / 出卷 / 设计 / 调研 / 维修）系统提示词的**共同前缀（P0）**。
 *
 * 取舍纪律（用户定稿）：**提示词里暴露的 api 与工作流，取决于该 role 实际持有哪些**——
 * 不为了前缀缓存往 P0 里塞多余的组。所以 P0 只装「对六位 role 逐字为真」的内容：
 * role 协作（work / chat 全员都有）、execute 机制、先查再用、应用数据守门、沙箱纪律、
 * 通用纪律、compact 规程（compact 六位 role 都有）。
 *
 * api 速查**不塞进 P0**，而是紧随 P0 拆成两段（内容 role 在 P0 与 api 之间还先接一段共用
 * 排版与视觉规范，见 typographyGuide）：
 * - **固定组**（help / wait / compact + tmp / work / chat）是六位 role 的交集，逐字节一致，
 *   跨 role 缓存前缀能从 P0 一路命中到固定组末尾；
 * - **非固定组**按 AGENT_API_PLANES 的实际持面渲染（apiDocKeysFor），没持有的组连索引都
 *   不出现；引用/交付纪律（CHIP_QUOTE_GUIDE / DELIVERY_LEDGER_GUIDE）跟着持有拼在后面。
 *
 * 顺序纪律不变：越不可变越靠前——P0 与共用排版段、固定组对相应 role 逐字节一致，专属能力面
 * 按 role 分化，末尾才是会随设置变化的附加提示词。改这里任何一行，六份提示词的前缀同时变。
 */

import { AGENT_API_PLANES, WORK_API_PLANES, type AgentProfileId, type AgentVoice } from '../../agent/agentProfile'
import { APP_DATA_GUIDE, EXECUTE_BASE_GUIDE, SANDBOX_DISCIPLINE_GUIDE, SEEK_HELP_GUIDE } from './executeGuide'
import { ROLE_WORK_GUIDE, ROLE_CHANNEL_GUIDE } from './roleWorkGuide'
import { TURTLE_CLAN_GUIDE } from './turtleClan'
import { compactWorkflowSection } from './workflowsGuide'

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

/** P1 速查的收尾注记：速查即全部面（面外拒绝在 APP_DATA_GUIDE 也守了一道） */
export const API_PLANE_NOTE =
  '- 以上就是你的全部 api 组与顶层函数：速查之外没有别的组，调用会被沙箱当场拒绝，回执会列出本次开放的组。'

/** 节点 path 寻址口径（只有持有 api.node 组的声部渲染，随 P1 速查附在后面） */
export const NODE_PATH_NOTE =
  "- path 寻址：'' = 当前节点；'极限' = 本目标标题；'极限/笔记' = 笔记；'#id' = 直接给节点 id。找不到时回执会列候选，照着改一次就对。"

/** 通用纪律（需求解耦 / 查证要真读 / 不钻牛角尖）：四位声部逐字同一段，导师也用它 */
export const SHARED_DISCIPLINE = [
  '约束与纪律：',
  '- **需求解耦（重要，违反是大错）**：学习者（或其它 role 的派单指令）提出的内容若与当前任务无关，视为独立需求直接响应或如实说明，绝不强行串联。',
  '- **查证要真读**：引用得到的结论必须读过原文；引用不到权威来源时如实说明，不要用「据说」含糊带过，严禁编造。',
  '- **不钻牛角尖（重要）**：同一个方案失败两次、连续几步没有新信息，就换路径（换 api、换数据源、把大问题拆小）或如实说明卡点与备选；转向前用 api.tmp 记下「试过什么、为什么不行」。',
].join('\n')

/**
 * 全员共同前缀（P0-A）：六位团队角色（导师 / 调度 / 出卷 / 设计 / 调研 / 维修）系统提示词的绝对起始块（逐字节一致）。
 * 块序：龟门总纲（六兄弟身份） → execute/rexecute 机制 → 先查再用 → 应用数据守门 → 沙箱纪律 → 通用纪律。
 * 全部内容对六位团队角色逐字为真，通篇不提未开放 API 组，确保从 token 0 起全员命中缓存。
 */
export const ALL_AGENTS_COMMON_PREFIX = [
  TURTLE_CLAN_GUIDE,
  '',
  EXECUTE_BASE_GUIDE,
  '',
  SEEK_HELP_GUIDE,
  '',
  APP_DATA_GUIDE,
  '',
  SANDBOX_DISCIPLINE_GUIDE,
  '',
  SHARED_DISCIPLINE,
].join('\n')

/**
 * 角色层共同前缀全文（P0）：六位挂目标 role 的系统提示词都以它开头（逐字节一致）。
 * 块序：全员通用前缀（身份总纲 / execute 机制 / 应用数据守门 / 沙箱纪律 / 通用纪律）
 * → 角色层与工作层 → 通道 → compact 会话压缩规程。
 * P0 之后只紧跟**固定组 API 速查**（六位 role 逐字节一致），再往后是身份定位与分工；
 * 领域 API、排版、语法、工作流规程只进 work 提示词，不再进 role。
 */
export const SHARED_AGENT_PREFIX = [
  ALL_AGENTS_COMMON_PREFIX,
  '',
  ROLE_WORK_GUIDE,
  '',
  ROLE_CHANNEL_GUIDE,
  '',
  compactWorkflowSection(),
].join('\n')
