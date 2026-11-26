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
  OutlineDoc,
  OutlineEntity,
  ProjectNodeEntity,
  SuperDocFile,
  TmpEntry,
  VideoNodeEntity,
  FileNodeEntity,
} from './types'
import type { ClassroomEntity } from './classroom/types'
import type { Exam } from './exam'
import type { Conversation } from '../agent/types'
import { detachedPoolOf, findNoteEntity, findSuperDocEntity, scrubDetached, withDetached } from './detached'
import { findNote, notesOf } from './notes'
import { findSuperDoc } from './superdocs'
import { superDocsOf } from './types'
import { sortLocalFiles } from './localfiles'
import { withVideoMirror } from './video/nodes'
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
      /** 只在删目标是根时才有：目标本体 + 会话 */
      goal?: LearningGoal
      /** 只在删的是目标的目录锚点文档时才有：撤回时把 rootNodeId 指回这枚节点 */
      anchorOf?: string
      conversations: Conversation[]
      /** 只在删目标是根时才捕获：那个目标的视频节点（绑定行，恢复时接回 + 重建资源镜像） */
      videoNodes?: VideoNodeEntity[]
      fileNodes?: FileNodeEntity[]
      tmp: Record<string, Record<string, TmpEntry>>
    }
  | { kind: 'note'; label: string; nodeId: string; note: NoteFile }
  | { kind: 'super'; label: string; nodeId: string; doc: SuperDocFile }
  | { kind: 'detached-note'; label: string; goalId: string; note: NoteFile }
  | { kind: 'detached-super'; label: string; goalId: string; doc: SuperDocFile }
  | { kind: 'exam'; label: string; exam: Exam }
  | { kind: 'local'; label: string; file: LocalFile }
  | {
      kind: 'outline'
      label: string
      /** 大纲 uuid：附身大纲是 `o:{文档id}`，游离大纲是 `o:{实体id}` */
      uuid: string
      /** 附身大纲的内容（清空计划前的那一份） */
      attached?: OutlineDoc
      /** 游离大纲的实体 */
      entity?: OutlineEntity
      edges: DependencyEdge[]
    }
  | { kind: 'file'; label: string; file: FileNodeEntity; edges: DependencyEdge[] }
  | { kind: 'project'; label: string; project: ProjectNodeEntity; edges: DependencyEdge[] }
  | { kind: 'video'; label: string; video: VideoNodeEntity; edges: DependencyEdge[] }
  | { kind: 'classroom'; label: string; classroom: ClassroomEntity; edges: DependencyEdge[] }


/* ---------- 捕获（删除前调用，拿到的是旧 store） ---------- */

/** 删除节点 / 目标前备货：与 deleteNode、deleteGoal 的级联逐项对应 */
export function captureNodeDelete(store: LearnStore, nodeId: string): ExplorerUndo | null {
  // 只有显式传目标 id 才是删目标；rootNodeId 已降级成目录锚点，不再让删一个文档变成删目标
  const goal = store.goals.find((g) => g.id === nodeId)
  if (goal) {
    const removed = goalSubtreeIds(store, goal.id)
    const tmp: Record<string, Record<string, TmpEntry>> = {}
    for (const id of removed) {
      const bucket = store.tmp?.[id]
      if (bucket) tmp[id] = bucket
    }
    const goalTitle =
      goal.title ||
      goal.question ||
      (goal.rootNodeId ? store.nodes.find((n) => n.id === goal.rootNodeId)?.title : '') ||
      t('未命名目标')
    return {
      kind: 'node',
      label: t('删除目标「{0}」', goalTitle),
      goalId: goal.id,
      nodes: store.nodes.filter((n) => removed.has(n.id)),
      edges: store.edges.filter((e) => removed.has(e.from) || removed.has(e.to)),
      exams: store.exams.filter((e) => removed.has(e.nodeId)),
      goal,
      conversations: store.conversations.filter((c) => c.goalId === goal.id),
      videoNodes: (store.videoNodes ?? []).filter((v) => v.goalId === goal.id),
      fileNodes: (store.fileNodes ?? []).filter((f) => f.goalId === goal.id),
      tmp,
    }
  }
  const node = nodeById(store, nodeId)
  if (!node) return null
  const anchor = store.goals.find((g) => g.id === node.goalId)?.rootNodeId === nodeId
  return {
    kind: 'node',
    label: t('删除「{0}」', node.title),
    goalId: node.goalId,
    nodes: [node],
    edges: store.edges.filter((e) => e.from === nodeId || e.to === nodeId),
    exams: store.exams.filter((e) => e.nodeId === nodeId),
    conversations: [],
    ...(anchor ? { anchorOf: nodeId } : {}),
    tmp: store.tmp?.[nodeId] ? { [nodeId]: store.tmp[nodeId] } : {},
  }
}

/**
 * 画布删除的通用备货：按 uuid 认实体类型，覆盖 NodeService.delete 的每一种落点。
 * 文档 / 目标仍走 captureNodeDelete（它按级联捕获得更全）；挂件与游离实体各自
 * 捕获自己的那一条记录和两端树边。认不出返回 null，画布就不会 push 一条假撤回。
 */
