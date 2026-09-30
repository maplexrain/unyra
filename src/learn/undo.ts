/**
 * 本文件负责：资源管理器删除操作的**撤回**——删除前把会被连带拿走的那几片数据
 * 引用下来，Ctrl+Z 时原样接回去（见 components/learn/workspace/useExplorerUndo）。
 *
 * 为什么捕获是「引用旧片」而不是逐项克隆：store 的每次操作都返回新对象
 * （不可变更新，图操作一律如此），删除只换数组、从不改旧对象的内容——
 * 所以把旧引用收进条目里，内容就一个字节都不会变；恢复时把它们接回新数组即可。
 *
 * 覆盖面与各删除函数的级联一一对应（对不上的话，撤回就会丢东西或长出幽灵）：
 * - deleteNode（单节点）：节点、触及它的边、它的试卷、它的临时变量、它在阅读账里那一片；
 * - deleteGoal（目标是根）：整棵子树、目标本体、会话、两本账（阅读/打卡整本——目标没了
 *   它们的账不会再有新写入，整份引用原样放回就是删除前一刻）；
 * - deleteNote / removeSuperDoc：那份文档（含正文）与它那一片阅读记录（pruneDocReading 的逆）；
 * - removeExam / removeLocalFile：单条数据本身。
 *
 * **页签不恢复**：撤回还原的是数据；关掉的页签让用户自己重新打开——删完到撤回之间
 * 界面可能已经换了好几轮，硬把旧页签插回去反而会把人拽到他不看的地方。
 */
import type {
  DependencyEdge,
  KnowledgeNode,
  LearningGoal,
  LearnStore,
  LocalFile,
  NoteFile,
  SuperDocFile,
  TmpEntry,
} from './types'
import type { Exam } from './exam'
import type { Conversation } from '../agent/types'
import type { CheckinStore } from './checkin'
import type { DocReading, NodeReading, ReadingStore } from './reading'
import { readingDocKey, readingOfGoal, withGoalReading } from './reading'
import { findNote, notesOf } from './notes'
import { findSuperDoc } from './superdocs'
import { superDocsOf } from './types'
import { sortLocalFiles } from './localfiles'
import { goalSubtreeIds, nodeById } from './graph'
import { t } from '../i18n'

/** 一次可撤回的删除：捕获什么、怎么恢复，都随 kind 分派 */
export type ExplorerUndo =
  | {
      kind: 'node'
      /** 吐司用的一句话，如「删除目标「微积分」」 */
      label: string
      goalId: string
      nodes: KnowledgeNode[]
      edges: DependencyEdge[]
      exams: Exam[]
      /** 只在删目标是根时才有：目标本体 + 会话 + 两本账 */
      goal?: LearningGoal
      conversations: Conversation[]
      reading?: ReadingStore
      checkin?: CheckinStore
      tmp: Record<string, Record<string, TmpEntry>>
      /** 单节点删除时才捕获：这个节点在阅读账里的那一片（整本账不能整份放回，见 restoreNodeReadingSlice） */
      readingSlice?: { nodeId: string; rec: NodeReading; sessions: ReadingStore['sessions']; days: string[] }
    }
  | { kind: 'note'; label: string; nodeId: string; note: NoteFile; docReading?: DocReading }
  | { kind: 'super'; label: string; nodeId: string; doc: SuperDocFile; docReading?: DocReading }
  | { kind: 'exam'; label: string; exam: Exam }
  | { kind: 'local'; label: string; file: LocalFile }

/** 节点/目标删除那一条的形状（恢复逻辑里用） */
type NodeUndo = Extract<ExplorerUndo, { kind: 'node' }>

/* ---------- 捕获（删除前调用，拿到的是旧 store） ---------- */

/** 删除节点 / 目标前备货：与 deleteNode、deleteGoal 的级联逐项对应 */
export function captureNodeDelete(store: LearnStore, nodeId: string): ExplorerUndo | null {
  const node = nodeById(store, nodeId)
  if (!node) return null
  const goal = store.goals.find((g) => g.rootNodeId === nodeId)
  if (goal) {
    const removed = goalSubtreeIds(store, goal.id)
    const tmp: Record<string, Record<string, TmpEntry>> = {}
    for (const id of removed) {
      const bucket = store.tmp?.[id]
      if (bucket) tmp[id] = bucket
    }
    return {
      kind: 'node',
      label: t('删除目标「{0}」', node.title),
      goalId: goal.id,
      nodes: store.nodes.filter((n) => removed.has(n.id)),
      edges: store.edges.filter((e) => removed.has(e.from) || removed.has(e.to)),
      exams: store.exams.filter((e) => removed.has(e.nodeId)),
      goal,
      conversations: store.conversations.filter((c) => c.goalId === goal.id),
      reading: store.reading?.byGoal?.[goal.id],
      checkin: store.checkin?.byGoal?.[goal.id],
      tmp,
    }
  }
  const book = readingOfGoal(store.reading, node.goalId)
  const rec = book?.nodes[nodeId]
  return {
    kind: 'node',
    label: t('删除「{0}」', node.title),
    goalId: node.goalId,
    nodes: [node],
    edges: store.edges.filter((e) => e.from === nodeId || e.to === nodeId),
    exams: store.exams.filter((e) => e.nodeId === nodeId),
    conversations: [],
    tmp: store.tmp?.[nodeId] ? { [nodeId]: store.tmp[nodeId] } : {},
    ...(rec
      ? {
          readingSlice: {
            nodeId,
            rec,
            sessions: book ? book.sessions.filter((s) => s.nodeId === nodeId) : [],
            days: Object.entries(book?.days ?? {})
              .filter(([, d]) => d.nodes.includes(nodeId))
              .map(([day]) => day),
          },
        }
      : {}),
  }
}

