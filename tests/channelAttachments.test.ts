/**
 * 私聊页的用户消息只读 channels；附件的资源库引用是转存后才有的，
 * 必须回填到那枚已经落账的 user 信封，否则气泡只有文字。
 */
import { describe, expect, it } from 'vitest'
import type { ChannelMessage, ChannelStamp, Conversation, ConversationMessage } from '../src/agent/types'
import { backfillUserEnvelopeAttachments, withEnvelopeAttachments, withUserEnvelopeAttachments } from '../src/learn/roleWork/channels'
import { normalizeConversation } from '../src/learn/store/normalize/conversation'

const envelope = (id: string): ChannelMessage => ({
  id,
  kind: 'user',
  direction: 'in',
  from: { kind: 'user', id: 'u1', name: 'Maxwell' },
  to: { kind: 'role', id: 'tutor', name: '导师龟' },
  text: '这张图里是什么？',
  ts: 1000,
})

describe('withEnvelopeAttachments', () => {
  it('只给目标信封补 attachments，其他消息与顺序不变', () => {
    const before = [envelope('g-1'), envelope('g-2')]
    const attachments = {
      images: [
        {
          id: 'img-1',
          rel: 'docs/高等数学/static/img-1.png',
          name: '截图',
          mime: 'image/png',
          bytes: 1234,
        },
      ],
    }
    const after = withEnvelopeAttachments(before, 'g-1', attachments)
    expect(after).toHaveLength(2)
    expect(after?.[0].attachments).toEqual(attachments)
    expect(after?.[1]).toBe(before[1])
    expect(before[0].attachments).toBeUndefined()
  })

  it('找不到信封或没有附件时原样返回，不制造空引用', () => {
    const before = [envelope('g-1')]
    expect(withEnvelopeAttachments(before, 'g-missing', { images: [] })).toBe(before)
    expect(withEnvelopeAttachments(before, 'g-1', undefined)).toBe(before)
  })
})

describe('withUserEnvelopeAttachments', () => {
  const image = {
    id: 'img-1',
    rel: 'docs/高等数学/static/img-1.png',
    name: '截图',
    mime: 'image/png',
    bytes: 1234,
  }
  const conv = (): Conversation => ({
    id: 'c1',
    goalId: 'g1',
    messages: [],
    createdAt: 1000,
    updatedAt: 1000,
    channels: [envelope('g-1')],
  })
  const stamp: ChannelStamp = {
    channel: 'user',
    from: { kind: 'user', id: 'u1', name: 'Maxwell' },
    to: { kind: 'role', id: 'tutor', name: '导师龟' },
    ts: 1000,
    envelopeId: 'g-1',
  }

  it('user 信封补上图片引用，原会话不被原地修改', () => {
    const before = conv()
    const after = withUserEnvelopeAttachments(before, stamp, [image], [])
    expect(after.channels?.[0].attachments?.images).toEqual([image])
    expect(before.channels?.[0].attachments).toBeUndefined()
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt)
  })

  it('非 user 通道、空附件、找不到信封时返回原会话', () => {
    const before = conv()
    expect(withUserEnvelopeAttachments(before, { ...stamp, channel: 'agent' }, [image], [])).toBe(before)
    expect(withUserEnvelopeAttachments(before, stamp, [], [])).toBe(before)
    expect(withUserEnvelopeAttachments(before, { ...stamp, envelopeId: 'g-missing' }, [image], [])).toBe(before)
  })
})

describe('backfillUserEnvelopeAttachments', () => {
  const image = {
    id: 'img-1',
    rel: 'docs/高等数学/static/img-1.png',
    name: '截图',
    mime: 'image/png',
    bytes: 1234,
  }
  const oldMessage: ConversationMessage = {
    id: 'm1',
    role: 'user',
    parts: [{ type: 'text', text: '这张图里是什么？' }],
    ts: 1000,
    channel: {
      channel: 'user',
      from: { kind: 'user', id: 'u1', name: 'Maxwell' },
      to: { kind: 'role', id: 'tutor', name: '导师龟' },
      ts: 1000,
      envelopeId: 'g-1',
    },
    images: [image],
  }

  it('旧数据：消息里有图、user 信封里没有，载入时补回', () => {
    const before = [envelope('g-1'), envelope('g-2')]
    const after = backfillUserEnvelopeAttachments(before, [oldMessage])
    expect(after?.[0].attachments?.images).toEqual([image])
    expect(after?.[1].attachments).toBeUndefined()
    expect(before[0].attachments).toBeUndefined()
  })

  it('已有附件或没有对应消息的信封不动，重复执行幂等', () => {
    const already = [{ ...envelope('g-1'), attachments: { images: [image] } }]
    expect(backfillUserEnvelopeAttachments(already, [oldMessage])).toBe(already)
    const noMsg = [envelope('g-1')]
    expect(backfillUserEnvelopeAttachments(noMsg, [])).toBe(noMsg)
  })

  it('normalizeConversation 载入时就完成自愈，界面无需等新消息', () => {
    const conv = normalizeConversation(
      {
        id: 'c1',
        goalId: 'g1',
        createdAt: 1000,
        updatedAt: 1000,
        channels: [envelope('g-1')],
        messages: [oldMessage],
      },
      new Set(['g1']),
      () => 'g1',
    )
    expect(conv?.channels?.[0].attachments?.images).toEqual([image])
  })
})
