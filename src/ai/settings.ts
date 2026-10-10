/**
 * AI 设置：多提供商 × 每提供商多模型，外加一组「全局」选择。
 *
 * 为什么这样分：
 * - **提供商**是接入单位（一家服务、一把 Key、一个 baseUrl）；
 * - **模型**是它的成员，一家提供商可以配多个模型，随时切换；
 * - **全局提供商 / 全局模型 / 全局思考等级**是「当前默认用什么」，
 *   是所有 AI 功能的共同基底——超级导师、描述生成、短释义、出题阅卷，
 *   以及日后新加的 AI 小功能都从这里取默认值，不需要各自再配一遍。
 *
 * 存储结构（v3）：
 *   { version, providers: [{ id, label, baseUrl, apiKey, models: string[], extraHeaders }],
 *     global: { providerId, model, effort } }
 *
 * 兼容：老版本（v1 只有 apiKey/chatModel，v2 是 activeId + providers[].chatModel）
 * 都会在加载时迁移过来，用户的 Key 与自定义模型不会丢。
 *
 * 设置属于「用户级」：跟当前用户走，落在其 setting.yaml 的 ai 一片里
 * （见 lib/userSettings）。
 */

import {
  ALL_MODALITIES,
  DEFAULT_PROVIDER_ID,
  MODALITY_LABEL,
  PROVIDERS,
  presetOf,
  type InputModality,
} from './providers'
import {
  asReasoningEffort,
  COMPAT_PROTOCOLS,
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORTS,
  type EffortMap,
  type ProviderProtocol,
  type ReasoningEffort,
} from './types'
import { AiRequestError, type ResolvedProvider } from './client'
import { readUserSettings, settingsRevision, settingsUid, writeUserSettings } from '../lib/userSettings'

export { ALL_MODALITIES, MODALITY_LABEL }
export type { InputModality }

/** 一个模型条目：不只是模型名，还带请求与展示需要的元信息 */
export interface ModelEntry {
  /** 请求时发给服务端的模型 ID（如 deepseek-chat、claude-sonnet-4-5） */
  id: string
  /** 界面显示名；留空则直接用 id */
  name: string
  /** 上下文窗口（token）；0 表示未知 */
  contextWindow: number
  /** 支持的输入模态。目前只做能力声明与展示，图片仍按纯文本路径发送 */
  inputModalities: InputModality[]
  /**
   * 这个模型的思考档位映射（见 EffortMap）。聚合平台一个提供商下混着多家模型，
   * 各家认的档位不一样——映射就得能配到模型级；同名键覆盖提供商级的配置。
   */
  effortMap?: EffortMap
}

/**
 * 上下文窗口的快捷规格：填模型时一键填入，省得手敲数字。
 * 覆盖当前主流规格（128K / 256K / 1M / 2M）。
 */
export const CONTEXT_PRESETS: Array<{ label: string; value: number }> = [
  { label: '128K', value: 128_000 },
  { label: '256K', value: 256_000 },
  { label: '1M', value: 1_000_000 },
  { label: '2M', value: 2_000_000 },
]