/** 删除一份笔记前备货（正文与它那一片阅读记录一起） */
export function captureNoteDelete(store: LearnStore, nodeId: string, name: string): ExplorerUndo | null {
  const node = nodeById(store, nodeId)
  const note = node ? findNote(notesOf(node), name) : undefined
  if (!node || !note) return null
  const book = readingOfGoal(store.reading, node.goalId)
  return {
    kind: 'note',
    label: t('删除笔记「{0}」', note.name),
    nodeId,
    note: { ...note },
    docReading: book?.nodes[nodeId]?.docs[readingDocKey('note', note.name)],
  }
}

/** 删除一份超级文档前备货（名字按真实的那一份算：findSuperDoc 不区分大小写） */
export function captureSuperDelete(store: LearnStore, nodeId: string, name: string): ExplorerUndo | null {
  const node = nodeById(store, nodeId)
  const doc = node ? findSuperDoc(superDocsOf(node), name) : undefined
  if (!node || !doc) return null
  const book = readingOfGoal(store.reading, node.goalId)
  return {
    kind: 'super',
    label: t('删除超级文档「{0}」', doc.name),
    nodeId,
    doc: { ...doc },
    docReading: book?.nodes[nodeId]?.docs[readingDocKey('sdoc', doc.name)],
  }
}

/** 删除一份试卷前备货（含全部考试记录——撤回要原样带回来） */
export function captureExamDelete(store: LearnStore, examId: string): ExplorerUndo | null {
  const exam = store.exams.find((e) => e.id === examId)
  return exam ? { kind: 'exam', label: t('删除试卷《{0}》', exam.title), exam: { ...exam } } : null
}

/** 从本地文件列表移除一条前备货（磁盘上的文件不动，撤回只是把它接回列表） */
export function captureLocalRemove(store: LearnStore, path: string): ExplorerUndo | null {
  const file = store.localFiles.find((f) => f.path === path)
  return file ? { kind: 'local', label: t('移除本地文件「{0}」', file.name), file: { ...file } } : null
}

/* ---------- 恢复（Ctrl+Z 时调用） ---------- */

/**
 * 把一个节点在阅读账里的那一片**并回**当前那本账（不是整份放回）。
 *
 * 删节点到撤回之间，同一目标的其他节点可能又读了会儿书——整份放回旧账会把这些
 * 新事实抹掉。并回的粒度与 pruneReading 的删除一一互逆：nodes 那条记录、这个节点
 * 的 sessions、days 名单里把它的 id 接回去（学习日的总时长本来就不删，见 aggregate 的说明）。
 */
function restoreNodeReadingSlice(store: LearnStore, entry: NodeUndo): LearnStore {
  const slice = entry.readingSlice
  const book = readingOfGoal(store.reading, entry.goalId)
  if (!slice || !book) return store
  const nodes: Record<string, NodeReading> = { ...book.nodes, [slice.nodeId]: slice.rec }
  const known = new Set(book.sessions.map((s) => s.id))
  const sessions = [...book.sessions, ...slice.sessions.filter((s) => !known.has(s.id))]
  let days = book.days
  for (const day of slice.days) {
    const d = days[day]
    if (!d || d.nodes.includes(slice.nodeId)) continue
    if (days === book.days) days = { ...book.days }
    days[day] = { ...d, nodes: [...d.nodes, slice.nodeId] }
  }
  return { ...store, reading: withGoalReading(store.reading, entry.goalId, { ...book, nodes, sessions, days }) }
}

/** 把一份文档的阅读记录接回某个节点（deleteNote / removeSuperDoc 里 pruneDocReading 的逆） */
function restoreDocReading(
  store: LearnStore,
  nodeId: string,
  goalId: string,
  docKey: string,
  doc: DocReading,
): LearnStore {
  const book = readingOfGoal(store.reading, goalId)
  const node = nodeById(store, nodeId)
  if (!book || !node) return store
  const rec = book.nodes[nodeId]
  if (!rec) return store
  const docs: Record<string, DocReading> = { ...rec.docs, [docKey]: doc }
  const next: ReadingStore = { ...book, nodes: { ...book.nodes, [nodeId]: { ...rec, docs } } }
  return { ...store, reading: withGoalReading(store.reading, goalId, next) }
}

