/**
 * useAgent 的**等待队列机制**（从 useAgent.ts 原样搬出）：导师正在跑时用户发出去的消息
 * 按会话排在这儿（键 = conversationId，队列本体见 learn/agentQueue），当前这一轮一收口
 * 就由 drainQueueRef 往下发一条。排队 / 撤回 / 立即发送三条路都在这里，它们只认 convId，
 * 不认「眼前是哪一枚页签」——keepalive 之后后台页签的队列也该是它自己那一段对话的。
 *
 * 收口点 drainQueueRef 仍由 hook 本体早在 runTurn 之前声明（runTurn / sendFree 的
 * finally 要调它），这里只在 effect 里给它装上派发逻辑。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MessageQuote, PendingFile, PendingImage } from '../../agent/types'
import type { AgentRunTarget } from '../agent/sandboxOps'
import { hasApiKey, loadAiSettings } from '../../ai/settings'
import { releasePending } from '../images'
import {
  dropQueued as dropQueuedItem,
  enqueueQueued,
  queueOf,
  takeQueued,
  type QueuedMessage,
  type Queues,
} from '../agentQueue'

/**
 * 等待队列的 state、ref 与全部派发动作。runTurn / sendFree / stop 由 hook 本体传入
 * （声明顺序在那边已经排好）；其余的判据与纪律见各条目的注释。
 */
