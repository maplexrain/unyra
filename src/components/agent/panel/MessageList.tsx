/**
 * 消息列表的 props：谁给数据、谁收回调。
 *
 * 画在 useMessageList.tsx，分出来的理由见那里——这里只有类型，
 * 于是那两个文件都能引用它而不互相 import（那会绕成环）。
 */

import type { AgentPart, ConversationMessage, ContextSummary, MessageImage } from '../../../agent/types'

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
}
