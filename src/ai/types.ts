/**
 * AI 层的公共契约：对话消息、工具声明、流式结果。
 *
 * 这里刻意只描述「OpenAI 兼容」的线格式，不绑定任何一家服务商——
 * 所有提供商（DeepSeek / OpenAI / Kimi / GLM / 通义 / 自定义…）都经由
 * ai/client 适配到这套结构，Agent 运行时与学习领域只认识这些类型。
 * 这样新增一个提供商不需要改动 runtime、tools 与业务代码。
 */

/** 请求失败（含网络与 HTTP 错误），调用方按此区分「可提示给用户的错误」与其它异常 */
export class AiRequestError extends Error {}

/**
 * 线上协议（= 兼容格式）。这是接入维度的核心取值：
 *
 * - `openai`    —— OpenAI Chat Completions 兼容：
 *                  POST {base}/chat/completions、`messages`、`tool_calls`、SSE `data:`
 * - `anthropic` —— Anthropic Messages 兼容：
 *                  POST {base}/v1/messages、顶层 `system`、`content` 块、
 *                  `tool_use` / `tool_result`、SSE 命名事件
 * - `responses` —— OpenAI Responses 兼容：
 *                  POST {base}/responses、`input` 项数组、`function_call` /
 *                  `function_call_output`、SSE 命名事件
 * - `commandcode` —— Command Code Go 套餐的私有网关（见 ai/commandcode.ts）
 *
 * 前三种是「用户新建自定义提供商时要选的兼容格式」；commandcode 只属于内置的
 * Command Code Go，不让用户选。
 */
export type ProviderProtocol = 'openai' | 'anthropic' | 'responses' | 'commandcode'

/** 自定义提供商可选的兼容格式（顺序即 UI 展示顺序） */
export const COMPAT_PROTOCOLS: ProviderProtocol[] = ['openai', 'anthropic', 'responses']

/**
 * 兼容格式的展示信息。
 *
 * 与内置提供商预设一样，这也是**预设**：`form` 声明选它之后要填哪些字段。
 * 三种格式的差异不只是端点，还体现在字段上——例如 Anthropic 要版本号、
 * Anthropic 有直连浏览器的安全警示、Responses 的地址写法与 chat 不同。
 */
export interface CompatPreset {
  label: string
  note: string
  /** 选它时预填的地址 */
  defaultBaseUrl: string
  /** 对话端点路径（展示「实际请求」用） */
  chatPath: string
  /** 鉴权方式说明 */
  authHint: string
  /** 表单字段 */
  form: CompatFormField[]
}

/** 兼容格式预设里的字段（key 对应 ProviderConfig 的键） */
export interface CompatFormField {
  key: 'apiKey' | 'baseUrl' | 'apiVersion' | 'extraHeaders'
  label: string
  kind: 'text' | 'password' | 'textarea'
  optional?: boolean
  placeholder?: string
  hint?: string
  warning?: string
}

/** 自定义提供商共用的「额外请求头」字段 */
const headersField = (hint?: string): CompatFormField => ({
  key: 'extraHeaders',
  label: '额外请求头',
  kind: 'textarea',
  optional: true,
  placeholder: '{ "X-Custom-Header": "value" }',
  hint: hint ?? '选填，JSON 对象。部分网关要求 App 标识或版本号。',
})

export const COMPAT_META: Record<ProviderProtocol, CompatPreset> = {
  openai: {
    label: 'OpenAI 兼容',
    note: 'POST /chat/completions，最常见的格式，绝大多数服务与自建网关都是它',
    defaultBaseUrl: 'https://api.openai.com/v1',
    chatPath: '/chat/completions',
    authHint: 'Authorization: Bearer <Key>',
    form: [
      {
        key: 'apiKey',
        label: 'API Key',
        kind: 'password',
        placeholder: 'sk-…',
        hint: '仅保存在本机，请求由主进程直发该服务。',
      },
      {
        key: 'baseUrl',
        label: '接口地址',
        kind: 'text',
        hint: '该服务的根地址，通常到 /v1 为止。',
      },
      headersField(),
    ],
  },
  anthropic: {
    label: 'Anthropic 兼容',
    note: 'POST /v1/messages，Claude 官方格式；部分中转也提供这一路',
    defaultBaseUrl: 'https://api.anthropic.com',
    chatPath: '/v1/messages',
    authHint: 'x-api-key: <Key> + anthropic-version: 2023-06-01',
    form: [
      {
        key: 'apiKey',
        label: 'API Key',
        kind: 'password',
        placeholder: 'sk-ant-…',
        hint: 'Anthropic 用 x-api-key 而不是 Bearer，版本头由客户端自动带上。',
      },
      {
        key: 'baseUrl',
        label: '接口地址',
        kind: 'text',
        warning: 'Anthropic 官方默认不允许浏览器直连，本应用经主进程转发，因此可用；若走中转请填中转地址。',
        hint: '根地址即可，客户端会补 /v1/messages；填到 /v1 也可以。',
      },
      {
        key: 'apiVersion',
        label: 'API 版本',
        kind: 'text',
        optional: true,
        placeholder: '2023-06-01',
        hint: '留空用默认版本头 2023-06-01。中转要求特定版本时才需要改。',
      },
      headersField('选填，JSON 对象。部分中转需要额外的鉴权或标识头。'),
    ],
  },
  responses: {
    label: 'Responses 兼容',
    note: 'POST /responses，OpenAI 新一代接口；只有明确支持的服务才选',
    defaultBaseUrl: 'https://api.openai.com/v1',
    chatPath: '/responses',
    authHint: 'Authorization: Bearer <Key>',
    form: [
      {
        key: 'apiKey',
        label: 'API Key',
        kind: 'password',
        placeholder: 'sk-…',
        hint: '仅保存在本机，请求由主进程直发该服务。',
      },
      {
        key: 'baseUrl',
        label: '接口地址',
        kind: 'text',
        hint: '填到 /v1 为止，客户端会补 /responses。与 Chat Completions 是不同端点，别填错。',
      },
      {
        key: 'apiVersion',
        label: 'API 版本',
        kind: 'text',
        optional: true,
        placeholder: 'v1',
        hint: '选填。部分中转用 openai-beta 或版本查询参数区分接口。',
      },
      headersField('选填，JSON 对象。部分服务要 OpenAI-Beta 之类的头。'),
    ],
  },
  commandcode: {
    label: 'Command Code 网关',
    note: 'Go 套餐专用私有协议，仅内置提供商使用',
    defaultBaseUrl: 'https://api.commandcode.ai',
    chatPath: '/alpha/generate',
    authHint: '请求由主进程按 CLI 指纹发出（含 x-command-code-version）',
    form: [],
  },
}

