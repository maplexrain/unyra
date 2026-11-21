/**
 * 四位执行声部（导师 / 命题官 / 判卷官 / 资料员）系统提示词的**共同前缀（P0）**。
 *
 * 为什么要一份逐字节相同的共同前缀：多声部并发调用时，各声部各自的对话共享同一段
 * system 前缀才能命中服务端前缀缓存——把「与声部无关」的口径全部提到最前面（团队协作、
 * execute 机制、通用 api 速查、沙箱纪律、引用与交付、通用纪律、compact 规程），各声部
 * 的专属内容（角色 / 分工 / 专属组 / 排版语法 / 专属工作流）追加在后（P1，见
 * teacherSystem 与 agentTeamSystem）。
 *
 * 顺序纪律不变：越不可变越靠前——P0 对四份提示词逐字节一致，P1 按声部分化，末尾才是
 * 会随设置变化的附加提示词。改这里任何一行，四份提示词的前缀同时变（这正是目的）。
 */

import { AGENT_API_PLANES } from '../../agent/agentProfile'
import {
  groupIndexForSystemPrompt,
  renderCompactApiGroupBlocks,
  renderCompactApiHeader,
} from '../../agent/sandbox/apiRegistry'
import { APP_DATA_GUIDE, EXECUTE_BASE_GUIDE, SANDBOX_DISCIPLINE_GUIDE, SEEK_HELP_GUIDE } from './executeGuide'
import { CHIP_DELIVERY_GUIDE } from './guides'
import { TEAM_GUIDE } from './teamGuide'
import { compactWorkflowSection } from './workflowsGuide'

/**
 * 通用 api 组（用户定稿的 11 组：对四份声部都值得预先在场）与顶层函数全集。
 * 分工面之外的组 / 顶层函数调用会被沙箱当场拒绝——速查的注记行说明这一点，
 * 各声部「你的分工」一节再给出它真正拥有的面。
 */
const SHARED_GROUP_KEYS: ReadonlySet<string> = new Set([
  'node', 'tmp', 'team', 'wf', 'delivery', 'chip', 'web', 'files', 'project', 'res', 'workspace',
])
const SHARED_TOP_LEVEL: readonly string[] = ['help', 'wait', 'ask', 'tiktok', 'compact', 'fetch', 'see']

/** P0 速查的文档键（组名 + 顶层函数名 + core 展示组） */
export const SHARED_API_DOC_KEYS: ReadonlySet<string> = new Set<string>([
  ...SHARED_GROUP_KEYS,
  ...SHARED_TOP_LEVEL,
  'core',
])

/** 某声部在通用面**之外**的专属组（P1 速查只渲染这些） */
export function extraApiDocKeys(voice: 'tutor' | 'examiner' | 'grader' | 'researcher'): ReadonlySet<string> {
  return new Set(AGENT_API_PLANES[voice].groups.filter((g) => !SHARED_GROUP_KEYS.has(g)))
}

const API_REFERENCE = [
  '**API 集总览索引**（通用组；每位声部的专属组在其「你的分工」之后的专属速查里）',
  groupIndexForSystemPrompt(SHARED_API_DOC_KEYS),
  '',
  renderCompactApiHeader(),
  '各组与顶层函数按声部分工开放：上面是通用面，分工面之外的组与顶层函数（ask / tiktok / fetch / see 等按各声部「你的分工」为准）调用会被沙箱当场拒绝，回执会列出本次开放的组——动手前先对照「你的分工」。',
  '',
  renderCompactApiGroupBlocks(SHARED_API_DOC_KEYS),
].join('\n')

/** 通用纪律（需求解耦 / 查证要真读 / 不钻牛角尖）：四位声部逐字同一段，导师也用它 */
const SHARED_DISCIPLINE = [
  '约束与纪律：',
  '- **需求解耦（重要，违反是大错）**：学习者（或委托指令）提出的内容若与当前任务无关，视为独立需求直接响应或如实说明，绝不强行串联。',
  '- **查证要真读**：引用得到的结论必须读过原文；引用不到权威来源时如实说明，不要用「据说」含糊带过，严禁编造。',
  '- **不钻牛角尖（重要）**：同一个方案失败两次、连续几步没有新信息，就换路径（换 api、换数据源、把大问题拆小）或如实说明卡点与备选；转向前用 api.tmp 记下「试过什么、为什么不行」。',
].join('\n')

/**
 * 共同前缀全文：四位执行声部的系统提示词都以它开头（逐字节一致）。
 * 块序（用户定稿）：团队协作 → execute 机制 → 先查再用 → 应用数据 → 沙箱纪律 →
 * 通用 api 速查 → 引用与交付 → 通用纪律 → compact 规程。
 */
export const SHARED_AGENT_PREFIX = [
  TEAM_GUIDE,
  '',
  EXECUTE_BASE_GUIDE,
  '',
  SEEK_HELP_GUIDE,
  '',
  APP_DATA_GUIDE,
  '',
  SANDBOX_DISCIPLINE_GUIDE,
  '',
  API_REFERENCE,
  '',
  CHIP_DELIVERY_GUIDE,
  '',
  SHARED_DISCIPLINE,
  '',
  compactWorkflowSection(),
].join('\n')
