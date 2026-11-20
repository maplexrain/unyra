// @vitest-environment happy-dom
import { createElement, act, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { tabKey, tabTitle, tabTrail, tabNodeId } from '../src/learn/tabs'
import { normalizeTab } from '../src/learn/store/normalize/tabs'
import type { AgentTabRef, LearnStore } from '../src/learn/types'
import type { Conversation } from '../src/agent/types'
import { agentTabKey } from '../src/learn/agentTabs'
import { addFreeConversation, deleteFreeConversation, getFreeConversations, hydrateFreeChat } from '../src/learn/freeChat'
import { deleteConversation } from '../src/learn/graph/conversations'
import { repairAgentTabsAfterDelete, useAgentTabActions } from '../src/components/learn/workspace/useAgentTabActions'
import { AgentSlot, type AgentSlotDeps } from '../src/components/learn/workspace/AgentSlot'
import { goalConvByGoal } from '../src/components/learn/workspace/goalFocus'
import {
  conversationTimeOf,
  displayConversationTitle,
  formatConversationTime,
  lastMessagePreview,
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

  it('AgentRosterSidebar 联系人卡片展示最近消息摘要与会话计数，且 lastMessagePreview 过滤内部隐藏消息', () => {
    const conv = {
      id: 'c-preview',
      goalId: 'g1',
      messages: [
        { id: 'm1', role: 'user' as const, parts: [{ type: 'text' as const, text: '请问什么是特征向量' }], ts: 1000 },
        { id: 'm2', role: 'assistant' as const, parts: [{ type: 'text' as const, text: '特征向量是在线性变换下只发生缩放的非零向量' }], ts: 2000 },
        { id: 'm3', role: 'user' as const, hidden: true, parts: [{ type: 'text' as const, text: '内部指令' }], ts: 3000 },
      ],
      createdAt: 1000,
      updatedAt: 2000,
    }
    expect(lastMessagePreview(conv)).toContain('特征向量是在线性变换下只发生缩放的非零向量')

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(AgentRosterSidebar, {
          mode: 'free',
          onSelectMode: () => {},
          activeGoalTitle: '线性代数',
          freeRunning: false,
          tutorRunning: false,
          tutorHasAsk: false,
          freePreview: '跨目标自由聊消息',
          freeLastTime: Date.now() - 10_000,
          freeCount: 3,
          tutorPreview: '在线等导师回答',
          tutorLastTime: Date.now() - 120_000,
          tutorCount: 2,
        }),
      )
    })

    expect(host.textContent).toContain('跨目标自由聊消息')
    expect(host.textContent).toContain('在线等导师回答')
    expect(host.textContent).toContain('跨目标')
    expect(host.textContent).toContain('学习导师')
    expect(
      isAgentTeamVisible(
        {
          docArea: {
            focus: 'g1',
            layout: { kind: 'group', group: 'g1' },
            groups: [
              { id: 'g1', active: 'team:g2', tabs: [{ id: 'team:g2', ref: { kind: 'agentTeam', goalId: 'g2' }, createdAt: 1 }] },
            ],
          },
        } as unknown as LearnStore,
        'g1',
      ),
    ).toBe(false)

    act(() => {
      root.unmount()
    })
    host.remove()
  })
})

