/** 这个文件负责：读盘——把 state.json 里的那一份（新版或旧版）认回 DocWorkspace */

import type { LearnTab } from '../types'
import { settle } from './core'
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
 */
export function normalizeDocs(
  raw: unknown,
  legacy: { tabs?: unknown; activeTab?: unknown },
  tabOf: (raw: unknown) => LearnTab | null,
): DocWorkspace {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!r || !Array.isArray(r.groups)) return legacyDocs(legacy, tabOf)
  const groups: DocGroup[] = []
  const seen = new Set<string>()
  for (const item of r.groups) {
    if (!item || typeof item !== 'object') continue
    const g = item as Record<string, unknown>
    const id = typeof g.id === 'string' && g.id ? g.id : ''
    if (!id || groups.some((x) => x.id === id)) continue
    const tabs: LearnTab[] = []
    for (const rawTab of Array.isArray(g.tabs) ? g.tabs : []) {
      const t = tabOf(rawTab)
      // 同一个页签只认第一次出现：手改出来的重复会让「点它」落到两处
      if (!t || seen.has(t.id)) continue
      seen.add(t.id)
      tabs.push(t)
    }
    groups.push({
      id,
      tabs,
      active:
        typeof g.active === 'string' && tabs.some((t) => t.id === g.active)
          ? g.active
          : (tabs[tabs.length - 1]?.id ?? null),
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
  return settle({
    layout,
    groups,
    focus: typeof r.focus === 'string' && known.has(r.focus) ? r.focus : groups[0].id,
  })
}

function legacyDocs(
  legacy: { tabs?: unknown; activeTab?: unknown },
  tabOf: (raw: unknown) => LearnTab | null,
): DocWorkspace {
  const tabs: LearnTab[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(legacy.tabs) ? legacy.tabs : []) {
    const t = tabOf(item)
    if (!t || seen.has(t.id)) continue
    seen.add(t.id)
    tabs.push(t)
  }
  const active =
    typeof legacy.activeTab === 'string' && tabs.some((t) => t.id === legacy.activeTab)
      ? legacy.activeTab
      : (tabs[tabs.length - 1]?.id ?? null)
  return {
    layout: { kind: 'group', group: FIRST_GROUP },
    groups: [{ id: FIRST_GROUP, tabs, active }],
    focus: FIRST_GROUP,
  }
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
