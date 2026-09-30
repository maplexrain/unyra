import type { KnowledgeNode, NoteFile } from './types'
import { allocate } from './segments'

/**
 * 笔记的纯逻辑：新建 / 改名 / 删除 / 写入，以及「名字怎么取才不撞车」。
 *
 * 为什么这些操作作用在**节点**上而不是 store 上：一份笔记只属于一个节点，改的是节点自己
 * 的数据；store 那一层的包装（见 learn/graph 的 createNote / renameNoteFile / deleteNote）
 * 额外要照顾页签与当前选中项，那才是 store 才知道的事。
 *
 * 名字就是文件名（见 NoteFile 的说明），所以取名一律走 sanitizeSegment + 同目录去重：
 * 「错题/整理」会当场变成「错题_整理」，而不是等落盘时才悄悄变形——界面上显示的名字
 * 必须与磁盘上那个文件一模一样，否则用户按名字去资源管理器里找是找不到的。
 */

/** 没给名字时用的默认名 */
export const NOTE_DEFAULT_NAME = '笔记'

/** 节点上的笔记列表（老节点没有这一项时按空数组处理） */
export function notesOf(node: { notes?: NoteFile[] }): NoteFile[] {
  return node.notes ?? []
}

/**
 * 在已有笔记里按名字找一份。
 *
 * 大小写不敏感：Windows 的磁盘不区分大小写，「错题」与「错题」以外的写法一旦被当成两份，
 * 落盘时就会互相覆盖。
 */
export function findNote(notes: NoteFile[], name: string): NoteFile | undefined {
  const key = (name ?? '').trim().toLowerCase()
  if (!key) return undefined
  return notes.find((n) => n.name.toLowerCase() === key)
}

/** 分配一个不与现有笔记撞车的名字（撞了就加 (2)、(3)…） */
export function uniqueNoteName(notes: NoteFile[], raw: string): string {
  const used = new Set(notes.map((n) => n.name.toLowerCase()))
  return allocate((raw ?? '').trim() || NOTE_DEFAULT_NAME, used)
}

/** 一份笔记的字数（不算空白），列表上显示它 */
export function noteChars(note: NoteFile): number {
  return note.content.replace(/\s/g, '').length
}

/** 新建一份笔记：名字由 uniqueNoteName 定，正文为空。返回新节点与最终名字 */
export function addNoteTo(
  node: KnowledgeNode,
  raw: string | undefined,
  at: number,
): { node: KnowledgeNode; name: string } {
  const list = notesOf(node)
  const name = uniqueNoteName(list, raw ?? '')
  const note: NoteFile = { name, content: '', createdAt: at, updatedAt: at }
  return { node: { ...node, notes: [...list, note], updatedAt: at }, name }
}

/**
 * 改一份笔记的名字。
 *
 * 撞名不报错，自动让开（加序号）：改名的意图是「我想叫这个」，
 * 为了一个重名把整次操作打回去，用户还得自己想一个没被占用的名字。
 * 找不到那份笔记时返回 null（调用方据此提示）。
 */
export function renameNoteIn(
  node: KnowledgeNode,
  from: string,
  to: string,
  at: number,
): { node: KnowledgeNode; name: string } | null {
  const list = notesOf(node)
  const target = findNote(list, from)
  if (!target) return null
  const rest = list.filter((n) => n !== target)
  const name = uniqueNoteName(rest, to)
  if (name === target.name) return { node, name }
  const next = { ...target, name, updatedAt: at }
  return {
    node: { ...node, notes: list.map((n) => (n === target ? next : n)), updatedAt: at },
    name,
  }
}

/** 删掉一份笔记（连同它的正文一起；磁盘上的文件由差异比对删掉） */
export function removeNoteFrom(node: KnowledgeNode, name: string, at: number): KnowledgeNode {
  const list = notesOf(node)
  const target = findNote(list, name)
  if (!target) return node
  return { ...node, notes: list.filter((n) => n !== target), updatedAt: at }
}

/** 写入某一份笔记的正文；名字找不到时返回 null（改名与删除都会让旧名字失效） */
export function writeNoteIn(
  node: KnowledgeNode,
  name: string,
  content: string,
  at: number,
): KnowledgeNode | null {
  const list = notesOf(node)
  const target = findNote(list, name)
  if (!target) return null
  const next = { ...target, content, updatedAt: at }
  return { ...node, notes: list.map((n) => (n === target ? next : n)), updatedAt: at }
}

/**
 * 追加正文到某一份笔记；那份笔记不存在时**新建一份**（名字就用它）。
 *
 * 这是 Agent 那条路要的行为：它说「记到笔记里」，节点上还没有笔记时应当直接记下来，
 * 而不是回一句「没有这份笔记」。
 */
export function appendNoteIn(
  node: KnowledgeNode,
  name: string,
  chunk: string,
  at: number,
): { node: KnowledgeNode; name: string } {
  const list = notesOf(node)
  const target = findNote(list, name)
  if (!target) {
    const created = addNoteTo(node, name, at)
    return { node: writeNoteIn(created.node, created.name, chunk, at) ?? created.node, name: created.name }
  }
  const body = target.content ? target.content.replace(/\s+$/, '') + '\n\n' + chunk : chunk
  return { node: writeNoteIn(node, target.name, body, at) ?? node, name: target.name }
}