/** 单个提供商的配置（内置与自定义共用这一份结构） */
export interface ProviderConfig {
  /** 内置提供商用预设的固定 id；自定义提供商为 'custom:<uuid>' */
  id: string
  /**
   * provider = 用内置预设；custom = 用户自己配的。
   *
   * 为什么要显式存这一位、而不靠 id 前缀推断：配置页里可以把「内置」就地改成
   * 「自定义」（改选自定义兼容格式）。这时若只认 id 前缀，这条配置仍会被当成
   * 内置，协议与地址又走回预设——用户改了等于没改。以显式字段为准，两种来源
   * 才不会再混。
   */
  kind: 'provider' | 'custom'
  /**
   * 兼容格式。自定义提供商必选其一；内置提供商留空，
   * 实际协议由预设决定（见 ai/providers 的 presetOf）。
   */
  compat?: ProviderProtocol
  /** 自定义提供商的显示名；内置提供商留空则显示预设名 */
  label: string
  /** API 根地址；内置提供商留空表示用预设的默认值 */
  baseUrl: string
  apiKey: string
  /** 该提供商下已配置的模型；第一个作为它的默认模型 */
  models: ModelEntry[]
  /**
   * API 版本。只有声明了该字段的预设才会用（如 Anthropic 的
   * anthropic-version）；留空则用协议默认值。
   */
  apiVersion?: string
  /**
   * 单轮输出上限。只有声明了该字段的预设才会用（如 Command Code 网关的硬上限）；
   * 留空则用预设默认值。
   */
  maxTokens?: number
  /** 额外请求头（部分网关要求 App 标识等） */
  extraHeaders?: Record<string, string>
  /**
   * 这家提供商的思考档位映射（见 EffortMap）。同名键覆盖内置预设的映射，
   * 又被模型级（ModelEntry.effortMap）覆盖——级联合成在 resolveProvider / resolveGlobal。
   */
  effortMap?: EffortMap
}

/** 全局默认：所有 AI 功能的共同起点 */
export interface GlobalSelection {
  /** 全局提供商 id */
  providerId: string
  /** 全局模型 ID；空串表示用该提供商的第一个模型 */
  model: string
  /**
   * 思考程度。**全局设置**，不绑提供商也不绑模型——
   * 它与模型列表同级，改一处即对所有 AI 功能生效。
   * 它就是输入框右下角那个滑条：只对聊天框发起的轮直接生效；工作流轮的档位
   * 独立（三态配置见 learn/workflows 的 resolveWorkflowEffort），配成「跟随聊天」
   * 的工作流才借用这个值。
   */
  effort: ReasoningEffort
}

export interface AiSettings {
  /** 存储格式版本：1 / 2（历史格式）/ 3（当前） */
  version?: number
  providers: ProviderConfig[]
  global: GlobalSelection
}

/** 当前存储格式版本 */
const VERSION = 3

/**
 * 老版本的默认模型名：**只在从旧版本迁移时**视为「用户从未自己选过」而丢弃。
 * 只收历史默认值——deepseek-reasoner 之类是用户主动选的，必须原样保留。
 *
 * 这里不能放当前仍在用的模型名，尤其不能放 deepseek-flash：它是建号时预置的
 * 默认模型，一旦进了这个集合就会被规范化顺手删掉。也正因如此，这套规则只能
 * 用在一次性迁移上，不能用在日常读写上（见 normalizeConfig 的 dropLegacyDefaults），
 * 否则用户手填的同名模型也会在保存的一瞬间消失。
 */
const LEGACY_DEFAULT_MODELS = new Set(['deepseek-v4-pro'])

/** 自定义提供商的 id 前缀 */
export const CUSTOM_PREFIX = 'custom:'

/** 这条配置是不是用户自建的（以内置的 kind 字段为准，不靠 id 前缀猜） */
export const isCustomConfig = (c: ProviderConfig): boolean => c.kind === 'custom'

/** id 是否形如自定义提供商（仅用于生成/识别 id 形态） */
export const isCustomId = (id: string): boolean => id.startsWith(CUSTOM_PREFIX)

/* ---------- 构造与规范化 ---------- */

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const cleanHeaders = (v: unknown): Record<string, string> | undefined => {
  if (!v || typeof v !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const key = k.trim()
    if (key && typeof val === 'string') out[key] = val
  }
  return Object.keys(out).length ? out : undefined
}

/** 造一个模型条目：缺的元信息给合理默认值 */
export function makeModelEntry(id: string, patch: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: id.trim(),
    name: '',
    contextWindow: 0,
    inputModalities: ['text'],
    ...patch,
  }
}

