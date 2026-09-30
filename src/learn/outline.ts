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
import type { KnowledgeNode, LearnStore, OutlineDoc, OutlineEntry } from './types'
import { normalizeKey } from './graph'

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
 * 整份写入某个节点的大纲（Agent 的 api.outline.write 与将来的界面入口都走这里）。
 *
 * key 在这里从标题生成——大纲条目与真实节点的对上号靠的就是它
 * （同一目标内 key 唯一，见 normalizeKey），模型不用也不能自己编。
 * 同 key 的条目只留第一份：两条计划指向同一个子目标，是一份计划写重了。
 */
export function writeOutline(
  store: LearnStore,
  nodeId: string,
  input: { intro?: unknown; children?: unknown },
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
  if (!intro && !children.length) {
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
