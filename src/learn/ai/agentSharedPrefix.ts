/**
 * 五位执行声部（导师 / 出卷师 / 设计师 / 调研员 / 维修员）系统提示词的**共同前缀（P0）**。
 *
 * 取舍纪律（用户定稿）：**提示词里暴露的 api 与工作流，取决于该声部实际持有哪些**——
 * 不为了前缀缓存往 P0 里塞多余的组。所以 P0 只装「对四位声部逐字为真」的内容：
 * 团队协作（team.* 四声部都有）、execute 机制、先查再用、应用数据守门、沙箱纪律、
 * 通用纪律、compact 规程（compact 四声部都有）。**api 速查与引用/交付纪律不进 P0**——
 * 除 tmp/team 外各组没有交集，塞进 P0 就是给没有该组的声部灌噪声；各声部的完整持面
 * 速查在 P1 按 AGENT_API_PLANES 渲染（apiDocKeysFor），引用/交付段按持有拼装
 * （CHIP_QUOTE_GUIDE / DELIVERY_LEDGER_GUIDE，见 teacherSystem 与 agentTeamSystem）。
 *
 * 顺序纪律不变：越不可变越靠前——P0 对四份提示词逐字节一致，P1 按声部分化，末尾才是
 * 会随设置变化的附加提示词。改这里任何一行，四份提示词的前缀同时变。
 */

import { AGENT_API_PLANES, type AgentVoice } from '../../agent/agentProfile'
import { APP_DATA_GUIDE, EXECUTE_BASE_GUIDE, SANDBOX_DISCIPLINE_GUIDE, SEEK_HELP_GUIDE } from './executeGuide'
import { TEAM_GUIDE } from './teamGuide'
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

/** P1 速查的收尾注记：速查即全部面（面外拒绝在 APP_DATA_GUIDE 也守了一道） */
export const API_PLANE_NOTE =
  '- 以上就是你的全部 api 组与顶层函数：速查之外没有别的组，调用会被沙箱当场拒绝，回执会列出本次开放的组。'

/** 节点 path 寻址口径（只有持有 api.node 组的声部渲染，随 P1 速查附在后面） */
export const NODE_PATH_NOTE =
  "- path 寻址：'' = 当前节点；'极限' = 本目标标题；'极限/笔记' = 笔记；'#id' = 直接给节点 id。找不到时回执会列候选，照着改一次就对。"

/** 通用纪律（需求解耦 / 查证要真读 / 不钻牛角尖）：四位声部逐字同一段，导师也用它 */
export const SHARED_DISCIPLINE = [
  '约束与纪律：',
  '- **需求解耦（重要，违反是大错）**：学习者（或委托指令）提出的内容若与当前任务无关，视为独立需求直接响应或如实说明，绝不强行串联。',
  '- **查证要真读**：引用得到的结论必须读过原文；引用不到权威来源时如实说明，不要用「据说」含糊带过，严禁编造。',
  '- **不钻牛角尖（重要）**：同一个方案失败两次、连续几步没有新信息，就换路径（换 api、换数据源、把大问题拆小）或如实说明卡点与备选；转向前用 api.tmp 记下「试过什么、为什么不行」。',
].join('\n')

/**
 * 全员共同前缀（P0-A）：全部七位智能体（聊天龟 + 六位执行声部）系统提示词的绝对起始块（逐字节一致）。
 * 块序：龟门总纲（七兄弟身份） → execute/rexecute 机制 → 先查再用 → 应用数据守门 → 沙箱纪律 → 通用纪律。
 * 全部内容对七位智能体逐字为真，通篇不提未开放 API 组，确保从 token 0 起全员命中缓存。
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
 * 执行声部共同前缀全文（P0）：六位执行声部的系统提示词都以它开头（逐字节一致）。
 * 块序：全员通用前缀（ALL_AGENTS_COMMON_PREFIX） → 团队协作（TEAM_GUIDE） → compact 会话压缩规程。
 * 声部间分化的内容（专属分工、API 速查、引用与交付、排版语法、专属工作流规程）都在 P1。
 */
export const SHARED_AGENT_PREFIX = [
  ALL_AGENTS_COMMON_PREFIX,
  '',
  TEAM_GUIDE,
  '',
  compactWorkflowSection(),
].join('\n')
