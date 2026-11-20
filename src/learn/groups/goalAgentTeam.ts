/**
 * 目标级智能体团队页签（kind: 'agentTeam', goalId）的生命周期编排：
 * - 与结构页签（outline）保持一致的归属、开启、迁移与重排规矩；
 * - 开签时不抢占用户当前正在看的页签（如结构页签），仅将固定标签放入左侧固定区并登记归属。
 */

import type { LearningGoal, LearnTab, TabRef } from '../types'
import { makeTab, reorderTabs, tabKey } from '../tabs'
import { groupOf, settle, withGroup } from './core'
import { claimTab, withOwners, withParked } from './goals'
import { allTabs } from './tabs'
import type { DocWorkspace } from './types'

export function goalAgentTeamRef(goalId: string): TabRef & { kind: 'agentTeam'; goalId: string } {
  return { kind: 'agentTeam', goalId }
}

/** 查找某个目标在当前工作区对应的锚点大纲页签所在分组（找不到时返回 null） */
export function outlineGroupForGoal(docs: DocWorkspace, goal: LearningGoal): string | null {
  const candidates = [
    ...(goal.rootNodeId ? [tabKey({ kind: 'outline', nodeId: goal.rootNodeId, goalId: goal.id })] : []),
    tabKey({ kind: 'outline', nodeId: goal.id, goalId: goal.id }),
  ]
  for (const id of candidates) {
    const found = docs.groups.find((g) => g.tabs.some((t) => t.id === id))
    if (found) return found.id
  }
  const byGoalTab = docs.groups.find((g) =>
    g.tabs.some(
      (t) =>
        t.ref.kind === 'outline' &&
        (t.ref.goalId === goal.id || t.ref.nodeId === goal.id || (goal.rootNodeId && t.ref.nodeId === goal.rootNodeId)),
    ),
  )
  return byGoalTab?.id ?? null
}

/**
 * 确保指定学习目标拥有独立的智能体团队固定页签，但不打断当前激活页签的焦点：
 * - 若该页签已在工作区中，仅校正归属与固定排序；
 * - 若该页签尚未开出，则放进锚点大纲所在的分组（回退到焦点格），登记归属后按固定区重排。
 */
export function ensureGoalAgentTeamTab(
  docs: DocWorkspace,
  goalId: string,
  at = Date.now(),
  opts?: { activate?: boolean; targetGroupId?: string },
): DocWorkspace {
  const ref = goalAgentTeamRef(goalId)
  const id = tabKey(ref)
  const existing = docs.groups.find((g) => g.tabs.some((t) => t.id === id))
  if (existing) {
    let next = withGroup(docs, existing.id, (g) => {
      const reordered = reorderTabs(g.tabs, g.tabs.map((t) => t.id))
      return {
        ...g,
        tabs: reordered,
        active: opts?.activate ? id : g.active,
      }
    })
    next = withOwners(next, claimTab(next.tabOwners, goalId, id))
    return opts?.activate ? settle(next) : next
  }

  const targetGroup =
    (opts?.targetGroupId && groupOf(docs, opts.targetGroupId) ? opts.targetGroupId : null) ??
    docs.focus
  const newTab: LearnTab = { ...makeTab(ref, at), pinned: true }

  let next = withGroup(docs, targetGroup, (g) => {
    const cleanTabs = g.tabs.some((t) => t.id === id) ? g.tabs : [...g.tabs, newTab]
    const reordered = reorderTabs(cleanTabs, cleanTabs.map((t) => t.id))
    const nextActive = opts?.activate ? id : g.active || id
    return {
      ...g,
      tabs: reordered,
      active: nextActive,
    }
  })
  next = withOwners(next, claimTab(next.tabOwners, goalId, id))
  return settle(next)
}

/**
 * 读盘/状态同步（纯迁移与清理）：
 * 1. 将历史全局单例 `team:all` 迁移至 `activeGoalId` 对应的独立智能体团队页签；
 * 2. 已删除目标残留的 agentTeam 页签（groups 与 parkedTabs）一并清掉；
 * 3. 对已有目标不主动凭空造新页签（避免污染序列化往返结构），仅升级并校验既有 agentTeam 页签。
 */
export function syncGoalAgentTeamTabs(
  docs: DocWorkspace,
  goals: readonly LearningGoal[],
  activeGoalId: string | null,
): DocWorkspace {
  const validGoalIds = new Set(goals.map((g) => g.id))
  const fallbackGoalId = activeGoalId && validGoalIds.has(activeGoalId) ? activeGoalId : goals[0]?.id ?? null

  let changed = false
  const groups = docs.groups.map((g) => {
    const nextTabs: LearnTab[] = []
    let active = g.active
    let groupChanged = false
    for (const t of g.tabs) {
      if (t.ref.kind !== 'agentTeam') {
        nextTabs.push(t)
        continue
      }
      if (!t.ref.goalId) {
        if (fallbackGoalId) {
          const migratedRef = goalAgentTeamRef(fallbackGoalId)
          const migratedId = tabKey(migratedRef)
          if (!nextTabs.some((x) => x.id === migratedId) && !allTabs(docs).some((x) => x.id === migratedId && x.id !== t.id)) {
            nextTabs.push({ ...t, id: migratedId, ref: migratedRef, pinned: true })
            if (active === t.id) active = migratedId
            groupChanged = true
            continue
          }
        }
        if (active === t.id) active = null
        groupChanged = true
        continue
      }
      if (!validGoalIds.has(t.ref.goalId)) {
        if (active === t.id) active = null
        groupChanged = true
        continue
      }
      if (!t.pinned) {
        nextTabs.push({ ...t, pinned: true })
        groupChanged = true
      } else {
        nextTabs.push(t)
      }
    }
    if (!groupChanged) return g
    changed = true
    const reordered = reorderTabs(nextTabs, nextTabs.map((x) => x.id))
    const nextActive = active && reordered.some((x) => x.id === active) ? active : (reordered[0]?.id ?? null)
    return { ...g, tabs: reordered, active: nextActive }
  })

  let out: DocWorkspace = changed ? settle({ ...docs, groups }) : docs

  if (out.parkedTabs) {
    let parkedChanged = false
    const nextParked: Record<string, LearnTab[]> = {}
    for (const [gid, tabs] of Object.entries(out.parkedTabs)) {
      if (!validGoalIds.has(gid)) {
        parkedChanged = true
        continue
      }
      const filtered = tabs.filter((t) => {
        if (t.ref.kind !== 'agentTeam') return true
        return Boolean(t.ref.goalId && validGoalIds.has(t.ref.goalId))
      })
      if (filtered.length !== tabs.length) parkedChanged = true
      if (filtered.length > 0) nextParked[gid] = filtered
    }
    if (parkedChanged) {
      out = withParked(out, Object.keys(nextParked).length ? nextParked : undefined)
    }
  }

  return out
}
