/**
 * 目标页签归属的单元用例（见 src/learn/groups/goals.ts）。
 *
 * 这一层错了，界面上是「切一个目标，页签集体消失」或者「设置页跟着目标一起不见了」——
 * 都不是报错，而是「东西不见了」。所以凡是「这枚页签归谁」「切目标之后看得见哪些」
 * 这类判断，都在这里钉住。
 */
import { describe, expect, it } from 'vitest'

import type { LearnTab, TabRef } from '../src/learn/types'
import {
  allTabs,
  emptyDocs,
  focusedTab,
  goalTabsOf,
  normalizeDocs,
  openAnchorOutline,
  openInGroup,
  renameTabRef,
  restoreParkedTabs,
  withParked,
} from '../src/learn/groups'
import { closeTabs } from '../src/learn/tabs'
import {
  PUBLIC_OWNER,
  claimTab,
  dropTab,
  dropTabs,
  focusTabsInGroup,
  ownerOfTab,
  reconcileOwners,
  refOwner,
  servesGoal,
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

/* ---------- 关页签的落点跟随判据 ---------- */

describe('servesGoal（落点跟随的门禁）', () => {
  it('当前目标自己的页签才跟', () => {
    expect(servesGoal({ kind: 'teach', nodeId: 'childA' }, goalOfNode, 'goalA')).toBe(true)
    expect(servesGoal({ kind: 'outline', nodeId: 'rootA' }, goalOfNode, 'goalA')).toBe(true)
    expect(servesGoal({ kind: 'note', nodeId: 'childA', note: 'x' }, goalOfNode, 'goalA')).toBe(true)
  })

  it('公共页签与别目标的页签都不跟', () => {
    expect(servesGoal({ kind: 'local', path: 'b.txt' }, goalOfNode, 'goalA')).toBe(false)
    expect(servesGoal({ kind: 'settings' }, goalOfNode, 'goalA')).toBe(false)
    // 跟过去会把 activeGoalId 翻走，整栏页签当场换成另一套——看起来像「全组被关掉」
    expect(servesGoal({ kind: 'teach', nodeId: 'rootB' }, goalOfNode, 'goalA')).toBe(false)
    expect(servesGoal({ kind: 'mind', goalId: 'goalB' }, goalOfNode, 'goalA')).toBe(false)
  })

  it('没有当前目标时谁都不跟', () => {
    expect(servesGoal({ kind: 'teach', nodeId: 'childA' }, goalOfNode, null)).toBe(false)
  })
})

describe('ownerOfTab（归属表反查）', () => {
  it('登记过的查表得出归属，没登记过的返回 null', () => {
    const owners = claimTab(undefined, 'goalA', 't:childA')
    expect(ownerOfTab(owners, 't:childA')).toBe('goalA')
    expect(ownerOfTab(owners, 'l:b.txt')).toBeNull()
  })

  it('没有归属表时一律 null', () => {
    expect(ownerOfTab(undefined, 't:childA')).toBeNull()
  })
})

/* ---------- 关页签的可见优先落点 ---------- */

/**
 * 与 useDocSaveFlow 的 applyClose 同一条判据：栏上画得出来的才算「看得见」
 * （见 groups/goals 的 visibleTabs——登记过的按归属，没登记的按当前目标兜底显示）。
 */
const preferVisibleOf = (owners: TabOwners, gid: string) => (t: LearnTab): boolean => {
  const known = ownerOfTab(owners, t.id)
  return known === null || known === gid || known === PUBLIC_OWNER
}

describe('closeTabs 的可见优先落点', () => {
  // goalA 正在看：a1 / a2 是它自己的页签；bh 是 goalB 的（在栏上被藏起来）；f 是公共的本地文件
  const a1 = tab({ kind: 'teach', nodeId: 'childA' })
  const a2 = tab({ kind: 'note', nodeId: 'childA', note: 'n' })
  const bh = tab({ kind: 'teach', nodeId: 'rootB' })
  const bh2 = tab({ kind: 'teach', nodeId: 'rootB2' }, 't:rootB2')
  const f = tab({ kind: 'local', path: 'b.txt' })
  const owners: TabOwners = { goalA: [a1.id, a2.id], goalB: [bh.id, bh2.id], [PUBLIC_OWNER]: [f.id] }
  const prefer = preferVisibleOf(owners, 'goalA')

  it('右邻是被藏起来的页签时，落到左边看得见的（不把目标翻走）', () => {
    // 物理顺序 [a1, f, bh]：正在看 f，关掉它，物理右邻 bh 在 goalA 的栏上根本没有这枚
    const r = closeTabs([a1, f, bh], f.id, 'self', f.id, undefined, prefer)
    expect(r.tabs.map((t) => t.id)).toEqual([a1.id, bh.id])
    expect(r.active).toBe(a1.id)
  })

  it('物理最后一枚是被藏起来的页签时，也不落它', () => {
    // 物理顺序 [a1, bh, f]：关掉 f，物理上最后留着的是 bh——照旧规则会落它
    const r = closeTabs([a1, bh, f], f.id, 'self', f.id, undefined, prefer)
    expect(r.active).toBe(a1.id)
  })

  it('右边有看得见的仍优先落右边（与原规则同向）', () => {
    const r = closeTabs([a1, f, a2], f.id, 'self', f.id, undefined, prefer)
    expect(r.active).toBe(a2.id)
  })

  it('整格都看不见：补一枚空白页签当落点，藏着的页签保持沉睡', () => {
    // 这一格只剩 goalB 藏着的页签：不把哪一枚顶到眼前（那是「退到别的 tab 组」，
    // 用户得一枚一枚关掉，没完没了）——补一枚空白页签；藏着的原样留在格里，切到 goalB 还在
    const r = closeTabs([bh, f, bh2], f.id, 'self', f.id, undefined, prefer)
    expect(r.tabs).toHaveLength(3)
    expect(r.tabs[0].id).toBe(bh.id)
    expect(r.tabs[1].id).toBe(bh2.id)
    expect(r.tabs[2].ref.kind).toBe('blank')
    expect(r.active).toBe(r.tabs[2].id)
  })

  it('关掉空白页签后仍没有看得见的：再补一枚，藏着的继续沉睡', () => {
    const blank1 = tab({ kind: 'blank', key: 'k1' }, 'b:k1')
    const r = closeTabs([bh, blank1], blank1.id, 'self', blank1.id, undefined, prefer)
    expect(r.tabs).toHaveLength(2)
    expect(r.tabs[0].id).toBe(bh.id)
    expect(r.tabs[1].ref.kind).toBe('blank')
    expect(r.active).toBe(r.tabs[1].id)
  })

  it('关的不是当前页签时，当前页签不动', () => {
    const r = closeTabs([a1, f, bh], f.id, 'self', a1.id, undefined, prefer)
    expect(r.active).toBe(a1.id)
  })

  it('全部关闭仍按整格收（连藏着的页签一起，落点为空）', () => {
    const r = closeTabs([a1, f, bh], a1.id, 'all', a1.id, undefined, prefer)
    expect(r.tabs).toEqual([])
    expect(r.active).toBeNull()
  })

  it('不传 preferVisible 时维持原物理落点（回归锚）', () => {
    // 旧规则：右边有就落右边——落的正是那枚看不见的 bh，这正是要修掉的行为
    const r = closeTabs([a1, f, bh], f.id, 'self', f.id)
    expect(r.active).toBe(bh.id)
  })
})

/* ---------- 大纲页 = 组锚：卸载停靠与归队 ---------- */

describe('goalTabsOf（卸载一组时收拢它名下的页签）', () => {
  it('登记在本目标名下的照表收；公共的与别目标的不收', () => {
    const owners: TabOwners = { goalA: ['t:childA'], goalB: ['t:rootB'], [PUBLIC_OWNER]: ['l:f.txt'] }
    const tabs = [
      tab({ kind: 'teach', nodeId: 'childA' }),
      tab({ kind: 'local', path: 'f.txt' }, 'l:f.txt'),
      tab({ kind: 'teach', nodeId: 'rootB' }),
    ]
    expect(goalTabsOf(owners, tabs, goalOfNode, 'goalA').map((t) => t.id)).toEqual(['t:childA'])
  })

  it('没登记过但按页签算得出来是它的也收（漏登记的不丢在格子里）', () => {
    const tabs = [tab({ kind: 'note', nodeId: 'childA', note: 'n' })]
    expect(goalTabsOf(undefined, tabs, goalOfNode, 'goalA')).toHaveLength(1)
    expect(goalTabsOf(undefined, tabs, goalOfNode, 'goalB')).toHaveLength(0)
  })
})

describe('withParked（停靠场）', () => {
  const docs = { layout: { kind: 'group' as const, group: 'g0' }, groups: [], focus: 'g0' }

  it('有内容挂上；空表与 undefined 抹掉（不给 state.json 留空壳）', () => {
    expect(withParked(docs, { goalA: [tab({ kind: 'teach', nodeId: 'childA' })] }).parkedTabs).toBeDefined()
    expect(withParked(docs, {}).parkedTabs).toBeUndefined()
    expect(withParked(docs, undefined).parkedTabs).toBeUndefined()
  })
})

describe('大纲页 = 组锚（restoreParkedTabs / openAnchorOutline）', () => {
  it('归队：停靠的页签按原顺序开回、归属重登记、停靠场清空', () => {
    const doc = tab({ kind: 'teach', nodeId: 'childA' })
    const parked = withParked(emptyDocs(), { goalA: [doc] })
    const restored = restoreParkedTabs(parked, 'goalA')
    expect(allTabs(restored).map((t) => t.id)).toEqual([doc.id])
    expect(restored.tabOwners?.goalA).toContain(doc.id)
    expect(restored.parkedTabs).toBeUndefined()
  })

  it('视图选择跟着页签一起归队', () => {
    const doc: LearnTab = { ...tab({ kind: 'teach', nodeId: 'childA' }), view: 'source' }
    const restored = restoreParkedTabs(withParked(emptyDocs(), { goalA: [doc] }), 'goalA')
    expect(allTabs(restored)[0]?.view).toBe('source')
  })

  it('没有停靠时归队是空操作（原对象原样返回）', () => {
    const docs = emptyDocs()
    expect(restoreParkedTabs(docs, 'goalA')).toBe(docs)
  })

  it('openAnchorOutline：开组锚的同时让停靠的组归队，落点回到大纲', () => {
    const doc = tab({ kind: 'teach', nodeId: 'childA' })
    const parked = withParked(emptyDocs(), { goalA: [doc] })
    const opened = openAnchorOutline(parked, parked.focus, { kind: 'outline', nodeId: 'rootA' }, goalOfNode, 0)
    expect(allTabs(opened).map((t) => t.id)).toEqual(['o:rootA', doc.id])
    expect(opened.tabOwners?.goalA).toContain(doc.id)
    expect(opened.parkedTabs).toBeUndefined()
    expect(focusedTab(opened)?.id).toBe('o:rootA')
  })

  it('openAnchorOutline：没有停靠时就只是开大纲（归属照同一行登记上）', () => {
    const docs = emptyDocs()
    const opened = openAnchorOutline(docs, docs.focus, { kind: 'outline', nodeId: 'rootA' }, goalOfNode, 0)
    expect(allTabs(opened).map((t) => t.id)).toEqual(['o:rootA'])
    expect(opened.parkedTabs).toBeUndefined()
    expect(opened.tabOwners?.goalA).toContain('o:rootA')
  })
})

describe('normalizeDocs 认回停靠场', () => {
  const tabOf = (raw: unknown): LearnTab | null => {
    const t = raw as LearnTab | null
    return t && typeof t === 'object' && typeof t.id === 'string' ? t : null
  }
  const rawDocs = {
    layout: { kind: 'group', group: 'g0' },
    groups: [{ id: 'g0', tabs: [], active: null }],
    focus: 'g0',
  }

  it('形状对的照单认回', () => {
    const docs = normalizeDocs(
      { ...rawDocs, parkedTabs: { goalA: [{ id: 't:childA', ref: { kind: 'teach', nodeId: 'childA' }, createdAt: 0 }] } },
      {},
      tabOf,
    )
    expect(docs.parkedTabs?.goalA).toHaveLength(1)
    expect(docs.parkedTabs?.goalA?.[0]?.id).toBe('t:childA')
  })

  it('形状不对整个字段丢掉（宁可当它没有）', () => {
    const docs = normalizeDocs({ ...rawDocs, parkedTabs: '垃圾' }, {}, tabOf)
    expect(docs.parkedTabs).toBeUndefined()
  })
})
