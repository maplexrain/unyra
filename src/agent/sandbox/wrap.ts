/**
 * api 方法的记账包装器：从 api.ts 抽出来的唯一一段装配逻辑——
 * nodeObject（节点对象通道）也要注册 api，共用同一份记账与失败判定，
 * 放在 api.ts 里就会形成循环引用，于是单独成文件。
 */
import type { MessageImage } from '../types'
import { renderApiHelp, renderGroupHelp, apiDocOf } from './apiRegistry'
import { MAX_LOGGED_CALLS } from './limits'
import type { SandboxCall } from './types'

/**
 * api 的失败表达方式：
 * 结构性失败一律回 { ok:false, error }，作为值回给模型，避免抛异常带崩同批次其它调用。
 */
function isFailedValue(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false
  const r = v as { ok?: unknown; error?: unknown }
  return r.ok === false || typeof r.error === 'string'
}

/** api 返回值里夹带的图片引用（如看图 / 截图 api 附带的图）：见 AgentToolResult.images 的说明 */
export function imagesOf(value: unknown): MessageImage[] {
  if (!value || typeof value !== 'object') return []
  const imgs = (value as { images?: unknown }).images
  return Array.isArray(imgs) ? (imgs as MessageImage[]) : []
}

/**
 * 所有 execute api 的最小返回值契约：**不允许 undefined 回执**。
 *
 * 写操作没给返回值时，模型看不到“到底成没成”，于是会把同一条动作重发好几遍
 * （chat.send 重复发送就是这么来的）。这里统一补一张成功回执；具体 api 仍应
 * 尽量回 { ok:true, id/... } 这类有信息量的结果。
 */
export function apiResultOf(name: string, value: unknown): unknown {
  if (value === undefined) {
    return { ok: true, api: name, message: '调用完成（该 api 没有额外返回值）' }
  }
  return value
}

/**
 * 这次调用失败了吗——失败的话把那句话记进 record（供结果顶部那份清单用）。
 * `{ok:false}` 与 `{error}` 两种写法都认，见 isFailedValue。
 */
function markFailed(record: SandboxCall, value: unknown): void {
  if (!isFailedValue(value)) return
  record.ok = false
  const v = value as { content?: unknown; error?: unknown }
  const text =
    typeof v.error === 'string' && v.error.trim()
      ? v.error
      : typeof v.content === 'string' && v.content.trim()
        ? v.content
        : ''
  // 压成一行再截断：这句话要进结果顶部的清单，太长会把别的调用挤没
  if (text) record.message = text.replace(/\s+/g, ' ').trim().slice(0, 300)
}

/** 把工具动作包成 api 方法：每次调用记一笔，异常转为结构化失败返回值，防止炸掉整批编排 */
export function wrapApi(api: Record<string, unknown>, name: string, fn: (args: unknown[]) => unknown, log: SandboxCall[]) {
  /*
   * 注册表是唯一入口：没登记的名字不许出现在沙箱里。
   * 这条检查在 buildApi 阶段就炸，而不是等模型调到一半才发现「有这个 api 但没人知道怎么用」。
   */
  if (!apiDocOf(name)) {
    throw new Error('[sandbox] api 未在 apiRegistry 登记：' + name + '（先在 apiRegistry.ts 补签名、用法与示例）')
  }
  const wrapped = (...args: unknown[]): unknown => {
    const record: SandboxCall = { name, ok: true }
    if (log.length < MAX_LOGGED_CALLS) log.push(record)
    try {
      const value = fn(args)
      // 异步 api:
      if (value instanceof Promise) {
        return value.then(
          (settled) => {
            const result = apiResultOf(name, settled)
            markFailed(record, result)
            return result
          },
          (err: unknown) => {
            record.ok = false
            record.message = err instanceof Error ? err.message : 'api 调用失败'
            return { ok: false, error: record.message }
          },
        )
      }
      const result = apiResultOf(name, value)
      markFailed(record, result)
      return result
    } catch (err) {
      record.ok = false
      record.message = err instanceof Error ? err.message : 'api 调用失败'
      return { ok: false, error: record.message }
    }
  }
  // 宿主侧（测试 / 超级文档桥）也挂一份同步 help；真沙箱由 sandboxRuntime 再挂一次
  ;(wrapped as unknown as { __help: () => string }).__help = () => renderApiHelp(name)
  const segs = name.split('.')
  if (segs.length === 1) {
    api[name] = wrapped
    return
  }
  let cur = api
  for (let i = 0; i < segs.length - 1; i++) {
    const k = segs[i]
    cur = ((cur[k] as Record<string, unknown>) || (cur[k] = {})) as Record<string, unknown>
  }
  const groupKey = segs[0]
  const group = api[groupKey] as Record<string, unknown>
  if (group && typeof group.__help !== 'function') {
    ;(group as unknown as { __help: () => string }).__help = () => renderGroupHelp(groupKey)
  }
  cur[segs[segs.length - 1]] = wrapped
}
