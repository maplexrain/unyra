/**
 * 「能力接入」配置：TTS（文字转语音）/ STT（语音转文字）/ OCR（文字识别）
 * 三个能力各自怎么接（见设置 → 模型 → 能力接入）。
 *
 * 由来：这三个能力原先由内置插件提供（本地模型下载 + sherpa/ONNX 端侧推理），
 * 2026-11-14 迁进模型体系——接入方式收成两种：
 * - **DeepSeek 官方**（`deepseek`）：复用 DeepSeek 提供商的 API Key（与网络搜索同源，
 *   见 settings.ts 的 findReferencedDeepSeekKey），端点固定 api.deepseek.com；
 * - **本地适配器**（`local`）：用户自己架 OpenAI 兼容服务（契约见 shared/ipc/capabilities
 *   的 CapsLocalEngine 注释），应用不再内置任何模型下载器与推理栈。
 *
 * 为什么跟 AI 设置同仓（setting.yaml 的 ai 片）而不另开一片：能力配置与提供商配置
 * 互相引用（DeepSeek 模式要用提供商的 Key）、订阅机制共用 subscribeAiSettings，
 * 拆开就得做两次持久化与两次通知，一处改动两处读——不值。
 *
 * 这份文件只放类型、默认值与清洗；挂在 AiSettings.capabilities 上
 * （读写管线复用 settings.ts 的 load/save，见那边 normalizeAiSettings 的 capabilities 段）。
 */

import { t } from '../i18n'

/** 三个能力的接入方式。TTS 多一档 `system`（浏览器 Web Speech），OCR 多一档 `system`（Windows 内置 OCR，离线免费） */
export type CapabilityMode = 'off' | 'deepseek' | 'local'
export type TtsMode = 'system' | CapabilityMode
export type OcrMode = CapabilityMode | 'system'

/** OCR 的识别档位（DeepSeek /v1/tools/ocr 的 purpose 参数） */
export const CAPS_OCR_PURPOSES = ['text_recognition', 'rich_layout_recognition'] as const
export type CapsOcrPurposeSetting = (typeof CAPS_OCR_PURPOSES)[number]

/** 本地适配器：用户自架的 OpenAI 兼容服务（三端点契约见 shared/ipc/capabilities） */
export interface LocalServiceConfig {
  baseUrl: string
  apiKey?: string
  model?: string
  /** 本地 TTS 的音色（透传给 /audio/speech 的 voice 字段） */
  voice?: string
}

export interface TtsCapabilityConfig {
  mode: TtsMode
  /** DeepSeek 音色：stella（女声）/ tide（男声）；system/local 模式不用它 */
  voiceId?: string
  local?: LocalServiceConfig
}

export interface SttCapabilityConfig {
  mode: CapabilityMode
  /** 识别语言提示：auto / zh / en / ja / ko / yue（本地适配器透传 language；DeepSeek 无此参数） */
  language?: string
  local?: LocalServiceConfig
}

export interface OcrCapabilityConfig {
  mode: OcrMode
  purpose: CapsOcrPurposeSetting
  local?: LocalServiceConfig
}

export interface AiCapabilities {
  tts: TtsCapabilityConfig
  stt: SttCapabilityConfig
  ocr: OcrCapabilityConfig
}

/** DeepSeek TTS 的内置音色（官方文档：可选值只有这两个） */
export const DEEPSEEK_TTS_VOICES: Array<{ id: string; label: string }> = [
  { id: 'stella', label: t('Stella（女声）') },
  { id: 'tide', label: t('Tide（男声）') },
]

/** STT 识别语言（沿用旧 SenseVoice 的语言清单口径） */
export const CAPS_STT_LANGUAGES = ['auto', 'zh', 'en', 'ja', 'ko', 'yue'] as const

export const CAPS_OCR_PURPOSE_LABEL: Record<CapsOcrPurposeSetting, string> = {
  text_recognition: t('快速识别（纯文字抽取，不可选区）'),
  rich_layout_recognition: t('版面识别（带定位坐标，可选区复制）'),
}

/** 静态兜底（非 Windows、无 DeepSeek 的最保守形态） */
export const DEFAULT_CAPABILITIES: AiCapabilities = {
  tts: { mode: 'system' },
  stt: { mode: 'off', language: 'auto' },
  ocr: { mode: 'off', purpose: 'text_recognition' },
}

/**
 * 首次升级（旧数据没有 capabilities 段）时的默认值，按环境生成：
 * - OCR：Windows 桌面端默认「系统自带」（离线免费零下载）；其余平台默认关闭；
 * - TTS/STT：默认 DeepSeek 官方——**前提是已配置了 DeepSeek 提供商**（有 Key 可复用），
 *   没配就 TTS 回落系统原生、STT 保持关闭。落盘固化后就是用户显式配置，不再动态漂移。
 */
