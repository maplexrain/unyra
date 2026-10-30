import { describe, expect, it } from 'vitest'
import type { LearnStore } from '../src/learn/types'
import {
  agentTabKey,
  upsertAgentTab,
  removeAgentTab,
} from '../src/learn/agentTabs'
import { addConversation, resolveDisplayedConversation } from '../src/learn/graph/conversations'
import { closeGoalTabGroupStore } from '../src/learn/groups'

describe('目标页签组与 Agent 多对话 Tab 联动测试', () => {
  const mockStore: LearnStore = {
    goals: [
      { id: 'g1', question: '计算机网络', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 },
      { id: 'g2', question: '操作系统', rootNodeId: 'n2', createdAt: 2, updatedAt: 2 },
    ],
    nodes: [
      { id: 'n1', goalId: 'g1', title: '计算机网络概论', description: '', docs: [], status: 'learning' },
      { id: 'n2', goalId: 'g2', title: '进程管理', description: '', docs: [], status: 'learning' },
    ],
    conversations: [
      { id: 'c1', goalId: 'g1', messages: [], createdAt: 10, updatedAt: 10, title: '初识网络' },
      { id: 'c2', goalId: 'g1', messages: [], createdAt: 20, updatedAt: 20, title: 'TCP/IP 协议' },
      { id: 'c3', goalId: 'g2', messages: [], createdAt: 30, updatedAt: 30, title: '进程调度' },
    ],
    activeGoalId: 'g1',
    activeNodeId: 'n1',
    activeConversationId: 'c1',
    agentTabs: [
      { kind: 'goal', goalId: 'g1', conversationId: 'c1' },
      { kind: 'goal', goalId: 'g2', conversationId: 'c3' },
    ],
    agentActiveTab: 'ga:g1:c1',
    docArea: {
      focus: 'g-main',
      layout: { kind: 'group', group: 'g-main' },
      groups: [
        {
          id: 'g-main',
          active: 'tab-doc-1',
          tabs: [
            { id: 'tab-doc-1', ref: { kind: 'teach', nodeId: 'n1' }, createdAt: 100 },
          ],
        },
      ],
      tabOwners: {
        g1: ['tab-doc-1'],
      },
      parkedTabs: {
        g1: [{ id: 'tab-parked-1', ref: { kind: 'teach', nodeId: 'n1' }, createdAt: 90 }],
      },
    },
  }

  it('在当前目标下新建对话：额外添加一个新对话 tab 并立即激活成为当前目标会话', () => {
    const { store: withConv, conversation } = addConversation(mockStore, 'g1')
    expect(conversation.goalId).toBe('g1')

    const t0 = upsertAgentTab(
      withConv.agentTabs ?? [],
      withConv.agentActiveTab ?? null,
      { kind: 'goal', goalId: 'g1', conversationId: conversation.id },
      true,
    )

    expect(t0.tabs).toHaveLength(3) // c1(g1), c3(g2), + newConv(g1)
    expect(t0.active).toBe(`ga:g1:${conversation.id}`)

    const next: LearnStore = {
      ...withConv,
      agentTabs: t0.tabs,
      agentActiveTab: t0.active,
      activeGoalId: 'g1',
      activeConversationId: conversation.id,
    }

    // 确认显示的会话切换为新建的会话
    expect(resolveDisplayedConversation(next, 'g1')).toBe(conversation.id)
  })

  it('打开历史对话：在当前目标页签组中额外开一个 tab，而不是覆盖当前 tab', () => {
    // 假设当前 g1 只开了 c1 tab
    expect(mockStore.agentTabs?.filter((t) => t.kind === 'goal' && t.goalId === 'g1')).toHaveLength(1)

    // 用户在历史记录中点击打开 c2
    const t0 = upsertAgentTab(
      mockStore.agentTabs ?? [],
      mockStore.agentActiveTab ?? null,
      { kind: 'goal', goalId: 'g1', conversationId: 'c2' },
      true,
    )

    // 应该额外新增 tab，原 c1 依然保留
    const g1Tabs = t0.tabs.filter((t) => t.kind === 'goal' && t.goalId === 'g1')
    expect(g1Tabs).toHaveLength(2)
    expect(g1Tabs.map(agentTabKey)).toEqual(['ga:g1:c1', 'ga:g1:c2'])
    expect(t0.active).toBe('ga:g1:c2')

    // 再次点击已打开的 c1：激活已有 tab，不重复增加
    const t1 = upsertAgentTab(t0.tabs, t0.active, { kind: 'goal', goalId: 'g1', conversationId: 'c1' }, true)
    expect(t1.tabs.filter((t) => t.kind === 'goal' && t.goalId === 'g1')).toHaveLength(2)
    expect(t1.active).toBe('ga:g1:c1')
  })

  it('关闭非最后一个对话 tab：只关闭该 tab，不影响该目标的其他对话 tab 和文档区 tab', () => {
    // 准备含有两个 g1 tab 的 store
    const storeWithTwoTabs: LearnStore = {
      ...mockStore,
      agentTabs: [
        { kind: 'goal', goalId: 'g1', conversationId: 'c1' },
        { kind: 'goal', goalId: 'g1', conversationId: 'c2' },
      ],
      agentActiveTab: 'ga:g1:c2',
    }

    const keyToClose = 'ga:g1:c2'
    const next = removeAgentTab(storeWithTwoTabs.agentTabs ?? [], storeWithTwoTabs.agentActiveTab ?? null, keyToClose)

    // c2 移除，c1 仍保留，且激活权交给左侧邻居 c1
    expect(next.tabs.map(agentTabKey)).toEqual(['ga:g1:c1'])
    expect(next.active).toBe('ga:g1:c1')

    // 文档区 tab 完全未受影响
    expect(storeWithTwoTabs.docArea.tabOwners?.g1).toEqual(['tab-doc-1'])
  })

  it('关闭最后一个对话 tab：联动关闭整个目标页签组（文档区 tabs、停靠场、以及 agent tabs）', () => {
    // 仅剩一个 g1 对话 tab
    const storeWithOneTab: LearnStore = {
      ...mockStore,
      agentTabs: [
        { kind: 'goal', goalId: 'g1', conversationId: 'c1' },
        { kind: 'goal', goalId: 'g2', conversationId: 'c3' },
      ],
      agentActiveTab: 'ga:g1:c1',
    }

    // 触发关闭目标页签组
    const closed = closeGoalTabGroupStore(storeWithOneTab, 'g1')

    // 1. g1 的 agent tabs 被完全清理
    expect(closed.agentTabs?.filter((t) => t.kind === 'goal' && t.goalId === 'g1')).toHaveLength(0)

    // 2. 停靠场缓存被清理
    expect(closed.docArea.parkedTabs?.g1).toBeUndefined()

    // 3. 归属表中的 g1 被清理
    expect(closed.docArea.tabOwners?.g1).toBeUndefined()

    // 4. 文档区 tab-doc-1 被关闭，主区置为空白占位
    const activeDocTabId = closed.docArea.groups[0]?.active
    const activeDocTab = closed.docArea.groups[0]?.tabs.find((t) => t.id === activeDocTabId)
    expect(activeDocTab?.ref.kind).toBe('blank')

    // 5. activeGoalId 清空
    expect(closed.activeGoalId).toBeNull()
    expect(closed.activeConversationId).toBeNull()
  })
})
