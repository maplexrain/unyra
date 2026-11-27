/**
 * DeepSeek 服务端联网工具的线协议：声明、事件归一化、历史回传。
 *
 * 从 ai/client 抽出来单独成文件（文件体积门禁），但语义仍是一件事：
 * 把 API 文档里的 `server_tool_event` / `server_tool_calls` / `annotations`
 * 翻译成本项目统一的 ServerToolCall / ServerToolStep / ServerToolStreamEvent。
 * 这里不碰网络、不碰 UI，纯解析，方便单测直接钉住文档字段。
 */
import type {
  ServerToolCall,
  ServerToolStep,
  ServerToolStreamEvent,
  UrlCitation,
  WebSearchSource,
} from './types'

/** 声明只需要看这两项；不导入 client 的 ResolvedProvider，避免运行期循环。 */
type ServerToolProvider = {
  protocol?: string
  serverTools?: { webSearch: boolean; readUrl: boolean } | null
}

/** 按 provider 的服务端工具开关生成 tools 数组的声明条目（非 OpenAI / 非 flash 一律不声明） */
export function serverToolDeclarations(
  p: ServerToolProvider,
  model: string,
): Array<Record<string, string>> {
  if ((p.protocol ?? 'openai') !== 'openai' || !p.serverTools) return []
  if (model.toLowerCase() !== 'deepseek-flash') return []
  const out: Array<Record<string, string>> = []
  if (p.serverTools.webSearch) out.push({ type: 'deepseek_web_search' })
  if (p.serverTools.readUrl) out.push({ type: 'deepseek_read_url' })
  return out
}

/**
 * 历史回传的线格式。`sources` 是界面展示用，服务端不会把它留在上下文里，
 * 回传时省掉可以少带一大段 JSON；真正决定「之前读过的页还在不在」的是 `signature`。
 */
export function wireServerToolCalls(steps: ServerToolStep[]): Array<Record<string, unknown>> {
  return steps.map((s) => ({
    index: s.index,
    reasoning_content: s.reasoningContent ?? '',
    calls: s.calls.map((c) => ({
      id: c.id,
      type: c.type,
      kind: c.kind,
      action: c.action,
      status: c.status,
      ...(c.index !== undefined ? { index: c.index } : {}),
      ...(c.signature ? { signature: c.signature } : {}),
      ...(c.error ? { error: c.error } : {}),
    })),
  }))
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function strOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function sourceOf(value: unknown): WebSearchSource | null {
  const rec = recordOf(value)
  const url = strOf(rec?.url)
  if (!rec || !url) return null
  return {
    url,
    ...(strOf(rec.title) ? { title: strOf(rec.title) } : {}),
    ...(strOf(rec.site_name) ? { siteName: strOf(rec.site_name) } : {}),
    ...(strOf(rec.snippet) ? { snippet: strOf(rec.snippet) } : {}),
    ...(strOf(rec.published_at) ? { publishedAt: strOf(rec.published_at) } : {}),
    ...(strOf(rec.site_icon) ? { siteIcon: strOf(rec.site_icon) } : {}),
    ...(strOf(rec.image_url) ? { imageUrl: strOf(rec.image_url) } : {}),
  }
}

function normalizeServerCall(
  value: unknown,
  fallbackStatus: ServerToolCall['status'],
  step: number,
): ServerToolCall | null {
  const rec = recordOf(value)
  const id = strOf(rec?.id)
  if (!rec || !id) return null
  const actionRec = recordOf(rec.action) ?? {}
  const actionType = strOf(actionRec.type) ?? 'search'
  const queries = Array.isArray(actionRec.queries)
    ? actionRec.queries.filter((q): q is string => typeof q === 'string')
    : []
  const status =
    rec.status === 'completed' || rec.status === 'failed' || rec.status === 'running'
      ? rec.status
      : fallbackStatus
  const sources = Array.isArray(rec.sources)
    ? rec.sources.map(sourceOf).filter((s): s is WebSearchSource => Boolean(s))
    : undefined
  const page = sourceOf(rec.page)
  const error = recordOf(rec.error)
  return {
    id,
    type: strOf(rec.type) ?? 'server_tool',
    kind: strOf(rec.kind) ?? actionType,
    action: {
      type: actionType,
      ...(queries.length ? { queries } : {}),
      ...(strOf(actionRec.url) ? { url: strOf(actionRec.url) } : {}),
      ...(strOf(actionRec.pattern) ? { pattern: strOf(actionRec.pattern) } : {}),
    },
    status,
    ...(sources?.length ? { sources } : {}),
    ...(page ? { page } : {}),
    ...(strOf(rec.signature) ? { signature: strOf(rec.signature) } : {}),
    ...(error ? { error: { ...(strOf(error.code) ? { code: strOf(error.code) } : {}) } } : {}),
    ...(numOf(rec.index) !== undefined ? { index: numOf(rec.index) } : {}),
    step,
  }
}

export function normalizeServerSteps(value: unknown): ServerToolStep[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, i) => {
    const rec = recordOf(item)
    if (!rec) return []
    const index = numOf(rec.index) ?? i
    const calls = Array.isArray(rec.calls)
      ? rec.calls
          .map((call) => normalizeServerCall(call, 'completed', index))
          .filter((c): c is ServerToolCall => Boolean(c))
      : []
    return [{
      index,
      ...(typeof rec.reasoning_content === 'string' ? { reasoningContent: rec.reasoning_content } : {}),
      calls,
    }]
  })
}

export function normalizeAnnotations(value: unknown): UrlCitation[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const rec = recordOf(item)
    const url = strOf(rec?.url)
    if (!rec || !url) return []
    return [{
      url,
      ...(strOf(rec.title) ? { title: strOf(rec.title) } : {}),
      ...(numOf(rec.start_index) !== undefined ? { startIndex: numOf(rec.start_index) } : {}),
      ...(numOf(rec.end_index) !== undefined ? { endIndex: numOf(rec.end_index) } : {}),
    }]
  })
}

export function normalizeServerToolEvent(value: unknown): ServerToolStreamEvent | null {
  const rec = recordOf(value)
  const type = strOf(rec?.type)
  if (!rec || !type) return null
  const step = numOf(rec.step) ?? 0
  if (type === 'step_reasoning_done') return { type, step }
  if (type === 'call_started' || type === 'call_completed') {
    const call = normalizeServerCall(rec.call, type === 'call_started' ? 'running' : 'failed', step)
    return call ? { type, step, call } : null
  }
  return null
}
