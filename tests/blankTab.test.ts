import { describe, expect, it } from 'vitest'
import {
  FIRST_GROUP,
  claimTab,
  closeIds,
  closeIn,
  emptyDocs,
  openInGroup,
  withOwners,
} from '../src/learn/groups'
import { makeBlankTab, newBlankKey, tabKey, tabNodeId, tabTitle, tabTrail } from '../src/learn/tabs'
import type { TabRef } from '../src/learn/types'

describe('空白页签（Blank Tab）与保底机制', () => {
  it('makeBlankTab 生成合法的空白页签，身份以 b: 开头', () => {
    const tab1 = makeBlankTab()
    const tab2 = makeBlankTab()
    expect(tab1.ref.kind).toBe('blank')
    expect(tab1.id.startsWith('b:')).toBe(true)
    expect(tab1.id).not.toBe(tab2.id)
    expect(tabTitle(tab1.ref, () => undefined)).toBe('新页签')
    expect(tabNodeId(tab1.ref)).toBeNull()
    expect(tabTrail(tab1.ref, () => '')).toBe('')
  })

  it('emptyDocs 返回的工作区保底包含一枚空白页签，不再有无页签状态', () => {
    const docs = emptyDocs()
    expect(docs.groups).toHaveLength(1)
    expect(docs.groups[0].tabs).toHaveLength(1)
    expect(docs.groups[0].tabs[0].ref.kind).toBe('blank')
    expect(docs.groups[0].active).toBe(docs.groups[0].tabs[0].id)
  })

  it('当仅剩一枚页签被关闭时，settle 自动创建一枚空白页签作为保底', () => {
    let docs = emptyDocs()
    const teachRef: TabRef = { kind: 'teach', nodeId: 'n1' }
    // 打开普通文档，就地替换单张空白页签
    docs = openInGroup(docs, FIRST_GROUP, teachRef, Date.now())
    expect(docs.groups[0].tabs).toHaveLength(1)
    expect(docs.groups[0].tabs[0].ref.kind).toBe('teach')

    // 关闭这枚唯一的普通页签
    docs = closeIn(docs, FIRST_GROUP, docs.groups[0].tabs[0].id, 'self')
    expect(docs.groups[0].tabs).toHaveLength(1)
    expect(docs.groups[0].tabs[0].ref.kind).toBe('blank')
    expect(docs.groups[0].active).toBe(docs.groups[0].tabs[0].id)
  })

  it('关闭空白页签自身且只有这一枚时，自动重置生成保底空白页签', () => {
    let docs = emptyDocs()
    const blankId = docs.groups[0].tabs[0].id
    docs = closeIn(docs, FIRST_GROUP, blankId, 'self')
    expect(docs.groups[0].tabs).toHaveLength(1)
    expect(docs.groups[0].tabs[0].ref.kind).toBe('blank')
    // 新生成的空白页签拥有新的 id
    expect(docs.groups[0].tabs[0].id).not.toBe(blankId)
  })

  it('在仅有一枚空白页签的组中打开非空白页签，自动就地替换', () => {
    let docs = emptyDocs()
    const blankId = docs.groups[0].tabs[0].id
    const noteRef: TabRef = { kind: 'note', nodeId: 'n1', note: '我的笔记' }
    docs = openInGroup(docs, FIRST_GROUP, noteRef, Date.now())
    expect(docs.groups[0].tabs).toHaveLength(1)
    expect(docs.groups[0].tabs[0].ref.kind).toBe('note')
    expect(docs.groups[0].tabs[0].id).toBe('n:n1:我的笔记')
    expect(docs.groups[0].tabs[0].id).not.toBe(blankId)
  })

  /*
   * 下面两条是「栏上只剩新标签页时，从其他地方打开新 tab，占位必须消失」的加固
   * （需求原文；见 groups/tabs 的 blankYieldsTo）：判据按**栏上看得见什么**算，
   * 不是按格子里物理躺着什么——切目标之后，格子里还睡着别目标的一排页签。
   */
  it('栏上只剩空白占位、格子里还躺着别目标的页签时，新开页签照样让占位消失', () => {
    const goalOf = (id: string): string | null => (id.startsWith('a') ? 'gA' : 'gB')
    let docs = emptyDocs()
    const teachA: TabRef = { kind: 'teach', nodeId: 'a1' }
    docs = openInGroup(docs, FIRST_GROUP, teachA, 1, undefined, goalOf)
    docs = withOwners(docs, claimTab(docs.tabOwners, 'gA', tabKey(teachA)))
    // 用户开了一枚空白占位（此刻 A 的页签还看得见，不顶替）
    const blankRef: TabRef = { kind: 'blank', key: 'bk1' }
    docs = openInGroup(docs, FIRST_GROUP, blankRef, 2, undefined, goalOf)
    expect(docs.groups[0].tabs).toHaveLength(2)
    // 「切到 gB」：上层换的是 activeGoalId 的过滤（A 的页签自此不显示），这里由 goalOf 表达
    const teachB: TabRef = { kind: 'teach', nodeId: 'b1' }
    docs = openInGroup(docs, FIRST_GROUP, teachB, 3, undefined, goalOf)
    expect(docs.groups[0].tabs.map((t) => t.ref.kind)).toEqual(['teach', 'teach'])
    expect(docs.groups[0].active).toBe(tabKey(teachB))
  })

  it('栏上不是只剩空白（有看得见的别的页签）时，空白占位留下', () => {
    // 没登记归属的页签按「看得见」兜底（见 groups/goals 的 visibleTabs）
    const noGoal = (): string | null => null
    let docs = emptyDocs()
    const teachA: TabRef = { kind: 'teach', nodeId: 'a1' }
    docs = openInGroup(docs, FIRST_GROUP, teachA, 1, undefined, noGoal)
    const blankRef: TabRef = { kind: 'blank', key: 'bk1' }
    docs = openInGroup(docs, FIRST_GROUP, blankRef, 2, undefined, noGoal)
    docs = openInGroup(docs, FIRST_GROUP, { kind: 'teach', nodeId: 'b1' }, 3, undefined, noGoal)
    expect(docs.groups[0].tabs).toHaveLength(3)
    expect(docs.groups[0].tabs.some((t) => t.ref.kind === 'blank')).toBe(true)
  })

  it('在已有其它页签的情况下打开空白页签，作为新页签追加', () => {
    let docs = emptyDocs()
    const teachRef: TabRef = { kind: 'teach', nodeId: 'n1' }
    docs = openInGroup(docs, FIRST_GROUP, teachRef, Date.now())
    const blankRef: TabRef = { kind: 'blank', key: newBlankKey() }
    docs = openInGroup(docs, FIRST_GROUP, blankRef, Date.now())
    expect(docs.groups[0].tabs).toHaveLength(2)
    expect(docs.groups[0].tabs[0].ref.kind).toBe('teach')
    expect(docs.groups[0].tabs[1].ref.kind).toBe('blank')
    expect(docs.groups[0].active).toBe(tabKey(blankRef))
  })

  it('closeIds 批量关闭所有页签后，自动生成保底空白页签', () => {
    let docs = emptyDocs()
    const t1: TabRef = { kind: 'teach', nodeId: 'n1' }
    const t2: TabRef = { kind: 'teach', nodeId: 'n2' }
    docs = openInGroup(docs, FIRST_GROUP, t1, Date.now())
    docs = openInGroup(docs, FIRST_GROUP, t2, Date.now())
    expect(docs.groups[0].tabs).toHaveLength(2)

    docs = closeIds(docs, [tabKey(t1), tabKey(t2)])
    expect(docs.groups[0].tabs).toHaveLength(1)
    expect(docs.groups[0].tabs[0].ref.kind).toBe('blank')
  })
})
