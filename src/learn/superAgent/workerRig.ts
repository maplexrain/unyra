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
import { normalizeDelivery, type DeliveryRecord } from '../../agent/delivery'
import { resolveNode } from '../paths'
import { learnSandboxOps } from '../agent/sandboxOps'
import type { LearnStore } from '../types'

export interface SuperWorkerToolsDeps {
  getLatest?: () => LearnStore
  set?: (store: LearnStore) => void
  goalId?: string | null
  nodeId?: string | null
  /** 角色专属的 Worker 授权 API 组白名单（严格硬禁 subagent） */
  allowedGroups?: string[]
  onDelivery?: (delivery: DeliveryRecord) => void
}

/**
 * 为 Isolated Worker 装配真实的生产工具集（execute + rexecute）
 */
export function createSuperWorkerTools(deps: SuperWorkerToolsDeps): AgentTool[] {
  const { getLatest, set, goalId, nodeId, allowedGroups } = deps

  // 1. 如果有真实的 Store 依赖，装配全套受控工作区沙箱能力
  if (getLatest && set) {
    const sandboxBase = learnSandboxOps({
      getLatest,
      set,
      goalId: () => goalId ?? '',
      nodeId: () => nodeId ?? null,
    })

    // 铁律：不透传 subagent 组，避免递归调用
    delete (sandboxBase as Record<string, unknown>).subagent

    // 限制白名单并定制 API 简介（严格剔除 subagent，并加入 delivery 支持）
    const effectiveGroups = allowedGroups?.length
      ? allowedGroups.filter((g) => g !== 'subagent')
      : [...SUBAGENT_ALLOWED_GROUPS]
    if (!effectiveGroups.includes('delivery')) {
      effectiveGroups.push('delivery')
    }

    const deliveryOps = {
      submit: (input: unknown) => {
        const rec = normalizeDelivery(input)
        if (!rec) {
          return { ok: false, error: '至少要提供 files 或 sources' }
        }
        if (goalId && getLatest) {
          const st = getLatest()
          for (const f of rec.files) {
            if (!f.goalId) f.goalId = goalId
            if (!f.nodeId) {
              const byId = st.nodes?.find(
                (n) => n.id === f.path || (f.path.startsWith('#') && n.id === f.path.slice(1)),
              )
              if (byId) {
                f.nodeId = byId.id
                continue
              }
              const res = resolveNode(st, { goalId, currentNodeId: nodeId ?? null }, f.path)
              if (res.ok) {
                f.nodeId = res.value.id
                continue
              }
              const clean = f.path.replace(/\.md$/i, '').trim()
              const byClean = st.nodes?.find((n) => n.goalId === goalId && n.title === clean)
              if (byClean) {
                f.nodeId = byClean.id
                continue
              }
            }
          }
        }
        deps.onDelivery?.(rec)
        return { ok: true, files: rec.files.length, sources: rec.sources.length }
      },
    }

    sandboxBase.apiAllow = effectiveGroups
    sandboxBase.apiBrief = apiBriefForGroups(sandboxBase.apiAllow)

    return createExecuteTools({
      ...sandboxBase,
      delivery: deliveryOps,
    })
  }

  // 2. 脱机或无 Store 依赖时的极简安全降级工具
  const effectiveGroups = allowedGroups?.length
    ? allowedGroups.filter((g) => g !== 'subagent')
    : [...SUBAGENT_ALLOWED_GROUPS]

  return createExecuteTools({
    resolveNode: () => ({ ok: false, message: '脱机模式不支持节点读写' }),
    resolveDoc: () => ({ ok: false, message: '脱机模式不支持文档读写' }),
    nodeId: () => null,
    docOps: {} as never,
    nodes: {} as never,
    apiAllow: effectiveGroups,
    apiBrief: apiBriefForGroups(effectiveGroups),
  })
}
