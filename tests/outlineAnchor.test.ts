import { describe, expect, it } from 'vitest'
import {
  FIRST_GROUP,
  allTabs,
  claimTab,
  closeIn,
  emptyDocs,
  focusedTab,
  isAnchorOutline,
  openAnchorOutline,
  openOutlineTab,
  openGroupedDoc,
  unloadAnchoredGroups,
  withOwners,
} from '../src/learn/groups'
import { tabKey } from '../src/learn/tabs'
import type { TabRef } from '../src/learn/types'

/**
 * 组锚判据的单元用例（见 src/learn/groups/tabs 的 isAnchorOutline / unloadAnchoredGroups /
 * openAnchorOutline）。
 *
 * 这一层错了，界面上是「关掉一枚别处的大纲，正看着的文档被整组弹走」——
 * 需求复盘原文：「从别处打开一个文档 → 再打开其他大纲 → 关掉大纲，那份文档被弹走」。
 * 从前「凡是 outline 都算锚」正是事故根源；现在只有**目标根节点**的大纲牵动整组，
 * 阶段大纲只是一枚普通页签。
 */
const goalOfNode = (nodeId: string): string | null => {
  if (nodeId === 'rootA' || nodeId === 'childA') return 'goalA'
  if (nodeId === 'rootB') return 'goalB'
  return null
}
const rootOf = (goalId: string): string | null => {
  if (goalId === 'goalA') return 'rootA'
  if (goalId === 'goalB') return 'rootB'
  return null
}

const teach = (nodeId: string): TabRef & { kind: 'teach' } => ({ kind: 'teach', nodeId })
const outline = (nodeId: string): TabRef & { kind: 'outline' } => ({ kind: 'outline', nodeId })

/** goalA 的一格组：根大纲（组锚）+ 从别处打开的教学文档 + 一枚阶段大纲，归属都登记在 goalA */
function goalAWorkspace() {
  let docs = openGroupedDoc(emptyDocs(), teach('childA'), 'rootA', goalOfNode, 1)
  docs = openOutlineTab(docs, FIRST_GROUP, outline('childA'), goalOfNode, 2)
  let owners = claimTab(docs.tabOwners, 'goalA', tabKey(outline('rootA')))
  owners = claimTab(owners, 'goalA', tabKey(teach('childA')))
  owners = claimTab(owners, 'goalA', tabKey(outline('childA')))
  return withOwners(docs, owners)
}

describe('组锚判据（isAnchorOutline）', () => {
  it('只有目标根节点的大纲是锚；阶段大纲（某个子节点的大纲入口）不是', () => {
    expect(isAnchorOutline(outline('rootA'), goalOfNode, rootOf)).toBe(true)
    expect(isAnchorOutline(outline('childA'), goalOfNode, rootOf)).toBe(false)
    expect(isAnchorOutline(outline('rootB'), goalOfNode, rootOf)).toBe(true)
  })

  it('非大纲页签、节点已删（查不到目标/根）的一律不是锚', () => {
    expect(isAnchorOutline(teach('childA'), goalOfNode, rootOf)).toBe(false)
    expect(isAnchorOutline(outline('ghost'), goalOfNode, rootOf)).toBe(false)
  })
})

describe('关侧的组锚卸载（unloadAnchoredGroups）', () => {
  it('关掉阶段大纲：只关它自己，文档与根大纲原地不动、没有停靠', () => {
    const docs = goalAWorkspace()
    const before = allTabs(docs)
    const closed = closeIn(docs, FIRST_GROUP, tabKey(outline('childA')), 'self')
    const settled = unloadAnchoredGroups(closed, before, goalOfNode, rootOf)
    expect(settled.parkedTabs).toBeUndefined()
    expect(allTabs(settled).map((t) => t.id).sort()).toEqual(['o:rootA', 't:childA'].sort())
    expect(settled.tabOwners?.goalA).toContain('t:childA')
  })

  it('关掉根大纲（组锚）：整组收进停靠场、归属撤掉、锚自己不算停靠成员', () => {
    const docs = goalAWorkspace()
    const before = allTabs(docs)
    const closed = closeIn(docs, FIRST_GROUP, tabKey(outline('rootA')), 'self')
    const settled = unloadAnchoredGroups(closed, before, goalOfNode, rootOf)
    expect(settled.parkedTabs?.goalA?.map((t) => t.id).sort()).toEqual(['o:childA', 't:childA'].sort())
    expect(allTabs(settled).some((t) => t.ref.kind === 'teach' || t.id === 'o:childA')).toBe(false)
    // 停靠的页签归属已撤（归队时再登记回去）；锚自己被关掉的那一条留给调用方
    // 的 goneIds 清理（applyClose 里那一句 dropTabs——本函数只管「卸载」这一半）
    expect(settled.tabOwners?.goalA).toEqual(['o:rootA'])
  })

  it('重开锚：整组原样归队，落点回到大纲', () => {
    const docs = goalAWorkspace()
    const before = allTabs(docs)
    const closed = closeIn(docs, FIRST_GROUP, tabKey(outline('rootA')), 'self')
    const settled = unloadAnchoredGroups(closed, before, goalOfNode, rootOf)
    const reopened = openAnchorOutline(settled, settled.focus, outline('rootA'), goalOfNode, 5)
    expect(allTabs(reopened).map((t) => t.id).sort()).toEqual(['o:childA', 'o:rootA', 't:childA'].sort())
    expect(reopened.parkedTabs).toBeUndefined()
    expect(focusedTab(reopened)?.id).toBe('o:rootA')
    expect(reopened.tabOwners?.goalA).toContain('t:childA')
  })
})

describe('开侧的分派（openOutlineTab 普通开 / openAnchorOutline 锚开）', () => {
  it('停靠着的组：开阶段大纲不会把它拽回来', () => {
    const docs = goalAWorkspace()
    const before = allTabs(docs)
    const closed = closeIn(docs, FIRST_GROUP, tabKey(outline('rootA')), 'self')
    const settled = unloadAnchoredGroups(closed, before, goalOfNode, rootOf)
    expect(settled.parkedTabs?.goalA).toHaveLength(2)
    const after = openOutlineTab(settled, settled.focus, outline('childA'), goalOfNode, 6)
    expect(after.parkedTabs?.goalA).toHaveLength(2) // 停靠场原样，没有被拽回来
    expect(allTabs(after).some((t) => t.id === 't:childA')).toBe(false)
  })

  it('需求复现：从别处打开文档 → 打开另一枚大纲 → 关掉它，文档还在', () => {
    // 从 explorer 点开一份教学文档：openGroupedDoc 自动开根大纲（组锚）、当场登记归属
    let docs = openGroupedDoc(emptyDocs(), teach('childA'), 'rootA', goalOfNode, 1)
    docs = withOwners(docs, claimTab(docs.tabOwners, 'goalA', tabKey(teach('childA'))))
    // 接着点开**另一枚大纲**（childA 的阶段大纲），又把它关掉
    docs = openOutlineTab(docs, FIRST_GROUP, outline('childA'), goalOfNode, 2)
    const before = allTabs(docs)
    const closed = closeIn(docs, FIRST_GROUP, tabKey(outline('childA')), 'self')
    const settled = unloadAnchoredGroups(closed, before, goalOfNode, rootOf)
    // 文档与根大纲都还在，停靠场是空的——「那份文档被弹走」不再发生
    expect(allTabs(settled).map((t) => t.id).sort()).toEqual(['o:rootA', 't:childA'].sort())
    expect(settled.parkedTabs).toBeUndefined()
    expect(focusedTab(settled)?.id).toBe('t:childA')
  })
})
