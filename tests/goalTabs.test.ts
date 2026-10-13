/**
 * 目标页签归属的单元用例（见 src/learn/groups/goals.ts）。
 *
 * 这一层错了，界面上是「切一个目标，页签集体消失」或者「设置页跟着目标一起不见了」——
 * 都不是报错，而是「东西不见了」。所以凡是「这枚页签归谁」「切目标之后看得见哪些」
 * 这类判断，都在这里钉住。
 */
import { describe, expect, it } from 'vitest'

import type { LearnTab, TabRef } from '../src/learn/types'
import { allTabs, emptyDocs, openInGroup, renameTabRef } from '../src/learn/groups'
import {
  PUBLIC_OWNER,
  claimTab,
  dropTab,
  dropTabs,
  focusTabsInGroup,
  reconcileOwners,
  refOwner,
  tabsOf,
  visibleTabs,
  withOwners,
} from '../src/learn/groups/goals'
import type { TabOwners } from '../src/learn/groups/goals'

/** 造一枚页签（id 就是 tabKey 会给出的那个形状，够用即可） */
const tab = (ref: TabRef, id?: string): LearnTab => ({
  id: id ?? idOf(ref),
  ref,
  createdAt: 0,
})

function idOf(ref: TabRef): string {
  switch (ref.kind) {
    case 'teach':
      return 't:' + ref.nodeId
    case 'outline':
      return 'o:' + ref.nodeId
    case 'note':
      return 'n:' + ref.nodeId + ':' + ref.note
    case 'super':
      return 's:' + ref.nodeId + ':' + ref.name
    case 'exam':
      return 'e:' + ref.examId + ':' + ref.attemptId
    case 'mind':
      return 'm:' + ref.goalId
    case 'settings':
      return 'set:settings'
    case 'local':
      return 'l:' + ref.path
    default:
      return 'x'
  }
}

/* goalA 的树：rootA -> childA；goalB 的树：rootB */
const goalOfNode = (nodeId: string): string | null => {
  if (nodeId === 'rootA' || nodeId === 'childA') return 'goalA'
  if (nodeId === 'rootB') return 'goalB'
  return null
}

/* ---------- 归属判据 ---------- */

describe('refOwner', () => {
  it('节点类的页签跟着节点所属的目标走（含任意层级）', () => {
    expect(refOwner({ kind: 'teach', nodeId: 'childA' }, goalOfNode)).toBe('goalA')
    expect(refOwner({ kind: 'note', nodeId: 'childA', note: 'x' }, goalOfNode)).toBe('goalA')
    expect(refOwner({ kind: 'super', nodeId: 'childA', name: 'x' }, goalOfNode)).toBe('goalA')
    expect(refOwner({ kind: 'exam', nodeId: 'childA', examId: 'e', attemptId: 'a' }, goalOfNode)).toBe('goalA')
    expect(refOwner({ kind: 'outline', nodeId: 'rootB' }, goalOfNode)).toBe('goalB')
  })

  it('设置 / 本地文件等不属于任何目标：一律归公共', () => {
    expect(refOwner({ kind: 'settings' }, goalOfNode)).toBe(PUBLIC_OWNER)
    expect(refOwner({ kind: 'local', path: 'a.txt' }, goalOfNode)).toBe(PUBLIC_OWNER)
    expect(refOwner({ kind: 'usage' }, goalOfNode)).toBe(PUBLIC_OWNER)
  })

  it('记忆页签按它自己带的 goalId 归属', () => {
    expect(refOwner({ kind: 'mind', goalId: 'goalB' }, goalOfNode)).toBe('goalB')
  })

  it('节点已被删掉（查不到目标）时归公共：总比凭空丢一枚页签好', () => {
    expect(refOwner({ kind: 'teach', nodeId: 'ghost' }, goalOfNode)).toBe(PUBLIC_OWNER)
  })
})

/* ---------- 过滤 ---------- */

