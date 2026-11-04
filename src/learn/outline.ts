/**
 * 本文件负责：目标大纲（outline，见 types 的 OutlineDoc）的读写与归一。
 *
 * 大纲是**结构化的计划**而不是一份 Markdown：导语 + 直接子目标清单。它存在每个
 * 节点上（node.outline），落盘是 `{节点}.outline.json`——与教学文档 `{节点}.md`
 * 一一配对，「创建一个节点时同步生成教学文档和大纲两个文件」就落在这一对文件上。
 *
 * 深度规矩（OutlineDoc 的说明里也写了）在这里再拦一道：write 只收一层 children，
 * 条目本身没有任何可以再嵌套的地方——形状本身让「写两层」变得不可能，
 * 剩下的（不要在 summary 里替孙辈规划）是指令层的事。
 */
import type { KnowledgeNode, LearnStore, OutlineDoc, OutlineEntry, OutlineEntity } from './types'
import { normalizeKey } from './graph'
import { outlineUuid } from './nodeKinds/base'

/** 一层大纲最多列多少个子目标：超过这个数说明该再拆一层（由子目标自己的大纲去拆） */
export const OUTLINE_CHILDREN_MAX = 24

/**
 * 从任意来源（磁盘 JSON、手改数据）拾掇出一份大纲：形状不对的条目丢掉、
 * key 一律按标题重算（不信文件里的）、同 key 只认第一份。
 * 返回 null 表示「没有大纲」——调用方据此让节点保持 outline 为空。
 */
export function normalizeOutline(raw: unknown): OutlineDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.children)) return null
  const intro = typeof r.intro === 'string' ? r.intro : ''
  const children: OutlineEntry[] = []
  for (const item of r.children) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    const title = typeof e.title === 'string' ? e.title.trim() : ''
    if (!title) continue
    const key = normalizeKey(title)
    if (children.some((c) => c.key === key)) continue
    children.push({ key, title, summary: typeof e.summary === 'string' ? e.summary : '' })
  }
  return {
    intro,
    children,
    updatedAt: typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0,
  }
}

/**
 * 整份写入某个节点的大纲（大纲节点的 editContent 与将来的界面入口都走这里）。
 *
 * key 在这里从标题生成——大纲条目与真实节点的对上号靠的就是它
 * （同一目标内 key 唯一，见 normalizeKey），模型不用也不能自己编。
 * 同 key 的条目只留第一份：两条计划指向同一个子目标，是一份计划写重了。
 */
export function writeOutline(
  store: LearnStore,
  nodeId: string,
  input: { intro?: unknown; children?: unknown; allowEmpty?: unknown },
  at: number,
): { ok: true; store: LearnStore; outline: OutlineDoc } | { ok: false; error: string } {
  const node = store.nodes.find((n) => n.id === nodeId)
  if (!node) return { ok: false, error: '这个节点已经不存在了' }
  const intro = typeof input.intro === 'string' ? input.intro.trim() : ''
  const rawChildren = Array.isArray(input.children) ? input.children : []
  if (rawChildren.length > OUTLINE_CHILDREN_MAX) {
    return {
      ok: false,
      error: `children 最多 ${OUTLINE_CHILDREN_MAX} 条（收到 ${rawChildren.length}）。装不下的部分不该塞进这一层——那是子目标自己的大纲的事`,
    }
  }
  const children: OutlineEntry[] = []
  for (const item of rawChildren) {
    if (!item || typeof item !== 'object') {
      return { ok: false, error: 'children 的每一项都要是 { title, summary } 对象' }
    }
    const e = item as Record<string, unknown>
    const title = typeof e.title === 'string' ? e.title.trim() : ''
    if (!title) return { ok: false, error: 'children 里有一项没有 title（子目标的标题必给）' }
    const summary = typeof e.summary === 'string' ? e.summary.trim() : ''
    const key = normalizeKey(title)
    if (children.some((c) => c.key === key)) continue
    children.push({ key, title, summary })
  }
  if (!intro && !children.length && !input.allowEmpty) {
    return { ok: false, error: 'intro 与 children 都是空的：要么写导语，要么至少列出子目标（清空不是写入的活）' }
  }
  const outline: OutlineDoc = { intro, children, updatedAt: at }
  return {
    ok: true,
    store: {
      ...store,
      nodes: store.nodes.map((n) => (n.id === nodeId ? { ...n, outline, updatedAt: at } : n)),
    },
    outline,
  }
}

