import { describe, expect, it } from 'vitest'
import type { ChannelMessage } from '../src/agent/types'
import {
  GROUP_TRIAGE_RETRY_LIMIT,
  buildGroupTriagePrompt,
  parseGroupTriageOutput,
  setGroupTriageRunner,
  triageGroupMessage,
  triageGroupMessageWithRetry,
} from '../src/learn/roleWork/groupTriage'

const agents = [
  { id: 'tutor' as const, name: '导师龟', duty: '主讲与协调' },
  { id: 'dispatcher' as const, name: '经理龟', duty: '接需求、派活、盯进度' },
  { id: 'examiner' as const, name: '做题龟', duty: '试卷命题与判分讲解' },
  { id: 'designer' as const, name: '设计龟', duty: '互动课堂与超级实验室' },
  { id: 'researcher' as const, name: '调研龟', duty: '联网调研与浏览器实操' },
  { id: 'fixer' as const, name: '修复龟', duty: '函数图像修复' },
]

const message = (i: number, text = `消息 ${i}`): ChannelMessage => ({
  id: `m${i}`,
  kind: 'group',
  direction: 'in',
  from: { kind: 'user', id: 'u1', name: '用户' },
  to: { kind: 'group', id: 'group', name: '群聊' },
  text,
  ts: 1000 + i,
  goalId: 'g1',
})

describe('群消息调度 agent', () => {
  it('系统提示词先写职责，再列当前群成员名称/id/职责，最后拼最近最多 10 条群聊', () => {
    const recent = Array.from({ length: 14 }, (_, i) => message(i))
    const prompt = buildGroupTriagePrompt({ text: '帮我看看这道题', agents, recent })
    expect(prompt.system).toContain('你是群消息调度 agent')
    expect(prompt.system).toContain('导师龟（id: tutor）：主讲与协调')
    expect(prompt.system).toContain('经理龟（id: dispatcher）')
    expect(prompt.system).toContain('修复龟（id: fixer）')
    // 只保留最近 10 条：前 4 条必须被截掉，最后一条必须在
    expect(prompt.system).not.toContain('消息 3')
    expect(prompt.system).toContain('消息 13')
    expect(prompt.system).toContain('"agentId"')
    expect(prompt.user).toBe('帮我看看这道题')
  })

  it('严格解析结构化输出：只接受成员 id，兼容 JSON 围栏并夹紧 confidence', () => {
    expect(parseGroupTriageOutput('{"agentId":"tutor","reason":"教学问题","confidence":0.8}', ['tutor', 'dispatcher'])).toEqual({
      agentId: 'tutor',
      reason: '教学问题',
      confidence: 0.8,
    })
    expect(
      parseGroupTriageOutput('```json\n{"agentId":"examiner","reason":"出卷","confidence":2}\n```', [
        'tutor',
        'examiner',
      ]),
    ).toMatchObject({ agentId: 'examiner', confidence: 1 })
    expect(parseGroupTriageOutput('{"agentId":"free","reason":"x"}', ['tutor'])).toBeNull()
    expect(parseGroupTriageOutput('不是 JSON', ['tutor'])).toBeNull()
  })

  it('测试替换分类器后，triageGroupMessage 原样返回结构化数据', async () => {
    setGroupTriageRunner(async () => ({ agentId: 'researcher', reason: '需要联网查资料', confidence: 0.9 }))
    const result = await triageGroupMessage({ text: '帮我查一下', agents, recent: [] })
    expect(result).toEqual({ agentId: 'researcher', reason: '需要联网查资料', confidence: 0.9 })
    setGroupTriageRunner(null)
  })

  it('分类失败自动重试，第三次尝试成功即返回', async () => {
    let calls = 0
    setGroupTriageRunner(async () => {
      calls += 1
      if (calls < 3) throw new Error('第一次/第二次失败')
      return { agentId: 'tutor', reason: '教学问题' }
    })
    const result = await triageGroupMessageWithRetry({ text: '帮我看这道题', agents, recent: [] })
    expect(result.agentId).toBe('tutor')
    expect(calls).toBe(3)
    setGroupTriageRunner(null)
  })

  it('首次调用之外重试三次仍失败才抛错，供宿主弹手动选择', async () => {
    let calls = 0
    setGroupTriageRunner(async () => {
      calls += 1
      throw new Error('模型输出不是 JSON')
    })
    await expect(triageGroupMessageWithRetry({ text: '帮我安排一下', agents, recent: [] })).rejects.toThrow(
      '模型输出不是 JSON',
    )
    expect(calls).toBe(1 + GROUP_TRIAGE_RETRY_LIMIT)
    setGroupTriageRunner(null)
  })
})
