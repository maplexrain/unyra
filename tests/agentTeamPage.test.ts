// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { tabKey, tabTitle, tabTrail, tabNodeId } from '../src/learn/tabs'
import { normalizeTab } from '../src/learn/store/normalize/tabs'
import type { LearnStore } from '../src/learn/types'
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
