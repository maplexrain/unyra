/**
 * 这个文件负责什么：IPC 契约的**模型能力**通道组——TTS（文字转语音）/ STT（语音转文字）/
 * OCR（文字识别）三个能力经「设置 → 模型 → 能力接入」配置后的识别/合成请求，
 * 通用 KV 结果缓存，以及 Files API 的四个端点（见 electron/capabilities/）。
 *
 * 原先这三个能力由内置插件提供（本地模型下载 + 端侧推理），2026-11-14 迁到模型体系：
 * 接入方式只有两种——DeepSeek 官方（复用提供商 API Key，与网络搜索同源）与
 * **本地适配器**（用户自架 OpenAI 兼容服务，应用不再内置任何模型下载与推理栈）。
 *
 * 网络调用全部发生在主进程（或 WebUI 的自托管服务端）：渲染层 CSP 够不着外网，
 * multipart 表单与二进制音频也只有主进程发起来才省心。
 * 旧插件时代的契约（shared/ipc/voice.ts、ocr.ts、tts.ts 的模型下载组）随本地推理栈一起退役；
 * OCR 文字层的挂贴数据形状（OcrLineItem 等）原样搬到这里，调用方名字不变。
 */

/* ---------- OCR 文字层的数据形状（原 shared/ipc/ocr.ts，逐字未动） ---------- */

export interface OcrBBox {
  /** 归一化坐标 0~1，相对于页面宽度与高度 */
  x: number
  y: number
  width: number
  height: number
}

export interface OcrWordItem {
  text: string
  bbox: OcrBBox
  confidence?: number
}

export interface OcrLineItem {
  text: string
  bbox: OcrBBox
  words?: OcrWordItem[]
  confidence?: number
}

export interface OcrPageResult {
  page: number
  lines: OcrLineItem[]
  fullText: string
  modelId: string
  createdAt: number
  /** 识别服务的原始返回（含 grounding 标记原样）：挂贴对不上时用它诊断解析 */
  rawOcrText?: string
}

/* ---------- 引擎描述：能力调用走哪家 ---------- */

/** DeepSeek 官方：复用 DeepSeek 提供商的 API Key（与网络搜索同源），端点固定在 api.deepseek.com */
export interface CapsDeepseekEngine {
  kind: 'deepseek'
  apiKey: string
}

/**
 * 本地适配器：用户自己架的 **OpenAI 兼容服务**。
 * 应用不内置任何模型与下载器——适配器契约只有三个端点：
 * - TTS：`POST {baseUrl}/audio/speech`，JSON `{ model?, input, voice?, response_format? }` → 音频二进制
 * - STT：`POST {baseUrl}/audio/transcriptions`，multipart `file`（16 位 PCM WAV）+ `model?` + `language?` → `{ text }`
 * - OCR：`POST {baseUrl}/chat/completions`，视觉对话（image_url 传 data URL）→ `choices[0].message.content` 即文本
 */
export interface CapsLocalEngine {
  kind: 'local'
  baseUrl: string
  apiKey?: string
  model?: string
  /** 本地 TTS 的音色（OpenAI 兼容协议的 voice 字段，原样透传） */
  voice?: string
}

/**
 * 系统自带引擎（Windows.Media.Ocr，仅 Windows）：完全离线零费用，引擎输出视觉行
 * 且带词级包围盒；引擎语言跟随系统（无语言包时主进程返回明确错误）。
 */
export interface CapsSystemEngine {
  kind: 'system'
}

export type CapsEngine = CapsDeepseekEngine | CapsLocalEngine | CapsSystemEngine

/* ---------- OCR：一页一图，DeepSeek 端点 POST /v1/tools/ocr（multipart） ---------- */

export type CapsOcrPurpose = 'text_recognition' | 'rich_layout_recognition'

