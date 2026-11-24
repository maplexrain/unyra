/**
 * 消息列表的 props：谁给数据、谁收回调。
 *
 * 画在 useMessageList.tsx，分出来的理由见那里——这里只有类型，
 * 于是那两个文件都能引用它而不互相 import（那会绕成环）。
 */

import type { ReactNode } from 'react'
import type {
  AgentPart,
  ConversationMessage,
  ContextSummary,
  MessageImage,
  MessageUsage,
} from '../../../agent/types'

export interface MessageListProps {
  messages: ConversationMessage[]
  /** 失活的分界线：从这一条（下标）起还在上下文里，前面的已经被折进摘要、只作显示 */
  summaryStart: number
  /** 摘要（压缩之后它就是第一条消息） */
  summary: ContextSummary | null
  summaryOpen: boolean
  setSummaryOpen: React.Dispatch<React.SetStateAction<boolean>>
  streaming: AgentPart[] | null
  running: boolean
  /** loop 还在跑时，末尾那行波浪旁边的说明文字 */
  loopLabel: string
  /** 刚从定位条跳过来的那条消息：闪一下 */
  flashId: string | null
  /** 每条消息的 DOM：定位条与缩放都要用 */
  msgRefs: React.RefObject<Map<string, HTMLDivElement>>
  /** 点中断说明旁的「继续」：恢复被中断的一轮（身份恒定，见 AgentPanel） */
  onResumeNotice?: () => void
  setBubblePreview: React.Dispatch<React.SetStateAction<MessageImage | null>>
  /** 点击文件附件时在标签页中打开 */
  onOpenFile?: (pathOrRel: string, title?: string) => void
  /** 点击空态预设建议提问词时填入输入框 */
  onSelectPrompt?: (text: string) => void
  /** 目标 id：多目标下定位节点文档用，避免全局同名节点指针混淆 */
  goalId?: string
  /** 自由/固定聊天页签（不是导师，空占位显示通用对话内容） */
  free?: boolean
  /** 空态随 role：role id（'free' = 仅聊天）与显示名 */
  emptyVoice?: string
  emptyName?: string
  /**
   * 思维层：消息不带聊天气泡；相邻思考/工具/提示词收成一条可折叠过程组，
   * 消息行头部另画渠道与上下文账。work 视图恒为 true；role 视图由 chat/mind 页签决定。
   */
  mind?: boolean
  /** 当前 role 的显示名：mind 无信封行与用户消息对端标签用 */
  agentName?: string
  /** 当前 role 的头像 id */
  agentAvatarId?: string
  /** 当前 role 的 token 账：mind 顶部画上下文占用 / 累计消耗 */
  usages?: MessageUsage[]
  /** work 消息的内嵌折叠窗口（默认收起），由 AgentPanel 统一渲染在列表底部 */
  workWindow?: ReactNode
  /** 上下文摘要的标题主语（role 名），只影响文案 */
  contextSubject?: string
  /** 最近窗口的复位键：切换会话 / 目标时必须回到尾部，不沿用上一段的加载深度 */
  resetKey?: string
}
