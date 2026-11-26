/**
 * 内置提示词只读页的「返回智能体页面并关闭当前页面」：
 * 有已开着的智能体页就激活它；没有就补开一枚；最后关掉提示词页签。
 */
import { describe, expect, it, vi } from 'vitest'
import { returnToAgentPage } from '../src/components/learn/workspace/agentSlotTabs'
import type { LearnTab } from '../src/learn/types'

function agentTab(id: string, goalId?: string): LearnTab {
  return {
    id,
    ref: { kind: 'agentTeam', ...(goalId ? { goalId } : {}) },
  } as unknown as LearnTab
}

function deps(agentTabs: LearnTab[], activeGoalId: string | null = null) {
  return {
    groupId: 'group-1',
    promptTabId: 'prompt-1',
    agentTabs,
    activeGoalId,
    activateTab: vi.fn(),
    openTab: vi.fn(),
    closeTab: vi.fn(),
  }
}

describe('returnToAgentPage', () => {
  it('优先激活同一目标的智能体页，再关掉提示词页', () => {
    const calls = deps([agentTab('agent-other', 'goal-2'), agentTab('agent-current', 'goal-1')], 'goal-1')
    returnToAgentPage(calls)

    expect(calls.activateTab).toHaveBeenCalledWith('agent-current')
    expect(calls.openTab).not.toHaveBeenCalled()
    expect(calls.closeTab).toHaveBeenCalledWith('group-1', 'prompt-1', 'self', { confirm: false })
  })

  it('没有智能体页时补开一枚，再关掉提示词页', () => {
    const calls = deps([])
    returnToAgentPage(calls)

    expect(calls.openTab).toHaveBeenCalledWith({ kind: 'agentTeam' })
    expect(calls.activateTab).not.toHaveBeenCalled()
    expect(calls.closeTab).toHaveBeenCalledWith('group-1', 'prompt-1', 'self', { confirm: false })
  })
})
