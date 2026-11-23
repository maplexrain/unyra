/**
 * 系统提示词结构化分段（Prompt Sections）与共同提示词（Common Prompts）独立模块。
 *
 * 核心设计：
 * 1. 将系统提示词拆解为相互独立的结构化段落（索引、标题、类别徽标、颜色主题、内容），
 *    同时将「全员/执行声部共用的基础提示词」（身份总纲、团队协作、沙箱执行约束、压缩规程）
 *    明确独立出来，供 UI 展示与独立复用。
 * 2. **这里是七位智能体系统提示词的唯一装配来源**：运行期的 buildFreeChatSystem /
 *    buildTeacherSystem / buildVoiceSystem 都把这里的分段按 '\n\n' 拼回去，设置页的预览
 *    直接展示同一份分段——预览与真正发出的提示词不会再各说各话。
 * 3. 顺序（用户定稿）：共同基础前缀 → **共用排版与视觉规范**（导师 / 出卷 / 设计逐字节一致）→
 *    **固定组 API 能力面** → **非固定组 API 能力面** → 身份定位 → 分工 → 专用语法 → 工作流
 *    → 纪律 → 附加提示词。排版与能力面都先于身份：模型先知道「内容长什么样、手里有什么」，
 *    再读自己是谁。
 */

import { AGENT_WORKFLOW_PLANES, CONTENT_VOICES, type AgentVoice } from '../../agent/agentProfile'
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
import {
  FREE_CHAT_API_SECTION,
  FREE_CHAT_BOUNDARY,
  FREE_CHAT_IDENTITY,
  FREE_CHAT_SEARCH_SECTION,
} from './freeChatCopy'
import { TEAM_GUIDE } from './teamGuide'
import { TURTLE_CLAN_GUIDE } from './turtleClan'
import { SHARED_TYPOGRAPHY_GUIDE } from './typographyGuide'
import { voiceCopyOf } from './voiceCopy'
import { compactWorkflowSection, workflowGuideFor } from './workflowsGuide'
import type { AgentTeamMode } from '../../components/learn/agent-team/conversationList'

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

/** 共同提示词：龟门七兄弟身份总纲（所有 Agent 共同拥有） */
export const COMMON_TURTLE_CLAN_PROMPT = TURTLE_CLAN_GUIDE

/** 共同提示词：团队协作与委托机制（所有执行声部拥有） */
export const COMMON_TEAM_COLLABORATION_PROMPT = TEAM_GUIDE

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

/** 全员共同提示词全文（全部七位智能体起始块） */
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

/** 共用排版与视觉规范（内容声部 tutor / examiner / designer 逐字节一致） */
function typographySections(voice: AgentVoice): PromptSection[] {
  if (!CONTENT_VOICES.has(voice)) return []
  return [
    {
      id: 'shared-typography',
      index: 0,
      title: '排版与视觉规范（内容声部共用）',
      badge: '排版指南',
      color: 'teal',
      isCommon: true,
      content: SHARED_TYPOGRAPHY_GUIDE,
    },
  ]
}

/** 固定组 API 段（六位执行声部逐字节一致） */
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

/** 非固定组 API 段（按本声部职责面渲染；为空时不出现） */
function variableApiSection(voice: AgentVoice, content: string): PromptSection[] {
  if (!content) return []
  return [
    {
      id: `${voice}-api-variable`,
      index: 0,
      title: '非固定组 API 能力面（本声部专属）',
      badge: '非固定组',
      color: 'emerald',
      content,
    },
  ]
}

/** 执行声部的身份 / 分工 / 语法 / 纪律四段（文案来自 voiceCopy，逐字定稿） */
function voiceCopySections(voice: AgentVoice): PromptSection[] {
  const copy = voiceCopyOf(voice)
  const out: PromptSection[] = [
    {
      id: `${voice}-role`,
      index: 0,
      title: voice === 'tutor' ? '导师角色定位与节点宇宙哲学' : '声部角色定位',
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
  if (copy.syntax.length) {
    out.push({
      id: `${voice}-syntax`,
      index: 0,
      title:
        voice === 'tutor'
          ? '教学文档专用语法（链接 / 大纲 / 围栏）'
          : voice === 'fixer'
            ? '函数图像语法规范'
            : '语法规范与呈现指南',
      badge: '语法指南',
      color: 'teal',
      content: copy.syntax.join('\n\n'),
    })
  }
  const workflowIds = AGENT_WORKFLOW_PLANES[voice].filter((id) => id !== 'compact')
  const wf = workflowIds.length ? workflowGuideFor(new Set(workflowIds)) : ''
  if (wf.trim()) {
    out.push({
      id: `${voice}-workflow`,
      index: 0,
      title: voice === 'tutor' ? '导师内置工作流规程' : '专属工作流触发规程',
      badge: '工作流',
      color: 'purple',
      content: wf.trim(),
    })
  }
  if (copy.discipline.length) {
    out.push({
      id: `${voice}-discipline`,
      index: 0,
      title: voice === 'tutor' ? '教学专属纪律补充' : '专属纪律约束',
      badge: '纪律补充',
      color: 'amber',
      content: copy.discipline.join('\n'),
    })
  }
  return out
}

/* =========================================================================
 * 各声部分段构建器
 * ========================================================================= */

/** 拆解 Free Chat（聊天龟）的提示词分段 */
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
      title: '聊天龟定位与页签说明',
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
    {
      id: 'free-search-discipline',
      index: 0,
      title: '网络搜索与引证执行纪律',
      badge: '检索纪律',
      color: 'teal',
      content: FREE_CHAT_SEARCH_SECTION,
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
    ...typographySections(voice),
    fixedApiSection(voice, parts.fixed),
    ...variableApiSection(voice, parts.variable),
    ...voiceCopySections(voice),
    ...extraSection(`${voice}-extra`, opts),
  ])
}

/**
 * 统一获取某位 Agent 的全部提示词切片
 */
export function getAgentPromptSections(
  agentId: AgentTeamMode,
  opts: BuildSectionsOpts = {},
): PromptSection[] {
  if (agentId === 'free') return getFreeChatSections(opts)
  return getVoiceSections(agentId as AgentVoice, opts)
}
