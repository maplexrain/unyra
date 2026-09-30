/**
 * Command Code Go 套餐的线上协议。
 *
 * 为什么单独一套：Command Code 把订阅分成两种，只有 Provider API 是标准
 * OpenAI 兼容端点；**Go 套餐没有该权限**，调标准端点会返回
 * `403 upgrade_required`，因此 Go 的每一次请求都必须走 CLI 私有网关
 * `POST {baseUrl}/alpha/generate`。它和 OpenAI 协议的差异是全方位的：
 *
 * | 维度 | OpenAI 兼容 | Command Code 网关 |
 * | --- | --- | --- |
 * | 端点 | `/chat/completions` | `/alpha/generate` |
 * | 请求体 | 扁平 | 信封：`config` / `memory` / `taste` / `skills` /
 *   |      |          | `permissionMode` / `params` |
 * | 系统提示词 | messages 里的一条 | `params.system` 字符串 |
 * | 工具声明 | `{type:'function',function:{name,parameters}}` | `{type:'function',name,input_schema}` |
 * | 工具调用 | `tool_calls[]` + `tool_call_id` | `{type:'tool-call',toolCallId,toolName,input}` |
 * | 工具结果 | role:'tool' 一条 | `{type:'tool-result',toolCallId,toolName,output}` |
 * | 流式 | SSE `data:` 帧 | NDJSON，每行一个裸 JSON 对象 |
 * | 终态 | `finish_reason` | `finish-step` / `finish` 事件 |
 *
 * 因此这里不做「转换成一个 OpenAI 客户端」的抽象——那会把两套协议都拧巴。
 * 它只做一件事：把 ai/types 的公共契约翻译成网关信封，再把事件流翻译回来。
 * 参考实现：https://github.com/Ajwyunsx/dsh-cmdgo-provider（非官方）。
 *
 * 关于「官方限制接入方式」：网关按请求指纹识别客户端，这里对齐官方 cmd CLI
 * 的头部（版本号、环境、会话 id、项目 slug）。浏览器无法改写 User-Agent，
 * 该头部由浏览器自行发出；其余指纹照发。
 */

import { endpoint } from './providers'
import { httpFetch } from './http'
import { AiRequestError } from './types'
import { plainText, toCcParts } from './content'
import type { CcImagePart } from './content'
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

/**
 * 对齐官方 CLI 的版本号。网关会拿它与 User-Agent 里的版本比对，
 * 因此两者必须同步——升级时一起改。
 */
export const CC_VERSION = '1.31.0'

/**
 * 网关侧的单轮输出上限。官方 CLI 与参考实现都用这个值；
 * 传更大的值会被网关拒绝，因此 runtime 的 128K 默认值在这里要被压回来。
 */
export const CC_MAX_TOKENS = 64_000

/** 项目 slug：官方 CLI 由工作目录名推导，这里用一个稳定的自报名。 */
const PROJECT_SLUG = 'moji-notes'

/* ---------- 请求序列化 ---------- */

/** 助手消息里的工具调用块 */
interface CcToolCall {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  input: unknown
}

/** 工具结果块 */
interface CcToolResult {
  type: 'tool-result'
  toolCallId: string
  toolName: string
  output: { type: 'text' | 'error-text'; value: string }
}

/** user 消息里的块：只有文字时就退回裸字符串（网关的常规形态） */
type CcUserPart = { type: 'text'; text: string } | CcImagePart

type CcMessage =
  | { role: 'user'; content: string | CcUserPart[] }
  | { role: 'assistant'; content: Array<{ type: 'text'; text: string } | CcToolCall> }
  | { role: 'tool'; content: CcToolResult[] }

interface CcTool {
  type: 'function'
  name: string
  description?: string
  input_schema: unknown
}

interface CcEnvelope {
  config: {
    workingDir: string
    date: string
    environment: string
    structure: unknown[]
    isGitRepo: boolean
    currentBranch: string
    mainBranch: string
    gitStatus: string
    recentCommits: unknown[]
  }
  memory: string
  taste: string
  skills: null
  permissionMode: string
  params: {
    model: string
    messages: CcMessage[]
    tools: CcTool[]
    system: string
    max_tokens: number
    stream: true
    temperature?: number
    /** 网关只认 low / medium / high / xhigh / max（不含 minimal） */
    reasoning_effort?: ReasoningEffort
  }
}

