/**
 * 本文件负责什么：**一个节点的落盘形状**——把原来散在七处的文件（正文 .md、大纲 .outline.json、
 * meta.json、notes/*.md、superdocs/*.html、exams/*.json）合并成**一个** `{节点}.node.json`。
 *
 * ## 为什么合并
 *
 * 旧布局里「一种内容一个落点」，每加一种挂件就要多设计一套目录/命名/撞名/搬迁规则，
 * 而且试卷与超级文档是**双写**的（独立文件 + meta.json 里一整份），读回还要按 id 去重。
 * 合并之后：一个节点一个文件，文件数不再随挂件类型增长，加一种挂件只是 `parts` 里多一条。
 *
 * ## 文件名的取舍
 *
 * 用 `{目录名}.node.json` 而不是 `{目录名}.json`：目标目录里已经有 `chat.json` /
 * `reading.json` / `structure.json` 这些账本文件，一个叫「chat」的目标会与 `chat.json` 撞车。
 * `.node.json` 后缀把节点文件与目标级账本彻底分开，同时也让"这是节点"一眼可辨。
 *
 * ## parts 为什么是数组
 *
 * 名字里可能有 `:`、`/`、空格，做成对象的 key 要转义；数组无冲突、**顺序即列表顺序**
 * （笔记的排列顺序因此不用再单独记一份名字清单），条数是个位数，线性查找无所谓。
 */

import type { Exam } from '../exam'
import { normalizeOutline } from '../outline'
import type { DocNotepadItem, KnowledgeNode, NoteFile, OutlineDoc, SuperDocFile } from '../types'
import { at, jsonText } from './meta'

export const NODE_FILE_VERSION = 3

/** 节点文件的扩展名（含前导点） */
export const NODE_FILE_SUFFIX = '.node.json'

export type PartKind = 'teaching' | 'outline' | 'note' | 'exam' | 'superdoc'

/** 节点里的一段内容 */
export interface NodePart {
  kind: PartKind
  /** 笔记名 / 超级文档名 / 试卷 id；teaching 与 outline 没有名字（每节点一份） */
  name?: string
  /**
   * 笔记 / 超级文档的持久 uuid（= 节点宇宙里它们的节点身份）。读回时缺了就现场补一个——
   * 补上的 id 随下一次落盘持久，之后一直稳定。
   */
  id?: string
  format: 'markdown' | 'json' | 'html'
  body: unknown
  createdAt?: number
  updatedAt?: number
}

/** 一个节点在磁盘上的全部内容 */
export interface NodeFile {
  version: number
  id: string
  /** 数据节点的类型；目前只有 doc（知识节点），登记表见 learn/nodeKinds */
  type: 'doc'
  title: string
  key: string
  description: string
  status: string
  origin: string
  createdAt: number
  updatedAt: number
  annotations: unknown
  /** 随文便签（Notepad）集合；每个元素插在正文指定 blockIndex 处，数据完全独立于正文原文 */
  notepads?: DocNotepadItem[]
  /** 依赖边（我是 from，这些是 to）——与旧 meta.json 的口径一致，边仍写在节点自己文件里 */
  dependencies: Array<{ to: string; createdAt: number; portKey?: string; toOutline?: true }>
  parts: NodePart[]
  /** 学习状态：没评估过就不写这一项（理由同旧 meta.json） */
  learning?: unknown
  /** 思维导图底色（见 types 的 tint） */
  tint?: unknown
  /** 目标信息只写在根节点文件里：一个目标一份文档，根节点就是那份文档 */
  goal?: { id: string; question: string; createdAt: number; updatedAt: number }
}

/**
 * 节点 → parts。
 *
 * 教学文档**永远写一条**（哪怕是空串）：它是节点的主体，别的工具与"生成文档"按钮都按它认路。
 * 大纲只在真有的时候写。笔记/超级文档/试卷按原顺序一条一个。
 */
