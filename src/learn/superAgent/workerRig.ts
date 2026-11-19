/**
 * Isolated Worker 工具装配层
 *
 * 规范：
 * 1. 复用现有成熟的 createExecuteTools 沙箱执行基座与 apiRegistry 注册表；
 * 2. 严格杜绝套娃：绝不挂载 subagent API 组，硬性禁止 Worker 递归派生子代理；
 * 3. apiAllow 设置为安全白名单 SUBAGENT_ALLOWED_GROUPS（doc, node, workspace, web, tmp 等）；
 * 4. 支持无目标或 Store 脱机环境下的优雅降级。
 */

import { createExecuteTools } from '../../agent/sandbox/execute'
import { SUBAGENT_ALLOWED_GROUPS, apiBriefForGroups } from '../../agent/subagent/groups'
import type { AgentTool } from '../../agent/types'
import { learnSandboxOps } from '../agent/sandboxOps'
import type { LearnStore } from '../types'

export interface SuperWorkerToolsDeps {
  getLatest?: () => LearnStore
  set?: (store: LearnStore) => void
  goalId?: string | null
  nodeId?: string | null
}

/**
 * 为 Isolated Worker 装配真实的生产工具集（execute + rexecute）
 */
export function createSuperWorkerTools(deps: SuperWorkerToolsDeps): AgentTool[] {
  const { getLatest, set, goalId, nodeId } = deps

  // 1. 如果有真实的 Store 依赖，装配全套受控工作区沙箱能力
  if (getLatest && set) {
    const sandboxBase = learnSandboxOps({
      getLatest,
      set,
      goalId: () => goalId ?? null,
      nodeId: () => nodeId ?? null,
    })

    // 铁律：不透传 subagent 组，避免递归调用
    delete (sandboxBase as Record<string, unknown>).subagent

    // 限制白名单并定制 API 简介
    sandboxBase.apiAllow = [...SUBAGENT_ALLOWED_GROUPS]
    sandboxBase.apiBrief = apiBriefForGroups(sandboxBase.apiAllow)

    return createExecuteTools(sandboxBase)
  }

  // 2. 脱机或无 Store 依赖时的极简安全降级工具
  return createExecuteTools({
    resolveNode: () => ({ ok: false, message: '脱机模式不支持节点读写' }),
    resolveDoc: () => ({ ok: false, message: '脱机模式不支持文档读写' }),
    nodeId: () => null,
    docOps: {} as never,
    nodeOps: {} as never,
  })
}
