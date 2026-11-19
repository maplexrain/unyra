/**
 * SuperAgent 业务域状态持久化层
 *
 * 规范：
 * 1. 读在启动，写在平时（500ms 防抖批量落盘）；
 * 2. 读入时无条件调用 hydrateSuperAgentState，归一化异常退出遗留的 running 状态；
 * 3. 优先落盘至用户数据目录 agent-team/{scopeId}.json，环境不可用时优雅回退。
 */

import { hydrateSuperAgentState } from '../../agent/super/engine'
import type { SuperAgentState } from '../../agent/super/types'
import { readJson, scheduleCommit, userPath, writeJson } from '../../lib/storage'

const LOCAL_STORAGE_PREFIX = 'moji:super-agent:'
const pendingSaves = new Map<string, SuperAgentState>()
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** 内存态兜底缓存（服务于 Node 测试环境及脱机降级） */
const memoryFallback = new Map<string, SuperAgentState>()

/** 获取相对用户数据目录的存储路径 */
function storagePath(scopeId: string): string | null {
  const safeId = scopeId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return userPath(`agent-team/${safeId}.json`)
}

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
      scheduleCommit(rel)
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
