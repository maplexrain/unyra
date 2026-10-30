/**
 * agent 栏页签的单元用例（见 src/learn/agentTabs.ts）。
 *
 * 这一层的判断错了，界面上是「导师页签关不掉 / 该留的页签重启后丢了 / 关一位导师
 * 激活权跳到谁身上不对劲」——都不是报错，而是「东西不对劲」，最难查的一类。
 * 凡是关闭守卫、激活权落点、读盘归一的取舍，都在这里钉住。
 */
import { describe, expect, it } from 'vitest'

import type { AgentTabRef } from '../src/learn/types'
import {
  agentTabCloseBlock,
  agentTabCloseSet,
  agentTabKey,
  agentTabOwner,
  normalizeAgentTabs,
  reorderAgentTabs,
  removeAgentTab,
  removeAgentTabsOfGoals,
  upsertAgentTab,
  visibleAgentTabs,
} from '../src/learn/agentTabs'

const goal = (goalId: string, conversationId: string | null = 'c1'): AgentTabRef => ({
  kind: 'goal',
  goalId,
  conversationId,
})
const sub = (conversationId: string, sessionId: string): AgentTabRef => ({ kind: 'sub', conversationId, sessionId })

describe('agentTabKey', () => {
  it('目标级按目标加会话、子代理按会话、固定聊天恒定', () => {
    expect(agentTabKey(goal('g1', 'c1'))).toBe('ga:g1:c1')
    expect(agentTabKey(goal('g1', null))).toBe('ga:g1')
    expect(agentTabKey(sub('c1', 's1'))).toBe('sa:s1')
    expect(agentTabKey({ kind: 'free', conversationId: null })).toBe('free')
  })
})

describe('固定聊天页签', () => {
  it('关闭守卫不拦它，但批量关闭的名单永远绕开它', () => {
    const ref: AgentTabRef = { kind: 'free', conversationId: null }
    expect(agentTabCloseBlock(ref, { hasDocTabs: false, running: false })).toBe('none')
    const tabs = [{ kind: 'free' as const, conversationId: null }, goal('g1'), goal('g2')]
    // 对着自己（不可能出现，防御）与「全部关闭」都不该把 free 算进名单
    expect(agentTabCloseSet(tabs, 'free', 'self')).toEqual([])
    expect(agentTabCloseSet(tabs, 'ga:g1:c1', 'all')).toEqual(['ga:g1:c1', 'ga:g2:c1'])
    expect(agentTabCloseSet(tabs, 'ga:g2:c1', 'left')).toEqual(['ga:g1:c1'])
  })
})

describe('upsertAgentTab', () => {
  it('同一目标不同会话额外开 tab，同一会话重复 upsert 原位更新并置前', () => {
    const first = upsertAgentTab([], null, goal('g1', 'c1'), true)
    expect(first.tabs).toHaveLength(1)
    // 同一目标不同会话：额外开一个对话页签
    const secondConv = upsertAgentTab(first.tabs, first.active, goal('g1', 'c2'), true)
    expect(secondConv.tabs).toHaveLength(2)
    expect(secondConv.active).toBe('ga:g1:c2')

    // 同一会话重复 upsert：原位更新
    const again = upsertAgentTab(secondConv.tabs, secondConv.active, goal('g1', 'c1'), true)
    expect(again.tabs).toHaveLength(2)
    expect(again.active).toBe('ga:g1:c1')
  })

  it('占位无会话的目标页签在有具体会话时原位升级', () => {
    const placeholder = upsertAgentTab([], null, goal('g1', null), true)
    expect(placeholder.tabs).toHaveLength(1)
    expect(placeholder.active).toBe('ga:g1')

    const upgraded = upsertAgentTab(placeholder.tabs, placeholder.active, goal('g1', 'c1'), true)
    expect(upgraded.tabs).toHaveLength(1)
    expect(upgraded.active).toBe('ga:g1:c1')
    expect(upgraded.tabs[0]).toEqual(goal('g1', 'c1'))
  })

  it('语义没有变化时保留数组和激活项引用', () => {
    const first = upsertAgentTab([], null, goal('g1', 'c1'), true)
    const again = upsertAgentTab(first.tabs, first.active, goal('g1', 'c1'), true)
    expect(again.tabs).toBe(first.tabs)
    expect(again.active).toBe(first.active)
  })

  it('新页签不要求激活时保持原激活项；没有任何激活项时补上自己', () => {
    const base = upsertAgentTab([], null, goal('g1'), true)
    const added = upsertAgentTab(base.tabs, base.active, goal('g2'), false)
    expect(added.active).toBe('ga:g1:c1')
    expect(added.tabs.map(agentTabKey)).toEqual(['ga:g1:c1', 'ga:g2:c1'])
    const coldStart = upsertAgentTab([], null, goal('g9'), false)
    expect(coldStart.active).toBe('ga:g9:c1')
  })
})