describe('visibleTabs', () => {
  const tabs = [
    tab({ kind: 'outline', nodeId: 'rootA' }),
    tab({ kind: 'settings' }),
    tab({ kind: 'local', path: 'external.txt' }),
    tab({ kind: 'teach', nodeId: 'childA' }),
    tab({ kind: 'outline', nodeId: 'rootB' }),
  ]
  const owners: TabOwners = {
    goalA: ['o:rootA', 't:childA'],
    goalB: ['o:rootB'],
    [PUBLIC_OWNER]: ['set:settings', 'l:external.txt'],
  }

  it('当前目标 = 它的页签 + 公共页签，顺序照原样', () => {
    expect(visibleTabs(tabs, owners, 'goalA').map((t) => t.id)).toEqual([
      'o:rootA',
      'set:settings',
      'l:external.txt',
      't:childA',
    ])
  })

  it('切到另一个目标：它的页签出来，前一个目标的页签收起来', () => {
    expect(visibleTabs(tabs, owners, 'goalB').map((t) => t.id)).toEqual([
      'set:settings',
      'l:external.txt',
      'o:rootB',
    ])
  })

  it('没有活动目标时只剩公共页签', () => {
    expect(visibleTabs(tabs, owners, null).map((t) => t.id)).toEqual(['set:settings', 'l:external.txt'])
  })

  it('没有归属表时按原样全给（旧数据不该凭空少页签）', () => {
    expect(visibleTabs(tabs, undefined, 'goalA').map((t) => t.id)).toEqual(tabs.map((t) => t.id))
  })

  it('没登记过的页签算当前目标的：忘了登记也不会凭空消失', () => {
    // 只登记了公共那一枚：其余四枚都没登记，切到 goalA 时应当全都在（公共的也还在）
    const half: TabOwners = { [PUBLIC_OWNER]: ['set:settings'] }
    expect(visibleTabs(tabs, half, 'goalA').map((t) => t.id)).toEqual(tabs.map((t) => t.id))
  })

  /*
   * 分屏保底：某一格**正在看**的那一片（见 activeIdsOf）不看归属，一律留在栏上。
   * 左右两半各看一个目标是分屏的常态，而「正文在眼前、它的页签却不在栏上」最难解释——
   * 用户会以为那份文档丢了，更别提还无从点回去。
   */
  it('别的目标的页签：某一格正在看它时才留在栏上', () => {
    expect(visibleTabs(tabs, owners, 'goalA', new Set(['o:rootB'])).map((t) => t.id)).toEqual([
      'o:rootA',
      'set:settings',
      'l:external.txt',
      't:childA',
      'o:rootB',
    ])
  })

  it('本目标自己那一枚不因保底而多出现一次', () => {
    expect(visibleTabs(tabs, owners, 'goalA', new Set(['t:childA', 'set:settings'])).map((t) => t.id)).toEqual([
      'o:rootA',
      'set:settings',
      'l:external.txt',
      't:childA',
    ])
  })

  it('保底救不了的（没登记的、目标已经没了的）照旧按归属算', () => {
    const half: TabOwners = { [PUBLIC_OWNER]: ['set:settings'] }
    // goalB 这一枚在表里没登记 → 归当前目标 → 保底对它没有影响（本来就在）
    expect(visibleTabs(tabs, half, 'goalA', new Set(['o:rootB'])).map((t) => t.id)).toEqual(tabs.map((t) => t.id))
  })
})

describe('分屏时页签栏的顺序（focusTabsInGroup）', () => {
  const tabs = [
    tab({ kind: 'outline', nodeId: 'rootB' }),
    tab({ kind: 'outline', nodeId: 'rootA' }),
    tab({ kind: 'settings' }),
  ]
  const owners: TabOwners = { goalA: ['o:rootA'], goalB: ['o:rootB'], [PUBLIC_OWNER]: ['set:settings'] }

  it('保底带进来的那一枚排在当前目标这一批之后', () => {
    const pinned = new Set(['o:rootB'])
    const visible = visibleTabs(tabs, owners, 'goalA', pinned)
    expect(visible.map((t) => t.id)).toEqual(['o:rootB', 'o:rootA', 'set:settings'])
    expect(focusTabsInGroup(visible, owners, 'goalA').map((t) => t.id)).toEqual([
      'o:rootA',
      'o:rootB',
      'set:settings',
    ])
  })
})

/* ---------- 登记与摘除 ---------- */

describe('claimTab / dropTab / dropTabs', () => {
  it('登记后能在该目标名下查到', () => {
    const a = claimTab(undefined, 'goalA', 'o:rootA')
    expect(tabsOf(a, 'goalA')).toEqual(['o:rootA'])
  })

  it('转投别处时从原来那一名下摘掉：一个页签只属于一个目标', () => {
    const a = claimTab(undefined, 'goalA', 't:x')
    const b = claimTab(a, 'goalB', 't:x')
    expect(tabsOf(b, 'goalA')).toEqual([])
    expect(tabsOf(b, 'goalB')).toEqual(['t:x'])
  })

  it('重复登记不产生两条', () => {
    const a = claimTab(claimTab(undefined, 'goalA', 't:x'), 'goalA', 't:x')
    expect(tabsOf(a, 'goalA')).toEqual(['t:x'])
  })

  it('dropTab 从所有名下摘掉；dropTabs 一次摘一批', () => {
    const a: TabOwners = { goalA: ['t:x', 't:y'], goalB: ['t:x'] }
    expect(dropTab(a, 't:x')).toEqual({ goalA: ['t:y'] })
    expect(dropTabs(a, ['t:x', 't:y'])).toEqual({})
  })

  it('摘完之后空的名下不留空数组', () => {
    expect(dropTab({ goalA: ['t:x'] }, 't:x')).toEqual({})
  })
})

/* ---------- 读盘补表 ---------- */

