/**
 * 这个文件负责什么：**导师专用**通道的 api 装配（subagent.* / permission.*）——
 * 子代理管理与路径放行审批。SUBAGENT_ALLOWED_GROUPS 里没有这两组，子代理的
 * apiAllow 白名单永远放不进来（不递归在通道口硬挡；实现在 subagent/manager 与
 * agent/permissions）。
 */
import { asRecord, asText } from '../refs'
import { wrapApi } from '../wrap'
import type { SandboxCall, SandboxOptions } from '../types'

/** 导师专用域：subagent.create/run/resume/intervene/interrupt/view/delete/wait + permission.* */
export function installDelegate(api: Record<string, unknown>, opts: SandboxOptions, log: SandboxCall[]): void {
  // 子代理管理（subagent.*）：**导师专用**——SUBAGENT_ALLOWED_GROUPS 里没有这一组，
  // 子代理的 apiAllow 白名单永远放不进来（不递归在通道口硬挡）。实现在 subagent/manager。
  if (opts.subagent) {
    const sa = opts.subagent
    wrapApi(api, 'subagent.create', (args) => sa.create(asRecord(args[0])), log)
    wrapApi(api, 'subagent.run', (args) => sa.run(asRecord(args[0])), log)
    wrapApi(api, 'subagent.resume', (args) => sa.resume(asText(args[0]).trim()), log)
    wrapApi(api, 'subagent.intervene', (args) => sa.intervene(asText(args[0]).trim(), asText(args[1])), log)
    wrapApi(api, 'subagent.interrupt', (args) => sa.interrupt(asText(args[0]).trim()), log)
    wrapApi(api, 'subagent.view', (args) => sa.view(asText(args[0]).trim()), log)
    wrapApi(api, 'subagent.delete', (args) => sa.remove(asText(args[0]).trim()), log)
    wrapApi(api, 'subagent.wait', (args) => {
      const first = args[0]
      const payload = typeof first === 'number' ? { seconds: first } : asRecord(first)
      return sa.wait(payload)
    }, log)
  }

  // 路径放行（permission.*）：外部目录的查看、撤销与审批。宿主实现见 agent/permissions；
  // **导师专用**——SUBAGENT_ALLOWED_GROUPS 里没有这一组，改放行配置不从子代理手里过。
  if (opts.permission) {
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
}