describe('removeAgentTab', () => {
  it('关掉的正是激活项时，激活权交给它原来的邻居（右边优先）', () => {
    const tabs = [goal('g1'), goal('g2'), goal('g3')]
    const closed = removeAgentTab(tabs, 'ga:g2:c1', 'ga:g2:c1')
    expect(closed.tabs.map(agentTabKey)).toEqual(['ga:g1:c1', 'ga:g3:c1'])
    expect(closed.active).toBe('ga:g3:c1')
  })

  it('关掉最后一枚时激活权清空；关别的页签不动激活项', () => {
    const only = removeAgentTab([goal('g1')], 'ga:g1:c1', 'ga:g1:c1')
    expect(only).toEqual({ tabs: [], active: null })
    const other = removeAgentTab([goal('g1'), goal('g2')], 'ga:g1:c1', 'ga:g2:c1')
    expect(other.active).toBe('ga:g1:c1')
  })

  it('关不存在的页签原样返回', () => {
    const tabs = [goal('g1')]
    expect(removeAgentTab(tabs, 'ga:g1:c1', 'ga:ghost')).toEqual({ tabs, active: 'ga:g1:c1' })
  })
})

describe('removeAgentTabsOfGoals', () => {
  it('文档区关闭目标后只移除目标导师，保留子代理和其它目标', () => {
    const tabs = [goal('g1'), goal('g2'), sub('c1', 's1')]
    const removed = removeAgentTabsOfGoals(tabs, 'ga:g1:c1', new Set(['g1']))
    expect(removed.tabs.map(agentTabKey)).toEqual(['ga:g2:c1', 'sa:s1'])
    expect(removed.active).toBe('ga:g2:c1')
  })

  it('关闭最后一个目标导师时返回空激活项，由宿主回落到固定聊天', () => {
    const removed = removeAgentTabsOfGoals([goal('g1')], 'ga:g1:c1', new Set(['g1']))
    expect(removed).toEqual({ tabs: [], active: null })
  })
})

describe('reorderAgentTabs', () => {
  it('按 key 的新顺序重排，内容原样保留', () => {
    const tabs = [goal('g1', 'c1'), goal('g2', 'c2'), goal('g3', 'c3')]
    const next = reorderAgentTabs(tabs, ['ga:g3:c3', 'ga:g1:c1', 'ga:g2:c2'])
    expect(next.map((t) => (t.kind === 'goal' ? t.goalId : ''))).toEqual(['g3', 'g1', 'g2'])
    expect(next).not.toBe(tabs)
  })

  it('数量对不上或 key 认不出时原样返回（拖动快照过时了不作数）', () => {
    const tabs = [goal('g1'), goal('g2')]
    expect(reorderAgentTabs(tabs, ['ga:g1:c1'])).toBe(tabs)
    expect(reorderAgentTabs(tabs, ['ga:g1:c1', 'ga:ghost'])).toBe(tabs)
  })
})

