/**
 * TTS (语音合成)：离线轻量模型的下载、状态管理与 Sherpa-ONNX 原生推理。
 *
 * 采用端侧纯离线 VITS aishell3 轻量模型（int8 量化版约 42MB）：
 * - 模型保存在 appdata 的 voice-models/tts-vits-aishell3 下；
 * - 推理直接通过已内置的 sherpa-onnx-node，完全不增加额外原生依赖；
 * - 支持 174 位说话人，支持语速动态调节；
 * - 下载支持官方 HuggingFace 与国内高速镜像并发测速。
 */

import { ipcMain, shell, type WebContents } from 'electron'
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { getUserDataDir } from './storage/userData'
import type {
  TtsDownloadResult,
  TtsModelStatus,
  TtsSynthesizeRequest,
  TtsSynthesizeResult,
} from '../shared/ipc'

const MODEL_SUBDIR = path.join('voice-models', 'tts-vits-aishell3')
const MODEL_FILE = 'vits-aishell3.int8.onnx'
const TOKENS_FILE = 'tokens.txt'
const LEXICON_FILE = 'lexicon.txt'

const FILES = [
  { name: MODEL_FILE, bytes: 39870124, minBytes: 38000000 },
  { name: TOKENS_FILE, bytes: 1671, minBytes: 1500 },
  { name: LEXICON_FILE, bytes: 2042943, minBytes: 1900000 },
]

const SOURCES = [
  {
    name: 'hf-mirror 镜像 (推荐)',
    base: 'https://hf-mirror.com/csukuangfj/vits-zh-aishell3/resolve/main/',
  },
  {
    name: 'HuggingFace 官方',
    base: 'https://huggingface.co/csukuangfj/vits-zh-aishell3/resolve/main/',
  },
]

const modelDir = (): string => path.join(getUserDataDir(), MODEL_SUBDIR)
const filePath = (name: string): string => path.join(modelDir(), name)

let activeAbort: AbortController | null = null
let ttsInstance: any = null

async function sizeOf(file: string): Promise<number> {
  try {
    return (await fsp.stat(file)).size
  } catch {
    return 0
  }
}

async function statusOf(): Promise<TtsModelStatus> {
  const dir = modelDir()
  const files = await Promise.all(
    FILES.map(async (f) => {
      const s = await sizeOf(filePath(f.name))
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
  const totalBytes = FILES.reduce((acc, f) => acc + f.bytes, 0)

  return {
    dir,
    path: filePath(MODEL_FILE),
    exists,
    bytes,
    totalBytes,
    files,
    url: SOURCES[0].base,
    sources: SOURCES.map((s) => s.name),
  }
}

async function fastestSource(): Promise<{ name: string; base: string }> {
  try {
    const pings = SOURCES.map(async (src) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 2500)
      try {
        const res = await fetch(`${src.base}${TOKENS_FILE}`, {
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
    return SOURCES[0]
  }
}

async function download(sender: WebContents): Promise<TtsDownloadResult> {
  if (activeAbort) {
    return { ok: false, error: '下载已在进行中' }
  }

  const dir = modelDir()
  await fsp.mkdir(dir, { recursive: true })

  activeAbort = new AbortController()
  const { signal } = activeAbort

  try {
    sender.send('tts:modelProgress', { received: 0, total: 1, percent: 0, note: '正在测试最优下载源...' })
    const src = await fastestSource()

    let totalDownloaded = 0
    const totalBytes = FILES.reduce((acc, f) => acc + f.bytes, 0)

    for (const f of FILES) {
      if (signal.aborted) throw new Error('下载已取消')
      const targetPath = filePath(f.name)
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
    ttsInstance = null // 重置实例以便重新加载
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

async function removeModel(): Promise<{ ok: boolean; error?: string }> {
  cancelDownload()
  ttsInstance = null
  try {
    await fsp.rm(modelDir(), { recursive: true, force: true })
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
  const status = await statusOf()
  if (!status.exists) {
    return { ok: false, error: '离线语音模型未下载' }
  }

  try {
    if (!ttsInstance) {
      const sherpa: any = await import('sherpa-onnx-node')
      const OfflineTts = sherpa.OfflineTts || sherpa.default?.OfflineTts
      const config = {
        model: {
          vits: {
            model: filePath(MODEL_FILE),
            lexicon: filePath(LEXICON_FILE),
            tokens: filePath(TOKENS_FILE),
          },
          numThreads: 2,
          debug: false,
        },
      }
      ttsInstance = new OfflineTts(config)
    }

    const start = Date.now()
    const speed = req.speed ?? 1.0
    const sid = req.speakerId ?? 0

    const result = await ttsInstance.generateAsync({
      text: req.text,
      sid,
      speed,
    })

    const wavBuf = encodeWav(result.samples, result.sampleRate)
    const base64 = wavBuf.toString('base64')
    const audioDataUrl = `data:audio/wav;base64,${base64}`

    return {
      ok: true,
      audioDataUrl,
      durationMs: Date.now() - start,
    }
  } catch (err: any) {
    console.error('[TTS] 合成失败：', err)
    return { ok: false, error: err?.message || String(err) }
  }
}

export function registerTtsIpc(): void {
  ipcMain.handle('tts:modelStatus', () => statusOf())
  ipcMain.handle('tts:downloadModel', (e) => download(e.sender))
  ipcMain.handle('tts:cancelDownload', () => cancelDownload())
  ipcMain.handle('tts:removeModel', () => removeModel())
  ipcMain.handle('tts:revealModel', async () => {
    const dir = modelDir()
    await fsp.mkdir(dir, { recursive: true })
    await shell.openPath(dir)
    return true
  })
  ipcMain.handle('tts:synthesize', (_e, req: TtsSynthesizeRequest) => synthesize(req))
}
