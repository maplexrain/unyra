/**
 * Anthropic Messages 兼容协议。
 *
 * 与 OpenAI 的差异是结构性的，因此单独一套实现：
 * | 维度 | OpenAI 兼容 | Anthropic Messages |
 * | --- | --- | --- |
 * | 端点 | POST /chat/completions | POST /v1/messages |
 * | 鉴权 | `Authorization: Bearer` | `x-api-key` |
 * | 版本 | — | `anthropic-version: 2023-06-01` |
 * | 系统提示词 | messages 里的一条 | 顶层 `system` 字符串 |
 * | 内容 | `content` 字符串 | `content` 块数组（text / tool_use / tool_result）|
 * | 工具声明 | `function.parameters` | 顶层 `name` + `input_schema` |
 * | 工具结果 | role:'tool' + tool_call_id | user 消息里的 tool_result 块 |
 * | 流式 | `data:` 帧 + `[DONE]` | 命名事件（message_start / content_block_delta / …）|
 * | 终态 | finish_reason | `message_delta` 的 `stop_reason` |
 */

import { endpoint } from './providers'
import { httpFetch } from './http'
import { AiRequestError } from './types'
import { plainText, toAnthropicBlocks } from './content'
import type { AnthropicImageBlock } from './content'
import { isRecord } from '../lib/guards'
import { num } from '../lib/num'
import type {
  ChatMessage,
  ChatToolCall,
  ChatToolDef,
  ChatUsage,
  ReasoningEffort,
  StreamChatOptions,
  StreamChatResult,
} from './types'

/** Anthropic 要求显式给 max_tokens；这是缺省值（单轮输出） */
const DEFAULT_MAX_TOKENS = 8192

export const ANTHROPIC_VERSION = '2023-06-01'

/**
 * 思考等级 → thinking token 预算。
 * Anthropic 的 extended thinking 用预算而不是档位名，这里做一次映射。
 * 预算必须是正整数，且要留出足够空间给正文，因此取值偏保守。
 * 四档在这里全部有确定落点，不需要 EffortMap（预算对老模型的兼容性也最好）。
 */
const THINKING_BUDGET: Record<ReasoningEffort, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
  max: 32768,
}

/* ---------- 消息序列化 ---------- */

/**
 * 前缀缓存的断点标记。Anthropic **不会**自动缓存，必须在块上显式声明；
 * 同一段前缀重复出现时按 0.1 倍计价，因此断点位置直接决定省钱与否。
 * 不给 ttl 就用默认 5 分钟——1h 的缓存要额外计费，且部分中转不认这个字段。
 */
const EPHEMERAL = { type: 'ephemeral' } as const

type CacheControl = { cache_control: typeof EPHEMERAL }

type AnthropicBlock =
  | ({ type: 'text'; text: string } & Partial<CacheControl>)
  | ({ type: 'tool_use'; id: string; name: string; input: unknown } & Partial<CacheControl>)
  | ({ type: 'tool_result'; tool_use_id: string; content: string } & Partial<CacheControl>)
  // 用户贴的图（多模态输入）：只有 user 消息里有
  | (AnthropicImageBlock & Partial<CacheControl>)

/** 系统提示词块：只有它需要缓存的可能，直接带上标记 */
type AnthropicSystemBlock = { type: 'text'; text: string; cache_control?: typeof EPHEMERAL }

type AnthropicMessage = { role: 'user' | 'assistant'; content: AnthropicBlock[] }

/**
 * 给消息列表的**最后一块**打上缓存断点：这样从系统提示词到本轮输入的全部前缀
 * 都被缓存，下一轮只要前缀没变就能整段命中。打在中间没有意义——缓存是
 * 前缀匹配，标记之后的内容不会被缓存。
 */