/**
 * 老版本把预设当成「已内置的提供商」，会直接出现 deepseek / moonshot 等条目。
 * 现在预设只是创建模板，因此这些老条目要转成**用户自己的提供商**：
 * 继承预设的地址与协议（记为 compat），名字也沿用预设名，
 * 这样用户原有的 Key 与模型照旧可用，而列表里不会再有「凭空出现」的提供商。
 *
 * 注意它只该对旧数据生效（enabled=false 时原样返回）：当前版本里
 * 「从预设创建提供商」本来就会写出一条 id 等于预设 id 的配置，
 * 那是用户自己建的，不能被这里改写成自定义提供商——
 * 改写的后果是设置页里预设不再高亮、还多出一个地址输入框。
 */
function migrateBuiltinToCustom(c: ProviderConfig, enabled: boolean): ProviderConfig {
  if (!enabled || c.kind !== 'provider') return c
  const preset = presetOf(c.id)
  if (!preset) return c
  return {
    ...c,
    kind: 'custom',
    // 预设的协议直接写成兼容格式；预设都是 openai 兼容，commandcode 除外
    compat: preset.protocol === 'commandcode' ? 'openai' : (preset.protocol ?? 'openai'),
    label: c.label.trim() || preset.label,
    baseUrl: c.baseUrl.trim() || preset.baseUrl,
  }
}

/**
 * 建号时预置的默认模型：DeepSeek Flash。
 * 元信息（1M 上下文、带视觉）写在预设的 knownModels 里，这里只认 ID，免得两处各写一份。
 */
export const DEFAULT_MODEL_ID = 'deepseek-flash'

/**
 * 建号时填了 Key 就走这条：按默认提供商（DeepSeek 官方）建一条配置，
 * 并预置 deepseek-flash（1M 上下文、带视觉）。
 *
 * 形态与设置页「从预设创建提供商」完全一致（id 用预设 id、kind 为 provider、
 * 地址留空交给预设）：这样设置页里预设是高亮的、不会多出一个地址输入框，
 * 「获取模型列表」「测试连接」也都走预设声明的端点。
 *
 * 这是「填了才创建，不填就不创建」的具体实现——见 App.tsx 的 handleCreateUser。
 */
export function createDefaultProvider(apiKey: string): ProviderConfig {
  const preset = presetOf(DEFAULT_PROVIDER_ID)
  const base: ProviderConfig = {
    id: preset?.id ?? DEFAULT_PROVIDER_ID,
    kind: 'provider',
    label: '',
    // 预设已内置地址，留空即可（baseUrlOf 会取预设的）
    baseUrl: '',
    apiKey,
    models: [],
  }
  return {
    ...base,
    models: [makeModelEntry(DEFAULT_MODEL_ID, { name: 'DeepSeek Flash', contextWindow: 128000 })],
  }
}

/**
 * 兼容保留接口：模型元信息补全（不再依赖硬编码预设）
 */
export function withKnownModelMeta(_c: ProviderConfig, entry: ModelEntry): ModelEntry {
  return entry
}

/**
 * 思考档位映射的落盘清洗：键必须是四档之一，值必须是非空字符串（'omit' 也算）。
 * 键拼错、值留空的一律丢掉——半张映射表比没有更糟，缺档会回落协议默认。
 */
function cleanEffortMap(raw: unknown): EffortMap | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: EffortMap = {}
  let any = false
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!REASONING_EFFORTS.includes(k as ReasoningEffort) || typeof v !== 'string') continue
    const val = v.trim()
    if (!val) continue
    out[k as ReasoningEffort] = val
    any = true
  }
  return any ? out : undefined
}

/** 把任意来源的数据规范成一个模型条目；字符串视为「只有 ID 的旧数据」 */
function normalizeModel(raw: unknown): ModelEntry | null {
  if (typeof raw === 'string') {
    const id = raw.trim()
    return id ? makeModelEntry(id) : null
  }
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r.id).trim()
  if (!id) return null
  const modalities = Array.isArray(r.inputModalities)
    ? r.inputModalities.filter((m): m is InputModality => ALL_MODALITIES.includes(m as InputModality))
    : []
  const contextWindow =
    typeof r.contextWindow === 'number' && Number.isFinite(r.contextWindow) && r.contextWindow > 0
      ? Math.floor(r.contextWindow)
      : 0
  const effortMap = cleanEffortMap(r.effortMap)
  return {
    id,
    name: str(r.name),
    contextWindow,
    // 任何模型都至少能收文本；漏填按纯文本处理
    inputModalities: modalities.length ? [...new Set(modalities)] : ['text'],
    ...(effortMap ? { effortMap } : {}),
  }
}

