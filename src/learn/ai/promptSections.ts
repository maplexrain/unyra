/**
 * 系统提示词结构化分段（Prompt Sections）与共同提示词（Common Prompts）独立模块。
 *
 * 核心设计：
 * 1. 将系统提示词拆解为相互独立的结构化段落（索引、标题、类别徽标、颜色主题、内容），
 *    同时将「全员/执行声部共用的基础提示词」（身份总纲、团队协作、沙箱执行约束、压缩规程）
 *    明确独立出来，供 UI 展示与独立复用。
 * 2. **这里是六位团队角色与自由对话系统提示词的唯一装配来源**：运行期的 buildFreeChatSystem /
 *    buildTeacherSystem / buildVoiceSystem 都把这里的分段按 '\n\n' 拼回去，设置页的预览
 *    直接展示同一份分段——预览与真正发出的提示词不会再各说各话。
 * 3. role 的顺序（用户定稿）：共同基础前缀 → **固定组 API** → 身份定位 → 分工（能做什么）
 *    → 附加提示词。role 只拿「沟通 + 调度」信息；排版、领域语法、工作流规程、领域纪律
 *    都归 work，由 `workSystem` 装配（见 buildWorkSystem）。
 */

import { type AgentVoice } from '../../agent/agentProfile'
import {
  ALL_AGENTS_COMMON_PREFIX,
  SHARED_AGENT_PREFIX,
  SHARED_DISCIPLINE,
} from './agentSharedPrefix'
import { apiPromptPartsFor } from './apiPromptSections'
import {
  APP_DATA_GUIDE,
  EXECUTE_BASE_GUIDE,
  SANDBOX_DISCIPLINE_GUIDE,
  SEEK_HELP_GUIDE,
} from './executeGuide'
import { FREE_CHAT_API_SECTION, FREE_CHAT_BOUNDARY, FREE_CHAT_IDENTITY } from './freeChatCopy'
import { ROLE_CHANNEL_GUIDE, ROLE_WORK_GUIDE } from './roleWorkGuide'
import { TURTLE_CLAN_GUIDE } from './turtleClan'
import { voiceCopyOf } from './voiceCopy'
import { compactWorkflowSection } from './workflowsGuide'
import type { AgentProfileId } from '../../agent/agentProfile'

/** 提示词分段颜色主题 */
export type PromptSectionColor =
  | 'indigo'
  | 'blue'
  | 'emerald'
  | 'amber'
  | 'purple'
  | 'rose'
  | 'teal'
  | 'slate'

export interface PromptSection {
  id: string
  index: number
  title: string
  badge: string
  color: PromptSectionColor
  /** 是否属于全员或多声部共同提示词 */
  isCommon?: boolean
  /** 该部分的 markdown 提示词源文本 */
  content: string
}

/* =========================================================================
 * 共同提示词组件（独立导出）
 * ========================================================================= */

/** 共同提示词：龟门六兄弟身份总纲（所有 Agent 共同拥有） */
export const COMMON_TURTLE_CLAN_PROMPT = TURTLE_CLAN_GUIDE

/** 共同提示词：role 层协作总纲与三通道纪律（所有 role 拥有） */
export const COMMON_TEAM_COLLABORATION_PROMPT = ROLE_WORK_GUIDE + '\n\n' + ROLE_CHANNEL_GUIDE

