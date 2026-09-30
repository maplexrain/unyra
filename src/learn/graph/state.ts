/**
 * 本文件负责：把学习状态（掌握度 / 错题 / 检验时间线）写进节点，以及节点在图上的
 * 「结构位次」（NodeStructure）这一派生形状。变换本身在 learn/learning，这里只负责找节点。
 */
import type { CheckRecord, LearningState, LearnStore, MasteryStatus, MistakeRecord } from '../types'
import { withCheck, withLearning, withMistake } from '../learning'
import { ensureReviewPlan } from '../review'
import { nodeById } from './lookup'
import { parentIds, prereqIds } from './edges'
import { knowledgeDepth, replaceNode, updateNode } from './nodes'

export function setNodeStatus(store: LearnStore, id: string, status: MasteryStatus): LearnStore {
  const next = updateNode(store, id, { status })
  /*
   * 状态首次变为「已掌握」：系统在这里给节点建复习计划（见 learn/review）。
   * 钩子放系统侧而不是导师那边——确定性的转变不经过模型，且必须幂等（重复置为
   * mastered 不能重建计划）。学习到一半的计划 ensureReviewPlan 自己会避开。
   */
  if (status === 'mastered') return ensureReviewPlan(next, id, Date.now())
  return next
}

/* ---------- 学习状态（见 learn/learning） ---------- */

/** 把学习状态合进节点。变换本身在 learning.ts 里（纯函数、可单独测），这里只负责找到节点 */
export function updateLearning(store: LearnStore, id: string, patch: Partial<LearningState>): LearnStore {
  const node = nodeById(store, id)
  if (!node) return store
  return replaceNode(store, withLearning(node, patch))
}

/** 记一次错误；返回新的 store 与那条记录（调用方要拿它回话给模型） */
export function noteMistake(
  store: LearnStore,
  id: string,
  input: { pattern: string; cause?: string; count?: number },
): { store: LearnStore; record: MistakeRecord; fresh: boolean } | null {
  const node = nodeById(store, id)
  if (!node) return null
  const r = withMistake(node, input)
  return { store: replaceNode(store, r.node), record: r.record, fresh: r.fresh }
}

/** 追加一次检验（探针 / 考试 / 回忆），可同时带上这一次给出的掌握度 */
export function addCheck(
  store: LearnStore,
  id: string,
  check: CheckRecord,
  patch?: { mastery?: number; masteryNote?: string },
): LearnStore {
  const node = nodeById(store, id)
  if (!node) return store
  return replaceNode(store, withLearning(withCheck(node, check), patch ?? {}))
}

/**
 * 一个节点在学习状态上的「结构位次」。
 *
 * 单独导出这个类型是给那块面板用的：学习状态面板不持有 store，它拿到的是宿主算好的
 * 这一小份（而不是整个 store），因此这个形状必须是可命名的。
 */
export interface NodeStructure {
  depth: number
  prereqs: string[]
  parents: string[]
}

/** 一个节点在学习状态上的「结构位次」，供提示词与状态面板展示 */
export function nodeStructure(store: LearnStore, id: string): NodeStructure {
  const name = (nid: string): string | null => nodeById(store, nid)?.title ?? null
  return {
    depth: knowledgeDepth(store, id),
    prereqs: prereqIds(store, id).map(name).filter((t): t is string => !!t),
    parents: parentIds(store, id).map(name).filter((t): t is string => !!t),
  }
}

