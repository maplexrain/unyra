/**
 * 计算文档区当前节点的关联节点（抹平大纲层）：
 * 沿知识图谱与挂件归属关系，派生出「上级」、「下级」、「同级」三类节点。
 *
 * 核心原则：
 * 1. 抹平大纲层：大纲节点（附身大纲 o:docId 与游离大纲 o:entityId）作为透明过渡枢纽，
 *    在关系列表中不直接显示为一项，而是贯通两端的真实内容实体（文档-大纲-文档 => 文档-文档）。
 * 2. 分类归属：
 *    - 上级（Parent）：上游文档/视频/文件等；若当前处于笔记/超级文档/试卷页签，当前所属教学文档亦为上级。
 *    - 下级（Child）：下游文档、当前节点名下的笔记、超级文档、试卷、绑定的视频/文件等。
 *    - 同级（Sibling）：共享上级父节点的其他文档；处于笔记/超级文档/试卷页签时，同属该宿主节点的其他附件亦为同级。
 */

import type { LearnStore, TabRef } from '../../../learn/types'
import { notesOf } from '../../../learn/notes'
import { superDocsOf } from '../../../learn/types'
import { examsOfNode } from '../../../learn/graph'

export type RelationKind = 'doc' | 'note' | 'super' | 'exam' | 'video' | 'file'

export interface RelationItem {
  id: string
  title: string
  kind: RelationKind
  tabRef: TabRef
  badgeLabel: string
  nodeId: string
  examId?: string
  attemptsCount?: number
}

export interface NodeRelations {
  parents: RelationItem[]
  children: RelationItem[]
  siblings: RelationItem[]
  totalCount: number
}

/**
 * 判断某个图成员 ID 是否是大纲（附身或游离）
 */
function isOutlineMember(store: LearnStore, id: string): boolean {
  if (id.startsWith('o:')) return true
  return (store.outlines ?? []).some((o) => o.id === id)
}

/**
 * 若该成员属于某文档的附身大纲，返回其宿主文档 ID；否则返回 null
 */
function attachedDocIdOf(store: LearnStore, id: string): string | null {
  if (!id.startsWith('o:')) return null
  const raw = id.slice(2)
  return store.nodes.some((n) => n.id === raw) ? raw : null
}

/**
 * 树成员 ID 转换为真实节点实体（文档/视频/文件）
 */
function resolveRealNode(
  store: LearnStore,
  id: string,
): { kind: 'doc' | 'video' | 'file'; title: string; tabRef: TabRef; nodeId: string } | null {
  // 1. 检查附身大纲指向的宿主文档
  const attDocId = attachedDocIdOf(store, id)
  if (attDocId) {
    const doc = store.nodes.find((n) => n.id === attDocId)
    if (doc) return { kind: 'doc', title: doc.title, tabRef: { kind: 'teach', nodeId: doc.id }, nodeId: doc.id }
  }

  // 2. 检查普通文档
  const doc = store.nodes.find((n) => n.id === id)
  if (doc) {
    return { kind: 'doc', title: doc.title, tabRef: { kind: 'teach', nodeId: doc.id }, nodeId: doc.id }
  }

  // 3. 检查视频节点
  const video = store.videoNodes?.find((v) => v.id === id)
  if (video) {
    return {
      kind: 'video',
      title: video.title ?? '未命名视频',
      tabRef: { kind: 'video', videoId: video.videoId ?? '' },
      nodeId: video.id,
    }
  }

  // 4. 检查文件节点
  const file = store.fileNodes?.find((f) => f.id === id)
  if (file) {
    return {
      kind: 'file',
      title: file.title ?? '未命名文件',
      tabRef: { kind: 'local', path: file.url ?? '' },
      nodeId: file.id,
    }
  }

  return null
}

export function kindToBadgeLabel(kind: RelationKind): string {
  switch (kind) {
    case 'doc':
      return '文档'
    case 'note':
      return '笔记'
    case 'super':
      return '超级文档'
    case 'exam':
      return '试卷'
    case 'video':
      return '视频'
    case 'file':
      return '文件'
  }
}

/**
 * 沿 store.edges 抹平大纲层进行有向拓扑遍历
 */
