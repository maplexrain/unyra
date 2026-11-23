/**
 * role 的 work 管理面：直接委托给 agent/work 的 manager。
 * 单独成文件是为了让 agentOps 的接线与实现分层一致（learn/ops/* 只做装配）。
 */
import type { WorkSandboxApi } from '../../agent/roleWork/types'
import type { WorkManager } from '../../agent/work/manager'

export function createWorkOps(manager: WorkManager): WorkSandboxApi {
  return manager.api
}
