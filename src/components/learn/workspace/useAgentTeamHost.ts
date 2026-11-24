/**
 * 智能体团队（Tab 页版 AgentPanel）宿主协调器。
 *
 * 职责：
 * 1. 管理智能体团队单例页签（kind: 'agentTeam'）的打开、聚焦与 Ctrl+Q 往返切换；
 * 2. 只在**用户主动打开**、Ctrl+Q 或新 ask 表单到来时切换页签；
 *    agent 被激活 / 工作流启动**绝不自动跟踪跳页**，用户停在原页面。
 */

import { useCallback, useEffect, useRef } from 'react'
import type { LearnStore, TabRef } from '../../../learn/types'
import { conversationById, resolveDisplayedConversation } from '../../../learn/graph'
import { freeConversationById } from '../../../learn/freeChat'
import { upsertAgentTab, withAgentTabs } from '../../../learn/agentTabs'
import { findTab, focusedTab } from '../../../learn/groups'
import type { useAgent } from '../../../learn/useAgent'
import { focusAgentInput } from '../../../lib/agentFocus'
import { installMcpServeHost } from '../../../agent/mcp/serveHost'

type AgentApi = ReturnType<typeof useAgent>

/** resolving the target goalId for a conversation or current active store */
function resolveTeamTabRef(store: LearnStore, convId?: string): TabRef {
  if (convId) {
    const conv = conversationById(store, convId)
    if (conv?.goalId) return { kind: 'agentTeam', goalId: conv.goalId }
  }
  return store.activeGoalId ? { kind: 'agentTeam', goalId: store.activeGoalId } : { kind: 'agentTeam' }
}

/** 任意分屏组中当前激活的页签是否为智能体团队页签（传 goalId 时校验所属目标） */
export function isAgentTeamVisible(store: LearnStore, goalId?: string | null): boolean {
  return store.docArea.groups.some(
    (g) =>
      Boolean(
        g.active &&
          g.tabs.some(
            (t) =>
              t.id === g.active &&
              t.ref.kind === 'agentTeam' &&
              (!goalId || t.ref.goalId === goalId || !t.ref.goalId),
          ),
      ),
  )
}

/**
 * 将 agentActiveTab 同步到指定会话：
 * - 若为目标会话：自动补全并激活对应 goal 页签；仅当属于当前激活目标时同步 activeConversationId，
 *   不强行切换 activeGoalId 以免打断文档区上下文；
 * - 若非目标会话（自由聊天等）：切到固定聊天页签 'free'。
 */
export function syncAgentTabForConversation(store: LearnStore, convId: string): LearnStore {
  const conv = conversationById(store, convId)
  if (!conv) {
    if (store.agentActiveTab === 'free') return store
    return withAgentTabs(store, store.agentTabs ?? [], 'free')
  }
  const { tabs, active } = upsertAgentTab(
    store.agentTabs ?? [],
    store.agentActiveTab ?? null,
    { kind: 'goal', goalId: conv.goalId, conversationId: conv.id },
    true,
  )
  const withTabs = withAgentTabs(store, tabs, active)
  if (conv.goalId === withTabs.activeGoalId && withTabs.activeConversationId !== conv.id) {
    return { ...withTabs, activeConversationId: conv.id }
  }
  return withTabs
}

export interface AgentTeamHostDeps {
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  openTab: (ref: TabRef) => void
  activateTab: (tabId: string) => void
  agent: AgentApi
  pure: boolean
  setPure: (on: boolean) => void
  onSyncFreeConvId?: (convId: string) => void
}

