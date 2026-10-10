/**
 * 提供商（Provider）注册表 —— 只放**内置提供商**。
 *
 * 两层概念，别混：
 * 1. **内置 / 自定义**（谁提供这份配置）
 *    - 内置：本文件里的 PRESET，开箱即在列表里，用户只需填 Key、勾模型；
 *    - 自定义：用户点「创建」新建，必须选一种**兼容格式**并自己填地址。
 * 2. **兼容格式 / 协议**（线上怎么说）
 *    - openai / anthropic / responses 三种，自定义提供商从中选一个；
 *    - commandcode 是内置 Command Code Go 专用的私有网关，不对用户开放选择。
 *
 * 内置提供商里绝大多数是 openai 兼容，只有 Command Code Go 走私有协议。
 * 新增一家内置提供商＝往 PRESETS 加一条；新增一种协议＝加一个协议模块并让
 * client 的分派认它。两件事互不影响。
 */

import type { EffortMap, ProviderProtocol } from './types'

/** 输入模态。定义在这里而不是 settings，是为了让依赖保持单向（settings → providers） */
export type InputModality = 'text' | 'image' | 'audio'

/** 全部可声明的模态；text 是所有模型都有的基础能力 */
export const ALL_MODALITIES: InputModality[] = ['text', 'image', 'audio']

export const MODALITY_LABEL: Record<InputModality, string> = {
  text: '文本',
  image: '图像',
  audio: '音频',
}

/**
 * 请求体参数差异。大多数服务接受标准 OpenAI 字段，少数有硬性要求：
 * - tokenParam：新版 OpenAI 推理模型只认 max_completion_tokens，
 *   传 max_tokens 会直接 400。
 * - omitTemperature：个别模型只接受 temperature=1（或干脆不接受该字段），
 *   传了别的值会报错，此时索性不传、让服务端用默认值。
 * - omitReasoningEffort：该家完全不认 reasoning_effort 时打开。
 * - omitStreamUsage：默认会发 stream_options.include_usage 以拿到 token 用量，
 *   个别兼容实现遇到这个字段直接 400，此时关掉——代价是拿不到真实用量，
 *   界面会退化成估算值。
 */
export interface ProviderQuirks {
  tokenParam?: 'max_tokens' | 'max_completion_tokens'
  omitTemperature?: boolean
  omitReasoningEffort?: boolean
  omitStreamUsage?: boolean
}

/**
 * 表单字段：预设用声明的方式告诉界面「我要填哪些东西」。
 *
 * 这是「预设」这个概念的核心——不同提供商、不同兼容格式需要的配置并不一样，
 * 差异就体现在这里声明的字段上，表单照着渲染，而不是写死一套再靠 if 打补丁。
 */
export type PresetFieldKind = 'text' | 'password' | 'textarea' | 'number'

export interface PresetField {
  /** 写回 ProviderConfig 的哪个键 */
  key: PresetFieldKey
  label: string
  kind: PresetFieldKind
  /** 占位符；不写则用预设里的默认值 */
  placeholder?: string
  /** 字段下方的说明 */
  hint?: string
  /** 字段上方的警示条（如自定义地址的安全提醒） */
  warning?: string
  optional?: boolean
}

export type PresetFieldKey = 'apiKey' | 'baseUrl' | 'apiVersion' | 'extraHeaders' | 'maxTokens'

/**
 * 一条提供商预设。
 *
 * 预设只是**创建提供商时的模板**：它提供地址、端点、鉴权方式与表单字段。
 * 用户从预设创建出提供商之后，那条配置就完全归用户所有——
 * 改 Key、加删模型都不再受预设影响。
 *
 * 模型迭代迅速，不预设死固定的模型列表，配置后自动拉取提供商模型目录或由用户输入。
 */
