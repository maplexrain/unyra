/**
 * 统一的 Chat 客户端：所有提供商共用一套请求、错误翻译与取消语义。
 *
 * 协议按 OpenAI 兼容格式实现：
 * - POST {baseUrl}/chat/completions（stream: true 走 SSE）
 * - GET  {baseUrl}/models
 * - Authorization: Bearer <apiKey>
 *
 * 每家服务的差异收敛到 ResolvedProvider 的 quirks 里（见 ai/providers），
 * 因此这里没有一句 if (provider === 'xxx')。新增提供商只改 providers.ts。
 */

import { endpoint, isGoPlanModel } from './providers'
import { toOpenAiContent } from './content'
import { commandCodeStream } from './commandcode'
import { anthropicStream } from './anthropic'
import { responsesStream } from './responses'
import { httpFetch } from './http'
import {
  AiRequestError,
  cacheHitRate,
  type ChatMessage,
  type ChatToolDef,
  type ChatToolCall,
  type ChatUsage,
  type EffortMap,
  type ProviderProtocol,
  type ReasoningEffort,
  type StreamChatResult,
  type StreamChatOptions,
} from './types'
import type { ProviderQuirks } from './providers'
import { num } from '../lib/num'
import { t } from '../i18n'

export { AiRequestError } from './types'
export type {
  ChatMessage,
  ChatToolDef,
  ChatToolCall,
  StreamChatResult,
  StreamChatOptions,
  StreamFn,
} from './types'

/** 一次调用所需的全部提供商信息（已解析、可直接发请求） */
export interface ResolvedProvider {
  id: string
  /** 显示名，仅用于错误提示的措辞 */
  label: string
  /** API 根地址（不含具体端点路径） */
  baseUrl: string
  apiKey: string
  /** 额外请求头（部分网关要求 App 标识、版本号等） */
  extraHeaders?: Record<string, string>
  quirks?: ProviderQuirks
  /**
   * 中立思考档 → 线值（见 EffortMap）。已按「模型 → 提供商 → 预设」合成完毕
   * （见 ai/settings 的 resolveProvider），缺档回落各协议模块里的默认映射。
   */
  effortMap?: EffortMap
  /** 线上协议；省略按 'openai' 处理 */
  protocol?: ProviderProtocol
  /** 模型目录端点路径；省略按 '/models' 处理 */
  modelsPath?: string
  /** 该提供商的单轮输出上限；省略用调用方的默认值 */
  maxTokens?: number
  /** 拉取目录时是否按 Command Code Go 套餐筛选 */
  goPlanOnly?: boolean
  /** 用户填的 API 版本（预设声明了该字段时才有值） */
  apiVersion?: string
}

/** 把 HTTP 状态码与响应体翻译成用户能看懂的提示，其余原样抛出 */
function toMessage(label: string, status: number, body: string): string {
  if (status === 401 || status === 403) return t('API Key 无效或没有访问权限')
  if (status === 402) return t('账户余额不足')
  if (status === 404) return t('接口地址或模型名不存在，请检查提供商设置')
  if (status === 413) return t('请求内容过长，超出模型上下文上限')
  if (status === 422) return t('请求参数错误')
  if (status === 429) return t('请求过于频繁或额度已用尽，请稍后再试')
  if (status === 500 || status === 502 || status === 503 || status === 504)
    return t('{0} 服务暂时不可用', label)
  try {
    const msg = (JSON.parse(body) as { error?: { message?: string } }).error?.message
    if (msg) return t('请求失败：{0}', msg)
  } catch {
    // 非 JSON 响应体，走默认提示
  }
  return t('请求失败（HTTP {0}）', status)
}

/**
 * 把 OpenAI 兼容的 usage 帧翻译成统一的 ChatUsage。
 *
 * 命中缓存的字段各家写法不同，这里一次收齐：
 * - OpenAI / 多数中转：prompt_tokens_details.cached_tokens
 * - DeepSeek：prompt_cache_hit_tokens
 * - 另有个别网关自己起名，取不到就按 0（显示成没命中，不影响输入输出总数）。
 */
function translateUsage(raw: Record<string, unknown>): ChatUsage {
  const details = (raw.prompt_tokens_details ?? {}) as Record<string, unknown>
  return {
    input: num(raw.prompt_tokens) || num(raw.input_tokens),
    output: num(raw.completion_tokens) || num(raw.output_tokens),
    cacheRead: num(details.cached_tokens) || num(raw.prompt_cache_hit_tokens),
    cacheWrite: num(details.cache_creation_tokens),
  }
}

