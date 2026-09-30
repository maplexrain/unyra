/**
 * 这个文件负责「一轮回复的两端」：轮次进行中的增量落库（upsertAssistantInFlight）与
 * 进程被杀后的载入恢复（recoverInterruptedTurn）。
 *
 * 背景：assistant 的回复过去要等整轮 agent loop 跑完才落库，进程被杀（崩溃 / 强杀 / 断电）
 * 就丢掉一整轮——而工具调用的**副作用**（写文档、改节点）早就落库了，记录却没了，
 * 导师下一轮完全不知道自己做到哪一步。现在回复在跑的过程中就分次进会话：
 * 工具卡片（调用/返回）是「导师做过什么」的账，里程碑事件一出现就落；流式正文走节流，
 * 最多丢一个 TURN_FLUSH_MS 的增量。
 *
 * 「没收口」的唯一判据是会话上的 **inflight 标记**（agent/types 的 Conversation.inflight）：
 * 轮次开始时写上、收口时清掉。所以恢复只发生在真被杀的轮次上——用户点「停止」的轮次
 * 走正常收口，不会被误标；老数据没有这个标记，也不会被误伤。
 */
import type { Conversation, ConversationMessage } from '../../agent/types'
import { t } from '../../i18n'

/** 流式正文/思考的落库节流间隔；里程碑事件（工具调用/返回、运行时提示）不等它，立刻落 */
export const TURN_FLUSH_MS = 2000

/** 中断恢复时给没跑完的执行补的回执文案；导师下一轮读到它才知道自己做到哪一步 */
const INTERRUPTED_RESULT = '（这次执行没有完成：应用退出时它还在运行，结果未知）'

/**
 * 把正在跑的回复整条替换进会话：第一次是追加，之后按固定 id 替换（msg.id 由轮次开始时定下）。
 * settle=true 表示轮次收口（正常结束或被用户停止）：同时清掉 inflight 标记，载入恢复不再认它。
 */
export function upsertAssistantInFlight(conv: Conversation, msg: ConversationMessage, settle = false): Conversation {
  const exists = conv.messages.some((m) => m.id === msg.id)
  const messages = exists ? conv.messages.map((m) => (m.id === msg.id ? msg : m)) : [...conv.messages, msg]
  return { ...conv, messages, updatedAt: Date.now(), ...(settle ? { inflight: undefined } : {}) }
}

/**
 * 载入时的中断恢复：inflight 标记还在 = 那一轮没跑完进程就没了。
 * - 已有正文/工具片段：还在跑的执行补一条「结果未知」的回执（保持调用/返回成对，
 *   服务端的配对校验不受影响），末尾加一条中断说明——**模型也要读得到**，下一轮才接得上；
 * - 一个片段都没有：整条丢弃，用户消息原地留着（如实反映「发了但没等到回复」）；
 * - 标记清掉：恢复本身要幂等，第二次载入不再补第二条说明。
 */
export function recoverInterruptedTurn(conv: Conversation): Conversation {
  const inflight = conv.inflight
  if (!inflight) return conv
  const target = conv.messages.find((m) => m.id === inflight.messageId)
  const hasContent = !!target && target.parts.some((p) => p.type === 'text' || p.type === 'tool')
  if (!target || !hasContent) {
    return { ...conv, messages: conv.messages.filter((m) => m.id !== inflight.messageId), inflight: undefined }
  }
  const parts = target.parts.map((p) =>
    p.type === 'tool' && p.status === 'running'
      ? { ...p, status: 'error' as const, ok: false, result: INTERRUPTED_RESULT }
      : p,
  )
  const messages = conv.messages.map((m) =>
    m.id === inflight.messageId
      ? {
          ...target,
          parts: [
            ...parts,
            {
              type: 'notice' as const,
              level: 'warn' as const,
              text: t('⚠️ 这一轮回复在应用退出时被中断，以上是中断前保存的进度。'),
            },
          ],
        }
      : m,
  )
  return { ...conv, messages, inflight: undefined }
}
