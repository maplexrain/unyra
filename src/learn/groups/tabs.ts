/** 这个文件负责：每格的页签列——开关、激活、顺序、常驻名额，以及跨格拖动与拖出去分割 */

import type { DocView, LearnTab, TabRef } from '../types'
import { closeTabs, makeTab, reorderTabs, tabKey, type TabCloseMode } from '../tabs'
import { groupOf, settle, withDocs, withGroup } from './core'
import { findTab, focusedGroup, groupIdOfTab } from './focus'
import { groupIdsOf, insertBeside, newId, replaceLeaf } from './layout'
import type { DocLayout, DocWorkspace, SplitDir } from './types'

/**
 * 全部页签，按**布局顺序**排（左格那一排在前，右格的接上）。
 *
 * 全局顺序从此由布局说了算：每一格各排各的，这一份只是「渲染时怎么走一遍」，
 * 不再是一份要跟着重排的状态（旧版 store.tabs 那种「一条大列表」到这里就散了）。
 */
export function allTabs(docs: DocWorkspace): LearnTab[] {
  const out: LearnTab[] = []
  for (const id of groupIdsOf(docs.layout)) {
    const g = groupOf(docs, id)
    if (g) out.push(...g.tabs)
  }
  return out
}

/**
 * 每一格当前显示的那一个页签 id（渲染与常驻名单都要它：同一时刻可能有好几片正文在眼前）。
 * 布局顺序，空格子跳过。
 */
export function activeIdsOf(docs: DocWorkspace): string[] {
  const out: string[] = []
  for (const id of groupIdsOf(docs.layout)) {
    const g = groupOf(docs, id)
    if (g?.active) out.push(g.active)
  }
  return out
}

/** 改一个页签自己的字段（视图选择）；找不到就原样返回 */
export function patchTab(docs: DocWorkspace, tabId: string, patch: Partial<LearnTab>): DocWorkspace {
  let hit = false
  const groups = docs.groups.map((g) => {
    if (!g.tabs.some((t) => t.id === tabId)) return g
    hit = true
    return { ...g, tabs: g.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)) }
  })
  return hit ? settle(withDocs(docs, { groups })) : docs
}

/** 换掉某个页签指向的东西（笔记改名走它），连它在组里的激活项一起改名 */
export function renameTabRef(docs: DocWorkspace, from: TabRef, to: TabRef): DocWorkspace {
  const fromId = tabKey(from)
  const toId = tabKey(to)
  if (fromId === toId) return docs
  let hit = false
  const groups = docs.groups.map((g) => {
    if (!g.tabs.some((t) => t.id === fromId)) return g
    hit = true
    return {
      ...g,
      tabs: g.tabs.map((t) => (t.id === fromId ? { ...t, id: toId, ref: to } : t)),
      active: g.active === fromId ? toId : g.active,
    }
  })
  return hit ? settle(withDocs(docs, { groups })) : docs
}

/**
 * 打开（或激活）一个页签。
 *
 * 已经在**任意一格**里开着就切到那一格去（vscode 的规矩：同一个文件不会开出两份），
 * 否则落在指定那一格的末尾。指定的那一格已经不在了（刚被收掉）就退回焦点组。
 */
export function openInGroup(
  docs: DocWorkspace,
  groupId: string,
  ref: TabRef,
  at: number,
  view?: DocView,
): DocWorkspace {
  const id = tabKey(ref)
  const home = groupIdOfTab(docs, id)
  if (home) {
    if (ref.kind === 'local' && ref.title) {
      const updated = withGroup(docs, home, (g) => ({
        ...g,
        tabs: g.tabs.map((t) => (t.id === id && t.ref.kind === 'local' && t.ref.title !== ref.title ? { ...t, ref: { ...t.ref, title: ref.title } } : t)),
      }))
      return activateIn(updated, home, id)
    }
    return activateIn(docs, home, id)
  }
  const target = groupOf(docs, groupId) ? groupId : focusedGroup(docs).id
  const next = withGroup(docs, target, (g) => ({
    ...g,
    tabs: [...g.tabs, makeTab(ref, at, view)],
    active: id,
  }))
  return settle(withDocs(next, { focus: target }))
}

