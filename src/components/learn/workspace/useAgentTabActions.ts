import { useCallback, useMemo } from 'react'
import type { AgentTabRef, LearnStore, LearnTab } from '../../../learn/types'
import {
  agentTabCloseBlock,
  agentTabCloseSet,
  agentTabKey,
  reorderAgentTabs,
  removeAgentTab,
  upsertAgentTab,
  withAgentTabs,
  type AgentTabCloseBlock,
} from '../../../learn/agentTabs'
import { allTabs } from '../../../learn/groups'
import { closeGoalTabGroupStore } from '../../../learn/groups/goalTabGroupOps'
import type { TabCloseMode } from '../../../learn/tabs'
import { tabNodeId } from '../../../learn/tabs'
import { conversationById, conversationTitle, nodeById, resolveDisplayedConversation } from '../../../learn/graph'
import { goalFocusByGoal } from './goalFocus'
import type { useAgent } from '../../../learn/useAgent'
import { t } from '../../../i18n'

type AgentApi = ReturnType<typeof useAgent>

/** agent 栏页签动作需要的宿主能力与派生值 */
export interface AgentTabActionsDeps {
  store: LearnStore
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  onToast: (msg: string) => void
  /** 文档区全部页签（布局顺序）：目标级页签的关闭守卫按它算 docGoalIds */
  tabs: LearnTab[]
  agent: AgentApi
}