function markCacheBreakpoint(messages: AnthropicMessage[]): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const blocks = messages[i].content
    for (let j = blocks.length - 1; j >= 0; j--) {
      // 空 text 块会被服务端拒绝，跳过它继续往前找
      const b = blocks[j]
      if (b.type === 'text' && !b.text) continue
      blocks[j] = { ...b, cache_control: EPHEMERAL }
      return
    }
  }
}

function parseToolInput(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/**
 * 把公共契约的消息列表翻译成 Anthropic 的 messages + system。
 *
 * 三个要点：
 * 1. Anthropic 把系统提示词放在顶层 `system`，不能留在 messages 里；
 * 2. 工具结果不是独立 role，而是 **user 消息里的 tool_result 块**，
 *    且连续的多个结果要并进同一条 user 消息；
 * 3. 顶层 `system` 用块数组（而不是裸字符串）以便挂 cache_control——
 *    字符串形式无法携带缓存断点，整段前缀会按全价重复计费。
 */
export function buildAnthropicBody(opts: {
  messages: ChatMessage[]
  tools?: ChatToolDef[]
  model: string
  maxTokens?: number
  temperature?: number
  reasoningEffort?: ReasoningEffort
}): { system?: AnthropicSystemBlock[]; messages: AnthropicMessage[]; stream: true; [k: string]: unknown } {
  const systems: string[] = []
  const messages: AnthropicMessage[] = []

  /** 往最后一条 user 消息里追加块；没有就新建一条 */
  const pushUserBlocks = (blocks: AnthropicBlock[]): void => {
    const last = messages[messages.length - 1]
    if (last && last.role === 'user') last.content.push(...blocks)
    else messages.push({ role: 'user', content: blocks })
  }

  for (const m of opts.messages) {
    if (m.role === 'system') {
      const text = plainText(m.content)
      if (text) systems.push(text)
      continue
    }
    if (m.role === 'assistant') {
      const blocks: AnthropicBlock[] = []
      const text = plainText(m.content)
      if (text) blocks.push({ type: 'text', text })
      for (const call of m.tool_calls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.function.name,
          input: parseToolInput(call.function.arguments),
        })
      }
      // Anthropic 不接受空 content，整条空就跳过
      if (blocks.length) messages.push({ role: 'assistant', content: blocks })
      continue
    }
    if (m.role === 'tool') {
      pushUserBlocks([
        {
          type: 'tool_result',
          tool_use_id: m.tool_call_id ?? '',
          // 空结果会被当成缺失，兜一句占位
          content: plainText(m.content) || '(no output)',
        },
      ])
      continue
    }
    // user：可能带图，整段交给 content.ts 翻译成「文本块 + 图片块」
    pushUserBlocks(toAnthropicBlocks(m.content))
  }

  if (!messages.length) messages.push({ role: 'user', content: [{ type: 'text', text: '' }] })

  // 前缀缓存断点：系统提示词 + 工具声明之后一个，整段对话之后一个。
  // 两个断点覆盖两种长度的会话——只聊了一两句时命中前者，聊深了命中后者。
  // 前缀短于模型的最小可缓存长度时服务端静默忽略，不会报错。
  const system: AnthropicSystemBlock[] | undefined = systems.length
    ? [{ type: 'text', text: systems.join('\n\n'), cache_control: EPHEMERAL }]
    : undefined
  markCacheBreakpoint(messages)

  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages,
    stream: true,
    ...(system ? { system } : {}),
  }
  if (opts.temperature !== undefined) body.temperature = opts.temperature
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }))
  }
  // extended thinking：预算必须小于 max_tokens，否则服务端直接 400
  if (opts.reasoningEffort) {
    const budget = Math.min(THINKING_BUDGET[opts.reasoningEffort], (body.max_tokens as number) - 1024)
    if (budget > 0) body.thinking = { type: 'enabled', budget_tokens: budget }
  }
  return body as { system?: AnthropicSystemBlock[]; messages: AnthropicMessage[]; stream: true }
}

