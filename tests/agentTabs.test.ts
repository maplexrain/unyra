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
  agentTabKey,
  normalizeAgentTabs,
  removeAgentTab,
  upsertAgentTab,
} from '../src/learn/agentTabs'

const goal = (goalId: string, conversationId: string | null = 'c1'): AgentTabRef => ({
  kind: 'goal',
  goalId,
  conversationId,
})
const sub = (conversationId: string, sessionId: string): AgentTabRef => ({ kind: 'sub', conversationId, sessionId })

describe('agentTabKey', () => {
  it('目标级按目标、子代理按会话', () => {
    expect(agentTabKey(goal('g1'))).toBe('ga:g1')
    expect(agentTabKey(sub('c1', 's1'))).toBe('sa:s1')
  })
})

describe('upsertAgentTab', () => {
  it('同一目标重复 upsert 不加第二枚，只原位替换（conversationId 刷新）', () => {
    const first = upsertAgentTab([], null, goal('g1', 'c1'), true)
    expect(first.tabs).toHaveLength(1)
    const again = upsertAgentTab(first.tabs, first.active, goal('g1', 'c2'), true)
    expect(again.tabs).toHaveLength(1)
    expect(again.tabs[0]).toEqual(goal('g1', 'c2'))
    expect(again.active).toBe('ga:g1')
  })

  it('新页签不要求激活时保持原激活项；没有任何激活项时补上自己', () => {
    const base = upsertAgentTab([], null, goal('g1'), true)
    const added = upsertAgentTab(base.tabs, base.active, goal('g2'), false)
    expect(added.active).toBe('ga:g1')
    expect(added.tabs.map(agentTabKey)).toEqual(['ga:g1', 'ga:g2'])
    const coldStart = upsertAgentTab([], null, goal('g9'), false)
    expect(coldStart.active).toBe('ga:g9')
  })
})

describe('removeAgentTab', () => {
  it('关掉的正是激活项时，激活权交给它原来的邻居（右边优先）', () => {
    const tabs = [goal('g1'), goal('g2'), goal('g3')]
    const closed = removeAgentTab(tabs, 'ga:g2', 'ga:g2')
    expect(closed.tabs.map(agentTabKey)).toEqual(['ga:g1', 'ga:g3'])
    expect(closed.active).toBe('ga:g3')
  })

  it('关掉最后一枚时激活权清空；关别的页签不动激活项', () => {
    const only = removeAgentTab([goal('g1')], 'ga:g1', 'ga:g1')
    expect(only).toEqual({ tabs: [], active: null })
    const other = removeAgentTab([goal('g1'), goal('g2')], 'ga:g1', 'ga:g2')
    expect(other.active).toBe('ga:g1')
  })

  it('关不存在的页签原样返回', () => {
    const tabs = [goal('g1')]
    expect(removeAgentTab(tabs, 'ga:g1', 'ga:ghost')).toEqual({ tabs, active: 'ga:g1' })
  })
})

describe('agentTabCloseBlock', () => {
  it('目标级页签：文档区还有它的页签时拦下（docs 优先于 running）', () => {
    expect(agentTabCloseBlock(goal('g1'), { hasDocTabs: true, running: true })).toBe('docs')
    expect(agentTabCloseBlock(goal('g1'), { hasDocTabs: true, running: false })).toBe('docs')
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

  it('目标 / 会话 / 子代理会话已经没了的页签当场剪掉，按 key 去重', () => {
    const { tabs } = normalizeAgentTabs(
      [goal('g1'), goal('g9'), sub('c1', 's1'), sub('c1', 'ghost'), sub('c9', 's1'), goal('g1', 'c2')],
      null,
      ctx,
    )
    expect(tabs).toEqual([goal('g1', 'c1'), sub('c1', 's1')])
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

  it('激活项必须是留下的页签之一，否则回落第一枚', () => {
    expect(normalizeAgentTabs([goal('g1'), goal('g2')], 'ga:g2', ctx).active).toBe('ga:g2')
    expect(normalizeAgentTabs([goal('g1'), goal('g2')], 'ga:gone', ctx).active).toBe('ga:g1')
    expect(normalizeAgentTabs([], null, ctx).active).toBeNull()
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