/**
 * 清空某个节点的大纲（删除大纲节点 = 这一个动作）。
 *
 * 只动「计划」这一层：宿主文档、树边、下游的文档都原样保留——下游是独立节点，
 * 它们的连接是文档与文档之间的真关系，不随计划的有无而消失。画布上那份大纲卡
 * 随之消失（卡是派生的），有树连接时连线直接画在文档与子文档之间。
 * 没有大纲可清时返回 null（调用方据此回「已经不在了」）。
 */
export function clearOutline(store: LearnStore, nodeId: string, at: number): LearnStore | null {
  const node = store.nodes.find((n) => n.id === nodeId)
  if (!node?.outline) return null
  return {
    ...store,
    nodes: store.nodes.map((n) => (n.id === nodeId ? { ...n, outline: undefined, updatedAt: at } : n)),
  }
}

/**
 * 一个条目的去重键：自带的那份不可用时就按标题现算，绝不返回 undefined。
 *
 * 为什么要多这一层：`key` 是 normalizeOutline / writeOutline 算出来的，
 * 但把大纲交到 store 手上不止这一条路（外部写的 `{节点}.outline.json`、
 * 手改的数据都可能只有 `{ title, summary }`——工作流里就是这么教模型的，
 * 「key 由标题自动生成，不要自己编」）。缺了 key 的条目会让同一层的多个
 * 占位节点在图上塌成同一个 id，React 于是报 duplicate key。
 */
export function outlineEntryKey(entry: OutlineEntry): string {
  return entry.key || normalizeKey(entry.title || '')
}

/**
 * 大纲条目 → 真实节点；还没创建过（或已改名对不上号）时为 null。
 *
 * 对上号的依据是 key（= normalizeKey(title)）：条目的标题与创建节点时用的标题一致，
 * 就必然命中同一目标里那一个。条目上不存 nodeId——节点改名（key 跟着变）时
 * 存下来的 id 反而会把「已改名」伪装成「还在」，让导师与界面各看各的。
 */
export function outlineChildNodeOf(
  store: LearnStore,
  node: KnowledgeNode,
  entry: OutlineEntry,
): KnowledgeNode | null {
  return store.nodes.find((n) => n.goalId === node.goalId && n.key === entry.key) ?? null
}

/* ---------- 游离大纲（独立实体，见 types 的 OutlineEntity） ---------- */

/** 读盘归一：游离大纲池（形状不对的整条丢掉，宁少勿错——与 store 的 normalize 同一条纪律） */
export function normalizeOutlineEntities(raw: unknown): OutlineEntity[] {
  if (!Array.isArray(raw)) return []
  const out: OutlineEntity[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    const id = typeof e.id === 'string' ? e.id : ''
    const goalId = typeof e.goalId === 'string' ? e.goalId : ''
    const title = typeof e.title === 'string' ? e.title.trim() : ''
    if (!id || !goalId || !title) continue
    const children: OutlineEntry[] = []
    for (const c of Array.isArray(e.children) ? e.children : []) {
      if (!c || typeof c !== 'object') continue
      const ce = c as Record<string, unknown>
      const t = typeof ce.title === 'string' ? ce.title.trim() : ''
      if (!t) continue
      const key = normalizeKey(t)
      if (children.some((x) => x.key === key)) continue
      children.push({ key, title: t, summary: typeof ce.summary === 'string' ? ce.summary : '' })
    }
    out.push({
      id,
      goalId,
      title,
      intro: typeof e.intro === 'string' ? e.intro : '',
      children,
      createdAt: typeof e.createdAt === 'number' && Number.isFinite(e.createdAt) ? e.createdAt : 0,
      updatedAt: typeof e.updatedAt === 'number' && Number.isFinite(e.updatedAt) ? e.updatedAt : 0,
    })
  }
  return out
}

/**
 * 统一解析器：一个 `o:` uuid 背后是哪种大纲。
 * 附身（node.outline，实体 id = 宿主文档 id）还是游离（store.outlines 里的独立实体），
 * 画布 / 服务 / 派生都只问这一处——两种大纲在图上是同一种节点。
 */
export type OutlineOf =
  | { kind: 'attached'; uuid: string; docId: string; doc: KnowledgeNode; outline: OutlineDoc | null }
  | { kind: 'free'; uuid: string; entity: OutlineEntity }

