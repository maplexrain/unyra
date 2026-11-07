/**
 * 这个文件负责什么：宿主交互通道的 api 装配（mcp / userInfo / wait / ask / tiktok）——
 * 外部 MCP 工具、学习者画像、阻塞等待、结构化表单提问与响铃。
 * 能力本体在宿主（mcp.* 见 agent/mcp/ops，ask 的表单归一在 sandbox/askForm）。
 */
import { normalizeAskForm } from '../askForm'
import { asRecord, asText } from '../refs'
import { wrapApi } from '../wrap'
import type { SandboxCall, SandboxOptions } from '../types'

/** 宿主交互域：mcp / userInfo / wait / ask / tiktok */
export function installHost(api: Record<string, unknown>, opts: SandboxOptions, log: SandboxCall[]): void {
  // 外部 MCP 服务（mcp.*，见 agent/mcp/ops）：用户配置的真实外部工具。
  // MCP 总开关关着就没有这一组——与旧做法「关闭时不注入任何 MCP 工具」同一口径。
  if (opts.mcp) {
    const mcp = opts.mcp
    wrapApi(api, 'mcp.list', () => mcp.list(), log)
    wrapApi(
      api,
      'mcp.discover',
      (args) => mcp.discover(args.length ? asText(args[0]).trim() || undefined : undefined),
      log,
    )
    wrapApi(api, 'mcp.call', (args) => {
      const server = asText(args[0]).trim()
      const tool = asText(args[1]).trim()
      if (!server || !tool) {
        return {
          ok: false,
          error: 'mcp.call 需要服务与工具名：mcp.call(服务, 工具, 参数对象?)——服务和工具名见 api.mcp.list()',
        }
      }
      return mcp.call(server, tool, args[2])
    }, log)
  }

  // 学习者画像：get 回给模型看的那份（不含头像），update 是增量的（只写传进来的字段）
  if (opts.userInfo) {
    const userInfo = opts.userInfo
    wrapApi(api, 'userInfo.get', () => userInfo.get(), log)
    wrapApi(api, 'userInfo.update', (args) => userInfo.update(asRecord(args[0])), log)
  }

  // 阻塞等待：范围收在 0~120000，长睡只会让用户以为卡死了
  if (opts.wait) {
    const wait = opts.wait
    wrapApi(api, 'wait', (args) => {
      const first = args[0]
      let ms = 0
      if (typeof first === 'object' && first !== null) {
        const obj = first as Record<string, unknown>
        if (typeof obj.seconds === 'number') {
          if (obj.seconds < 0) return { ok: false, error: 'wait 时间不能为负数' }
          ms = Math.round(obj.seconds * 1000)
        } else if (typeof obj.ms === 'number') {
          if (obj.ms < 0) return { ok: false, error: 'wait 时间不能为负数' }
          ms = Math.round(obj.ms)
        }
      } else {
        const raw = typeof first === 'number' ? first : Number(first)
        if (Number.isFinite(raw)) {
          if (raw < 0) return { ok: false, error: 'wait 时间不能为负数' }
          ms = Math.round(raw)
        }
      }
      ms = Math.min(120_000, ms)
      return wait(ms).then(() => ({ ok: true, waited: ms }))
    }, log)
  }

  // 结构化表单：形状先归一化，校验失败把「第几题、哪个字段」说清楚再回给模型
  if (opts.ask) {
    const ask = opts.ask
    wrapApi(api, 'ask', async (args) => {
      const parsed = normalizeAskForm(args[0])
      if (!parsed.ok) return parsed
      const res = await ask(parsed.form)
      if (res && typeof res === 'object' && Array.isArray((res as any).answers)) {
        for (const ans of (res as any).answers) {
          if (ans.type === 'short') {
            ans.text = ans.text ?? ''
            ans.value = ans.value ?? ans.text
          }
        }
      }
      return res
    }, log)
  }

  if (opts.tiktok) {
    const tiktok = opts.tiktok
    wrapApi(api, 'tiktok', () => Promise.resolve(tiktok()).then(() => ({ ok: true, note: '已响铃' })), log)
  }
}
