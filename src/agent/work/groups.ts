/**
 * work 的 api 清单与 execute 参数说明。
 *
 * work 的 api 面由 role 的能力面派生（见 agent/agentProfile 的 WORK_API_PLANES），
 * 不再由 role 在 create 时手写；这里只负责把组清单渲染成 execute 参数说明。
 */
import { SANDBOX_API_CATALOG } from '../apiCatalog'

export function apiBriefForGroups(groups: string[]): string {
  const allow = new Set(groups)
  const lines: string[] = []
  for (const group of SANDBOX_API_CATALOG) {
    for (const item of group.items) {
      const dot = item.name.indexOf('.')
      const g = dot < 0 ? item.name : item.name.slice(0, dot)
      if (!allow.has(g)) continue
      lines.push(item.name + '(' + item.signature.slice(item.signature.indexOf('(') + 1) + ')：' + item.summary)
    }
  }
  return lines.join('；\n') + '。'
}
