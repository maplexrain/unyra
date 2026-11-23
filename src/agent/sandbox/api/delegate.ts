/**
 * role 专用域：permission.*（外部路径放行的查看、撤销与审批）。
 *
 * work 不拿这一组：改放行配置是 role 与用户之间的事，不从工作会话手里过。
 */
import { asRecord, asText } from '../refs'
import { wrapApi } from '../wrap'
import type { SandboxCall, SandboxOptions } from '../types'

export function installDelegate(api: Record<string, unknown>, opts: SandboxOptions, log: SandboxCall[]): void {
  if (!opts.permission) return
  const perm = opts.permission
  wrapApi(api, 'permission.list', () => perm.list(), log)
  wrapApi(api, 'permission.revoke', (args) => {
    const raw = asText(args[0]).trim()
    if (!raw) return { ok: false, error: 'permission.revoke 需要一个 path（要撤销放行的目录）' }
    return perm.revoke(raw)
  }, log)
  wrapApi(api, 'permission.request', (args) => {
    const a = asRecord(args[0])
    const rawPath = asText(a.path).trim()
    if (!rawPath) {
      return { ok: false, error: 'permission.request 需要 path（要放行的目录），可附 reason 说明给用户看' }
    }
    return perm.request({ path: rawPath, ...(asText(a.reason).trim() ? { reason: asText(a.reason).trim() } : {}) })
  }, log)
}