export interface ProviderPreset {
  id: string
  /** 界面显示名 */
  label: string
  /** 一句话说明 */
  note: string
  /**
   * API 根地址。预设已内置，因此选预设时**不需要**渲染地址输入框。
   * 只有自定义提供商才要用户自己填。
   */
  baseUrl: string
  /** 是否支持工具调用（超级导师读写笔记、出题、阅卷都依赖它） */
  toolCalls: boolean
  /** 申请 Key 的控制台地址；没有就省略 */
  consoleUrl?: string
  quirks?: ProviderQuirks
  /**
   * 内置预设的思考档位映射（见 EffortMap）。给「官方档位制与协议默认对不上」
   * 的家兜底：DeepSeek / GLM 只有 low / high / max 没有 medium，官方又把 high
   * 定为平衡默认档，medium 就落到它。用户配置与模型级的同名键会覆盖这里
   * （级联合成在 ai/settings 的 resolveProvider）。
   */
  effortMap?: EffortMap
  /** 线上协议；省略即 'openai' */
  protocol?: ProviderProtocol
  /** 模型目录端点路径，省略即 '/models' */
  modelsPath?: string
  /** 单轮输出上限，省略即用运行时默认值 */
  maxTokens?: number
  /** API 版本默认值（预设声明了 apiVersion 字段时才有意义） */
  apiVersion?: string
  /** 额外的接入说明，展示在 Key 输入框下方 */
  setupHint?: string
  /** 鉴权方式的一句话说明，显示在 API Key 字段下方 */
  authHint?: string
  /** 端点路径（用于展示「实际请求」） */
  chatPath: string
  /**
   * 这个预设的表单字段。
   * 预设已内置地址，因此 form 里**不包含 baseUrl**——选了预设就不用填地址。
   */
  form: PresetField[]
}

/**
 * Command Code Go 网关地址。Go 套餐没有 Provider API 权限，
 * 调标准 OpenAI 兼容端点会返回 403 upgrade_required，只能走这个私有网关。
 */
export const COMMANDCODE_BASE_URL = 'https://api.commandcode.ai'

/* ---------- 表单字段的组装助手 ---------- */

/** API Key 字段（各家措辞与提示不同，所以由调用方给出） */
const keyField = (patch: Partial<PresetField> = {}): PresetField => ({
  key: 'apiKey',
  label: 'API Key',
  kind: 'password',
  placeholder: 'sk-…',
  ...patch,
})

/**
 * 预设提供商的表单：**只有 API Key**。
 * 地址与端点都由预设决定，选预设就不用填地址。
 */
const presetForm = (opts: { keyHint?: string; extra?: PresetField[] } = {}): PresetField[] => [
  keyField({ hint: opts.keyHint ?? '仅保存在本机，请求由主进程直发该服务。' }),
  ...(opts.extra ?? []),
]

/** 自定义提供商共用的「额外请求头」字段 */
const extraHeadersField = (): PresetField => ({
  key: 'extraHeaders',
  label: '额外请求头',
  kind: 'textarea',
  optional: true,
  placeholder: '{ "HTTP-Referer": "https://my-app.local" }',
  hint: '选填，JSON 对象。部分网关要求 App 标识或版本号。',
})

/**
 * Go 套餐目录入口（免鉴权，Go Key 在标准端点上本来也会被拒）。
 * 列表只给 id / name / context_length，因此套餐归属要在客户端自行筛选。
 */
export const COMMANDCODE_MODELS_PATH = '/provider/v1/models'

/**
 * Go 套餐包含哪些模型（镜像官方 plans/go 页与官方 CLI 的判定）。
 *
 * 规则：开源模型全含（deepseek、moonshotai、zai-org、MiniMaxAI、xiaomi、
 * Qwen、stepfun、tencent、nvidia、thinkingmachines、poolside），
 * 外加少数 premium 例外；其余 premium（Claude、其它 GPT、Gemini、
 * 部分 Grok / Muse Spark / Fugu）不在套餐内，选了会被网关拒绝。
 */
const GO_PREMIUM_EXCEPTIONS = new Set([
  'gpt-5.6-luna',
  'xai/grok-4.5',
  'meta/muse-spark-1.2-contributor',
])

/** 整条产品线都是 premium 的前缀，Go 套餐一律不含 */
const GO_PREMIUM_ONLY_PREFIXES = ['google/', 'sakana/', 'anthropic/']

/** 短名（斜杠之后）以这些品牌开头的模型同样视为 premium，防御上游目录变动 */
const GO_PREMIUM_BRANDS = ['claude-', 'gpt-', 'gemini-', 'grok-', 'fugu-', 'muse-spark-']

