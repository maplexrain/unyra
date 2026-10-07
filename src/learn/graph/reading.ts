/**
 * 本文件负责：以「目标」为单位的那本阅读账——改笔记名 / 删笔记 / 删节点时按节点找回所属目标再清账，
 * 删目标时把阅读与打卡两本账一起摘掉；以及目标进度这一派生视图。
 *
 * goalProgress 不读阅读账，放这里是因为它与 deleteGoal 同属「以目标为单位」的操作，
 * 且只依赖节点查表与前置边。
 */
import type { LearnStore, TabRef } from '../types'
import { withoutTmpNodes } from '../../lib/tmpStore'
import { allTabs, closeIds } from '../groups'
import { dropDrafts } from '../drafts'
import { readingOfGoal, withGoalReading, type ReadingStore } from '../reading'
import { nodeById } from './lookup'
import { prereqIds } from './edges'
import { latestConversation } from './conversations'

/* ---------- 阅读这一本账：动它之前先找到「是哪个目标」 ---------- */

/**
 * 对**某个节点所属目标**的那本阅读账做一次变换。
 *
 * 阅读按目标分开（见 learn/reading 的 ReadingBook），而改笔记名、删笔记、删节点
 * 这些动作只知道节点 id——节点属于哪个目标得在这里查一次。没有那本账（还没读过）
 * 就原样返回：没记录可动，也没必要凭空建一本空账。
 */
export function onNodeReading(store: LearnStore, nodeId: string, fn: (rec: ReadingStore) => ReadingStore): LearnStore {
  const goalId = nodeById(store, nodeId)?.goalId ?? ''
  const rec = readingOfGoal(store.reading, goalId)
  if (!goalId || !rec) return store
  return { ...store, reading: withGoalReading(store.reading, goalId, fn(rec)) }
}

/** 同上，但给展开写法用（返回要并进 store 的那一项；没有账时返回空对象） */
export function onNodeReadingPatch(
  store: LearnStore,
  node: { goalId: string } | undefined,
  fn: (rec: ReadingStore) => ReadingStore,
): Partial<LearnStore> {
  const goalId = node?.goalId ?? ''
  const rec = readingOfGoal(store.reading, goalId)
  if (!goalId || !rec) return {}
  return { reading: withGoalReading(store.reading, goalId, fn(rec)) }
}

/** 目标没了：阅读与打卡两本账一起摘掉（见 deleteGoal） */
function withoutGoalReading(store: LearnStore, goalId: string): Partial<LearnStore> {
  const reading = { ...(store.reading?.byGoal ?? {}) }
  const checkin = { ...(store.checkin?.byGoal ?? {}) }
  delete reading[goalId]
  delete checkin[goalId]
  return { reading: { byGoal: reading }, checkin: { byGoal: checkin } }
}

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
  const doomed = new Set<string>()
  const stack = [goal.rootNodeId]
  while (stack.length) {
    const id = stack.pop() as string
    if (doomed.has(id)) continue
    doomed.add(id)
    for (const c of prereqIds(store, id)) stack.push(c)
  }
  return new Set(store.nodes.filter((n) => doomed.has(n.id) && n.goalId === goalId).map((n) => n.id))
}

/** 删除目标：移除其根可达的整棵子树、相关边与会话 */
export function deleteGoal(store: LearnStore, goalId: string): LearnStore {
  const goal = store.goals.find((g) => g.id === goalId)
  if (!goal) return store
  const removed = goalSubtreeIds(store, goalId)
  const goals = store.goals.filter((g) => g.id !== goalId)
  const nodes = store.nodes.filter((n) => !removed.has(n.id))
  const nextActiveNode =
    store.activeNodeId && removed.has(store.activeNodeId)
      ? (goals[0]?.rootNodeId ?? null)
      : store.activeNodeId
  // 目标没了，它那份上下文才跟着消失；换到别的目标时回落到那个目标的最近会话
  const nextActiveGoalId = store.activeGoalId === goalId ? (goals[0]?.id ?? null) : store.activeGoalId
  const remaining = store.conversations.filter((c) => c.goalId !== goalId)
  const nextActiveConv =
    remaining.find((c) => c.id === store.activeConversationId)?.id ??
    (nextActiveGoalId ? latestConversation({ ...store, conversations: remaining }, nextActiveGoalId)?.id : null) ??
    null
  // 整棵子树都没了：它的节点文档页签、笔记页签一并关掉（与 deleteNode 同一条规则）；
  // 记忆页签挂在目标上（不挂节点，tabNodeIdOf 够不着它），目标没了也得一起关
  const doomedTabs = allTabs(store.docArea)
    .filter((t) => removed.has(tabNodeIdOf(t.ref)) || (t.ref.kind === 'mind' && t.ref.goalId === goalId))
    .map((t) => t.id)
  return {
    ...store,
    goals,
    nodes,
    /*
     * 阅读与打卡这两本账**跟着目标一起走**（见 learn/reading 的 ReadingBook）：
     * 目标都没了，它的账不该还留在内存里，也不该继续写在数据目录里——两本一起摘掉。
     */
    ...withoutGoalReading(store, goalId),
    edges: store.edges.filter((e) => !removed.has(e.from) && !removed.has(e.to)),
    conversations: remaining,
    exams: store.exams.filter((e) => !removed.has(e.nodeId)),
    tmp: withoutTmpNodes(store.tmp, removed),
    docArea: closeIds(store.docArea, doomedTabs),
    drafts: dropDrafts(store.drafts, doomedTabs),
    activeGoalId: nextActiveGoalId,
    activeNodeId: nextActiveNode,
    activeConversationId: nextActiveConv,
  }
}

/** 页签挂在哪个节点上；本地文件、网页、守卫、报告与系统页（设置/用量/记忆/导师设置）返回空串（不属于任何节点，删节点不该关掉它们） */
function tabNodeIdOf(ref: TabRef): string {
  return ref.kind === 'local' ||
    ref.kind === 'web' ||
    ref.kind === 'guard' ||
    ref.kind === 'report' ||
    ref.kind === 'settings' ||
    ref.kind === 'usage' ||
    ref.kind === 'mind' ||
    ref.kind === 'agentSettings'
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