/* ---------- 请求头 ---------- */

/**
 * Anthropic 的用量翻译。
 *
 * input_tokens 是**没命中缓存的**那部分：真正的上下文规模要把
 * cache_read_input_tokens 与 cache_creation_input_tokens 加回去——
 * 圆环要的是「我这次到底送进去多少」，不是「我这次花了多少钱」。
 * 命中率则单独看 cache_read，所以两者不能混在一起。
 */
function anthropicUsage(
  inFrame: Record<string, unknown> | null,
  outFrame: Record<string, unknown> | null,
): ChatUsage | undefined {
  if (!inFrame && !outFrame) return undefined
  const fresh = num(inFrame?.input_tokens)
  const cacheRead = num(inFrame?.cache_read_input_tokens)
  const cacheWrite = num(inFrame?.cache_creation_input_tokens)
  const input = num(outFrame?.input_tokens) || fresh + cacheRead + cacheWrite
  return {
    input,
    output: num(outFrame?.output_tokens),
    cacheRead,
    cacheWrite,
  }
}

export function anthropicHeaders(
  apiKey: string,
  version?: string,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    // Anthropic 用 x-api-key，不是 Bearer
    'x-api-key': apiKey.trim(),
    // 版本头可以由用户在表单里改（预设声明了 apiVersion 字段）
    'anthropic-version': version?.trim() || ANTHROPIC_VERSION,
    // 允许浏览器/中间层直连（Anthropic 官方要求显式声明）
    'anthropic-dangerous-direct-browser-access': 'true',
    ...extra,
  }
}

/* ---------- 事件流 ---------- */

interface AnthropicEvent {
  type: string
  [key: string]: unknown
}

/** stop_reason → OpenAI 词汇（runtime 只认后者） */
function mapStopReason(raw: unknown): string {
  switch (raw) {
    case 'tool_use':
      return 'tool_calls'
    case 'max_tokens':
      return 'length'
    case 'end_turn':
    case 'stop_sequence':
      return 'stop'
    default:
      return typeof raw === 'string' ? raw : 'stop'
  }
}

/**
 * 流式调用 Anthropic Messages 端点。
 * 与 OpenAI 客户端同签名语义：增量回调 + 返回累积结果。
 */
