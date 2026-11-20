// @vitest-environment happy-dom
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { tabKey, tabTitle, tabTrail, tabNodeId } from '../src/learn/tabs'
import { normalizeTab } from '../src/learn/store/normalize/tabs'
import type { LearnStore } from '../src/learn/types'
import type { Conversation } from '../src/agent/types'
import { deleteConversation } from '../src/learn/graph/conversations'
import { repairAgentTabsAfterDelete } from '../src/components/learn/workspace/useAgentTabActions'
import {
  conversationTimeOf,
  displayConversationTitle,
  formatConversationTime,
  sortConversationsByTimeDesc,
  visibleMessageCount,
} from '../src/components/learn/agent-team/conversationList'
import { AgentRosterSidebar } from '../src/components/learn/agent-team/AgentRosterSidebar'
import { AgentHistorySidebar } from '../src/components/learn/agent-team/AgentHistorySidebar'
import {
  isAgentTeamVisible,
  syncAgentTabForConversation,
} from '../src/components/learn/workspace/useAgentTeamHost'
import {
  focusAgentInput,
  sendAgentMessage,
  setAgentFocusHandler,
  setAgentMessenger,
  setAgentToggleHandler,
} from '../src/lib/agentFocus'

describe('智能体团队 Tab 契约', () => {
  it('tabKey 生成正确的 agentTeam 标识', () => {
    expect(tabKey({ kind: 'agentTeam' })).toBe('team:all')
    expect(tabKey({ kind: 'agentTeam', goalId: 'goal-123' })).toBe('team:goal-123')
  })

  it('tabNodeId 对系统功能页签 agentTeam 返回 null', () => {
    expect(tabNodeId({ kind: 'agentTeam' })).toBeNull()
    expect(tabNodeId({ kind: 'agentTeam', goalId: 'goal-1' })).toBeNull()
  })

  it('tabTitle 与 tabTrail 返回正确文案', () => {
    expect(tabTitle({ kind: 'agentTeam' }, () => undefined)).toBe('智能体团队')
    expect(tabTrail({ kind: 'agentTeam' }, () => '')).toBe('超级导师')
    expect(tabTrail({ kind: 'agentTeam', goalId: 'g1' }, () => '', (id) => `目标:${id}`)).toBe('目标:g1')
  })

  it('normalizeTab 支持 agentTeam 并保全 goalId', () => {
    const raw = {
      id: 'tab-team-1',
      ref: { kind: 'agentTeam', goalId: 'g-99' },
      createdAt: 1000,
      activeAt: 2000,
    }
    const normalized = normalizeTab(raw, new Map())
    expect(normalized).not.toBeNull()
    expect(normalized?.ref).toEqual({
      kind: 'agentTeam',
      goalId: 'g-99',
    })
  })
})

