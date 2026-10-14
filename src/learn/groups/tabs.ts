/** 这个文件负责：每格的页签列——开关、激活、顺序、常驻名额，以及跨格拖动与拖出去分割 */

import type { DocView, LearnTab, TabRef } from '../types'
import { closeTabs, makeTab, reorderTabs, tabKey, type TabCloseMode } from '../tabs'
import { groupOf, settle, withDocs, withGroup } from './core'
import { findTab, focusedGroup, groupIdOfTab } from './focus'
import { PUBLIC_OWNER, claimTab, dropTabs, goalTabsOf, ownerOfTab, refOwner, withOwners, withParked } from './goals'
import { groupIdsOf, insertBeside, newId, replaceLeaf } from './layout'
import type { DocGroup, DocLayout, DocWorkspace, SplitDir } from './types'

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
  if (!hit) return docs
  /*
   * 目标归属跟着页签 id 一起搬（见 goals）：笔记改名换的是页签身份，
   * 但它服务的还是同一个目标——不搬的话它会变成「没登记过的页签」，
   * 虽然 reconcileOwners 兜得回来（按 nodeId 现算），但那一刻它已经在栏上闪一下位置了。
   */
  const owners = docs.tabOwners
  const tabOwners = owners
    ? Object.fromEntries(
        Object.entries(owners).map(([owner, ids]) => [
          owner,
          ids.map((id) => (id === fromId ? toId : id)),
        ]),
      )
    : undefined
  return settle(
    withDocs(docs, { groups, ...(tabOwners ? { tabOwners } : {}) }),
  )
}

/**
 * 打开（或激活）一个页签。
 *
 * 已经在**任意一格**里开着就切到那一格去（vscode 的规矩：同一个文件不会开出两份），
 * 否则落在指定那一格的末尾。指定的那一格已经不在了（刚被收掉）就退回焦点组。
 *
 * goalOfNode（可选）：归属现算的入口（见 groups/goals 的 refOwner）。传了它，
 * 「空白占位让位」就按**栏上看得见什么**判（见 blankYieldsTo）——教学文档组联动
 * （openTeachDoc）、拖入 chip 这类「从别处开页签」的调用方都该给这份上下文；
 * 不传则退回老判据（整格只有一枚页签且是空白），归队、就地替换的补开等内部路径照旧。
 */
export function openInGroup(
  docs: DocWorkspace,
  groupId: string,
  ref: TabRef,
  at: number,
  view?: DocView,
  goalOfNode?: (nodeId: string) => string | null,
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
  const newTab = makeTab(ref, at, view)
  const next = withGroup(docs, target, (g) => ({
    ...g,
    tabs: blankYieldsTo(docs, g, ref, goalOfNode)
      ? // 空白占位让位：清掉这一格的全部占位，新页签顶上（其余页签原地不动）
        [...g.tabs.filter((t) => t.ref.kind !== 'blank'), newTab]
      : [...g.tabs, newTab],
    active: id,
  }))
  return settle(withDocs(next, { focus: target }))
}

/**
 * 空白占位该不该给新来的这枚页签让位。
 *
 * 需求原文：「如果当前 tab 栏只有新标签页，那么此时从其他地方打开一个新的 tab，
 * 默认的新标签页就得消失。」
 *
 * 判据是**栏上看得见什么**，不是格子里物理躺着什么：页签实体一直住在格子里，
 * 栏上只画「公共 + 当前目标」（见 groups/goals 的 visibleTabs）——切到 B 目标时，
 * 同一个格子里其实还躺着 A 目标的一排页签，只是没画出来。拿物理数量去判，
 * 「栏上只剩一枚空白占位、格子里却还有三枚」这种局面（关过大纲、切过目标的日常）
 * 就不肯让位了。
 *
 * 所以：归属为「别目标」、又不是这一格正在看的那一片（分屏保底，见 visibleTabs 的
 * pinned）的页签，一律当作看不见；除空白外一枚都看不见，就让位。
 * 没给 goalOfNode 的调用方退回老判据（整格只有一枚页签且是空白）。
 */