/** 工具参数回填：assistant 历史里存的是 JSON 字符串，网关要的是对象 */
function parseToolInput(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/**
 * 网关运行的平台标识。官方 CLI 发的是 `<os>-<arch>`（如 linux-x64），
 * 浏览器没有等价 API，这里从 userAgent 粗推一个同形状的值。
 */
function environmentString(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const os = /Windows/i.test(ua)
    ? 'win32'
    : /Macintosh|Mac OS X/i.test(ua)
      ? 'darwin'
      : /Android/i.test(ua)
        ? 'android'
        : /Linux/i.test(ua)
          ? 'linux'
          : 'unknown'
  const arch = /arm64|aarch64/i.test(ua) ? 'arm64' : 'x64'
  return `${os}-${arch}`
}

/**
 * 把公共契约的消息列表翻译成网关信封。
 *
 * 两个必须照做的细节（否则网关直接报错）：
 * 1. **孤儿工具调用要丢掉**：assistant 声明了 tool-call 却没有对应的工具结果
 *    时，网关返回 `Tool result is missing for tool call …` 并中断整轮。
 *    历史被截断或工具执行被打断时很容易出现这种孤儿，宁可丢掉它。
 * 2. **工具结果不能为空文本**：`output.value` 为空串会被当成缺失，
 *    因此统一兜一个 `(no output)`。
 *
 * 另外 runtime 发来的 assistant 历史是 `tool_calls[]` 形态（OpenAI 方言），
 * 这里要还原成网关的 `content` 块数组；`messages` 里的 text 块则只取 content。
 */
export function buildEnvelope(opts: {
  messages: ChatMessage[]
  tools?: ChatToolDef[]
  model: string
  maxTokens?: number
  temperature?: number
  reasoningEffort?: ReasoningEffort
}): CcEnvelope {
  const parts: string[] = []
  const messages: CcMessage[] = []

  // 先收集全部工具结果 id，供 assistant 过滤孤儿调用
  const resultIds = new Set<string>()
  for (const m of opts.messages) {
    if (m.role === 'tool' && m.tool_call_id) resultIds.add(m.tool_call_id)
  }

  for (const m of opts.messages) {
    if (m.role === 'system') {
      const sys = plainText(m.content)
      if (sys) parts.push(sys)
      continue
    }
    if (m.role === 'assistant') {
      const content: Extract<CcMessage, { role: 'assistant' }>['content'] = []
      const text = plainText(m.content)
      if (text) content.push({ type: 'text', text })
      for (const call of m.tool_calls ?? []) {
        // 没有对应结果的调用直接跳过（见上）
        if (!resultIds.has(call.id)) continue
        content.push({
          type: 'tool-call',
          toolCallId: call.id,
          toolName: call.function.name,
          input: parseToolInput(call.function.arguments),
        })
      }
      // 整条只剩被丢掉的孤儿调用时，空 assistant 消息同样会被网关拒绝
      if (content.length) messages.push({ role: 'assistant', content })
      continue
    }
    if (m.role === 'tool') {
      const id = m.tool_call_id ?? ''
      const text = plainText(m.content)
      // 连续的工具结果并成一条 tool 消息
      const last = messages[messages.length - 1]
      const block: CcToolResult = {
        type: 'tool-result',
        toolCallId: id,
        toolName: 'unknown',
        output: { type: 'text', value: text || '(no output)' },
      }
      if (last && last.role === 'tool') last.content.push(block)
      else messages.push({ role: 'tool', content: [block] })
      continue
    }
    // user：可能带图。网关收 [text, image] 块数组，图片是裸 data URL（见 ai/content）
    messages.push({ role: 'user', content: toCcParts(m.content) })
  }

  // 空消息列表会让整轮塌陷，兜一条占位
  if (!messages.length) messages.push({ role: 'user', content: '' })

  const tools: CcTool[] = (opts.tools ?? []).map((t) => ({
    type: 'function',
    name: t.function.name,
    ...(t.function.description ? { description: t.function.description } : {}),
    input_schema: t.function.parameters,
  }))

  const params: CcEnvelope['params'] = {
    model: opts.model,
    messages,
    tools,
    system: parts.join('\n\n'),
    // 网关侧上限就是 CC_MAX_TOKENS，超出会被拒，因此这里压回而不是透传
    max_tokens: Math.min(opts.maxTokens ?? CC_MAX_TOKENS, CC_MAX_TOKENS),
    stream: true,
  }
  if (opts.temperature !== undefined) params.temperature = opts.temperature
  if (opts.reasoningEffort !== undefined) params.reasoning_effort = opts.reasoningEffort

  return {
    config: {
      // 浏览器没有工作目录概念；官方 CLI 发的是 cwd，这里报项目名即可
      workingDir: PROJECT_SLUG,
      date: new Date().toISOString().slice(0, 10),
      environment: environmentString(),
      structure: [],
      isGitRepo: false,
      currentBranch: '',
      mainBranch: '',
      gitStatus: '',
      recentCommits: [],
    },
    memory: '',
    taste: '',
    skills: null,
    permissionMode: 'standard',
    params,
  }
}

/* ---------- 请求头 ---------- */

/**
 * CLI 形状的会话 id：`cli-<YYYY-MM-DDTHH-mm-ss>`。
 * 官方 CLI 每个进程一个，这里每个页面一个（模块级生成一次）。
 */
const SESSION_ID = `cli-${new Date().toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '-')}`

/**
 * 请求指纹：与官方 cmd CLI 对齐，网关据此判定流量来自 CLI。
 *
 * 注意 `user-agent` 在浏览器里是禁止改写的头，写了也会被忽略——
 * 保留它是为了在经代理转发时仍然带上正确指纹。
 */
export function gatewayHeaders(apiKey: string, extra?: Record<string, string>): Record<string, string> {
  return {
    'content-type': 'application/json',
    'user-agent': `commandcode/${CC_VERSION}`,
    'x-command-code-version': CC_VERSION,
    'x-cli-environment': 'production',
    'x-taste-learning': 'false',
    'x-session-id': SESSION_ID,
    'x-project-slug': PROJECT_SLUG,
    authorization: `Bearer ${apiKey.trim()}`,
    ...extra,
  }
}

/* ---------- 事件流 ---------- */

export interface CcEvent {
  type: string
  [key: string]: unknown
}

/** 一行 NDJSON → 事件；空行、注释行与非对象一律忽略 */
function parseLine(line: string): CcEvent | undefined {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith(':')) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return undefined
  }
  return isRecord(parsed) && typeof parsed.type === 'string' ? (parsed as CcEvent) : undefined
}

