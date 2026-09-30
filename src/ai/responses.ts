/**
 * OpenAI Responses 兼容协议。
 *
 * 与 Chat Completions 的差异：
 * | 维度 | Chat Completions | Responses |
 * | --- | --- | --- |
 * | 端点 | POST /chat/completions | POST /responses |
 * | 输入 | `messages` | `input` 项数组（message / function_call / function_call_output）|
 * | 系统提示词 | messages 里的一条 | 顶层 `instructions` |
 * | 工具声明 | `function.parameters` | `name` + `parameters`（去掉 function 包装）|
 * | 工具调用 | assistant.tool_calls | 独立的 `function_call` 项 |
 * | 工具结果 | role:'tool' | 独立的 `function_call_output` 项 |
 * | 流式 | `data:` 帧 + chat 事件 | 命名事件（response.output_text.delta / …）|
 * | 终态 | finish_reason | `response.completed` 的 status |
 */

import { endpoint } from './providers'
import { httpFetch } from './http'
import { AiRequestError } from './types'
import { plainText, toResponsesContent } from './content'
import type { ResponsesContentBlock } from './content'
import { isRecord } from '../lib/guards'
import { num } from '../lib/num'
import type {
  ChatMessage,
  ChatToolCall,
  ChatToolDef,
  ChatUsage,
  EffortMap,
  ReasoningEffort,
  StreamChatOptions,
  StreamChatResult,
} from './types'

/** Responses 的输入项。user 的内容可能是「文本 + 图片」的块数组 */
type ResponseItem =
  | { role: 'user' | 'assistant'; content: string | ResponsesContentBlock[] }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string }

/**
 * 把公共契约的消息翻译成 Responses 的 `input` + `instructions`。
 *
 * 关键差异：工具调用与结果不再是消息上的字段，而是**独立的输入项**，
 * 且必须成对出现——孤儿 function_call 会被服务端拒绝。
 */
export function buildResponsesBody(opts: {
  messages: ChatMessage[]
  tools?: ChatToolDef[]
  model: string
  maxTokens?: number
  temperature?: number
  reasoningEffort?: ReasoningEffort
  /** 中立档 → 线值（见 EffortMap）；由 responsesStream 从 ResolvedProvider 带进来 */
  effortMap?: EffortMap
}): Record<string, unknown> {
  const systems: string[] = []
  const input: ResponseItem[] = []

  // 先收集全部工具结果 id，用于剔除孤儿调用
  const resultIds = new Set<string>()
  for (const m of opts.messages) {
    if (m.role === 'tool' && m.tool_call_id) resultIds.add(m.tool_call_id)
  }

  for (const m of opts.messages) {
    if (m.role === 'system') {
      const text = plainText(m.content)
      if (text) systems.push(text)
      continue
    }
    if (m.role === 'assistant') {
      const text = plainText(m.content)
      if (text) input.push({ role: 'assistant', content: text })
      for (const call of m.tool_calls ?? []) {
        // 没有对应结果的调用直接丢掉，否则服务端报 missing function_call_output
        if (!resultIds.has(call.id)) continue
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments || '{}',
        })
      }
      continue
    }
    if (m.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: m.tool_call_id ?? '',
        output: plainText(m.content) || '(no output)',
      })
      continue
    }
    // user：可能带图，交给 content.ts 翻译成 input_text / input_image
    input.push({ role: 'user', content: toResponsesContent(m.content) })
  }

  if (!input.length) input.push({ role: 'user', content: '' })

  const body: Record<string, unknown> = { model: opts.model, input, stream: true }
  if (systems.length) body.instructions = systems.join('\n\n')
  if (opts.temperature !== undefined) body.temperature = opts.temperature
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({
      type: 'function',
      name: t.function.name,
      description: t.function.description,
      // Responses 把参数 schema 直接放在顶层，没有 function 包装
      parameters: t.function.parameters,
    }))
  }
  // Responses 用 reasoning.effort，且只认 minimal/low/medium/high；
  // 我们的 max 封顶到 high，避免发一个服务端不认的值。effortMap 的映射优先
  // （'omit' = 这档不发，字段整个不出现在请求里）。
  if (opts.reasoningEffort) {
    const wired = opts.effortMap?.[opts.reasoningEffort]
    if (wired !== 'omit') {
      body.reasoning = { effort: wired || (opts.reasoningEffort === 'max' ? 'high' : opts.reasoningEffort) }
    }
  }
  // 注意：Responses 不接受 max_tokens（用 max_output_tokens），
  // 这里刻意只在显式传入时才发，默认交给服务端
  if (opts.maxTokens !== undefined) body.max_output_tokens = opts.maxTokens
  return body
}

