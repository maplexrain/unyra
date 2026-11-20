/**
 * 智能体团队（Tab 页版 AgentPanel）宿主协调器。
 *
 * 职责：
 * 1. 管理智能体团队单例页签（kind: 'agentTeam'）的打开、聚焦与 Ctrl+Q 往返切换；
 * 2. 监听工作区各处触发的工作流与提问表单（runningByConversation / pendingAskByConv），
 *    自动同步 agentTabs 激活会话，并在需要时唤起智能体团队页签展示执行与表单。
 */

import { useCallback, useEffect, useRef } from 'react'
import type { LearnStore, TabRef } from '../../../learn/types'
import { conversationById, resolveDisplayedConversation } from '../../../learn/graph'
import { upsertAgentTab, withAgentTabs } from '../../../learn/agentTabs'
import { findTab, focusedTab } from '../../../learn/groups'
import type { useAgent } from '../../../learn/useAgent'
import { focusAgentInput } from '../../../lib/agentFocus'

type AgentApi = ReturnType<typeof useAgent>

/** 任意分屏组中当前激活的页签是否为智能体团队页签 */
export function isAgentTeamVisible(store: LearnStore): boolean {
  return store.docArea.groups.some(
    (g) => Boolean(g.active && g.tabs.some((t) => t.id === g.active && t.ref.kind === 'agentTeam')),
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
}

export function useAgentTeamHost({
  getLatest,
  set,
  openTab,
  activateTab,
  agent,
  pure,
  setPure,
}: AgentTeamHostDeps) {
  const lastNonTeamTabRef = useRef<string | null>(null)
  const focusTimerRef = useRef<number | null>(null)
  const prevRunningRef = useRef<Set<string>>(new Set())
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

      openTab({ kind: 'agentTeam' })
      if (opts?.focusInput) {
        scheduleFocusInput()
      }
    },
    [getLatest, set, openTab, scheduleFocusInput],
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

  // 监听工作流与任意会话启动：自动对齐对应导师会话并在需要时切到智能体团队页签
  useEffect(() => {
    const currentRunning = new Set(
      Object.entries(agent.runningByConversation)
        .filter(([, running]) => Boolean(running))
        .map(([convId]) => convId),
    )
    const started: string[] = []
    for (const cid of currentRunning) {
      if (!prevRunningRef.current.has(cid)) started.push(cid)
    }
    prevRunningRef.current = currentRunning

    if (started.length === 0) return

    const convId = started[started.length - 1]
    const s = getLatest()
    const synced = syncAgentTabForConversation(s, convId)
    if (synced !== s) set(synced)

    if (!pure && !isAgentTeamVisible(getLatest())) {
      openTab({ kind: 'agentTeam' })
    }
  }, [agent.runningByConversation, pure, getLatest, set, openTab])

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
    const synced = syncAgentTabForConversation(s, convId)
    if (synced !== s) set(synced)

    if (!isAgentTeamVisible(getLatest())) {
      openTab({ kind: 'agentTeam' })
    }
  }, [agent.pendingAskByConv, pure, setPure, getLatest, set, openTab])

  return {
    openAgentTeam,
    toggleAgentTeam,
    expandAgentTeam,
  }
}