/** 请求头：鉴权 + 额外头；Key 为空时不发 Authorization（本地模型常常不需要） */
function headersFor(p: ResolvedProvider): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...p.extraHeaders,
  }
  const key = p.apiKey.trim()
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

/**
 * 把用户的 baseUrl 规范化成根地址。
 * 允许用户直接粘贴完整的 …/chat/completions（很常见），这里去掉该后缀，
 * 避免拼成 …/chat/completions/chat/completions。
 */
function rootOf(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
}

/** 组装请求体：把 quirks 翻译成对应字段，未声明的差异一律按标准字段处理 */
function bodyFor(
  p: ResolvedProvider,
  opts: {
    model: string
    messages: ChatMessage[]
    stream: boolean
    tools?: ChatToolDef[]
    temperature?: number
    maxTokens?: number
    reasoningEffort?: ReasoningEffort
    json?: boolean
  },
): Record<string, unknown> {
  const tokenParam = p.quirks?.tokenParam ?? 'max_tokens'
  const body: Record<string, unknown> = {
    model: opts.model,
    /**
     * 内容在这里翻译成 OpenAI 的线格式：纯文本仍是字符串（兼容性最好），
     * 只有带图的消息才变成 [text, image_url] 数组（见 ai/content）。
     * 中立形态只存在于历史里——换提供商不必改写历史，前缀缓存因此不受影响。
     */
    messages: opts.messages.map((m) => ({ ...m, content: toOpenAiContent(m.content) })),
    stream: opts.stream,
  }
  // 不传 maxTokens 就不发该字段：把单轮输出长度交给服务端默认值。
  // 之前固定发 128K，反而容易被我们这边的上限先截断。
  if (opts.maxTokens !== undefined) body[tokenParam] = opts.maxTokens
  if (opts.temperature !== undefined && !p.quirks?.omitTemperature) {
    body.temperature = opts.temperature
  }
  // 思考等级：OpenAI 兼容协议统一用 reasoning_effort；
  // 不认这个字段的服务会忽略它（少数会 400，那就把该提供商的 quirks 关掉）。
  // 发什么先过 effortMap（模型/提供商/预设三级级联，'omit' = 这档不发）；
  // 没映射的走协议默认——OpenAI 系没有 max，封顶到 high，避免发服务端不认的值。
  if (opts.reasoningEffort !== undefined && !p.quirks?.omitReasoningEffort) {
    const wired = p.effortMap?.[opts.reasoningEffort]
    if (wired !== 'omit') {
      body.reasoning_effort = wired || (opts.reasoningEffort === 'max' ? 'high' : opts.reasoningEffort)
    }
  }
  /**
   * 要用量数据就得显式声明 include_usage（OpenAI 兼容协议的约定）：
   * 不声明的话流里不会有 usage 帧，界面上的 token 与命中率就只能靠估算。
   * 少数兼容实现不认这个字段，为此留了 omitStreamUsage 的开关。
   */
  if (opts.stream && !p.quirks?.omitStreamUsage) {
    body.stream_options = { include_usage: true }
  }
  if (opts.json) body.response_format = { type: 'json_object' }
  if (opts.tools?.length) {
    body.tools = opts.tools
    body.tool_choice = 'auto'
  }
  return body
}

/**
 * 一次请求的用量摘要，打到控制台（开发时核对缓存命中率用）。
 *
 * 命中率的口径与界面上的一致（见 cacheHitRate）：cacheRead / input。
 * 服务端没回报 usage（或只有本地估算）时打不出命中率，就明说，不假装是 0%——
 * 「没数据」与「全没命中」是两回事。
 */
function logUsageLine(
  provider: ResolvedProvider,
  model: string,
  usage: ChatUsage | undefined,
  ms: number,
): void {
  const head = `[AI] ${provider.label} · ${model}`
  const secs = (ms / 1000).toFixed(1) + 's'
  if (!usage || usage.estimated) {
    console.log(`${head} · 服务端未回报用量，命中率未知 · ${secs}`)
    return
  }
  const rate = cacheHitRate(usage)
  const pct = rate === null ? '—' : (rate * 100).toFixed(1) + '%'
  const tok = (n: number): string => n.toLocaleString('en-US')
  console.log(
    `${head} · 缓存命中 ${pct}（${tok(usage.cacheRead)} / ${tok(usage.input)} tok）` +
      (usage.cacheWrite > 0 ? ` · 写缓存 ${tok(usage.cacheWrite)} tok` : '') +
      ` · 输出 ${tok(usage.output)} tok · ${secs}`,
  )
}