describe('AgentSlot 对话历史切换回归', () => {
  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    goalConvByGoal.clear()
    await hydrateFreeChat(null)
  })

  it('在固定 tabGoalId 的智能体团队页签中点击对话历史，实际切换可见面板而非停留在第一段对话', () => {
    const conv1 = makeConv({
      id: 'c1',
      goalId: 'g1',
      title: '第一段讨论',
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: '会话一的独占内容' }], ts: 1000 }],
      createdAt: 1000,
      updatedAt: 1000,
    })
    const conv2 = makeConv({
      id: 'c2',
      goalId: 'g1',
      title: '第二段讨论',
      messages: [{ id: 'm2', role: 'user', parts: [{ type: 'text', text: '会话二的独占内容' }], ts: 2000 }],
      createdAt: 2000,
      updatedAt: 2000,
    })
    const initialStore = {
      goals: [{ id: 'g1', title: '微积分', question: '微积分', rootNodeId: 'n1', createdAt: 1, updatedAt: 1 }],
      nodes: [
        {
          id: 'n1',
          goalId: 'g1',
          title: '极限',
          key: '极限',
          description: '',
          docs: { teaching: { content: '', updatedAt: 1 } },
          notes: [],
          annotations: [],
          status: 'learning',
          origin: 'user',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      conversations: [conv1, conv2],
      exams: [],
      resources: {},
      activeGoalId: 'g1',
      activeNodeId: 'n1',
      activeConversationId: 'c1',
      agentTabs: [
        { kind: 'goal', goalId: 'g1', conversationId: 'c1' },
        { kind: 'goal', goalId: 'g1', conversationId: 'c2' },
      ],
      agentActiveTab: 'ga:g1:c1',
      docArea: { focus: 'g-main', layout: { kind: 'group', group: 'g-main' }, groups: [{ id: 'g-main', active: null, tabs: [] }] },
      drafts: {},
      docScroll: {},
      localFiles: [],
    } as unknown as LearnStore

    const f1 = addFreeConversation(500)
    const f2 = addFreeConversation(600)
    f1.title = '自由一'
    f2.title = '自由二'

    let latestStore = initialStore
    const getLatest = () => latestStore
    const writeStore = (next: LearnStore) => {
      latestStore = next
    }

    function Harness() {
      const [store, setStore] = useState<LearnStore>(initialStore)
      const [freeConvId, setFreeConvId] = useState<string | null>(f2.id)
      const set = (next: LearnStore) => {
        writeStore(next)
        setStore(next)
      }

      const actions = useAgentTabActions({
        getLatest,
        set,
        onToast: () => {},
        setSidebarOpen: () => {},
        runningByConversation: {},
      })

      const freeTabRef = useMemo<AgentTabRef>(
        () => ({ kind: 'free', conversationId: freeConvId }),
        [freeConvId],
      )
      const agentTabs = store.agentTabs
      const agentPanes = useMemo(() => [freeTabRef, ...(agentTabs ?? [])], [freeTabRef, agentTabs])
      const activeAgentTab = useMemo(() => {
        if (store.agentActiveTab === 'free') return freeTabRef
        const tabs = agentTabs ?? []
        return tabs.find((t) => agentTabKey(t) === store.agentActiveTab) ?? tabs[0] ?? freeTabRef
      }, [store.agentActiveTab, agentTabs, freeTabRef])

      const deps: AgentSlotDeps = {
        store,
        getLatest,
        set,
        agent: {
          runningByConversation: {},
          pendingAskByConv: {},
          streams: {},
          queues: {},
          tpsByConv: {},
          liveUsageByConv: {},
          compactingConvId: null,
          subRunsAll: [],
        } as unknown as AgentSlotDeps['agent'],
        freeChats: getFreeConversations(),
        currentFreeConvId: freeConvId,
        setFreeConvId,
        onToast: () => {},
        openTab: () => {},
        effort: 'medium',
        setGlobalEffort: () => {},
        hasKey: true,
        providerName: 'test',
        vision: false,
        agentSettings: { persona: 'default', docFormat: 'markdown', compact: { threshold: 70 } } as unknown as AgentSlotDeps['agentSettings'],
        setSettingsEpoch: () => {},
        agentPanes,
        activeAgentTab,
        activeAgentTabId: agentTabKey(activeAgentTab),
        activateAgentTab: actions.activateAgentTab,
        openAgentTab: actions.openAgentTab,
        selectTutorGoal: actions.selectTutorGoal,
        exitSubagentView: actions.exitSubagentView,
        handleNewGoalConversation: actions.handleNewGoalConversation,
        removeConversation: actions.removeConversation,
        newConversationIn: actions.newConversationIn,
        selectConversationIn: actions.selectConversationIn,
        pruneImagesOf: actions.pruneImagesOf,
        startSuperLab: () => {},
        newExam: () => {},
        shouldWaitInLine: () => false,
        tabGoalId: 'g1',
      }

      return createElement(AgentSlot, { deps })
    }

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    act(() => {
      root.render(createElement(Harness))
    })

    const visiblePaneText = () => {
      const panes = [...host.querySelectorAll<HTMLElement>('.moji-tab-transition')]
      return panes.map((p) => p.textContent ?? '').join('\n')
    }

    // 初始展示 c1，c2 处于 hidden
    expect(visiblePaneText()).toContain('会话一的独占内容')
    expect(visiblePaneText()).not.toContain('会话二的独占内容')

    // 点击右侧对话历史切换至 c2
    const c2Btn = host.querySelector<HTMLButtonElement>('[data-conversation-id="c2"] button')!
    act(() => {
      c2Btn.click()
    })
    expect(visiblePaneText()).toContain('会话二的独占内容')
    expect(visiblePaneText()).not.toContain('会话一的独占内容')

    // 再切回 c1
    const c1Btn = host.querySelector<HTMLButtonElement>('[data-conversation-id="c1"] button')!
    act(() => {
      c1Btn.click()
    })
    expect(visiblePaneText()).toContain('会话一的独占内容')
    expect(visiblePaneText()).not.toContain('会话二的独占内容')

    // 切到「仅聊天」模式并在自由对话 f1 / f2 间切换
    const freeTabBtn = host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[0]
    act(() => {
      freeTabBtn.click()
    })
    const f1Btn = host.querySelector<HTMLButtonElement>(`[data-conversation-id="${f1.id}"] button`)!
    act(() => {
      f1Btn.click()
    })
    const f1Row = host.querySelector(`[data-conversation-id="${f1.id}"]`)!
    expect(f1Row.className).toContain('bg-card')

    // 切回「导师」模式，记忆该目标上次选中的 c1（即使曾点过新建对话再切回也不丢）
    const tutorTabBtn = host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]
    act(() => {
      tutorTabBtn.click()
    })
    expect(visiblePaneText()).toContain('会话一的独占内容')

    deleteFreeConversation(f1.id)
    deleteFreeConversation(f2.id)
    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
