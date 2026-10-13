/**
 * 本文件负责：**目标页签归属**——哪些页签属于哪个目标（或属于「公共」）。
 *
 * 由来：从前点资源管理器里的目标节点，打开的是那个节点的教学文档；页面上的页签栏是
 * 一条扁平的列表，谁开的都在同一条里。现在改成「打开一个目标 = 切到它的页签组」：
 * 属于这个目标（**任意层级**的节点）的页签都记在它名下，切目标只是换一套看得到的页签，
 * 公共页签（设置、超级导师设置、外部文件……）则一直留在栏上。
 *
 * 为什么归属单独记一张表，而不是长在 DocGroup 上：分组是**排版**（哪一格、怎么摆），
 * 归属是**内容**（这份文档在为哪个目标服务）。两者会交叉——用户可以把某个目标的文档
 * 拖到另一格里，那一格照样可能混着两三个目标的页签。把归属挂在格子上，
 * 拖一下页签就要顺手搬家，错一次就是「文档跑到别的目标底下去了」。
 *
 * 归属的键是**目标 id**（不为 null 的目标归入 `PUBLIC`）：这样「切到某个目标只看它的页签」
 * 只是一次过滤。全是纯函数，能被单元测试钉住（见 tests/goalTabs.test.ts）。
 */

import type { LearnTab, TabRef } from '../types'
import type { DocWorkspace } from './types'

/** 不属于任何目标的页签（设置 / 用量 / 网页 / 本地文件……）都记在这个键下 */
export const PUBLIC_OWNER = ''

/** 「目标 → 它名下的页签 id」；键 `PUBLIC_OWNER` = 公共页签 */
export type TabOwners = Record<string, string[]>

/**
 * 一枚页签属于哪个目标。
 *
 * 判据是页签**指向的节点**所属的目标——这正是需求原文里「所有当前目标下任何层级的文档
 * 文件打开都会被 tab 组记录」：教学文档、笔记、超级文档、试卷副本，只要那个节点在目标
 * 的树里，它们就都算这个目标的。
 *
 * 大纲页按节点算同一条规矩：`{kind:'outline', nodeId}` 的 nodeId 就是目标根节点，
 * 于是「Java入门大纲」自然归 Java入门。将来一个目标只显示一个大纲（见侧栏那条重构），
 * 这条判据不用改。
 *
 * 无处可归的（设置、用量、网页、本地文件、守卫上下文、专注报告、新建目标页）
 * 一律归 `PUBLIC_OWNER`——它们不属于任何目标，切目标时应该一直看得见。
 */
export function refOwner(ref: TabRef, goalOfNode: (nodeId: string) => string | null): string {
  switch (ref.kind) {
    case 'teach':
    case 'note':
    case 'super':
    case 'outline':
    case 'exam':
      return goalOfNode(ref.nodeId) ?? PUBLIC_OWNER
    // 记忆页签本身就是「一枚目标一份」的（见 tabs 的 `m:` + goalId），归属直接照抄
    case 'mind':
      return ref.goalId
    default:
      return PUBLIC_OWNER
  }
}

/**
 * 当前该显示哪些页签。
 *
 * 规则：**公共页签 + 当前目标的页签**。没有活动目标（一个目标都没有 / 目标库清空）时
 * 只剩公共页签——这与「打开应用先看到设置页或新建目标页」是一致的。
 *
 * 传进来的 `tabs` 已经是**布局顺序**的（见 allTabs），过滤只保证顺序不乱、不重排。
 * 归属表里没有登记的页签按当前目标算：这样加一个新的页签类型而忘了登记时，
 * 它也不会在栏上凭空消失（宁可多显示一枚，也不能让用户以为文档丢了）。
 *
 * `pinned` 是**分屏保底**：每一格正在看的那一片（见 activeIdsOf）一律留下，
 * 哪怕它属于另一个目标。左右两半各看一个目标是分屏的常态，而「正文在眼前、
 * 它的页签却不在栏上」是最难解释的一种状态——用户会以为那份文档丢了，
 * 更别提它还无从点回去。留下的这些按 focusTabsInGroup 排在当前目标那一批之后。
 */
