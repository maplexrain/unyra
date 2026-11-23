// @vitest-environment happy-dom
/**
 * 智能体置顶、按最近时间排序与系统提示词分段/共同提示词测试
 */

import { describe, expect, it, beforeEach } from 'vitest'
import {
  isPinLocked,
  loadPinnedAgents,
  toggleAgentPin,
  sortAgentsByPinAndTime,
} from '../src/components/learn/agent-team/agentPinning'
import {
  COMMON_TURTLE_CLAN_PROMPT,
  COMMON_EXECUTION_PREFIX_PROMPT,
  getAgentPromptSections,
} from '../src/learn/ai'
import { SHARED_AGENT_PREFIX } from '../src/learn/ai/agentSharedPrefix'
import { TURTLE_CLAN_GUIDE } from '../src/learn/ai/turtleClan'
import type { AgentTeamMode } from '../src/components/learn/agent-team/conversationList'

describe('agentPinning 置顶与排序机制', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('聊天龟与调度龟默认置顶且不可撤销', () => {
    expect(isPinLocked('free')).toBe(true)
    expect(isPinLocked('dispatcher')).toBe(true)
    expect(isPinLocked('tutor')).toBe(false)
    expect(isPinLocked('examiner')).toBe(false)

    // 初始加载包含默认锁定的两项
    const initial = loadPinnedAgents()
    expect(initial.has('free')).toBe(true)
    expect(initial.has('dispatcher')).toBe(true)

    // 尝试取消置顶 free 或 dispatcher，集合保持不变
    const afterFree = toggleAgentPin(initial, 'free')
    expect(afterFree.has('free')).toBe(true)
    const afterDispatcher = toggleAgentPin(initial, 'dispatcher')
    expect(afterDispatcher.has('dispatcher')).toBe(true)
  })

  it('其他声部可以自由置顶与取消置顶，并持久化', () => {
    let pinned = loadPinnedAgents()
    expect(pinned.has('tutor')).toBe(false)

    // 置顶 tutor
    pinned = toggleAgentPin(pinned, 'tutor')
    expect(pinned.has('tutor')).toBe(true)

    // 模拟重新读取
    const reloaded = loadPinnedAgents()
    expect(reloaded.has('tutor')).toBe(true)
    expect(reloaded.has('free')).toBe(true)
    expect(reloaded.has('dispatcher')).toBe(true)

    // 取消置顶 tutor
    pinned = toggleAgentPin(pinned, 'tutor')
    expect(pinned.has('tutor')).toBe(false)

    const reloaded2 = loadPinnedAgents()
    expect(reloaded2.has('tutor')).toBe(false)
  })

  it('sortAgentsByPinAndTime 排序规则：置顶优先，且各区按最近时间降序排列', () => {
    const list: Array<{ id: AgentTeamMode }> = [
      { id: 'free' },
      { id: 'dispatcher' },
      { id: 'tutor' },
      { id: 'examiner' },
      { id: 'designer' },
      { id: 'researcher' },
      { id: 'fixer' },
    ]

    const pinnedSet = new Set<AgentTeamMode>(['free', 'dispatcher', 'examiner'])

    // 时间模拟：
    // 置顶区：free(100), dispatcher(500), examiner(300) -> 排序后应为 dispatcher, examiner, free
    // 非置顶区：tutor(10), designer(50), researcher(0), fixer(30) -> 排序后应为 designer, fixer, tutor, researcher
    const times: Record<AgentTeamMode, number> = {
      dispatcher: 500,
      examiner: 300,
      free: 100,
      designer: 50,
      fixer: 30,
      tutor: 10,
      researcher: 0,
    }

    const sorted = sortAgentsByPinAndTime(list, pinnedSet, (id) => times[id])
    const order = sorted.map((s) => s.id)

    expect(order).toEqual([
      'dispatcher',
      'examiner',
      'free',
      'designer',
      'fixer',
      'tutor',
      'researcher',
    ])
  })
})

describe('提示词分段与共同提示词独立性', () => {
  it('共同提示词独立导出且与原始总纲/前缀完全一致', () => {
    expect(COMMON_TURTLE_CLAN_PROMPT).toBe(TURTLE_CLAN_GUIDE)
    expect(COMMON_EXECUTION_PREFIX_PROMPT).toBe(SHARED_AGENT_PREFIX)
  })

  it('getAgentPromptSections 为所有声部产出结构化的分段，且第一个分段为共同提示词/总纲', () => {
    // 导师龟
    const tutorSections = getAgentPromptSections('tutor')
    expect(tutorSections.length).toBeGreaterThanOrEqual(7)
    expect(tutorSections[0]!.title).toContain('共同提示词')
    expect(tutorSections[0]!.content).toBe(SHARED_AGENT_PREFIX)
    expect(tutorSections[0]!.isCommon).toBe(true)

    // 出卷龟
    const examinerSections = getAgentPromptSections('examiner')
    expect(examinerSections[0]!.title).toContain('共同提示词')
    expect(examinerSections[0]!.content).toBe(SHARED_AGENT_PREFIX)
    expect(examinerSections[0]!.isCommon).toBe(true)

    // 自由聊天龟
    const freeSections = getAgentPromptSections('free')
    expect(freeSections[1]!.title).toContain('龟门七兄弟身份总纲')
    expect(freeSections[1]!.content).toBe(TURTLE_CLAN_GUIDE)
    expect(freeSections[1]!.isCommon).toBe(true)

    // 每个分段都应有递增的索引和颜色标识
    for (const s of tutorSections) {
      expect(s.index).toBeGreaterThan(0)
      expect(s.color).toBeTruthy()
      expect(s.badge).toBeTruthy()
      expect(s.content.length).toBeGreaterThan(0)
    }
  })
})
