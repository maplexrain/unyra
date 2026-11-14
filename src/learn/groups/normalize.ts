/** 这个文件负责：读盘——把 state.json 里的那一份（新版或旧版）认回 DocWorkspace */

import type { DocView, LearnTab } from '../types'
import { settle } from './core'
import type { TabOwners } from './goals'
import { FIRST_GROUP, attachMissing, emptyDocs, newId, normalizeSizes } from './layout'
import type { DocGroup, DocLayout, DocWorkspace } from './types'

/* ---------- 读盘：把 state.json 里的那一份认回来 ---------- */

/**
 * 归一化文档区状态。
 *
 * 两种输入都要认：新版（docs 里有 layout / groups / focus）与旧版（顶层的 tabs + activeTab）。
 * 旧版一律折成**单组**——那正是它本来的样子，升级之后用户看到的还是同一排页签。
 *
 * tabOf 由 store 传进来负责校验单个页签（节点还在不在、笔记还在不在），这里只管结构：
 * 认不出的组、重复的页签、坏掉的树一律丢掉，坏数据不该让整个文档区打不开。
 *
 * remapId（可选）：**旧页签 id → 新页签 id** 的迁移桥。页签 id 的口径变过（对偶页签时代
 * 视图后缀拼在 id 里，合并成单页签后没有了），存盘的激活指针还是老 id——映射认得出就
 * 落到同一份文档的新页签上，认不出才退「最后一个」，别让升级把用户读到一半的那页换掉。
 *
 * 目标页签归属（tabOwners）只认形状（键是字符串、值是字符串数组），
 * 「页签还在不在」「该补到哪个目标名下」由 store 那边过手（见 groups/goals 的 reconcileOwners）——
 * 那一层才知道每个节点属于哪个目标。
 */
export function normalizeDocs(
  raw: unknown,
  legacy: { tabs?: unknown; activeTab?: unknown },
  tabOf: (raw: unknown) => LearnTab | null,
  remapId?: (legacyId: string) => string | undefined,
): DocWorkspace {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!r || !Array.isArray(r.groups)) return legacyDocs(legacy, tabOf, remapId)
  const groups: DocGroup[] = []
  const seen = new Set<string>()
  for (const item of r.groups) {
    if (!item || typeof item !== 'object') continue
    const g = item as Record<string, unknown>
    const id = typeof g.id === 'string' && g.id ? g.id : ''
    if (!id || groups.some((x) => x.id === id)) continue
    const tabs: LearnTab[] = []
    /** 被合并掉的那几枚页签的视图（按新 id 记）：激活指针落到哪枚，就用它当时停的视图 */
    const droppedViews = new Map<string, DocView>()
    for (const rawTab of Array.isArray(g.tabs) ? g.tabs : []) {
      const t = tabOf(rawTab)
      // 同一个页签只认第一次出现：手改出来的重复（以及合并后撞成一枚的对偶页签）只会有一份
      if (!t) continue
      if (seen.has(t.id)) {
        if (t.view) droppedViews.set(t.id, t.view)
        continue
      }
      seen.add(t.id)
      tabs.push(t)
    }
    const active = settleActive(g.active, tabs, remapId)
    const droppedView = active ? droppedViews.get(active) : undefined
    groups.push({
      id,
      // 用户停下的那枚对偶页签被合并掉了，就让它停过的模式活下来（升级后还在读那页）
      tabs:
        droppedView !== undefined
          ? tabs.map((t) => (t.id === active ? { ...t, view: droppedView } : t))
          : tabs,
      active,
    })
  }
  if (!groups.length) return emptyDocs()
  const known = new Set(groups.map((g) => g.id))
  // 树里没提到的组补进来（摆在最右边）：页签还在、格子却不见了，是最难解释的一类丢数据
  const layout = attachMissing(
    normalizeLayout(r.layout, known) ?? { kind: 'group', group: groups[0].id },
    groups.map((g) => g.id),
  )
  // settle：手改过的 state.json 里可能留着一块空格子，读盘是唯一一次全量过手的机会
  const owners = normalizeOwners(r.tabOwners)
  const parkedTabs = normalizeParked(r.parkedTabs, tabOf)
  return settle({
    layout,
    groups,
    focus: typeof r.focus === 'string' && known.has(r.focus) ? r.focus : groups[0].id,
    ...(owners ? { tabOwners: owners } : {}),
    ...(parkedTabs ? { parkedTabs } : {}),
  })
}

