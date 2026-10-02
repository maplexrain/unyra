/** 构造与合并：新建目标 / 会话，以及导入备份时把两份数据并起来（makeGoal / makeConversation / mergeLearnStore）。 */

import type { Conversation, LearningGoal, LearnStore, MasteryStatus, TmpStore } from '../types'
import type { StaticResource } from '../static'
import { emptyDocs } from '../groups'
import { pruneTmpToNodes } from '../../lib/tmpStore'

export const STATUSES: MasteryStatus[] = ['learning', 'mastered']

export const ATTEMPT_STATUSES = ['ongoing', 'submitted', 'graded', 'abandoned']

export function makeGoal(rootNodeId: string, question: string, id?: string): LearningGoal {
  const now = Date.now()
  return { id: id ?? crypto.randomUUID(), rootNodeId, question, createdAt: now, updatedAt: now }
}

export function makeConversation(goalId: string): Conversation {
  const now = Date.now()
  return { id: crypto.randomUUID(), goalId, messages: [], createdAt: now, updatedAt: now }
}

/** 合并导入：节点按 id 覆盖/新增，边按 from-to 去重，目标/会话按 id 去重 */
export function mergeLearnStore(base: LearnStore, incoming: LearnStore): LearnStore {
  const nodeMap = new Map(base.nodes.map((n) => [n.id, n]))
  for (const n of incoming.nodes) nodeMap.set(n.id, n)

  const edgeKeys = new Set(base.edges.map((e) => `${e.from}\u0001${e.to}`))
  const edges = [...base.edges]
  for (const e of incoming.edges) {
    const k = `${e.from}\u0001${e.to}`
    if (!edgeKeys.has(k)) {
      edgeKeys.add(k)
      edges.push(e)
    }
  }

  const goalIds = new Set(base.goals.map((g) => g.id))
  const goals = [...base.goals]
  for (const g of incoming.goals) {
    if (!goalIds.has(g.id)) {
      goalIds.add(g.id)
      goals.push(g)
    }
  }

  // 按会话 id 去重：一个目标可以挂多个会话，按目标去重会把其余的丢掉
  const convIds = new Set(base.conversations.map((c) => c.id))
  const conversations = [...base.conversations]
  for (const c of incoming.conversations) {
    if (!convIds.has(c.id) && goalIds.has(c.goalId)) {
      convIds.add(c.id)
      conversations.push(c)
    }
  }

  const examIds = new Set(base.exams.map((e) => e.id))
  const exams = [...base.exams]
  for (const e of incoming.exams) {
    if (!examIds.has(e.id) && nodeMap.has(e.nodeId)) {
      examIds.add(e.id)
      exams.push(e)
    }
  }

  // 导入的那份临时变量并进来；同一个节点下后者覆盖前者
  const tmp: TmpStore = { ...base.tmp }
  for (const [nodeId, bucket] of Object.entries(incoming.tmp ?? {})) {
    const merged = { ...(tmp[nodeId] ?? {}), ...bucket }
    if (nodeMap.has(nodeId) && Object.keys(merged).length) tmp[nodeId] = merged
  }

  // 资源清单按目标并：uuid 全局唯一，撞上就是同一份文件，后者覆盖前者
  const resources: Record<string, StaticResource[]> = { ...(base.resources ?? {}) }
  for (const [goalId, list] of Object.entries(incoming.resources ?? {})) {
    if (!goalIds.has(goalId)) continue
    const byUuid = new Map((resources[goalId] ?? []).map((r) => [r.uuid, r]))
    for (const r of list) byUuid.set(r.uuid, r)
    resources[goalId] = [...byUuid.values()]
  }

  return {
    version: 2,
    nodes: [...nodeMap.values()],
    edges,
    goals,
    conversations,
    exams,
    tmp: pruneTmpToNodes(tmp, new Set(nodeMap.keys())),
    resources,
    activeGoalId: base.activeGoalId ?? goals[0]?.id ?? null,
    activeNodeId: base.activeNodeId ?? null,
    activeConversationId: base.activeConversationId ?? null,
    // 界面状态取**当前这一份**：导入别人的备份不该把「我开着哪几个文档、怎么分屏的」也换掉
    docArea: base.docArea ?? emptyDocs(),
    // 暂存区同理：没保存的正文是这台机器上的动作，不跟着别人的备份走
    drafts: base.drafts ?? {},
    // 读到哪儿了同样属于「这台机器上的动作」：导入别人的备份不该把阅读位置也换掉
    docScroll: base.docScroll ?? {},
    localFiles: base.localFiles ?? [],
    // 收藏夹同理：「我收藏了什么」是这台机器上的动作，不跟着别人的备份走
    favorites: base.favorites ?? [],
    /*
     * 记忆、函数库、工作流登记、阅读记录、打卡、番茄钟：**一律以「我这一份」为准**
     * （阅读与打卡是按目标的账，同样整本以我这份为准）。
     *
     * 与页签、暂存区同一条道理——它们是「我做过什么、我和导师之间定下过什么」，
     * 导入一份别人的备份不该把它们换掉，更不该让它们凭空消失（早先这里是「一个都不带」，
     * 于是导入一次就把自己这些数据抹了）。
     */
    minds: base.minds,
    methods: base.methods,
    workflows: base.workflows,
    reading: base.reading,
    checkin: base.checkin,
    pomodoro: base.pomodoro,
  }
}
