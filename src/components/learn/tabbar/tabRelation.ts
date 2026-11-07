/*
 * 这个文件负责：页签与页签之间的**知识图谱关系**——沿 store.edges 算两个节点的
 * 最短拓扑距离，再据此给一枚页签定性（父级 / 子级 / 同节点 / 无关）。
 *
 * 吃这份结果的有两处：页签上的折角图标与悬停说明（TabStrip 的 TabItem）、
 * 右键菜单里的「关闭父级 / 子级 / 无关联」（TabBarMenu）。纯函数、无 React；
 * 两次 BFS 的结果按 edges + 基准节点缓存（WeakMap），菜单与栏共用一份。
 */

import type { DependencyEdge, LearnStore, LearnTab, TabRef } from '../../../learn/types'
import { tabNodeId } from '../../../learn/tabs'

/**
 * 沿 store.edges 的有向边计算从 fromNodeId 到 toNodeId 的最短拓扑距离。
 * edge.from 为父级（上位节点），edge.to 为子级（下位节点）。
 * 相邻父子为 1，爷孙为 2，曾祖孙为 3，以此类推；若不可达则返回 null。
 */
export function directedDistance(
  store: LearnStore,
  fromNodeId: string,
  toNodeId: string,
): number | null {
  if (fromNodeId === toNodeId) return 0
  if (!store.edges || !store.edges.length) return null

  // 建立邻接表索引，避免在 BFS 的每一步线性扫描全图边集
  const adj = new Map<string, string[]>()
  for (const edge of store.edges) {
    let list = adj.get(edge.from)
    if (!list) {
      list = []
      adj.set(edge.from, list)
    }
    list.push(edge.to)
  }

  const visited = new Set<string>([fromNodeId])
  const queue: Array<[string, number]> = [[fromNodeId, 0]]

  while (queue.length > 0) {
    const [current, dist] = queue.shift()!
    const neighbors = adj.get(current)
    if (!neighbors) continue
    for (const next of neighbors) {
      if (next === toNodeId) {
        return dist + 1
      }
      if (!visited.has(next)) {
        visited.add(next)
        queue.push([next, dist + 1])
      }
    }
  }

  return null
}

export type TabRelationKind = 'none' | 'parent' | 'child' | 'same-node'

export interface TabRelation {
  kind: TabRelationKind
  depth: number
}

export function isTeachDocTab(ref: TabRef): boolean {
  return ref.kind === 'teach' || (ref.kind as string) === 'doc'
}

/**
 * 一次性计算基准节点与知识图谱中所有节点的拓扑关系距离。
 * 使用正向和反向邻接表各执行一次单源 BFS，时间复杂度 O(V + E)，避免对 N 个页签重复进行 2*N 次全图遍历。
 */
const distanceMapsCache = new WeakMap<
  readonly DependencyEdge[],
  Map<string, { ancestorDistMap: Map<string, number>; descendantDistMap: Map<string, number> }>
>()

export function buildDirectedDistanceMaps(
  edges: readonly DependencyEdge[] | null | undefined,
  baseNodeId: string | null | undefined,
): { ancestorDistMap: Map<string, number>; descendantDistMap: Map<string, number> } {
  const empty = { ancestorDistMap: new Map<string, number>(), descendantDistMap: new Map<string, number>() }
  if (!baseNodeId || !edges || edges.length === 0) {
    return empty
  }

  let nodeCache = distanceMapsCache.get(edges)
  if (!nodeCache) {
    nodeCache = new Map()
    distanceMapsCache.set(edges, nodeCache)
  }
  const cached = nodeCache.get(baseNodeId)
  if (cached) return cached

  const ancestorDistMap = new Map<string, number>()
  const descendantDistMap = new Map<string, number>()

  const forwardAdj = new Map<string, string[]>()
  const reverseAdj = new Map<string, string[]>()
  for (const edge of edges) {
    let fList = forwardAdj.get(edge.from)
    if (!fList) {
      fList = []
      forwardAdj.set(edge.from, fList)
    }
    fList.push(edge.to)

    let rList = reverseAdj.get(edge.to)
    if (!rList) {
      rList = []
      reverseAdj.set(edge.to, rList)
    }
    rList.push(edge.from)
  }

  // 1. 正向 BFS：从 baseNodeId 往下找子代（descendant）
  const descQueue: Array<[string, number]> = [[baseNodeId, 0]]
  const descVisited = new Set<string>([baseNodeId])
  while (descQueue.length > 0) {
    const [curr, d] = descQueue.shift()!
    if (d > 0) descendantDistMap.set(curr, d)
    const nexts = forwardAdj.get(curr)
    if (nexts) {
      for (const next of nexts) {
        if (!descVisited.has(next)) {
          descVisited.add(next)
          descQueue.push([next, d + 1])
        }
      }
    }
  }

  // 2. 反向 BFS：从 baseNodeId 往上找祖先（ancestor）
  const ancQueue: Array<[string, number]> = [[baseNodeId, 0]]
  const ancVisited = new Set<string>([baseNodeId])
  while (ancQueue.length > 0) {
    const [curr, d] = ancQueue.shift()!
    if (d > 0) ancestorDistMap.set(curr, d)
    const prevs = reverseAdj.get(curr)
    if (prevs) {
      for (const prev of prevs) {
        if (!ancVisited.has(prev)) {
          ancVisited.add(prev)
          ancQueue.push([prev, d + 1])
        }
      }
    }
  }

  const result = { ancestorDistMap, descendantDistMap }
  nodeCache.set(baseNodeId, result)
  return result
}

