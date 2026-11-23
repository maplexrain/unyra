import { useCallback } from 'react'
import type { AgentTabRef, LearnStore } from '../../../learn/types'
import {
  agentTabKey,
  upsertAgentTab,
  withAgentTabs,
} from '../../../learn/agentTabs'
import {
  addConversation,
  conversationById,
  deleteConversation,
  ensureConversation,
  nodeById,
  resolveDisplayedConversation,
} from '../../../learn/graph'
import { pruneImages } from '../../../learn/images'
import { resetPrefixGate } from '../../../agent/prefixGate'
import { goalConvByGoal, goalFocusByGoal } from './goalFocus'
import { sortConversationsByTimeDesc } from '../agent-team/conversationList'
import { roleOfConversation } from '../../../learn/roleWork/roles'
import { t } from '../../../i18n'

/** agent 栏模式/会话动作需要的宿主能力与派生值 */
export interface AgentTabActionsDeps {
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  onToast: (msg: string) => void
  setSidebarOpen: (open: boolean) => void
  runningByConversation: Record<string, boolean>
}

/**
 * 删会话 / 清空会话之后收拾 agent 页签（纯函数，便于单测）：
 * - 已死目标 / 已死子代理会话的页签丢掉；
 * - 指向被删会话的目标级页签重映射到同目标按时间降序的最新一段；
 * - 若当前处于固定聊天 `'free'`，原地保留 `'free'`；
 * - 若删的正是激活中的目标会话或其子代理，激活权留在同目标降序回落会话上，不跳去别家目标。
 */
export function repairAgentTabsAfterDelete(
  s: LearnStore,
  opts?: { deletedConvId?: string; deletedGoalId?: string; fallbackConvId?: string | null },
): LearnStore {
  const tabs0 = s.agentTabs ?? []
  if (!tabs0.length) {
    if (opts?.deletedGoalId && s.agentActiveTab?.startsWith(`ga:${opts.deletedGoalId}`) && opts.fallbackConvId) {
      return withAgentTabs(
        s,
        [{ kind: 'goal', goalId: opts.deletedGoalId, conversationId: opts.fallbackConvId }],
        `ga:${opts.deletedGoalId}:${opts.fallbackConvId}`,
      )
    }
    return s
  }

  const mapped = tabs0
    .filter((t) => {
      if (t.kind === 'goal') return s.goals.some((g) => g.id === t.goalId)
      if (t.kind !== 'work') return true
      const conv = conversationById(s, t.conversationId)
      return !!conv?.works?.sessions.some((x) => x.id === t.workId)
    })
    .map((t) => {
      if (t.kind !== 'goal' || !t.conversationId) return t
      const valid = conversationById(s, t.conversationId)?.goalId === t.goalId
      if (valid) return t
      const goalConvs = sortConversationsByTimeDesc(s.conversations.filter((c) => c.goalId === t.goalId))
      const fb = goalConvs[0]?.id ?? resolveDisplayedConversation(s, t.goalId) ?? null
      return { ...t, conversationId: fb }
    })

  const seen = new Set<string>()
  const fixed: AgentTabRef[] = []
  for (const t of mapped) {
    const key = agentTabKey(t)
    if (seen.has(key)) continue
    seen.add(key)
    fixed.push(t)
  }

  let active = s.agentActiveTab ?? null
  if (active === 'free') {
    return withAgentTabs(s, fixed, 'free')
  }

  if (active && fixed.some((t) => agentTabKey(t) === active)) {
    return withAgentTabs(s, fixed, active)
  }

  if (opts?.deletedGoalId && s.goals.some((g) => g.id === opts.deletedGoalId)) {
    const fb =
      opts.fallbackConvId ??
      sortConversationsByTimeDesc(s.conversations.filter((c) => c.goalId === opts.deletedGoalId))[0]?.id ??
      null
    const preferredKey = fb ? `ga:${opts.deletedGoalId}:${fb}` : `ga:${opts.deletedGoalId}`
    if (fixed.some((t) => agentTabKey(t) === preferredKey)) {
      return withAgentTabs(s, fixed, preferredKey)
    }
    const ref: AgentTabRef = { kind: 'goal', goalId: opts.deletedGoalId, conversationId: fb }
    return withAgentTabs(s, [...fixed, ref], agentTabKey(ref))
  }

  active = fixed[0] ? agentTabKey(fixed[0]) : null
  return withAgentTabs(s, fixed, active)
}