/** 激活某一格里的某个页签，并把焦点挪到那一格（点页签栏、链接跳转、大纲都走它） */
export function activateIn(docs: DocWorkspace, groupId: string, tabId: string): DocWorkspace {
  const g = groupOf(docs, groupId)
  if (!g || !g.tabs.some((t) => t.id === tabId)) return docs
  return settle(withDocs(withGroup(docs, groupId, (cur) => ({ ...cur, active: tabId })), { focus: groupId }))
}

/** 按给定顺序重排某一格的页签（栏内拖动排序；跨格的拖动见 moveTab） */
export function reorderIn(docs: DocWorkspace, groupId: string, ids: string[]): DocWorkspace {
  const g = groupOf(docs, groupId)
  if (!g) return docs
  return settle(withGroup(docs, groupId, (cur) => ({ ...cur, tabs: reorderTabs(cur.tabs, ids) })))
}

/* ---------- 写：关掉、移动、分割 ---------- */

/**
 * 关掉某一格里的页签（右键菜单那五种关法都走它）。
 *
 * 「只剩一格时空格子留着，多于一格时空格子立刻消失」——这是 vscode 的行为，也是这里的
 * 取舍：留着是为了让「一个页签都没有」的那一屏还有块地方放空态（空库、全关掉了）；
 * 多于一组时它只是一块碍事的空白，收掉它，兄弟那一格自然铺满。
 */
export function closeIn(docs: DocWorkspace, groupId: string, tabId: string, mode: TabCloseMode): DocWorkspace {
  const g = groupOf(docs, groupId)
  if (!g) return docs
  const r = closeTabs(g.tabs, tabId, mode, g.active)
  const next = withDocs(docs, {
    groups: docs.groups.map((x) => (x.id === groupId ? { ...x, tabs: r.tabs, active: r.active } : x)),
  })
  return settle(next)
}

/**
 * 按 id 关掉若干个页签（节点被删、笔记没了、超级文档没了都走它）。
 *
 * 与 closeIn 的差别只有一处：这里的页签可能同时躺在好几格里（agent 删掉一棵子树），
 * 所以逐格过滤，只把**因此空掉**的那几格收掉。
 */
export function closeIds(docs: DocWorkspace, ids: string[]): DocWorkspace {
  const doomed = new Set(ids)
  if (!doomed.size) return docs
  let hit = false
  const groups = docs.groups.map((g) => {
    if (!g.tabs.some((t) => doomed.has(t.id))) return g
    hit = true
    const tabs = g.tabs.filter((t) => !doomed.has(t.id))
    return {
      ...g,
      tabs,
      active: g.active && doomed.has(g.active) ? (tabs[tabs.length - 1]?.id ?? null) : g.active,
    }
  })
  return hit ? settle(withDocs(docs, { groups })) : docs
}

/**
 * 摘掉一个页签之后，这一格该激活谁。
 *
 * 与关页签（learn/tabs 的 closeTabs）同一条落点规则：**先往右找最近的一个还留着的**，
 * 右边没有了才往左。「拖走的正好是当前看的那一份」是常事，落点若给了 null，
 * 那一格就会显示空态——而它的页签栏里明明还有别的页签。
 */
export function landingAfter(before: LearnTab[], removedId: string, kept: LearnTab[]): string | null {
  const idx = before.findIndex((t) => t.id === removedId)
  if (idx < 0) return kept[kept.length - 1]?.id ?? null
  const right = before[idx + 1]
  if (right && kept.some((t) => t.id === right.id)) return right.id
  for (let i = idx - 1; i >= 0; i--) {
    if (kept.some((t) => t.id === before[i].id)) return before[i].id
  }
  return kept[kept.length - 1]?.id ?? null
}

/**
 * 把一个页签挪到另一格（也可以是同一格的另一个位置）。
 *
 * index 为 null = 落在末尾。原格只剩这一个页签时原格随之消失——
 * 「把最后一份文档拖走」之后那一格不该还空在那里。
 */
