/**
 * SuperAgent 与多 Agent 团队业务域状态持久化层
 *
 * 规范：
 * 1. 读在启动，写在平时（500ms 防抖批量落盘）；
 * 2. 读入时无条件调用 hydrateSuperAgentState，归一化异常退出遗留的 running 状态；
 * 3. 团队状态与多 Agent 分文件落盘：
 *    - 团队总状态：agent-team/{scopeId}/team.json
 *    - 各专家状态：agent-team/{scopeId}/agent-{agentId}.json
 * 4. 保留原单 Agent 模式的向后兼容（agent-team/{scopeId}.json）。
 */

import { hydrateSuperAgentState } from '../../agent/super/engine'
import type { SuperAgentState } from '../../agent/super/types'
import type { TeamState } from '../../agent/team/types'
import { readJson, userPath, writeJson } from '../../lib/storage'

const LOCAL_STORAGE_PREFIX = 'moji:super-agent:'
const TEAM_STORAGE_PREFIX = 'moji:team-state:'

const pendingSaves = new Map<string, SuperAgentState>()
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const memoryFallback = new Map<string, SuperAgentState>()

const pendingTeamSaves = new Map<string, TeamState>()
const teamSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const teamMemoryFallback = new Map<string, TeamState>()

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/** 单 Agent 历史兼容路径 */
function storagePath(scopeId: string): string | null {
  return userPath(`agent-team/${sanitize(scopeId)}.json`)
}

/** 团队状态路径 */
function teamStoragePath(scopeId: string): string | null {
  return userPath(`agent-team/${sanitize(scopeId)}/team.json`)
}

/** 团队中特定 Agent 状态路径 */
function agentStoragePath(scopeId: string, agentId: string): string | null {
  return userPath(`agent-team/${sanitize(scopeId)}/agent-${sanitize(agentId)}.json`)
}

/* =========================================================================
 * 1. 单 Agent 兼容接口（保留历史单测零破坏）
 * ========================================================================= */

/**
 * 载入指定域的 SuperAgent 状态
 */
export async function loadSuperAgentState(scopeId: string): Promise<SuperAgentState> {
  const rel = storagePath(scopeId)
  if (rel) {
    try {
      const data = await readJson<unknown>(rel)
      if (data) {
        return hydrateSuperAgentState(data)
      }
    } catch (e) {
      console.warn(`[super-agent:persist] 读取文件存储失败 (${scopeId}):`, e)
    }
  }

  // 回退至 localStorage
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_PREFIX + scopeId)
      if (raw) {
        return hydrateSuperAgentState(JSON.parse(raw))
      }
    } catch (e) {
      console.warn(`[super-agent:persist] 读取本地缓存失败 (${scopeId}):`, e)
    }
  }

  // 回退至内存缓存（Node/测试环境）
  const inMemory = memoryFallback.get(scopeId)
  if (inMemory) {
    return hydrateSuperAgentState(inMemory)
  }

  return hydrateSuperAgentState(null)
}

/**
 * 调度异步防抖保存（500ms）
 */
export function saveSuperAgentState(scopeId: string, state: SuperAgentState): void {
  const cleanState = hydrateSuperAgentState(state)
  pendingSaves.set(scopeId, cleanState)

  const existingTimer = saveTimers.get(scopeId)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }

  const timer = setTimeout(() => {
    saveTimers.delete(scopeId)
    void flushSuperAgentState(scopeId)
  }, 500)

  saveTimers.set(scopeId, timer)
}

/**
 * 立即刷盘落地
 */
export async function flushSuperAgentState(scopeId: string): Promise<void> {
  const timer = saveTimers.get(scopeId)
  if (timer) {
    clearTimeout(timer)
    saveTimers.delete(scopeId)
  }

  const state = pendingSaves.get(scopeId)
  if (!state) return

  const rel = storagePath(scopeId)
  if (rel) {
    try {
      await writeJson(rel, state)
    } catch (e) {
      console.warn(`[super-agent:persist] 落盘文件写入失败 (${scopeId}):`, e)
    }
  }

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(LOCAL_STORAGE_PREFIX + scopeId, JSON.stringify(state))
    } catch (e) {
      console.warn(`[super-agent:persist] 写入本地缓存失败 (${scopeId}):`, e)
    }
  }

  memoryFallback.set(scopeId, state)
  pendingSaves.delete(scopeId)
}

/* =========================================================================
 * 2. 多 Agent 团队状态持久化接口
 * ========================================================================= */

/**
 * 载入团队全局状态
 */