describe('useAgentTeamHost 纯函数编排', () => {
  const baseStore = {
    goals: [
      { id: 'g1', title: '微积分', question: '微积分', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 },
      { id: 'g2', title: '线性代数', question: '线性代数', rootNodeId: 'n2', createdAt: 2, updatedAt: 2 },
    ],
    nodes: [],
    conversations: [
      { id: 'c1', goalId: 'g1', messages: [], createdAt: 1, updatedAt: 1 },
      { id: 'c2', goalId: 'g1', messages: [], createdAt: 2, updatedAt: 2 },
      { id: 'c3', goalId: 'g2', messages: [], createdAt: 3, updatedAt: 3 },
    ],
    activeGoalId: 'g1',
    activeNodeId: 'n1',
    activeConversationId: 'c1',
    agentTabs: [{ kind: 'goal', goalId: 'g1', conversationId: 'c1' }],
    agentActiveTab: 'ga:g1:c1',
    docArea: {
      focus: 'g-main',
      layout: { kind: 'group', group: 'g-main' },
      groups: [
        {
          id: 'g-main',
          active: 't-doc',
          tabs: [
            { id: 't-doc', ref: { kind: 'teach', nodeId: 'n1' }, createdAt: 1 },
            { id: 'team:all', ref: { kind: 'agentTeam' }, createdAt: 2 },
          ],
        },
        {
          id: 'g-side',
          active: null,
          tabs: [],
        },
      ],
    },
  } as unknown as LearnStore

  it('isAgentTeamVisible 仅在任意分屏激活了 agentTeam 页签时返回 true', () => {
    expect(isAgentTeamVisible(baseStore)).toBe(false)

    const mainActive: LearnStore = {
      ...baseStore,
      docArea: {
        ...baseStore.docArea,
        groups: [
          { ...baseStore.docArea.groups[0], active: 'team:all' },
          baseStore.docArea.groups[1],
        ],
      },
    }
    expect(isAgentTeamVisible(mainActive)).toBe(true)

    const sideActive: LearnStore = {
      ...baseStore,
      docArea: {
        ...baseStore.docArea,
        groups: [
          baseStore.docArea.groups[0],
          {
            id: 'g-side',
            active: 'team:all',
            tabs: [{ id: 'team:all', ref: { kind: 'agentTeam' }, createdAt: 2 }],
          },
        ],
      },
    }
    expect(isAgentTeamVisible(sideActive)).toBe(true)
  })

  it('syncAgentTabForConversation 对当前目标会话补全并激活页签且同步 activeConversationId', () => {
    const next = syncAgentTabForConversation(baseStore, 'c2')
    expect(next.agentActiveTab).toBe('ga:g1:c2')
    expect(next.activeGoalId).toBe('g1')
    expect(next.activeConversationId).toBe('c2')
    expect(next.agentTabs).toEqual([
      { kind: 'goal', goalId: 'g1', conversationId: 'c1' },
      { kind: 'goal', goalId: 'g1', conversationId: 'c2' },
    ])
  })

  it('syncAgentTabForConversation 对其他目标会话不越权切换 activeGoalId', () => {
    const next = syncAgentTabForConversation(baseStore, 'c3')
    expect(next.agentActiveTab).toBe('ga:g2:c3')
    expect(next.activeGoalId).toBe('g1')
    expect(next.activeConversationId).toBe('c1')
  })

  it('syncAgentTabForConversation 对非目标会话（自由聊天）切到 free 页签', () => {
    const next = syncAgentTabForConversation(baseStore, 'free-conv-1')
    expect(next.agentActiveTab).toBe('free')
    expect(next.activeGoalId).toBe('g1')
  })
})

describe('agentFocus 身份校验清理与延迟派发', () => {
  beforeEach(() => {
    setAgentFocusHandler(null)
    setAgentMessenger(null)
    setAgentToggleHandler(null)
  })

  it('后注册处理器 B 后清理旧处理器 A 不会误清除 B', () => {
    const focusA = vi.fn()
    const focusB = vi.fn()
    const disposeA = setAgentFocusHandler(focusA)
    const disposeB = setAgentFocusHandler(focusB)

    // 先清理 A：不应清掉 B
    disposeA()
    expect(focusAgentInput()).toBe(true)
    expect(focusA).not.toHaveBeenCalled()
    expect(focusB).toHaveBeenCalledTimes(1)

    // 再清理 B：完全清空
    disposeB()
    expect(focusAgentInput()).toBe(false)
  })

  it('messenger 身份校验清理防止误删新注册的发送器', () => {
    const sendA = vi.fn()
    const sendB = vi.fn()
    const disposeA = setAgentMessenger(sendA)
    const disposeB = setAgentMessenger(sendB)

    disposeA()
    sendAgentMessage('hello')
    expect(sendA).not.toHaveBeenCalled()
    expect(sendB).toHaveBeenCalledWith('hello')

    disposeB()
  })

  it('未挂载发送器时暂存消息，挂载注册后自动派发', () => {
    const expand = vi.fn()
    setAgentToggleHandler({ expand })

    sendAgentMessage('测试延迟派发')
    expect(expand).toHaveBeenCalledTimes(1)

    const sendNow = vi.fn()
    const dispose = setAgentMessenger(sendNow)
    expect(sendNow).toHaveBeenCalledTimes(1)
    expect(sendNow).toHaveBeenCalledWith('测试延迟派发')

    dispose()
  })
})

