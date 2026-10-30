/**
 * 目标页签组（Goal Tab Group）生命周期与批量操作。
 *
 * 页签组的概念统一收容：
 * - 文档区页签（活动页签与停靠场 parkedTabs 缓存）
 * - 归属表（tabOwners）
 * - Agent 区域的对话页签（目标级导师对话）
 */

import type { LearnStore } from '../types'
import { nodeById } from '../graph/nodes'
import { makeBlankTab } from '../tabs'
import { goalTabsOf, withOwners, withParked } from './goals'
import { allTabs, closeIds } from './tabs'
import { withGroup } from './core'
import { focusedGroup } from './focus'
import { removeAgentTabsOfGoals, withAgentTabs } from '../agentTabs'

/**
 * 关闭整个目标页签组：
 * 1. 从停靠场中彻底移除该目标的缓存；
 * 2. 找到当前活动页签中属于该目标的页签并关闭；
 * 3. 从归属表中移除该目标；
 * 4. 清理导师页签中属于该目标的全部页签；
 * 5. 如果当前激活的目标就是它，清空激活目标与节点，文档区置空白。
 */
export function closeGoalTabGroupStore(s: LearnStore, goalId: string): LearnStore {
  const goalOfNode = (nodeId: string) => nodeById(s, nodeId)?.goalId ?? null

  // 1. 从停靠场中彻底移除该目标的缓存
  const nextParked = { ...(s.docArea.parkedTabs ?? {}) }
  delete nextParked[goalId]

  // 2. 找到当前活动页签中属于该目标的页签并关闭
  const all = allTabs(s.docArea)
  const victims = goalTabsOf(s.docArea.tabOwners, all, goalOfNode, goalId)
  let docArea = s.docArea
  if (victims.length > 0) {
    docArea = closeIds(docArea, victims.map((v) => v.id), { preserveActiveAsBlank: true })
  }

  // 3. 从归属表中移除该目标
  const nextOwners = { ...(docArea.tabOwners ?? {}) }
  delete nextOwners[goalId]
  docArea = withOwners(withParked(docArea, Object.keys(nextParked).length > 0 ? nextParked : undefined), nextOwners)

  // 4. 清理导师页签中属于该目标的页签
  const removed = removeAgentTabsOfGoals(s.agentTabs ?? [], s.agentActiveTab ?? null, new Set([goalId]))
  let nextStore = withAgentTabs({ ...s, docArea }, removed.tabs, removed.active ?? 'free')

  // 5. 如果当前激活的目标就是它，清空激活目标与节点，文档区置空白
  if (nextStore.activeGoalId === goalId) {
    const fg = focusedGroup(docArea)
    if (fg) {
      const blank = makeBlankTab()
      docArea = withGroup(docArea, fg.id, (g) => ({
        ...g,
        tabs: [blank],
        active: blank.id,
      }))
    }
    nextStore = {
      ...nextStore,
      docArea,
      activeGoalId: null,
      activeNodeId: null,
      activeConversationId: null,
    }
  }
  return nextStore
}