function findDirectRealRelatives(
  store: LearnStore,
  startNodeId: string,
  direction: 'up' | 'down',
): RelationItem[] {
  const edges = store.edges ?? []
  const outAdj = new Map<string, string[]>()
  const inAdj = new Map<string, string[]>()

  for (const e of edges) {
    let o = outAdj.get(e.from)
    if (!o) {
      o = []
      outAdj.set(e.from, o)
    }
    o.push(e.to)

    let i = inAdj.get(e.to)
    if (!i) {
      i = []
      inAdj.set(e.to, i)
    }
    i.push(e.from)
  }

  const adj = direction === 'up' ? inAdj : outAdj
  // 起始节点及其附身大纲发声身份
  const startSeeds = [startNodeId, 'o:' + startNodeId]
  const visited = new Set<string>(startSeeds)
  const queue: string[] = [...startSeeds]
  const result: RelationItem[] = []
  const seenIds = new Set<string>([startNodeId])

  while (queue.length > 0) {
    const curr = queue.shift()!
    const neighbors = adj.get(curr) ?? []

    for (const next of neighbors) {
      if (visited.has(next)) continue
      visited.add(next)

      const real = resolveRealNode(store, next)
      if (real) {
        if (!seenIds.has(real.nodeId)) {
          seenIds.add(real.nodeId)
          result.push({
            id: real.nodeId,
            title: real.title,
            kind: real.kind,
            tabRef: real.tabRef,
            badgeLabel: kindToBadgeLabel(real.kind),
            nodeId: real.nodeId,
          })
        }
        // 遇到真实节点即停止该分支继续深入（已跨越大纲层到达直接真实邻居）
      } else if (isOutlineMember(store, next)) {
        // 大纲节点作为透明中间层，继续向下/向上遍历
        queue.push(next)
      }
    }
  }

  return result
}

/**
 * 计算给定节点（与当前页签）的完整关联列表（上级、下级、同级）
 */
