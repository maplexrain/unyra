import { describe, expect, it } from 'vitest'
import { groupChannelIdOf, groupThreadIdOf, threadRootIdOf } from '../src/learn/groupChat'
import { planGroupThread, replyThreadIdOf } from '../src/learn/roleWork/groupThread'

describe('群聊评论串索引与路由', () => {
  it('索引格式严格为 通道id>消息id', () => {
    expect(groupChannelIdOf('g1')).toBe('group:g1')
    expect(groupThreadIdOf('g1', 'msg-1')).toBe('group:g1>msg-1')
    expect(threadRootIdOf('group:g1>msg-1')).toBe('msg-1')
    expect(threadRootIdOf('bad')).toBeNull()
  })

  it('回执沿本轮来源消息的串走，不被「最后一条群消息」带偏', () => {
    // 派单主楼：本轮来源自带 threadId
    expect(
      replyThreadIdOf({
        channel: {
          channel: 'group',
          from: { kind: 'role', id: 'dispatcher', name: '调度龟' },
          to: { kind: 'role', id: 'tutor', name: '导师龟' },
          ts: 1,
          envelopeId: 'm1',
          goalId: 'g1',
          threadId: groupThreadIdOf('g1', 'm1'),
        },
        latestThreadId: groupThreadIdOf('g1', 'other-root'),
      }),
    ).toBe('group:g1>m1')

    // 一级群消息没有自己的串：不要误挂到更早的串上
    expect(
      replyThreadIdOf({
        channel: {
          channel: 'group',
          from: { kind: 'user', id: 'u1', name: '用户' },
          to: { kind: 'role', id: 'tutor', name: '导师龟' },
          ts: 1,
          envelopeId: 'm2',
          goalId: 'g1',
        },
        latestThreadId: groupThreadIdOf('g1', 'old-root'),
      }),
    ).toBeUndefined()

    // 非群聊轮次仍用旧兜底
    expect(replyThreadIdOf({ latestThreadId: 'group:g1>old-root' })).toBe('group:g1>old-root')
  })

  it('agent 之间新任务：以本条消息为主楼开串', () => {
    expect(planGroupThread({
      goalId: 'g1',
      messageId: 'g-new',
      mentionsUser: false,
      targetIds: ['tutor'],
    })).toEqual({ threadId: 'group:g1>g-new' })
  })

  it('已在评论串里：继续原串，不新开', () => {
    expect(planGroupThread({
      goalId: 'g1',
      messageId: 'g-reply',
      latestThreadId: 'group:g1>g-root',
      mentionsUser: false,
      targetIds: ['dispatcher'],
    })).toEqual({ threadId: 'group:g1>g-root', threadRootId: 'g-root' })
  })

  it('@用户 的最终汇报回一级：即使当前在评论串也不拖回去', () => {
    expect(planGroupThread({
      goalId: 'g1',
      messageId: 'g-report',
      latestThreadId: 'group:g1>g-root',
      mentionsUser: true,
      targetIds: [],
    })).toEqual({})
  })

  it('串索引不属于当前目标 / 格式坏了：忽略，当成一级消息', () => {
    expect(planGroupThread({
      goalId: 'g1',
      messageId: 'g-x',
      latestThreadId: 'group:g2>g-root',
      mentionsUser: false,
      targetIds: [],
    })).toEqual({})
  })
})