export function outlineByMember(store: LearnStore, uuid: string): OutlineOf | null {
  const raw = uuid.startsWith('o:') ? uuid.slice(2) : uuid
  if (!raw) return null
  const doc = store.nodes.find((n) => n.id === raw)
  // 宿主文档在，这份大纲就「住得下」——哪怕还没写过内容（editContent 从无到有也是它）
  if (doc) return { kind: 'attached', uuid: outlineUuid(doc.id), docId: doc.id, doc, outline: doc.outline ?? null }
  const entity = store.outlines?.find((o) => o.id === raw)
  if (entity) return { kind: 'free', uuid: outlineUuid(entity.id), entity }
  return null
}

/**
 * 这份大纲在树边里说话用的 id（「声部」）：附身大纲以宿主文档 id 发声（落库落在
 * 节点文件的 dependencies 里，parentIds 不用翻译）；游离大纲只能以自己的 uuid 发声。
 */
export function outlineVoice(store: LearnStore, uuid: string): string {
  const found = outlineByMember(store, uuid)
  return found?.kind === 'attached' ? found.docId : outlineUuid(uuid.slice(2) || uuid)
}

/**
 * 新建一份游离大纲（拖大纲到空白处 / 在另一份大纲之下开层都走这里）。
 * id 是新的 uuid；与文档 id 同空间，建时校验不撞（撞了换一个，理论上不会发生）。
 */
export function createOutlineEntity(
  store: LearnStore,
  goalId: string,
  title: string,
  at: number,
): { store: LearnStore; entity: OutlineEntity } {
  let id = crypto.randomUUID()
  while (store.nodes.some((n) => n.id === id) || (store.outlines ?? []).some((o) => o.id === id)) {
    id = crypto.randomUUID()
  }
  const entity: OutlineEntity = {
    id,
    goalId,
    title: title || '新大纲',
    intro: '',
    children: [],
    createdAt: at,
    updatedAt: at,
  }
  return { store: { ...store, outlines: [...(store.outlines ?? []), entity] }, entity }
}

/** 整份改写一份游离大纲（校验与附身大纲同一套：一层为止、最多 24 条、key 由标题生成） */
export function writeOutlineEntity(
  store: LearnStore,
  outlineId: string,
  input: { intro?: unknown; children?: unknown; title?: unknown; allowEmpty?: unknown },
  at: number,
): { ok: true; store: LearnStore; entity: OutlineEntity } | { ok: false; error: string } {
  const cur = (store.outlines ?? []).find((o) => o.id === outlineId)
  if (!cur) return { ok: false, error: '这份大纲已经不在了' }
  const intro = typeof input.intro === 'string' ? input.intro.trim() : ''
  const rawChildren = Array.isArray(input.children) ? input.children : []
  if (rawChildren.length > OUTLINE_CHILDREN_MAX) {
    return {
      ok: false,
      error: `children 最多 ${OUTLINE_CHILDREN_MAX} 条（收到 ${rawChildren.length}）。装不下的部分不该塞进这一层——那是子目标自己的大纲的事`,
    }
  }
  const children: OutlineEntry[] = []
  for (const item of rawChildren) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'children 的每一项都要是 { title, summary } 对象' }
    const e = item as Record<string, unknown>
    const title = typeof e.title === 'string' ? e.title.trim() : ''
    if (!title) return { ok: false, error: 'children 里有一项没有 title（子目标的标题必给）' }
    const summary = typeof e.summary === 'string' ? e.summary.trim() : ''
    const key = normalizeKey(title)
    if (children.some((c) => c.key === key)) continue
    children.push({ key, title, summary })
  }
  if (!intro && !children.length && typeof input.title !== 'string' && !input.allowEmpty) {
    return { ok: false, error: 'intro 与 children 都是空的：要么写导语，要么至少列出子目标（清空不是写入的活）' }
  }
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : cur.title
  const entity: OutlineEntity = { ...cur, title, intro, children, updatedAt: at }
  return {
    ok: true,
    store: { ...store, outlines: (store.outlines ?? []).map((o) => (o.id === outlineId ? entity : o)) },
    entity,
  }
}

/** 删除一份游离大纲：实体连同它两端的树边一起摘（子级断线成游离成员，不连带删除） */
export function deleteOutlineEntity(store: LearnStore, outlineId: string): LearnStore | null {
  const uuid = outlineUuid(outlineId)
  if (!(store.outlines ?? []).some((o) => o.id === outlineId)) return null
  return {
    ...store,
    outlines: (store.outlines ?? []).filter((o) => o.id !== outlineId),
    edges: store.edges.filter((e) => e.from !== uuid && e.to !== uuid),
  }
}