/**
 * 把网关的 NDJSON 字节流切成事件。
 * 与 SSE 不同，这里没有 `data:` 前缀，每行就是一个裸 JSON 对象。
 */
export function parseEventStream(body: ReadableStream<Uint8Array>): ReadableStream<CcEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  return new ReadableStream<CcEvent>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read()
        buffer += done ? '' : decoder.decode(value, { stream: true })
        let newline = buffer.indexOf('\n')
        while (newline !== -1) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          const event = parseLine(line)
          if (event) controller.enqueue(event)
          newline = buffer.indexOf('\n')
        }
        if (done) {
          const tail = parseLine(buffer)
          if (tail) controller.enqueue(tail)
          buffer = ''
          controller.close()
          return
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}

/** 从 error / abort 事件里挖出人可读的原因（网关有几种嵌套写法） */
export function streamErrorText(event: CcEvent): string | undefined {
  const direct = event.errorText ?? event.message
  if (typeof direct === 'string' && direct) return direct
  const nested = event.error
  if (typeof nested === 'string' && nested) return nested
  if (isRecord(nested)) {
    for (const key of ['message', 'errorText', 'detail']) {
      const v = nested[key]
      if (typeof v === 'string' && v) return v
    }
    const deeper = nested.error
    if (isRecord(deeper) && typeof deeper.message === 'string' && deeper.message) return deeper.message
  }
  return undefined
}

/** 网关的 finish_reason 词汇表 → runtime 认识的 OpenAI 词汇 */
function mapFinishReason(raw: unknown): string {
  const reason = typeof raw === 'string' ? raw : 'stop'
  switch (reason) {
    case 'end_turn':
      return 'stop'
    case 'tool-calls':
      return 'tool_calls'
    case 'max_tokens':
    case 'max-output-tokens':
      return 'length'
    default:
      return reason
  }
}

/* ---------- 用量翻译 ---------- */