/** 一条新配置：字段留空，实际取值回落到预设的默认值 */
export function blankConfig(id: string, patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id,
    // 预设 id 视为内置；调用方要建自定义请用 newCustomProvider
    kind: isCustomId(id) ? 'custom' : 'provider',
    label: '',
    baseUrl: '',
    apiKey: '',
    models: [],
    ...patch,
  }
}

/** 新建一个自定义提供商（用户点「新增提供商」走这条） */
export function newCustomProvider(opts: {
  compat: ProviderProtocol
  label: string
  baseUrl: string
}): ProviderConfig {
  return {
    id: `${CUSTOM_PREFIX}${crypto.randomUUID()}`,
    kind: 'custom',
    compat: opts.compat,
    label: opts.label.trim() || COMPAT_LABEL_FALLBACK[opts.compat],
    baseUrl: opts.baseUrl.trim(),
    apiKey: '',
    models: [],
  }
}

const COMPAT_LABEL_FALLBACK: Record<ProviderProtocol, string> = {
  openai: 'OpenAI 兼容服务',
  anthropic: 'Anthropic 兼容服务',
  responses: 'Responses 兼容服务',
  commandcode: 'Command Code',
}

/** 只有填了 Key 才算配置好 */
export const isConfigured = (c: ProviderConfig | null | undefined): boolean =>
  !!c && c.apiKey.trim() !== ''

/**
 * 该配置的线上协议。
 * 自定义提供商看自己选的兼容格式；内置提供商看预设（预设没写就是 openai）。
 */
export function protocolOf(c: ProviderConfig): ProviderProtocol {
  if (isCustomConfig(c)) {
    // 老的自定义配置可能没有 compat，按最常见的 openai 兜底
    return c.compat && COMPAT_PROTOCOLS.includes(c.compat) ? c.compat : 'openai'
  }
  return presetOf(c.id)?.protocol ?? 'openai'
}

/** 该配置实际使用的 baseUrl：自定义用自己的，内置留空时用预设默认值 */
export function baseUrlOf(c: ProviderConfig): string {
  const own = c.baseUrl.trim()
  if (own) return own
  if (isCustomConfig(c)) return COMPAT_META_BASE[c.compat ?? 'openai'] ?? ''
  return presetOf(c.id)?.baseUrl ?? ''
}

const COMPAT_META_BASE: Record<ProviderProtocol, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  responses: 'https://api.openai.com/v1',
  commandcode: 'https://api.commandcode.ai',
}

/** 该配置的显示名 */
export function labelOf(c: ProviderConfig): string {
  const custom = c.label.trim()
  if (custom) return custom
  return presetOf(c.id)?.label ?? (isCustomConfig(c) ? '自定义' : c.id)
}

/**
 * 一个提供商已配置的模型。
 *
 * **只用用户自己配的那些**，不再回落到预设——预设里的模型不算已配置，
 * 否则会出现「预设带的两个模型删不掉」这种怪事（删完又被补回来）。
 * 预设的 knownModels 只在「键入模型 ID 时自动补全元信息」时用。
 */
export function modelEntriesOf(c: ProviderConfig): ModelEntry[] {
  return c.models.filter((m) => m.id)
}

/** 只用 ID 的模型列表：请求侧与选择器都用它 */
export const modelsOf = (c: ProviderConfig): string[] => modelEntriesOf(c).map((m) => m.id)

/** 取某个模型的元信息；找不到返回 undefined */
export const modelEntryOf = (c: ProviderConfig, id: string): ModelEntry | undefined =>
  modelEntriesOf(c).find((m) => m.id === id)

