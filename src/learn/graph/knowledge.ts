/**
 * 目标级知识库操作函数：
 * 在整个学习目标下共享知识条目，支持创建、更新、删除与查询。
 */

import type { GoalKnowledgeItem } from '../types/knowledge'
import type { LearnStore } from '../types'

/** 查目标的知识库条目列表 */
export function getGoalKnowledge(store: LearnStore, goalId: string): GoalKnowledgeItem[] {
  return store.knowledge?.[goalId] ?? []
}

/** 为目标添加或更新一条知识库词条 */
export function addGoalKnowledge(
  store: LearnStore,
  goalId: string,
  term: string,
  summary: string,
  sourceNodeId?: string,
): LearnStore {
  const cleanTerm = term.trim()
  if (!cleanTerm || !goalId) return store

  const now = Date.now()
  const prevItems = store.knowledge?.[goalId] ?? []
  const idx = prevItems.findIndex((it) => it.term === cleanTerm)

  let nextItems: GoalKnowledgeItem[]
  if (idx >= 0) {
    const existing = prevItems[idx]
    const updated: GoalKnowledgeItem = {
      ...existing,
      summary,
      updatedAt: now,
      ...(sourceNodeId ? { sourceNodeId } : {}),
    }
    nextItems = [...prevItems]
    nextItems[idx] = updated
  } else {
    const newItem: GoalKnowledgeItem = {
      id: `k_${now}_${Math.random().toString(36).slice(2, 7)}`,
      term: cleanTerm,
      summary,
      sourceNodeId,
      createdAt: now,
    }
    nextItems = [...prevItems, newItem]
  }

  return {
    ...store,
    knowledge: {
      ...(store.knowledge ?? {}),
      [goalId]: nextItems,
    },
  }
}

/** 从目标知识库中移除某条词条（按 id 或 term 匹配） */
export function removeGoalKnowledge(
  store: LearnStore,
  goalId: string,
  termOrId: string,
): LearnStore {
  if (!goalId || !termOrId) return store
  const prevItems = store.knowledge?.[goalId]
  if (!prevItems || prevItems.length === 0) return store

  const target = termOrId.trim()
  const nextItems = prevItems.filter((it) => it.id !== target && it.term !== target)
  if (nextItems.length === prevItems.length) return store

  return {
    ...store,
    knowledge: {
      ...(store.knowledge ?? {}),
      [goalId]: nextItems,
    },
  }
}

/** 将知识库条目列表序列化为 JSON 文本 */
export function serializeGoalKnowledge(items: GoalKnowledgeItem[]): string {
  return JSON.stringify({ version: 1, items }, null, 2)
}

/** 从 JSON 文本解析知识库条目列表 */
export function parseGoalKnowledge(raw: string | null | undefined): GoalKnowledgeItem[] {
  if (!raw) return []
  try {
    const data = JSON.parse(raw)
    const list = Array.isArray(data) ? data : data?.items
    if (!Array.isArray(list)) return []
    return list.filter(
      (k): k is GoalKnowledgeItem =>
        !!k && typeof k === 'object' && typeof k.term === 'string' && typeof k.summary === 'string',
    )
  } catch {
    return []
  }
}