export interface CapsOcrRequest {
  /** 画布截图的 data URL（image/jpeg 等；主进程拆出字节再 multipart 上传） */
  imageDataUrl: string
  purpose: CapsOcrPurpose
  engine: CapsEngine
}

export interface CapsOcrResult {
  ok: boolean
  /** 整页识别文本（DeepSeek 返回的 pages[0].text 拼合）；system 路径为行文本拼合 */
  text?: string
  /** 系统自带路径：主进程直接产出行级结构（词级 bbox），渲染层不再解析 */
  lines?: OcrLineItem[]
  error?: string
}

/* ---------- TTS：DeepSeek 端点 POST /v1/tools/tts（JSON，音频流式返回） ---------- */

export interface CapsTtsRequest {
  text: string
  /** DeepSeek 音色（stella 女声 / tide 男声）；本地适配器透传 voice 字段 */
  voiceId?: string
  engine: CapsEngine
}

export interface CapsTtsResult {
  ok: boolean
  /** 音频字节（wav）的 base64，渲染层还原成 data URL 交给播放器 */
  audioBase64?: string
  mime?: string
  error?: string
}

/* ---------- STT：DeepSeek 端点 POST /v1/tools/asr（multipart，16 位 PCM WAV） ---------- */

export interface CapsSttRequest {
  /** 16 kHz 单声道 PCM 采样（录音段裁剪后整段送解，与旧 voice:transcribe 同源） */
  samples: Float32Array
  sampleRate: number
  /** 识别语言提示（本地适配器透传给 /audio/transcriptions 的 language 字段；DeepSeek 无此参数，忽略） */
  language?: string
  engine: CapsEngine
}

export interface CapsSttResult {
  ok: boolean
  text?: string
  durationMs?: number
  error?: string
}

/* ---------- 通用 KV 结果缓存（收费能力的「别重复花钱」层） ---------- */

/**
 * 缓存完全由渲染层记账（key 由调用方拼好：能力 + 引擎指纹 + 内容指纹），
 * 主进程只做「目录 + JSON 文件」的存取，并按总量清理最旧的条目。
 * OCR 页文本、TTS 音频（base64）、STT 段落文本都走这一条通道。
 */
export type CapsCacheGetResult = { ok: true; value: unknown } | { ok: false; error?: string }
export type CapsCacheSetResult = { ok: true } | { ok: false; error?: string }

/* ---------- Files API（可选，按提供商高级配置开关） ---------- */

export type CapsFilePurpose = 'user_data' | 'text_recognition' | 'rich_layout_recognition'

/** DeepSeek 的 file 对象（GET /files、POST /files 的 data 元素） */
export interface CapsFileEntry {
  id: string
  object: string
  bytes: number
  created_at: number
  filename: string
  purpose: string
  expires_at?: number
}

export interface CapsFilesCreateRequest {
  /** 文件字节（base64；主进程解成 Buffer 再 multipart 上传） */
  dataBase64: string
  filename: string
  purpose: CapsFilePurpose
  /** 过期秒数（3600–2592000）；不传永久有效 */
  expiresAfterSeconds?: number
  engine: CapsDeepseekEngine
}

export type CapsFilesCreateResult = { ok: true; file: CapsFileEntry } | { ok: false; error: string }

export interface CapsFilesListRequest {
  purpose?: CapsFilePurpose
  limit?: number
  engine: CapsDeepseekEngine
}

export type CapsFilesListResult =
  | { ok: true; files: CapsFileEntry[]; hasMore?: boolean }
  | { ok: false; error: string }

export type CapsFilesDeleteRequest = { fileId: string; engine: CapsDeepseekEngine }
export type CapsFilesDeleteResult = { ok: true; deleted: boolean } | { ok: false; error: string }

/** GET /files/:id 的单条检索 */
export type CapsFilesRetrieveRequest = { fileId: string; engine: CapsDeepseekEngine }
export type CapsFilesRetrieveResult = { ok: true; file: CapsFileEntry } | { ok: false; error: string }
