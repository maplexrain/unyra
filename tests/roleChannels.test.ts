/**
 * 三通道（user / agent / work）与派发器：来源、时间戳、入站落账、忙时排队与跳边界注入。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChannelMessage, Conversation } from '../src/agent/types'
import { createChatOps } from '../src/learn/ops/chat'
import { toChatHistory } from '../src/learn/agent/history'
import {
  deliverInbound,
  enqueueInjection,
  flushChannelInbox,
  resetChannelRegistry,
  setRoleWorkDispatcher,
  takeChannelInjection,
  type RoleTurnRequest,
} from '../src/learn/roleWork/dispatch'
import { channelMetaLineOf, channelTextOf, formatMetaTs, stampLineOf } from '../src/learn/roleWork/channels'

const stampOf = (m: ChannelMessage) => ({
  channel: m.kind,
  from: m.from,
  to: m.to,
  ts: m.ts,
  envelopeId: m.id,
})

describe('通道时间戳与正文', () => {
  it('stampLineOf 保留旧的人读来源行；channelTextOf 用模型协议的元信息抬头', () => {
    const envelope: ChannelMessage = {
      id: 'e1',
      kind: 'agent',
      direction: 'in',
      from: { kind: 'role', id: 'dispatcher', name: '调度龟' },
      to: { kind: 'role', id: 'tutor', name: '导师龟' },
      text: '查一下极限',
      ts: 1_700_000_000_000,
    }
    const line = stampLineOf(stampOf(envelope))
    expect(line).toContain('Agent 通道')
    expect(line).toContain('调度龟')

    // role 上下文里每条 user 侧消息的抬头：time / channel / id / roleId / roleName
    const meta = channelMetaLineOf(stampOf(envelope))
    expect(meta.startsWith('[{time:')).toBe(true)
    expect(meta).toContain('time:' + formatMetaTs(envelope.ts))
    expect(meta).toContain('channel:agent')
    expect(meta).toContain('id:e1')
    expect(meta).toContain('roleId:dispatcher')
    expect(meta).toContain('roleName:调度龟')
    expect(meta.endsWith('}]')).toBe(true)
    expect(channelTextOf(stampOf(envelope), '查一下极限')).toBe(meta + '\n查一下极限')
  })

  it('toChatHistory 的每条 user 侧通道消息都带同一份元信息抬头', () => {
    const envelope: ChannelMessage = {
      id: 'e2',
      kind: 'user',
      direction: 'in',
      from: { kind: 'user', id: 'u1', name: 'Maxwell' },
      to: { kind: 'role', id: 'tutor', name: '导师龟' },
      text: '我想学 Java',
      ts: 1_700_000_000_000,
    }
    const history = toChatHistory([
      {
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text: envelope.text }],
        ts: envelope.ts,
        channel: stampOf(envelope),
      },
    ])
    expect(history[0]!.content).toBe(channelTextOf(stampOf(envelope), envelope.text))
    expect(history[0]!.content).toContain('channel:user')
    expect(history[0]!.content).toContain('roleName:Maxwell')
  })
})

describe('chat.send 三通道', () => {
  function makeChat(overrides: Partial<Parameters<typeof createChatOps>[0]> = {}) {
    const appended: Array<{ id: string; message: ChannelMessage }> = []
    const conversations = new Map<string, Conversation>()
    const delivered: RoleTurnRequest[] = []
    const chat = createChatOps({
      roleId: 'tutor',
      roleName: '导师龟',
      conversationId: 'c1',
      goalId: 'g1',
      getConversation: (id) => conversations.get(id) ?? null,
      appendChannel: (id, message) => appended.push({ id, message }),
      userPeer: () => ({ kind: 'user', id: 'user', name: '用户' }),
      resolveRoleConversation: () => null, // agent 通道走 ensure
      ensureRoleConversation: (role, goalId) => {
        const id = 'cv:' + role + ':' + goalId
        conversations.set(id, { id, goalId, voice: role as never, messages: [], createdAt: 1, updatedAt: 1 })
        return id
      },
      roleNameOf: (role) => role,
      messageOf: () => null,
      resolveAttachments: () => ({}),
      sendToWork: () => ({ ok: true, channel: 'work', to: '调研-1' }),
      ...overrides,
    })
    return { chat, appended, delivered, conversations }
  }

  it('user 通道：落 outbound 流水，时间戳与来源由宿主写死', async () => {
    const { chat, appended } = makeChat()
    const r = await chat.send({ channel: 'user', text: '已经让调研去查了。' })
    expect(r).toMatchObject({ ok: true, channel: 'user' })
    expect(appended).toHaveLength(1)
    expect(appended[0]!.message.direction).toBe('out')
    expect(appended[0]!.message.kind).toBe('user')
    expect(appended[0]!.message.from).toEqual({ kind: 'role', id: 'tutor', name: '导师龟' })
    expect(appended[0]!.message.to).toEqual({ kind: 'user', id: 'user', name: '用户' })
    expect(appended[0]!.message.ts).toBeGreaterThan(0)
  })

  it('agent 通道：ensure 目标会话后投递，入站带来源与时间戳', async () => {
    const { chat, appended } = makeChat()
    const channels: ChannelMessage[] = []
    setRoleWorkDispatcher(() => ({
      isConversationRunning: () => false,
      resolveRoleConversation: () => null,
      startRoleTurn: () => {},
      appendChannel: (_id, envelope) => channels.push(envelope),
    }))
    const r = await chat.send({ channel: 'agent', to: 'examiner', text: '出三道题' })
    expect(r).toMatchObject({ ok: true, channel: 'agent' })
    expect(channels).toHaveLength(1)
    expect(channels[0]!.direction).toBe('in')
    expect(channels[0]!.from).toEqual({ kind: 'role', id: 'tutor', name: '导师龟' })
    expect(channels[0]!.to).toEqual({ kind: 'role', id: 'examiner', name: 'examiner' })
    void appended
  })

  it('work 通道：交给工作管理器，要求 to（work 名），本次附件一并带过去', async () => {
    let called = ''
    let passed: unknown[] = []
    const image = { id: 'i9', rel: 'static/i9.png', name: 'i9.png', mime: 'image/png', bytes: 1 }
    const { chat } = makeChat({
      resolveAttachments: () => ({ images: [image] }),
      sendToWork: (...args) => {
        called = args[0] + ':' + args[1]
        passed = args
        return { ok: true, channel: 'work', to: args[0] }
      },
    })
    expect(await chat.send({ channel: 'work', text: '没名字' })).toMatchObject({ ok: false })
    expect(await chat.send({ channel: 'work', to: '调研-1', text: '查一下' })).toMatchObject({ ok: true })
    expect(called).toBe('调研-1:查一下')
    expect(await chat.send({ channel: 'work', to: '调研-1', text: '看图', attachments: [{ image: 'i9.png' }] })).toMatchObject({ ok: true })
    expect(passed[3]).toMatchObject({ images: [image] })
  })

  it('attachments 解析失败整笔拒绝；成功则随信封带上', async () => {
    const bad = makeChat({ resolveAttachments: () => ({ error: '图挂了' }) })
    expect(await bad.chat.send({ channel: 'user', text: '看图', attachments: [{ image: 'x.png' }] })).toMatchObject({
      ok: false,
      error: '图挂了',
    })
    const good = makeChat({ resolveAttachments: () => ({ images: [{ id: 'i1', rel: 'a.png', name: 'a.png', mime: 'image/png', bytes: 1 }] }) })
    const r = await good.chat.send({ channel: 'user', text: '看图', attachments: [{ image: 'a.png' }] })
    expect(r).toMatchObject({ ok: true })
    expect(good.appended[0]!.message.attachments?.images).toHaveLength(1)
  })
})

describe('dispatch：忙时排队、空闲起轮、跳边界注入', () => {
  beforeEach(() => {
    resetChannelRegistry()
    setRoleWorkDispatcher(() => null)
  })

  function fakeHost(running: Set<string>) {
    const started: RoleTurnRequest[] = []
    const channels: ChannelMessage[] = []
    setRoleWorkDispatcher(() => ({
      isConversationRunning: (id) => running.has(id),
      resolveRoleConversation: () => 'c1',
      startRoleTurn: (req) => started.push(req),
      appendChannel: (_id, envelope) => channels.push(envelope),
    }))
    return { started, channels }
  }

  const envelope = (id: string, text: string): ChannelMessage => ({
    id,
    kind: 'agent',
    direction: 'in',
    from: { kind: 'role', id: 'dispatcher', name: '调度龟' },
    to: { kind: 'role', id: 'tutor', name: '导师龟' },
    text,
    ts: 1,
  })

  it('空闲：落账并立即起轮；运行中：只排队', () => {
    const running = new Set<string>()
    const { started, channels } = fakeHost(running)
    const req: RoleTurnRequest = {
      conversationId: 'c1',
      role: 'tutor',
      text: '空闲消息',
      stamp: { channel: 'agent', from: { kind: 'role', id: 'dispatcher', name: '调度龟' }, to: { kind: 'role', id: 'tutor', name: '导师龟' }, ts: 1, envelopeId: 'e1' },
      envelopeId: 'e1',
    }
    expect(deliverInbound(req, envelope('e1', '空闲消息'))).toBe(true)
    expect(started).toHaveLength(1)
    expect(channels).toHaveLength(1)

    running.add('c1')
    const busyReq: RoleTurnRequest = {
      conversationId: 'c1',
      role: 'tutor',
      text: '忙时消息',
      stamp: { channel: 'agent', from: { kind: 'role', id: 'dispatcher', name: '调度龟' }, to: { kind: 'role', id: 'tutor', name: '导师龟' }, ts: 1, envelopeId: 'e2' },
      envelopeId: 'e2',
    }
    expect(deliverInbound(busyReq, envelope('e2', '忙时消息'))).toBe(false)
    expect(started).toHaveLength(1)
    const injection = takeChannelInjection('c1')
    expect(injection?.text).toContain('channel:agent')
    expect(injection?.text).toContain('roleName:调度龟')
    expect(injection?.text).toContain('忙时消息')
  })

  it('收口 flush：空闲后把排队的消息接着起一轮', () => {
    const running = new Set(['c1'])
    const { started } = fakeHost(running)
    enqueueInjection({
      conversationId: 'c1',
      role: 'tutor',
      text: '排着的活',
      stamp: { channel: 'user', from: { kind: 'user', id: 'user', name: '用户' }, to: { kind: 'role', id: 'tutor', name: '导师龟' }, ts: 1, envelopeId: 'e3' },
      envelopeId: 'e3',
    })
    running.delete('c1')
    flushChannelInbox('c1')
    expect(started).toHaveLength(1)
    expect(started[0]!.text).toBe('排着的活')
  })
})
