/**
 * agent 组：role 共用的只读智能体名录。
 * 只回 id / 名称 / 简介，不提供任何写操作；未注入就没有这一组。
 */
import { wrapApi } from '../wrap'
import type { SandboxCall, SandboxOptions } from '../types'

export function installAgent(
  api: Record<string, unknown>,
  opts: SandboxOptions,
  log: SandboxCall[],
): void {
  if (!opts.agent) return
  wrapApi(
    api,
    'agent.list',
    () => {
      const agents = opts.agent!.list()
      return { agents, count: agents.length }
    },
    log,
  )
}
