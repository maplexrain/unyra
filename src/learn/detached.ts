/**
 * 游离挂件池（learn/detached）：剪线不删内容的落点。
 *
 * 用户定的模型：节点都是独立实体，连线只是关系。笔记与超级文档的实体存在宿主文档
 * 的记录里——「解绑」就是把实体挪进这个池子（内容原样、id 不变），「绑定 / 换绑」
 * 就是把它挪出去挂到（另一份）文档之下。试卷不走池子：它的账本本来就是 store 级的
 * exams，宿主 id 悬空（指向已不在的节点）即是游离，绑定 = 把 id 指回去。
 *
 * 池子按目标归档（LearnStore.detached），落盘在各目标目录的 detached.json。
 */
import { nodeById } from './graph'
import { notesOf, uniqueNoteName } from './notes'
import { superDocsOf, type DetachedPool, type LearnStore, type NoteFile, type SuperDocFile } from './types'

export const emptyPool = (): DetachedPool => ({ notes: [], superdocs: [] })

/** 某个目标的池子（没有就给空池；调用方不持有它——写入走这几个函数） */
export function detachedPoolOf(store: LearnStore, goalId: string): DetachedPool {
  return store.detached?.[goalId] ?? emptyPool()
}

/** 把某个目标的池子写回 store（空池也照写——清空场景用得上） */
export function withDetached(store: LearnStore, goalId: string, pool: DetachedPool): LearnStore {
  return { ...store, detached: { ...(store.detached ?? {}), [goalId]: pool } }
}

function withPool(store: LearnStore, goalId: string, pool: DetachedPool): LearnStore {
  return withDetached(store, goalId, pool)
}

/* ---------- 查找 ---------- */

export function findNoteEntity(store: LearnStore, noteId: string): { note: NoteFile; hostId: string | null; goalId: string } | null {
  for (const node of store.nodes) {
    const note = (node.notes ?? []).find((n) => n.id === noteId)
    if (note) return { note, hostId: node.id, goalId: node.goalId }
  }
  for (const [goalId, pool] of Object.entries(store.detached ?? {})) {
    const note = pool.notes.find((n) => n.id === noteId)
    if (note) return { note, hostId: null, goalId }
  }
  return null
}

export function findSuperDocEntity(store: LearnStore, sdocId: string): { doc: SuperDocFile; hostId: string | null; goalId: string } | null {
  for (const node of store.nodes) {
    const doc = superDocsOf(node).find((d) => d.id === sdocId)
    if (doc) return { doc, hostId: node.id, goalId: node.goalId }
  }
  for (const [goalId, pool] of Object.entries(store.detached ?? {})) {
    const doc = pool.superdocs.find((d) => d.id === sdocId)
    if (doc) return { doc, hostId: null, goalId }
  }
  return null
}

/* ---------- 挪动：解绑（→ 池子）与绑定（池子 / 旧宿主 → 新宿主） ---------- */

/** 解绑一份笔记：从宿主记录挪进它所在目标的池子；内容与 id 原样 */
export function detachNote(store: LearnStore, noteId: string): { ok: true; store: LearnStore } | { error: string } {
  const found = findNoteEntity(store, noteId)
  if (!found) return { error: '这份笔记已经不在了' }
  if (!found.hostId) return { error: '这份笔记本来就是游离的，没有线可摘' }
  const host = nodeById(store, found.hostId)
  if (!host) return { error: '这份笔记的宿主文档已经不在了' }
  const pool = detachedPoolOf(store, found.goalId)
  const next = withPool(store, found.goalId, {
    ...pool,
    notes: [...pool.notes, found.note],
    superdocs: pool.superdocs,
  })
  return {
    ok: true,
    store: {
      ...next,
      nodes: next.nodes.map((n) =>
        n.id === found.hostId ? { ...n, notes: (n.notes ?? []).filter((x) => x.id !== noteId), updatedAt: Date.now() } : n,
      ),
    },
  }
}

/** 绑定一份笔记到文档之下（从池子里出来；名字撞了就顺延，那是创建时就有的规矩） */
export function bindNote(store: LearnStore, noteId: string, hostDocId: string): { ok: true; store: LearnStore; name: string } | { error: string } {
  const host = nodeById(store, hostDocId)
  if (!host) return { error: '宿主文档已经不在了' }
  const found = findNoteEntity(store, noteId)
  if (!found) return { error: '这份笔记已经不在了' }
  if (found.hostId === hostDocId) return { error: '这份笔记已经挂在这份文档之下了' }
  if (store.edges.some((e) => e.to === noteId)) {
    return { error: '笔记只能有一个上级节点' }
  }
  const boundId = found.hostId
  const pool = detachedPoolOf(store, found.goalId)
  // 名字跟「新宿主已有的笔记」对 uniqueness——挪动不改身份，撞了才顺延
  const name = uniqueNoteName(notesOf(host), found.note.name)
  const moved: NoteFile = { ...found.note, name }
  // 从旧宿主 / 池子里摘出来
  let next: LearnStore = boundId
    ? { ...store, nodes: store.nodes.map((n) => (n.id === boundId ? { ...n, notes: (n.notes ?? []).filter((x) => x.id !== noteId) } : n)) }
    : withPool(store, found.goalId, { ...pool, notes: pool.notes.filter((n) => n.id !== noteId), superdocs: pool.superdocs })
  // 跨目标换绑时（理论上有通道，实际画布只在同目标内拖），池子留空桶没关系——normalize 会收
  return {
    ok: true,
    name,
    store: {
      ...next,
      nodes: next.nodes.map((n) => (n.id === hostDocId ? { ...n, notes: [...(n.notes ?? []), moved], updatedAt: Date.now() } : n)),
    },
  }
}

