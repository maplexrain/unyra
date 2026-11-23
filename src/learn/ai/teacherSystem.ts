/**
 * 导师 role（tutor）的系统提示词 = **共同前缀（SHARED_AGENT_PREFIX，P0）+ 固定组 API + 身份 / 分工**。
 *
 * role 层只保留对外沟通与对内调度的信息，不背执行规程、领域语法、排版配方与工作流；
 * 这些全部由 work 的系统提示词（`buildWorkSystem('tutor')`）负责。顺序固定，不与用户配置
 * 或会话内容混写——同样的代码永远产出同样的字节，前缀缓存才稳定。
 *
 * 文案与分段由 promptSections 统一装配（voiceCopy + apiPromptSections + roleWorkGuide），
 * 这里只做拼接——设置页预览与运行期发出的提示词是同一份，不再各写一遍。
 */
import { getAgentPromptSections, joinPromptSections } from './promptSections'

/**
 * 导师声部的系统提示词。**完全固定**：同样的代码永远产出同样的字节。
 */
export function buildTeacherSystem(opts: {
  /** 学习者额外追加的自定义系统提示词（启用时追加在末尾） */
  extraSystemPrompt?: string
} = {}): string {
  return joinPromptSections(getAgentPromptSections('tutor', opts))
}