export function moveTab(docs: DocWorkspace, tabId: string, toGroup: string, index: number | null): DocWorkspace {
  const tab = findTab(docs, tabId)
  const from = groupIdOfTab(docs, tabId)
  if (!tab || !from || !groupOf(docs, toGroup)) return docs
  if (from === toGroup) {
    const ids = groupOf(docs, toGroup)!.tabs.map((t) => t.id).filter((id) => id !== tabId)
    const at = index === null ? ids.length : Math.max(0, Math.min(index, ids.length))
    ids.splice(at, 0, tabId)
    return reorderIn(docs, toGroup, ids)
  }
  const groups = docs.groups.map((g) => {
    if (g.id === from) {
      const tabs = g.tabs.filter((t) => t.id !== tabId)
      // 拖走的正好是它在看的那一份：按关页签那条落点规则挑一个接上（见 landingAfter）
      const active = g.active === tabId ? landingAfter(g.tabs, tabId, tabs) : g.active
      return { ...g, active, tabs }
    }
    if (g.id === toGroup) {
      const tabs = [...g.tabs]
      tabs.splice(index === null ? tabs.length : Math.max(0, Math.min(index, tabs.length)), 0, tab)
      return { ...g, tabs, active: tabId }
    }
    return g
  })
  return settle(withDocs(docs, { groups, focus: toGroup }))
}

/**
 * 把某一格**拆开**：拖来的那个页签落进新格，新格摆在原格的某一侧。
 *
 * side = 'before' / 'after' 说的是新格摆在哪一侧（左右看 row，上下看 col）。
 *
 * 页签是**必须**的：拆出一个空格子只会在界面上多一块空白（页签栏空着、正文写着
 * 「没有打开的文档」，那一格还谁也点不动）——那正是「空分割区」的来源。
 * 要找的页签找不到（拖动那一头同时被关掉了）就原样返回：宁可这一次拖动没生效，
 * 也不留一个空格子下来。
 *
 * 两种落法：
 * - 拖的是目标格**仅有的**那一个页签：目标格让出位置，新格顶替它原来的地方
 *   （不然会先收掉目标格，再往一个已经不存在的位置上插）；
 * - 否则先把页签从原格摘掉（原格空了就收掉），再往目标那一侧插进新格。
 */
export function splitWith(
  docs: DocWorkspace,
  target: string,
  dir: SplitDir,
  side: 'before' | 'after',
  tabId: string,
): DocWorkspace {
  const targetGroup = groupOf(docs, target)
  if (!targetGroup) return docs
  const tab = findTab(docs, tabId)
  if (!tab) return docs
  const from = groupIdOfTab(docs, tab.id)
  if (!from) return docs
  const id = newId('g')
  // 拖的是目标格仅有的那个页签：位置不变，变的只是它属于哪一格
  if (from === target && targetGroup.tabs.length === 1) {
    return settle(
      withDocs(docs, {
        layout: replaceLeaf(docs.layout, target, { kind: 'group', group: id }),
        groups: [...docs.groups.filter((g) => g.id !== target), { id, tabs: [tab], active: tab.id }],
        focus: id,
      }),
    )
  }
  // 先把它从原格摘掉（原格因此空了就收掉）：落点与关页签同一条规则，见 landingAfter
  const groups = docs.groups.map((g) => {
    if (g.id !== from) return g
    const tabs = g.tabs.filter((t) => t.id !== tab.id)
    return { ...g, tabs, active: g.active === tab.id ? landingAfter(g.tabs, tab.id, tabs) : g.active }
  })
  const base = settle(withDocs(docs, { groups }))
  if (!groupOf(base, target)) return base
  const leaf: DocLayout = { kind: 'group', group: id }
  return settle(
    withDocs(base, {
      layout: insertBeside(base.layout, target, side, leaf, newId('s'), dir),
      groups: [...base.groups, { id, tabs: [tab], active: tab.id }],
      focus: id,
    }),
  )
}
