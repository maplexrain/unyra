import { describe, expect, it } from 'vitest'
import { groupChannelIdOf, groupThreadIdOf, threadRootIdOf } from '../src/learn/groupChat'
import { planGroupThread } from '../src/learn/roleWork/groupThread'

describe('群聊评论串索引与路由', () => {
  it('索引格式严格为 通道id>消息id', () => {
    expect(groupChannelIdOf('g1')).toBe('group:g1')
    expect(groupThreadIdOf('g1', 'msg-1')).toBe('group:g1>msg-1')
    expect(threadRootIdOf('group:g1>msg-1')).toBe('msg-1')
    expect(threadRootIdOf('bad')).toBeNull()
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
