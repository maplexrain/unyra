import { describe, expect, it } from 'vitest'
import {
  FIRST_GROUP,
  claimTab,
  closeIds,
  closeIn,
  emptyDocs,
  openInGroup,
  settle,
  withGroup,
  withOwners,
} from '../src/learn/groups'
import { closeTabs, makeBlankTab, makeDraftTab, newBlankKey, tabKey, tabNodeId, tabTitle, tabTrail } from '../src/learn/tabs'
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

/*
 * 「一个页签栏有且只有一枚新页签」——需求原文。
 *
 * 三条路都要挡住：开页签那条主路（openInGroup 直接切到已有的那枚）、关闭时的落点
 * （closeTabs 要补空白占位，别补第二枚）、以及任何别的路径（settle 这一道不变量兜底）。
 * 前两条是「行为正确」，第三条是「数据层构造不出坏状态」——少哪一条，
 * 用户都会在某次关闭之后看到两枚「新页签」并排躺在栏上。
 */
describe('一个页签栏有且只有一枚新页签', () => {
  it('这一格已经有新页签时再开一枚：切到已有那枚，不追加第二枚', () => {
    let docs = emptyDocs()
    const first = docs.groups[0].tabs[0]
    expect(first.ref.kind).toBe('blank')

    docs = openInGroup(docs, FIRST_GROUP, { kind: 'blank', key: newBlankKey() }, 2)

    expect(docs.groups[0].tabs, '仍然只有一枚').toHaveLength(1)
    expect(docs.groups[0].tabs[0].id, '还是原来那枚（新开的那个 key 被丢掉了）').toBe(first.id)
    expect(docs.groups[0].active).toBe(first.id)
  })

  it('已经有了别的页签时再开新页签：追加一枚（不是替换），但只此一枚', () => {
    let docs = emptyDocs()
    docs = openInGroup(docs, FIRST_GROUP, { kind: 'teach', nodeId: 'n1' }, 1)
    docs = openInGroup(docs, FIRST_GROUP, { kind: 'blank', key: newBlankKey() }, 2)
    expect(docs.groups[0].tabs).toHaveLength(2)

    // 再点一次「新页签」：不该冒出第三枚
    docs = openInGroup(docs, FIRST_GROUP, { kind: 'blank', key: newBlankKey() }, 3)
    expect(docs.groups[0].tabs).toHaveLength(2)
    expect(docs.groups[0].tabs.filter((t) => t.ref.kind === 'blank')).toHaveLength(1)
  })

  it('新建文件页签不受这条限制：草稿可以同时开好几份', () => {
    let docs = emptyDocs()
    docs = openInGroup(docs, FIRST_GROUP, { kind: 'draft', key: 'k1' }, 1)
    docs = openInGroup(docs, FIRST_GROUP, { kind: 'draft', key: 'k2' }, 2)
    expect(docs.groups[0].tabs.filter((t) => t.ref.kind === 'draft')).toHaveLength(2)
  })

  it('关闭时的落点要补空白占位：这一格已经有新页签就用它，不补第二枚', () => {
    const blank = makeBlankTab()
    // 一枚空白 + 两枚别的目标藏着的页签：关掉其中一枚时，可见候选耗尽，落点走「补空白」那条路
    const hiddenA = { id: 't:h1', ref: { kind: 'teach', nodeId: 'h1' } as TabRef, createdAt: 1 }
    const hiddenB = { id: 't:h2', ref: { kind: 'teach', nodeId: 'h2' } as TabRef, createdAt: 2 }
    const r = closeTabs([blank, hiddenA, hiddenB], hiddenA.id, 'self', hiddenA.id, undefined, () => false)
    expect(r.tabs.filter((t) => t.ref.kind === 'blank'), '不该多出第二枚').toHaveLength(1)
    expect(r.active, '落点就是那一枚已有的新页签').toBe(blank.id)
  })

  it('settle 兜底：两枚新页签躺在一格里时只留第一枚', () => {
    const first = makeBlankTab()
    const second = makeBlankTab()
    let docs = emptyDocs()
    // 绕过所有入口直接造出坏状态：withGroup 不收拾，settle 才收拾
    docs = withGroup(docs, FIRST_GROUP, (g) => ({ ...g, tabs: [first, second], active: second.id }))

    docs = settle(docs)

    expect(docs.groups[0].tabs).toHaveLength(1)
    expect(docs.groups[0].tabs[0].id, '留用户先看到的那一枚').toBe(first.id)
    expect(docs.groups[0].active, '被丢掉的那枚正好是 active：兜底指回格子里剩的那一枚').toBe(first.id)
  })

  it('settle 不动草稿：去重只针对新页签', () => {
    const a = makeDraftTab()
    const b = makeDraftTab()
    let docs = emptyDocs()
    docs = withGroup(docs, FIRST_GROUP, (g) => ({ ...g, tabs: [a, b], active: b.id }))
    docs = settle(docs)
    expect(docs.groups[0].tabs).toHaveLength(2)
  })
})
