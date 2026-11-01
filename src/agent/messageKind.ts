/**
 * 隐藏消息的**注入类别**：工作流指令，还是提示词注入？
 *
 * 这个问题在界面上只有一个落点——**画不画那条分界条**（见 MessageBubble 的 HiddenDivider
 * 与 useMessageList 的分段）。从前两者混在一起：人格、文档格式、技能库、提示词模块
 * 几条一起注入时，分界条上那串「导师人格 · A | 文档格式 · B | 提示词模块 · C」被挤得溢出，
 * 而那一条本该只回答「这里触发了一次工作流」。
 *
 * 于是分成两类：
 * - **工作流指令**（instruction）：触发工作流时整段进入上下文的 user 消息（开讲 / 出卷 /
 *   阅卷 / 压缩…）。它是一道轮次边界，界面上画分界条，定位条也给它一个锚点。
 * - **提示词注入**（prompt）：人格 / 文档格式 / 技能库 / 提示词模块——补给上下文的东西，
 *   不分割轮次，并进那一轮的「思考、工具与提示词」过程组。
 *
 * 判据单独住在这里（而不是写进渲染里）的理由与 panel/partGroups 同一条：
 * 它出错的形态是「界面看着有点乱」，不报错、不崩，只有用例钉得住。
 */
import type { ConversationMessage, InjectKind } from './types'

/**
 * 这条消息是哪种注入；不是隐藏注入就回 null（普通用户消息、导师回复）。
 *
 * 显式字段优先。老数据（这个字段还不存在时落盘的会话）按**既有标记**反推：
 * 人格 / 文档格式 / 提示词模块 / 技能库四条都各自有身份字段（它们本来就要靠字段去重，
 * 见 needsPersonaAnnounce 等），所以反推是可靠的，不需要迁移。
 * 剩下的「hidden + mark」就是工作流指令——这正是加这个字段之前的口径。
 */
export function injectKindOf(m: ConversationMessage): InjectKind | null {
  if (m.inject) return m.inject
  if (!m.hidden) return null
  if (m.persona || m.docFormat || m.promptModule || m.skillsDigest || m.userInfo) return 'prompt'
  return m.mark ? 'instruction' : null
}

/** 工作流指令：画分界条、给定位条一个锚点 */
export function isInstructionMark(m: ConversationMessage): boolean {
  return injectKindOf(m) === 'instruction'
}

/**
 * 提示词注入：并进过程组，不画分界条。
 *
 * 只认 hidden——正文里的 prompt-module 片段（mid-loop 注入）不是消息，走的是另一条路
 * （见 panel/partGroups 的 isProcessPart）。
 */
export function isPromptInject(m: ConversationMessage): boolean {
  return injectKindOf(m) === 'prompt'
}