/** 该模型 id 是否属于 Go 套餐（false 时即使网关列出也用不了） */
export function isGoPlanModel(id: string): boolean {
  if (GO_PREMIUM_EXCEPTIONS.has(id)) return true
  if (GO_PREMIUM_ONLY_PREFIXES.some((p) => id.startsWith(p))) return false
  const slash = id.indexOf('/')
  const short = slash === -1 ? id : id.slice(slash + 1)
  return !GO_PREMIUM_BRANDS.some((brand) => short.startsWith(brand))
}

/**
 * 内置提供商预设（仅作为「创建提供商」时的模板）。
 *
 * 每条预设提供地址、端点、鉴权方式，并用 `form` 声明要填哪些字段。
 * 模型迭代迅速，不再内置硬编码的模型预设，填入 API 地址与 Key 后自动向提供商获取可用模型列表。
 */
export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    note: '中文与推理能力强，支持工具调用。',
    baseUrl: 'https://api.deepseek.com',
    toolCalls: true,
    effortMap: { medium: 'high' },
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    chatPath: '/chat/completions',
    authHint: 'Authorization: Bearer <Key>',
    form: presetForm({
      extra: [extraHeadersField()],
      keyHint: '到 platform.deepseek.com 创建；仅保存在本机。',
    }),
  },
  {
    id: 'moonshot',
    label: '月之暗面 Kimi',
    note: '长上下文见长，Kimi K2 系列支持工具调用。',
    baseUrl: 'https://api.moonshot.cn/v1',
    toolCalls: true,
    consoleUrl: 'https://platform.moonshot.cn/console/api-keys',
    chatPath: '/chat/completions',
    authHint: 'Authorization: Bearer <Key>',
    form: presetForm(),
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    note: 'GLM 系列，工具调用稳定，国内直连。',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    toolCalls: true,
    effortMap: { medium: 'high' },
    consoleUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    chatPath: '/chat/completions',
    authHint: 'Authorization: Bearer <Key>',
    form: presetForm(),
  },
  {
    id: 'dashscope',
    label: '阿里云百炼（通义千问）',
    note: '百炼平台的 OpenAI 兼容模式，Qwen 系列支持工具调用。',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    toolCalls: true,
    quirks: { omitReasoningEffort: true },
    consoleUrl: 'https://bailian.console.aliyun.com/',
    chatPath: '/chat/completions',
    authHint: 'Authorization: Bearer <Key>',
    form: presetForm(),
  },
  {
    id: 'volcengine',
    label: '火山方舟（豆包）',
    note: '字节跳动方舟平台，支持推理接入点与常用大模型。',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    toolCalls: true,
    consoleUrl: 'https://console.volcengine.com/ark',
    chatPath: '/chat/completions',
    authHint: 'Authorization: Bearer <Key>',
    form: presetForm(),
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    note: '托管多家开源大模型的聚合平台，性价比高。',
    baseUrl: 'https://api.siliconflow.cn/v1',
    toolCalls: true,
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
    chatPath: '/chat/completions',
    authHint: 'Authorization: Bearer <Key>',
    form: presetForm(),
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    note: '聚合网关，一个 Key 调用全球主流模型；模型名形如 vendor/model。',
    baseUrl: 'https://openrouter.ai/api/v1',
    toolCalls: true,
    consoleUrl: 'https://openrouter.ai/keys',
    chatPath: '/chat/completions',
    authHint: 'Authorization: Bearer <Key>',
    form: presetForm({
      keyHint: 'OpenRouter 用它做应用归因时可另填请求头，选填。',
      extra: [
        {
          key: 'extraHeaders',
          label: '应用标识请求头',
          kind: 'textarea',
          optional: true,
          placeholder: '{\n  "HTTP-Referer": "https://my-app.local",\n  "X-Title": "归一"\n}',
          hint: '选填，JSON 对象。',
        },
      ],
    }),
  },
  {
    id: 'openai',
    label: 'OpenAI 官方',
    note: 'GPT-4o、o1、o3 等官方模型，新版推理模型走 max_completion_tokens。',
    baseUrl: 'https://api.openai.com/v1',
    toolCalls: true,
    consoleUrl: 'https://platform.openai.com/api-keys',
    quirks: { tokenParam: 'max_completion_tokens' },
    chatPath: '/chat/completions',
    authHint: 'Authorization: Bearer <Key>',
    form: presetForm({
      extra: [
        {
          key: 'extraHeaders',
          label: '组织 / 项目请求头',
          kind: 'textarea',
          optional: true,
          placeholder: '{\n  "OpenAI-Organization": "org-xxxx",\n  "OpenAI-Project": "proj_xxxx"\n}',
          hint: '选填。属于组织或多项目时用来指定归属；JSON 对象。',
        },
      ],
    }),
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    note: 'Claude 系列模型官方 API，长文本与代码推理能力强。',
    baseUrl: 'https://api.anthropic.com',
    toolCalls: true,
    protocol: 'anthropic',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    chatPath: '/v1/messages',
    authHint: 'x-api-key: <Key> + anthropic-version: 2023-06-01',
    form: presetForm({
      keyHint: '到 console.anthropic.com 申请；仅保存在本机。',
    }),
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    note: 'Gemini 系列模型，走 Gemini 的 OpenAI 兼容端点。',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    toolCalls: true,
    consoleUrl: 'https://aistudio.google.com/apikey',
    chatPath: '/chat/completions',
    authHint: 'Authorization: Bearer <Key>（Google AI Studio 的 Key）',
    form: presetForm(),
  },
  {
    id: 'xai',
    label: 'xAI Grok',
    note: 'xAI Grok 系列，OpenAI 兼容协议。',
    baseUrl: 'https://api.x.ai/v1',
    toolCalls: true,
    consoleUrl: 'https://console.x.ai/',
    chatPath: '/chat/completions',
    authHint: 'Authorization: Bearer <Key>',
    form: presetForm(),
  },
  {
    id: 'ollama',
    label: 'Ollama 本地模型',
    note: '本地离线运行的开源模型服务，默认端口 11434。',
    baseUrl: 'http://localhost:11434/v1',
    toolCalls: true,
    chatPath: '/chat/completions',
    authHint: '本地通常无需 API Key（留空即可）',
    form: presetForm({
      keyHint: '本地运行默认留空；若配置了反代鉴权则在此填写。',
    }),
  },
  {
    id: 'commandcode',
    label: 'Command Code Go 套餐',
    note: 'Go 订阅专用：官方限制第三方接入，Go 套餐调标准端点会返回 403，必须走 CLI 私有网关。',
    baseUrl: COMMANDCODE_BASE_URL,
    toolCalls: true,
    consoleUrl: 'https://commandcode.ai/studio',
    protocol: 'commandcode',
    modelsPath: COMMANDCODE_MODELS_PATH,
    maxTokens: 64_000,
    setupHint: 'Go 套餐用官方 CLI 登录后得到的 Key（形如 user_…）。',
    chatPath: '/alpha/generate',
    authHint: '请求由主进程按 CLI 指纹发出（含 x-command-code-version）',
    form: presetForm({
      keyHint: 'Go 套餐的 Key 形如 user_…，由官方 CLI 登录后取得。',
      extra: [
        {
          key: 'maxTokens',
          label: '单轮输出上限',
          kind: 'number',
          optional: true,
          placeholder: '64000',
          hint: '网关硬上限是 64000，超过会被拒。留空即用 64000。',
        },
      ],
    }),
  },
]

/** 默认提供商：DeepSeek 官方（新用户建号时可选填它的 Key） */
export const DEFAULT_PROVIDER_ID = 'deepseek'

/** 预设的 id 集合：用于「这个 id 是否来自预设」的判断 */
export const BUILTIN_IDS: ReadonlySet<string> = new Set(PROVIDERS.map((p) => p.id))

/** 按 id 取预设 */
export const getPreset = (id: string): ProviderPreset | undefined =>
  PROVIDERS.find((p) => p.id === id)

/**
 * 取预设；自定义提供商没有预设，返回 undefined。
 * 不要在这里「造一个假的预设」——自定义的地址与协议会被悄悄覆盖掉。
 */
export const presetOf = getPreset

export function knownModelOf(_presetId: string, _modelId: string): undefined {
  return undefined
}

export const isBuiltinId = (id: string): boolean => BUILTIN_IDS.has(id)

export const firstKnownModelId = (_preset: ProviderPreset | undefined): string => ''

/**
 * 拼接端点地址：baseUrl 末尾的 `/` 去掉，再补上路径。
 * 这样用户粘贴带不带尾斜杠的地址都能用。
 */
export function endpoint(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return `${base}${path}`
}