export const compatLabel = (p: ProviderProtocol): string => COMPAT_META[p]?.label ?? p

/**
 * 一条消息的内容片段。
 *
 * 只有 user 消息可能带图（用户的提问里贴了一张图）；assistant 与 tool 一律是纯文本。
 * 这里刻意保持**协议中立**：图片只有 mime 与 base64，包成哪家的字段由
 * ai/content 的三个 toXxx 决定，历史里因此不绑任何一家。
 */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mime: string; data: string }

/** 消息内容：纯文本，或「文本 + 图片」的片段数组 */
export type ChatContent = string | ChatContentPart[] | null

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: ChatContent
  /** assistant 消息里的工具调用（回填历史时使用） */
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  /** role 为 tool 时对应的调用 id */
  tool_call_id?: string
}

/** OpenAI function calling 的工具声明 */
export interface ChatToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

/** 流式响应里累积出的工具调用 */
export interface ChatToolCall {
  id: string
  name: string
  /** 参数 JSON（可能分片到达，已拼接完整） */
  arguments: string
}
/**
 * 一次请求的 token 用量。
 *
 * 各家的字段名天差地别，适配器负责翻译成这一套：
 * - input：这次请求送进去的全部内容（含系统提示词、工具声明、历史）——
 *   它就是「当前上下文占用了多少」，也是圆环百分比要用的那个数；
 * - cacheRead：其中直接命中前缀缓存的部分（按 0.1 倍计价的那部分）；
 * - cacheWrite：这次写进缓存的部分（Anthropic 会单列，OpenAI 兼容协议没有这个概念）。
 * 命中率由 input 与 cacheRead 现算，不单独存，免得两者对不上。
 */
export interface ChatUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** true 表示是本地估算值（服务端没回 usage），界面上会标注 */
  estimated?: boolean
  /**
   * 本次请求的输出速度（tok/s），由运行时测得：从**输出的第一个 chunk** 到
   * **最后一个 chunk** 的 wall-clock 时长除以输出 token 数。服务端不回这个数，
   * 它只在界面的实时状态条上出现；估算用量（estimated）也会带上——那本来就是约数。
   */
  tps?: number
}

/** 缓存命中率 0~1；没有输入就没有命中率可言，返回 null */
export function cacheHitRate(usage: { input: number; cacheRead: number }): number | null {
  if (!usage.input) return null
  return Math.min(1, Math.max(0, usage.cacheRead / usage.input))
}

/**
 * 按字符粗估 token：CJK 约 1 字 1 token，ASCII 约 4 字符 1 token。
 *
 * 导出给"硬上限"那一类场合用（对话标题不超过 10 token，见 learn/title）：
 * 那边要的是**不超**，粗估宁可偏大也不能偏小，所以口径与 estimateUsage 保持一致。
 */
export function countTokens(text: string): number {
  let cjk = 0
  for (const ch of text) if ((ch.codePointAt(0) ?? 0) > 0x2e7f) cjk++
  const ascii = text.length - cjk
  return Math.ceil(cjk + ascii / 4)
}

/** 一张图在本地估算里折算的 token 数（各家按分辨率计价，取个中位数量级） */
const IMAGE_TOKEN_GUESS = 1100

