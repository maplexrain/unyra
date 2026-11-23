/**
 * 这个文件负责：固定聊天 Agent（自由会话）的系统提示词。
 *
 * 自由聊天没有特定的学习目标知识树与考试要求。它的能力面（DeepSeek 官方搜索 web.search、
 * 抓取 fetch、用户级日程 schedule.*）由架构固定、不可卸载——提示词因此恒定，profile 里没有
 * 能改变它的字段。沙箱开放面与 useAgent 里 freeSandbox 的 apiAllow 保持同一口径
 * （web / fetch / schedule / log），两边改要一起改。
 *
 * 顺序（用户定稿的「API 先于身份」）：全员共同前缀 → 固定组 API 能力面（架构固定）→
 * 身份定位 → 任务终止红线 → 检索纪律。文案块在 freeChatCopy，分段由 promptSections
 * 统一装配，设置页预览与运行期逐字节一致。
 */
import { getAgentPromptSections, joinPromptSections } from './promptSections'

export function buildFreeChatSystem(opts?: { extraSystemPrompt?: string }): string {
  return joinPromptSections(getAgentPromptSections('free', opts))
}
