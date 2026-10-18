/**
 * 本文件负责：会话（按目标归属）的增删查，以及会话标题与消息正文的编辑。
 */
import type { Conversation } from '../../agent/types'
import type { LearnStore } from '../types'

export function conversationById(store: LearnStore, conversationId: string): Conversation | undefined {
  return store.conversations.find((c) => c.id === conversationId)
}

/* ---------- 节点树与对话（会话按目标归属） ---------- */

/** 某目标的全部会话，按创建时间升序 */
export function conversationsOfGoal(store: LearnStore, goalId: string): Conversation[] {
  return store.conversations.filter((c) => c.goalId === goalId).sort((a, b) => a.createdAt - b.createdAt)
}

/** 该目标最近使用的会话（没有则返回 undefined） */
export function latestConversation(store: LearnStore, goalId: string): Conversation | undefined {
  const list = conversationsOfGoal(store, goalId)
  return list.length ? list[list.length - 1] : undefined
}

/**
 * 解析某目标当前在界面上显示/激活的会话上下文。
 * 优先级：
 * 1. 若当前激活的 Agent 页签为该目标页签，且记有有效会话，优先采用；
 * 2. 若当前激活的 Agent 页签为子代理页签，其父会话属于该目标，采用该会话；
 * 3. 若全局 activeConversationId 属于该目标，采用该会话；
 * 4. 若 agentTabs 中存在该目标的页签且记有有效会话，采用之；
 * 5. 兜底回退到该目标最近的一段会话（latestConversation）。
 */
export function resolveDisplayedConversation(store: LearnStore, goalId: string): string | null {
  const activeTabKey = store.agentActiveTab
  if (activeTabKey && activeTabKey.startsWith('ga:')) {
    const activeTabGoalId = activeTabKey.slice(3)
    if (activeTabGoalId === goalId) {
      const activeTab = store.agentTabs?.find((t) => t.kind === 'goal' && t.goalId === goalId)
      if (activeTab?.conversationId) {
        const conv = conversationById(store, activeTab.conversationId)
        if (conv && conv.goalId === goalId) return conv.id
      }
    }
  }

  if (activeTabKey && activeTabKey.startsWith('sa:')) {
    const activeTab = store.agentTabs?.find((t) => t.kind === 'sub' && 'sa:' + t.sessionId === activeTabKey)
    if (activeTab?.conversationId) {
      const conv = conversationById(store, activeTab.conversationId)
      if (conv && conv.goalId === goalId) return conv.id
    }
  }

  if (store.activeConversationId) {
    const conv = conversationById(store, store.activeConversationId)
    if (conv && conv.goalId === goalId) return conv.id
  }

  const tab = store.agentTabs?.find((t) => t.kind === 'goal' && t.goalId === goalId)
  if (tab?.conversationId) {
    const conv = conversationById(store, tab.conversationId)
    if (conv && conv.goalId === goalId) return conv.id
  }

  return latestConversation(store, goalId)?.id ?? null
}

/**
 * 保证目标至少有一个会话：优先返回当前显示的会话，次之最近的那个，没有就新建。
 * 切换节点、切回某个目标时用它决定右侧展示哪个对话。
 */
export function ensureConversation(
  store: LearnStore,
  goalId: string,
): { store: LearnStore; conversationId: string } {
  const displayed = resolveDisplayedConversation(store, goalId)
  if (displayed) return { store, conversationId: displayed }
  const existing = latestConversation(store, goalId)
  if (existing) return { store, conversationId: existing.id }
  const conv = makeConversation(goalId)
  return { store: { ...store, conversations: [...store.conversations, conv] }, conversationId: conv.id }
}

/** 新建一个会话并加上时间戳，方便在列表中排在前面 */
export function addConversation(store: LearnStore, goalId: string): { store: LearnStore; conversation: Conversation } {
  const conv = makeConversation(goalId)
  return { store: { ...store, conversations: [...store.conversations, conv] }, conversation: conv }
}

/** 删除会话；同一目标至少保留一个（剩下的那个改为清空消息） */
export function deleteConversation(store: LearnStore, conversationId: string): LearnStore {
  const conv = store.conversations.find((c) => c.id === conversationId)
  if (!conv) return store
  const sameGoal = store.conversations.filter((c) => c.goalId === conv.goalId)
  if (sameGoal.length <= 1) {
    return {
      ...store,
      conversations: store.conversations.map((c) =>
        c.id === conversationId
          ? // 清空消息时连带清掉在途标记：历史已经没了，中断恢复不该再找那条回复
            { ...c, messages: [], inflight: undefined, updatedAt: Date.now() }
          : c,
      ),
    }
  }
  const remaining = store.conversations.filter((c) => c.id !== conversationId)
  const fallback = latestConversation({ ...store, conversations: remaining }, conv.goalId)
  return {
    ...store,
    conversations: remaining,
    activeConversationId:
      store.activeConversationId === conversationId ? (fallback?.id ?? null) : store.activeConversationId,
  }
}

/** 会话标题：取第一条用户消息的首段，没有则显示占位 */
export function conversationTitle(conv: Conversation): string {
  for (const m of conv.messages) {
    if (m.role !== 'user') continue
    const text = m.parts.filter((p) => p.type === 'text').map((p) => p.text).join(' ').trim()
    if (text) return text.length > 40 ? `${text.slice(0, 40)}…` : text
  }
  return '新对话'
}

/** 改写某条消息的正文：用户消息整体替换；助手消息保留思考/工具片段，正文合并进第一个 text */
export function updateMessageText(
  store: LearnStore,
  conversationId: string,
  messageId: string,
  text: string,
): LearnStore {
  return {
    ...store,
    conversations: store.conversations.map((c) => {
      if (c.id !== conversationId) return c
      const messages = c.messages.map((m) => {
        if (m.id !== messageId) return m
        if (m.role === 'user') {
          return { ...m, parts: [{ type: 'text' as const, text }], ts: Date.now() }
        }
        const textParts = m.parts.filter((p) => p.type === 'text')
        const rest = m.parts.filter((p) => p.type !== 'text')
        if (!textParts.length) return { ...m, parts: [...rest, { type: 'text' as const, text }] }
        const firstTextIdx = m.parts.findIndex((p) => p.type === 'text')
        const rebuilt = m.parts.map((p, i) =>
          i === firstTextIdx ? { type: 'text' as const, text } : p,
        )
        return { ...m, parts: rebuilt.filter((p, i) => p.type !== 'text' || i === firstTextIdx) }
      })
      return { ...c, messages, updatedAt: Date.now() }
    }),
  }
}

export function deleteMessage(store: LearnStore, conversationId: string, messageId: string): LearnStore {
  return {
    ...store,
    conversations: store.conversations.map((c) =>
      c.id === conversationId
        ? { ...c, messages: c.messages.filter((m) => m.id !== messageId), updatedAt: Date.now() }
        : c,
    ),
  }
}

function makeConversation(goalId: string): Conversation {
  const now = Date.now()
  return { id: crypto.randomUUID(), goalId, messages: [], createdAt: now, updatedAt: now }
}
