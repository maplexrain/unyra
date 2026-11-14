/**
 * 本地适配器：用户自架的 **OpenAI 兼容服务**（见 CapsLocalEngine 的契约注释）。
 *
 * 应用不再内置任何模型下载器与端侧推理栈——本地接入的全部含义是：
 * 用户自己跑一个 OpenAI 兼容服务（vLLM / llama.cpp server / whisper.cpp server /
 * 任何封装了 qwen-vl、faster-whisper、cosyvoice 之类的网关），把 baseUrl 填进来。
 * 三个端点、形状与 OpenAI 官方完全一致：
 * - TTS：`POST {baseUrl}/audio/speech` → 音频二进制（要求 response_format: 'wav'）
 * - STT：`POST {baseUrl}/audio/transcriptions`（multipart：file + model? + language?）→ `{ text }`
 * - OCR：`POST {baseUrl}/chat/completions`（视觉对话，image_url 传 data URL）→ `choices[0].message.content`
 *
 * baseUrl 约定**以 /v1 结尾**（OpenAI SDK 的惯例），三个端点都直接拼在它后面；
 * 服务需不需要鉴权由服务自己决定，apiKey 有就带 Bearer。
 */

import type {
  CapsLocalEngine,
  CapsOcrRequest,
  CapsOcrResult,
  CapsSttRequest,
  CapsSttResult,
  CapsTtsRequest,
  CapsTtsResult,
} from '../../shared/ipc/capabilities'

function headers(engine: CapsLocalEngine): Record<string, string> {
  const out: Record<string, string> = {}
  if (engine.apiKey) out.Authorization = `Bearer ${engine.apiKey}`
  return out
}

const rootOf = (baseUrl: string): string => baseUrl.trim().replace(/\/+$/, '')

/* ---------- TTS ---------- */

export async function localTts(req: CapsTtsRequest): Promise<CapsTtsResult> {
  const engine = req.engine as CapsLocalEngine
  if (!/^https?:\/\//.test(engine.baseUrl)) return { ok: false, error: '本地适配器的 baseUrl 无效' }
  let res: Response
  try {
    res = await fetch(`${rootOf(engine.baseUrl)}/audio/speech`, {
      method: 'POST',
      headers: { ...headers(engine), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(engine.model ? { model: engine.model } : {}),
        input: req.text,
        voice: req.voiceId || engine.voice || 'alloy',
        response_format: 'wav',
      }),
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '本地服务请求失败' }
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => '')
    return { ok: false, error: `本地 TTS 失败 (HTTP ${res.status})${raw ? `：${raw.slice(0, 200)}` : ''}` }
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length === 0) return { ok: false, error: '本地 TTS 返回了空音频' }
  return { ok: true, audioBase64: buf.toString('base64'), mime: 'audio/wav' }
}

/* ---------- STT ---------- */

export async function localStt(req: CapsSttRequest, wav: Buffer): Promise<CapsSttResult> {
  const engine = req.engine as CapsLocalEngine
  if (!/^https?:\/\//.test(engine.baseUrl)) return { ok: false, error: '本地适配器的 baseUrl 无效' }
  const form = new FormData()
  if (engine.model) form.append('model', engine.model)
  if (req.language && req.language !== 'auto') form.append('language', req.language)
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav')
  let res: Response
  try {
    res = await fetch(`${rootOf(engine.baseUrl)}/audio/transcriptions`, {
      method: 'POST',
      headers: headers(engine),
      body: form,
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '本地服务请求失败' }
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => '')
    return { ok: false, error: `本地识别失败 (HTTP ${res.status})${raw ? `：${raw.slice(0, 200)}` : ''}` }
  }
  const parsed = (await res.json().catch(() => null)) as { text?: string; duration_ms?: number } | null
  return { ok: true, text: parsed?.text ?? '' }
}

/* ---------- OCR（视觉对话） ---------- */

const OCR_PROMPT = '提取图片中的全部文字，按原始阅读顺序与换行输出纯文本，不要翻译、不要添加任何说明。'

export async function localOcr(req: CapsOcrRequest): Promise<CapsOcrResult> {
  const engine = req.engine as CapsLocalEngine
  if (!/^https?:\/\//.test(engine.baseUrl)) return { ok: false, error: '本地适配器的 baseUrl 无效' }
  let res: Response
  try {
    res = await fetch(`${rootOf(engine.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: { ...headers(engine), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(engine.model ? { model: engine.model } : {}),
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: OCR_PROMPT },
              { type: 'image_url', image_url: { url: req.imageDataUrl } },
            ],
          },
        ],
      }),
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '本地服务请求失败' }
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => '')
    return { ok: false, error: `本地 OCR 失败 (HTTP ${res.status})${raw ? `：${raw.slice(0, 200)}` : ''}` }
  }
  const parsed = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>
  } | null
  const content = parsed?.choices?.[0]?.message?.content
  // content 既可能是纯文本，也可能是 OpenAI 视觉消息的分段数组——两种都接
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((part) => part?.text ?? '').join('')
        : ''
  return { ok: text.trim().length > 0, text: text.trim() || undefined }
}