/** 解绑一份超级文档：从宿主记录挪进它所在目标的池子 */
export function detachSuperDoc(store: LearnStore, sdocId: string): { ok: true; store: LearnStore } | { error: string } {
  const found = findSuperDocEntity(store, sdocId)
  if (!found) return { error: '这份超级文档已经不在了' }
  if (!found.hostId) return { error: '这份超级文档本来就是游离的，没有线可摘' }
  const host = nodeById(store, found.hostId)
  if (!host) return { error: '这份超级文档的宿主文档已经不在了' }
  const pool = detachedPoolOf(store, found.goalId)
  const next = withPool(store, found.goalId, {
    ...pool,
    notes: pool.notes,
    superdocs: [...pool.superdocs, found.doc],
  })
  return {
    ok: true,
    store: {
      ...next,
      nodes: next.nodes.map((n) =>
        n.id === found.hostId ? { ...n, superdocs: (n.superdocs ?? []).filter((x) => x.id !== sdocId), updatedAt: Date.now() } : n,
      ),
    },
  }
}

/** 绑定一份超级文档到文档之下（从池子里出来；同名让路的是池子那份，宿主内的重名会在 writeSuperDoc 被覆盖——绑定走的是挪动，先查重） */
export function bindSuperDoc(store: LearnStore, sdocId: string, hostDocId: string): { ok: true; store: LearnStore; name: string } | { error: string } {
  const host = nodeById(store, hostDocId)
  if (!host) return { error: '宿主文档已经不在了' }
  const found = findSuperDocEntity(store, sdocId)
  if (!found) return { error: '这份超级文档已经不在了' }
  if (found.hostId === hostDocId) return { error: '这份超级文档已经挂在这份文档之下了' }
  const boundId = found.hostId
  const pool = detachedPoolOf(store, found.goalId)
  const taken = new Set(superDocsOf(host).filter((d) => d.id !== sdocId).map((d) => d.name))
  let name = found.doc.name
  if (taken.has(name)) {
    let i = 2
    while (taken.has(name + ' ' + i)) i++
    name = name + ' ' + i
  }
  const moved: SuperDocFile = { ...found.doc, name }
  let next: LearnStore = boundId
    ? { ...store, nodes: store.nodes.map((n) => (n.id === boundId ? { ...n, superdocs: (n.superdocs ?? []).filter((x) => x.id !== sdocId) } : n)) }
    : withPool(store, found.goalId, { ...pool, notes: pool.notes, superdocs: pool.superdocs.filter((d) => d.id !== sdocId) })
  return {
    ok: true,
    name,
    store: {
      ...next,
      nodes: next.nodes.map((n) => (n.id === hostDocId ? { ...n, superdocs: [...(n.superdocs ?? []), moved], updatedAt: Date.now() } : n)),
    },
  }
}

/** 撤回辅助：把一批 id 从池子里清掉（实体随节点记录原样回来，池子里那份孤儿副本不再需要） */
export function scrubDetached(store: LearnStore, ids: Set<string>): LearnStore {
  if (!store.detached) return store
  let touched = false
  const next: Record<string, DetachedPool> = {}
  for (const [goalId, pool] of Object.entries(store.detached)) {
    const notes = pool.notes.filter((n) => !ids.has(n.id))
    const superdocs = pool.superdocs.filter((d) => !ids.has(d.id))
    if (notes.length !== pool.notes.length || superdocs.length !== pool.superdocs.length) touched = true
    next[goalId] = { notes, superdocs }
  }
  return touched ? { ...store, detached: next } : store
}

/* ---------- 试卷：账本本来就在 store.exams，游离 = 宿主 id 悬空 ---------- */

/** 解绑一份试卷：宿主 id 置空（账本原地不动，卷面与作答原样） */
export function detachExam(store: LearnStore, examId: string): { ok: true; store: LearnStore } | { error: string } {
  const exam = store.exams.find((e) => e.id === examId)
  if (!exam) return { error: '这份试卷已经不在了' }
  if (!exam.nodeId || !nodeById(store, exam.nodeId)) return { error: '这份试卷本来就是游离的，没有线可摘' }
  return {
    ok: true,
    store: {
      ...store,
      exams: store.exams.map((e) => (e.id === examId ? { ...e, nodeId: '' } : e)),
    },
  }
}

/** 绑定 / 换绑一份试卷到文档之下：只动 nodeId，卷面与作答不碰 */
export function bindExam(store: LearnStore, examId: string, hostDocId: string): { ok: true; store: LearnStore } | { error: string } {
  const host = nodeById(store, hostDocId)
  if (!host) return { error: '宿主文档已经不在了' }
  const exam = store.exams.find((e) => e.id === examId)
  if (!exam) return { error: '这份试卷已经不在了' }
  if (exam.nodeId === hostDocId) return { error: '这份试卷已经挂在这份文档之下了' }
  return {
    ok: true,
    store: {
      ...store,
      exams: store.exams.map((e) => (e.id === examId ? { ...e, nodeId: hostDocId, goalId: host.goalId } : e)),
    },
  }
}