function makeConv(over: Partial<Conversation> & { id: string }): Conversation {
  return {
    goalId: 'g1',
    messages: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  }
}

describe('conversationList 排序与展示纯函数', () => {
  it('sortConversationsByTimeDesc 按最近对话时间降序排序（updatedAt 与消息 ts 优先）', () => {
    const olderCreatedButRecentReply = makeConv({
      id: 'c1',
      createdAt: 1000,
      updatedAt: 5000,
    })
    const newestCreated = makeConv({
      id: 'c2',
      createdAt: 4000,
      updatedAt: 4000,
    })
    const messageNewerThanUpdated = makeConv({
      id: 'c3',
      createdAt: 2000,
      updatedAt: 2000,
      messages: [
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }], ts: 8000 },
      ],
    })

    expect(conversationTimeOf(messageNewerThanUpdated)).toBe(8000)
    const sorted = sortConversationsByTimeDesc([newestCreated, olderCreatedButRecentReply, messageNewerThanUpdated])
    expect(sorted.map((c) => c.id)).toEqual(['c3', 'c1', 'c2'])
  })

  it('displayConversationTitle 与 visibleMessageCount 跳过隐藏系统指令', () => {
    const conv = makeConv({
      id: 'c-hidden',
      messages: [
        { id: 'm0', role: 'user', hidden: true, mark: '生成大纲', parts: [{ type: 'text', text: 'internal prompt' }], ts: 10 },
        { id: 'm1', role: 'user', parts: [{ type: 'text', text: '什么是定冠词和不定冠词？' }], ts: 20 },
      ],
    })
    expect(visibleMessageCount(conv)).toBe(2)
    expect(displayConversationTitle(conv)).toBe('什么是定冠词和不定冠词？')

    const named = makeConv({ ...conv, id: 'c-named', title: '冠词入门' })
    expect(displayConversationTitle(named)).toBe('冠词入门')
  })

  it('formatConversationTime 在刚刚、同日、昨天与跨天时格式化正确', () => {
    const baseNow = new Date(2026, 10, 20, 15, 30, 0).getTime()
    expect(formatConversationTime(baseNow - 10_000, baseNow)).toBe('刚刚')

    const earlierToday = new Date(2026, 10, 20, 9, 5, 0).getTime()
    expect(formatConversationTime(earlierToday, baseNow)).toBe('09:05')

    const yesterday = new Date(2026, 10, 19, 21, 4, 0).getTime()
    expect(formatConversationTime(yesterday, baseNow)).toBe('昨天 21:04')

    const earlierMonth = new Date(2026, 9, 3, 8, 12, 0).getTime()
    expect(formatConversationTime(earlierMonth, baseNow)).toBe('10/03 08:12')
  })
})

describe('deleteConversation 与 repairAgentTabsAfterDelete 边界处理', () => {
  it('清空同目标唯一会话时同时清理 title/summary/messages', () => {
    const store = {
      goals: [{ id: 'g1', title: '英语', question: '英语', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 }],
      nodes: [],
      conversations: [
        makeConv({
          id: 'c1',
          goalId: 'g1',
          title: '冠词练习',
          messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }], ts: 10 }],
          summary: { at: 12, text: 'sum', tasks: [], messages: 1, chars: 5 },
          systemPrompt: 'sys',
        }),
      ],
      activeGoalId: 'g1',
      activeNodeId: 'n1',
      activeConversationId: 'c1',
      agentTabs: [{ kind: 'goal', goalId: 'g1', conversationId: 'c1' }],
      agentActiveTab: 'ga:g1:c1',
    } as unknown as LearnStore

    const after = deleteConversation(store, 'c1')
    expect(after.conversations).toHaveLength(1)
    expect(after.conversations[0].messages).toEqual([])
    expect(after.conversations[0].title).toBeUndefined()
    expect(after.conversations[0].summary).toBeUndefined()
    expect(after.conversations[0].systemPrompt).toBeUndefined()
  })

  it('删除当前激活目标会话后停留在同目标最新降序会话，不误跳到其他目标或丢掉 free', () => {
    const store = {
      goals: [
        { id: 'g1', title: '英语', question: '英语', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 },
        { id: 'g2', title: '数学', question: '数学', rootNodeId: 'n2', createdAt: 2, updatedAt: 2 },
      ],
      nodes: [],
      conversations: [
        makeConv({ id: 'c1', goalId: 'g1', createdAt: 100, updatedAt: 100 }),
        makeConv({ id: 'c3', goalId: 'g2', createdAt: 300, updatedAt: 300 }),
      ],
      activeGoalId: 'g1',
      activeNodeId: 'n1',
      activeConversationId: 'c1',
      agentTabs: [
        { kind: 'goal', goalId: 'g2', conversationId: 'c3' },
        { kind: 'goal', goalId: 'g1', conversationId: 'c2' },
      ],
      agentActiveTab: 'ga:g1:c2',
    } as unknown as LearnStore

    const repaired = repairAgentTabsAfterDelete(store, {
      deletedConvId: 'c2',
      deletedGoalId: 'g1',
      fallbackConvId: 'c1',
    })
    expect(repaired.agentActiveTab).toBe('ga:g1:c1')

    const freePreserved = repairAgentTabsAfterDelete(
      { ...store, agentActiveTab: 'free' },
      { deletedConvId: 'c2', deletedGoalId: 'g1', fallbackConvId: 'c1' },
    )
    expect(freePreserved.agentActiveTab).toBe('free')
  })
})