/** 该提供商的默认模型：配的第一个；一个都没配就是空串 */
export const defaultModelOf = (c: ProviderConfig): string => modelEntriesOf(c)[0]?.id ?? ''

/**
 * 把任意来源的数据规范成一份合法配置。
 * 兼容 v2：那时模型是单数字段 chatModel，这里转成 models 数组。
 *
 * `dropLegacyDefaults` 只对**旧版本数据**为 true：那时用户没挑过模型，
 * 配置里的模型名是默认值，丢掉它等于「让用户重新选一次」。
 * 当前版本的数据一律原样保留——规范化会跑在每一次读写上，
 * 在这里删模型等于凭空吃掉用户的数据。
 */
function normalizeConfig(raw: unknown, fallbackId: string, dropLegacyDefaults = false): ProviderConfig {
  const parsed = (raw ?? {}) as Partial<ProviderConfig> & { chatModel?: unknown }
  const id = str(parsed.id).trim() || fallbackId

  // 模型：v3 是对象数组，v2 及更早是字符串数组 / 单数 chatModel
  const rawModels: unknown[] = Array.isArray(parsed.models) ? parsed.models : []
  const legacy = str(parsed.chatModel).trim()
  const candidates = [...rawModels, ...(legacy ? [legacy] : [])]
  const byId = new Map<string, ModelEntry>()
  for (const item of candidates) {
    const entry = normalizeModel(item)
    if (!entry) continue
    // 老数据的默认模型名当作「未选过」；当前数据的模型一律留着
    if (dropLegacyDefaults && LEGACY_DEFAULT_MODELS.has(entry.id)) continue
    if (!byId.has(entry.id)) byId.set(entry.id, entry)
  }

  const extraHeaders = cleanHeaders(parsed.extraHeaders)
  const effortMap = cleanEffortMap(parsed.effortMap)
  // 兼容格式只对自定义提供商有意义；值不合法就退回 openai（最常见）
  const rawCompat = str(parsed.compat).trim() as ProviderProtocol
  const compat = COMPAT_PROTOCOLS.includes(rawCompat) ? rawCompat : undefined
  /**
   * 来源：优先用显式字段；老数据没有它，按 id 前缀推断
   * （历史约定就是自定义带 custom: 前缀，因此推断是可靠的）。
   */
  const kind: ProviderConfig['kind'] =
    parsed.kind === 'custom' || parsed.kind === 'provider'
      ? parsed.kind
      : isCustomId(id)
        ? 'custom'
        : 'provider'

  return {
    id,
    kind,
    label: str(parsed.label),
    baseUrl: str(parsed.baseUrl),
    apiKey: str(parsed.apiKey),
    models: [...byId.values()],
    ...(kind === 'custom' ? { compat: compat ?? 'openai' } : {}),
    ...(str(parsed.apiVersion).trim() ? { apiVersion: str(parsed.apiVersion).trim() } : {}),
    ...(typeof parsed.maxTokens === 'number' && parsed.maxTokens > 0
      ? { maxTokens: Math.floor(parsed.maxTokens) }
      : {}),
    ...(extraHeaders ? { extraHeaders } : {}),
    ...(effortMap ? { effortMap } : {}),
  }
}

/** 兼容 v1（顶层 apiKey / chatModel）：迁移成一条 DeepSeek 配置 */
function migrateV1(raw: Record<string, unknown>): AiSettings | null {
  const apiKey = str(raw.apiKey).trim()
  const chatModel = str(raw.chatModel).trim()
  if (!apiKey && !chatModel) return null
  return {
    version: VERSION,
    providers: [
      normalizeConfig({ id: DEFAULT_PROVIDER_ID, apiKey, models: [chatModel] }, DEFAULT_PROVIDER_ID, true),
    ],
    global: { providerId: DEFAULT_PROVIDER_ID, model: '', effort: DEFAULT_REASONING_EFFORT },
  }
}

