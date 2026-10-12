/**
 * 响应式 VFS 到 LearnStore 的双向同步引擎 (Reactive VFS Store Synchronizer)。
 *
 * 核心机制：
 * 1. 订阅 VFS 总线（vfsBus）的所有文件变更事件（包括 files.write / files.edit 以及底层的 watcher 变动）；
 * 2. 依据声明式路径规则自动定位对应的业务实体与知识点节点；
 * 3. 0ms 乐观把物理文件变更直接反哺到 LearnStore（内存状态）；
 * 4. 驱动 React 视图实时刷新（如超级文档立即在 SuperDocView 渲染、试卷立即在 ExamCopyView / ExamWindow 渲染）；
 * 5. 消除应用内存层与物理磁盘层之间的认知鸿沟，防止旧数据或 0 字节覆盖写入。
 */
import type { KnowledgeNode, LearnStore, SuperDocFile } from '../learn/types'
import { vfsBus } from './bus'
import type { FileChangeEvent } from './types'
import { normalizeRelativePath } from './registry'
import { nodeLayout } from '../learn/layout'
import { parseJson } from '../learn/files/meta'
import type { Exam } from '../learn/exam'

export type StoreSyncListener = (updater: (prev: LearnStore) => LearnStore) => void

let activeStoreListener: StoreSyncListener | null = null

/** 注册当前活跃的 LearnStore 更新器 */
export function registerStoreSyncListener(listener: StoreSyncListener | null): () => void {
  activeStoreListener = listener
  return () => {
    if (activeStoreListener === listener) {
      activeStoreListener = null
    }
  }
}

/** 触发 Store 变更 */
export function dispatchStoreUpdate(updater: (prev: LearnStore) => LearnStore): void {
  if (activeStoreListener) {
    activeStoreListener(updater)
  }
}

/**
 * 将文件变动事件同步应用到 LearnStore
 */
