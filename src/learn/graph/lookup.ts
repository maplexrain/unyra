/**
 * 本文件负责：按 id 取节点 / 取目标这两个最小的查表函数。
 *
 * 单独成一个文件是为了切掉 nodes ↔ edges 的循环依赖：节点那边要用 edges 的边查询，
 * 而 edges 的 isUnlocked / unmetPrereqs / backtrackTargets 又要按 id 找节点。两边都要读的
 * 这两个小函数因此独立出来——谁都可以依赖它，它不依赖谁。
 */
import type { KnowledgeNode, LearnStore } from '../types'

export function nodeById(store: LearnStore, id: string): KnowledgeNode | undefined {
  return store.nodes.find((n) => n.id === id)
}

export function goalById(store: LearnStore, id: string | null): LearnStore['goals'][number] | undefined {
  return id ? store.goals.find((g) => g.id === id) : undefined
}

