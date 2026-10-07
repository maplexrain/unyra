/**
 * 自由聊天（agent 栏最左侧那枚固定页签）的会话存储。
 *
 * 自由聊天**没有目标**：没有系统提示词、没有工具、没有人格——就是一段纯对话。
 * 会话因此不能住进 store.conversations（那里的每一段都挂着 goalId、写在
 * {目标}/chat.json，写盘路径按目标目录解析），这里单开一份：
 * `users/{uid}/free-chat.json`，整份读写 + 尾随防抖（与 ai/usageLog 同一套范式）。
 *
 * Conversation 形状原样复用（agent/types）：消息列表、流式、标题、起名这些
 * 界面与逻辑都不必改。goalId 存的是 FREE_GOAL_ID 哨兵——它永远不会与真实目标
 * 撞上，凡是按 goalId 找目标目录的路径（static 资源、chat.json）在这里都不会被走到。
 */

import { readJson, userRel, writeJson } from '../lib/storage'
import { settingsUid } from '../lib/userSettings'
import type { Conversation, ConversationMessage } from '../agent/types'

/** 自由聊天会话的 goalId 哨兵：segment 非法字符都避开的下划线形式 */
export const FREE_GOAL_ID = '__free__'

const FILE = 'free-chat.json'

interface FreeChatFile {
  version: 1
  conversations: Conversation[]
}

let conversations: Conversation[] = []
let pending: { uid: string; file: FreeChatFile } | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

/** 订阅：React 侧 useSyncExternalStore 用（引用只在真变时换） */
export function subscribeFreeChat(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 当前的全部自由聊天会话（新→旧由写入方保证） */
export function getFreeConversations(): Conversation[] {
  return conversations
}

export function freeConversationById(id: string | null | undefined): Conversation | undefined {
  return id ? conversations.find((c) => c.id === id) : undefined
}

function emit(): void {
  for (const fn of listeners) fn()
}

async function saveNow(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!pending) return
  const { uid, file } = pending
  pending = null
  const ok = await writeJson(userRel(uid, FILE), file)
  if (!ok) console.warn('[freeChat] 写盘失败：', FILE)
}

/** 尾随防抖落盘：以欠账当时的 uid 为准（换用户先把旧账写到旧目录） */
function scheduleSave(): void {
  const uid = settingsUid()
  if (!uid) return
  pending = { uid, file: { version: 1, conversations } }
  if (saveTimer) return
  saveTimer = setTimeout(() => void saveNow(), 1200)
}

function commit(next: Conversation[]): void {
  conversations = next
  scheduleSave()
  emit()
}

/** 新建一段自由聊天（最前）；还没有任何会话时由 ensureFreeConversation 兜底 */
export function addFreeConversation(now = Date.now()): Conversation {
  const conv: Conversation = {
    id: 'f' + now.toString(36) + Math.random().toString(36).slice(2, 6),
    goalId: FREE_GOAL_ID,
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
  commit([conv, ...conversations])
  return conv
}

/** 确保至少有一段（页签激活而一段都没有时现场建） */
export function ensureFreeConversation(): Conversation {
  return conversations[0] ?? addFreeConversation()
}

/** 删一段（按 id）；没有就当删过了（幂等） */
export function deleteFreeConversation(id: string): void {
  commit(conversations.filter((c) => c.id !== id))
}

/** 就地改一段（消息追加 / 收口 / 起名都走它）；id 对不上时原样返回 */
export function mutateFreeConversation(id: string, fn: (conv: Conversation) => Conversation): void {
  const cur = freeConversationById(id)
  if (!cur) return
  const next = fn(cur)
  if (next === cur) return
  commit(conversations.map((c) => (c.id === id ? next : c)))
}

/** 追加一条消息（用户消息与收口的助手消息共用） */
export function appendFreeMessage(id: string, msg: ConversationMessage): void {
  mutateFreeConversation(id, (conv) => ({
    ...conv,
    messages: [...conv.messages, msg],
    updatedAt: Date.now(),
  }))
}

/** 换用户：先把旧用户的待写尾巴落掉，再读新用户的那份（没有就给空表） */
export async function hydrateFreeChat(uid: string | null): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await saveNow()
  conversations = []
  if (!uid) {
    emit()
    return
  }
  const raw = await readJson<FreeChatFile>(userRel(uid, FILE))
  const list = raw?.version === 1 && Array.isArray(raw.conversations) ? raw.conversations : []
  conversations = list.filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages))
  emit()
}