describe('三栏组件 AgentRosterSidebar & AgentHistorySidebar 交互渲染', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
  })

  it('AgentRosterSidebar 渲染「仅聊天」与「导师」两个选项并支持切换', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onSelectMode = vi.fn()

    act(() => {
      root.render(
        createElement(AgentRosterSidebar, {
          mode: 'tutor',
          onSelectMode,
          activeGoalTitle: '零基础英语语法入门',
          freeRunning: true,
          tutorRunning: false,
          tutorHasAsk: false,
        }),
      )
    })

    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabs).toHaveLength(2)
    expect(tabs[0].textContent).toContain('仅聊天')
    expect(tabs[1].textContent).toContain('导师')
    expect(tabs[1].textContent).toContain('零基础英语语法入门')
    expect(tabs[0].getAttribute('aria-selected')).toBe('false')
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')

    act(() => {
      tabs[0].click()
    })
    expect(onSelectMode).toHaveBeenCalledWith('free')

    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('AgentHistorySidebar 渲染降序列表并支持创建、切换与删除对话', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onSelectConversation = vi.fn()
    const onNewConversation = vi.fn()
    const onDeleteConversation = vi.fn()

    const convs = sortConversationsByTimeDesc([
      makeConv({ id: 'old-conv', title: '更早的会话', createdAt: 1000, updatedAt: 1000 }),
      makeConv({ id: 'new-conv', title: '最近的会话', createdAt: 500, updatedAt: 9000 }),
    ])

    act(() => {
      root.render(
        createElement(AgentHistorySidebar, {
          mode: 'free',
          conversations: convs,
          activeConversationId: 'new-conv',
          runningByConversation: {},
          pendingAskByConv: {},
          activeGoalId: null,
          goals: [],
          goalTitleOf: () => '',
          onSelectConversation,
          onNewConversation,
          onDeleteConversation,
        }),
      )
    })

    const rows = [...host.querySelectorAll<HTMLElement>('[data-conversation-id]')]
    expect(rows.map((r) => r.dataset.conversationId)).toEqual(['new-conv', 'old-conv'])

    const newBtns = [...host.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => b.textContent?.includes('新建对话') || b.getAttribute('aria-label') === '新建对话',
    )
    act(() => {
      newBtns[0].click()
    })
    expect(onNewConversation).toHaveBeenCalledTimes(1)

    const selectOld = rows[1].querySelector<HTMLButtonElement>('button')!
    act(() => {
      selectOld.click()
    })
    expect(onSelectConversation).toHaveBeenCalledWith('old-conv')

    const deleteOld = rows[1].querySelectorAll<HTMLButtonElement>('button')[1]
    act(() => {
      deleteOld.click()
    })
    expect(onDeleteConversation).toHaveBeenCalledWith('old-conv')

    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
