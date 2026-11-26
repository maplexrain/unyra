/**
 * 这个文件负责：固定聊天 Agent（自由会话）的系统提示词。
 *
 * 自由聊天没有特定的学习目标知识树与考试要求。它只拿 role 固定面
 * （tmp / work / chat / compact），领域与联网能力全部通过 work 落地；
 * 沙箱开放面与 useAgent 里 freeSandbox 的 apiAllow 保持同一口径。
 *
 * 顺序（用户定稿的「API 先于身份」）：全员共同前缀 → 固定组 API 能力面（架构固定）→
 * 身份定位 → 职责边界。文案块在 freeChatCopy，分段由 promptSections
 * 统一装配，设置页预览与运行期逐字节一致。
 */
import { getAgentPromptSections, joinPromptSections } from './promptSections'

export function buildFreeChatSystem(opts?: { extraSystemPrompt?: string }): string {
  return joinPromptSections(getAgentPromptSections('free', opts))
}