export async function loadTeamState(scopeId: string): Promise<TeamState | null> {
  const rel = teamStoragePath(scopeId)
  if (rel) {
    try {
      const data = await readJson<TeamState>(rel)
      if (data) return data
    } catch (e) {
      console.warn(`[team:persist] 读取团队状态文件失败 (${scopeId}):`, e)
    }
  }

  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(TEAM_STORAGE_PREFIX + scopeId)
      if (raw) return JSON.parse(raw) as TeamState
    } catch (e) {
      console.warn(`[team:persist] 读取团队本地缓存失败 (${scopeId}):`, e)
    }
  }

  return teamMemoryFallback.get(scopeId) ?? null
}

/**
 * 防抖保存团队全局状态
 */
export function saveTeamState(scopeId: string, state: TeamState): void {
  pendingTeamSaves.set(scopeId, state)

  const existingTimer = teamSaveTimers.get(scopeId)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }

  const timer = setTimeout(() => {
    teamSaveTimers.delete(scopeId)
    void flushTeamState(scopeId)
  }, 500)

  teamSaveTimers.set(scopeId, timer)
}

/**
 * 立即刷盘团队全局状态
 */
export async function flushTeamState(scopeId: string): Promise<void> {
  const timer = teamSaveTimers.get(scopeId)
  if (timer) {
    clearTimeout(timer)
    teamSaveTimers.delete(scopeId)
  }

  const state = pendingTeamSaves.get(scopeId)
  if (!state) return

  const rel = teamStoragePath(scopeId)
  if (rel) {
    try {
      await writeJson(rel, state)
    } catch (e) {
      console.warn(`[team:persist] 写入团队状态文件失败 (${scopeId}):`, e)
    }
  }

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(TEAM_STORAGE_PREFIX + scopeId, JSON.stringify(state))
    } catch (e) {
      console.warn(`[team:persist] 写入团队本地缓存失败 (${scopeId}):`, e)
    }
  }

  teamMemoryFallback.set(scopeId, state)
  pendingTeamSaves.delete(scopeId)
}

/**
 * 载入多 Agent 架构下某个特定专家的状态
 */
export async function loadTeamAgentState(
  scopeId: string,
  agentId: string,
): Promise<SuperAgentState> {
  const rel = agentStoragePath(scopeId, agentId)
  if (rel) {
    try {
      const data = await readJson<unknown>(rel)
      if (data) return hydrateSuperAgentState(data)
    } catch (e) {
      console.warn(`[team:persist] 读取专家文件失败 (${scopeId}/${agentId}):`, e)
    }
  }

  const key = `${LOCAL_STORAGE_PREFIX}${scopeId}:${agentId}`
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(key)
      if (raw) return hydrateSuperAgentState(JSON.parse(raw))
    } catch (e) {
      console.warn(`[team:persist] 读取专家缓存失败 (${scopeId}/${agentId}):`, e)
    }
  }

  const inMem = memoryFallback.get(`${scopeId}:${agentId}`)
  if (inMem) return hydrateSuperAgentState(inMem)

  return hydrateSuperAgentState(null)
}

/**
 * 防抖保存多 Agent 架构下某个专家的状态
 */
export function saveTeamAgentState(
  scopeId: string,
  agentId: string,
  state: SuperAgentState,
): void {
  const saveKey = `${scopeId}:${agentId}`
  const cleanState = hydrateSuperAgentState(state)
  pendingSaves.set(saveKey, cleanState)

  const existingTimer = saveTimers.get(saveKey)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }

  const timer = setTimeout(() => {
    saveTimers.delete(saveKey)
    void flushTeamAgentState(scopeId, agentId)
  }, 500)

  saveTimers.set(saveKey, timer)
}

/**
 * 立即刷盘特定专家的状态
 */
export async function flushTeamAgentState(scopeId: string, agentId: string): Promise<void> {
  const saveKey = `${scopeId}:${agentId}`
  const timer = saveTimers.get(saveKey)
  if (timer) {
    clearTimeout(timer)
    saveTimers.delete(saveKey)
  }

  const state = pendingSaves.get(saveKey)
  if (!state) return

  const rel = agentStoragePath(scopeId, agentId)
  if (rel) {
    try {
      await writeJson(rel, state)
    } catch (e) {
      console.warn(`[team:persist] 写入专家文件失败 (${scopeId}/${agentId}):`, e)
    }
  }

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${scopeId}:${agentId}`, JSON.stringify(state))
    } catch (e) {
      console.warn(`[team:persist] 写入专家缓存失败 (${scopeId}/${agentId}):`, e)
    }
  }

  memoryFallback.set(saveKey, state)
  pendingSaves.delete(saveKey)
}