export function captureCanvasDelete(store: LearnStore, uuid: string): ExplorerUndo | null {
  const id = (uuid ?? '').trim()
  if (!id) return null
  if (store.goals.some((g) => g.id === id) || nodeById(store, id)) return captureNodeDelete(store, id)

  // 大纲：附身大纲（清空计划）与游离大纲（删实体）是两种存储，但画布上都是 o: 前缀
  if (id.startsWith('o:')) {
    const docId = id.slice(2)
    const host = nodeById(store, docId)
    if (host?.outline) {
      return {
        kind: 'outline',
        label: t('删除「{0}」的大纲', host.title),
        uuid: id,
        attached: host.outline,
        edges: store.edges.filter((e) => e.from === id || e.to === id),
      }
    }
    const entity = (store.outlines ?? []).find((o) => o.id === docId)
    if (entity) {
      return {
        kind: 'outline',
        label: t('删除独立大纲「{0}」', entity.title),
        uuid: id,
        entity,
        edges: store.edges.filter((e) => e.from === id || e.to === id),
      }
    }
  }

  const note = findNoteEntity(store, id)
  if (note) {
    if (note.hostId) return captureNoteDelete(store, note.hostId, note.note.name)
    return { kind: 'detached-note', label: t('删除笔记「{0}」', note.note.name), goalId: note.goalId, note: { ...note.note } }
  }
  const sdoc = findSuperDocEntity(store, id)
  if (sdoc) {
    if (sdoc.hostId) return captureSuperDelete(store, sdoc.hostId, sdoc.doc.name)
    return { kind: 'detached-super', label: t('删除超级文档「{0}」', sdoc.doc.name), goalId: sdoc.goalId, doc: { ...sdoc.doc } }
  }
  const exam = store.exams.find((e) => e.id === id)
  if (exam) return captureExamDelete(store, id)

  const touching = (nodeId: string) => store.edges.filter((e) => e.from === nodeId || e.to === nodeId)
  const file = (store.fileNodes ?? []).find((f) => f.id === id)
  if (file) {
    return {
      kind: 'file',
      label: t('删除文件节点「{0}」', file.title),
      file,
      edges: touching(id),
    }
  }
  const project = (store.projects ?? []).find((p) => p.id === id)
  if (project) {
    return {
      kind: 'project',
      label: t('删除项目节点「{0}」', project.title),
      project,
      edges: touching(id),
    }
  }
  const video = (store.videoNodes ?? []).find((v) => v.id === id)
  if (video) {
    return {
      kind: 'video',
      label: t('删除视频节点「{0}」', video.title || id),
      video,
      edges: touching(id),
    }
  }
  const classroom = (store.classrooms ?? []).find((c) => c.id === id)
  if (classroom) {
    return {
      kind: 'classroom',
      label: t('删除课堂节点「{0}」', classroom.title),
      classroom,
      edges: touching(id),
    }
  }
  return null
}

/** 删除一份笔记前备货（正文与它那一片阅读记录一起） */
export function captureNoteDelete(store: LearnStore, nodeId: string, name: string): ExplorerUndo | null {
  const node = nodeById(store, nodeId)
  const note = node ? findNote(notesOf(node), name) : undefined
  if (!node || !note) return null
  return {
    kind: 'note',
    label: t('删除笔记「{0}」', note.name),
    nodeId,
    note: { ...note },
  }
}