describe('agentTabCloseSet', () => {
  const tabs = [goal('g1'), goal('g2'), goal('g3'), goal('g4')]

  it('位置语义与文档区 closeTabs 同一套（self/left/right/others/all）', () => {
    expect(agentTabCloseSet(tabs, 'ga:g2:c1', 'self')).toEqual(['ga:g2:c1'])
    expect(agentTabCloseSet(tabs, 'ga:g3:c1', 'left')).toEqual(['ga:g1:c1', 'ga:g2:c1'])
    expect(agentTabCloseSet(tabs, 'ga:g2:c1', 'right')).toEqual(['ga:g3:c1', 'ga:g4:c1'])
    expect(agentTabCloseSet(tabs, 'ga:g2:c1', 'others')).toEqual(['ga:g1:c1', 'ga:g3:c1', 'ga:g4:c1'])
    expect(agentTabCloseSet(tabs, 'ga:g1:c1', 'all')).toEqual(['ga:g1:c1', 'ga:g2:c1', 'ga:g3:c1', 'ga:g4:c1'])
  })

  it('key 不在名单里返回空（调用方不动状态）', () => {
    expect(agentTabCloseSet(tabs, 'ga:ghost', 'self')).toEqual([])
  })
})

describe('agentTabCloseBlock', () => {
  it('目标级页签：运行中拦下，非运行状态放行（关最后一个对话页签由上层联动关页签组）', () => {
    expect(agentTabCloseBlock(goal('g1'), { hasDocTabs: true, running: true })).toBe('running')
    expect(agentTabCloseBlock(goal('g1'), { hasDocTabs: true, running: false })).toBe('none')
    expect(agentTabCloseBlock(goal('g1'), { hasDocTabs: false, running: true })).toBe('running')
    expect(agentTabCloseBlock(goal('g1'), { hasDocTabs: false, running: false })).toBe('none')
  })

  it('子代理页签永远放行：任务允许在后台继续跑', () => {
    expect(agentTabCloseBlock(sub('c1', 's1'), { hasDocTabs: true, running: true })).toBe('none')
  })
})

const CONVS = [
  { id: 'c1', goalId: 'g1', subagents: { sessions: [{ id: 's1' }, { id: 's2' }] } },
  { id: 'c2', goalId: 'g1' },
  { id: 'c3', goalId: 'g2' },
]

describe('normalizeAgentTabs', () => {
  const ctx = { goals: new Set(['g1', 'g2']), conversations: CONVS }

  it('目标 / 会话 / 子代理会话已经没了的页签当场剪掉，支持同目标多会话页签共存', () => {
    const { tabs } = normalizeAgentTabs(
      [goal('g1', 'c1'), goal('g9'), sub('c1', 's1'), sub('c1', 'ghost'), sub('c9', 's1'), goal('g1', 'c2'), goal('g1', 'c1')],
      null,
      ctx,
    )
    expect(tabs).toEqual([goal('g1', 'c1'), sub('c1', 's1'), goal('g1', 'c2')])
  })

  it('页签里记的会话丢了回落到该目标最近的一段；目标一段会话都没有时页签留着（conversationId=null）', () => {
    const { tabs } = normalizeAgentTabs([goal('g2', 'gone'), goal('g1', 'c3')], null, ctx)
    expect(tabs[0]).toEqual(goal('g2', 'c3'))
    // c3 属于 g2，对 g1 无效：回落到 g1 最近的一段（数组靠后的那一段）
    expect(tabs[1]).toEqual(goal('g1', 'c2'))
    const lonely = normalizeAgentTabs([goal('g1', 'c1')], null, {
      goals: new Set(['g1']),
      conversations: [{ id: 'cx', goalId: 'g2' }],
    })
    expect(lonely.tabs).toEqual([goal('g1', null)])
  })

  it('激活项必须是留下的页签之一，支持兼容旧版 ga:<goalId> 格式，否则回落第一枚；固定聊天是合法激活项', () => {
    expect(normalizeAgentTabs([goal('g1'), goal('g2', 'c3')], 'ga:g2:c3', ctx).active).toBe('ga:g2:c3')
    expect(normalizeAgentTabs([goal('g1'), goal('g2', 'c3')], 'ga:g2', ctx).active).toBe('ga:g2:c3')
    expect(normalizeAgentTabs([goal('g1'), goal('g2')], 'ga:gone', ctx).active).toBe('ga:g1:c1')
    expect(normalizeAgentTabs([], null, ctx).active).toBeNull()
    // 固定聊天不在 store 的页签列表里（界面合成置左），但激活项可以是它
    expect(normalizeAgentTabs([goal('g1')], 'free', ctx).active).toBe('free')
  })

  it('结构不合法的一律丢（非对象项、未知 kind、字段类型不对）', () => {
    const { tabs } = normalizeAgentTabs(
      [null, 'x', { kind: 'goal' }, { kind: 'goal', goalId: 7 }, { kind: 'sub', sessionId: 's1' }, { kind: 'web' }],
      null,
      ctx,
    )
    expect(tabs).toEqual([])
  })
})

