/**
 * 智能体页的「对话 / 思维」视图状态（全局共用）。
 *
 * 以前它放在每个 AgentPanel 的局部 state 里：切到另一个 agent 就会换回默认的对话层，
 * 用户得每只 agent 各切一次。这里做成模块级单例，所有面板订阅同一份值；
 * 同一次会话里切 agent 保持当前层，刷新后也记得上次停在哪一层。
 */
import { useSyncExternalStore } from 'react'

export type AgentViewMode = 'chat' | 'mind'

const STORAGE_KEY = 'moji:agent:viewMode'

function read(): AgentViewMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'mind' ? 'mind' : 'chat'
  } catch {
    return 'chat'
  }
}

let current: AgentViewMode = read()
const listeners = new Set<() => void>()

export function getAgentViewMode(): AgentViewMode {
  return current
}

export function subscribeAgentViewMode(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setAgentViewMode(mode: AgentViewMode): void {
  if (current === mode) return
  current = mode
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // 隐身模式 / 存储禁用：内存态仍然生效
  }
  for (const listener of listeners) listener()
}

/** AgentPanel 订阅全局视图状态；切换任意 agent 共享同一层 */
export function useAgentViewMode(): AgentViewMode {
  return useSyncExternalStore(subscribeAgentViewMode, getAgentViewMode, getAgentViewMode)
}
