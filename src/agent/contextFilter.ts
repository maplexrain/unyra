/**
 * 上下文过滤器：在「系统已拼装完成上下文、正准备发送到 API」这一刻记录快照，
 * 并提供两份快照之间的逐条比对。
 *
 * 它存在的理由：服务端的前缀缓存按**逐字节前缀匹配**，命中率极低时几乎总是「某一段
 * 上下文在两轮之间悄悄变了」——而消息有几十条、每条几千字，肉眼根本找不到变化点。
 * 这里的比对把差异定位到**第几条消息、第几个字符**，调试器窗口（见 components/agent/
 * ContextDebugger）据此展示「差异出现在了哪个部位」。
 *
 * 为什么是钩子而不是旁路重放：只有 runtime 真正发请求的那一刻拿到的才是**实发**
 * 的上下文（历史还原、压缩、图片挂载都发生在那之前）；在别处重放都会与实际有偏差。
 * 记录本身很轻（每条消息一个滚动哈希），只在开发者模式开着时才由调用方触发。
 */
import type { ChatMessage } from '../ai/types'

/** runtime 在发送前交来的上下文快照（system + messages + 工具声明） */
export interface ContextSnapshot {
  system: string
  messages: ChatMessage[]
  /** 工具声明（影响前缀缓存，参与哈希比对；不存原文） */
  tools?: unknown[]
}

/** 一条消息的比对摘要：角色、字数与内容哈希 */
export interface MessageFingerprint {
  role: string
  chars: number
  hash: number
}

/** 一条请求记录：指纹总是全量，原文只保留最近两份（逐字符比对要用） */
export interface ContextRecord {
  seq: number
  at: number
  systemChars: number
  systemHash: number
  toolsHash: number
  /** 逐条指纹（角色的哈希链）：比对「变没变」全靠它 */
  messages: MessageFingerprint[]
  /**
   * 序列化后的原文（messageText 的产物，含 tool_calls 结构）。
   * 只有最近的几份保留全文（见 MAX_FULL_RECORDS）：逐字符定位差异要用；
   * 老的裁成空串——指纹还在，只是给不出「第几个字符」。
   */
  texts: Array<{ role: string; text: string }>
  /** 系统提示词原文；同上，老记录裁成空串 */
  system: string
}

export type MessageDiffStatus = 'same' | 'changed' | 'added' | 'removed'

export interface MessageDiff {
  index: number
  role: string
  status: MessageDiffStatus
  oldChars: number
  newChars: number
  /** 仅 changed 时有：第一处差异的字符位置与两侧摘录 */
  firstDiff?: { at: number; old: string; new: string }
}

export interface ContextDiff {
  same: boolean
  systemChanged: boolean
  toolsChanged: boolean
  systemDiff?: { at: number; old: string; new: string }
  messages: MessageDiff[]
  /** 第一处变化落在第几条消息上；没有变化时省略 */
  firstChangeIndex?: number
}

/** 最多保留多少条记录：够回看最近几跳即可 */
const MAX_RECORDS = 6
/** 原文（供逐字符比对）只保留最近几份；更老的只留指纹 */
const MAX_FULL_RECORDS = 2

let seq = 0
let records: ContextRecord[] = []
const listeners = new Set<() => void>()

/** djb2：又快又稳的滚动哈希，只为「这段变没变」，不承担任何安全职责 */
function hashOf(text: string): number {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return h
}

/** 消息的指纹与原文都把 tool_calls / tool_call_id 算进去：结构变了也算变 */
const messageText = (m: ChatMessage): string =>
  JSON.stringify({ role: m.role, content: m.content, tool_calls: m.tool_calls ?? null, id: m.tool_call_id ?? null })