/**
 * 流式 Chat 补全，支持 function calling，供 AI Agent 使用。
 * 通过 onDelta 增量抛出正文与思维链，返回累积后的完整结果。
 *
 * 按协议分派：OpenAI 兼容走 SSE，Command Code 走私有网关的 NDJSON。
 * 两者的实现互不干扰，调用方只看到统一的返回值。
 *
 * 每次请求成功返回后，把该次的缓存命中率打到控制台（见 logUsageLine）——
 * 前缀缓存是否真的生效，只能拿逐请求的数字对着看。
 */
export async function streamChatWith(
  provider: ResolvedProvider,
  model: string,
  opts: StreamChatOptions,
): Promise<StreamChatResult> {
  const dispatch = (): Promise<StreamChatResult> => {
    switch (provider.protocol) {
      case 'commandcode':
        return commandCodeStream(provider, model, opts)
      case 'anthropic':
        return anthropicStream(provider, model, opts)
      case 'responses':
        return responsesStream(provider, model, opts)
      default:
        return openAiStream(provider, model, opts)
    }
  }
  const startedAt = Date.now()
  const result = await dispatch()
  logUsageLine(provider, model, result.usage, Date.now() - startedAt)
  return result
}

async function openAiStream(
  provider: ResolvedProvider,
  model: string,
  opts: StreamChatOptions,
): Promise<StreamChatResult> {
  const url = endpoint(rootOf(provider.baseUrl), '/chat/completions')
  let res: Response
  try {
    // 经主进程转发（llm-proxy://），绕开浏览器跨域限制
    res = await httpFetch(url, {
      method: 'POST',
      headers: { ...headersFor(provider), Accept: 'text/event-stream' },
      body: JSON.stringify(bodyFor(provider, { ...opts, model, stream: true })),
      signal: opts.signal,
    })
  } catch (err) {
    if (opts.signal?.aborted) throw err
    throw new AiRequestError(t('网络请求失败，请检查网络连接'))
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new AiRequestError(toMessage(provider.label, res.status, body))
  }
  if (!res.body) throw new AiRequestError(t('服务未返回数据流'))

  // SSE 空闲超时：连接中途断开时 reader.read() 可能一直挂着不返回，
  // 而不是抛错；旧代码会因此永远卡在「思考中」。这里给每个数据块设上限，
  // 超时就取消并报错，把「异常终止」变成用户能看到的明确失败。
  const IDLE_TIMEOUT_MS = 90_000
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  let finishReason: string | null = null
  const toolCalls = new Map<number, ChatToolCall>()
  /** 用量的原始帧：字段名各家不一，收完再统一翻译 */
  let usageFrame: Record<string, unknown> | null = null
  const onAbort = () => void reader.cancel().catch(() => {})
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  let idle: ReturnType<typeof setTimeout> | null = null

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return
    let json: {
      choices?: Array<{
        delta?: {
          content?: string
          /** DeepSeek / 硅基流动 / 智谱等 */
          reasoning_content?: string
          /** OpenRouter 等网关 */
          reasoning?: string
          tool_calls?: Array<{
            index?: number
            id?: string
            function?: { name?: string; arguments?: string }
          }>
        }
        finish_reason?: string | null
      }>
      /** include_usage 声明的用量帧（另有一家把它塞在 choices 里） */
      usage?: Record<string, unknown>
    }
    try {
      json = JSON.parse(data)
    } catch {
      return
    }
    if (json.usage) usageFrame = json.usage
    const choice = json.choices?.[0]
    if (!choice) return
    const delta = choice.delta ?? {}
    // 思维链字段各家命名不一，取到哪个算哪个
    const thinking = delta.reasoning_content ?? delta.reasoning
    if (thinking) {
      reasoning += thinking
      opts.onDelta?.({ reasoning: thinking })
    }
    if (delta.content) {
      content += delta.content
      opts.onDelta?.({ content: delta.content })
    }
    for (const tc of delta.tool_calls ?? []) {
      const idx = tc.index ?? 0
      const cur = toolCalls.get(idx) ?? { id: '', name: '', arguments: '' }
      if (tc.id) cur.id = tc.id
      if (tc.function?.name) cur.name += tc.function.name
      if (tc.function?.arguments) cur.arguments += tc.function.arguments
      toolCalls.set(idx, cur)
    }
    if (choice.finish_reason) finishReason = choice.finish_reason
  }

  try {
    for (;;) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          idle = setTimeout(() => reject(new AiRequestError(t('响应超时，连接可能已中断'))), IDLE_TIMEOUT_MS)
        }),
      ])
      if (idle) {
        clearTimeout(idle)
        idle = null
      }
      const { done, value } = chunk
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) handleLine(line)
    }
  } catch (err) {
    // 用户主动取消：向上抛原错误，由调用方按取消语义吞掉
    if (opts.signal?.aborted) throw err
    if (err instanceof AiRequestError) throw new AiRequestError(t('{0}（已接收 {1} 字后就断了）', err.message, content.length))
    throw err
  } finally {
    if (idle) clearTimeout(idle)
    opts.signal?.removeEventListener('abort', onAbort)
  }
  if (buffer) handleLine(buffer)

  return {
    content,
    reasoning,
    toolCalls: [...toolCalls.values()],
    finishReason,
    usage: usageFrame ? translateUsage(usageFrame) : undefined,
  }
}

