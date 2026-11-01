/**
 * 本文件负责：依赖边（前置 / 父节点）的查询与增删——解锁判断、拓扑路径、环检测。
 */
import type { DependencyEdge, KnowledgeNode, LearnStore } from '../types'
import { nodeById } from './lookup'

/**
 * 邻接索引：`from → to`（前置）与 `to → from`（父）两个方向各一张表。
 *
 * 原来 `prereqIds` / `parentIds` 每次调用都 `store.edges.filter(...)` 扫全表，
 * 而它们在渲染、铺排、保存里被反复调用。索引挂在**边数组的引用**上（`WeakMap`）：
 * store 不可变，引用就是版本号，引用没变索引一定还对，引用变了旧索引跟着回收。
 *
 * 返回的是**缓存数组本身**，调用方只读、不要原地改（`sort`/`push` 会污染别的调用方）。
 */
interface Adjacency {
  out: Map<string, string[]>
  in: Map<string, string[]>
}

const adjacencyCache = new WeakMap<readonly DependencyEdge[], Adjacency>()

function adjacency(edges: readonly DependencyEdge[]): Adjacency {
  let index = adjacencyCache.get(edges)
  if (index) return index
  const out = new Map<string, string[]>()
  const inn = new Map<string, string[]>()
  for (const e of edges) {
    const o = out.get(e.from)
    if (o) o.push(e.to)
    else out.set(e.from, [e.to])
    const i = inn.get(e.to)
    if (i) i.push(e.from)
    else inn.set(e.to, [e.from])
  }
  index = { out, in: inn }
  adjacencyCache.set(edges, index)
  return index
}

/** 前置节点（下层）：沿 from → to。返回的是树成员 id（文档 id 或 `o:` 大纲 uuid） */
export function prereqIds(store: LearnStore, id: string): string[] {
  return adjacency(store.edges).out.get(id) ?? []
}

/**
 * 父节点（上层）：沿 to → from。查询 id 是文档时**两种拼法都认**（接文档卡的边
 * to = 文档 id；嵌套接大纲卡的边 to = `o:{文档id}`）。from 侧解析成文档 id——
 * 附身大纲那一层的边本来就以宿主文档 id 发声；游离大纲（`o:` 发声）没有文档，
 * 对「父文档」而言是透明的分类层，跳过。
 */
export function parentIds(store: LearnStore, id: string): string[] {
  const inn = adjacency(store.edges).in
  const direct = inn.get(id) ?? []
  const nested = inn.get('o:' + id) ?? []
  const out: string[] = []
  for (const from of [...direct, ...nested]) {
    const docId = docIdOfMember(store, from)
    if (docId && !out.includes(docId)) out.push(docId)
  }
  return out
}

/**
 * 树成员 id → 文档 id：文档原样返回；`o:{附身大纲}` 解析出宿主文档；`o:{游离大纲}`
 * 没有文档，返回 null（调用方据此把它当透明的分类层跳过）。
 */
export function docIdOfMember(store: LearnStore, member: string): string | null {
  if (!member.startsWith('o:')) {
    if ((store.videoNodes ?? []).some((v) => v.id === member)) return null
    return member
  }
  const raw = member.slice(2)
  return store.nodes.some((n) => n.id === raw) ? raw : null
}

export function isUnlocked(store: LearnStore, id: string): boolean {
  const prereqs = prereqIds(store, id)
  if (!prereqs.length) return true
  return prereqs.every((pid) => {
    const docId = docIdOfMember(store, pid)
    return !docId || nodeById(store, docId)?.status === 'mastered'
  })
}

export function unmetPrereqs(store: LearnStore, id: string): KnowledgeNode[] {
  return prereqIds(store, id)
    .map((pid) => {
      const docId = docIdOfMember(store, pid)
      return docId ? nodeById(store, docId) : undefined
    })
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

/** 树成员存在性：文档 = 节点在；`o:` = 附身大纲（节点带着大纲在）或游离大纲（实体在）；
 *  视频节点 / 项目节点 = 各自实体池里有那一行（挂载边两端的合法成员，见 learn/nodeKinds） */
function memberExists(store: LearnStore, member: string): boolean {
  if (!member.startsWith('o:')) {
    return (
      !!nodeById(store, member) ||
      (store.videoNodes ?? []).some((v) => v.id === member) ||
      (store.projects ?? []).some((p) => p.id === member)
    )
  }
  const raw = member.slice(2)
  return !!nodeById(store, raw)?.outline || (store.outlines ?? []).some((o) => o.id === raw)
}

/** 新增依赖边 from → to（两端都是树成员 id，见 DependencyEdge）；自环、重复、成环一律拒绝 */
export function addEdge(
  store: LearnStore,
  from: string,
  to: string,
  portKey?: string,
): { store: LearnStore; added: boolean; reason?: string } {
  if (from === to || !memberExists(store, from) || !memberExists(store, to)) return { store, added: false }
  if (store.edges.some((e) => e.from === from && e.to === to)) return { store, added: false }
  if (wouldCreateCycle(store, from, to)) return { store, added: false }
  // 一个接口只认领一个下游：同一条上游上，portKey 已被别的下游占了就拒绝（带上原因，别让调用方猜）
  if (portKey && store.edges.some((e) => e.from === from && e.portKey === portKey && e.to !== to)) {
    return { store, added: false, reason: '接口「' + portKey + '」已经被另一个下游认领了（一个接口只认领一个下游）' }
  }
  const edge: DependencyEdge = { from, to, createdAt: Date.now(), ...(portKey ? { portKey } : {}) }
  return { store: { ...store, edges: [...store.edges, edge] }, added: true }
}

/**
 * 摘掉一条依赖边 from → to（大纲节点 disconnect 的落点：拆掉一条父线）。
 * 摘掉的文档变成「没有上游的游离文档」——不再连带删除任何东西（删节点才是删除，摘线只是解开）。
 */
export function removeEdge(store: LearnStore, from: string, to: string): LearnStore {
  return { ...store, edges: store.edges.filter((e) => !(e.from === from && e.to === to)) }
}