export function useAgentTeamHost({
  getLatest,
  set,
  openTab,
  activateTab,
  agent,
  pure,
  setPure,
  onSyncFreeConvId,
}: AgentTeamHostDeps) {
  const lastNonTeamTabRef = useRef<string | null>(null)
  const focusTimerRef = useRef<number | null>(null)
  const prevAskIdsRef = useRef<Set<string>>(new Set())

  // 持续记住最近一次在焦点格打开的非智能体团队页签，供 Ctrl+Q 切回
  useEffect(() => {
    const focused = focusedTab(getLatest().docArea)
    if (focused && focused.ref.kind !== 'agentTeam') {
      lastNonTeamTabRef.current = focused.id
    }
  })

  useEffect(
    () => () => {
      if (focusTimerRef.current !== null) {
        window.clearTimeout(focusTimerRef.current)
      }
    },
    [],
  )

  // 对外 MCP 服务（应用当 server）的 guest 会话：外部 harness 经命名管道调用工具，
  // 在这里拿到与真沙箱同源的基座执行（见 src/agent/mcp/serveHost；单例，重挂自动换新）
  useEffect(() => installMcpServeHost({ getLatest, set }), [getLatest, set])

  const scheduleFocusInput = useCallback(() => {
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current)
    focusTimerRef.current = window.setTimeout(() => {
      focusTimerRef.current = null
      focusAgentInput()
    }, 60)
  }, [])

  const openAgentTeam = useCallback(
    (opts?: { focusInput?: boolean; conversationId?: string }) => {
      const s = getLatest()
      const focused = focusedTab(s.docArea)
      if (focused && focused.ref.kind !== 'agentTeam') {
        lastNonTeamTabRef.current = focused.id
      }

      if (opts?.conversationId) {
        if (!conversationById(s, opts.conversationId) && freeConversationById(opts.conversationId)) {
          onSyncFreeConvId?.(opts.conversationId)
        }
        const synced = syncAgentTabForConversation(s, opts.conversationId)
        if (synced !== s) set(synced)
      } else if (
        s.activeGoalId &&
        s.agentActiveTab !== 'free' &&
        !(s.agentTabs ?? []).some((t) => t.kind === 'goal' && t.goalId === s.activeGoalId)
      ) {
        const convId = resolveDisplayedConversation(s, s.activeGoalId) ?? null
        const t0 = upsertAgentTab(
          s.agentTabs ?? [],
          s.agentActiveTab ?? null,
          { kind: 'goal', goalId: s.activeGoalId, conversationId: convId },
          true,
        )
        set(withAgentTabs(s, t0.tabs, t0.active))
      }

      openTab(resolveTeamTabRef(s, opts?.conversationId))
      if (opts?.focusInput) {
        scheduleFocusInput()
      }
    },
    [getLatest, set, openTab, scheduleFocusInput, onSyncFreeConvId],
  )

  const toggleAgentTeam = useCallback(() => {
    const s = getLatest()
    const focused = focusedTab(s.docArea)
    if (focused?.ref.kind === 'agentTeam') {
      const lastId = lastNonTeamTabRef.current
      if (lastId && lastId !== focused.id && findTab(s.docArea, lastId)) {
        activateTab(lastId)
        return
      }
      focusAgentInput()
      return
    }
    openAgentTeam({ focusInput: true })
  }, [getLatest, activateTab, openAgentTeam])

  const expandAgentTeam = useCallback(() => {
    openAgentTeam({ focusInput: true })
  }, [openAgentTeam])

  // 监听 api.ask 结构化表单：有新提问到来时退出纯净阅读、对齐会话并确保页签可见
  useEffect(() => {
    const currentEntries = Object.entries(agent.pendingAskByConv).filter(([, ask]) => Boolean(ask))
    const currentIds = new Set(currentEntries.map(([, ask]) => ask.id))
    const newlyAdded = currentEntries.filter(([, ask]) => !prevAskIdsRef.current.has(ask.id))
    prevAskIdsRef.current = currentIds

    if (newlyAdded.length === 0) return

    const [convId] = newlyAdded[newlyAdded.length - 1]
    if (pure) setPure(false)

    const s = getLatest()
    if (!conversationById(s, convId) && freeConversationById(convId)) {
      onSyncFreeConvId?.(convId)
    }
    const synced = syncAgentTabForConversation(s, convId)
    if (synced !== s) set(synced)

    const targetGoalId = conversationById(s, convId)?.goalId
    if (!isAgentTeamVisible(getLatest(), targetGoalId)) {
      openTab(resolveTeamTabRef(getLatest(), convId))
    }
  }, [agent.pendingAskByConv, pure, setPure, getLatest, set, openTab, onSyncFreeConvId])

  return {
    openAgentTeam,
    toggleAgentTeam,
    expandAgentTeam,
  }
}