describe('页签归属与目标绑定', () => {
  /** 会话 → 它属于哪个目标（子代理的归属按它那段对话算） */
  const convGoal: Record<string, string> = { c1: 'g1', c2: 'g2' }
  const goalOfConversation = (id: string): string | null => convGoal[id] ?? null

  it('目标级归它自己，子代理归派它出去的那个目标，固定聊天无归属', () => {
    const free: AgentTabRef = { kind: 'free', conversationId: null }
    expect(agentTabOwner(goal('g1'), goalOfConversation)).toBe('g1')
    expect(agentTabOwner(sub('c2', 's1'), goalOfConversation)).toBe('g2')
    expect(agentTabOwner(free, goalOfConversation)).toBeNull()
  })

  it('会话已经没了的子代理页签不属于任何目标（读盘归一那一步会把它丢掉）', () => {
    expect(agentTabOwner(sub('gone', 's9'), goalOfConversation)).toBeNull()
    expect(visibleAgentTabs([sub('gone', 's9')], 'g1', goalOfConversation)).toEqual([])
  })

  it('栏上只有当前目标的导师与它的子代理', () => {
    const tabs = [goal('g1', 'c1'), goal('g2', 'c2'), sub('c1', 's1'), sub('c2', 's2')]
    expect(visibleAgentTabs(tabs, 'g1', goalOfConversation).map(agentTabKey)).toEqual(['ga:g1:c1', 'sa:s1'])
    expect(visibleAgentTabs(tabs, 'g2', goalOfConversation).map(agentTabKey)).toEqual(['ga:g2:c2', 'sa:s2'])
  })

  it('固定聊天不参与过滤（它常驻栏上，由调用方另加在最左）', () => {
    const free: AgentTabRef = { kind: 'free', conversationId: null }
    expect(visibleAgentTabs([free, goal('g1')], 'g1', goalOfConversation)).toEqual([goal('g1')])
  })

  it('没有当前目标时一枚都不留：那一栏由界面说「打开一份文档，导师就来了」', () => {
    expect(visibleAgentTabs([goal('g1'), sub('c1', 's1')], null, goalOfConversation)).toEqual([])
  })

  it('upsertAgentTab 支持激活目标级页签并保持会话指向', () => {
    const tabs = [goal('g1', 'conv-1'), goal('g2', 'conv-2')]
    // 切换到 g1 的另一个会话 conv-3 并激活
    const updated = upsertAgentTab(tabs, 'ga:g2:conv-2', goal('g1', 'conv-3'), true)
    expect(updated.active).toBe('ga:g1:conv-3')
    expect(updated.tabs.find((t) => t.kind === 'goal' && t.goalId === 'g1' && t.conversationId === 'conv-3')).toEqual(
      goal('g1', 'conv-3'),
    )
  })
})
