/**
 * useAgent 导师轮的**收口**（从 useAgent.ts 原样搬出，原 runTurnUnchecked 的 finally）：
 * 无论这一轮是跑完、出错还是被用户中止，都要在这里把账结清——
 * - 收口落库：同一条 id 整条替换（带上 token 账与交付账）并清掉在途标记；
 * - 清各槽：running / streaming / tps / liveUsage / pendingAsk 里只摘自己这一会话的那格；
 * - wf.invoke 的出口：这一轮里导师交给工作流的活，在此刻起（新一轮）；
 * - 压缩的应用：api.compact 的摘要先记在会话上，**这里**才把之前的消息标成失活；
 *   没压成再看该不该自动压（判据是上一轮报回来的真实占用）。
 */

import type { Dispatch, SetStateAction } from 'react'
import type { AgentPart, Conversation, ConversationMessage, MessageUsage } from '../../agent/types'
import type { AgentRunTarget } from '../agent/sandboxOps'
import type { AskFormPayload } from '../../agent/tools'
import { hasDelivery, type DeliveryRecord } from '../../agent/delivery'
import { resetPrefixGate } from '../../agent/prefixGate'
import { loadAgentSettings } from '../../agent/settings'
import { upsertAssistantInFlight } from '../agent/inflight'
import { conversationById } from '../graph'
import { activeMessages, applyCompaction, shouldCompact } from '../compact'
import type { LearnStore } from '../types'
import type { AgentTurnTally } from './streamLoop'
import type { StreamingSlot } from './slots'

/**
 * 收口这一轮（原 runTurnUnchecked 的 finally 主体）。调用方已摘掉自己的中止器与
 * 落库节流器；这里做落库、清槽、工作流出队与压缩。
 */