export function visibleTabs(
  tabs: readonly LearnTab[],
  owners: TabOwners | undefined,
  goalId: string | null,
  pinned?: ReadonlySet<string>,
): LearnTab[] {
  if (!owners) return [...tabs]
  const gid = goalId ?? PUBLIC_OWNER
  // 当前目标的页签 ∪ 公共页签：公共的那些（设置、外部文件）不属于任何目标，切目标时一直看得见
  const wanted = new Set([...(owners[gid] ?? []), ...(gid === PUBLIC_OWNER ? [] : (owners[PUBLIC_OWNER] ?? []))])
  const out: LearnTab[] = []
  for (const tab of tabs) {
    // 某一格正在看它：不看归属（理由见上面的 pinned 说明）
    if (pinned?.has(tab.id)) {
      out.push(tab)
      continue
    }
    // 没登记过：算它属于当前目标（宁可多显示一枚，也不能让用户以为文档丢了）
    if (knownOwner(owners, tab.id) === null) {
      out.push(tab)
      continue
    }
    if (wanted.has(tab.id)) out.push(tab)
  }
  return out
}

/** 这个页签当前记在哪个目标名下；没登记过返回 null */
function knownOwner(owners: TabOwners, tabId: string): string | null {
  return ownerOfTab(owners, tabId)
}

/**
 * 这个页签此刻记在哪个目标名下；没登记过返回 null。
 *
 * 显示层对没登记过的页签按当前目标兜底显示（见 visibleTabs），落点挑选沿用同一条
 * 兜底——所以判据读的是**归属表**而不是 refOwner 现算：表是显示过滤的唯一依据，
 * 落点跟着表走才不会「落点算看得见、栏上却不画它」。
 */
export function ownerOfTab(owners: TabOwners | undefined, tabId: string): string | null {
  for (const [owner, ids] of Object.entries(owners ?? {})) if (ids.includes(tabId)) return owner
  return null
}

/**
 * 这枚页签此刻是否在为「当前这个目标」服务（refOwner 的判据 + 与当前目标对上号）。
 *
 * 关页签落点的**跟随门禁**（见 useDocSaveFlow 的 applyClose）：落点是本目标的页签，
 * 当前节点/会话才跟着它走；公共页签不跟（既有口径——「从知识点切到磁盘文件」，
 * 回来该还在原知识点），**别目标的页签更不能跟**——跟过去就会把 activeGoalId 翻走，
 * 整栏页签当场换成另一套，看起来像「全组被关掉」。
 */
export function servesGoal(
  ref: TabRef,
  goalOfNode: (nodeId: string) => string | null,
  goalId: string | null,
): boolean {
  return goalId !== null && refOwner(ref, goalOfNode) === goalId
}

/** 某个目标名下的页签 id 列表（没登记过就是空的） */
export function tabsOf(owners: TabOwners | undefined, goalId: string): string[] {
  return owners?.[goalId] ?? []
}

/**
 * 把一枚页签登记到某个目标名下（已登记在别处则先摘掉——一个页签只属于一个目标）。
 *
 * 顺序语义：新登记的**排在前面**。页签栏的排布另有其人（见 focusTabsInGroup），
 * 这里只管归属，顺序只影响「同一目标里谁先开」这个次要事实。
 */
export function claimTab(owners: TabOwners | undefined, owner: string, tabId: string): TabOwners {
  const base = dropTab(owners, tabId)
  const list = base[owner] ?? []
  if (list.includes(tabId)) return base
  return { ...base, [owner]: [tabId, ...list] }
}

/** 把一个页签从归属表里摘掉（关闭页签、或它转投别处时） */
export function dropTab(owners: TabOwners | undefined, tabId: string): TabOwners {
  if (!owners) return {}
  const out: TabOwners = {}
  for (const [owner, ids] of Object.entries(owners)) {
    const rest = ids.filter((id) => id !== tabId)
    if (rest.length > 0) out[owner] = rest
  }
  return out
}

/** 批量摘掉（关掉一整组页签时） */
export function dropTabs(owners: TabOwners | undefined, tabIds: readonly string[]): TabOwners {
  const gone = new Set(tabIds)
  let out = owners ?? {}
  for (const id of gone) out = dropTab(out, id)
  return out
}

/**
 * 把归属表里**已经不存在的页签**收掉，并给**没登记过**的页签补上归属。
 *
 * 两件事都要做，而且方向相反：
 * - 收旧的：页签被关掉之后那一行还留着，切到那个目标会看到一串空 id（无害但会越长越脏）；
 * - 补新的：旧 state.json 里根本没有这张表（第一次升级到这一版），
 *   若不补，所有页签都会被判成「没登记过 → 属于当前目标」，
 *   切一次目标就会看到它们集体消失，再切回来又出现——比不升级更吓人。
 *
 * 补的时候用 `refOwner` 现算（页签自己带着 nodeId，判据是确定的），
 * 于是「升级即正确」：旧用户打开应用，页签的归属已经按当前目标分好了。
 */