/**
 * 归属表的形状校验：键与值都必须是字符串（值去重、空串丢掉）。
 *
 * 只做形状——「这个页签还在不在」「它该归哪个目标」都不是这一层能判的（它不认识 store），
 * 由 groups/goals 的 reconcileOwners 在读盘之后补。认不出形状时整个字段丢掉：
 * 宁可当它没有（下次 reconcile 会按页签现算补一份正确的），也不要留半张错表。
 */
function normalizeOwners(raw: unknown): TabOwners | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: TabOwners = {}
  for (const [owner, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue
    const ids: string[] = []
    for (const id of value) {
      if (typeof id !== 'string' || !id || ids.includes(id)) continue
      ids.push(id)
    }
    if (ids.length > 0) out[owner] = ids
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * 停靠场（被卸载的目标页签组，见 DocWorkspace.parkedTabs）的形状校验。
 *
 * 每枚停靠页签走与组内同一道 `tabOf`：指向的节点已经不在了的就地丢弃——
 * 归队开不出一份「已删除的节点」，停靠场也不该替它保存。只做形状，
 * 「归队后该登记到哪个目标名下」由 restoreParkedTabs 的 claimTab 现算。
 */
function normalizeParked(
  raw: unknown,
  tabOf: (raw: unknown) => LearnTab | null,
): Record<string, LearnTab[]> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: Record<string, LearnTab[]> = {}
  for (const [goalId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!goalId || !Array.isArray(value)) continue
    const tabs: LearnTab[] = []
    const seen = new Set<string>()
    for (const item of value) {
      const t = tabOf(item)
      if (!t || seen.has(t.id)) continue
      seen.add(t.id)
      tabs.push(t)
    }
    if (tabs.length > 0) out[goalId] = tabs
  }
  return Object.keys(out).length > 0 ? out : null
}

function legacyDocs(
  legacy: { tabs?: unknown; activeTab?: unknown },
  tabOf: (raw: unknown) => LearnTab | null,
  remapId?: (legacyId: string) => string | undefined,
): DocWorkspace {
  const tabs: LearnTab[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(legacy.tabs) ? legacy.tabs : []) {
    const t = tabOf(item)
    if (!t || seen.has(t.id)) continue
    seen.add(t.id)
    tabs.push(t)
  }
  return {
    layout: { kind: 'group', group: FIRST_GROUP },
    groups: [{ id: FIRST_GROUP, tabs, active: settleActive(legacy.activeTab, tabs, remapId) }],
    focus: FIRST_GROUP,
  }
}

/** 激活指针落点：认得现页签就原样；只认得旧 id 就走迁移桥；都不行退最后一个 */
function settleActive(
  rawActive: unknown,
  tabs: LearnTab[],
  remapId?: (legacyId: string) => string | undefined,
): string | null {
  if (typeof rawActive !== 'string' || !rawActive) return tabs[tabs.length - 1]?.id ?? null
  if (tabs.some((t) => t.id === rawActive)) return rawActive
  const mapped = remapId?.(rawActive)
  if (mapped && tabs.some((t) => t.id === mapped)) return mapped
  return tabs[tabs.length - 1]?.id ?? null
}

/**
 * 树里认出来的那一份；认不出的组丢掉，只剩一个孩子的分割收起来。
 * 层层设限（depth）：手改出来的环状引用不该把这里拖死。
 */
function normalizeLayout(raw: unknown, known: Set<string>, depth = 0): DocLayout | null {
  if (!raw || typeof raw !== 'object' || depth > 8) return null
  const n = raw as Record<string, unknown>
  if (n.kind === 'group') {
    return typeof n.group === 'string' && known.has(n.group) ? { kind: 'group', group: n.group } : null
  }
  if (n.kind !== 'split') return null
  const rawKids = Array.isArray(n.children) ? n.children : []
  const rawSizes = Array.isArray(n.sizes) ? n.sizes : []
  const children: DocLayout[] = []
  const sizes: number[] = []
  rawKids.forEach((kid, i) => {
    const child = normalizeLayout(kid, known, depth + 1)
    if (!child) return
    children.push(child)
    sizes.push(typeof rawSizes[i] === 'number' ? (rawSizes[i] as number) : 1)
  })
  if (!children.length) return null
  if (children.length === 1) return children[0]
  return {
    kind: 'split',
    id: typeof n.id === 'string' && n.id ? n.id : newId('s'),
    dir: n.dir === 'col' ? 'col' : 'row',
    children,
    sizes: normalizeSizes(sizes),
  }
}
