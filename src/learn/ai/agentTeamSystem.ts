/**
 * 六位团队 role 的系统提示词（除导师外）与按 role 的统一入口（buildVoiceSystem）。
 * 导师的提示词在 teacherSystem（buildTeacherSystem）。
 *
 * 结构纪律与导师同源：**共同前缀（SHARED_AGENT_PREFIX，P0）→ 共用排版与视觉规范（仅内容
 * role）→ 固定组 API 速查（全员共用）→ 非固定组 API 速查（本 role 专属）→ 角色定位 → 你的
 * 分工 → 专用语法 → 内置工作流规程（compact 在共同前缀）→ role 专属纪律 → 学习者附加提示词**。
 * 全部文案与分段由 promptSections（voiceCopy + typographyGuide + apiPromptSections）统一装配，
 * 这里只按 role 取分段拼回去——设置页预览与运行期逐字节一致。承接会话的首轮照常固化进
 * Conversation.systemPrompt。
 */

import type { AgentVoice } from '../../agent/agentProfile'
import { getAgentPromptSections, joinPromptSections } from './promptSections'
import { buildTeacherSystem } from './teacherSystem'

interface VoiceSystemOpts {
  /** 学习者附加的自定义系统提示词（启用时追加在末尾，与导师同一条纪律） */
  extraSystemPrompt?: string
}

function buildVoice(voice: AgentVoice, opts: VoiceSystemOpts): string {
  return joinPromptSections(getAgentPromptSections(voice, opts))
}

/** 调度龟（dispatcher）：接收需求 → 用 chat.send / work 派单 → 跟踪 → 交付（工作流统一经它路由） */
export function buildDispatcherSystem(opts: VoiceSystemOpts = {}): string {
  return buildVoice('dispatcher', opts)
}

/** 出卷龟（examiner）：出卷 / 判分与错题讲解 */
export function buildExaminerSystem(opts: VoiceSystemOpts = {}): string {
  return buildVoice('examiner', opts)
}

/** 设计龟（designer）：互动课堂课件 / 超级实验室（课堂设计师） */
export function buildDesignerSystem(opts: VoiceSystemOpts = {}): string {
  return buildVoice('designer', opts)
}

/** 调研龟（researcher）：联网调研 / 内置浏览器实操（为团队其他声部提供网络消息的调研） */
export function buildResearcherSystem(opts: VoiceSystemOpts = {}): string {
  return buildVoice('researcher', opts)
}

/** 维修龟（fixer）：修复问题（目前仅解析失败的函数图像语法，用户主动触发） */
export function buildFixerSystem(opts: VoiceSystemOpts = {}): string {
  return buildVoice('fixer', opts)
}

/* ---------- 按声部的统一入口 ---------- */

/** 一位声部新对话将收到的系统提示词（导师走 buildTeacherSystem，承接声部在这里） */
export function buildVoiceSystem(
  voice: AgentVoice,
  opts: { extraSystemPrompt?: string } = {},
): string {
  switch (voice) {
    case 'tutor':
      return buildTeacherSystem({ extraSystemPrompt: opts.extraSystemPrompt })
    case 'dispatcher':
      return buildDispatcherSystem(opts)
    case 'examiner':
      return buildExaminerSystem(opts)
    case 'designer':
      return buildDesignerSystem(opts)
    case 'researcher':
      return buildResearcherSystem(opts)
    case 'fixer':
      return buildFixerSystem(opts)
  }
}