/** 记录一次发送前的上下文；由调用方（learn/useAgent）按开发者模式开关触发 */
export function recordContext(snapshot: ContextSnapshot): void {
  seq++
  const record: ContextRecord = {
    seq,
    at: Date.now(),
    systemChars: snapshot.system.length,
    systemHash: hashOf(snapshot.system),
    toolsHash: hashOf(JSON.stringify(snapshot.tools ?? [])),
    messages: snapshot.messages.map((m) => ({
      role: m.role,
      chars: messageText(m).length,
      hash: hashOf(messageText(m)),
    })),
    texts: snapshot.messages.map((m) => ({ role: m.role, text: messageText(m) })),
    system: snapshot.system,
  }
  records.push(record)
  if (records.length > MAX_RECORDS) records = records.slice(records.length - MAX_RECORDS)
  // 原文只留最近两份：更老的把正文裁掉，指纹留着（还能做「变没变」级别的比对）
  if (records.length > MAX_FULL_RECORDS) {
    records = records.map((r, i) =>
      i < records.length - MAX_FULL_RECORDS
        ? { ...r, system: '', texts: r.texts.map((m) => ({ ...m, text: '' })) }
        : r,
    )
  }
  for (const fn of [...listeners]) fn()
}

export const getRecords = (): ContextRecord[] => records

export function clearRecords(): void {
  records = []
  for (const fn of [...listeners]) fn()
}

export function subscribeRecords(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 两段文本的第一处差异：位置 + 两侧摘录（各 ±40 字）；完全相同返回 null */
function firstCharDiff(oldText: string, newText: string): { at: number; old: string; new: string } | null {
  const n = Math.min(oldText.length, newText.length)
  let i = 0
  while (i < n && oldText[i] === newText[i]) i++
  if (i === n && oldText.length === newText.length) return null
  const excerpt = (t: string): string => t.slice(Math.max(0, i - 40), i + 60)
  return { at: i, old: excerpt(oldText), new: excerpt(newText) }
}

/** 两份记录逐条比对：差异出现在哪条消息、那条消息里的哪个字符 */
export function compareRecords(a: ContextRecord, b: ContextRecord): ContextDiff {
  const systemChanged = a.systemHash !== b.systemHash
  const toolsChanged = a.toolsHash !== b.toolsHash
  const systemDiff = systemChanged && a.system && b.system ? (firstCharDiff(a.system, b.system) ?? undefined) : undefined

  const count = Math.max(a.messages.length, b.messages.length)
  const messages: MessageDiff[] = []
  let firstChanged: MessageDiff | null = null
  for (let i = 0; i < count; i++) {
    const oldMsg = a.messages[i]
    const newMsg = b.messages[i]
    if (!oldMsg) {
      messages.push({ index: i, role: newMsg?.role ?? '?', status: 'added', oldChars: 0, newChars: newMsg.chars })
      if (!firstChanged) firstChanged = messages[messages.length - 1]
      continue
    }
    if (!newMsg) {
      messages.push({ index: i, role: oldMsg.role, status: 'removed', oldChars: oldMsg.chars, newChars: 0 })
      if (!firstChanged) firstChanged = messages[messages.length - 1]
      continue
    }
    if (oldMsg.hash === newMsg.hash) {
      messages.push({ index: i, role: oldMsg.role, status: 'same', oldChars: oldMsg.chars, newChars: newMsg.chars })
      continue
    }
    const diff: MessageDiff = {
      index: i,
      role: newMsg.role,
      status: 'changed',
      oldChars: oldMsg.chars,
      newChars: newMsg.chars,
    }
    // 两份原文都在（都是最近的记录）时给出字符级定位；否则只报「这条变了」
    const oldText = a.texts[i]?.text ?? ''
    const newText = b.texts[i]?.text ?? ''
    if (oldText && newText) diff.firstDiff = firstCharDiff(oldText, newText) ?? undefined
    messages.push(diff)
    if (!firstChanged) firstChanged = diff
  }
  return {
    same: !systemChanged && !toolsChanged && messages.every((m) => m.status === 'same'),
    systemChanged,
    toolsChanged,
    ...(systemDiff ? { systemDiff } : {}),
    messages,
    ...(firstChanged ? { firstChangeIndex: firstChanged.index } : {}),
  }
}
