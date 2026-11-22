/**
 * 智能体头像的**目录与解析**（纯数据，组件在 AgentAvatarGlyph.tsx）：
 * agent/agentProfile 的目录只存 id 与展示名，两类头像的可视元素在这里解析——
 * **龟龟图片**（src/assets/agents/ 的 webp，归一智能体的默认形象）与
 * lucide 图标（设置里可换的简约款）。
 */

import {
  BookOpen,
  Bot,
  Brain,
  Compass,
  FlaskConical,
  GraduationCap,
  MessageSquare,
  Palette,
  Route,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import turtleChat from '../../../assets/agents/turtle-chat.webp'
import turtleDispatcher from '../../../assets/agents/turtle-dispatcher.webp'
import turtleTutor from '../../../assets/agents/turtle-tutor.webp'
import turtleExaminer from '../../../assets/agents/turtle-examiner.webp'
import turtleDesigner from '../../../assets/agents/turtle-designer.webp'
import turtleResearcher from '../../../assets/agents/turtle-researcher.webp'
import turtleFixer from '../../../assets/agents/turtle-fixer.webp'

export const AGENT_AVATAR_ICONS: Record<string, LucideIcon> = {
  chat: MessageSquare,
  grad: GraduationCap,
  bot: Bot,
  book: BookOpen,
  flask: FlaskConical,
  compass: Compass,
  spark: Sparkles,
  brain: Brain,
  wrench: Wrench,
  palette: Palette,
  route: Route,
}

/** 龟龟头像（图片资产）：id → 打包后的图片地址（Vite import，CSP img-src 'self' 覆盖得到） */
export const AGENT_AVATAR_IMAGES: Record<string, string> = {
  'turtle-chat': turtleChat,
  'turtle-dispatcher': turtleDispatcher,
  'turtle-tutor': turtleTutor,
  'turtle-examiner': turtleExaminer,
  'turtle-designer': turtleDesigner,
  'turtle-researcher': turtleResearcher,
  'turtle-fixer': turtleFixer,
}

/** 头像 id → 图标；认不出的 id 回落到 fallback（默认声部图标） */
export function agentAvatarIcon(avatarId: string | undefined, fallback: LucideIcon): LucideIcon {
  if (!avatarId) return fallback
  return AGENT_AVATAR_ICONS[avatarId] ?? fallback
}

/** 头像 id → 龟龟图片地址；不是图片头像返回 undefined */
export function agentAvatarImage(avatarId: string | undefined): string | undefined {
  return avatarId ? AGENT_AVATAR_IMAGES[avatarId] : undefined
}
