/**
 * 按组裁剪沙箱基座：只注入名单里的能力组，未开放的组根本不出现。
 *
 * 这是 role/work 之外的受限会话（对外 MCP guest）用的裁剪刀；work 不需要它——
 * work 的 api 面由 `workRuntimeApiAllow` 在通道口硬挡，沙箱基座整份带过去。
 */
import type { SandboxOptions } from './types'
import { apiBriefForGroups } from '../work/groups'

export function subsetSandbox(base: SandboxOptions, groups: string[]): SandboxOptions {
  const has = (group: string): boolean => groups.includes(group)
  return {
    nodeId: base.nodeId,
    resolveNode: base.resolveNode,
    resolveDoc: base.resolveDoc,
    docOps: base.docOps,
    ...(base.nodes ? { nodes: base.nodes } : {}),
    ...(base.docPath ? { docPath: base.docPath } : {}),
    ...(has('tmp') && base.tmp ? { tmp: base.tmp } : {}),
    ...(has('web') && base.web ? { web: base.web } : {}),
    ...(has('memory') && base.memory ? { memory: base.memory } : {}),
    ...(has('workspace') && base.workspace ? { workspace: base.workspace } : {}),
    ...(base.runSandbox ? { runSandbox: base.runSandbox } : {}),
    ...(base.timeoutMs !== undefined ? { timeoutMs: base.timeoutMs } : {}),
    apiAllow: groups,
    apiBrief: apiBriefForGroups(groups),
  }
}