export function defaultCapabilities(opts: { isWin?: boolean; hasDeepseek?: boolean } = {}): AiCapabilities {
  const isWin = opts.isWin ?? false
  const hasDeepseek = opts.hasDeepseek ?? false
  return {
    tts: { mode: hasDeepseek ? 'deepseek' : 'system' },
    stt: { mode: hasDeepseek ? 'deepseek' : 'off', language: 'auto' },
    ocr: { mode: isWin ? 'system' : 'off', purpose: 'text_recognition' },
  }
}

/** Windows 桌面端判定（主进程/Web 服务端没有 navigator，按非 Windows 处理） */
export function isWinPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
}

const MODES: ReadonlySet<string> = new Set(['off', 'deepseek', 'local'])
const TTS_MODES: ReadonlySet<string> = new Set(['system', 'off', 'deepseek', 'local'])
const OCR_MODES: ReadonlySet<string> = new Set(['off', 'deepseek', 'local', 'system'])

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** 本地适配器配置的清洗：baseUrl 必须像 URL，其余字段留空就丢 */
function cleanLocal(raw: unknown): LocalServiceConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const baseUrl = str(r.baseUrl).replace(/\/+$/, '')
  if (!/^https?:\/\//.test(baseUrl)) return undefined
  const apiKey = str(r.apiKey)
  const model = str(r.model)
  const voice = str(r.voice)
  return {
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(model ? { model } : {}),
    ...(voice ? { voice } : {}),
  }
}

/** 引擎指纹（进缓存 key）：换引擎或换参数后旧缓存自动作废，不会拿旧结果冒充新识别 */
export function engineFingerprint(
  mode: CapabilityMode | TtsMode,
  purpose?: string,
  voiceId?: string,
): string {
  const parts: string[] = [mode]
  if (purpose) parts.push(purpose)
  if (voiceId) parts.push(voiceId)
  return parts.join('|')
}

function cleanTts(raw: unknown): TtsCapabilityConfig {
  const r = (raw ?? {}) as Record<string, unknown>
  const mode = TTS_MODES.has(str(r.mode)) ? (str(r.mode) as TtsMode) : DEFAULT_CAPABILITIES.tts.mode
  const voiceId = str(r.voiceId) || undefined
  const local = cleanLocal(r.local)
  return {
    mode,
    ...(voiceId ? { voiceId } : {}),
    ...(local ? { local } : {}),
  }
}

function cleanStt(raw: unknown): SttCapabilityConfig {
  const r = (raw ?? {}) as Record<string, unknown>
  const mode = MODES.has(str(r.mode)) ? (str(r.mode) as CapabilityMode) : DEFAULT_CAPABILITIES.stt.mode
  const language = str(r.language) || DEFAULT_CAPABILITIES.stt.language
  const local = cleanLocal(r.local)
  return {
    mode,
    ...(language ? { language } : {}),
    ...(local ? { local } : {}),
  }
}

function cleanOcr(raw: unknown): OcrCapabilityConfig {
  const r = (raw ?? {}) as Record<string, unknown>
  const mode = OCR_MODES.has(str(r.mode)) ? (str(r.mode) as OcrMode) : DEFAULT_CAPABILITIES.ocr.mode
  const purpose = CAPS_OCR_PURPOSES.includes(str(r.purpose) as CapsOcrPurposeSetting)
    ? (str(r.purpose) as CapsOcrPurposeSetting)
    : DEFAULT_CAPABILITIES.ocr.purpose
  const local = cleanLocal(r.local)
  return {
    mode,
    purpose,
    ...(local ? { local } : {}),
  }
}

/** 把任意来源的数据规范成一份合法的能力配置（每项缺省都回落默认值） */
export function normalizeCapabilities(raw: unknown): AiCapabilities {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    tts: cleanTts(r.tts),
    stt: cleanStt(r.stt),
    ocr: cleanOcr(r.ocr),
  }
}

/** 服务端工具开关（模型基础配置，见 ai/providers 的 DeepSeek 预设与 ai/client 的注入） */
export interface ServerToolConfig {
  /** 联网搜索（deepseek_web_search） */
  webSearch: boolean
  /** 阅读链接（deepseek_read_url） */
  readUrl: boolean
}

/** Files API 配置（提供商高级配置；可选能力，默认关，DeepSeek 预设兜底为开） */
export interface FilesApiConfig {
  enabled: boolean
}

/** 服务端工具开关的清洗：两个键都要是 boolean 才收 */
export function cleanServerTools(raw: unknown): ServerToolConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.webSearch !== 'boolean' || typeof r.readUrl !== 'boolean') return undefined
  return { webSearch: r.webSearch, readUrl: r.readUrl }
}

/** Files API 开关的清洗 */
export function cleanFilesApi(raw: unknown): FilesApiConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.enabled !== 'boolean') return undefined
  return { enabled: r.enabled }
}