function normalize(parsed: unknown): AiSettings {
  const raw = (parsed ?? {}) as Record<string, unknown>

  // v1 没有 providers 字段
  if (raw.version !== VERSION && !Array.isArray(raw.providers)) {
    const migrated = migrateV1(raw)
    if (migrated) return migrated
  }

  const list = Array.isArray(raw.providers) ? raw.providers : []
  // 迁移只对**旧版本写下的数据**做；当前版本的数据一律原样保留。
  // 这条判断很要紧：下面两个迁移都会改写用户的配置，而规范化跑在每一次读写上，
  // 不加这道闸就会把用户刚建好的提供商悄悄改样。
  const fromOldVersion = raw.version !== VERSION
  // 老数据里直接躺着预设条目（那时预设＝「已内置的提供商」）：转成用户自己的提供商，
  // 否则列表里会一直有用户没创建过的提供商
  const providers = list.map((item) =>
    migrateBuiltinToCustom(normalizeConfig(item, DEFAULT_PROVIDER_ID, fromOldVersion), fromOldVersion),
  )
  // 注意：这里**不**补默认提供商。预设只是创建模板，用户没建就没有——
  // 早期版本会塞一条空的 DeepSeek 进来，于是「配了别家仍提示先配置 DeepSeek」。

  // 全局选择：老格式用 activeId 表达「当前提供商」，这里继承过来
  const g = (raw.global ?? {}) as Partial<GlobalSelection>
  const wantedProvider = str(g.providerId).trim() || str(raw.activeId).trim()
  const providerId = providers.some((p) => p.id === wantedProvider) ? wantedProvider : (providers[0]?.id ?? '')

  // 全局模型必须真的属于该提供商，否则回落到它的默认模型（空串表示「用第一个」）
  const provider = providers.find((p) => p.id === providerId)
  const wantedModel = str(g.model).trim()
  const model = provider && modelsOf(provider).includes(wantedModel) ? wantedModel : ''

  return {
    version: VERSION,
    providers,
    global: { providerId, model, effort: asReasoningEffort(g.effort) },
  }
}

/* ---------- 读写 ---------- */

// 模块级缓存：AI 调用每次都会读配置，避免反复解析 YAML。
// 缓存以「用户 + 配置版本」为标识——切换用户或重新载入配置后自然失效。
let cache: { key: string; value: AiSettings } | null = null

const cacheKey = (): string => `${settingsUid() ?? ''}#${settingsRevision()}`

export function loadAiSettings(): AiSettings {
  const key = cacheKey()
  if (cache && cache.key === key) return cache.value
  cache = { key, value: normalize(readUserSettings('ai') ?? {}) }
  return cache.value
}

export function saveAiSettings(settings: AiSettings): void {
  const value = normalize(settings)
  cache = { key: cacheKey(), value }
  writeUserSettings('ai', value)
  // 通知订阅者：设置是模块级状态，不通知的话，拿着旧快照的组件不会重渲染
  emitAiSettings()
}

/* ---------- 变更订阅 ---------- */

/**
 * 配置变更订阅，配合 React 的 useSyncExternalStore 使用。
 *
 * 为什么需要它：设置存在模块级缓存里，不是 React state，改了不会触发重渲染。
 * 消费者若「挂载时取一次快照」（`useState(loadAiSettings)`），就会一直拿着
 * 旧列表——在设置面板里加完提供商与模型、回到目标页一看，菜单里还是旧的。
 * 这里给一个最小的订阅口子，让读设置的地方始终跟着最新值走。
 */
const listeners = new Set<() => void>()