/**
 * Responses 的用量翻译。命中缓存的部分同样藏在 details 里
 * （input_tokens_details.cached_tokens），取不到就是 0。
 */
function translateResponsesUsage(raw: Record<string, unknown>): ChatUsage {
  const details = (raw.input_tokens_details ?? {}) as Record<string, unknown>
  return {
    input: num(raw.input_tokens),
    output: num(raw.output_tokens),
    cacheRead: num(details.cached_tokens),
    cacheWrite: num(details.cache_creation_tokens),
  }
}

export function responsesHeaders(apiKey: string, extra?: Record<string, string>): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    authorization: `Bearer ${apiKey.trim()}`,
    ...extra,
  }
}

/** status / incomplete_details → OpenAI 词汇 */
function mapStatus(status: unknown, reason: unknown): string {
  if (status === 'incomplete') {
    // 上下文或长度耗尽都算截断
    return reason === 'max_output_tokens' ? 'length' : 'length'
  }
  return 'stop'
}

/**
 * 流式调用 Responses 端点。
 * 工具调用的 arguments 在 Responses 里是**整体到达**的（response.output_item.done），
 * 因此不需要像 chat completions 那样拼接分片。
 */
export async function responsesStream(
  cfg: { baseUrl: string; apiKey: string; extraHeaders?: Record<string, string>; effortMap?: EffortMap },
  model: string,
  opts: StreamChatOptions,
): Promise<StreamChatResult> {
  const url = endpoint(cfg.baseUrl, '/responses')
  const body = buildResponsesBody({
    messages: opts.messages,
    tools: opts.tools,
    model,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    reasoningEffort: opts.reasoningEffort,
    effortMap: cfg.effortMap,
  })

  let res: Response
  try {
    res = await httpFetch(url, {
      method: 'POST',
      headers: responsesHeaders(cfg.apiKey, cfg.extraHeaders),
      body: JSON.stringify(body),
      signal: opts.signal,
    })
  } catch (err) {
    if (opts.signal?.aborted) throw err
    throw new AiRequestError('网络请求失败，请检查网络连接与接口地址')
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => '')
    throw new AiRequestError(describeResponsesError(res.status, raw))
  }
  if (!res.body) throw new AiRequestError('服务未返回数据流')

  const IDLE_TIMEOUT_MS = 90_000
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  let finishReason: string | null = null
  const toolCalls: ChatToolCall[] = []
  /** 用量在 response.completed 的 response.usage 上 */
  let usageFrame: Record<string, unknown> | null = null
  const onAbort = () => void reader.cancel().catch(() => {})
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  let idle: ReturnType<typeof setTimeout> | null = null

  const handleEvent = (ev: Record<string, unknown>): void => {
    const type = typeof ev.type === 'string' ? ev.type : ''
    switch (type) {
      case 'response.output_text.delta':
      case 'response.refusal.delta': {
        const delta = typeof ev.delta === 'string' ? ev.delta : ''
        if (delta) {
          content += delta
          opts.onDelta?.({ content: delta })
        }
        break
      }
      // 推理摘要：Responses 把思维链作为 summary 增量推出来
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta': {
        const delta = typeof ev.delta === 'string' ? ev.delta : ''
        if (delta) {
          reasoning += delta
          opts.onDelta?.({ reasoning: delta })
        }
        break
      }
      // 工具调用的完整项：arguments 一次性给全
      case 'response.output_item.done': {
        const item = isRecord(ev.item) ? ev.item : {}
        if (item.type === 'function_call') {
          toolCalls.push({
            id: typeof item.call_id === 'string' ? item.call_id : `call_${toolCalls.length}`,
            name: typeof item.name === 'string' ? item.name : '',
            arguments: typeof item.arguments === 'string' ? item.arguments : '{}',
          })
        }
        break
      }
      case 'response.completed':
      case 'response.incomplete': {
        const resp = isRecord(ev.response) ? ev.response : {}
        const details = isRecord(resp.incomplete_details) ? resp.incomplete_details : {}
        finishReason = mapStatus(resp.status, details.reason)
        if (isRecord(resp.usage)) usageFrame = resp.usage
        break
      }
      case 'response.failed': {
        const resp = isRecord(ev.response) ? ev.response : {}
        const err = isRecord(resp.error) ? resp.error : {}
        const msg = typeof err.message === 'string' ? err.message : 'Responses 返回了失败状态'
        throw new AiRequestError(`Responses 错误：${msg}`)
      }
      case 'error': {
        const err = isRecord(ev.error) ? ev.error : ev
        const msg = typeof err.message === 'string' ? err.message : 'Responses 返回了未知错误'
        throw new AiRequestError(`Responses 错误：${msg}`)
      }
      default:
        break
    }
  }

  /** 命名事件同样是 SSE：`event: xxx` + `data: {...}`，按空行切块 */
  const handleChunk = (text: string): void => {
    buffer += text
    let sep = buffer.indexOf('\n\n')
    while (sep !== -1) {
      const chunk = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (!data || data === '[DONE]') continue
        try {
          const parsed: unknown = JSON.parse(data)
          if (isRecord(parsed)) handleEvent(parsed)
        } catch (err) {
          if (err instanceof AiRequestError) throw err
        }
      }
      sep = buffer.indexOf('\n\n')
    }
  }

  try {
    for (;;) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          idle = setTimeout(() => reject(new AiRequestError('响应超时，连接可能已中断')), IDLE_TIMEOUT_MS)
        }),
      ])
      if (idle) {
        clearTimeout(idle)
        idle = null
      }
      const { done, value } = chunk
      if (done) break
      handleChunk(decoder.decode(value, { stream: true }))
    }
    if (buffer.trim()) handleChunk('\n\n')
  } catch (err) {
    if (opts.signal?.aborted) throw err
    if (err instanceof AiRequestError) {
      throw new AiRequestError(`${err.message}（已接收 ${content.length} 字后就断了）`)
    }
    throw err
  } finally {
    if (idle) clearTimeout(idle)
    opts.signal?.removeEventListener('abort', onAbort)
  }

  // 有工具调用时，即使没收到 completed 也按 tool_calls 收场
  if (!finishReason) finishReason = toolCalls.length ? 'tool_calls' : 'stop'
  return {
    content,
    reasoning,
    toolCalls,
    finishReason,
    usage: usageFrame ? translateResponsesUsage(usageFrame) : undefined,
  }
}

export function describeResponsesError(status: number, raw: string): string {
  let detail = ''
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string') {
      detail = parsed.error.message
    } else if (isRecord(parsed) && typeof parsed.message === 'string') {
      detail = parsed.message
    }
  } catch {
    // 非 JSON，忽略
  }
  const tail = detail ? `：${detail}` : ''
  if (status === 401 || status === 403) return `API Key 无效或没有访问权限${tail}`
  if (status === 404) return '接口地址或模型名不存在（该服务可能不支持 Responses 接口）'
  if (status === 400) return `请求参数被拒绝${tail}`
  if (status === 429) return '请求过于频繁或额度已用尽，请稍后再试'
  if (status >= 500) return '服务暂时不可用'
  return `请求失败（HTTP ${status}）${tail}`
}
