/**
 * TTS (语音合成)：离线模型的下载、状态管理与 Sherpa-ONNX 原生推理。
 *
 * 支持多款高品质端侧离线模型并允许随时切换：
 * 1. MeloTTS (vits-melo-tts-zh_en): 44.1kHz 超清 CD 级音质，支持中英文自然混读，约 60MB；
 * 2. AISHELL-3 (vits-zh-aishell3): 8kHz 极速轻量，内置 174 位发音人，约 42MB。
 *
 * 特性：
 * - 纯端侧零云端依赖，无需 GPU；
 * - 显式禁用外部堆缓冲区 (enableExternalBuffer: false)，兼容 Electron V8 内存沙箱；
 * - 多模型独立缓存与管理，支持并发测速下载、定位目录与删除。
 */

import { ipcMain, shell, type WebContents } from 'electron'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { getUserDataDir } from './storage/userData'
import { runTtsInWorker, resetWorkerModel } from './sherpa/workerBridge'
import type {
  TtsDownloadResult,
  TtsModelDefinition,
  TtsModelStatus,
  TtsSynthesizeRequest,
  TtsSynthesizeResult,
} from '../shared/ipc'

interface OfflineModelConfig {
  id: string
  name: string
  desc: string
  sampleRate: number
  subdir: string
  modelFile: string
  tokensFile: string
  lexiconFile: string
  ruleFstFiles?: string[]
  files: Array<{ name: string; bytes: number; minBytes: number }>
  sources: Array<{ name: string; base: string }>
  speakers: Array<{ id: string; name: string; lang?: string; gender?: string }>
}

const AISHELL_SPEAKERS = Array.from({ length: 174 }, (_, i) => ({
  id: String(i),
  name: `发音人 ${i}${i === 0 ? ' (推荐女声)' : i === 1 ? ' (推荐男声)' : ''}`,
  lang: 'zh-CN',
  gender: i % 2 === 0 ? 'female' : 'male',
}))

export const OFFLINE_MODELS: Record<string, OfflineModelConfig> = {
  'vits-melo-tts-zh_en': {
    id: 'vits-melo-tts-zh_en',
    name: 'MeloTTS · 44.1kHz 超清中英双语 (推荐首选)',
    desc: 'CD 级 44.1kHz 超高保真，发音自然带情绪，支持中英文混读，约 60MB。',
    sampleRate: 44100,
    subdir: path.join('voice-models', 'tts-vits-melo-tts-zh_en'),
    modelFile: 'model.int8.onnx',
    tokensFile: 'tokens.txt',
    lexiconFile: 'lexicon.txt',
    ruleFstFiles: ['phone.fst', 'date.fst', 'number.fst'],
    files: [
      { name: 'model.int8.onnx', bytes: 53517430, minBytes: 50000000 },
      { name: 'lexicon.txt', bytes: 6837671, minBytes: 6000000 },
      { name: 'tokens.txt', bytes: 655, minBytes: 500 },
      { name: 'date.fst', bytes: 59154, minBytes: 50000 },
      { name: 'number.fst', bytes: 64482, minBytes: 50000 },
      { name: 'phone.fst', bytes: 88630, minBytes: 70000 },
    ],
    sources: [
      {
        name: 'hf-mirror 镜像 (推荐)',
        base: 'https://hf-mirror.com/csukuangfj/vits-melo-tts-zh_en/resolve/main/',
      },
      {
        name: 'HuggingFace 官方',
        base: 'https://huggingface.co/csukuangfj/vits-melo-tts-zh_en/resolve/main/',
      },
    ],
    speakers: [
      { id: '0', name: 'MeloTTS 自然女声 (44.1kHz 高保真)', lang: 'zh/en', gender: 'female' },
    ],
  },
  'vits-zh-aishell3': {
    id: 'vits-zh-aishell3',
    name: 'AISHELL-3 · 174 说话人多音色版',
    desc: '极速轻量约 42MB，8kHz 采样率，内置多达 174 位预设说话人。',
    sampleRate: 8000,
    subdir: path.join('voice-models', 'tts-vits-aishell3'),
    modelFile: 'vits-aishell3.int8.onnx',
    tokensFile: 'tokens.txt',
    lexiconFile: 'lexicon.txt',
    files: [
      { name: 'vits-aishell3.int8.onnx', bytes: 39870124, minBytes: 38000000 },
      { name: 'tokens.txt', bytes: 1671, minBytes: 1500 },
      { name: 'lexicon.txt', bytes: 2042943, minBytes: 1900000 },
    ],
    sources: [
      {
        name: 'hf-mirror 镜像 (推荐)',
        base: 'https://hf-mirror.com/csukuangfj/vits-zh-aishell3/resolve/main/',
      },
      {
        name: 'HuggingFace 官方',
        base: 'https://huggingface.co/csukuangfj/vits-zh-aishell3/resolve/main/',
      },
    ],
    speakers: AISHELL_SPEAKERS,
  },
}

export const DEFAULT_OFFLINE_MODEL_ID = 'vits-melo-tts-zh_en'

