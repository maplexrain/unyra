/**
 * 群聊的会话账本。
 *
 * 群聊不是某个 role 的私聊：它是**一条独立的群通道会话**，用户与多位 role 都在里面说话。
 * 群聊消息住在 `users/{uid}/group-chat.json`，与各 role 的 role 会话（mind）分开：
 * - 群聊层（界面）读这份 `messages`；
 * - 被 @ 的 role 会同时收到一条 `channel:'group'` 的入站流水，进它自己的**同一段 mind**；
 * - 群里发起的任务，后续跨 role 委派也必须走群通道并 @ 目标（见 role 提示词）。
 *
 * 本地存储范式与 freeChat 一致：整份读写、尾随防抖、useSyncExternalStore 订阅。
 */
import { readJson, userRel, writeJson } from '../lib/storage'
import { settingsUid } from '../lib/userSettings'
import type { ChannelMessage } from '../agent/types'
import { normalizeChannels } from '../agent/roleWork/registry'

const FILE = 'group-chat.json'
const CAP = 200

interface GroupChatFile {
  version: 1
  messages: ChannelMessage[]
}

let messages: ChannelMessage[] = []
let pending: { uid: string; file: GroupChatFile } | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

export function subscribeGroupChat(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 全部群聊消息（按时间从旧到新；界面自行按 goal 过滤） */
export function getGroupChatMessages(): ChannelMessage[] {
  return messages
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
  if (!ok) console.warn('[groupChat] 写盘失败：', FILE)
}

function scheduleSave(): void {
  const uid = settingsUid()
  if (!uid) return
  pending = { uid, file: { version: 1, messages } }
  if (saveTimer) return
  saveTimer = setTimeout(() => void saveNow(), 1200)
}

function commit(next: ChannelMessage[]): void {
  messages = next.slice(-CAP)
  scheduleSave()
  emit()
}

/** 追加一条群聊流水（用户发言 / role 发言都走它） */
export function appendGroupMessage(message: ChannelMessage): void {
  commit([...messages, message])
}

/** 原位更新一条群聊流水（ask 状态、展开状态等）；找不到就静默忽略。 */
export function patchGroupMessage(id: string, patch: Partial<ChannelMessage>): void {
  let touched = false
  const next = messages.map((m) => {
    if (m.id !== id) return m
    touched = true
    return { ...m, ...patch }
  })
  if (touched) commit(next)
}

/** 换用户：先把旧用户的尾巴落掉，再读新用户的群聊 */
export async function hydrateGroupChat(uid: string | null): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await saveNow()
  messages = []
  if (!uid) {
    emit()
    return
  }
  const raw = await readJson<GroupChatFile>(userRel(uid, FILE))
  const list = raw?.version === 1 && Array.isArray(raw.messages) ? raw.messages : []
  messages = normalizeChannels(list) ?? []
  emit()
}
