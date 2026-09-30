import type { KnowledgeNode, LearnStore, SuperDocFile } from './types'
import { superDocsOf } from './types'
import { allocate } from './segments'
import { pruneDocReading, readingDocKey, readingOfGoal, withGoalReading } from './reading'

/**
 * 超级文档的纯逻辑：新建 / 覆盖 / 删除 / 找到，以及「名字怎么取才不撞车」。
 *
 * 与 learn/notes 同构（都是「一个节点多份、名字即身份」），但它是 Agent 那条路
 * 专用的：界面暂时没有新建/改名入口，超级文档由 api.sdoc.write 创建与更新，
 * 同名**覆盖**而不是让开——超级文档是「一份交互件」的多个版本，覆盖正是更新本身。
 * 撞名让路（笔记那套 allocate）在这里反而是错的：模型「写同一份」的两次调用
 * 会悄悄变成两份，调用它的按钮从此找不到函数。
 */

/** 没给名字时用的默认名 */
export const SUPERDOC_DEFAULT_NAME = '交互文档'

/** 超级文档的规模上限：一份 HTML 写到几十 KB 就该拆了， 别把 state.json 顶成大文件 */
export const SUPERDOC_MAX_CHARS = 120_000

/** 在已有超级文档里按名字找一份（大小写不敏感，理由同 learn/notes：Windows 磁盘不区分） */
export function findSuperDoc(docs: SuperDocFile[], name: string): SuperDocFile | undefined {
  const key = (name ?? '').trim().toLowerCase()
  if (!key) return undefined
  return docs.find((d) => d.name.toLowerCase() === key)
}

/** 分配一个不与现有超级文档撞车的名字（只在「指名读/删」之外的新建场景用） */
export function uniqueSuperDocName(docs: SuperDocFile[], raw: string): string {
  const used = new Set(docs.map((d) => d.name.toLowerCase()))
  return allocate((raw ?? '').trim() || SUPERDOC_DEFAULT_NAME, used)
}

/**
 * 写入（或新建）某节点的某一份超级文档：同名覆盖，没有就新建。
 * 返回新节点与最终名字；节点本身由调用方包装进 store。
 */
export function writeSuperDocIn(
  node: KnowledgeNode,
  rawName: string | undefined,
  html: string,
  at: number,
): { node: KnowledgeNode; name: string } {
  const list = superDocsOf(node)
  const name = (rawName ?? '').trim()
  const existing = name ? findSuperDoc(list, name) : undefined
  if (existing) {
    const next = { ...existing, html, updatedAt: at }
    return { node: { ...node, superdocs: list.map((d) => (d === existing ? next : d)), updatedAt: at }, name: existing.name }
  }
  const finalName = uniqueSuperDocName(list, name || SUPERDOC_DEFAULT_NAME)
  const doc: SuperDocFile = { name: finalName, html, createdAt: at, updatedAt: at }
  return { node: { ...node, superdocs: [...list, doc], updatedAt: at }, name: finalName }
}

/** 删掉一份超级文档；找不到就原样返回 */
export function removeSuperDocIn(node: KnowledgeNode, name: string, at: number): KnowledgeNode {
  const list = superDocsOf(node)
  const target = findSuperDoc(list, name)
  if (!target) return node
  return { ...node, superdocs: list.filter((d) => d !== target), updatedAt: at }
}

/* ---------- store 层的包装：这些操作要拿到整个 store 才能落到位 ---------- */

/** 读某节点的一份超级文档正文；节点或文档不存在时回 null */
export function readSuperDoc(store: LearnStore, nodeId: string, name: string): SuperDocFile | null {
  const node = store.nodes.find((n) => n.id === nodeId)
  if (!node) return null
  return findSuperDoc(superDocsOf(node), name) ?? null
}

/** 写入（或新建）：返回新 store；节点不在时返回 null（调用方据此报错） */
export function writeSuperDoc(
  store: LearnStore,
  nodeId: string,
  name: string | undefined,
  html: string,
): LearnStore | null {
  const at = Date.now()
  const node = store.nodes.find((n) => n.id === nodeId)
  if (!node) return null
  const r = writeSuperDocIn(node, name, html, at)
  return { ...store, nodes: store.nodes.map((n) => (n.id === nodeId ? r.node : n)) }
}

/** 删除：返回新 store；节点不在或那份本来就没有时原样返回 */
export function removeSuperDoc(store: LearnStore, nodeId: string, name: string): LearnStore {
  const node = store.nodes.find((n) => n.id === nodeId)
  if (!node) return store
  // 记录里的键用的是文档**真实**的名字（findSuperDoc 不区分大小写），先按它找到那一条
  const target = findSuperDoc(superDocsOf(node), name)
  const next = removeSuperDocIn(node, name, Date.now())
  if (next === node) return store
  /*
   * 它那份阅读记录也一起清掉：文档没了，sdoc:名字 就再也没人认领了（见 learn/reading 的 pruneDocReading）。
   * 清的是**这个节点所属目标**的那一本账（阅读按目标分开，见 ReadingBook）。
   */
  const book = readingOfGoal(store.reading, node.goalId)
  const reading = book && target ? pruneDocReading(book, nodeId, readingDocKey('sdoc', target.name)) : undefined
  return {
    ...store,
    ...(reading ? { reading: withGoalReading(store.reading, node.goalId, reading) } : {}),
    nodes: store.nodes.map((n) => (n.id === nodeId ? next : n)),
  }
}
