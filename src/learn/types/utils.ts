/**
 * 节点文档的取值小工具（纯搬运自 learn/types.ts，对外仍由 learn/types 门面原名转发）：
 * 带兜底的读取器——notesOf / docOf / superDocsOf / outlineOf。
 * 只 `import type` 依赖 types/node 的类型，没有值级依赖。
 */

import type { DocKind, NodeDocs, NoteFile, OutlineDoc, SuperDocFile } from './node'

/** 一个节点的全部超级文档；老节点没有这一项时按空数组处理 */
export function superDocsOf(node: { superdocs?: SuperDocFile[] }): SuperDocFile[] {
  return node.superdocs ?? []
}

/** 一个节点的大纲；老节点没有这一项时为 null（交互页据此显示「还没有大纲」） */
export function outlineOf(node: { outline?: OutlineDoc }): OutlineDoc | null {
  return node.outline ?? null
}

/** 一个节点的全部笔记；老数据没有这一项时按空数组处理 */
export function notesOf(node: { notes?: NoteFile[] }): NoteFile[] {
  return node.notes ?? []
}

/**
 * 取某个节点的某份文档正文。
 *
 * 'note' 取的是**第一份笔记**：这个函数是给「只关心有没有内容 / 拿一段上下文」的调用方
 * 用的（Agent 的默认笔记、选段提问的上下文等）。要指名某一份笔记，走 learn/notes 的
 * findNote 或 paths 的「笔记/名称」寻址——别在这里加第二个参数，那会让「哪一份」这件事
 * 散到每个调用点上。
 */
export function docOf(node: { docs: NodeDocs; notes?: NoteFile[] }, kind: DocKind): string {
  if (kind === 'note') return node.notes?.[0]?.content ?? ''
  return node.docs?.teaching ?? ''
}