function getModelConfig(modelId?: string): OfflineModelConfig {
  if (modelId && OFFLINE_MODELS[modelId]) {
    return OFFLINE_MODELS[modelId]
  }
  return OFFLINE_MODELS[DEFAULT_OFFLINE_MODEL_ID]
}

const modelDir = (cfg: OfflineModelConfig): string => path.join(getUserDataDir(), cfg.subdir)
const filePath = (cfg: OfflineModelConfig, name: string): string => path.join(modelDir(cfg), name)

let activeAbort: AbortController | null = null

async function sizeOf(file: string): Promise<number> {
  try {
    return (await fsp.stat(file)).size
  } catch {
    return 0
  }
}

export async function statusOf(requestedModelId?: string): Promise<TtsModelStatus> {
  const cfg = getModelConfig(requestedModelId)
  const dir = modelDir(cfg)
  const files = await Promise.all(
    cfg.files.map(async (f) => {
      const s = await sizeOf(filePath(cfg, f.name))
      return {
        name: f.name,
        bytes: s,
        expect: f.bytes,
        done: s >= f.minBytes,
      }
    }),
  )

  const exists = files.every((f) => f.done)
  const bytes = files.reduce((acc, f) => acc + f.bytes, 0)
  const totalBytes = cfg.files.reduce((acc, f) => acc + f.bytes, 0)

  const availableModels: TtsModelDefinition[] = Object.values(OFFLINE_MODELS).map((m) => ({
    id: m.id,
    name: m.name,
    desc: m.desc,
    sampleRate: m.sampleRate,
    totalBytes: m.files.reduce((sum, item) => sum + item.bytes, 0),
    speakers: m.speakers,
  }))

  return {
    modelId: cfg.id,
    dir,
    path: filePath(cfg, cfg.modelFile),
    exists,
    bytes,
    totalBytes,
    files,
    url: cfg.sources[0].base,
    sources: cfg.sources.map((s) => s.name),
    availableModels,
  }
}

async function fastestSource(cfg: OfflineModelConfig): Promise<{ name: string; base: string }> {
  try {
    const pings = cfg.sources.map(async (src) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 2500)
      try {
        const res = await fetch(`${src.base}${cfg.tokensFile}`, {
          method: 'HEAD',
          signal: controller.signal,
        })
        clearTimeout(timer)
        if (res.ok) return src
      } catch {}
      clearTimeout(timer)
      throw new Error('fail')
    })
    return await Promise.any(pings)
  } catch {
    return cfg.sources[0]
  }
}

async function download(sender: WebContents, requestedModelId?: string): Promise<TtsDownloadResult> {
  if (activeAbort) {
    return { ok: false, error: '下载已在进行中' }
  }

  const cfg = getModelConfig(requestedModelId)
  const dir = modelDir(cfg)
  await fsp.mkdir(dir, { recursive: true })

  activeAbort = new AbortController()
  const { signal } = activeAbort

  try {
    sender.send('tts:modelProgress', { received: 0, total: 1, percent: 0, note: `正在为 ${cfg.name} 测试最优下载源...` })
    const src = await fastestSource(cfg)

    let totalDownloaded = 0
    const totalBytes = cfg.files.reduce((acc, f) => acc + f.bytes, 0)

    for (const f of cfg.files) {
      if (signal.aborted) throw new Error('下载已取消')
      const targetPath = filePath(cfg, f.name)
      const currentSize = await sizeOf(targetPath)
      if (currentSize >= f.minBytes) {
        totalDownloaded += currentSize
        continue
      }

      sender.send('tts:modelProgress', {
        received: totalDownloaded,
        total: totalBytes,
        percent: Math.round((totalDownloaded / totalBytes) * 100),
        note: `正在下载 ${f.name}...`,
      })

      const url = `${src.base}${f.name}`
      const res = await fetch(url, { signal })
      if (!res.ok || !res.body) {
        throw new Error(`下载 ${f.name} 失败 (${res.status})`)
      }

      const fileStream = fs.createWriteStream(targetPath)
      const reader = res.body.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          fileStream.write(Buffer.from(value))
          totalDownloaded += value.length
          sender.send('tts:modelProgress', {
            received: totalDownloaded,
            total: totalBytes,
            percent: Math.min(99, Math.round((totalDownloaded / totalBytes) * 100)),
            note: `正在下载 ${f.name}`,
          })
        }
      }

      await new Promise<void>((resolve, reject) => {
        fileStream.end((err: any) => (err ? reject(err) : resolve()))
      })
    }

    sender.send('tts:modelProgress', { received: totalBytes, total: totalBytes, percent: 100, note: '下载完成' })
    activeAbort = null
    resetWorkerModel('tts', cfg.id)
    return { ok: true, bytes: totalBytes }
  } catch (err: any) {
    activeAbort = null
    if (signal.aborted) {
      return { ok: false, error: '用户取消下载' }
    }
    return { ok: false, error: err?.message || String(err) }
  }
}