/** 估算用：把图片摘掉，只留文字（图片另按张数折算） */
const estimateText = (content: ChatContent): string => {
  if (typeof content === 'string') return content
  if (!content) return ''
  return content.map((p) => (p.type === 'text' ? p.text : '[图片]')).join('')
}

const imageCount = (content: ChatContent): number =>
  Array.isArray(content) ? content.filter((p) => p.type === 'image').length : 0

/**
 * 服务端没回 usage 时的兜底估算（Command Code 网关、个别中转）。
 * 只用于显示，且标记 estimated，免得被当成准确值。
 */
export function estimateUsage(
  messages: ChatMessage[],
  tools: ChatToolDef[] | undefined,
  output: string,
): ChatUsage {
  /**
   * 估算时先把图片的 base64 摘掉：它有几百万字符，按字符折算会得出一个
   * 「一眼就知道不对」的天文数字（一张 1MB 的图 ≈ 25 万 token）。
   * 各家的图片计价按分辨率走，量级在几百到一千多 token，这里给一个固定的粗值。
   */
  const textOnly = messages.map((m) => ({ ...m, content: estimateText(m.content) }))
  const input = countTokens(
    JSON.stringify(textOnly) + (tools?.length ? JSON.stringify(tools) : ''),
  ) + messages.reduce((sum, m) => sum + imageCount(m.content) * IMAGE_TOKEN_GUESS, 0)
  return { input, output: countTokens(output), cacheRead: 0, cacheWrite: 0, estimated: true }
}

export interface StreamChatResult {
  content: string
  reasoning: string
  toolCalls: ChatToolCall[]
  finishReason: string | null
  /** 服务端这次报的用量；没有就是 undefined（调用方可退化成估算） */
  usage?: ChatUsage
}

/**
 * 思考等级。四档，是当下两家主流档位制的**并集**：
 * 国产系（DeepSeek / GLM）只有 low / high / max，OpenAI 系只有 low / medium / high——
 * 四档对每一边都只差一档，映射损耗最小（各家怎么映射见 EffortMap 与 providers 的预设）。
 * - low    快，短问答与批注
 * - medium 平衡，日常讲解
 * - high   深，教学与出卷
 * - max    最深，复杂推导与代码合成
 *
 * 各家字段名不同（OpenAI 兼容是 reasoning_effort，Command Code 网关也是），
 * 无法识别的服务会忽略它——由 client 按协议决定怎么发。
 */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'max'

/** 全部档位，按由浅到深排列（UI 直接用它渲染） */
export const REASONING_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high', 'max']

export const REASONING_LABEL: Record<ReasoningEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  max: 'Max',
}

/** 每档配一句人话，避免用户不知道该选哪个（UI 展示用） */
export const REASONING_HINT: Record<ReasoningEffort, string> = {
  low: '快，短问答与批注',
  medium: '平衡，日常讲解',
  high: '深，教学与出卷',
  max: '最深，复杂推导与代码',
}

/**
 * 每档的荧光色，**由低到高 = 荧光绿 / 荧光黄 / 荧光紫 / 荧光红**：
 * 滑条整条用它当底色，不看文字也能一眼认出「现在开到了多深」——
 * 绿是「轻」，红是「重」。
 */
export const REASONING_NEON: Record<ReasoningEffort, string> = {
  low: '#39ff14',
  medium: '#ffe814',
  high: '#c04bff',
  max: '#ff2d55',
}

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'high'

/** 兜底校验：非法值一律回落到默认档 */
export const asReasoningEffort = (v: unknown): ReasoningEffort =>
  REASONING_EFFORTS.includes(v as ReasoningEffort) ? (v as ReasoningEffort) : DEFAULT_REASONING_EFFORT

/**
 * 中立档位 → 该端点实际发的值。键是四档；值：
 * - 'omit'：这一档**不发任何思考字段**（端点不认、或想让模型用自己的默认）；
 * - 其他字符串：原样作为该端点的档位值发出去（OpenAI 兼容发进 reasoning_effort，
 *   Responses 发进 reasoning.effort；比如 Grok 的 'xhigh'）。
 *
 * 没给的档回落协议默认（见各协议模块）；级联顺序：模型 → 提供商 → 内置预设 → 协议默认。
 * 这张表只挂在「配置」上（ProviderConfig / ModelEntry / ProviderPreset），
 * 运行时合成进 ResolvedProvider.effortMap（见 ai/settings 的 resolveProvider）。
 */
export type EffortMap = { [K in ReasoningEffort]?: string }

/** 一次流式补全的入参：提供商信息由 client 注入，这里只描述「说什么」 */
export interface StreamChatOptions {
  messages: ChatMessage[]
  tools?: ChatToolDef[]
  temperature?: number
  maxTokens?: number
  /** 思考等级；不传就不发该字段 */
  reasoningEffort?: ReasoningEffort
  signal?: AbortSignal
  onDelta?: (d: { content?: string; reasoning?: string }) => void
}

/** 与 StreamChatOptions 同构，流式补全函数的签名（测试可注入替身） */
export type StreamFn = (opts: StreamChatOptions) => Promise<StreamChatResult>