export async function anthropicStream(
  cfg: { baseUrl: string; apiKey: string; extraHeaders?: Record<string, string>; apiVersion?: string },
  model: string,
  opts: StreamChatOptions,
): Promise<StreamChatResult> {
  const url = endpoint(cfg.baseUrl, '/v1/messages')
  const body = buildAnthropicBody({
    messages: opts.messages,
    tools: opts.tools,
    model,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    reasoningEffort: opts.reasoningEffort,
  })

  let res: Response
  try {
    res = await httpFetch(url, {
      method: 'POST',
      headers: anthropicHeaders(cfg.apiKey, cfg.apiVersion, cfg.extraHeaders),
      body: JSON.stringify(body),
      signal: opts.signal,
    })
  } catch (err) {
    if (opts.signal?.aborted) throw err
    throw new AiRequestError('网络请求失败，请检查网络连接与接口地址')
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => '')
    throw new AiRequestError(describeAnthropicError(res.status, raw))
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
  /** 未完成的工具块：Anthropic 的 input 是分片 JSON，要按块累积 */
  const openBlocks = new Map<number, { id: string; name: string; json: string }>()
  /**
   * 用量分两处到达：message_start 给输入的（含缓存读/写），
   * message_delta 给输出的。两处都要收，缺一个就少一半数据。
   */
  let usageIn: Record<string, unknown> | null = null
  let usageOut: Record<string, unknown> | null = null
  const onAbort = () => void reader.cancel().catch(() => {})
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  let idle: ReturnType<typeof setTimeout> | null = null

  /** 收尾一个工具块：此刻它的 input JSON 才完整 */
  const closeBlock = (index: number): void => {
    const b = openBlocks.get(index)
    if (!b) return
    openBlocks.delete(index)
    if (b.name) toolCalls.push({ id: b.id, name: b.name, arguments: b.json || '{}' })
  }

  const handleEvent = (ev: AnthropicEvent): void => {
    switch (ev.type) {
      case 'message_start': {
        const message = isRecord(ev.message) ? ev.message : {}
        if (isRecord(message.usage)) usageIn = message.usage
        break
      }
      case 'content_block_start': {
        const index = typeof ev.index === 'number' ? ev.index : 0
        const block = isRecord(ev.content_block) ? ev.content_block : {}
        if (block.type === 'tool_use') {
          openBlocks.set(index, {
            id: typeof block.id === 'string' ? block.id : `call_${index}`,
            name: typeof block.name === 'string' ? block.name : '',
            json: '',
          })
        }
        break
      }
      case 'content_block_delta': {
        const index = typeof ev.index === 'number' ? ev.index : 0
        const delta = isRecord(ev.delta) ? ev.delta : {}
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          content += delta.text
          opts.onDelta?.({ content: delta.text })
        } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          reasoning += delta.thinking
          opts.onDelta?.({ reasoning: delta.thinking })
        } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          const b = openBlocks.get(index)
          if (b) b.json += delta.partial_json
        }
        break
      }
      case 'content_block_stop': {
        closeBlock(typeof ev.index === 'number' ? ev.index : 0)
        break
      }
      case 'message_delta': {
        const delta = isRecord(ev.delta) ? ev.delta : {}
        if (delta.stop_reason) finishReason = mapStopReason(delta.stop_reason)
        if (isRecord(ev.usage)) usageOut = ev.usage
        break
      }
      case 'message_stop':
        finishReason = finishReason ?? 'stop'
        break
      case 'error': {
        const err = isRecord(ev.error) ? ev.error : {}
        const msg = typeof err.message === 'string' ? err.message : 'Anthropic 返回了未知错误'
        throw new AiRequestError(`Anthropic 错误：${msg}`)
      }
      case 'ping':
      default:
        break
    }
  }

  /** SSE 按「空行分隔的事件块」切分，块内可能有 event: 与 data: 两行 */
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
        if (!data) continue
        try {
          handleEvent(JSON.parse(data) as AnthropicEvent)
        } catch (err) {
          // handleEvent 里抛的 AiRequestError 要透出去；JSON 解析失败则忽略该行
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
    // 收尾残留：最后一块可能没有以空行结束
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

  // 流结束时仍未收到 content_block_stop 的工具块：也收进来，避免丢调用
  for (const index of [...openBlocks.keys()]) closeBlock(index)

  return { content, reasoning, toolCalls, finishReason, usage: anthropicUsage(usageIn, usageOut) }
}

/** Anthropic 的错误体是 { error: { type, message } }，翻译成人话 */
export function describeAnthropicError(status: number, raw: string): string {
  let detail = ''
  let kind = ''
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isRecord(parsed) && isRecord(parsed.error)) {
      if (typeof parsed.error.message === 'string') detail = parsed.error.message
      if (typeof parsed.error.type === 'string') kind = parsed.error.type
    }
  } catch {
    // 非 JSON，忽略
  }
  const tail = detail ? `：${detail}` : ''
  if (status === 401) return 'API Key 无效或已过期'
  if (status === 403) return `没有访问权限${tail}`
  if (status === 404) return '接口地址或模型名不存在，请检查提供商设置'
  if (status === 400) return `请求参数被拒绝${tail}`
  if (status === 413) return '请求内容过长，超出模型上下文上限'
  if (status === 429) return '请求过于频繁或额度已用尽，请稍后再试'
  if (status >= 500) return 'Anthropic 服务暂时不可用'
  return `请求失败（HTTP ${status}${kind ? ` ${kind}` : ''}）${tail}`
}