/**
 * 网关的用量帧（finish-step.usage 是单步的，finish.totalUsage 是整条流的合计）。
 *
 * 字段是 camelCase 的自报形态，另带一份 OpenAI 方言的 `raw`（部分路由的透传）：
 *
 *   { "inputTokens": 13457,
 *     "inputTokenDetails": { "noCacheTokens": 273, "cacheReadTokens": 13184 },
 *     "outputTokens": 564, "totalTokens": 14021,
 *     "cachedInputTokens": 13184,
 *     "raw": { "prompt_tokens": 13457, "prompt_cache_hit_tokens": 13184, … } }
 *
 * inputTokens 是**完整**的输入量（noCache + cacheRead），与 ChatUsage 的约定一致：
 * 圆环用它算占用，命中率另用 cacheRead/input 现算。网关不回 cacheWrite（按流
 * 写缓存的计费它没有暴露），按 0 处理。
 */
export function ccUsage(value: unknown): ChatUsage | undefined {
  if (!isRecord(value)) return undefined
  const details = isRecord(value.inputTokenDetails) ? value.inputTokenDetails : {}
  const raw = isRecord(value.raw) ? value.raw : {}
  const rawPromptDetails = isRecord(raw.prompt_tokens_details) ? raw.prompt_tokens_details : {}
  const input = num(value.inputTokens) || num(raw.prompt_tokens)
  const output = num(value.outputTokens) || num(raw.completion_tokens)
  // 字段一个都没有就别造一条全 0 的账出来
  if (!input && !output) return undefined
  const cacheRead =
    num(details.cacheReadTokens) ||
    num(value.cachedInputTokens) ||
    num(raw.prompt_cache_hit_tokens) ||
    num(rawPromptDetails.cached_tokens)
  return { input, output, cacheRead, cacheWrite: 0 }
}

/**
 * 流式调用网关（POST {baseUrl}/alpha/generate）。
 * 与 OpenAI 客户端同签名语义：增量回调 + 返回累积结果，错误一律是 AiRequestError。
 */
