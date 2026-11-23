// @vitest-environment node
/**
 * role 会话单例：一位 role 在同一目标下只复用一段会话，没有才落确定性 id；
 * 历史上用随机 id 的唯一一段也要认领，不再多开。
 */
import { describe, expect, it } from 'vitest'
import type { Conversation } from '../src/agent/types'
import type { LearnStore } from '../src/learn/types'
import {
  ensureRoleConversation,
  roleConversationId,
} from '../src/learn/roleWork/roles'

const empty = { conversations: [] } as unknown as LearnStore

function withConv(conv: Conversation): LearnStore {
  return { conversations: [conv] } as unknown as LearnStore
}

describe('ensureRoleConversation', () => {
  it('同一目标第一次落确定性 id，第二次原样复用', () => {
    const first = ensureRoleConversation(empty, 'examiner', 'goal-1')
    expect(first.conversationId).toBe(roleConversationId('goal-1', 'examiner'))
    expect(first.store.conversations).toHaveLength(1)
    expect(first.store.conversations[0].voice).toBe('examiner')

    const second = ensureRoleConversation(first.store, 'examiner', 'goal-1')
    expect(second.conversationId).toBe(first.conversationId)
    expect(second.store).toBe(first.store)
    expect(second.store.conversations).toHaveLength(1)
  })

  it('历史随机 id 的唯一一段认领为当前会话，不再新建', () => {
    const legacy: Conversation = {
      id: 'c-old-examiner',
      goalId: 'goal-2',
      voice: 'examiner',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    }
    const ensured = ensureRoleConversation(withConv(legacy), 'examiner', 'goal-2')
    expect(ensured.conversationId).toBe('c-old-examiner')
    expect(ensured.store.conversations).toHaveLength(1)
  })

  it('别的 role / 别的目标的会话不算数', () => {
    const otherRole: Conversation = {
      id: 'c-designer',
      goalId: 'goal-3',
      voice: 'designer',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    }
    const otherGoal: Conversation = {
      id: 'c-examiner',
      goalId: 'goal-4',
      voice: 'examiner',
      messages: [],
      createdAt: 1,
      updatedAt: 2,
    }
    const ensured = ensureRoleConversation(withConv(otherRole), 'examiner', 'goal-3')
    expect(ensured.store.conversations).toHaveLength(2)
    expect(ensured.conversationId).toBe(roleConversationId('goal-3', 'examiner'))

    const ensured2 = ensureRoleConversation({ conversations: [otherRole, otherGoal] } as unknown as LearnStore, 'examiner', 'goal-3')
    expect(ensured2.store.conversations).toHaveLength(3)
    expect(ensured2.conversationId).toBe(roleConversationId('goal-3', 'examiner'))
  })
})
