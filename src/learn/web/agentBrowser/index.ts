/**
 * Agent Browser 公开入口：类型、单例 runtime 与 React 订阅 hook。
 */
import { useSyncExternalStore } from 'react'
import { agentBrowserRuntime } from './runtime'
import type { AgentBrowserSnapshot } from './types'

export { AgentBrowserRuntime, agentBrowserRuntime } from './runtime'
export type { AgentBrowserWebview } from './runtime'
export type * from './types'

export function useAgentBrowserSnapshot(
  runtime: typeof agentBrowserRuntime = agentBrowserRuntime,
): AgentBrowserSnapshot {
  return useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
}
