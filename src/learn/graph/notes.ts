/**
 * 本文件负责：节点下那几份笔记的增删改查——新建、改名、写正文、追加、删除，
 * 以及改名 / 删除时要跟着一起搬的页签、暂存与阅读记录。笔记本身的命名与正文规则在 learn/notes。
 */
import type { LearnStore, NoteFile } from '../types'
import { addNoteTo, appendNoteIn, notesOf, removeNoteFrom, renameNoteIn, writeNoteIn } from '../notes'
import { closeIds, renameTabRef } from '../groups'
import { dropDrafts, moveDraft } from '../drafts'
import { moveDocReading, pruneDocReading, readingDocKey } from '../reading'
import { nodeById, replaceNode } from './nodes'
import { onNodeReading } from './reading'

/* ---------- 笔记（一个节点可以有多份，见 learn/notes） ---------- */

/** 这个节点下的笔记列表；节点不存在时为空 */
export function notesOfNode(store: LearnStore, nodeId: string): NoteFile[] {
  const node = nodeById(store, nodeId)
  return node ? notesOf(node) : []
}

/**
 * 新建一份笔记。
 *
 * 名字交给 learn/notes 的 uniqueNoteName 定（非法字符就地换掉、撞名自动加序号）：
 * 名字就是文件名，必须在**进内存那一刻**就是合法的，否则「界面上的名字」与
 * 「磁盘上的名字」会分成两个，用户按名字找不到自己的文件。
 */
export function createNote(
  store: LearnStore,
  nodeId: string,
  name?: string,
): { store: LearnStore; name: string | null } {
  const node = nodeById(store, nodeId)
  if (!node) return { store, name: null }
  const at = Date.now()
  const r = addNoteTo(node, name, at)
  return { store: replaceNode(store, r.node), name: r.name }
}

/**
 * 给一份笔记改名。
 *
 * 页签要跟着改：页签按 (节点, 笔记名) 认人（见 learn/tabs 的 tabKey），名字换了而页签
 * 没换，那个「正开着这份笔记」的页签就会变成一个指向不存在内容的幽灵——
 * 界面不报错，只是内容空了，最难查的那一类。
 */
export function renameNoteFile(
  store: LearnStore,
  nodeId: string,
  from: string,
  to: string,
): { store: LearnStore; name: string | null } {
  const node = nodeById(store, nodeId)
  if (!node) return { store, name: null }
  const at = Date.now()
  const r = renameNoteIn(node, from, to, at)
  if (!r) return { store, name: null }
  const next = replaceNode(store, r.node)
  if (r.name === from) return { store: next, name: r.name }
  // 页签按 (节点, 笔记名) 认人，改名要连它所在那一组的激活项一起改名（见 groups 的 renameTabRef）
  const docArea = renameTabRef(next.docArea, { kind: 'note', nodeId, note: from }, { kind: 'note', nodeId, note: r.name })
  // 暂存区也一起搬：改到一半的正文不能因为改了个名就找不回来（见 drafts 的 moveDraft）
  const drafts = moveDraft(next.drafts, 'n:' + nodeId + ':' + from, 'n:' + nodeId + ':' + r.name)
  // 阅读记录也跟着搬（同页签、暂存区）：名字换了而记录没换，那条记录就成了孤儿。
  // 搬的是**这个节点所属目标**的那一本账（阅读按目标分开，见 learn/reading 的 ReadingBook）
  const moved = onNodeReading(next, nodeId, (rec) =>
    moveDocReading(rec, nodeId, readingDocKey('note', from), readingDocKey('note', r.name), at),
  )
  return {
    store: { ...moved, docArea, drafts },
    name: r.name,
  }
}

/**
 * 删掉一份笔记，并关掉指着它的页签。
 *
 * 「删文件」与「关页签」必须一起做：留着那个页签，用户会以为笔记还在，
 * 点开却是一片空白——那比直接关掉更像出了问题。
 */
export function deleteNote(store: LearnStore, nodeId: string, name: string): LearnStore {
  const node = nodeById(store, nodeId)
  if (!node) return store
  const at = Date.now()
  const next = replaceNode(store, removeNoteFrom(node, name, at))
  const id = 'n:' + nodeId + ':' + name
  // 笔记没了，它那份阅读记录也一起清掉（记录按 note:名字 存，文档没了就是一条空索引）
  const pruned = onNodeReading(next, nodeId, (rec) => pruneDocReading(rec, nodeId, readingDocKey('note', name)))
  // 暂存同一条道理：名字是笔记的身份，留着它会套在下一份同名笔记上
  return {
    ...pruned,
    docArea: closeIds(pruned.docArea, [id]),
    drafts: dropDrafts(next.drafts, [id]),
  }
}

/** 写入一份笔记的正文；那份笔记已经不在了（被改名或被删）时原样返回 */
export function writeNote(store: LearnStore, nodeId: string, name: string, content: string): LearnStore {
  const node = nodeById(store, nodeId)
  if (!node) return store
  const next = writeNoteIn(node, name, content, Date.now())
  return next ? replaceNode(store, next) : store
}

/**
 * 往一份笔记里追加正文；没有这份笔记就新建一份。
 *
 * 界面上「把这段整理进笔记」与 Agent 的 api.doc.append(…, '笔记') 都走它：
 * 节点上还没有笔记时，正确的反应是当场建一份，而不是回一句「没有这份笔记」。
 */
export function appendNote(
  store: LearnStore,
  nodeId: string,
  name: string,
  chunk: string,
): { store: LearnStore; name: string | null } {
  const node = nodeById(store, nodeId)
  if (!node) return { store, name: null }
  const r = appendNoteIn(node, name, chunk, Date.now())
  return { store: replaceNode(store, r.node), name: r.name }
}