export function partsOfNode(node: KnowledgeNode, exams: readonly Exam[]): NodePart[] {
  const parts: NodePart[] = [
    { kind: 'teaching', format: 'markdown', body: node.docs?.teaching ?? '' },
  ]
  if (node.outline) parts.push({ kind: 'outline', format: 'json', body: node.outline })
  for (const note of node.notes ?? []) {
    parts.push({
      kind: 'note',
      id: note.id,
      name: note.name,
      format: 'markdown',
      body: note.content,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    })
  }
  for (const sdoc of node.superdocs ?? []) {
    parts.push({
      kind: 'superdoc',
      id: sdoc.id,
      name: sdoc.name,
      format: 'html',
      body: sdoc.html,
      createdAt: sdoc.createdAt,
      updatedAt: sdoc.updatedAt,
    })
  }
  for (const exam of exams) {
    parts.push({ kind: 'exam', name: exam.id, format: 'json', body: exam })
  }
  return parts
}

/** 从一个节点文件里拆出来的内容（parse 侧用） */
export interface NodeContent {
  teaching: string
  outline?: OutlineDoc
  notes: NoteFile[]
  superdocs: SuperDocFile[]
  exams: Exam[]
}

/**
 * parts → 内容。
 *
 * 容错口径与旧读盘一致：认不出来的 kind 丢掉、缺名字的笔记/超管丢掉、重复名字只留第一份。
 * 时间戳缺失时退回节点自己的 createdAt/updatedAt（手改过的文件不该让排序变成 NaN）。
 */
export function contentOfParts(parts: readonly NodePart[], base: { createdAt: number; updatedAt: number }): NodeContent {
  let teaching = ''
  let outline: NodeContent['outline']
  const notes: NoteFile[] = []
  const superdocs: SuperDocFile[] = []
  const exams: Exam[] = []
  const seenNotes = new Set<string>()
  const seenDocs = new Set<string>()
  const seenExams = new Set<string>()

  for (const part of parts) {
    if (!part || typeof part !== 'object') continue
    switch (part.kind) {
      case 'teaching': {
        if (typeof part.body === 'string') teaching = part.body
        break
      }
      case 'outline': {
        const parsed = normalizeOutline(part.body)
        if (parsed) outline = parsed
        break
      }
      case 'note': {
        const name = typeof part.name === 'string' ? part.name.trim() : ''
        if (!name || seenNotes.has(name.toLowerCase())) break
        seenNotes.add(name.toLowerCase())
        notes.push({
          id: typeof part.id === 'string' && part.id ? part.id : crypto.randomUUID(),
          name,
          content: typeof part.body === 'string' ? part.body : '',
          createdAt: at(part.createdAt) || base.createdAt,
          updatedAt: at(part.updatedAt) || at(part.createdAt) || base.updatedAt,
        })
        break
      }
      case 'superdoc': {
        const name = typeof part.name === 'string' ? part.name.trim() : ''
        if (!name || seenDocs.has(name.toLowerCase())) break
        seenDocs.add(name.toLowerCase())
        superdocs.push({
          id: typeof part.id === 'string' && part.id ? part.id : crypto.randomUUID(),
          name,
          html: typeof part.body === 'string' ? part.body : '',
          createdAt: at(part.createdAt) || base.createdAt,
          updatedAt: at(part.updatedAt) || at(part.createdAt) || base.updatedAt,
        })
        break
      }
      case 'exam': {
        const exam = part.body as Exam | null
        if (!exam || typeof exam !== 'object' || typeof exam.id !== 'string' || !exam.id) break
        if (seenExams.has(exam.id)) break
        seenExams.add(exam.id)
        exams.push(exam)
        break
      }
      default:
        break
    }
  }

  return {
    teaching,
    ...(outline ? { outline } : {}),
    notes,
    superdocs,
    exams,
  }
}

/** 节点文件的文本（与 jsonText 同一套缩进，方便人排查） */
export function nodeFileText(file: NodeFile): string {
  return jsonText(file)
}
