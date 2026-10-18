import { describe, expect, it } from 'vitest'
import type { LearnStore } from '../src/learn/types'
import {
  ensureConversation,
  latestConversation,
  resolveDisplayedConversation,
} from '../src/learn/graph/conversations'

function makeMockStore(over: Partial<LearnStore> = {}): LearnStore {
  return {
    goals: [{ id: 'g1', title: '目标1', rootNodeId: 'n1', question: 'Q1' }],
    nodes: [{ id: 'n1', goalId: 'g1', title: '节点1', description: '', annotations: [], teachingDoc: '', origin: 'user' }],
    edges: [],
    conversations: [
      { id: 'c1', goalId: 'g1', messages: [], createdAt: 1000, updatedAt: 1000 },
      { id: 'c2', goalId: 'g1', messages: [], createdAt: 2000, updatedAt: 2000 },
    ],
    docArea: {
      activeTabId: 't1',
      tabs: [{ id: 't1', title: '正文', ref: { kind: 'teach', nodeId: 'n1' } }],
      splits: [],
    },
    ...over,
  } as unknown as LearnStore
}

describe('resolveDisplayedConversation', () => {
  it('当该目标存在多个对话且激活页签展示较早的对话时，优先返回当前展示的对话而非最新对话', () => {
    const store = makeMockStore({
      agentActiveTab: 'ga:g1',
      agentTabs: [
        { kind: 'goal', goalId: 'g1', conversationId: 'c1' },
      ],
      activeConversationId: 'c1',
    })

    // latestConversation 返回创建时间最新的 c2
    expect(latestConversation(store, 'g1')?.id).toBe('c2')

    // resolveDisplayedConversation 必须返回当前激活显示的 c1
    expect(resolveDisplayedConversation(store, 'g1')).toBe('c1')
  })

  it('当没有 activeAgentTab 时，若全局 activeConversationId 属于该目标，优先使用它', () => {
    const store = makeMockStore({
      agentActiveTab: 'free',
      agentTabs: [],
      activeConversationId: 'c1',
    })

    expect(resolveDisplayedConversation(store, 'g1')).toBe('c1')
  })

  it('当子代理页签处于激活态且其父会话属于该目标时，返回其父会话上下文', () => {
    const store = makeMockStore({
      agentActiveTab: 'sa:sub-123',
      agentTabs: [
        { kind: 'sub', conversationId: 'c1', sessionId: 'sub-123' },
      ],
      activeConversationId: 'c1',
    })

    expect(resolveDisplayedConversation(store, 'g1')).toBe('c1')
  })

  it('没有任何激活显示记录时，兜底回退到最新会话', () => {
    const store = makeMockStore({
      agentActiveTab: null,
      agentTabs: [],
      activeConversationId: null,
    })

    expect(resolveDisplayedConversation(store, 'g1')).toBe('c2')
  })

  it('ensureConversation 优先复用当前显示的会话，而非最新会话', () => {
    const store = makeMockStore({
      agentActiveTab: 'ga:g1',
      agentTabs: [
        { kind: 'goal', goalId: 'g1', conversationId: 'c1' },
      ],
      activeConversationId: 'c1',
    })

    const result = ensureConversation(store, 'g1')
    expect(result.conversationId).toBe('c1')
  })
})
