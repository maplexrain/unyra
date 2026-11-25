/**
 * 智能体置顶管理与按最近回复时间排序逻辑（agentPinning）
 *
 * 核心规则：
 * 1. 经理龟（dispatcher）为团队任务入口，【默认置顶且不可撤销】。
 * 2. 用户可自由置顶 / 取消置顶其他声部（导师、出卷、设计、调研、维修）。
 * 3. 排序策略：
 *    - 置顶项始终在非置顶项之前；
 *    - 置顶区内部与非置顶区内部，均按【最近回复/更新时间戳降序】排列（最近活跃在前）；
 *    - 时间戳相同（或均为 0）时，按系统默认顺序稳定兜底。
 */

import { AGENT_ROSTER_ORDER } from './agentRoster'
import type { AgentTeamMode } from './conversationList'

const PINNED_STORAGE_KEY = 'moji:agent-team:pinned'

/** 默认置顶且不可撤销的声部 */
export const LOCKED_PINNED_AGENTS: readonly AgentTeamMode[] = ['dispatcher']

/** 检查某个声部是否为不可撤销置顶 */
export function isPinLocked(agentId: AgentTeamMode): boolean {
  return LOCKED_PINNED_AGENTS.includes(agentId)
}

/** 从持久化存储读取当前置顶声部集合（锁定项恒在场） */
export function loadPinnedAgents(): Set<AgentTeamMode> {
  const set = new Set<AgentTeamMode>(LOCKED_PINNED_AGENTS)
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY)
    if (raw) {
      const arr = JSON.parse(raw) as string[]
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (AGENT_ROSTER_ORDER.includes(item as AgentTeamMode)) {
            set.add(item as AgentTeamMode)
          }
        }
      }
    }
  } catch {
    // 忽略异常并使用默认集合
  }
  return set
}

/** 保存置顶声部集合到持久化存储 */
export function savePinnedAgents(pinned: Set<AgentTeamMode>): void {
  try {
    const arr = Array.from(pinned)
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(arr))
  } catch {
    // 忽略异常
  }
}

/** 切换某个声部的置顶状态（如果为锁定声部则不作任何改变） */
export function toggleAgentPin(
  current: Set<AgentTeamMode>,
  agentId: AgentTeamMode,
): Set<AgentTeamMode> {
  if (isPinLocked(agentId)) return current

  const next = new Set<AgentTeamMode>(current)
  if (next.has(agentId)) {
    next.delete(agentId)
  } else {
    next.add(agentId)
  }
  savePinnedAgents(next)
  return next
}

/**
 * 对声部名册按【置顶优先 + 最近回复时间降序】进行排序
 *
 * @param agentIds 待排序声部列表
 * @param pinnedSet 当前置顶声部集合
 * @param getTimeOf 获取该声部最近回复时间戳的回调函数
 */
export function sortAgentsByPinAndTime<T extends { id: AgentTeamMode }>(
  items: T[],
  pinnedSet: Set<AgentTeamMode>,
  getTimeOf: (id: AgentTeamMode) => number,
): T[] {
  return [...items].sort((a, b) => {
    const pinA = pinnedSet.has(a.id)
    const pinB = pinnedSet.has(b.id)

    // 1. 置顶项排在非置顶项前
    if (pinA && !pinB) return -1
    if (!pinA && pinB) return 1

    // 2. 同在置顶区或同在非置顶区：按最近回复时间降序排列
    const timeA = getTimeOf(a.id) || 0
    const timeB = getTimeOf(b.id) || 0
    if (timeB !== timeA) {
      return timeB - timeA
    }

    // 3. 时间相同时，按系统默认顺序稳定排列
    const idxA = AGENT_ROSTER_ORDER.indexOf(a.id)
    const idxB = AGENT_ROSTER_ORDER.indexOf(b.id)
    return idxA - idxB
  })
}
