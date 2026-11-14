/**
 * DeepSeek 官方的三能力端点 + Files API（api.deepseek.com）。
 *
 * 端点契约（api-docs.deepseek.com，2026-11 抓取）：
 * - OCR  `POST /v1/tools/ocr`      multipart `file`（带文件名）+ `purpose`
 *        → `{ pages: [{ index, text, finish_reason }], page_count, usage }`
 * - TTS  `POST /v1/tools/tts`      JSON `{ text, voice_id?, format?, filter_markdown? }`
 *        → 音频二进制流（wav = 24 kHz 16 位单声道；响应 Content-Type audio/wav）
 * - ASR  `POST /v1/tools/asr`      multipart `file`（16 位 PCM WAV 或 Ogg Opus）
 *        → `{ request_id, text, duration_ms }`
 * - Files `POST /files`（multipart：purpose 必须在 file 之前）`GET /files`
 *        `GET /files/:id` `DELETE /files/:id`
 *
 * 所有调用都是一次性 HTTP：鉴权 Bearer（与网络搜索同源的 Key），
 * 失败把状态码 + 服务端 message 透传回渲染层——错误文案在 UI 一侧拼，
 * 这里不吞错也不重试（计费能力，重试要由用户来决定）。
 */

import type {
  CapsDeepseekEngine,
  CapsEngine,
  CapsFileEntry,
  CapsFilesCreateRequest,
  CapsFilesCreateResult,
  CapsFilesDeleteRequest,
  CapsFilesDeleteResult,
  CapsFilesListRequest,
  CapsFilesListResult,
  CapsOcrRequest,
  CapsOcrResult,
  CapsSttRequest,
  CapsSttResult,
  CapsTtsRequest,
  CapsTtsResult,
} from '../../shared/ipc/capabilities'

const BASE = 'https://api.deepseek.com'

function headers(engine: CapsDeepseekEngine): Record<string, string> {
  return { Authorization: `Bearer ${engine.apiKey}` }
}

/**
 * 三能力端点的请求类型里 engine 是联合（渲染层同一个入口传上来），
 * 分流发生在 electron/capabilities/index —— 到这里的一定是 DeepSeek 引擎。
 */
function dsEngine(engine: CapsEngine): CapsDeepseekEngine {
  if (engine.kind !== 'deepseek') throw new Error('引擎类型错误：此处只接受 DeepSeek')
  return engine
}

/** 非 sabotaging 的错误文本：优先服务端 JSON 的 message，其次原文 */
async function errorText(res: Response): Promise<string> {
  const raw = await res.text().catch(() => '')
  if (!raw) return `HTTP ${res.status}`
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string }
    return parsed.error?.message ?? parsed.message ?? raw.slice(0, 300)
  } catch {
    return raw.slice(0, 300)
  }
}

/** data URL → { bytes, mime }；不是 data URL 就按原样当 base64（防御调用方变形） */
function decodeDataUrl(dataUrl: string): { bytes: Buffer; mime: string } {
  const match = /^data:([^;,]+)[^,]*,(.*)$/.exec(dataUrl)
  if (match) return { bytes: Buffer.from(match[2], 'base64'), mime: match[1] }
  return { bytes: Buffer.from(dataUrl, 'base64'), mime: 'image/jpeg' }
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
}

/** Files API 返回的 file 对象（服务端原样，id 必有） */
interface DsFileEntry {
  id?: string
  object?: string
  bytes?: number
  created_at?: number
  filename?: string
  purpose?: string
  expires_at?: number
}

function toFileEntry(raw: DsFileEntry | null): CapsFileEntry | null {
  if (!raw?.id) return null
  return {
    id: raw.id,
    object: raw.object ?? 'file',
    bytes: raw.bytes ?? 0,
    created_at: raw.created_at ?? 0,
    filename: raw.filename ?? '',
    purpose: raw.purpose ?? '',
    ...(typeof raw.expires_at === 'number' ? { expires_at: raw.expires_at } : {}),
  }
}

/* ---------- OCR ---------- */

export async function deepseekOcr(req: CapsOcrRequest): Promise<CapsOcrResult> {
  const engine = dsEngine(req.engine)
  const { bytes, mime } = decodeDataUrl(req.imageDataUrl)
  const ext = MIME_EXT[mime] ?? 'jpg'
  const form = new FormData()
  // purpose 必须在 file 之前（官方 create-file 端点的表单约定，OCR 同风格）
  form.append('purpose', req.purpose)
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), `page.${ext}`)
  let res: Response
  try {
    res = await fetch(`${BASE}/v1/tools/ocr`, { method: 'POST', headers: headers(engine), body: form })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '网络请求失败' }
  }
  if (!res.ok) return { ok: false, error: await errorText(res) }
  const parsed = (await res.json().catch(() => null)) as {
    pages?: Array<{ index?: number; text?: string; finish_reason?: string }>
    page_count?: number
  } | null
  const pages = parsed?.pages ?? []
  if (pages.length === 0) return { ok: false, error: 'OCR 未返回任何页面文本' }
  // finish_reason === 'length' 的页文本不完整（达到上限被截断）：拼合时如实保留，由缓存层记账
  const text = pages.map((p) => (p.text ?? '').trim()).filter(Boolean).join('\n')
  return { ok: text.length > 0, text: text || undefined }
}

