/**
 * 本文件负责：知识节点本身的增删改查——建点、改名、改正文、删点，以及节点的结构位次
 * （祖先 / 兄弟 / 知识深度）。笔记、考试、对话、阅读账都在各自的文件里。
 */
import type { DocKind, KnowledgeNode, LearnStore } from '../types'
import { emptyDocs, emptyOutline } from '../types'
import { withVisit } from '../learning'
import { withoutTmpNodes } from '../../lib/tmpStore'
import { allTabs, closeIds } from '../groups'
import { tabIdsOfNode } from '../tabs'
import { dropDrafts } from '../drafts'
import { pruneReading } from '../reading'
import { nodeById } from './lookup'
import { addEdge, parentIds, pathToRoot, prereqIds } from './edges'
import { ensureConversation } from './conversations'
import { deleteGoal, onNodeReadingPatch } from './reading'
import { retargetStaticRefs } from '../static/location'

export { goalById, nodeById } from './lookup'

/** 归一化去重键：忽略大小写与所有空白 */
export function normalizeKey(title: string): string {
  return title.trim().toLowerCase().replace(/[\s\u3000]+/g, '')
}

/** 某节点在目标内的所有祖先（向上），用于判断归属 */
export function ancestors(store: LearnStore, id: string): string[] {
  const seen = new Set<string>([id])
  const stack = [id]
  const out: string[] = []
  while (stack.length) {
    const cur = stack.pop() as string
    for (const pid of parentIds(store, cur)) {
      if (seen.has(pid)) continue
      seen.add(pid)
      out.push(pid)
      stack.push(pid)
    }
  }
  return out
}

/* ---------- 写操作 ---------- */

export function replaceNode(store: LearnStore, node: KnowledgeNode): LearnStore {
  return { ...store, nodes: store.nodes.map((n) => (n.id === node.id ? node : n)) }
}

/**
 * 新增节点。以「同一目标内 key 相同」为去重依据：
 * 同一目标里已存在的知识点会复用（DAG 语义），不同目标互不影响。
 */
export function addNode(
  store: LearnStore,
  input: {
    title: string
    goalId: string
    description?: string
    docs?: Partial<Record<DocKind, string>>
    origin?: 'ai' | 'user'
  },
): { store: LearnStore; node: KnowledgeNode; created: boolean } {
  const title = input.title.trim()
  const key = normalizeKey(title)
  const existing = store.nodes.find((n) => n.key === key && n.goalId === input.goalId)
  if (existing) return { store, node: existing, created: false }

  const now = Date.now()
  const node: KnowledgeNode = {
    id: crypto.randomUUID(),
    title,
    key,
    description: input.description ?? '',
    docs: { ...emptyDocs(), ...(input.docs ?? {}) },
    notes: [],
    annotations: [],
    status: 'learning',
    origin: input.origin ?? 'user',
    goalId: input.goalId,
    /*
     * 大纲与教学文档在创建这一刻**同时**成形（见 OutlineDoc）：
     * 教学文档落 `{节点}.md`、大纲落 `{节点}.outline.json`，都是空的，
     * 等导师（或用户）往里写。老数据没有这一项也不补——那份大纲是「还没有」，不是「空」。
     */
    outline: { ...emptyOutline(), updatedAt: now },
    createdAt: now,
    updatedAt: now,
  }
  return { store: { ...store, nodes: [...store.nodes, node] }, node, created: true }
}

export function updateNode(
  store: LearnStore,
  id: string,
  patch: Partial<
    Pick<
      KnowledgeNode,
      'title' | 'description' | 'docs' | 'notes' | 'status' | 'goalId' | 'annotations'
    >
  >,
): LearnStore {
  const node = nodeById(store, id)
  if (!node) return store
  const next: KnowledgeNode = { ...node, ...patch, updatedAt: Date.now() }
  if (patch.title !== undefined) next.key = normalizeKey(patch.title)
  const replaced = replaceNode(store, next)
  if (patch.title !== undefined && patch.title.trim() !== node.title.trim()) {
    const goal = store.goals.find((g) => g.rootNodeId === id)
    if (goal) {
      return retargetStaticRefs(replaced, goal.id)
    }
  }
  return replaced
}

/**
 * 只改**教学文档**的正文；节点不存在时原样返回。
 *
 * 笔记不在这里：一个节点有多份笔记，一份笔记一个文件（见 learn/notes 与下面的
 * writeNote / createNote）。原先这个函数按 kind 取键写进 docs，笔记改成列表之后
 * 那个键已经不存在了——再按老样子调用会写出一条永远读不回来的数据。
 */
