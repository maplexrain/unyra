/**
 * 消息列表的 props：谁给数据、谁收回调。
 *
 * 画在 useMessageList.tsx，分出来的理由见那里——这里只有类型，
 * 于是那两个文件都能引用它而不互相 import（那会绕成环）。
 */

import type {
  AgentPart,
  ConversationMessage,
  ContextSummary,
  MessageImage,
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
   * 思维层：消息不带聊天气泡；每条消息内部的思考 / 工具 / 正文拆成平级原子行，
   * work 消息也走同一套拆分，再按时间戳并入 role 时间线。消息行头部另画渠道与上下文账。
   */
  mind?: boolean
  /** 当前 role 的显示名：mind 无信封行与用户消息对端标签用 */
  agentName?: string
  /** 当前 role 的头像 id */
  agentAvatarId?: string
  /**
   * work 消息：只用于思维列表的线性展示，按时间戳并入 role 消息之间。
   * 它们不写回 conversation.messages，也不参与上下文。
   */
  workMessages?: WorkTimelineMessage[]
  /** 最近窗口的复位键：切换会话 / 目标时必须回到尾部，不沿用上一段的加载深度 */
  resetKey?: string
}

/**
 * 思维列表里的一条 work 消息。
 *
 * 它和 role 消息共用同一条时间线，所以「这是哪条 work 的消息」必须跟着每条 item 走，
 * 不能靠外层一个连续 work 块来隐式绑定；ts 是消息本身的原始时间戳，order 是同一条
 * work 内的会话序号，时间线用二者推出不倒退的排序位置（见 useMessageList）。
 */
export interface WorkTimelineMessage {
  m: ConversationMessage
  workId: string
  workName: string
  ts: number
  /**
   * work 会话内的消息序号：调用方保留的稳定序号；时间线展示严格按 ts 平铺，
   * 不再用 order 修正排序（同一秒内才作为稳定的同 ts 次序）。
   */
  order: number
}