/* ---------- TTS ---------- */

export async function deepseekTts(req: CapsTtsRequest): Promise<CapsTtsResult> {
  const engine = dsEngine(req.engine)
  let res: Response
  try {
    res = await fetch(`${BASE}/v1/tools/tts`, {
      method: 'POST',
      headers: { ...headers(engine), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: req.text,
        voice_id: req.voiceId || 'stella',
        format: 'wav',
        // 朗读前去 Markdown：播放侧的 cleanTextForSpeech 已清一遍，这里双保险（默认 true，显式传）
        filter_markdown: true,
      }),
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '网络请求失败' }
  }
  if (!res.ok) return { ok: false, error: await errorText(res) }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length === 0) return { ok: false, error: 'TTS 返回了空音频' }
  return { ok: true, audioBase64: buf.toString('base64'), mime: 'audio/wav' }
}

/* ---------- ASR ---------- */

export async function deepseekAsr(req: CapsSttRequest, wav: Buffer): Promise<CapsSttResult> {
  const engine = dsEngine(req.engine)
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav')
  let res: Response
  try {
    res = await fetch(`${BASE}/v1/tools/asr`, { method: 'POST', headers: headers(engine), body: form })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '网络请求失败' }
  }
  if (!res.ok) return { ok: false, error: await errorText(res) }
  const parsed = (await res.json().catch(() => null)) as { text?: string; duration_ms?: number } | null
  return { ok: true, text: parsed?.text ?? '', durationMs: parsed?.duration_ms }
}

/* ---------- Files API ---------- */

export async function deepseekFilesCreate(req: CapsFilesCreateRequest): Promise<CapsFilesCreateResult> {
  const bytes = Buffer.from(req.dataBase64, 'base64')
  const form = new FormData()
  // 官方约定：purpose 字段必须放在 file 之前
  form.append('purpose', req.purpose)
  if (typeof req.expiresAfterSeconds === 'number' && req.expiresAfterSeconds >= 3600) {
    form.append('expires_after[anchor]', 'created_at')
    form.append('expires_after[seconds]', String(Math.min(2_592_000, Math.floor(req.expiresAfterSeconds))))
  }
  form.append('file', new Blob([new Uint8Array(bytes)]), req.filename || 'upload.bin')
  let res: Response
  try {
    res = await fetch(`${BASE}/files`, { method: 'POST', headers: headers(req.engine), body: form })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '网络请求失败' }
  }
  if (!res.ok) return { ok: false, error: await errorText(res) }
  const parsed = (await res.json().catch(() => null)) as DsFileEntry | null
  const file = toFileEntry(parsed)
  if (!file) return { ok: false, error: '上传响应缺少文件 ID' }
  return { ok: true, file }
}

export async function deepseekFilesList(req: CapsFilesListRequest): Promise<CapsFilesListResult> {
  const q = new URLSearchParams()
  if (req.purpose) q.set('purpose', req.purpose)
  if (req.limit) q.set('limit', String(Math.min(1000, Math.max(1, Math.floor(req.limit)))))
  q.set('order', 'desc')
  let res: Response
  try {
    res = await fetch(`${BASE}/files?${q.toString()}`, { headers: headers(req.engine) })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '网络请求失败' }
  }
  if (!res.ok) return { ok: false, error: await errorText(res) }
  const parsed = (await res.json().catch(() => null)) as { data?: DsFileEntry[]; has_more?: boolean } | null
  const files = (parsed?.data ?? []).map(toFileEntry).filter((f): f is CapsFileEntry => !!f)
  return { ok: true, files, hasMore: parsed?.has_more === true }
}

export async function deepseekFilesDelete(req: CapsFilesDeleteRequest): Promise<CapsFilesDeleteResult> {
  let res: Response
  try {
    res = await fetch(`${BASE}/files/${encodeURIComponent(req.fileId)}`, {
      method: 'DELETE',
      headers: headers(req.engine),
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '网络请求失败' }
  }
  if (!res.ok) return { ok: false, error: await errorText(res) }
  const parsed = (await res.json().catch(() => null)) as { deleted?: boolean } | null
  return { ok: true, deleted: parsed?.deleted !== false }
}
