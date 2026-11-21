/**
 * 智能体头像的图标映射：agent/agentProfile 的目录只存 id 与展示名（纯数据），
 * lucide 组件落在这里——两个渲染方（左栏声部项 / 智能体设置页）共用这一份。
 */

import {
  BookOpen,
  Bot,
  Brain,
  Compass,
  FlaskConical,
  GraduationCap,
  MessageSquare,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'

export const AGENT_AVATAR_ICONS: Record<string, LucideIcon> = {
  chat: MessageSquare,
  grad: GraduationCap,
  bot: Bot,
  book: BookOpen,
  flask: FlaskConical,
  compass: Compass,
  spark: Sparkles,
  brain: Brain,
}

/** 头像 id → 图标；认不出的 id 回落到 fallback（默认声部图标） */
export function agentAvatarIcon(avatarId: string | undefined, fallback: LucideIcon): LucideIcon {
  if (!avatarId) return fallback
  return AGENT_AVATAR_ICONS[avatarId] ?? fallback
}