export function updateDoc(store: LearnStore, id: string, content: string): LearnStore {
  const node = nodeById(store, id)
  if (!node) return store
  return updateNode(store, id, { docs: { ...node.docs, teaching: content } })
}

/**
 * 改标题会不会撞上同目标里的另一个节点。
 *
 * 去重键（normalizeKey）在同一目标内唯一是整套路径寻址的前提——按标题找一个节点
 * 必须只有一个答案。addNode 靠「已存在就复用」维持它，改名这条路得自己挡住重名，
 * 否则两个节点同名之后，path 就再也说不清指的是哪一个。
 */
export function titleTaken(
  store: LearnStore,
  goalId: string,
  title: string,
  exceptId?: string,
): KnowledgeNode | undefined {
  const key = normalizeKey(title)
  return store.nodes.find((n) => n.goalId === goalId && n.key === key && n.id !== exceptId)
}

/** 目标内是否已有同名节点（去重用的判断，语义与 addNode 一致） */
export function findNodeByTitle(store: LearnStore, goalId: string, title: string): KnowledgeNode | undefined {
  const key = normalizeKey(title)
  return store.nodes.find((n) => n.goalId === goalId && n.key === key)
}

/** 打开一个知识点：记下访问次数与最近学习时间（学习行为的两个最小事实） */
export function touchNode(store: LearnStore, id: string, now = Date.now()): LearnStore {
  const node = nodeById(store, id)
  if (!node) return store
  return replaceNode(store, withVisit(node, now))
}

/**
 * 知识深度：从学习目标（根节点）走到这个节点有几条依赖边。
 *
 * **它描述的是知识结构，不是学习者**（见 design 文档第六节）。「链式法则在第 4 层」
 * 只说明它依赖了 4 层前置概念，推不出「学习者基础差」——那要看掌握度与错题。
 * 名字里带 knowledge 就是为了挡住那种顺手误用：depth 是图的深度。
 */
export function knowledgeDepth(store: LearnStore, id: string): number {
  const node = nodeById(store, id)
  if (!node) return 0
  const goal = store.goals.find((g) => g.id === node.goalId)
  if (!goal) return 0
  const chain = pathToRoot(store, goal.rootNodeId, id)
  // pathToRoot 给的是 [根, …, 本节点]；边数就是层数，根自己是第 0 层
  return chain ? chain.length - 1 : 0
}

/**
 * 在父节点之下挂一个前置节点：建点（目标内去重）+ 建边 + 保证目标有会话。
 * 返回新节点、它是否是复用的已有节点，以及目标当前的会话 id。
 *
 * 会话是**目标级**的，所以这里不再「给新节点建一个对话」——新节点直接落到
 * 目标那份既有上下文里，Agent 因此带着「刚在父节点讲过什么」继续往下写。
 */
export function createChildNode(
  store: LearnStore,
  parentId: string,
  title: string,
): { store: LearnStore; node: KnowledgeNode; created: boolean; conversationId: string } {
  const parent = nodeById(store, parentId)
  if (!parent) throw new Error('父节点不存在')
  const added = addNode(store, { title, goalId: parent.goalId, origin: 'ai' })
  let next = added.store
  if (added.node.id !== parentId) {
    next = addEdge(next, parentId, added.node.id).store
  }
  const ensured = ensureConversation(next, parent.goalId)
  return { store: ensured.store, node: added.node, created: added.created, conversationId: ensured.conversationId }
}

/**
 * 建一个节点并挂到 parent 之下（Agent 的 api.node.create 走这条路）。
 * 与 createChildNode 的差别只在返回值：这里不需要会话 id，但要能区分「新建」与「复用了同名节点」。
 */
export function createNodeUnder(
  store: LearnStore,
  parentId: string,
  input: { title: string; description?: string; origin?: 'ai' | 'user' },
): { store: LearnStore; node: KnowledgeNode; created: boolean } {
  const parent = nodeById(store, parentId)
  if (!parent) throw new Error('父节点不存在')
  const added = addNode(store, {
    title: input.title,
    goalId: parent.goalId,
    description: input.description,
    origin: input.origin ?? 'ai',
  })
  let next = added.store
  if (added.created && added.node.id !== parentId) {
    next = addEdge(next, parentId, added.node.id).store
  }
  return { store: next, node: added.node, created: added.created }
}