export function settleTurn(io: {
  convKey: string
  target: AgentRunTarget
  assistantId: string
  parts: AgentPart[]
  tally: AgentTurnTally
  window: number
  turnDelivery: DeliveryRecord
  /** 这一轮就是压缩轮（「压缩上下文」工作流）：跑完不再触发自动压缩，见 runTurnUnchecked 的参数说明 */
  isCompactTurn: boolean
  persist: (next: Conversation) => void
  getLatest: () => LearnStore
  setRunning: Dispatch<SetStateAction<Record<string, true>>>
  setStreaming: Dispatch<SetStateAction<Record<string, StreamingSlot>>>
  setTps: Dispatch<SetStateAction<Record<string, number>>>
  setLiveUsage: Dispatch<SetStateAction<Record<string, MessageUsage>>>
  setPendingAsk: Dispatch<SetStateAction<Record<string, { id: string; form: AskFormPayload }>>>
  /** wf.invoke 的出队口（见 hook 里 wfDrainRef 的说明） */
  wfDrainRef: { current: ((target: AgentRunTarget) => boolean) | null }
  /** 到阈值自动压缩的触发口（见 hook 里 autoCompactRef 的说明） */
  autoCompactRef: { current: ((ratio: number) => void) | null }
  onNoticeRef: { current: ((message: string) => void) | undefined }
}) {
  const { convKey, target, assistantId, parts, tally, window, turnDelivery, isCompactTurn, persist, getLatest, setRunning, setStreaming, setTps, setLiveUsage, setPendingAsk, wfDrainRef, autoCompactRef, onNoticeRef } = io
  /**
   * 收口落库：同一条 id 整条替换（带上 token 账）并清掉在途标记——载入恢复从此
   * 不再认这条（用户点「停止」的轮次也算正常收口，不会被误标成中断）。
   * 落库要在 setStreaming(null) 之前：顺序反了会有一帧「列表里没有、流式也没了」的空档。
   */
  if (parts.length) {
    const stored = conversationById(getLatest(), target.conversationId)
    if (stored) {
      const assistantMsg: ConversationMessage = {
        id: assistantId,
        role: 'assistant',
        parts,
        ...(tally.turns
          ? {
              usage: {
                contextTokens: tally.context,
                contextWindow: window,
                totalTokens: tally.total,
                outputTokens: tally.output,
                cacheReadTokens: tally.read,
                cacheMissTokens: tally.miss,
                estimated: tally.estimated,
                ...(tally.tps ? { tps: tally.tps } : {}),
              },
            }
          : {}),
        // 这一轮登记过交付才带上：空记录不写盘，界面上也就不会出现一个空组件
        ...(hasDelivery(turnDelivery) ? { delivery: turnDelivery } : {}),
        ts: Date.now(),
      }
      persist(upsertAssistantInFlight(stored, assistantMsg, true))
    }
  }
  /*
   * 动态提示词注入（apiGroup / 内容触发，见 learn/ai/promptModules）：本轮 execute
   * 报上来的模块在此刻统一落库——排在刚收口的回复之后、只在队尾追加（前缀缓存安全）。
   * 去重以**活着的消息**为准（activeMessages 与请求走同一份口径）：已注过的不重注。
   * 模块消息随后若被压缩折掉（retired），下次使用会重新注入——那是设计内行为。
   */
  // 动态提示词注入已退役（首轮注入全量提示词）
  // 只清自己这一场：并发的其他导师的实时槽各归各
  setRunning((prev) => {
    if (!prev[convKey]) return prev
    const next = { ...prev }
    delete next[convKey]
    return next
  })
  setStreaming((prev) => {
    if (!(convKey in prev)) return prev
    const next = { ...prev }
    delete next[convKey]
    return next
  })
  setTps((prev) => {
    if (!(convKey in prev)) return prev
    const next = { ...prev }
    delete next[convKey]
    return next
  })
  setLiveUsage((prev) => {
    if (!(convKey in prev)) return prev
    const next = { ...prev }
    delete next[convKey]
    return next
  })
  // 表单若还挂着（异常路径）也一并收掉
  setPendingAsk((prev) => {
    if (!(convKey in prev)) return prev
    const next = { ...prev }
    delete next[convKey]
    return next
  })

  /*
   * wf.invoke 的出口（见 WorkflowOps.invoke）：这一轮里导师把活交给了某条工作流，
   * 在这一刻起它——工作流的指令要作为一条 user 消息进上下文，而刚才那一轮还在跑，
   * 在正在跑的循环底下插用户消息是不行的。drained 也用来挡掉顺手的那次自动压缩：
   * 两件事都要新起一轮，挨在一起只会互相插队（压缩本身会让刚排的指令一起失活）。
   */
  const drained = wfDrainRef.current?.(target) ?? false
  /*
   * 本轮 loop 结束——**这里**才应用压缩。
   *
   * api.compact 在跑到一半时就可能被调用，但把上下文从正在跑的循环底下抽走是不行的
   * （下一跳请求正拿着它）。所以摘要先记在会话上（pending），到这里才把之前的消息
   * 全部标成失活：此后只有摘要 + 之后的新消息进上下文。
   * 这一轮自己的消息（那条隐藏指令、写摘要的工具调用、收尾那句话）也一起失活——
   * 「一条原消息都不留」是压缩的定义，否则摘要后面还跟着一段「我刚才把摘要写好了」的噪音。
   */
  const after = conversationById(getLatest(), target.conversationId)
  const applied = after ? applyCompaction(after) : null
  if (after && applied && applied.label) {
    persist(applied.conv)
    // 压缩把前面的消息整段换成了一条摘要——设计内的前缀重写，这一会话的账重新开始记
    // （见 agent/prefixGate）
    resetPrefixGate(target.conversationId)
    onNoticeRef.current?.(applied.label)
  } else if (after && !drained && autoCompactRef.current && !isCompactTurn) {
    /*
     * 没压成，看看该不该自动压：判据是**上一轮报回来的上下文占用**（服务端真的收了多少 token），
     * 不是估算。压缩轮自己不会再触发（它一定产生了 applied.label），所以不会自激。
     */
    const cfg = loadAgentSettings().compact
    const ratio = window ? tally.context / window : 0
    if (cfg.auto && shouldCompact(activeMessages(after.messages).length, ratio, cfg.threshold)) {
      autoCompactRef.current(ratio)
    }
  }
}