/** 撤回一次删除；东西已经不在（节点被连根删过、store 换过用户等）时返回 ok:false 与一句话 */
export function applyUndo(store: LearnStore, entry: ExplorerUndo): { store: LearnStore; ok: boolean; message: string } {
  let s = store
  if (entry.kind === 'node') {
    const present = new Set(s.nodes.map((n) => n.id))
    const backNodes = entry.nodes.filter((n) => !present.has(n.id))
    if (backNodes.length !== entry.nodes.length) {
      return { store, ok: false, message: t('撤回失败：部分数据已经存在（可能重复撤回）') }
    }
    const goal = entry.goal
    if (goal && !s.goals.some((g) => g.id === goal.id)) {
      // 目标本体也回来了，它挂着的「阅读/打卡两本账」整份放回（目标没了就不会有新写入，见类型说明）
      const reading = entry.reading
        ? { byGoal: { ...(s.reading?.byGoal ?? {}), [entry.goalId]: entry.reading } }
        : s.reading
      const checkin = entry.checkin
        ? { byGoal: { ...(s.checkin?.byGoal ?? {}), [entry.goalId]: entry.checkin } }
        : s.checkin
      s = {
        ...s,
        goals: [...s.goals, goal],
        conversations: [...s.conversations, ...entry.conversations.filter((c) => !s.conversations.some((x) => x.id === c.id))],
        ...(reading !== s.reading ? { reading } : {}),
        ...(checkin !== s.checkin ? { checkin } : {}),
      }
    }
    const edgeKey = new Set(s.edges.map((e) => e.from + '\u0001' + e.to))
    const examIds = new Set(s.exams.map((e) => e.id))
    let next: LearnStore = {
      ...s,
      nodes: [...s.nodes, ...backNodes],
      edges: [...s.edges, ...entry.edges.filter((e) => !edgeKey.has(e.from + '\u0001' + e.to))],
      exams: [...s.exams, ...entry.exams.filter((e) => !examIds.has(e.id))],
      tmp: { ...s.tmp, ...entry.tmp },
    }
    if (entry.readingSlice) next = restoreNodeReadingSlice(next, entry)
    return { store: next, ok: true, message: t('已撤回：{0}', entry.label) }
  }
  if (entry.kind === 'note') {
    const node = nodeById(s, entry.nodeId)
    if (!node) return { store, ok: false, message: t('撤回失败：那个节点已经不在了') }
    if (findNote(notesOf(node), entry.note.name)) return { store, ok: false, message: t('已有一份同名笔记，没有重复撤回') }
    let next: LearnStore = {
      ...s,
      nodes: s.nodes.map((n) =>
        n.id === entry.nodeId ? { ...n, notes: [...notesOf(n), entry.note], updatedAt: Date.now() } : n,
      ),
    }
    if (entry.docReading) next = restoreDocReading(next, entry.nodeId, node.goalId, readingDocKey('note', entry.note.name), entry.docReading)
    return { store: next, ok: true, message: t('已撤回：{0}', entry.label) }
  }
  if (entry.kind === 'super') {
    const node = nodeById(s, entry.nodeId)
    if (!node) return { store, ok: false, message: t('撤回失败：那个节点已经不在了') }
    if (findSuperDoc(superDocsOf(node), entry.doc.name)) return { store, ok: false, message: t('已有一份同名超级文档，没有重复撤回') }
    let next: LearnStore = {
      ...s,
      nodes: s.nodes.map((n) =>
        n.id === entry.nodeId ? { ...n, superdocs: [...superDocsOf(n), entry.doc], updatedAt: Date.now() } : n,
      ),
    }
    if (entry.docReading) next = restoreDocReading(next, entry.nodeId, node.goalId, readingDocKey('sdoc', entry.doc.name), entry.docReading)
    return { store: next, ok: true, message: t('已撤回：{0}', entry.label) }
  }
  if (entry.kind === 'exam') {
    if (s.exams.some((e) => e.id === entry.exam.id)) return { store, ok: false, message: t('这份试卷已经在了，没有重复撤回') }
    return { store: { ...s, exams: [...s.exams, entry.exam] }, ok: true, message: t('已撤回：{0}', entry.label) }
  }
  if (s.localFiles.some((f) => f.path === entry.file.path)) {
    return { store, ok: false, message: t('这个文件已经在列表里，没有重复撤回') }
  }
  return {
    store: { ...s, localFiles: sortLocalFiles([...s.localFiles, entry.file]) },
    ok: true,
    message: t('已撤回：{0}', entry.label),
  }
}