/** 共同提示词：执行沙箱、守门与通用纪律（所有执行声部拥有） */
export const COMMON_EXECUTION_DISCIPLINE_PROMPT = [
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

/** 共同提示词：会话压缩规程（所有执行声部拥有） */
export const COMMON_COMPACT_WORKFLOW_PROMPT = compactWorkflowSection()

/** 全员共同提示词全文（六位团队角色起始块） */
export const COMMON_ALL_AGENTS_PREFIX_PROMPT = ALL_AGENTS_COMMON_PREFIX

/** 执行声部共同基础前缀全文（即 SHARED_AGENT_PREFIX） */
export const COMMON_EXECUTION_PREFIX_PROMPT = SHARED_AGENT_PREFIX

/* =========================================================================
 * 公共分段构造
 * ========================================================================= */

interface BuildSectionsOpts {
  extraSystemPrompt?: string
}

/** 分段收尾：用户附加自定义系统提示词（启用时才出现） */
function extraSection(id: string, opts: BuildSectionsOpts): PromptSection[] {
  if (!opts.extraSystemPrompt?.trim()) return []
  return [
    {
      id,
      index: 0,
      title: '用户附加自定义系统提示词',
      badge: '附加提示',
      color: 'slate',
      content: [
        '【用户附加自定义系统提示词（具有高优先级效力）】：',
        opts.extraSystemPrompt.trim(),
      ].join('\n'),
    },
  ]
}

/** 统一编号并丢弃空内容（防御：某声部没语法段时不留空壳） */
function numbered(sections: PromptSection[]): PromptSection[] {
  return sections
    .filter((s) => s.content.trim().length > 0)
    .map((s, idx) => ({ ...s, index: idx + 1 }))
}

/** 把分段拼回系统提示词全文（运行期 build* 与预览共用同一口径） */
export function joinPromptSections(sections: PromptSection[]): string {
  return sections.map((s) => s.content).join('\n\n')
}

/** 固定组 API 段（六位 role 逐字节一致） */
function fixedApiSection(voice: AgentVoice, content: string): PromptSection {
  return {
    id: `${voice}-api-fixed`,
    index: 0,
    title: '固定组 API 能力面（全员共用）',
    badge: '固定组',
    color: 'blue',
    isCommon: true,
    content,
  }
}

/** role 层的人格与分工两段（语法 / 工作流 / 领域纪律全部在 work 提示词里） */
function voiceCopySections(voice: AgentVoice): PromptSection[] {
  const copy = voiceCopyOf(voice)
  return [
    {
      id: `${voice}-role`,
      index: 0,
      title: voice === 'tutor' ? '导师角色定位与节点宇宙哲学' : 'role 角色定位',
      badge: '身份定位',
      color: 'rose',
      content: copy.role.join('\n'),
    },
    {
      id: `${voice}-duty`,
      index: 0,
      title: voice === 'tutor' ? '团队协调与任务分诊' : '你的专属分工',
      badge: '分工协调',
      color: 'amber',
      content: copy.duty.join('\n'),
    },
  ]
}

/* =========================================================================
 * 各声部分段构建器
 * ========================================================================= */

/** 拆解 Free Chat（自由对话）的提示词分段 */
function getFreeChatSections(opts: BuildSectionsOpts = {}): PromptSection[] {
  return numbered([
    {
      id: 'free-common-prefix',
      index: 0,
      title: '全员共同提示词 · 龟门身份与执行沙箱基座',
      badge: '全员基座',
      color: 'indigo',
      isCommon: true,
      content: ALL_AGENTS_COMMON_PREFIX,
    },
    {
      id: 'free-api-fixed',
      index: 0,
      title: '固定组 API 能力面（架构固定）',
      badge: '固定组',
      color: 'blue',
      content: FREE_CHAT_API_SECTION,
    },
    {
      id: 'free-role',
      index: 0,
      title: '自由对话定位与页签说明',
      badge: '身份定位',
      color: 'rose',
      content: FREE_CHAT_IDENTITY,
    },
    {
      id: 'free-boundary',
      index: 0,
      title: '核心边界与任务终止铁律（绝对红线）',
      badge: '安全红线',
      color: 'rose',
      content: FREE_CHAT_BOUNDARY,
    },
    ...extraSection('free-extra', opts),
  ])
}

/** 拆解执行声部的提示词分段（导师与五位承接声部共用同一骨架） */
function getVoiceSections(voice: AgentVoice, opts: BuildSectionsOpts = {}): PromptSection[] {
  const parts = apiPromptPartsFor(voice)
  return numbered([
    {
      id: `${voice}-common-prefix`,
      index: 0,
      title: '共同提示词 · 团队协作与沙箱执行基座',
      badge: '共同基础',
      color: 'indigo',
      isCommon: true,
      content: SHARED_AGENT_PREFIX,
    },
    fixedApiSection(voice, parts.fixed),
    ...voiceCopySections(voice),
    ...extraSection(`${voice}-extra`, opts),
  ])
}

/**
 * 统一获取某位 Agent 的全部提示词切片
 */
export function getAgentPromptSections(
  agentId: AgentProfileId,
  opts: BuildSectionsOpts = {},
): PromptSection[] {
  if (agentId === 'free') return getFreeChatSections(opts)
  return getVoiceSections(agentId as AgentVoice, opts)
}
