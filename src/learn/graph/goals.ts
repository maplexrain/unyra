/**
 * 本文件负责：**以目标为单位**的两件事——删掉一个目标（连同它的节点、页签、会话、记忆），
 * 以及目标进度这一派生视图。
 *
 * 两者同属「以目标为单位」的操作，且只依赖节点查表与前置边，所以放在一处。
 */
import type { LearnStore, TabRef } from '../types'
import { withVideoMirror } from '../video/nodes'
import { withoutTmpNodes } from '../../lib/tmpStore'
import { allStoredTabs, closeIds, dropTabs, restoreParkedTabs, withOwners, withParked } from '../groups'
import { agentTabKey, removeAgentTabsOfGoals } from '../agentTabs'
import { dropDrafts } from '../drafts'
import { nodeById } from './lookup'
import { prereqIds } from './edges'
import { latestConversation } from './conversations'

/**
 * 一个目标的根可达、且属于这个目标的全部节点 id。
 *
 * 「删目标删多少」（deleteGoal）与「撤回要备多少货」（learn/undo 的捕获）、
 * 侧栏的「连带删多少个」（LearnWorkspace 的确认框文案）必须是同一份名单——
 * 三处各数一遍，迟早有一处把「删了多少」数错。
 */
export function goalSubtreeIds(store: LearnStore, goalId: string): Set<string> {
  const goal = store.goals.find((g) => g.id === goalId)
  if (!goal) return new Set()
  return new Set(store.nodes.filter((n) => n.goalId === goalId).map((n) => n.id))
}

/** 删除目标：移除其根可达的整棵子树、相关边与会话 */
export function deleteGoal(store: LearnStore, goalId: string): LearnStore {
  const goal = store.goals.find((g) => g.id === goalId)
  if (!goal) return store
  const removed = goalSubtreeIds(store, goalId)
  const goals = store.goals.filter((g) => g.id !== goalId)
  const nodes = store.nodes.filter((n) => !removed.has(n.id))
  const nextActiveNode =
    store.activeNodeId && (removed.has(store.activeNodeId) || store.activeGoalId === goalId)
      ? (goals[0]?.rootNodeId ?? null)
      : store.activeNodeId
  // 目标没了，它那份上下文才跟着消失；换到别的目标时回落到那个目标的最近会话
  const nextActiveGoalId = store.activeGoalId === goalId ? (goals[0]?.id ?? null) : store.activeGoalId
  const remaining = store.conversations.filter((c) => c.goalId !== goalId)
  const nextActiveConv =
    remaining.find((c) => c.id === store.activeConversationId)?.id ??
    (nextActiveGoalId ? latestConversation({ ...store, conversations: remaining }, nextActiveGoalId)?.id : null) ??
    null

  const goalOwnedTabIds = new Set(store.docArea.tabOwners?.[goalId] ?? [])
  const doomedTabs = allStoredTabs(store.docArea)
    .filter(
      (t) =>
        removed.has(tabNodeIdOf(t.ref)) ||
        goalOwnedTabIds.has(t.id) ||
        (t.ref.kind === 'mind' && t.ref.goalId === goalId) ||
        (t.ref.kind === 'video' && t.ref.goalId === goalId) ||
        (t.ref.kind === 'outline' &&
          ((t.ref as { goalId?: string }).goalId === goalId ||
            t.ref.nodeId === goalId ||
            removed.has(t.ref.nodeId) ||
            (goal.rootNodeId ? t.ref.nodeId === goal.rootNodeId : false))),
    )
    .map((t) => t.id)

  const nextParked = { ...(store.docArea.parkedTabs ?? {}) }
  delete nextParked[goalId]

  const nextOwners = { ...(store.docArea.tabOwners ?? {}) }
  delete nextOwners[goalId]

  let updatedDocArea = withOwners(
    withParked(
      closeIds(store.docArea, doomedTabs, { preserveActiveAsBlank: true }),
      Object.keys(nextParked).length > 0 ? nextParked : undefined,
    ),
    dropTabs(nextOwners, doomedTabs),
  )

  if (nextActiveGoalId && updatedDocArea.parkedTabs?.[nextActiveGoalId]) {
    updatedDocArea = restoreParkedTabs(updatedDocArea, nextActiveGoalId)
  }

  let nextStructure = store.structure
  if (nextStructure && goalId in nextStructure) {
    const s = { ...nextStructure }
    delete s[goalId]
    nextStructure = Object.keys(s).length > 0 ? s : undefined
  }
  let nextDetached = store.detached
  if (nextDetached && goalId in nextDetached) {
    const d = { ...nextDetached }
    delete d[goalId]
    nextDetached = Object.keys(d).length > 0 ? d : undefined
  }

  const removedAgent = removeAgentTabsOfGoals(
    store.agentTabs ?? [],
    store.agentActiveTab ?? null,
    new Set([goalId]),
  )

  return {
    ...store,
    goals,
    nodes,
    ...(store.videoNodes?.some((v) => v.goalId === goalId)
      ? withVideoMirror({ ...store, videoNodes: store.videoNodes.filter((v) => v.goalId !== goalId) })
      : {}),
    edges: store.edges.filter((e) => !removed.has(e.from) && !removed.has(e.to)),
    conversations: remaining,
    exams: store.exams.filter((e) => e.goalId !== goalId && !removed.has(e.nodeId)),
    tmp: withoutTmpNodes(store.tmp, removed),
    ...(nextStructure !== store.structure ? { structure: nextStructure } : {}),
    ...(nextDetached !== store.detached ? { detached: nextDetached } : {}),
    ...(store.memory
      ? {
          memory: {
            ...store.memory,
            work: Object.fromEntries(Object.entries(store.memory.work).filter(([g]) => g !== goalId)),
          },
        }
      : {}),
    docArea: updatedDocArea,
    drafts: dropDrafts(store.drafts, doomedTabs),
    agentTabs: removedAgent.tabs,
    agentActiveTab:
      removedAgent.active ?? (removedAgent.tabs.length > 0 ? agentTabKey(removedAgent.tabs[0]) : null),
    activeGoalId: nextActiveGoalId,
    activeNodeId: nextActiveNode,
    activeConversationId: nextActiveConv,
  }
}