export function computeRelations(
  store: LearnStore | null | undefined,
  currentNodeId: string | null | undefined,
  currentTabRef?: TabRef | null,
): NodeRelations {
  const empty: NodeRelations = { parents: [], children: [], siblings: [], totalCount: 0 }
  if (!store || !currentNodeId) return empty

  const node = store.nodes.find((n) => n.id === currentNodeId)
  if (!node) return empty

  // 1. 图谱层面的直接真实父节点（已抹平大纲层）
  const graphParents = findDirectRealRelatives(store, currentNodeId, 'up')

  // 2. 图谱层面的直接真实子节点（已抹平大纲层）
  const graphChildren = findDirectRealRelatives(store, currentNodeId, 'down')

  // 3. 当前节点自身的挂件（笔记、超级文档、试卷）
  const selfNotes: RelationItem[] = notesOf(node).map((note) => ({
    id: note.id,
    title: note.name,
    kind: 'note',
    tabRef: { kind: 'note', nodeId: node.id, note: note.name },
    badgeLabel: kindToBadgeLabel('note'),
    nodeId: node.id,
  }))

  const selfSuperDocs: RelationItem[] = superDocsOf(node).map((sdoc) => ({
    id: sdoc.id,
    title: sdoc.name,
    kind: 'super',
    tabRef: { kind: 'super', nodeId: node.id, name: sdoc.name },
    badgeLabel: kindToBadgeLabel('super'),
    nodeId: node.id,
  }))

  const selfExams: RelationItem[] = examsOfNode(store, node.id).map((exam) => ({
    id: exam.id,
    title: exam.title,
    kind: 'exam',
    tabRef:
      exam.attempts && exam.attempts.length > 0
        ? {
            kind: 'exam',
            nodeId: exam.nodeId,
            examId: exam.id,
            attemptId: exam.attempts[exam.attempts.length - 1].id,
          }
        : { kind: 'teach', nodeId: exam.nodeId },
    badgeLabel: kindToBadgeLabel('exam'),
    nodeId: node.id,
    examId: exam.id,
    attemptsCount: exam.attempts.length,
  }))

  // 4. 计算同级兄弟文档（共享相同直接上级父节点的所有文档节点）
  const siblingItemMap = new Map<string, RelationItem>()
  if (graphParents.length > 0) {
    for (const parent of graphParents) {
      const parentChildren = findDirectRealRelatives(store, parent.nodeId, 'down')
      for (const child of parentChildren) {
        if (child.nodeId !== currentNodeId && !siblingItemMap.has(child.id)) {
          siblingItemMap.set(child.id, child)
        }
      }
    }
  } else {
    // 根节点（没有父级）：同目标下其他无上级的根节点视为同级
    const otherRoots = (store.nodes ?? []).filter(
      (n) =>
        n.goalId === node.goalId &&
        n.id !== currentNodeId &&
        findDirectRealRelatives(store, n.id, 'up').length === 0,
    )
    for (const r of otherRoots) {
      siblingItemMap.set(r.id, {
        id: r.id,
        title: r.title,
        kind: 'doc',
        tabRef: { kind: 'teach', nodeId: r.id },
        badgeLabel: kindToBadgeLabel('doc'),
        nodeId: r.id,
      })
    }
  }

  // 5. 根据当前激活的页签（教学文档 / 笔记 / 超级文档 / 试卷）微调视角分类
  const isNoteTab = currentTabRef?.kind === 'note'
  const isSuperTab = currentTabRef?.kind === 'super'
  const isExamTab = currentTabRef?.kind === 'exam'

  let finalParents: RelationItem[] = []
  let finalChildren: RelationItem[] = []
  let finalSiblings: RelationItem[] = []

  const teachDocItem: RelationItem = {
    id: node.id,
    title: node.title,
    kind: 'doc',
    tabRef: { kind: 'teach', nodeId: node.id },
    badgeLabel: kindToBadgeLabel('doc'),
    nodeId: node.id,
  }

  if (isNoteTab) {
    // 视角在笔记上：所属教学文档为上级，其他挂件与兄弟节点为同级，图谱下游为下级
    const currentNoteName = currentTabRef.note
    finalParents = [teachDocItem, ...graphParents]
    finalChildren = [...graphChildren]
    finalSiblings = [
      ...selfNotes.filter((n) => n.title !== currentNoteName),
      ...selfSuperDocs,
      ...selfExams,
      ...Array.from(siblingItemMap.values()),
    ]
  } else if (isSuperTab) {
    // 视角在超级文档上
    const currentSuperName = currentTabRef.name
    finalParents = [teachDocItem, ...graphParents]
    finalChildren = [...graphChildren]
    finalSiblings = [
      ...selfSuperDocs.filter((s) => s.title !== currentSuperName),
      ...selfNotes,
      ...selfExams,
      ...Array.from(siblingItemMap.values()),
    ]
  } else if (isExamTab) {
    // 视角在试卷上
    const currentExamId = currentTabRef.examId
    finalParents = [teachDocItem, ...graphParents]
    finalChildren = [...graphChildren]
    finalSiblings = [
      ...selfExams.filter((e) => e.examId !== currentExamId),
      ...selfNotes,
      ...selfSuperDocs,
      ...Array.from(siblingItemMap.values()),
    ]
  } else {
    // 默认视角在教学文档上（或全局节点）：
    // 上级 = 图谱父级
    // 下级 = 图谱子级 + 自身笔记 + 自身超级文档 + 自身试卷
    // 同级 = 兄弟文档
    finalParents = [...graphParents]
    finalChildren = [...graphChildren, ...selfNotes, ...selfSuperDocs, ...selfExams]
    finalSiblings = [...Array.from(siblingItemMap.values())]
  }

  // 查重与互斥清理：保证三类之间互不重复
  const seenAll = new Set<string>()
  const cleanParents: RelationItem[] = []
  for (const item of finalParents) {
    if (!seenAll.has(item.id)) {
      seenAll.add(item.id)
      cleanParents.push(item)
    }
  }

  const cleanChildren: RelationItem[] = []
  for (const item of finalChildren) {
    if (!seenAll.has(item.id)) {
      seenAll.add(item.id)
      cleanChildren.push(item)
    }
  }

  const cleanSiblings: RelationItem[] = []
  for (const item of finalSiblings) {
    if (!seenAll.has(item.id)) {
      seenAll.add(item.id)
      cleanSiblings.push(item)
    }
  }

  return {
    parents: cleanParents,
    children: cleanChildren,
    siblings: cleanSiblings,
    totalCount: cleanParents.length + cleanChildren.length + cleanSiblings.length,
  }
}
