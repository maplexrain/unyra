/**
 * 本文件负责：依赖边（前置 / 父节点）的查询与增删——解锁判断、拓扑路径、环检测。
 */
import type { DependencyEdge, KnowledgeNode, LearnStore } from '../types'
import { nodeById } from './lookup'

/** 前置节点（下层）：沿 from → to */
export function prereqIds(store: LearnStore, id: string): string[] {
  return store.edges.filter((e) => e.from === id).map((e) => e.to)
}

/** 父节点（上层）：沿 to → from */
export function parentIds(store: LearnStore, id: string): string[] {
  return store.edges.filter((e) => e.to === id).map((e) => e.from)
}

export function isUnlocked(store: LearnStore, id: string): boolean {
  const prereqs = prereqIds(store, id)
  if (!prereqs.length) return true
  return prereqs.every((pid) => nodeById(store, pid)?.status === 'mastered')
}

export function unmetPrereqs(store: LearnStore, id: string): KnowledgeNode[] {
  return prereqIds(store, id)
    .map((pid) => nodeById(store, pid))
    .filter((n): n is KnowledgeNode => !!n && n.status !== 'mastered')
}

/** 沿 from → to 判断 src 能否到达 dst（环检测用） */
function reachable(edges: DependencyEdge[], src: string, dst: string): boolean {
  const out = new Map<string, string[]>()
  for (const e of edges) {
    const list = out.get(e.from)
    if (list) list.push(e.to)
    else out.set(e.from, [e.to])
  }
  const seen = new Set<string>([src])
  const stack = [src]
  while (stack.length) {
    const cur = stack.pop() as string
    for (const next of out.get(cur) ?? []) {
      if (next === dst) return true
      if (!seen.has(next)) {
        seen.add(next)
        stack.push(next)
      }
    }
  }
  return false
}

export function wouldCreateCycle(store: LearnStore, from: string, to: string): boolean {
  if (from === to) return true
  return reachable(store.edges, to, from)
}

/**
 * 从 nodeId 向上到 rootId 的一条最短路径，返回 [root, …, node]；无路径返回 null。
 * 回溯面包屑据此生成。
 */
export function pathToRoot(store: LearnStore, rootId: string, nodeId: string): string[] | null {
  if (nodeId === rootId) return [rootId]
  const visited = new Set<string>([nodeId])
  let frontier: string[][] = [[nodeId]]
  while (frontier.length) {
    const next: string[][] = []
    for (const path of frontier) {
      const last = path[path.length - 1]
      for (const pid of parentIds(store, last)) {
        if (pid === rootId) return [rootId, ...path.slice().reverse()]
        if (!visited.has(pid)) {
          visited.add(pid)
          next.push([...path, pid])
        }
      }
    }
    frontier = next
  }
  return null
}

/** 最近的可回溯父节点：前置已就绪、且自身尚未掌握 */
export function backtrackTargets(store: LearnStore, id: string): KnowledgeNode[] {
  return parentIds(store, id)
    .map((pid) => nodeById(store, pid))
    .filter((n): n is KnowledgeNode => !!n && n.status !== 'mastered' && isUnlocked(store, n.id))
}

/** 新增依赖边 from → to；自环、重复、成环一律拒绝 */
export function addEdge(store: LearnStore, from: string, to: string): { store: LearnStore; added: boolean } {
  if (from === to || !nodeById(store, from) || !nodeById(store, to)) return { store, added: false }
  if (store.edges.some((e) => e.from === from && e.to === to)) return { store, added: false }
  if (wouldCreateCycle(store, from, to)) return { store, added: false }
  const edge: DependencyEdge = { from, to, createdAt: Date.now() }
  return { store: { ...store, edges: [...store.edges, edge] }, added: true }
}