/**
 * 一次性 Chat 补全（stream: false），供生成描述、短释义等场景使用。
 * 与流式补全共用同一套鉴权、错误翻译与取消语义。
 *
 * Command Code 网关只有流式（`stream: true` 是信封里的固定字段），
 * 因此那里退化成「跑一次流式、只取正文」——对调用方完全无感。
 */
export async function chatCompleteWith(
  provider: ResolvedProvider,
  model: string,
  opts: {
    messages: ChatMessage[]
    maxTokens?: number
    temperature?: number
    /** 思考等级；不传就不发该字段 */
    reasoningEffort?: ReasoningEffort
    /** 要求返回严格 JSON（response_format: json_object）；网关不支持时忽略 */
    json?: boolean
    signal?: AbortSignal
  },
): Promise<string> {
  if (provider.protocol === 'commandcode') {
    const result = await commandCodeStream(provider, model, opts)
    return result.content
  }
  if (provider.protocol === 'anthropic') {
    const result = await anthropicStream(provider, model, opts)
    return result.content
  }
  if (provider.protocol === 'responses') {
    const result = await responsesStream(provider, model, opts)
    return result.content
  }
  const url = endpoint(rootOf(provider.baseUrl), '/chat/completions')
  let res: Response
  try {
    res = await httpFetch(url, {
      method: 'POST',
      headers: headersFor(provider),
      body: JSON.stringify(bodyFor(provider, { ...opts, model, stream: false })),
      signal: opts.signal,
    })
  } catch (err) {
    if (opts.signal?.aborted) throw err // 正常取消，交由调用方吞掉
    throw new AiRequestError(t('网络请求失败，请检查网络连接'))
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new AiRequestError(toMessage(provider.label, res.status, body))
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return data.choices?.[0]?.message?.content ?? ''
}

/**
 * 拉取账户可用的模型列表，返回模型 id 数组。
 * 少数服务不实现该端点（返回 404），此时由调用方提示用户手填模型名。
 *
 * 两处按提供商走不同路径：
 * - 端点路径可取 modelsPath（Command Code 的目录在免鉴权的 /provider/v1/models）；
 * - goPlanOnly 时按 Go 套餐筛选——目录会给全部模型，而套餐外的选了会被网关拒绝。
 */
export async function listModelsWith(provider: ResolvedProvider): Promise<string[]> {
  const url = endpoint(rootOf(provider.baseUrl), provider.modelsPath ?? '/models')
  let res: Response
  try {
    res = await httpFetch(url, {
      headers: headersFor(provider),
    })
  } catch {
    throw new AiRequestError(t('网络请求失败，请检查网络连接'))
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new AiRequestError(toMessage(provider.label, res.status, body))
  }
  const data = (await res.json()) as { data?: Array<{ id?: string }> }
  return (data.data ?? [])
    .map((m) => m.id ?? '')
    .filter(Boolean)
    .filter((id) => !provider.goPlanOnly || isGoPlanModel(id))
    .sort()
}