export function reconcileOwners(
  owners: TabOwners | undefined,
  tabs: readonly LearnTab[],
  goalOfNode: (nodeId: string) => string | null,
): TabOwners {
  const live = new Set(tabs.map((t) => t.id))
  const out: TabOwners = {}
  const seen = new Set<string>()
  for (const [owner, ids] of Object.entries(owners ?? {})) {
    const kept: string[] = []
    for (const id of ids) {
      // 已经不存在的摘掉；同一枚被重复登记在多个目标下的，只认第一条
      if (!live.has(id) || seen.has(id)) continue
      seen.add(id)
      kept.push(id)
    }
    if (kept.length > 0) out[owner] = kept
  }
  // 没登记过的补上：按页签**出现顺序**追加，于是补出来的组里顺序与原页签栏一致
  let changed = false
  for (const tab of tabs) {
    if (seen.has(tab.id)) continue
    const owner = refOwner(tab.ref, goalOfNode)
    out[owner] = [...(out[owner] ?? []), tab.id]
    seen.add(tab.id)
    changed = true
  }
  return changed || Object.keys(out).length !== Object.keys(owners ?? {}).length ? out : (owners ?? {})
}

/**
 * 把一组页签排成「属于当前目标的在前、公共的在后」。
 *
 * 需求原文的顺序是这么来的：`Java入门大纲 设置 超级导师设置 外部文件.txt`——
 * 目标自己的页签顶在前面（一眼看到「我在学什么」），公共的（设置、外部文件）
 * 跟在后面保持它们原来的相对顺序。同一段之内照 `preferred` 给的先后排
 * （preferred 就是原本的页签栏顺序），于是打开新文档只是往前面那一段里插一枚，
 * 不动的页签不会跳位。
 *
 * 分屏保底带进来的那些（属于别的目标、但某一格正在看，见 visibleTabs 的 pinned）
 * 落在后面那一段：它们不是「我在学什么」，是「另一半还开着什么」。
 */
export function focusTabsInGroup(
  tabs: readonly LearnTab[],
  owners: TabOwners | undefined,
  goalId: string | null,
): LearnTab[] {
  if (!owners) return [...tabs]
  const mine = new Set(owners[goalId ?? PUBLIC_OWNER] ?? [])
  const own: LearnTab[] = []
  const rest: LearnTab[] = []
  for (const tab of tabs) {
    if (knownOwner(owners, tab.id) === null || mine.has(tab.id)) own.push(tab)
    else rest.push(tab)
  }
  return [...own, ...rest]
}

/**
 * 工作区上带着归属表的新一份（不可变更新，`DocWorkspace.tabOwners` 是可选字段）。
 *
 * 显式传 `undefined` 时把字段抹掉（回到「没有这张表」的旧形态）——
 * 归一化时不希望一个空对象被写进 state.json。
 */
export function withOwners(docs: DocWorkspace, owners: TabOwners | undefined): DocWorkspace {
  if (!owners || Object.keys(owners).length === 0) {
    if (docs.tabOwners === undefined) return docs
    const { tabOwners: _drop, ...rest } = docs
    return rest
  }
  return { ...docs, tabOwners: owners }
}

/**
 * 目标名下**还开着**的页签（卸载一组时收拢用）。
 *
 * 判据与 refOwner 同源：登记在本目标名下的照表收，没登记过但按页签现算得出是它的
 * 也收（某个入口绕过了 claimTab 时，卸载不该把它漏在格子里）。
 * 传进来的 `tabs` 已是布局顺序（见 allTabs），收出来的顺序就是它——归队时按原顺序开回。
 */
export function goalTabsOf(
  owners: TabOwners | undefined,
  tabs: readonly LearnTab[],
  goalOfNode: (nodeId: string) => string | null,
  goalId: string,
): LearnTab[] {
  const out: LearnTab[] = []
  for (const tab of tabs) {
    const known = ownerOfTab(owners, tab.id)
    if (known === goalId || (known === null && refOwner(tab.ref, goalOfNode) === goalId)) out.push(tab)
  }
  return out
}

/**
 * 工作区上带着**停靠场**的新一份（不可变更新，`DocWorkspace.parkedTabs` 是可选字段）。
 *
 * 显式传 `undefined` 时把字段抹掉（回到「没有这张表」的旧形态）——
 * 与 withOwners 同一条规矩：归一化时不希望一个空对象被写进 state.json。
 */
export function withParked(
  docs: DocWorkspace,
  parked: Record<string, LearnTab[]> | undefined,
): DocWorkspace {
  if (!parked || Object.keys(parked).length === 0) {
    if (docs.parkedTabs === undefined) return docs
    const { parkedTabs: _drop, ...rest } = docs
    return rest
  }
  return { ...docs, parkedTabs: parked }
}