export async function commandCodeStream(
  provider: { baseUrl: string; apiKey: string; extraHeaders?: Record<string, string> },
  model: string,
  opts: StreamChatOptions,
): Promise<StreamChatResult> {
  const url = endpoint(provider.baseUrl.trim().replace(/\/+$/, ''), '/alpha/generate')
  const body = buildEnvelope({
    messages: opts.messages,
    tools: opts.tools,
    model,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
  })

  let res: Response
  try {
    // 经主进程转发（llm-proxy://）：版本门禁要求的 x-command-code-version 由我们发出，
    // Node 侧没有「禁止改写的请求头」与跨域预检的限制，因此这里不会再被浏览器拦下。
    res = await httpFetch(url, {
      method: 'POST',
      headers: gatewayHeaders(provider.apiKey, provider.extraHeaders),
      body: JSON.stringify(body),
      signal: opts.signal,
    })
  } catch (err) {
    if (opts.signal?.aborted) throw err
    throw new AiRequestError(
      '请求没能发出去。若刚启动应用，请稍等片刻重试；' +
        '若持续失败，请检查设置里的接口地址是否为合法地址（主进程只转发白名单内的主机）。',
    )
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => '')
    throw new AiRequestError(describeHttpError(res.status, raw, model))
  }
  if (!res.body) throw new AiRequestError('服务未返回数据流')

  const IDLE_TIMEOUT_MS = 90_000
  const reader = parseEventStream(res.body).getReader()
  const onAbort = () => void reader.cancel().catch(() => {})
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  let idle: ReturnType<typeof setTimeout> | null = null

  let content = ''
  let reasoning = ''
  let finishReason: string | null = null
  let sawTerminal = false
  let eventCount = 0
  /** 网关报回的用量；finish.totalUsage 是整条流的合计，优先于各 step 的单步账 */
  let usage: ChatUsage | undefined
  const toolCalls: ChatToolCall[] = []

  const handle = (event: CcEvent) => {
    eventCount++
    switch (event.type) {
      case 'text-delta': {
        const text = typeof event.text === 'string' ? event.text : ''
        if (text) {
          content += text
          opts.onDelta?.({ content: text })
        }
        break
      }
      case 'reasoning-delta': {
        const text = typeof event.text === 'string' ? event.text : ''
        if (text) {
          reasoning += text
          opts.onDelta?.({ reasoning: text })
        }
        break
      }
      case 'tool-call': {
        const input = event.input ?? event.args ?? event.arguments ?? {}
        const id =
          typeof event.toolCallId === 'string'
            ? event.toolCallId
            : typeof event.id === 'string'
              ? event.id
              : `call_${toolCalls.length}`
        const name = typeof event.toolName === 'string' ? event.toolName : ''
        toolCalls.push({ id, name, arguments: JSON.stringify(input ?? {}) })
        break
      }
      // finish-step 是每个 step 的终态，finish 是整条流的终态。
      // 正常情况两者都到，但某些路由/错误路径只会发 finish——只认第一个即可，
      // 否则一条完整的回答会因为缺 finish-step 被判成截断而整轮失败。
      case 'finish-step':
      case 'finish': {
        // 用量跟着各自的字段走：单步账在 finish-step.usage，合计在 finish.totalUsage；
        // finish 后到，覆盖掉单步账，剩下的就是整条流真正的账
        const frame = event.type === 'finish' ? (event.totalUsage ?? event.usage) : event.usage
        const parsed = ccUsage(frame)
        if (parsed) usage = parsed
        if (!sawTerminal) {
          sawTerminal = true
          finishReason = mapFinishReason(event.finishReason ?? event.rawFinishReason)
        }
        break
      }
      case 'error':
      case 'abort':
        // 终态错误由主循环统一抛出（见下），这里不提前中断，
        // 以便带上已累积的正文长度。
        break
      default:
        // text-start / reasoning-start / start-step 等不产出内容
        break
    }
  }

  /** 提取终态错误的原因；没有错就返回 null */
  const terminalError = (event: CcEvent): AiRequestError | null => {
    if (event.type === 'error') {
      const message = streamErrorText(event) ?? '网关返回了未知错误'
      return new AiRequestError(`Command Code 网关错误：${message}`)
    }
    if (event.type === 'abort') return new AiRequestError('Command Code 网关中止了本次流')
    return null
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
      const failure = terminalError(value)
      handle(value)
      // 先把已到的事件计入结果，再抛出终态错误——用户能看到收到的部分
      if (failure) throw failure
    }
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

  // 一条完整的回答必须有终态事件；否则是真截断，必须说出来而不是假装正常结束
  if (!sawTerminal) {
    throw new AiRequestError(
      `Command Code 流在收到 ${eventCount} 个事件后结束，没有 finish 标记（可能被截断）`,
    )
  }

  return { content, reasoning, toolCalls, finishReason, usage }
}

/** HTTP 层错误 → 用户能看懂的中文提示 */
export function describeHttpError(status: number, raw: string, model?: string): string {
  const suffix = model ? `（模型 ${model}）` : ''
  const detail = (() => {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string') {
        return parsed.error.message
      }
      if (isRecord(parsed) && typeof parsed.message === 'string') return parsed.message
    } catch {
      // 非 JSON，忽略
    }
    return ''
  })()

  if (status === 401) return 'API Key 无效或已过期，请重新登录 Command Code 后更新 Key'
  if (status === 403) {
    // 三种 403：套餐不含该模型、标准端点被拒、CLI 版本门禁。
    // 经主进程转发后版本头一定带上了，所以再撞到版本门禁通常意味着网关提高了最低版本。
    if (raw.includes('MODEL_NOT_IN_PLAN')) {
      return `当前 Go 套餐不包含该模型${suffix}，请换一个套餐内的开源模型`
    }
    if (raw.includes('upgrade_required')) {
      return `网关要求更高的 CLI 版本${suffix}：请把 src/ai/commandcode.ts 的 CC_VERSION 调到网关要求的值`
    }
    return `没有访问权限${suffix}${detail ? `：${detail}` : ''}`
  }
  if (status === 404) return '网关地址或模型名不存在，请检查提供商设置'
  if (status === 429) return '请求过于频繁或额度已用尽，请稍后再试'
  if (status === 400) return `请求参数被网关拒绝${suffix}${detail ? `：${detail}` : ''}`
  if (status >= 500) return 'Command Code 服务暂时不可用'
  return `请求失败（HTTP ${status}）${detail ? `：${detail}` : ''}`
}
