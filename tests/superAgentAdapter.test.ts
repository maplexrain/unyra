import { describe, expect, it, beforeEach } from 'vitest'
import { buildSuperHostSystemPrompt, buildSuperWorkerSystemPrompt } from '../src/learn/superAgent/prompts'
import { loadSuperAgentState, saveSuperAgentState, flushSuperAgentState } from '../src/learn/superAgent/persist'
import { createSuperWorkerTools } from '../src/learn/superAgent/workerRig'
import type { SuperAgentState } from '../src/agent/super/types'

describe('SuperAgent 业务域适配层 (Phase 2)', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear()
    }
  })

  it('1. 提示词工程：Host 与 Worker 固化系统提示词满足三平面契约', () => {
    const hostPrompt = buildSuperHostSystemPrompt({ goalTitle: '微积分导数' })
    expect(hostPrompt).toContain('Frontline Host')
    expect(hostPrompt).toContain('微积分导数')
    expect(hostPrompt).toContain('spawn_worker')
    expect(hostPrompt).toContain('steer_worker')
    expect(hostPrompt).toContain('cancel_worker')
    expect(hostPrompt).toContain('query_blackboard')
    expect(hostPrompt).toContain('严格禁止伪造耗时产出')

    const workerPrompt = buildSuperWorkerSystemPrompt({ goalTitle: '微积分导数' })
    expect(workerPrompt).toContain('专职后台工坊 Worker')
    expect(workerPrompt).toContain('终跳零拷贝直接交付')
    expect(workerPrompt).toContain('execute')
    expect(workerPrompt).toContain('禁止递归创建子代理')
  })

  it('2. 持久化层：支持防抖保存、立即刷盘与崩溃状态恢复', async () => {
    const testState: SuperAgentState = {
      id: 'test-goal-1',
      hostSystemPrompt: 'Host System',
      hostMessages: [],
      workers: {
        'w-1': {
          id: 'w-1',
          title: '已完成任务',
          goal: '分析数据',
          status: 'done',
          messages: [],
          chatText: '分析结论',
          artifacts: [],
          createdAt: 1000,
          updatedAt: 2000,
        },
        'w-2': {
          id: 'w-2',
          title: '崩溃前运行中任务',
          goal: '抓取资料',
          status: 'running', // 模拟异常关机残留的 running 状态
          messages: [],
          chatText: '',
          artifacts: [],
          createdAt: 1500,
          updatedAt: 2500,
        },
      },
      mailbox: [],
      blackboard: [],
    }

    saveSuperAgentState('test-goal-1', testState)
    await flushSuperAgentState('test-goal-1')

    // 读盘恢复
    const loaded = await loadSuperAgentState('test-goal-1')
    expect(loaded.id).toBe('test-goal-1')
    expect(loaded.workers['w-1'].status).toBe('done')
    // 关键断言：残留的 running 状态在读盘反序列化时被安全归一化为 failed
    expect(loaded.workers['w-2'].status).toBe('failed')
    expect(loaded.workers['w-2'].error).toContain('应用重启')
  })

  it('3. 工具装配层：Worker 工具集包含 execute/rexecute 且硬性杜绝 subagent 递归', () => {
    const tools = createSuperWorkerTools({})
    expect(tools).toHaveLength(2)

    const toolNames = tools.map((t) => t.name)
    expect(toolNames).toContain('execute')
    expect(toolNames).toContain('rexecute')

    // 验证 Worker 的工具中绝不会包含 subagent 递归组
    const executeTool = tools.find((t) => t.name === 'execute')!
    expect(executeTool.description).not.toContain('subagent.create')
    expect(executeTool.description).not.toContain('subagent.run')
  })
})