export function useAgentQueue(deps: {
  /** 同一会话的轮次链（见 hook 的 runTurn）：drain 的「还有没有轮次」判据与「立即发送」的停轮都看它 */
  turnChainRef: { current: Map<string, Promise<void>> }
  onNeedKeyRef: { current: () => void }
  /** 收口点（见 hook 的说明）：一轮收口时把队首发出去的那个 ref */
  drainQueueRef: { current: (convId: string) => void }
  runTurn: (
    target: AgentRunTarget,
    text: string,
    hidden?: boolean,
    context?: string,
    quote?: MessageQuote,
    pending?: PendingImage[],
    files?: PendingFile[],
    mark?: string,
  ) => Promise<void>
  sendFree: (conversationId: string, text: string, opts?: { files?: PendingFile[]; images?: PendingImage[] }) => void
  stop: (convId?: string) => void
}) {
  const { turnChainRef, onNeedKeyRef, drainQueueRef, runTurn, sendFree, stop } = deps
  /**
   * 等待队列（键 = conversationId，见 learn/agentQueue）：导师正在跑时用户发出去的消息
   * 排在这里，当前这一轮一收口就往下发一条。
   *
   * 为什么队列住在这里、而不是住在输入区那枚面板里：它是**对话的属性**，不是面板的。
   * 页签关掉再打开、切到别的节点又切回来，面板会重挂，而排队等着的那几条不该跟着消失
   * （用户已经把它们发出去了）。另外「什么时候往下发」也只能在这里看准：一轮的收口点
   * 就在这个文件里（runTurn / sendFree 的 finally），宿主那侧看得见的是「running 变没变」，
   * 而它比真实收口晚一拍、也没看见工作流排队这类内部接力。
   *
   * 状态与 ref 各一份：渲染读 state，派发路径（收口回调、立即发送）读 ref——
   * setState 是异步的，收口那一刻读到的会是旧队列。两份永远同进同出（见 writeQueue）。
   */
  const [queues, setQueues] = useState<Queues>({})
  const queuesRef = useRef<Queues>({})
  /**
   * 队列往前走一步（把队首发出去）。挂在 ref 上是因为它要被**收口点**调用，而那两个
   * 收口点（runTurn / sendFree 的 finally）定义在它前面、又在依赖上追不到它——
   * 每次渲染刷新一份（与 autoCompactRef 同一个套路）。
   */
  const writeQueue = useCallback((convId: string, update: (cur: QueuedMessage[]) => QueuedMessage[]) => {
    const next = update(queuesRef.current[convId] ?? [])
    const map = { ...queuesRef.current }
    if (next.length) map[convId] = next
    else delete map[convId]
    queuesRef.current = map
    setQueues(map)
  }, [])

  /**
   * 把一条排队消息真正发出去：导师轮走 runTurn（带着排进队列时记下的目标——那一刻他在
   * 哪个目标/节点下，就发到哪个目标/节点），自由聊天走 sendFree。
   *
   * 附件在此刻**交棒**：这一轮转存读的是 File 原件，预览地址随即可放（与「直接发送」
   * 那条路的时机一致）；不放就是每发一条图漏一份内存。
   */
  const dispatchQueued = useCallback(
    (m: QueuedMessage) => {
      releasePending(m.images)
      if (m.free) {
        sendFree(m.conversationId, m.text, { images: m.images, files: m.files })
        return
      }
      if (!m.target) return
      void runTurn(m.target, m.text, false, undefined, undefined, m.images, m.files)
    },
    [runTurn, sendFree],
  )

  /**
   * 队列往前走一步：把队首发出去。
   *
   * 这是**唯一的派发入口**，三处会来敲它：一轮收口时（runTurn / sendFree 的 finally）、
   * 用户刚排进一条时（若这一轮其实已经收口了，不必干等下一次收口）、以及「立即发送」。
   * 判据只有一条「链上还有没有轮次」——有就什么都不做，那一轮会走到自己的 finally。
   */
  useEffect(() => {
    drainQueueRef.current = (convId: string) => {
      // 还有轮次在跑（或在链上排着）：它收口时会再敲一次，这里不抢
      if (turnChainRef.current.has(convId)) return
      const head = queueOf(queuesRef.current, convId)[0]
      if (!head) return
      /*
       * 没配 Key 就先不动它：发出去也只会换来一次「请先填 Key」，而这条消息会从队列里
       * 消失——用户写的字不该被这样吞掉。留在队里，等他配好 Key 之后下一次收口再走。
       */
      if (!hasApiKey(loadAiSettings())) {
        onNeedKeyRef.current()
        return
      }
      writeQueue(convId, (cur) => dropQueuedItem(cur, head.id))
      dispatchQueued(head)
    }
  })

  /**
   * 把一条消息排进队尾（宿主在「导师正在跑、或队列里还排着人」时调它，见 learn/agentQueue
   * 的 shouldEnqueue）。排完立刻试走一步：用户刚点完停止又发了一条，那会儿链上已经空了，
   * 没有这一步就要干等到下一轮收口——而下一轮可能永远不会来。
   */
  const enqueueMessage = useCallback(
    (item: Omit<QueuedMessage, 'id' | 'at'>) => {
      const m: QueuedMessage = { ...item, id: crypto.randomUUID(), at: Date.now() }
      writeQueue(m.conversationId, (cur) => enqueueQueued(cur, m))
      drainQueueRef.current(m.conversationId)
    },
    // drainQueueRef 是跨渲染稳定的 ref（hook 本体里的 useRef）：列进依赖不改变记忆化行为
    [writeQueue, drainQueueRef],
  )

  /** 撤回一条：它还没跑起来，摘掉就是摘掉——附件也一并放掉（那张图再也用不到了） */
  const dropQueuedMessage = useCallback(
    (convId: string, id: string) => {
      const item = queueOf(queuesRef.current, convId).find((m) => m.id === id)
      if (!item) return
      releasePending(item.images)
      writeQueue(convId, (cur) => dropQueuedItem(cur, id))
    },
    [writeQueue],
  )

  /**
   * 立即发送一条：不等了，就它先来。
   *
   * 当前这一轮若还在跑，**先把它停掉**——用户点的就是「现在」，而一轮 Agent 是一次
   * 完整的模型循环，半路挤一条进去会让这一轮实发的上下文自相矛盾（见 agent/prefixGate）。
   * 停掉之后那条消息接在链上：它并不与刚中止的那一轮并行，而是等它真的收口（几毫秒的事，
   * 中止是立刻生效的），所以上下文仍然干净。其余排队的原样留在队里，这条之后继续走。
   */
  const sendQueuedNow = useCallback(
    (convId: string, id: string) => {
      const { item, rest } = takeQueued(queueOf(queuesRef.current, convId), id)
      if (!item) return
      writeQueue(convId, () => rest)
      if (turnChainRef.current.has(convId)) stop(convId)
      dispatchQueued(item)
    },
    // turnChainRef 是跨渲染稳定的 ref：列进依赖不改变记忆化行为
    [writeQueue, stop, dispatchQueued, turnChainRef],
  )

  return { queues, enqueueMessage, dropQueuedMessage, sendQueuedNow }
}
