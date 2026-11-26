/**
 * role-work 的载入归一化：通道上限、坏数据剪掉、work 状态复位、旧 subagent 迁移。
 */
import { describe, expect, it } from 'vitest'
import { migrateLegacySubagents, normalizeChannels, normalizeWorks } from '../src/agent/roleWork/registry'

const now = 1_700_000_000_000
const peer = { kind: 'user' as const, id: 'user', name: '用户' }

describe('normalizeChannels', () => {
  it('只留最近 200 条；坏 kind / direction / text 整条丢掉', () => {
    const items = Array.from({ length: 205 }, (_, i) => ({
      id: 'e' + i,
      kind: 'user',
      direction: 'in',
      from: peer,
      to: { kind: 'role', id: 'tutor', name: '导师龟' },
      text: 'm' + i,
      ts: now,
    }))
    const out = normalizeChannels([...items, { id: 'bad', kind: 'x', direction: 'in', from: peer, to: peer, text: 't' }])!
    expect(out).toHaveLength(200)
    expect(out[0]!.text).toBe('m5')
    expect(out.some((m) => m.id === 'bad')).toBe(false)
  })

  it('旧 detail 字段载入时折入 text 的分隔语法，不再保留第二个正文字段', () => {
    const out = normalizeChannels([
      {
        id: 'e1',
        kind: 'user',
        direction: 'out',
        from: { kind: 'role', id: 'tutor', name: '导师龟' },
        to: peer,
        text: '极限讲义更新了。',
        detail: '补了定义和两道例题。',
        ts: now,
      },
    ])!
    expect(out[0]!.text).toBe('极限讲义更新了。\n\n---\n\n补了定义和两道例题。')
    expect('detail' in out[0]!).toBe(false)
  })

  it('不是数组 / 全坏 → undefined（对话上不写这个字段）', () => {
    expect(normalizeChannels('乱写')).toBeUndefined()
    expect(normalizeChannels([{ id: 'x' }])).toBeUndefined()
  })

  it('ask 气泡随通道流水落盘：表单、状态与截止时间都要保留', () => {
    const ask = {
      id: 'ask-1',
      form: {
        title: '确认难度',
        questions: [
          {
            id: 'level',
            type: 'single',
            prompt: '这次想练哪一档？',
            options: [
              { id: 'easy', label: '基础' },
              { id: 'hard', label: '挑战' },
            ],
          },
        ],
      },
      expiresAt: now + 60_000,
      status: 'answered' as const,
      settledAt: now + 1_000,
    }
    const out = normalizeChannels([
      {
        id: 'e-ask',
        kind: 'user',
        direction: 'out',
        from: peer,
        to: { kind: 'role', id: 'tutor', name: '导师龟' },
        text: '需要你确认一下',
        ts: now,
        ask,
      },
    ])!
    expect(out[0]!.ask).toMatchObject({
      id: 'ask-1',
      expiresAt: now + 60_000,
      status: 'answered',
      settledAt: now + 1_000,
    })
    expect(out[0]!.ask!.form.questions[0]).toMatchObject({ id: 'level', type: 'single' })
  })
})

describe('normalizeWorks', () => {
  it('名字非法 / id 缺失 / 重名的 work 丢掉；running 复位为 interrupted', () => {
    const out = normalizeWorks(
      {
        sessions: [
          { id: 'w1', name: '调研-1', status: 'running', messages: [], runs: 2, runtimeMs: 30 },
          { id: 'w2', name: '调研-1', status: 'idle', messages: [] },
          { id: 'w3', name: 'bad/name', messages: [] },
          { name: '没 id', messages: [] },
        ],
      },
      'tutor',
      'c1',
    )!
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'w1', name: '调研-1', status: 'interrupted', runs: 2, roleId: 'tutor', roleConversationId: 'c1' })
  })

  it('execTrace 只留合法项与最近 30 条；消息坏条剪掉', () => {
    const trace = Array.from({ length: 35 }, (_, i) => ({ at: now + i, title: 't' + i }))
    const out = normalizeWorks(
      {
        sessions: [
          {
            id: 'w1',
            name: '活',
            messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: '做活' }], ts: now }, { id: 'bad' }],
            execTrace: [...trace, { at: 'x', title: 'bad' }],
          },
        ],
      },
      'examiner',
      'c1',
    )!
    expect(out[0]!.messages).toHaveLength(1)
    expect(out[0]!.execTrace).toHaveLength(30)
    expect(out[0]!.execTrace[0]!.title).toBe('t5')
  })
})

describe('migrateLegacySubagents', () => {
  it('def.system 固化成 work.systemPrompt；缺 defKey 的脏会话跳过', () => {
    const out = migrateLegacySubagents(
      {
        defs: [{ key: 'reader', name: '文档通读', system: '通读长文档。' }],
        sessions: [
          { id: 's1', defKey: 'reader', status: 'idle', runs: 1, messages: [], lastDelivery: '结论' },
          { id: 's2' } as never,
        ],
      },
      'fixer',
      'c9',
    )!
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ name: '文档通读', systemPrompt: '通读长文档。', roleId: 'fixer', runtimeMs: 0, lastDelivery: '结论' })
  })
})
