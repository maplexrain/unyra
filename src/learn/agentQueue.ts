/**
 * 排队等执行的用户消息。
 *
 * 导师正在回答时用户照样可以发消息——那条消息不是「被拒了」，也不是「插进了正在跑的
 * 那一轮」，而是排在这里等：当前这一轮一收口，队列里的下一条自己就发出去。排队是
 * **已经发出去了**的消息在等它那一轮，不是草稿：所以 撤回 是「在它跑起来之前收回来」，
 * 立即发送 是「不等了，就它先来」。
 *
 * 为什么不让消息直接挤进正在跑的那一轮：一轮 Agent 是一次完整的模型循环，用户消息是
 * 它的输入之一，半路改输入会让这一轮实发的结构（system / messages / tools 的前缀）
 * 整段作废——前缀缓存与门禁都建在「一轮之内上下文不变」这条规矩上（见 agent/prefixGate）。
 * 排到下一轮再进上下文，两边的账都干净。
 *
 * 队列**只在内存里**：条目里带着没落盘的附件（File 原件），关掉应用就没有了——
 * 这与输入框草稿的待遇一致（草稿也不落盘）。真要落盘，落下的也只是半条消息。
 */

import type { PendingFile, PendingImage } from '../agent/types'
import type { AgentRunTarget } from './agent/sandboxOps'

export interface QueuedMessage {
  id: string
  /** 这一段对话（也是它在队列表里的键）：派发时按它找路（导师轮 / 自由聊天） */
  conversationId: string
  /** 发出去的那一刻作为 user 消息进上下文（与直接发送逐字相同） */
  text: string
  /** 还没转存的图片附件；附件生命周期随条目走（见 releaseQueued） */
  images: PendingImage[]
  files: PendingFile[]
  /**
   * 落到哪个目标上（导师轮）。自由聊天没有目标（它不在任何目标下），
   * 靠 free 认——两条路的派发方式不同（见 useAgent 的 dispatchQueued）。
   */
  target?: AgentRunTarget
  free?: boolean
  /** 排进来的时刻（列表按它排序就是按发出来的先后，同时也是排查用的时间戳） */
  at: number
}

/**
 * 一条用户消息的两种下落。
 *
 * 它是**附件所有权的交接凭据**：`sent` = 已经直接发出去了，输入区可以立刻放掉预览地址；
 * `queued` = 排进了等待队列，附件随条目一起被队列收着，等它真正跑起来才轮到放
 * （见 useComposer 的 submit 与 useAgent 的 enqueue/dropQueued）。
 */
export type SendOutcome = 'sent' | 'queued'

/** 队列集合：键 = conversationId。空队列不留键（与 store 里其它可选字段同一条规矩） */
export type Queues = Record<string, QueuedMessage[]>

/**
 * 空队列的**同一个**数组。
 *
 * 不能在图里写 `?? []`：每次渲染都是一个新数组，而下游是 memo 过的页签面板
 * （见 AgentTabPane 的 sameAgentTabPane），身份一变就等于把它的记忆整个打掉——
 * 没排队的会话会跟着每一次顶层重渲染一起重渲染。返回同一个空数组，比较就落得回「相等」。
 */
const NO_QUEUE: QueuedMessage[] = []

/** 某个会话的队列；没有就是空数组（调用方少一层判空） */
export function queueOf(queues: Queues | undefined, convId: string | null): QueuedMessage[] {
  if (!queues || !convId) return NO_QUEUE
  return queues[convId] ?? NO_QUEUE
}

/** 排进队尾。顺序就是用户按下发送的先后，不重排——他等着的是「按我说的顺序来」 */
export function enqueueQueued(list: QueuedMessage[], item: QueuedMessage): QueuedMessage[] {
  return [...list, item]
}

/** 撤回一条：它还没跑起来，摘掉就是摘掉 */
export function dropQueued(list: QueuedMessage[], id: string): QueuedMessage[] {
  const next = list.filter((m) => m.id !== id)
  return next.length === list.length ? list : next
}

/**
 * 取出指定的一条（立即发送走它）：返回摘掉之后剩下的队列 + 取到的那条。
 *
 * 与 dropQueued 分开是因为**「撤回」与「立刻发」对附件要做的后续不同**：
 * 撤回要放掉预览地址（那张图再也没人要了），立即发送则要把附件原样交给这一轮。
 */
export function takeQueued(list: QueuedMessage[], id: string): { item: QueuedMessage | null; rest: QueuedMessage[] } {
  const item = list.find((m) => m.id === id) ?? null
  if (!item) return { item: null, rest: list }
  return { item, rest: list.filter((m) => m.id !== id) }
}

/**
 * 该不该把这条消息排进队列（而不是直接发）。
 *
 * 三条判据任一成立就得排队，它们对应三种「现在发不得」：
 * - busy：这一轮还在跑（或已有轮次在链上等着跑）——直接发会挤到它前面；
 * - pending：队列里还排着别人——先来后到，新的一条该站在队尾；
 * - 两者都不成立时直接发：空闲且无人排队，排队只会让它白等一瞬。
 *
 * 抽成纯函数是为了把这条顺序规则钉在单测里：它是整个队列语义的核心，而
 * 「什么时候该排」在以后的重构里最容易被顺手改坏（比如只判 running）。
 */
export function shouldEnqueue(pending: number, busy: boolean): boolean {
  return busy || pending > 0
}