export function syncVfsEventToStore(event: FileChangeEvent, store: LearnStore): LearnStore {
  const norm = normalizeRelativePath(event.relativePath || event.path)
  if (!norm || norm.endsWith('chat.json')) return store

  // 1. 超级文档：docs/.../superdocs/:name.html
  const sdocMatch = norm.match(/(?:^|\/)docs\/(.+)\/superdocs\/([^/]+)\.html$/i)
  if (sdocMatch) {
    const dirPart = sdocMatch[1]
    const rawName = sdocMatch[2]
    const targetNode = findNodeByPathOrDir(store, dirPart)
    if (!targetNode) return store

    const sdocName = decodeURIComponent(rawName)
    const list = targetNode.superdocs ?? []
    if (event.action === 'delete') {
      const nextList = list.filter((d) => d.name.toLowerCase() !== sdocName.toLowerCase())
      return updateNodeInStore(store, targetNode.id, { superdocs: nextList })
    }

    const content = typeof event.content === 'string' ? event.content : ''
    const existing = list.find((d) => d.name.toLowerCase() === sdocName.toLowerCase())
    const now = Date.now()
    const updated: SuperDocFile = {
      name: existing ? existing.name : sdocName,
      html: content,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    }
    const nextList = existing
      ? list.map((d) => (d === existing ? updated : d))
      : [...list, updated]
    return updateNodeInStore(store, targetNode.id, { superdocs: nextList })
  }

  // 2. 试卷：docs/.../exams/:examId.json 或 exams/:examId.json
  const nodeExamMatch = norm.match(/(?:^|\/)docs\/(.+)\/exams\/([^/]+)\.json$/i)
  const rootExamMatch = !nodeExamMatch ? norm.match(/^exams\/([^/]+)\.json$/i) : null
  if (nodeExamMatch || rootExamMatch) {
    const examId = (nodeExamMatch ? nodeExamMatch[2] : rootExamMatch![1]).replace(/\.json$/i, '')
    if (event.action === 'delete') {
      return { ...store, exams: store.exams.filter((e) => e.id !== examId) }
    }

    const rawJson = typeof event.content === 'string' ? event.content : JSON.stringify(event.data)
    const parsed = parseJson<Partial<Exam>>(rawJson)
    if (!parsed || typeof parsed !== 'object') return store

    const dirPart = nodeExamMatch ? nodeExamMatch[1] : undefined
    const targetNode = dirPart ? findNodeByPathOrDir(store, dirPart) : undefined

    const examObj: Exam = {
      id: parsed.id || examId,
      nodeId: parsed.nodeId || targetNode?.id || (store.activeNodeId ?? ''),
      goalId: parsed.goalId || targetNode?.goalId || (store.activeGoalId ?? ''),
      title: parsed.title || '试卷',
      kind: parsed.kind || 'quiz',
      level: parsed.level || 'easy',
      minutes: typeof parsed.minutes === 'number' ? parsed.minutes : 15,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
      attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
    }

    const exists = store.exams.some((e) => e.id === examObj.id)
    const nextExams = exists
      ? store.exams.map((e) => (e.id === examObj.id ? examObj : e))
      : [...store.exams, examObj]
    return { ...store, exams: nextExams }
  }

  // 3. 笔记：docs/.../:title.notes/:name.md
  const noteMatch = norm.match(/(?:^|\/)docs\/(.+)\.notes\/([^/]+)\.md$/i)
  if (noteMatch) {
    const dirPart = noteMatch[1]
    const noteName = decodeURIComponent(noteMatch[2])
    const targetNode = findNodeByPathOrDir(store, dirPart)
    if (!targetNode) return store

    const notes = targetNode.notes ?? []
    if (event.action === 'delete') {
      const nextNotes = notes.filter((n) => n.name.toLowerCase() !== noteName.toLowerCase())
      return updateNodeInStore(store, targetNode.id, { notes: nextNotes })
    }

    const content = typeof event.content === 'string' ? event.content : ''
    const existing = notes.find((n) => n.name.toLowerCase() === noteName.toLowerCase())
    const now = Date.now()
    const updated = {
      name: existing ? existing.name : noteName,
      content,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    }
    const nextNotes = existing
      ? notes.map((n) => (n === existing ? updated : n))
      : [...notes, updated]
    return updateNodeInStore(store, targetNode.id, { notes: nextNotes })
  }

  // 4. 教学文档：docs/.../:title.md
  const docMatch = norm.match(/(?:^|\/)docs\/(.+)\/([^/]+)\.md$/i) || norm.match(/^docs\/([^/]+)\.md$/i)
  if (docMatch) {
    const fullDocPath = norm.slice('docs/'.length, -3) // 去掉 docs/ 和 .md
    if (!fullDocPath.endsWith('.outline') && !fullDocPath.includes('.notes')) {
      const targetNode = findNodeByPathOrDir(store, fullDocPath)
      if (targetNode) {
        const content = typeof event.content === 'string' ? event.content : ''
        return updateNodeInStore(store, targetNode.id, {
          docs: { ...targetNode.docs, teaching: content },
        })
      }
    }
  }

  // 5. 大纲：docs/.../:title.outline.json
  const outlineMatch = norm.match(/(?:^|\/)docs\/(.+)\.outline\.json$/i)
  if (outlineMatch) {
    const dirPart = outlineMatch[1]
    const targetNode = findNodeByPathOrDir(store, dirPart)
    if (targetNode) {
      const content = typeof event.content === 'string' ? event.content : JSON.stringify(event.data)
      const parsed = parseJson(content)
      if (parsed && typeof parsed === 'object') {
        return updateNodeInStore(store, targetNode.id, { outline: parsed as any })
      }
    }
  }

  // 6. 元数据：docs/.../:title.meta.json
  const metaMatch = norm.match(/(?:^|\/)docs\/(.+)\.meta\.json$/i)
  if (metaMatch) {
    const dirPart = metaMatch[1]
    const targetNode = findNodeByPathOrDir(store, dirPart)
    if (targetNode) {
      const content = typeof event.content === 'string' ? event.content : JSON.stringify(event.data)
      const parsed = parseJson<Record<string, unknown>>(content)
      if (parsed && typeof parsed === 'object') {
        const patch: Partial<KnowledgeNode> = {}
        if (typeof parsed.description === 'string') patch.description = parsed.description
        if (typeof parsed.status === 'string') patch.status = parsed.status as any
        if (Object.keys(patch).length > 0) {
          return updateNodeInStore(store, targetNode.id, patch)
        }
      }
    }
  }

  return store
}

/** 辅助：根据路径、目录或标题查找节点 */
export function findNodeByPathOrDir(store: LearnStore, pathOrDir: string): KnowledgeNode | undefined {
  const clean = pathOrDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim()
  if (!clean) return undefined

  // 1. 直接按 ID 查找
  const byId = store.nodes.find((n) => n.id === clean)
  if (byId) return byId

  // 2. 按 nodeLayout 的 dir 查找
  const layout = nodeLayout(store)
  for (const [id, info] of layout) {
    const dirStr = info.dir.join('/')
    if (dirStr === clean || dirStr.endsWith('/' + clean) || clean.endsWith('/' + dirStr)) {
      return store.nodes.find((n) => n.id === id)
    }
  }

  // 3. 按节点标题查找（最后一段）
  const lastSeg = clean.split('/').pop()?.trim().toLowerCase()
  if (lastSeg) {
    const byTitle = store.nodes.find((n) => n.title.toLowerCase() === lastSeg)
    if (byTitle) return byTitle
  }

  return undefined
}

/** 辅助：更新 Store 中的特定节点 */
function updateNodeInStore(
  store: LearnStore,
  nodeId: string,
  patch: Partial<KnowledgeNode>,
): LearnStore {
  const now = Date.now()
  return {
    ...store,
    nodes: store.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch, updatedAt: now } : n)),
  }
}

let syncInitialized = false

/** 初始化 VFS 全局 Store 同步监听 */
export function initVfsStoreSync(): () => void {
  if (syncInitialized) return () => {}
  syncInitialized = true
  return vfsBus.subscribeAll((event) => {
    dispatchStoreUpdate((prev) => syncVfsEventToStore(event, prev))
  })
}
