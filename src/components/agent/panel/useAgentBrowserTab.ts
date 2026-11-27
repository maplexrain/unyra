/**
 * 智能体页的「网页」页签。
 *
 * 浏览器会话按 owner 归属；这个 hook 只把**当前这段对话**自己的会话交给面板：
 * 换一段对话不会误看、误操作别的会话。页签本身是局部的：新会话出现只让入口出现，
 * 不自动把用户从对话/思维页切走。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useAgentBrowserSnapshot,
  type AgentBrowserSessionInfo,
} from '../../../learn/web/agentBrowser'

export interface AgentBrowserTabScope {
  id?: string | null
  goalId?: string | null
}

/** 纯函数，测试可直接验证归属过滤（不依赖 React 订阅）。 */
export function browserSessionsOf(
  sessions: readonly AgentBrowserSessionInfo[],
  conversation: AgentBrowserTabScope | null,
): AgentBrowserSessionInfo[] {
  const conversationId = conversation?.id ?? null
  const goalId = conversation?.goalId ?? null
  if (!conversationId) return []
  return sessions.filter(
    (s) => s.owner.conversationId === conversationId && (s.owner.goalId ?? null) === goalId,
  )
}

export function useAgentBrowserTab(conversation: AgentBrowserTabScope | null) {
  const snapshot = useAgentBrowserSnapshot()
  const conversationId = conversation?.id ?? null
  const goalId = conversation?.goalId ?? null
  const sessions = useMemo(
    () => browserSessionsOf(snapshot.sessions, { id: conversationId, goalId }),
    [snapshot.sessions, conversationId, goalId],
  )
  const [open, setOpen] = useState(false)
  const previousConversationId = useRef(conversationId)

  useEffect(() => {
    if (previousConversationId.current === conversationId) return
    previousConversationId.current = conversationId
    setOpen(false)
  }, [conversationId])

  // 会话全关掉 / 切到没有会话的对话：页面自动退回，不能留一块空视口。
  useEffect(() => {
    if (open && sessions.length === 0) setOpen(false)
  }, [open, sessions.length])

  return { sessions, open, setOpen }
}
