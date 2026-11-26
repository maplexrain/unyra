/**
 * api.agent.list：role 共用的只读名录，回 id / 名称 / 简介；内置默认简介齐全。
 */
import { describe, expect, it } from 'vitest'
import { buildApi } from '../src/agent/sandbox/api'
import { AGENT_ROLE_IDS, DEFAULT_AGENT_BIO } from '../src/agent/agentProfile'
import { listRegisteredAgents } from '../src/agent/agentListing'
import { DEFAULT_AGENT_SETTINGS } from '../src/agent/settings'

function bareOptions() {
  return {
    nodeId: () => null,
    resolveNode: () => ({ ok: false, message: '无节点' }),
    resolveDoc: () => ({ ok: false, message: '无文档' }),
    docOps: {
      read: () => '',
      write: () => ({ ok: true, content: '' }),
    },
    agent: { list: () => listRegisteredAgents(DEFAULT_AGENT_SETTINGS) },
  }
}

describe('api.agent.list', () => {
  it('返回内置六位 + 自由对话的 id / 名称 / 简介', () => {
    const { api } = buildApi(bareOptions() as never)
    const group = api.agent as { list: () => { agents: Array<{ id: string; name: string; bio: string }>; count: number } }
    const result = group.list()
    expect(result.count).toBe(AGENT_ROLE_IDS.length + 1)
    expect(result.agents.map((a) => a.id)).toEqual([...AGENT_ROLE_IDS, 'free'])
    for (const agent of result.agents) {
      expect(agent.name.length).toBeGreaterThan(0)
      expect(agent.bio.length).toBeGreaterThan(0)
    }
    expect(result.agents.find((a) => a.id === 'tutor')?.bio).toBe(DEFAULT_AGENT_BIO.tutor)
  })

  it('内置简介不是同一句套话，各自能看出分工', () => {
    expect(new Set(Object.values(DEFAULT_AGENT_BIO)).size).toBeGreaterThan(4)
    expect(DEFAULT_AGENT_BIO.researcher).toContain('调研')
    expect(DEFAULT_AGENT_BIO.examiner).toContain('出卷')
  })
})