/** 删除一份超级文档前备货（名字按真实的那一份算：findSuperDoc 不区分大小写） */
export function captureSuperDelete(store: LearnStore, nodeId: string, name: string): ExplorerUndo | null {
  const node = nodeById(store, nodeId)
  const doc = node ? findSuperDoc(superDocsOf(node), name) : undefined
  if (!node || !doc) return null
  return {
    kind: 'super',
    label: t('删除超级文档「{0}」', doc.name),
    nodeId,
    doc: { ...doc },
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

/** 把撤回条目里的边接回 store（按 from+to 去重，重复撤回不会长双线） */
function withBackEdges(store: LearnStore, edges: DependencyEdge[]): LearnStore {
  const existing = new Set(store.edges.map((e) => e.from + '\u0001' + e.to))
  const back = edges.filter((e) => !existing.has(e.from + '\u0001' + e.to))
  return back.length ? { ...store, edges: [...store.edges, ...back] } : store
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
      s = {
        ...s,
        goals: [...s.goals, goal],
        conversations: [...s.conversations, ...entry.conversations.filter((c) => !s.conversations.some((x) => x.id === c.id))],
      }
    }
    // 删的若是旧数据里的目录锚点，撤回时把锚点指回它；否则目标会继续用临时挑的替代节点
    if (entry.anchorOf) {
      s = {
        ...s,
        goals: s.goals.map((g) => (g.id === entry.goalId ? { ...g, rootNodeId: entry.anchorOf! } : g)),
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
    // 视频节点原样接回（引用旧片，不会重复——删除时是按 goalId 摘的），资源镜像随之重建
    if (entry.videoNodes?.length) {
      const back = entry.videoNodes.filter((v) => !(s.videoNodes ?? []).some((x) => x.id === v.id))
      if (back.length) next = withVideoMirror({ ...next, videoNodes: [...(next.videoNodes ?? []), ...back] })
    }
    if (entry.fileNodes?.length) {
      const back = entry.fileNodes.filter((f) => !(s.fileNodes ?? []).some((x) => x.id === f.id))
      if (back.length) next = { ...next, fileNodes: [...(next.fileNodes ?? []), ...back] }
    }
    // 节点带回来的挂件以节点记录里的那份为准：游离池里的孤儿副本（删除时挪进去的）清掉
    const restoredIds = new Set(
      backNodes.flatMap((n) => [...(n.notes ?? []).map((x) => x.id), ...(n.superdocs ?? []).map((x) => x.id)]),
    )
    next = scrubDetached(next, restoredIds)
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
    return { store: next, ok: true, message: t('已撤回：{0}', entry.label) }
  }
  if (entry.kind === 'detached-note') {
    if (findNoteEntity(s, entry.note.id)) return { store, ok: false, message: t('这份笔记已经在了，没有重复撤回') }
    const pool = detachedPoolOf(s, entry.goalId)
    return {
      store: withDetached(s, entry.goalId, { ...pool, notes: [...pool.notes, entry.note] }),
      ok: true,
      message: t('已撤回：{0}', entry.label),
    }
  }
  if (entry.kind === 'detached-super') {
    if (findSuperDocEntity(s, entry.doc.id)) return { store, ok: false, message: t('这份超级文档已经在了，没有重复撤回') }
    const pool = detachedPoolOf(s, entry.goalId)
    return {
      store: withDetached(s, entry.goalId, { ...pool, superdocs: [...pool.superdocs, entry.doc] }),
      ok: true,
      message: t('已撤回：{0}', entry.label),
    }
  }
  if (entry.kind === 'outline') {
    const docId = entry.uuid.startsWith('o:') ? entry.uuid.slice(2) : entry.uuid
    let next = s
    if (entry.attached) {
      const host = nodeById(s, docId)
      if (!host) return { store, ok: false, message: t('撤回失败：那份大纲的宿主文档已经不在了') }
      if (host.outline) return { store, ok: false, message: t('这份大纲已经在了，没有重复撤回') }
      next = { ...s, nodes: s.nodes.map((n) => (n.id === docId ? { ...n, outline: entry.attached } : n)) }
    } else if (entry.entity) {
      if ((s.outlines ?? []).some((o) => o.id === entry.entity!.id)) {
        return { store, ok: false, message: t('这份独立大纲已经在了，没有重复撤回') }
      }
      next = { ...s, outlines: [...(s.outlines ?? []), entry.entity] }
    } else {
      return { store, ok: false, message: t('这条撤回记录不完整') }
    }
    return { store: withBackEdges(next, entry.edges), ok: true, message: t('已撤回：{0}', entry.label) }
  }
  if (entry.kind === 'file') {
    if ((s.fileNodes ?? []).some((f) => f.id === entry.file.id)) {
      return { store, ok: false, message: t('这个文件节点已经在了，没有重复撤回') }
    }
    const next = withBackEdges({ ...s, fileNodes: [...(s.fileNodes ?? []), entry.file] }, entry.edges)
    // 本地文件在删除时已从磁盘移除：节点能回来，字节回不来，如实说明
    const loss = entry.file.fileKind === 'local' ? t('（节点已恢复；原本地文件已从磁盘删除）') : ''
    return { store: next, ok: true, message: t('已撤回：{0}{1}', entry.label, loss) }
  }
  if (entry.kind === 'project') {
    if ((s.projects ?? []).some((p) => p.id === entry.project.id)) {
      return { store, ok: false, message: t('这个项目节点已经在了，没有重复撤回') }
    }
    return {
      store: withBackEdges({ ...s, projects: [...(s.projects ?? []), entry.project] }, entry.edges),
      ok: true,
      message: t('已撤回：{0}', entry.label),
    }
  }
  if (entry.kind === 'video') {
    if ((s.videoNodes ?? []).some((v) => v.id === entry.video.id)) {
      return { store, ok: false, message: t('这个视频节点已经在了，没有重复撤回') }
    }
    const back = withVideoMirror({ ...s, videoNodes: [...(s.videoNodes ?? []), entry.video] })
    return { store: withBackEdges(back, entry.edges), ok: true, message: t('已撤回：{0}', entry.label) }
  }
  if (entry.kind === 'classroom') {
    if ((s.classrooms ?? []).some((c) => c.id === entry.classroom.id)) {
      return { store, ok: false, message: t('这个课堂节点已经在了，没有重复撤回') }
    }
    return {
      store: withBackEdges({ ...s, classrooms: [...(s.classrooms ?? []), entry.classroom] }, entry.edges),
      ok: true,
      message: t('已撤回：{0}', entry.label),
    }
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