/** 页签挂在哪个节点上；本地文件、网页与系统页（设置/用量/记忆/导师设置/新建目标）返回空串（不属于任何节点，删节点不该关掉它们）；工作区内部文件挂在它的节点上——节点没了，它的工作区文件也跟着没了，页签该一起关 */
function tabNodeIdOf(ref: TabRef): string {
  return ref.kind === 'local' ||
    ref.kind === 'web' ||
    ref.kind === 'settings' ||
    ref.kind === 'video' ||
    ref.kind === 'pluginDoc' ||
    ref.kind === 'usage' ||
    ref.kind === 'schedule' ||
    ref.kind === 'mind' ||
    ref.kind === 'agentSettings' ||
    ref.kind === 'blank' ||
    // 新建文件页签还没有落点：它不属于任何节点，删节点不该把它一起关掉
    ref.kind === 'draft'
    ? ''
    : ref.nodeId
}

/* ---------- 派生视图 ---------- */

export function goalProgress(
  store: LearnStore,
  rootId: string,
): { total: number; mastered: number; learning: number } {
  const seen = new Set<string>()
  const stack = [rootId]
  let mastered = 0
  let learning = 0
  while (stack.length) {
    const id = stack.pop() as string
    if (seen.has(id)) continue
    seen.add(id)
    const node = nodeById(store, id)
    if (!node) continue
    if (node.status === 'mastered') mastered++
    else if (node.status === 'learning') learning++
    for (const cid of prereqIds(store, id)) if (!seen.has(cid)) stack.push(cid)
  }
  return { total: seen.size, mastered, learning }
}