function blankYieldsTo(
  docs: DocWorkspace,
  g: DocGroup,
  ref: TabRef,
  goalOfNode?: (nodeId: string) => string | null,
): boolean {
  if (ref.kind === 'blank') return false
  if (!g.tabs.some((t) => t.ref.kind === 'blank')) return false
  if (!goalOfNode) return g.tabs.length === 1
  const mine = refOwner(ref, goalOfNode)
  return g.tabs
    .filter((t) => t.ref.kind !== 'blank')
    .every((t) => {
      if (t.id === g.active) return false
      const own = ownerOfTab(docs.tabOwners, t.id)
      return own !== null && own !== PUBLIC_OWNER && own !== mine
    })
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
export function closeIn(
  docs: DocWorkspace,
  groupId: string,
  tabId: string,
  mode: TabCloseMode,
  closingIds?: string[],
  preferVisible?: (t: LearnTab) => boolean,
): DocWorkspace {
  const g = groupOf(docs, groupId)
  if (!g) return docs
  const r = closeTabs(g.tabs, tabId, mode, g.active, closingIds, preferVisible)
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

/* ---------- 大纲页 = 组锚：卸载停靠与归队 ---------- */

/**
 * 让某个目标**停靠中**的页签原样归队（见 DocWorkspace.parkedTabs）。
 *
 * 归队做的事：按停靠时的顺序逐枚开进焦点格（openInGroup 认得「已在别格开着」的，
 * 不会开出第二枚；空白页签会被第一枚真文档顶掉，见 openInGroup 的 shouldReplaceBlank）、
 * 归属重新登记回本目标名下、停靠场里的这一份清掉。**不动激活项**——落点回大纲
 * 是 openOutlineTab 的事（那边才知道大纲开在哪一格）。
 *
 * 没有停靠（组本来就没卸载）时原样返回同一个对象。
 */
export function restoreParkedTabs(
  docs: DocWorkspace,
  goalId: string,
  goalOfNode?: (nodeId: string) => string | null,
): DocWorkspace {
  const parked = docs.parkedTabs?.[goalId]
  if (!parked || parked.length === 0) return docs
  let next = docs
  let owners = docs.tabOwners
  for (const t of parked) {
    next = openInGroup(next, next.focus, t.ref, t.createdAt, t.view, goalOfNode)
    owners = claimTab(owners, goalId, tabKey(t.ref))
  }
  const rest = { ...(next.parkedTabs ?? {}) }
  delete rest[goalId]
  return withParked(withOwners(next, owners), Object.keys(rest).length > 0 ? rest : undefined)
}

/**
 * 这枚大纲是不是**组锚**——它所属目标**根节点**的那一份。
 *
 * 「大纲是目标级的，一个目标只有一份」（根节点那一份，见 docs/learning.md），
 * 但侧栏每个节点都挂着大纲入口，打开的是那一支的「阶段大纲」——两种大纲页签都合法存在，
 * 只有**锚**的开关牵动整组：
 * - 开锚 = 整组归队（openAnchorOutline）；
 * - 关锚 = 整组卸载进停靠场（unloadAnchoredGroups）；
 * - 阶段大纲只是一枚普通页签，开关都不影响任何一组。
 *
 * 这条判据是被一串混乱倒逼出来的：「从别处打开文档 → 再打开其他大纲 → 关掉大纲，
 * 那份文档被弹走」——从前「凡是 outline 都算锚」，于是关掉**任何一个**节点的大纲，
 * 都会把该目标名下还开着的页签整组卷进停靠场，连刚打开的文档一起弹走。
 *
 * 判据是「节点 → 目标」与「目标 → 根节点」两跳查表，两个查表函数都由调用方传进来
 * （纯函数层不认识 store）。
 */
export function isAnchorOutline(
  ref: TabRef,
  goalOfNode: (nodeId: string) => string | null,
  rootOf: (goalId: string) => string | null,
): boolean {
  if (ref.kind !== 'outline') return false
  const gid = goalOfNode(ref.nodeId)
  return !!gid && rootOf(gid) === ref.nodeId
}

/**
 * 开一枚**大纲页**（普通开法）：落进指定那一格、置前，并把它的归属当场登记
 * （查不到目标就不登记——节点刚被删的那个瞬间）。**不碰停靠场**：
 * 只有组锚才牵动整组，见 openAnchorOutline 与 isAnchorOutline。
 */
export function openOutlineTab(
  docs: DocWorkspace,
  groupId: string,
  ref: TabRef & { kind: 'outline' },
  goalOfNode: (nodeId: string) => string | null,
  at: number,
): DocWorkspace {
  const opened = openInGroup(docs, groupId, ref, at, undefined, goalOfNode)
  const gid = goalOfNode(ref.nodeId)
  if (!gid) return opened
  return withOwners(opened, claimTab(opened.tabOwners, gid, tabKey(ref)))
}

/**
 * 开**组锚**（目标根节点的大纲页）：普通开法之上，把该目标名下沉睡在停靠场里的整组页签
 * 原样归队，落点回到大纲——「打开大纲时恢复」说的就是这一下。
 *
 * 只该拿目标根节点的大纲来调（见 isAnchorOutline）；阶段大纲走 openOutlineTab，
 * 开它不该把停靠的组拽回来。
 */
export function openAnchorOutline(
  docs: DocWorkspace,
  groupId: string,
  ref: TabRef & { kind: 'outline' },
  goalOfNode: (nodeId: string) => string | null,
  at: number,
): DocWorkspace {
  const opened = openOutlineTab(docs, groupId, ref, goalOfNode, at)
  const gid = goalOfNode(ref.nodeId)
  if (!gid) return opened
  const restored = restoreParkedTabs(opened, gid, goalOfNode)
  if (restored === opened) return opened
  const home = groupIdOfTab(restored, tabKey(ref))
  return home ? activateIn(restored, home, tabKey(ref)) : restored
}

/**
 * 关页签之后的**组锚卸载**结算：这一批关掉的每一枚**锚**（isAnchorOutline），
 * 把该目标名下还活着的页签一并收进停靠场（页签对象原样保存，视图与创建时间都在），
 * 页签实体从格子里摘掉、归属从表里撤掉；等锚再开时原样归队
 * （openAnchorOutline → restoreParkedTabs）。
 *
 * `docs` 是**已经关完**的工作区（closeIn 之后的那一份），`beforeTabs` 是关之前布局顺序的
 * 全部页签——拿它找「这一批里被关掉的那几枚锚」。被关掉的若是阶段大纲，这里什么都不做：
 * 它只是普通页签。「关掉一枚别的大纲，别处的文档被弹走」正是旧判据（凡是 outline 都算锚）
 * 的事故现场。
 */
export function unloadAnchoredGroups(
  docs: DocWorkspace,
  beforeTabs: readonly LearnTab[],
  goalOfNode: (nodeId: string) => string | null,
  rootOf: (goalId: string) => string | null,
): DocWorkspace {
  const live = new Set(allTabs(docs).map((t) => t.id))
  let next = docs
  let parkedNext: Record<string, LearnTab[]> | null = null
  const parkedIds: string[] = []
  for (const dead of beforeTabs) {
    if (live.has(dead.id) || dead.ref.kind !== 'outline' || !isAnchorOutline(dead.ref, goalOfNode, rootOf)) continue
    const deadGoal = goalOfNode(dead.ref.nodeId)
    if (!deadGoal) continue
    const victims = goalTabsOf(next.tabOwners, allTabs(next), goalOfNode, deadGoal)
    if (!victims.length) continue
    parkedNext = { ...(parkedNext ?? docs.parkedTabs ?? {}), [deadGoal]: victims }
    for (const v of victims) parkedIds.push(v.id)
    next = closeIds(next, victims.map((v) => v.id))
  }
  if (!parkedIds.length) return next
  // 停靠的页签从归属表里撤掉：归队时再登记回去（restoreParkedTabs 里那一句 claimTab）
  return withParked(withOwners(next, dropTabs(next.tabOwners, parkedIds)), parkedNext ?? undefined)
}

/**
 * 打开一枚**组关联的文档**（教学文档 / 工作区内部文件）：先把它对应的「组」立起来，
 * 文档再进门。
 *
 * 需求原文（教学文档）：「优化文档打开，如果教学文档不是从大纲打开的，那么打开时需要查看
 * 缓存中的 tab 组是否存在该教学文档对应的大纲。如果存在就将该 tab 组打开。如果不存在就
 * 先打开一个大纲创建 tab 组，然后再打开文档。」
 * 需求原文（工作区内部文件）：「项目中的任何文件都是内部文件……只要打开其中一个文件
 * 就会打开关联的 tab 组。」——两者是同一条规矩，所以共用一个入口。
 *
 * 「对应的大纲」= 目标根节点那一份（大纲是目标级的，一个目标只有一份，见 docs/learning.md），
 * 「缓存中的 tab 组」由停靠场（DocWorkspace.parkedTabs）与本栏的组锚共同表达：
 * - 大纲开着（任何一格）：组就在眼前——文档落进**它所在的那一格**并置前，
 *   「把该 tab 组打开」就是这一下（焦点跟着过去；那一格在分屏的另一半时也一样）；
 * - 大纲没开着：先 openAnchorOutline 把它开出来——那一下同时让停靠场里这一组页签归队
 *   （关锚 = 整组卸载，见 groups/types 的 parkedTabs），组因此是「原来那副样子」，
 *   然后文档再进门。
 *
 * 从大纲里点进来（OutlineView 的 onOpenNode）也走这里：大纲就在焦点格、恒等落回原处，
 * 与改前一致——所以不必分辨来路，「不是从大纲打开的」那几条路（侧栏节点、面包屑、
 * 链接、导师 point、拖入的引用）才是真正被修好的。rootNodeId 拿不到时（目标刚没）
 * 退回普通开法，不把文档扣下。
 *
 * `into`（可选）：明确指定的落点（拖放落在哪一格）。大纲已在别格时，拖放要听用户的
 * ——文档落进他指的那一格（组可以横跨几格，见 groups/goals 的说明）；没指时跟大纲一格。
 */
export function openGroupedDoc(
  docs: DocWorkspace,
  ref: (TabRef & { kind: 'teach' }) | (TabRef & { kind: 'ws' }),
  rootNodeId: string | null,
  goalOfNode: (nodeId: string) => string | null,
  at: number,
  view?: DocView,
  into?: string,
): DocWorkspace {
  /** 兜底落点：明确指了某一格就听它的，否则焦点格 */
  const fallback = into && groupOf(docs, into) ? into : docs.focus
  if (rootNodeId) {
    const outlineRef: TabRef = { kind: 'outline', nodeId: rootNodeId }
    const outlineId = tabKey(outlineRef)
    const opened = groupIdOfTab(docs, outlineId)
      ? docs
      : openAnchorOutline(docs, fallback, outlineRef, goalOfNode, at)
    const home = groupIdOfTab(opened, outlineId)
    const target = into && groupOf(opened, into) ? into : home
    return openInGroup(opened, target ?? opened.focus, ref, at, view, goalOfNode)
  }
  return openInGroup(docs, fallback, ref, at, view, goalOfNode)
}
