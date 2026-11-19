// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest'
import { tabKey, tabTitle, tabNodeId } from '../src/learn/tabs'
import { normalizeTab } from '../src/learn/store/normalize/tabs'
import {
  DEFAULT_TEAM_AGENTS,
  PRESET_SIMULATION_MESSAGES,
  loadTeamAgents,
  saveTeamAgents,
  loadTeamMessages,
  saveTeamMessages,
} from '../src/components/learn/agent-team/agentTeamData'
import type { TeamAgent, TeamMessage } from '../src/components/learn/agent-team/types'

describe('智能体团队 Tab 系统集成', () => {
  it('tabKey 生成正确的 agentTeam 标识', () => {
    expect(tabKey({ kind: 'agentTeam' })).toBe('team:all')
    expect(tabKey({ kind: 'agentTeam', goalId: 'goal-123' })).toBe('team:goal-123')
  })

  it('tabNodeId 对系统功能页签 agentTeam 返回 null', () => {
    expect(tabNodeId({ kind: 'agentTeam' })).toBeNull()
    expect(tabNodeId({ kind: 'agentTeam', goalId: 'goal-1' })).toBeNull()
  })

  it('tabTitle 返回智能体团队本地化文本', () => {
    expect(tabTitle({ kind: 'agentTeam' }, () => undefined)).toBe('智能体团队')
  })

  it('normalizeTab 支持 agentTeam 并保全 goalId', () => {
    const raw = {
      id: 'tab-team-1',
      ref: { kind: 'agentTeam', goalId: 'g-99' },
      createdAt: 1000,
      activeAt: 2000,
    }
    const normalized = normalizeTab(raw, new Map())
    expect(normalized).not.toBeNull()
    expect(normalized?.ref).toEqual({
      kind: 'agentTeam',
      goalId: 'g-99',
    })
  })
})

describe('智能体团队 数据与演练模型', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('默认预置超级导师', () => {
    expect(DEFAULT_TEAM_AGENTS.length).toBeGreaterThanOrEqual(1)
    const tutor = DEFAULT_TEAM_AGENTS.find((a) => a.id === 'agent-tutor')
    expect(tutor).toBeDefined()
    expect(tutor?.name).toContain('超级导师')
    expect(tutor?.role).toBe('超级导师')
  })

  it('loadTeamAgents 在无缓存时返回默认智能体列表，并可按 goalId 独立保存与读取', () => {
    const defaultAgents = loadTeamAgents('goal-alpha')
    expect(defaultAgents).toHaveLength(DEFAULT_TEAM_AGENTS.length)

    const customAgent: TeamAgent = {
      id: 'custom-math-solver',
      name: '微积分专家',
      role: '数理推导专员',
      roleType: 'custom',
      avatar: '📐',
      avatarBg: 'bg-sky-500',
      color: 'sky',
      systemPrompt: '专注于极限与导数严谨证明',
      capabilities: ['LaTeX推导', '符号计算'],
      description: '专注于极限与导数严谨证明的专家',
      model: 'gemini-1.5-pro',
      status: 'idle',
      isCustom: true,
    }

    saveTeamAgents([...defaultAgents, customAgent], 'goal-alpha')
    const loadedAlpha = loadTeamAgents('goal-alpha')
    expect(loadedAlpha).toHaveLength(defaultAgents.length + 1)
    expect(loadedAlpha.some((a) => a.id === 'custom-math-solver')).toBe(true)

    // 另一个 goalId 不受污染
    const loadedBeta = loadTeamAgents('goal-beta')
    expect(loadedBeta).toHaveLength(DEFAULT_TEAM_AGENTS.length)
  })

  it('loadTeamMessages 与 saveTeamMessages 支持独立消息持久化，初始协作频道为空', () => {
    // 首次无本地缓存时，协作频道为空
    const initial = loadTeamMessages('goal-1')
    expect(initial).toEqual([])

    const msg: TeamMessage = {
      id: 'm1',
      senderId: 'agent-tutor',
      senderName: '超级导师',
      senderRole: '超级导师',
      avatar: '🧠',
      content: '收到任务，开始协同分工。',
      timestamp: Date.now(),
      isGroupChat: true,
      thought: '分析意图，制定执行流水线',
    }

    saveTeamMessages([msg], 'goal-1')
    const loaded = loadTeamMessages('goal-1')
    expect(loaded).toHaveLength(1)
    expect(loaded[0].content).toBe('收到任务，开始协同分工。')
    expect(loaded[0].thought).toBe('分析意图，制定执行流水线')
  })

  it('PRESET_SIMULATION_MESSAGES 包含协同演练剧本', () => {
    expect(PRESET_SIMULATION_MESSAGES.length).toBeGreaterThanOrEqual(2)
    const senders = new Set(PRESET_SIMULATION_MESSAGES.map((m) => m.senderId))
    expect(senders.has('agent-tutor')).toBe(true)
  })
})
