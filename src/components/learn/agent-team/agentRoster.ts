/**
 * 角色阵容左栏的**role 注册表**（纯展示数据）：各 role 的角色标签、默认职责副标题、
 * 兜底图标与配色。运行时口径（名字 / 头像的 profile 覆盖、api 与工作流面）都在
 * agent/agentProfile；这里只管「左栏怎么画」。
 */

import { Compass, GraduationCap, MessageSquare, NotebookPen, Palette, Route, Wrench, type LucideIcon } from 'lucide-react'
import { COMMUNICABLE_VOICES, CONTENT_VOICES, type AgentProfileId } from '../../../agent/agentProfile'
import type { AgentTeamMode } from './conversationList'

/** 一位 role 的近况统计（AgentSlot 按目标作用域算好带来，roster 联系人卡片消费） */
export interface AgentVoiceStats {
  running: boolean
  hasAsk: boolean
  preview?: string
  lastTime?: number
  count?: number
}

/** 各 role 近况的缺省（没有统计时用） */
export const EMPTY_VOICE_STATS: AgentVoiceStats = { running: false, hasAsk: false }

export interface AgentRosterMeta {
  /** 角色徽标（联系人卡片上的 tag） */
  roleTag: string
  /** 没有对话时的兜底副标题（与 agentProfile 的 AGENT_ROLE_BLURB 同口径） */
  blurb: string
  /** 会话列表空态的文案（跟随 role 名称与功能） */
  emptyHint: string
  /** profile 没配头像时的兜底图标 */
  fallbackIcon: LucideIcon
  /** 头像底色（激活态） */
  avatarClass: string
  /** 角色徽标配色（激活态） */
  ringClass: string
  /** 角色名称的高亮色：聊天 / 群聊 / 思维抬头用不同颜色区分是哪个 role */
  nameClass: string
}

/** 一位 role 的能力标签（联系人卡片上的小徽章）：可交流 / 内容生成 / 工作流触发 */
export function voiceTags(id: AgentProfileId): string[] {
  const tags: string[] = []
  const voice = id === 'free' ? undefined : (id as Exclude<AgentProfileId, 'free'>)
  if (id === 'free' || (voice && COMMUNICABLE_VOICES.has(voice))) tags.push('可交流')
  else tags.push('工作流触发')
  if (voice && CONTENT_VOICES.has(voice)) tags.push('内容生成')
  return tags
}

/** 左栏顺序：调度员（任务入口） / 导师 / 四位承接 role（展示顺序，与运行时名单顺序无关） */
export const AGENT_ROSTER_META: Record<AgentTeamMode, AgentRosterMeta> = {
  free: {
    roleTag: '无目标',
    blurb: '自由对话运行态（不在团队名册）',
    emptyHint: '暂无对话历史',
    fallbackIcon: MessageSquare,
    avatarClass: 'bg-line/75 text-ink-strong border-line-strong/40',
    ringClass: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
    nameClass: 'text-emerald-700 dark:text-emerald-300',
  },
  tutor: {
    roleTag: '学习导师',
    blurb: '主讲与协调 · 角色分诊',
    emptyHint: '还没有对话：直接说需求，或从工作流发起',
    fallbackIcon: GraduationCap,
    avatarClass: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/25',
    ringClass: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
    nameClass: 'text-sky-700 dark:text-sky-300',
  },
  dispatcher: {
    roleTag: '调度分派',
    blurb: '接需求 · chat 派单 / work · 交付汇报',
    emptyHint: '还没有会话：把需求直接说给我，或由工作流触发',
    fallbackIcon: Route,
    avatarClass: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/25',
    ringClass: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300',
    nameClass: 'text-indigo-700 dark:text-indigo-300',
  },
  examiner: {
    roleTag: '出卷阅卷',
    blurb: '出卷 · 判分与错题讲解',
    emptyHint: '还没有会话：出卷与阅卷任务会自动落到这里',
    fallbackIcon: NotebookPen,
    avatarClass: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/25',
    ringClass: 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
    nameClass: 'text-violet-700 dark:text-violet-300',
  },
  designer: {
    roleTag: '课堂设计',
    blurb: '互动课堂 · 超级实验室',
    emptyHint: '还没有会话：课件与实验任务会自动落到这里',
    fallbackIcon: Palette,
    avatarClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25',
    ringClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
    nameClass: 'text-amber-700 dark:text-amber-300',
  },
  researcher: {
    roleTag: '调研实操',
    blurb: '联网调研 · 浏览器操作',
    emptyHint: '还没有会话：浏览器任务由工作流与 role 派单触发',
    fallbackIcon: Compass,
    avatarClass: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/25',
    ringClass: 'bg-teal-500/15 text-teal-600 dark:text-teal-300',
    nameClass: 'text-teal-700 dark:text-teal-300',
  },
  fixer: {
    roleTag: '修复维修',
    blurb: '函数图像语法修复',
    emptyHint: '还没有会话：修复任务由用户在报错卡片上触发',
    fallbackIcon: Wrench,
    avatarClass: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/25',
    ringClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
    nameClass: 'text-rose-700 dark:text-rose-300',
  },
}

/** 左栏的展示顺序（导师 / 调度员 / 四位承接 role；自由对话不在团队名册） */
export const AGENT_ROSTER_ORDER: readonly AgentTeamMode[] = ['tutor', 'dispatcher', 'examiner', 'designer', 'researcher', 'fixer']
