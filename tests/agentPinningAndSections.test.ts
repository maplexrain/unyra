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
  ALL_AGENTS_COMMON_PREFIX,
  COMMON_ALL_AGENTS_PREFIX_PROMPT,
  COMMON_TURTLE_CLAN_PROMPT,
  COMMON_EXECUTION_PREFIX_PROMPT,
  getAgentPromptSections,
  buildFreeChatSystem,
  buildTeacherSystem,
  buildDispatcherSystem,
  buildExaminerSystem,
  buildDesignerSystem,
  buildResearcherSystem,
  buildFixerSystem,
} from '../src/learn/ai'
import { SHARED_AGENT_PREFIX } from '../src/learn/ai/agentSharedPrefix'
import { TURTLE_CLAN_GUIDE } from '../src/learn/ai/turtleClan'
import type { AgentTeamMode } from '../src/components/learn/agent-team/conversationList'

describe('agentPinning 置顶与排序机制', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('调度龟默认置顶且不可撤销；聊天龟已从名册移除', () => {
    expect(isPinLocked('free')).toBe(false)
    expect(isPinLocked('dispatcher')).toBe(true)
    expect(isPinLocked('tutor')).toBe(false)
    expect(isPinLocked('examiner')).toBe(false)

    // 初始加载只包含默认锁定的调度龟
    const initial = loadPinnedAgents()
    expect(initial.has('free')).toBe(false)
    expect(initial.has('dispatcher')).toBe(true)

    // 尝试取消置顶 dispatcher，集合保持不变
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
    expect(reloaded.has('free')).toBe(false)
    expect(reloaded.has('dispatcher')).toBe(true)

    // 取消置顶 tutor
    pinned = toggleAgentPin(pinned, 'tutor')
    expect(pinned.has('tutor')).toBe(false)

    const reloaded2 = loadPinnedAgents()
    expect(reloaded2.has('tutor')).toBe(false)
  })

  it('sortAgentsByPinAndTime 排序规则：置顶优先，且各区按最近时间降序排列', () => {
    const list: Array<{ id: AgentTeamMode }> = [
      { id: 'dispatcher' },
      { id: 'tutor' },
      { id: 'examiner' },
      { id: 'designer' },
      { id: 'researcher' },
      { id: 'fixer' },
    ]

    const pinnedSet = new Set<AgentTeamMode>(['dispatcher', 'examiner'])

    // 时间模拟：
    // 置顶区：dispatcher(500), examiner(300) -> 排序后应为 dispatcher, examiner
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
    expect(COMMON_ALL_AGENTS_PREFIX_PROMPT).toBe(ALL_AGENTS_COMMON_PREFIX)
    expect(COMMON_EXECUTION_PREFIX_PROMPT).toBe(SHARED_AGENT_PREFIX)
  })

  it('身份总纲不再教「称呼兄弟」，排行关系只留在各 role 的极简定位里', () => {
    expect(TURTLE_CLAN_GUIDE).not.toContain('称呼兄弟')
    expect(TURTLE_CLAN_GUIDE).not.toContain('自报家门')
    expect(TURTLE_CLAN_GUIDE).toContain('禁止在每条回复开头自报身份')
    expect(buildDispatcherSystem()).toContain('导师龟是二弟/老二')
    expect(buildTeacherSystem()).toContain('调度龟是大哥')
    expect(buildTeacherSystem()).toContain('出卷龟是三弟/老三')
    expect(buildTeacherSystem()).toContain('silent: true')
  })

  it('共同基座不含任何具体身份，可原样套给外部自定义 agent', () => {
    // 1/2 两段是全员共用；龟门身份只能出现在各 role 的「role 角色定位」段
    expect(ALL_AGENTS_COMMON_PREFIX).not.toContain('龟门')
    expect(ALL_AGENTS_COMMON_PREFIX).not.toContain('兄弟')
    expect(ALL_AGENTS_COMMON_PREFIX).not.toContain('本龟')
    expect(ALL_AGENTS_COMMON_PREFIX).not.toContain('导师')
    expect(ALL_AGENTS_COMMON_PREFIX).not.toContain('调研员')
    expect(SHARED_AGENT_PREFIX).not.toContain('龟门')
    expect(SHARED_AGENT_PREFIX).not.toContain('导师龟')
    // 身份段确实被移进了 role 3
    const roleSection = getAgentPromptSections('tutor').find((s) => s.id === 'tutor-role')
    expect(roleSection?.title).toBe('role 角色定位')
    expect(roleSection?.content).toContain('龟门六兄弟（身份总纲）')
    expect(getAgentPromptSections('tutor').find((s) => s.id === 'tutor-duty')?.title).toBe('你的专属分工')
  })

  it('六位团队角色与自由对话系统提示词首部持有共同前缀，最大化缓存命中率', () => {
    // 六位团队角色 + 自由对话均以 ALL_AGENTS_COMMON_PREFIX 开头
    expect(buildFreeChatSystem().startsWith(ALL_AGENTS_COMMON_PREFIX)).toBe(true)
    expect(buildTeacherSystem().startsWith(ALL_AGENTS_COMMON_PREFIX)).toBe(true)
    expect(buildDispatcherSystem().startsWith(ALL_AGENTS_COMMON_PREFIX)).toBe(true)
    expect(buildExaminerSystem().startsWith(ALL_AGENTS_COMMON_PREFIX)).toBe(true)
    expect(buildDesignerSystem().startsWith(ALL_AGENTS_COMMON_PREFIX)).toBe(true)
    expect(buildResearcherSystem().startsWith(ALL_AGENTS_COMMON_PREFIX)).toBe(true)
    expect(buildFixerSystem().startsWith(ALL_AGENTS_COMMON_PREFIX)).toBe(true)

    // 六位执行声部在此基础上进一步以 SHARED_AGENT_PREFIX 开头
    expect(SHARED_AGENT_PREFIX.startsWith(ALL_AGENTS_COMMON_PREFIX)).toBe(true)
    expect(buildTeacherSystem().startsWith(SHARED_AGENT_PREFIX)).toBe(true)
    expect(buildDispatcherSystem().startsWith(SHARED_AGENT_PREFIX)).toBe(true)
    expect(buildExaminerSystem().startsWith(SHARED_AGENT_PREFIX)).toBe(true)
    expect(buildDesignerSystem().startsWith(SHARED_AGENT_PREFIX)).toBe(true)
    expect(buildResearcherSystem().startsWith(SHARED_AGENT_PREFIX)).toBe(true)
    expect(buildFixerSystem().startsWith(SHARED_AGENT_PREFIX)).toBe(true)
  })

  it('getAgentPromptSections 为所有声部产出结构化的分段，且第一个分段为共同提示词/总纲', () => {
    // 导师龟
    const tutorSections = getAgentPromptSections('tutor')
    // role 层现在只有四段：共同前缀 / 固定 API / 人格 / 分工
    expect(tutorSections.length).toBeGreaterThanOrEqual(4)
    // 团队 role 的固定四段：共同基座 / 固定 API / 角色定位 / 专属分工
    expect(tutorSections.slice(0, 4).map((s) => s.title)).toEqual([
      '共同提示词 · 团队协作与沙箱执行基座',
      '固定组 API 能力面（全员共用）',
      'role 角色定位',
      '你的专属分工',
    ])
    expect(tutorSections[0]!.title).toContain('共同提示词')
    expect(tutorSections[0]!.content).toBe(SHARED_AGENT_PREFIX)
    expect(tutorSections[0]!.isCommon).toBe(true)

    // 出卷龟
    const examinerSections = getAgentPromptSections('examiner')
    expect(examinerSections[0]!.title).toContain('共同提示词')
    expect(examinerSections[0]!.content).toBe(SHARED_AGENT_PREFIX)
    expect(examinerSections[0]!.isCommon).toBe(true)

    // 自由对话：第一个分段为共同提示词基座
    const freeSections = getAgentPromptSections('free')
    expect(freeSections[0]!.title).toContain('共同提示词')
    expect(freeSections[0]!.content).toBe(ALL_AGENTS_COMMON_PREFIX)
    expect(freeSections[0]!.isCommon).toBe(true)

    // 每个分段都应有递增的索引和颜色标识
    for (const s of tutorSections) {
      expect(s.index).toBeGreaterThan(0)
      expect(s.color).toBeTruthy()
      expect(s.badge).toBeTruthy()
      expect(s.content.length).toBeGreaterThan(0)
    }
  })
})