export function computeTabRelationWithMaps(
  targetTab: LearnTab,
  baseTab: LearnTab | null,
  ancestorDistMap: Map<string, number>,
  descendantDistMap: Map<string, number>,
): TabRelation {
  if (!baseTab || targetTab.id === baseTab.id) return { kind: 'none', depth: 0 }

  const bNodeId = tabNodeId(baseTab.ref)
  const tNodeId = tabNodeId(targetTab.ref)
  if (!bNodeId || !tNodeId) return { kind: 'none', depth: 0 }

  // 同一节点的外围页签（如大纲、笔记、试卷记录、超级文档等）
  if (tNodeId === bNodeId) {
    return { kind: 'same-node', depth: 0 }
  }

  // 跨节点箭头与层级仅适用于教学文档（TabRef 中的 kind === 'teach'）
  if (!isTeachDocTab(targetTab.ref)) {
    return { kind: 'none', depth: 0 }
  }

  const ancDist = ancestorDistMap.get(tNodeId)
  if (ancDist !== undefined && ancDist > 0) {
    return { kind: 'parent', depth: Math.min(ancDist, 4) }
  }

  const descDist = descendantDistMap.get(tNodeId)
  if (descDist !== undefined && descDist > 0) {
    return { kind: 'child', depth: Math.min(descDist, 4) }
  }

  return { kind: 'none', depth: 0 }
}

export function computeTabRelation(
  targetTab: LearnTab,
  baseTab: LearnTab | null,
  store: LearnStore | null | undefined,
): TabRelation {
  if (!baseTab || !store || targetTab.id === baseTab.id) return { kind: 'none', depth: 0 }

  const bNodeId = tabNodeId(baseTab.ref)
  const tNodeId = tabNodeId(targetTab.ref)
  if (!bNodeId || !tNodeId) return { kind: 'none', depth: 0 }

  // 同一节点的外围页签（如大纲、笔记、试卷记录、超级文档等）
  if (tNodeId === bNodeId) {
    return { kind: 'same-node', depth: 0 }
  }

  // 跨节点箭头与层级仅适用于教学文档（TabRef 中的 kind === 'teach'）
  if (!isTeachDocTab(targetTab.ref)) {
    return { kind: 'none', depth: 0 }
  }

  // 上位节点（父级、爷级、曾祖等）：沿 edges 存在从 tNodeId 到 bNodeId 的路径
  const ancestorDist = directedDistance(store, tNodeId, bNodeId)
  if (ancestorDist !== null && ancestorDist > 0) {
    return { kind: 'parent', depth: Math.min(ancestorDist, 4) }
  }

  // 下位节点（子级、孙级、曾孙等）：沿 edges 存在从 bNodeId 到 tNodeId 的路径
  const descendantDist = directedDistance(store, bNodeId, tNodeId)
  if (descendantDist !== null && descendantDist > 0) {
    return { kind: 'child', depth: Math.min(descendantDist, 4) }
  }

  return { kind: 'none', depth: 0 }
}
