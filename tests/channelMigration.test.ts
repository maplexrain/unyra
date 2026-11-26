import { describe, expect, it } from 'vitest'
import { normalizeChannels } from '../src/agent/roleWork/registry'
import type { ChannelMessage } from '../src/agent/types'

const base: ChannelMessage = {
  id: 'g1',
  kind: 'group',
  direction: 'out',
  from: { kind: 'role', id: 'dispatcher', name: '经理龟' },
  to: { kind: 'group', id: 'group', name: '群聊' },
  text: '@导师龟 讲一下',
  ts: 1,
}

describe('群聊抄送字段迁移', () => {
  it('旧 mentions 载入时迁移成 cc，之后只写 cc', () => {
    const legacy = { ...base, mentions: [{ kind: 'role', id: 'tutor', name: '导师龟' }] } as unknown
    const [migrated] = normalizeChannels([legacy]) ?? []
    expect(migrated.cc).toEqual([{ kind: 'role', id: 'tutor', name: '导师龟' }])
    expect((migrated as unknown as { mentions?: unknown }).mentions).toBeUndefined()
  })

  it('新 cc 原样保留；两者同时存在时以 cc 为准', () => {
    const both = {
      ...base,
      cc: [{ kind: 'role', id: 'designer', name: '设计龟' }],
      mentions: [{ kind: 'role', id: 'tutor', name: '导师龟' }],
    } as unknown
    const [migrated] = normalizeChannels([both]) ?? []
    expect(migrated.cc).toEqual([{ kind: 'role', id: 'designer', name: '设计龟' }])
  })

  it('cc 为空数组时仍迁移旧 mentions，不丢老数据', () => {
    const both = {
      ...base,
      cc: [],
      mentions: [{ kind: 'role', id: 'tutor', name: '导师龟' }],
    } as unknown
    const [migrated] = normalizeChannels([both]) ?? []
    expect(migrated.cc).toEqual([{ kind: 'role', id: 'tutor', name: '导师龟' }])
  })
})
