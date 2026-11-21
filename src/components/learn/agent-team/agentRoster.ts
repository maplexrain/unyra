/**
 * agent team 左栏的**声部注册表**（纯展示数据）：5 位声部的角色标签、默认职责副标题、
 * 兜底图标与配色。运行时口径（名字 / 头像的 profile 覆盖、api 与工作流面）都在
 * agent/agentProfile；这里只管「左栏怎么画」。
 */

import { BookOpenText, Compass, GraduationCap, MessageSquare, NotebookPen, type LucideIcon } from 'lucide-react'
import type { AgentTeamMode } from './conversationList'

export interface AgentRosterMeta {
  /** 角色徽标（联系人卡片上的 tag） */
  roleTag: string
  /** 没有对话时的兜底副标题（与 agentProfile 的 AGENT_ROLE_BLURB 同口径） */
  blurb: string
  /** profile 没配头像时的兜底图标 */
  fallbackIcon: LucideIcon
  /** 头像底色（激活态） */
  avatarClass: string
  /** 角色徽标配色（激活态） */
  ringClass: string
}

/** 左栏顺序：仅聊天 / 导师 / 三位承接声部（与 agentProfile 的 AGENT_TEAM_IDS 同序） */
export const AGENT_ROSTER_META: Record<AgentTeamMode, AgentRosterMeta> = {
  free: {
    roleTag: '跨目标',
    blurb: '纯对话 · 联网与日程',
    fallbackIcon: MessageSquare,
    avatarClass: 'bg-line/75 text-ink-strong border-line-strong/40',
    ringClass: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  },
  tutor: {
    roleTag: '学习导师',
    blurb: '主讲与协调 · 团队分诊',
    fallbackIcon: GraduationCap,
    avatarClass: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/25',
    ringClass: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
  },
  examiner: {
    roleTag: '命题创作',
    blurb: '出卷 · 课件 · 超级实验室',
    fallbackIcon: NotebookPen,
    avatarClass: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/25',
    ringClass: 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
  },
  grader: {
    roleTag: '阅卷评分',
    blurb: '判分与错题讲解',
    fallbackIcon: BookOpenText,
    avatarClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25',
    ringClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  },
  researcher: {
    roleTag: '调研整理',
    blurb: '调研 · 浏览器 · 材料解读',
    fallbackIcon: Compass,
    avatarClass: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/25',
    ringClass: 'bg-teal-500/15 text-teal-600 dark:text-teal-300',
  },
}

/** 左栏的展示顺序（free 在最左，导师随后，承接声部依次排开） */
export const AGENT_ROSTER_ORDER: readonly AgentTeamMode[] = ['free', 'tutor', 'examiner', 'grader', 'researcher']