/* ---------- agent 栏页签（见 learn/agentTabs 与 AgentTabStrip） ---------- */
export function useAgentTabActions({ store, getLatest, set, onToast, tabs, agent }: AgentTabActionsDeps) {
  /** 开（或更新）一枚 agent 页签；子代理页签由用户从会话菜单点开（不自动开——页签多了拥挤） */
  const openAgentTab = useCallback(
    (ref: AgentTabRef, activate = true) => {
      const s = getLatest()
      const next = upsertAgentTab(s.agentTabs ?? [], s.agentActiveTab ?? null, ref, activate)
      set(withAgentTabs(s, next.tabs, next.active))
    },
    [getLatest, set],
  )

  /** 点一枚页签：置前（目标级页签展示哪段对话以页签里记的为准，见 agentView） */
  const activateAgentTab = useCallback(
    (key: string) => {
      const s = getLatest()
      if (s.agentActiveTab === key) return
      // 固定聊天页签不在 store 的页签列表里（界面合成置左），但它是合法的激活项
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
          next = {
            ...s,
            activeGoalId: targetTab.goalId,
            activeNodeId: focusId,
            activeConversationId: convId,
          }
        } else if (targetTab && targetTab.kind === 'sub') {
          const conv = conversationById(s, targetTab.conversationId)
          if (conv) {
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

  /**
   * 文档区里哪些目标还开着页签：目标级导师页签的关闭守卫读它——
   * 需求原文：「如果文档区还存在某个目标的页签，那么就无法关闭 agent 栏中其对应的 agent」。
   */
  const docGoalIds = useMemo(() => {
    const out = new Set<string>()
    for (const t of tabs) {
      const nid = tabNodeId(t.ref)
      const n = nid ? nodeById(store, nid) : null
      if (n) out.add(n.goalId)
    }
    return out
  }, [tabs, store])

  /** 一枚页签的关闭守卫数据（目标级：文档区还有它的页签 / 会话在跑；子代理不拦） */
  const closeBlockOf = useCallback(
    (s: LearnStore, ref: AgentTabRef): AgentTabCloseBlock => {
      const convId =
        ref.kind === 'goal'
          ? ref.conversationId && conversationById(s, ref.conversationId)?.goalId === ref.goalId
            ? ref.conversationId
            : (resolveDisplayedConversation(s, ref.goalId) ?? null)
          : null
      const hasDocTabs =
        ref.kind === 'goal'
          ? allTabs(s.docArea).some((t) => {
              if (t.ref.kind === 'mind') return t.ref.goalId === ref.goalId
              const nodeId = tabNodeId(t.ref)
              return !!nodeId && nodeById(s, nodeId)?.goalId === ref.goalId
            })
          : false
      return agentTabCloseBlock(ref, {
        // 关闭动作必须按 getLatest() 现算，不能读创建 callback 时的旧 docGoalIds；
        // 文档区刚关完一枚页签后，旧闭包否则会把导师继续错误地拦住。
        hasDocTabs,
        running: ref.kind === 'goal' ? !!(convId && agent.runningByConversation[convId]) : false,
      })
    },
    [agent.runningByConversation],
  )

  /**
   * 关一批页签（右键菜单的位置语义：self/left/right/others/all，与文档区同一套；
   * 单枚关闭 = mode 'self'）。名单里的每一枚都要过关闭守卫：拦下的跳过，
   * 一枚都没关成时把原因说清；关掉的全从 removeAgentTab 走——激活项逐次落到
   * 「被关那枚的邻居」。
   */
  const closeAgentTabMode = useCallback(
    (key: string, mode: TabCloseMode) => {
      const s = getLatest()
      const list = s.agentTabs ?? []
      const doomed = agentTabCloseSet(list, key, mode)
      if (!doomed.length) return
      let cur = s

      // 强制模式：连同文档区关联的tab一起关闭整个目标页签组
      const isForce = mode === 'force' || mode === 'forceOthers'
      if (isForce) {
        const doomedGoalIds = new Set<string>()
        for (const k of doomed) {
          const ref = (cur.agentTabs ?? []).find((t) => agentTabKey(t) === k)
          if (ref && ref.kind === 'goal') doomedGoalIds.add(ref.goalId)
        }
        for (const gid of doomedGoalIds) {
          cur = closeGoalTabGroupStore(cur, gid)
        }
      }

      let closed = 0
      let blocked = 0
      for (const k of doomed) {
        const ref = (cur.agentTabs ?? []).find((t) => agentTabKey(t) === k)
        if (!ref) continue
        const block = closeBlockOf(cur, ref)
        if (block !== 'none' && !isForce) {
          blocked++
          continue
        }
        if (ref.kind === 'goal') {
          // 检查该目标下是否还有未在 doomed 里的其他对话页签
          const remainingTabsOfGoal = (cur.agentTabs ?? []).filter(
            (t) => t.kind === 'goal' && t.goalId === ref.goalId && !doomed.includes(agentTabKey(t)),
          )
          if (remainingTabsOfGoal.length === 0) {
            // 最后一个对话页签关闭：视为关闭整个页签组！
            cur = closeGoalTabGroupStore(cur, ref.goalId)
            closed++
            continue
          }
        }
        const next = removeAgentTab(cur.agentTabs ?? [], cur.agentActiveTab ?? null, k)
        cur = withAgentTabs(cur, next.tabs, next.active)
        if (cur.agentActiveTab) {
          const activeRef = (cur.agentTabs ?? []).find((t) => agentTabKey(t) === cur.agentActiveTab)
          if (activeRef?.kind === 'goal') {
            cur = {
              ...cur,
              activeGoalId: activeRef.goalId,
              activeConversationId: activeRef.conversationId,
            }
          }
        }
        closed++
      }
      if (!closed) {
        onToast(t('导师正在运行，先停止这一轮再关闭'))
        return
      }
      // 全部关完时把激活权交给固定聊天页签——它是这一栏的底座，永远在
      if (!cur.agentActiveTab) cur = { ...cur, agentActiveTab: 'free' }
      set(cur)
      if (blocked) onToast(t('{0} 枚页签被拦下（导师正在跑）', blocked))
    },
    [getLatest, set, closeBlockOf, onToast],
  )

  /** 关一枚页签（单枚 = closeMode 的 self） */
  const closeAgentTab = useCallback(
    (key: string) => closeAgentTabMode(key, 'self'),
    [closeAgentTabMode],
  )

  /** 拖拽排序：只动顺序不动激活态（与文档区 reorderTabList 同一条规矩），顺序随 state.json 落盘。
      固定聊天页签不参与排序：它常驻最左，把它从钥匙串里滤掉（列表里本来也没有它） */
  const reorderAgentTabList = useCallback(
    (keys: string[]) => {
      const s = getLatest()
      const next = reorderAgentTabs(s.agentTabs ?? [], keys.filter((k) => k !== 'free'))
      if (next === (s.agentTabs ?? [])) return
      set(withAgentTabs(s, next, s.agentActiveTab ?? null))
    },
    [getLatest, set],
  )

  /** 页签标题：固定聊天 = 「聊天」；目标级 = 对话标题或目标标题；子代理 = 定义名（任务模式使用图标前置 task chip 标识） */
  const agentTabTitle = useCallback(
    (ref: AgentTabRef): string => {
      if (ref.kind === 'free') return t('聊天')
      if (ref.kind === 'goal') {
        const goal = store.goals.find((g) => g.id === ref.goalId)
        const goalTitle = goal ? (nodeById(store, goal.rootNodeId)?.title ?? goal.question) : ''
        const conv = ref.conversationId ? conversationById(store, ref.conversationId) : undefined
        const convTitle = conv?.title || (conv && conv.messages.length > 0 ? conversationTitle(conv) : '')
        return convTitle || goalTitle || t('新对话')
      }
      const conv = conversationById(store, ref.conversationId)
      const session = conv?.subagents?.sessions.find((x) => x.id === ref.sessionId)
      const def = session ? conv?.subagents?.defs.find((d) => d.key === session.defKey) : undefined
      return def?.name ?? session?.defKey ?? t('子代理')
    },
    [store],
  )

  /** 页签的运行态：固定聊天看那张「谁在跑」的表；目标级看同一张表；子代理看会话状态（后台跑的也算跑着） */
  const agentTabRunning = useCallback(
    (ref: AgentTabRef): boolean => {
      if (ref.kind === 'free') return !!(ref.conversationId && agent.runningByConversation[ref.conversationId])
      if (ref.kind === 'goal') {
        const convId =
          ref.conversationId && conversationById(store, ref.conversationId)?.goalId === ref.goalId
            ? ref.conversationId
            : (resolveDisplayedConversation(store, ref.goalId) ?? null)
        return !!(convId && agent.runningByConversation[convId])
      }
      const conv = conversationById(store, ref.conversationId)
      return conv?.subagents?.sessions.find((x) => x.id === ref.sessionId)?.status === 'running'
    },
    [store, agent.runningByConversation],
  )

  /**
   * 删会话 / 删目标之后收拾 agent 页签：指向被删会话的目标级页签改指该目标最近的一段，
   * 已死会话的子代理页签与已死目标的目标级页签整枚丢掉。读盘归一有同一条规矩
   * （normalizeAgentTabs），这里是活删的即时版。
   */
  const fixAgentTabsAfter = (s: LearnStore): LearnStore => {
    const tabs0 = s.agentTabs ?? []
    if (!tabs0.length) return s
    const mapped = tabs0
      .filter((t) => {
        if (t.kind === 'goal') return s.goals.some((g) => g.id === t.goalId)
        if (t.kind !== 'sub') return true
        const conv = conversationById(s, t.conversationId)
        return !!conv?.subagents?.sessions.some((x) => x.id === t.sessionId)
      })
      .map((t) =>
        t.kind === 'goal' &&
        t.conversationId &&
        conversationById(s, t.conversationId)?.goalId !== t.goalId
          ? { ...t, conversationId: resolveDisplayedConversation(s, t.goalId) ?? null }
          : t,
      )
    const seen = new Set<string>()
    const fixed: AgentTabRef[] = []
    for (const t of mapped) {
      const key = agentTabKey(t)
      if (seen.has(key)) continue
      seen.add(key)
      fixed.push(t)
    }
    const active =
      s.agentActiveTab && fixed.some((t) => agentTabKey(t) === s.agentActiveTab)
        ? s.agentActiveTab
        : (fixed[0] ? agentTabKey(fixed[0]) : null)
    return withAgentTabs(s, fixed, active)
  }

  return {
    openAgentTab,
    activateAgentTab,
    docGoalIds,
    closeBlockOf,
    closeAgentTabMode,
    closeAgentTab,
    reorderAgentTabList,
    agentTabTitle,
    agentTabRunning,
    fixAgentTabsAfter,
  }
}