export function subscribeAiSettings(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emitAiSettings(): void {
  for (const listener of [...listeners]) listener()
}

/* ---------- 全局选择（所有 AI 功能的共同基底） ---------- */

/**
 * 用户显式指定的全局提供商（不回退）。可能没配 Key，设置页需要如实展示它。
 */
export function storedGlobalProvider(settings: AiSettings = loadAiSettings()): ProviderConfig | undefined {
  return settings.providers.find((p) => p.id === settings.global.providerId)
}

/**
 * 全局选中的提供商配置——AI 调用实际会用的那一条。
 * 一条提供商都没创建时返回 undefined（调用方需自行判断「还没配置」）。
 *
 * 关键在于「回退」：直接取 providers[0] 会造成一个很隐蔽的错——用户配了 Kimi，
 * 但列表里第一条仍是没填 Key 的 DeepSeek，于是提示语一直说「请先配置 DeepSeek
 * 官方 API Key」，明明别家已经配好了。
 *
 * 因此回退顺序是：指定的那条 → 第一条**已配置**的 → 列表第一条。
 * 这样「全局」总是尽量指向一个真的能用的提供商。
 */
export function globalProvider(settings: AiSettings = loadAiSettings()): ProviderConfig | undefined {
  const providers = settings.providers
  const chosen = storedGlobalProvider(settings)
  if (chosen && isConfigured(chosen)) return chosen
  // 指定的那条没配（或压根不存在）时，让位给第一条已配置的
  return providers.find(isConfigured) ?? chosen ?? providers[0]
}

/** 全局默认是否已经由用户选定并通过回退检查（即真的可用） */
export function hasGlobalDefault(settings: AiSettings = loadAiSettings()): boolean {
  const chosen = storedGlobalProvider(settings)
  return !!chosen && isConfigured(chosen)
}

/**
 * 把全局默认指向某家提供商（在设置页配置完一家后调用）。
 * model 传空串表示「用该家的第一个模型」。
 */
export function setGlobalDefault(providerId: string, model = ''): AiSettings {
  const cur = loadAiSettings()
  if (!cur.providers.some((p) => p.id === providerId)) return cur
  saveAiSettings({ ...cur, global: { ...cur.global, providerId, model } })
  return loadAiSettings()
}

/**
 * 全局选中的模型 ID（空串表示用该提供商的默认模型，或还没配提供商）。
 * 会校验模型确实属于当前生效的提供商——回退到别家时，
 * 旧的 model 可能不属于它，这时回落到该家的第一个模型。
 */
export function globalModel(settings: AiSettings = loadAiSettings()): string {
  const p = globalProvider(settings)
  if (!p) return ''
  const wanted = settings.global.model.trim()
  if (wanted && modelsOf(p).includes(wanted)) return wanted
  return defaultModelOf(p)
}

/** 全局思考等级 */
export const globalEffort = (settings: AiSettings = loadAiSettings()): ReasoningEffort =>
  settings.global.effort

/**
 * 当前生效模型的上下文窗口（token）；没配或用户没填返回 0。
 * 用量圆环要拿它当分母，填 0 时界面就只显示绝对值、不算百分比——
 * 猜一个默认值反而会给出一个看起来很确定、其实错的百分比。
 */
export function globalContextWindow(settings: AiSettings = loadAiSettings()): number {
  const p = globalProvider(settings)
  if (!p) return 0
  const id = globalModel(settings)
  return modelEntriesOf(p).find((m) => m.id === id)?.contextWindow ?? 0
}

/** 全局配置是否可用（存在一条填了 Key 的提供商） */
export const hasApiKey = (settings: AiSettings = loadAiSettings()): boolean =>
  isConfigured(globalProvider(settings))

/**
 * 当前模型收不收图。
 *
 * 判据只有一条：**模型自己声明了 image 模态**（设置页里每条模型都能勾，
 * 见 ModelEntry.inputModalities）。不按模型名猜——名字里带 vision 的未必收图，
 * 叫 chat 的也未必不收；声明是唯一可信的来源。
 *
 * 四条协议都发得出去图片（见 ai/content 的四个 toXxx），所以这里不必再看协议。
 * 界面据此决定「能不能贴图」：不能贴时按钮是禁用的，并说明为什么，
 * 而不是让用户贴完图再收到一个 400。
 */
export function supportsImage(settings: AiSettings = loadAiSettings()): boolean {
  const p = globalProvider(settings)
  if (!p) return false
  const entry = modelEntryOf(p, globalModel(settings)) ?? modelEntriesOf(p)[0]
  return entry?.inputModalities.includes('image') ?? false
}

/** 全局提供商的显示名；还没配提供商时给一句中性说法 */
export const activeLabel = (settings: AiSettings = loadAiSettings()): string => {
  const p = globalProvider(settings)
  return p ? labelOf(p) : '未配置提供商'
}

/** 「提供商 · 模型」一行摘要，用于 agent 栏的选择器 */
export function globalSummary(settings: AiSettings = loadAiSettings()): string {
  return `${activeLabel(settings)} · ${globalModel(settings) || '未选模型'}`
}

/**
 * 把全局选择解析成可直接发请求的形式，供 ai/client 使用。
 *
 * 这是所有 AI 调用的统一入口：Agent、描述生成、短释义、出题阅卷都走它，
 * 日后新增的 AI 小功能也应当复用它，而不是各自读设置。
 * 一条提供商都没配时抛 AiRequestError——那是可提示给用户的错误，
 * 而不是让调用方拿到半个对象去发请求。
 */
export function resolveProvider(settings: AiSettings = loadAiSettings()): ResolvedProvider {
  const cfg = globalProvider(settings)
  if (!cfg) throw new AiRequestError('尚未配置任何 AI 提供商，请先在设置里创建')
  const preset = presetOf(cfg.id)
  return {
    id: cfg.id,
    label: labelOf(cfg),
    baseUrl: baseUrlOf(cfg),
    apiKey: cfg.apiKey.trim(),
    extraHeaders: cfg.extraHeaders,
    quirks: preset?.quirks,
    // 思考档位映射：预设兜底，用户在提供商级的配置覆盖它
    // （模型级还有一层，在 resolveGlobal 里覆盖——那里才认得「选中的是哪个模型」）
    effortMap: { ...preset?.effortMap, ...cfg.effortMap },
    // 协议：自定义看它选的兼容格式，内置看预设
    protocol: protocolOf(cfg),
    modelsPath: preset?.modelsPath,
    /**
     * 单轮输出上限：预设声明的硬上限（如 Command Code 网关的 64000）必须生效，
     * 否则请求会被网关拒；用户显式填了值就以用户的为准（可以调小）。
     * 两者都没有时不设上限，交给服务端默认值。
     */
    maxTokens: cfg.maxTokens ?? preset?.maxTokens,
    goPlanOnly: protocolOf(cfg) === 'commandcode',
    apiVersion: cfg.apiVersion ?? preset?.apiVersion,
  }
}

/** 全局选择的完整解析结果：一次拿齐提供商、模型、思考等级 */
export function resolveGlobal(settings: AiSettings = loadAiSettings()): {
  provider: ResolvedProvider
  model: string
  effort: ReasoningEffort
} {
  const provider = resolveProvider(settings)
  const model = globalModel(settings)
  // 模型级的映射最后覆盖：聚合平台一个提供商下多家模型，映射按模型配才够细
  const entry = globalProvider(settings)?.models.find((m) => m.id === model)
  if (entry?.effortMap) provider.effortMap = { ...provider.effortMap, ...entry.effortMap }
  return { provider, model, effort: globalEffort(settings) }
}

/* ---------- 编辑 ---------- */

/**
 * 所有可能需要经主进程转发的地址：**内置预设 ∪ 用户实际配置过的地址**。
 *
 * 只取已配置的，会让用户刚打开设置页、还没保存的提供商不可用；
 * 只取预设的，会漏掉用户自己填的中转地址。
 *
 * 主进程据此收紧 llm-proxy 白名单——见 ai/http.ts 的 syncProxyHosts。
 */
export function allProviderBaseUrls(settings: AiSettings = loadAiSettings()): string[] {
  const urls = new Set<string>()
  for (const preset of PROVIDERS) urls.add(preset.baseUrl)
  for (const cfg of settings.providers) {
    const url = baseUrlOf(cfg)
    if (url) urls.add(url)
  }
  return [...urls]
}
