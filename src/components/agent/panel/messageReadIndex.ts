/**
 * 消息浏览记录：按「通道」记住用户最后读到哪一条（channel → message id / ts）。
 *
 * 用途只有一个：列表脱离底部（用户往上翻）时，右下角那颗「回到最新」要能回答
 * 「底下还有几条没看过」。它不是会话未读数（那套是顶栏通知的红点，见 lib/notice），
 * 而是列表自己的浏览进度——同一条通道重新打开时，用户已经读过的位置不该再被算成新消息。
 *
 * 存在 localStorage：这是纯界面的小状态，不进 state.json（换设备不同步、也不该污染学习数据）。
 * 通道名由调用方拼：群聊 `group:{goalId}`、评论串 `group:{goalId}:thread:{rootId}`、
 * 私聊 `role:{conversationId}`。
 */
import { useEffect } from 'react'

export interface ChatMessageLike {
  id: string
  ts: number
}

export interface ChatReadMark {
  /** 最后读到的那条消息 id（正常历史里找得到它，就能精确数出后面还有几条） */
  id: string
  /** 那条消息的时间：历史被裁掉、id 找不到时的兜底判据 */
  ts: number
  /** 记下时这条通道共有多少条：只用于「历史被压缩 / 换了一份」时辨认，不参与计数 */
  total: number
}

const STORE_KEY = 'moji.chat-read-index.v1'
/** 通道上限：群聊 + 评论串 + 私聊，正常用不到这么多；只防 localStorage 无限长 */
const MAX_CHANNELS = 64

let cache: Record<string, ChatReadMark> | null = null

function readAll(): Record<string, ChatReadMark> {
  if (cache) return cache
  const empty: Record<string, ChatReadMark> = {}
  try {
    if (typeof localStorage === 'undefined') return (cache = empty)
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return (cache = empty)
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return (cache = empty)
    const out: Record<string, ChatReadMark> = {}
    for (const [channel, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const rec = value as Record<string, unknown>
      if (typeof rec.id !== 'string' || !rec.id) continue
      out[channel] = {
        id: rec.id,
        ts: typeof rec.ts === 'number' && Number.isFinite(rec.ts) ? rec.ts : 0,
        total: typeof rec.total === 'number' && Number.isFinite(rec.total) ? rec.total : 0,
      }
    }
    cache = out
    return out
  } catch {
    return (cache = empty)
  }
}

function persist(all: Record<string, ChatReadMark>): void {
  cache = all
  try {
    if (typeof localStorage === 'undefined') return
    // 超上限先按 ts 淘汰最旧的通道（评论串会不断产生新 key）
    const entries = Object.entries(all)
    if (entries.length > MAX_CHANNELS) {
      entries.sort((a, b) => a[1].ts - b[1].ts)
      const kept = Object.fromEntries(entries.slice(entries.length - MAX_CHANNELS))
      cache = kept
      localStorage.setItem(STORE_KEY, JSON.stringify(kept))
      return
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(all))
  } catch {
    // 隐私模式 / 配额满：读进度丢了不影响聊天，只是新消息数会退回 0
  }
}

/** 某条通道最后读到的那条；没记录返回 null */
export function chatReadMark(channel: string): ChatReadMark | null {
  if (!channel) return null
  return readAll()[channel] ?? null
}

/**
 * 把某条通道的浏览位置推进到 `last`。返回是否真的写了（id 没变就不重复落盘）。
 * 调用方只在「贴着底部」时调——人正往上翻的时候，底下那些消息本来就没看过。
 */
export function markChatRead(channel: string, last: ChatMessageLike | undefined, total: number): boolean {
  if (!channel || !last?.id) return false
  const all = readAll()
  const prev = all[channel]
  if (prev && prev.id === last.id) return false
  persist({ ...all, [channel]: { id: last.id, ts: last.ts || 0, total } })
  return true
}

/**
 * `mark` 之后还有几条。优先按 id 定位（历史完整时最准）；
 * id 已被裁掉 / 通道换了一份历史时，退回「比 mark.ts 新的都算」。
 * 没有浏览记录时算 0：第一次打开通道不算欠着一屏未读。
 */
export function unreadAfter(messages: readonly ChatMessageLike[], mark: ChatReadMark | null): number {
  if (!mark || !messages.length) return 0
  const i = messages.findIndex((m) => m.id === mark.id)
  if (i >= 0) return messages.length - i - 1
  let n = 0
  for (const m of messages) if ((m.ts || 0) > mark.ts) n++
  return n
}

/** 测试用：清掉模块缓存（localStorage 由测试自己清） */
export function resetChatReadIndexCache(): void {
  cache = null
}

/**
 * 列表侧接线：返回「底下还有几条没看过」。
 *
 * @param channel 通道名（见文件头）
 * @param messages 当前通道按时间顺序的全部消息（不是只挂载的那一窗）
 * @param pinned 是否贴着底部（useScrollFollow 的 pinned）
 */
export function useChatReadIndex(
  channel: string,
  messages: readonly ChatMessageLike[],
  pinned: boolean,
): number {
  const last = messages[messages.length - 1]
  const lastId = last?.id ?? ''
  const lastTs = last?.ts ?? 0

  useEffect(() => {
    if (!pinned || !lastId) return
    markChatRead(channel, { id: lastId, ts: lastTs }, messages.length)
  }, [channel, pinned, lastId, lastTs, messages.length])

  // 贴着底部时没有「底下」可言；不贴底才按浏览记录数。直接读模块缓存（localStorage
  // 的解析只在首次发生），不在 effect 里 setState——贴底时按钮根本不渲染，无须触发重绘。
  if (pinned) return 0
  return unreadAfter(messages, chatReadMark(channel))
}