/* ---------- 智能体模式切换与会话 CRUD（供 AgentSlot / LearnWorkspace 消费） ---------- */
export function useAgentTabActions({
  getLatest,
  set,
  onToast,
  setSidebarOpen,
  runningByConversation,
}: AgentTabActionsDeps) {
  /** 开（或更新）一枚内部 agent 运行时条目（含子代理独立上下文） */
  const openAgentTab = useCallback(
    (ref: AgentTabRef, activate = true) => {
      const s = getLatest()
      const next = upsertAgentTab(s.agentTabs ?? [], s.agentActiveTab ?? null, ref, activate)
      set(withAgentTabs(s, next.tabs, next.active))
    },
    [getLatest, set],
  )

  /** 激活指定 key（'free' / 'ga:...' / 'sa:...'） */
  const activateAgentTab = useCallback(
    (key: string) => {
      const s = getLatest()
      if (s.agentActiveTab === key) return
      if (key !== 'free' && !(s.agentTabs ?? []).some((t) => agentTabKey(t) === key)) return

      let next: LearnStore = s
      if (key !== 'free') {
        const targetTab = (s.agentTabs ?? []).find((t) => agentTabKey(t) === key)
        if (targetTab && targetTab.kind === 'goal') {
          const focusId =
            goalFocusByGoal.get(targetTab.goalId) ??
            s.goals.find((g) => g.id === targetTab.goalId)?.rootNodeId ??
            s.activeNodeId
          const convId =
            targetTab.conversationId ?? resolveDisplayedConversation(s, targetTab.goalId) ?? null
          if (convId) goalConvByGoal.set(targetTab.goalId, convId)
          next = {
            ...s,
            activeGoalId: targetTab.goalId,
            activeNodeId: focusId,
            activeConversationId: convId,
          }
        } else if (targetTab && targetTab.kind === 'work') {
          const conv = conversationById(s, targetTab.conversationId)
          if (conv) {
            goalConvByGoal.set(conv.goalId, targetTab.conversationId)
            next = {
              ...s,
              activeGoalId: conv.goalId,
              activeConversationId: targetTab.conversationId,
            }
          }
        }
      }
      set(withAgentTabs(next, s.agentTabs ?? [], key))
    },
    [getLatest, set],
  )

  /** 切换到指定学习目标的导师视图（若尚无会话则现场初始化） */
  const selectTutorGoal = useCallback(
    (goalId: string) => {
      const s = getLatest()
      const goal = s.goals.find((g) => g.id === goalId)
      if (!goal) return
      // **只认导师会话**：声部会话（调度员 / 出卷师…的 cv/dv）与导师会话共用 goalId，
      // 不过滤的话「最后活跃的那段」会是其他声部的会话——点导师却打开了别人的对话
      const isTutorConv = (id: string | null | undefined): boolean => {
        if (!id) return false
        const c = conversationById(s, id)
        return !!c && c.goalId === goalId && roleOfConversation(c) === 'tutor'
      }
      const activeInGoal = isTutorConv(s.activeConversationId) ? s.activeConversationId! : null
      const remembered = goalConvByGoal.get(goalId)
      const validRemembered = isTutorConv(remembered) ? remembered! : null
      const descFirst =
        sortConversationsByTimeDesc(
          s.conversations.filter((c) => c.goalId === goalId && roleOfConversation(c) === 'tutor'),
        )[0]?.id ?? null
      // 回退链里**不能有 resolveDisplayedConversation**：它读的是当前激活页签——点导师时
      // 那上面停的还是声部会话（调度员 / 出卷师…），会把别人的对话选回来（真机踩过）
      const resolvedId = activeInGoal ?? validRemembered ?? descFirst
      const ensured = resolvedId
        ? { store: s, conversationId: resolvedId }
        : ensureConversation(s, goalId)
      goalConvByGoal.set(goalId, ensured.conversationId)

      const focusId =
        goalFocusByGoal.get(goalId) ??
        goal.rootNodeId ??
        ensured.store.nodes.find((n) => n.goalId === goalId)?.id ??
        ensured.store.activeNodeId
      const t0 = upsertAgentTab(
        ensured.store.agentTabs ?? [],
        ensured.store.agentActiveTab ?? null,
        { kind: 'goal', goalId, conversationId: ensured.conversationId },
        true,
      )
      set(
        withAgentTabs(
          {
            ...ensured.store,
            activeGoalId: goalId,
            activeNodeId: focusId || ensured.store.activeNodeId,
            activeConversationId: ensured.conversationId,
          },
          t0.tabs,
          t0.active,
        ),
      )
    },
    [getLatest, set],
  )

  /** 在指定目标（或 work 所属目标）下切换展示的会话 */
  const selectConversationIn = useCallback(
    (tab: AgentTabRef, conversationId: string) => {
      const s = getLatest()
      const targetGoalId =
        tab.kind === 'goal'
          ? tab.goalId
          : tab.kind === 'work'
            ? conversationById(s, tab.conversationId)?.goalId
            : null
      if (!targetGoalId) return
      const conv = conversationById(s, conversationId)
      if (!conv || conv.goalId !== targetGoalId) return
      goalConvByGoal.set(targetGoalId, conversationId)
      const t0 = upsertAgentTab(
        s.agentTabs ?? [],
        s.agentActiveTab ?? null,
        { kind: 'goal', goalId: targetGoalId, conversationId },
        true,
      )
      const next: LearnStore = {
        ...s,
        activeGoalId: targetGoalId,
        activeConversationId: conversationId,
      }
      set(withAgentTabs(next, t0.tabs, t0.active))
      setSidebarOpen(false)
    },
    [getLatest, set, setSidebarOpen],
  )

  /** 在指定（或当前激活）目标下新增一段对话并置前激活 */
  const handleNewGoalConversation = useCallback(
    (targetGoalId?: string) => {
      const s = getLatest()
      const gid = targetGoalId ?? s.activeGoalId
      if (!gid) return
      const { store: withConv, conversation } = addConversation(s, gid)
      goalConvByGoal.set(gid, conversation.id)
      const t0 = upsertAgentTab(
        withConv.agentTabs ?? [],
        withConv.agentActiveTab ?? null,
        { kind: 'goal', goalId: gid, conversationId: conversation.id },
        true,
      )
      const next: LearnStore = {
        ...withConv,
        activeGoalId: gid,
        activeConversationId: conversation.id,
      }
      set(withAgentTabs(next, t0.tabs, t0.active))
    },
    [getLatest, set],
  )

  /** 在目标或子代理对应的目标下新建一段对话 */
  const newConversationIn = useCallback(
    (tab: AgentTabRef) => {
      const s = getLatest()
      const targetGoalId =
        tab.kind === 'goal'
          ? tab.goalId
          : tab.kind === 'work'
            ? conversationById(s, tab.conversationId)?.goalId
            : null
      if (targetGoalId) handleNewGoalConversation(targetGoalId)
    },
    [getLatest, handleNewGoalConversation],
  )

  /** 删对话 / 删消息之后清理不再被引用的磁盘图片 */
  const pruneImagesOf = useCallback((s: LearnStore) => {
    if (s.activeGoalId) void pruneImages(s, s.activeGoalId)
  }, [])

  /** 删除或清空指定目标对话（运行中拦截，删当前激活段时顺滑落回时间最新段） */
  const removeConversation = useCallback(
    (conversationId: string) => {
      if (runningByConversation[conversationId]) {
        onToast(t('这一段正在运行，先停止再删除'))
        return
      }
      resetPrefixGate(conversationId)
      const before = getLatest()
      const target = conversationById(before, conversationId)
      const afterDel = deleteConversation(before, conversationId)
      const fallbackConvId = target
        ? (sortConversationsByTimeDesc(afterDel.conversations.filter((c) => c.goalId === target.goalId))[0]?.id ?? null)
        : null
      if (target && goalConvByGoal.get(target.goalId) === conversationId) {
        if (fallbackConvId) goalConvByGoal.set(target.goalId, fallbackConvId)
        else goalConvByGoal.delete(target.goalId)
      }
      const patchedDel =
        target && before.activeConversationId === conversationId && afterDel.activeGoalId === target.goalId
          ? { ...afterDel, activeConversationId: fallbackConvId }
          : afterDel
      const next = repairAgentTabsAfterDelete(patchedDel, {
        deletedConvId: conversationId,
        deletedGoalId: target?.goalId,
        fallbackConvId,
      })
      if (next.activeConversationId || !next.activeNodeId) {
        set(next)
        pruneImagesOf(next)
        return
      }
      const node = nodeById(next, next.activeNodeId)
      if (!node) {
        set(next)
        pruneImagesOf(next)
        return
      }
      const ensured = ensureConversation(next, node.goalId)
      const patched: LearnStore = { ...ensured.store, activeConversationId: ensured.conversationId }
      set(patched)
      pruneImagesOf(patched)
    },
    [runningByConversation, onToast, getLatest, set, pruneImagesOf],
  )

  const fixAgentTabsAfter = useCallback(
    (s: LearnStore, opts?: { deletedConvId?: string; deletedGoalId?: string; fallbackConvId?: string | null }) =>
      repairAgentTabsAfterDelete(s, opts),
    [],
  )

  return {
    openAgentTab,
    activateAgentTab,
    selectTutorGoal,
    handleNewGoalConversation,
    newConversationIn,
    selectConversationIn,
    pruneImagesOf,
    removeConversation,
    fixAgentTabsAfter,
  }
}