/**
 * 把一个节点迁移到另一个节点之下（Agent 的 api.node.move 走这里）。
 *
 * 语义是「改这条父线」而不是「再多挂一个父节点」：先摘掉它现在的全部父边，
 * 再挂到新父节点之下——侧栏与大纲都按单一父线读层级，多父线会让「它在哪一层」
 * 变成一道多选题。因此本来就有多个父节点（DAG 里被复用过）的节点，move 之后
 * 只剩新父节点这一条线。
 *
 * 四条硬边界：总目标的根不能动（它挂着整个目标）、跨目标不迁（阅读与打卡的账
 * 都按目标分开，搬过去就成无主账）、不能挂到自己之下、不能挂到自己的下级之下
 * （那是一个环）。复用与边注册的口径与 createNodeUnder 一致。
 */
export function moveNode(
  store: LearnStore,
  id: string,
  newParentId: string,
): { store: LearnStore; moved: boolean; message: string } {
  const node = nodeById(store, id)
  const parent = nodeById(store, newParentId)
  if (!node) return { store, moved: false, message: '要移动的节点不存在' }
  if (!parent) return { store, moved: false, message: '新父节点不存在' }
  if (store.goals.some((g) => g.rootNodeId === id)) {
    return { store, moved: false, message: '「' + node.title + '」是一个目标的根（总目标），不能挂到别的节点之下' }
  }
  if (node.goalId !== parent.goalId) {
    return { store, moved: false, message: '跨目标迁移暂不支持：「' + node.title + '」属于另一个目标' }
  }
  if (id === newParentId) {
    return { store, moved: false, message: '不能把一个节点挂到它自己之下' }
  }
  if (ancestors(store, newParentId).includes(id)) {
    return {
      store,
      moved: false,
      message: '「' + parent.title + '」在「' + node.title + '」自己的下级里，这样挂会成一个环',
    }
  }
  const parents = parentIds(store, id)
  if (parents.length === 1 && parents[0] === newParentId) {
    return { store, moved: false, message: '「' + node.title + '」已经在「' + parent.title + '」之下了，无需移动' }
  }
  const detached = { ...store, edges: store.edges.filter((e) => e.to !== id) }
  const r = addEdge(detached, newParentId, id)
  return { store: r.store, moved: r.added, message: r.added ? '' : '移动没有生效：新的父子边没能挂上' }
}

/**
 * 删除单个节点：连带它的边、试卷与临时变量；若它是某个目标的根，则整棵子树一并删除。
 *
 * **会话不动**：上下文属于目标，删掉一个节点不代表「这个目标聊过的事」就不算数了——
 * 那正是节点级隔离改成目标级之后该有的样子。
 */
export function deleteNode(store: LearnStore, id: string): LearnStore {
  const goal = store.goals.find((g) => g.rootNodeId === id)
  if (goal) return deleteGoal(store, goal.id)
  const node = nodeById(store, id)
  if (!node) return store
  const parents = parentIds(store, id)
  // 节点没了，指着它的页签也得关掉：留着就成了「打开着一份不存在的东西」
  //（关完可能有一格空了，closeIds 顺手把它收掉，兄弟那一格自然铺满）
  const doomed = tabIdsOfNode(allTabs(store.docArea), id)
  const nodes = store.nodes.filter((n) => n.id !== id)
  return {
    ...store,
    nodes,
    // 它的有效阅读记录也一起清掉：留着就是一条指向不存在节点的空索引（见 learn/reading 的 pruneReading）。
    // 一个节点只属于一个目标，所以只动那一本账
    ...onNodeReadingPatch(store, node, (rec) => pruneReading(rec, new Set(nodes.map((n) => n.id)))),
    edges: store.edges.filter((e) => e.from !== id && e.to !== id),
    exams: store.exams.filter((e) => e.nodeId !== id),
    // 节点没了，它那份临时变量（可能是几十万字符的中间数据）也不该留着
    tmp: withoutTmpNodes(store.tmp, new Set([id])),
    docArea: closeIds(store.docArea, doomed),
    // 节点没了，它那几份没保存的正文也没有落点了（同页签：留着只会占着键）
    drafts: dropDrafts(store.drafts, doomed),
    activeNodeId: store.activeNodeId === id ? (parents[0] ?? null) : store.activeNodeId,
  }
}

/** 当前节点在同一层级的所有兄弟节点（含自身），用于侧栏展示 */
export function siblingIds(store: LearnStore, id: string): string[] {
  const parents = parentIds(store, id)
  if (!parents.length) return [id]
  const set = new Set<string>()
  for (const p of parents) for (const c of prereqIds(store, p)) set.add(c)
  return [...set]
}