describe('reconcileOwners', () => {
  const tabs = [
    tab({ kind: 'outline', nodeId: 'rootA' }),
    tab({ kind: 'settings' }),
    tab({ kind: 'teach', nodeId: 'childA' }),
  ]

  it('旧数据（没有表）：按页签现算补一份，顺序照页签出现顺序', () => {
    const out = reconcileOwners(undefined, tabs, goalOfNode)
    expect(out).toEqual({ goalA: ['o:rootA', 't:childA'], [PUBLIC_OWNER]: ['set:settings'] })
  })

  it('表里指向已不存在页签的条目被收掉', () => {
    const out = reconcileOwners({ goalA: ['o:rootA', 't:gone'] }, tabs, goalOfNode)
    expect(out.goalA).toEqual(['o:rootA', 't:childA'])
  })

  it('同一枚页签被登记在两个目标下时只认第一条（没登记的照常补上）', () => {
    const out = reconcileOwners({ goalA: ['o:rootA'], goalB: ['o:rootA'] }, tabs, goalOfNode)
    expect(out.goalA).toEqual(['o:rootA', 't:childA'])
    expect(out.goalB).toBeUndefined()
  })

  it('内容没变时原样返回（避免每次读盘都造一份新对象）', () => {
    const stable: TabOwners = { goalA: ['o:rootA', 't:childA'], [PUBLIC_OWNER]: ['set:settings'] }
    expect(reconcileOwners(stable, tabs, goalOfNode)).toBe(stable)
  })

})

/* ---------- 组内排序 ---------- */

describe('focusTabsInGroup', () => {
  const owners: TabOwners = {
    goalA: ['o:rootA', 't:childA'],
    [PUBLIC_OWNER]: ['set:settings', 'l:external.txt'],
  }

  it('目标自己的页签顶在前面，公共的跟在后面且保持相对顺序', () => {
    // 需求原文的顺序：Java入门大纲 设置 超级导师设置 外部文件.txt
    const tabs = [
      tab({ kind: 'settings' }),
      tab({ kind: 'local', path: 'external.txt' }),
      tab({ kind: 'outline', nodeId: 'rootA' }),
    ]
    expect(focusTabsInGroup(tabs, owners, 'goalA').map((t) => t.id)).toEqual([
      'o:rootA',
      'set:settings',
      'l:external.txt',
    ])
  })

  it('同一段之内照传入的先后排（打开新文档不挪动既有的）', () => {
    const tabs = [
      tab({ kind: 'outline', nodeId: 'rootA' }),
      tab({ kind: 'settings' }),
      tab({ kind: 'teach', nodeId: 'childA' }),
    ]
    expect(focusTabsInGroup(tabs, owners, 'goalA').map((t) => t.id)).toEqual([
      'o:rootA',
      't:childA',
      'set:settings',
    ])
  })

  it('没有归属表时原样返回', () => {
    const tabs = [tab({ kind: 'settings' }), tab({ kind: 'outline', nodeId: 'rootA' })]
    expect(focusTabsInGroup(tabs, undefined, 'goalA').map((t) => t.id)).toEqual(tabs.map((t) => t.id))
  })
})

/* ---------- 写回工作区 ---------- */

describe('withOwners', () => {
  const docs = { layout: { kind: 'group' as const, group: 'g0' }, groups: [], focus: 'g0' }

  it('有内容时挂上字段', () => {
    expect(withOwners(docs, { goalA: ['t:x'] }).tabOwners).toEqual({ goalA: ['t:x'] })
  })

  it('空表时把字段抹掉：不给 state.json 留一个空壳', () => {
    expect(withOwners(docs, {}).tabOwners).toBeUndefined()
    expect(withOwners(docs, undefined).tabOwners).toBeUndefined()
  })

  it('本来就没有、这次也没有：原样返回同一个对象', () => {
    expect(withOwners(docs, undefined)).toBe(docs)
  })
})

/* ---------- 改名后归属跟着走 ---------- */

describe('改名（renameTabRef）与归属', () => {
  it('笔记改名换的是页签 id，归属跟着搬（不丢）', () => {
    const from: TabRef = { kind: 'note', nodeId: 'childA', note: '旧名' }
    const to: TabRef = { kind: 'note', nodeId: 'childA', note: '新名' }
    const opened = openInGroup(emptyDocs(), 'g0', from, 0)
    const docs = withOwners(opened, { goalA: ['n:childA:旧名'] })
    const after = renameTabRef(docs, from, to)
    expect(after.tabOwners).toEqual({ goalA: ['n:childA:新名'] })
  })

  it('改名后按新 id 仍能过滤出这一枚页签', () => {
    const from: TabRef = { kind: 'note', nodeId: 'childA', note: '旧名' }
    const to: TabRef = { kind: 'note', nodeId: 'childA', note: '新名' }
    const docs = renameTabRef(withOwners(openInGroup(emptyDocs(), 'g0', from, 0), { goalA: ['n:childA:旧名'] }), from, to)
    const tabs = allTabs(docs)
    expect(visibleTabs(tabs, docs.tabOwners, 'goalA').map((t) => t.id)).toEqual(['n:childA:新名'])
  })
})
