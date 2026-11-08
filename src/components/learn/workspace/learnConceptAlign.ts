/**
 * moji:learn 链接的「对齐」落点：点击创建必须先落进节点宇宙，才允许开讲。
 *
 * 对齐的对象是当前文档节点的**附身大纲**（node.outline；树边里以宿主文档 id 发声）：
 * 概念必须对上大纲目标项列表里的某一条，文档节点从那条目标项的 port 上延伸出来
 * （树边带 portKey 认领——与画布点菱形口、agent connect(down, portKey) 同一套口径）。
 *
 * 三步，缺哪步补哪步：
 * 1. 宿主文档还没有大纲 → 自动补一份空大纲（与 service.create 补大纲同一语义）；
 * 2. 目标项里没有对得上号的概念（normalizeKey(标题) 精确对号，对不上不算「有」）
 *    → 追加一条目标项：标题 = 链接概念名，链接的定位说明写进 summary；
 * 3. 目标项的 port 没有被认领 → 建/复用文档节点并认领；port 已有主 → 直接复用那份文档。
 *
 * 写大纲走 writeOutline：key 一律按标题现算，追加条目不会动既有条目的 key，
 * 已有的认领关系不受影响。同名节点复用时按画布「拖线认领」的同一口径把既有边
 * 补上 portKey（老式 learn 建出来的无 portKey 父边由此迁进认领体系）。
 */
import type { KnowledgeNode, LearnStore, OutlineDoc } from '../../../learn/types'
import { addNode, addEdge, normalizeKey } from '../../../learn/graph'
import { OUTLINE_CHILDREN_MAX, outlineByMember, writeOutline } from '../../../learn/outline'

export interface LearnAlignResult {
  store: LearnStore
  /** 落地文档节点（新建、复用同名或 port 既有认领） */
  nodeId: string
  createdOutline: boolean
  createdEntry: boolean
  /** false = port 既有认领或复用了同名节点（跳转语义，不重开讲） */
  createdDoc: boolean
  entryTitle: string
}

export function alignLearnToOutline(
  store: LearnStore,
  host: KnowledgeNode,
  term: string,
  hint?: string,
): LearnAlignResult | { error: string } {
  const voice = host.id
  const now = Date.now()

  // 1. 大纲：没有就补一份空的（画布补大纲同一落法：实体存在 = 卡在，内容之后写）
  const member = outlineByMember(store, 'o:' + host.id)
  let outline: OutlineDoc | null = member?.kind === 'attached' ? member.outline : null
  let next = store
  let createdOutline = false
  if (!outline) {
    next = {
      ...next,
      nodes: next.nodes.map((n) =>
        n.id === host.id && !n.outline ? { ...n, outline: { intro: '', children: [], updatedAt: now } } : n,
      ),
    }
    outline = { intro: '', children: [], updatedAt: now }
    createdOutline = true
  }

  // 2. 目标项对号：key 由标题生成（writeOutline 的口径），所以按 normalizeKey(标题) 精确对号
  const key = normalizeKey(term)
  let entry = outline.children.find((c) => c.key === key)
  let createdEntry = false
  if (!entry) {
    if (outline.children.length >= OUTLINE_CHILDREN_MAX) {
      return { error: '「' + host.title + '」的大纲目标项已满 ' + OUTLINE_CHILDREN_MAX + ' 条，先整理一下再学新的' }
    }
    const r = writeOutline(
      next,
      host.id,
      { intro: outline.intro, children: [...outline.children, { title: term, summary: hint ?? '' }] },
      now,
    )
    if (!r.ok) return { error: r.error }
    next = r.store
    outline = r.outline
    entry = r.outline.children.find((c) => c.key === key)
    if (!entry) return { error: '目标项没能写进大纲（与现有条目对不上号）' }
    createdEntry = true
  }

  // 3. port 落地。已有主 = 那份文档就是「这一条计划」的落地，跳过去不另建
  const claimed = next.edges.find((e) => e.from === voice && e.portKey === entry.key)
  if (claimed) {
    return { store: next, nodeId: claimed.to, createdOutline, createdEntry, createdDoc: false, entryTitle: entry.title }
  }

  const added = addNode(next, { title: term, goalId: host.goalId, origin: 'ai', ...(hint ? { description: hint } : {}) })
  if (added.node.id === host.id) {
    return { error: '「' + term + '」就是当前文档自己，不需要再学一层' }
  }
  let after = added.store
  const nodeId = added.node.id
  if (!added.created) {
    // 一次归属：这份概念已经在别的目标项 port 上有家了 → 直接跳过去，不再补第二条认领边。
    // 同一概念常同时列进两份计划（根路径 + 某站的「下一步」），先后两次点击若都认领，
    // 文档就挂两头，画布上归属说不清——创建位置由第一次点击的宿主决定，此后只跳转。
    const claimedElsewhere = after.edges.find((e) => e.to === nodeId && e.portKey)
    if (claimedElsewhere) {
      return { store: after, nodeId, createdOutline, createdEntry, createdDoc: false, entryTitle: entry.title }
    }
  }
  if (added.created) {
    const r = addEdge(after, voice, nodeId, entry.key)
    if (!r.added) return { error: r.reason ?? '文档没能挂到目标项「' + entry.title + '」之下' }
    after = r.store
  } else {
    // 复用同名节点（同目标内去重）：把它认领到这个 port。已有这条边（老式 learn 的
    // 无 portKey 父边 / 换了计划）= 改认领；没有这条边 = 新认领（addEdge 内查一对一与成环）
    const existing = after.edges.find((e) => e.from === voice && e.to === nodeId)
    if (existing && existing.portKey !== entry.key) {
      const taken = after.edges.find((e) => e.from === voice && e.portKey === entry.key && e.to !== nodeId)
      if (taken) {
        const other = after.nodes.find((n) => n.id === taken.to)
        return { error: '目标项「' + entry.title + '」已被「' + (other?.title ?? taken.to) + '」认领——一个接口只认领一个下游' }
      }
      after = { ...after, edges: after.edges.map((e) => (e === existing ? { ...e, portKey: entry.key } : e)) }
    } else if (!existing) {
      const r = addEdge(after, voice, nodeId, entry.key)
      if (!r.added) return { error: r.reason ?? '文档没能挂到目标项「' + entry.title + '」之下' }
      after = r.store
    }
  }
  return { store: after, nodeId, createdOutline, createdEntry, createdDoc: added.created, entryTitle: entry.title }
}