function cancelDownload(): boolean {
  if (activeAbort) {
    activeAbort.abort()
    activeAbort = null
    return true
  }
  return false
}

async function removeModel(requestedModelId?: string): Promise<{ ok: boolean; error?: string }> {
  cancelDownload()
  const cfg = getModelConfig(requestedModelId)
  resetWorkerModel('tts', cfg.id)
  try {
    await fsp.rm(modelDir(cfg), { recursive: true, force: true })
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) }
  }
}

function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const numChannels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    const val = s < 0 ? s * 0x8000 : s * 0x7fff
    buffer.writeInt16LE(Math.round(val), offset)
    offset += 2
  }

  return buffer
}

async function synthesize(req: TtsSynthesizeRequest): Promise<TtsSynthesizeResult> {
  const cfg = getModelConfig(req.modelId)
  const status = await statusOf(cfg.id)
  if (!status.exists) {
    console.warn(`[TTS] 离线模型 ${cfg.name} 未就绪，拒绝合成`)
    return { ok: false, error: `离线语音模型 (${cfg.name}) 尚未下载` }
  }

  const rawText = (req.text ?? '').trim()
  if (!rawText) {
    return { ok: false, error: '合成文本不能为空' }
  }

  const start = Date.now()
  const rawSpeed = Number(req.speed)
  const speed = !Number.isNaN(rawSpeed) && rawSpeed > 0 ? rawSpeed : 1.0
  const maxSid = cfg.speakers.length > 0 ? cfg.speakers.length - 1 : 0
  const sid = Math.max(0, Math.min(maxSid, Math.floor(Number(req.speakerId) || 0)))

  // 兜底长文本保护：单次文本若超过 200 字，在主进程端细粒度拆句，防止大批量文本导致引擎卡死
  const chunks: string[] = []
  if (rawText.length > 200) {
    let cur = rawText
    while (cur.length > 200) {
      let cut = cur.lastIndexOf('，', 200)
      if (cut === -1) cut = cur.lastIndexOf('。', 200)
      if (cut === -1) cut = cur.lastIndexOf(' ', 200)
      if (cut === -1 || cut < 50) cut = 200
      else cut += 1
      chunks.push(cur.slice(0, cut).trim())
      cur = cur.slice(cut).trim()
    }
    if (cur) chunks.push(cur)
  } else {
    chunks.push(rawText)
  }

  try {
    const ruleFsts = cfg.ruleFstFiles && cfg.ruleFstFiles.length > 0
      ? cfg.ruleFstFiles.map((f) => filePath(cfg, f)).filter((p) => fs.existsSync(p)).join(',')
      : undefined

    let allSamples: Float32Array = new Float32Array(0)
    let sampleRate = cfg.sampleRate || 44100

    for (const chunk of chunks) {
      if (!chunk) continue
      const res = await runTtsInWorker({
        modelPath: filePath(cfg, cfg.modelFile),
        lexiconPath: filePath(cfg, cfg.lexiconFile),
        tokensPath: filePath(cfg, cfg.tokensFile),
        ruleFsts,
        text: chunk,
        sid,
        speed,
        instanceKey: cfg.id,
      })
      sampleRate = res.sampleRate
      const merged = new Float32Array(allSamples.length + res.samples.length)
      merged.set(allSamples, 0)
      merged.set(res.samples, allSamples.length)
      allSamples = merged
    }

    if (allSamples.length === 0) {
      throw new Error('离线模型未生成有效音频采样')
    }

    const wavBuf = encodeWav(allSamples, sampleRate)
    const base64 = wavBuf.toString('base64')
    const audioDataUrl = `data:audio/wav;base64,${base64}`
    const durationMs = Date.now() - start

    console.info(`[TTS] Worker 合成成功 [${cfg.id}]: 采样数=${allSamples.length}, 采样率=${sampleRate}, 音频大小=${wavBuf.length}字节, 耗时=${durationMs}ms`)

    return {
      ok: true,
      audioDataUrl,
      durationMs,
    }
  } catch (err: any) {
    console.error(`[TTS] 合成失败 [${cfg.id}]：`, err)
    resetWorkerModel('tts', cfg.id)
    return { ok: false, error: err?.message || String(err) }
  }
}

export function registerTtsIpc(): void {
  ipcMain.handle('tts:modelStatus', (_e, modelId?: string) => statusOf(modelId))
  ipcMain.handle('tts:downloadModel', (e, modelId?: string) => download(e.sender, modelId))
  ipcMain.handle('tts:cancelDownload', () => cancelDownload())
  ipcMain.handle('tts:removeModel', (_e, modelId?: string) => removeModel(modelId))
  ipcMain.handle('tts:revealModel', async (_e, modelId?: string) => {
    const cfg = getModelConfig(modelId)
    const dir = modelDir(cfg)
    await fsp.mkdir(dir, { recursive: true })
    await shell.openPath(dir)
    return true
  })
  ipcMain.handle('tts:synthesize', (_e, req: TtsSynthesizeRequest) => synthesize(req))
}
