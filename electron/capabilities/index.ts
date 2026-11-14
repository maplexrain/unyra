/**
 * 模型能力的 IPC 通道（window.mojiNative.caps，见 electron/preload.ts 同名段）。
 *
 * 三个能力（OCR / TTS / STT）的**网络调用都在这里发生**：渲染层读好配置、拼好
 * 引擎描述（DeepSeek 或本地适配器）与缓存键，主进程只做三件事——
 *   1. 按引擎分流到 deepseek.ts / local.ts；
 *   2. STT 的 PCM 采样先编成 WAV（两者都只收 WAV）；
 *   3. Files API 的四个端点原样转发（可选能力，提供商高级配置开关）。
 *
 * 结果缓存不在这一层：渲染层自己查/写 caps.cacheGet / cacheSet（键由调用方拼），
 * 主进程的缓存就是「目录 + JSON」的 KV（见 cache.ts）——它不知道里面装的是什么，
 * 也就不需要为每个能力各写一份缓存策略。
 */

import { ipcMain } from 'electron'
import path from 'node:path'
import {
  type CapsCacheGetResult,
  type CapsCacheSetResult,
  type CapsFileEntry,
  type CapsFilesCreateRequest,
  type CapsFilesCreateResult,
  type CapsFilesDeleteRequest,
  type CapsFilesDeleteResult,
  type CapsFilesListRequest,
  type CapsFilesListResult,
  type CapsFilesRetrieveRequest,
  type CapsFilesRetrieveResult,
  type CapsOcrRequest,
  type CapsOcrResult,
  type CapsSttRequest,
  type CapsSttResult,
  type CapsTtsRequest,
  type CapsTtsResult,
} from '../../shared/ipc/capabilities'
import { getUserDataDir } from '../storage/userData'
import { deepseekAsr, deepseekFilesCreate, deepseekFilesDelete, deepseekFilesList, deepseekOcr, deepseekTts } from './deepseek'
import { localOcr, localStt, localTts } from './local'
import { systemOcr } from './system'
import { cacheGet, cacheSet } from './cache'
import { encodeWavFromFloat32 } from './wav'

export function registerCapabilitiesIpc(): void {
  // 缓存根：userData 下的 caps-cache/（与旧插件时代的 ocr-cache/ 不通——键口径换了，
  // 旧缓存不迁移，重新识别一次即可；旧 ocr-models / voice-models 目录留在原处不再读写）
  const root = path.join(getUserDataDir(), 'caps-cache')

  ipcMain.handle('caps:ocr', async (_e, req: CapsOcrRequest): Promise<CapsOcrResult> => {
    try {
      if (!req?.engine || !req.imageDataUrl) return { ok: false, error: 'OCR 请求缺少引擎或图像' }
      if (req.engine.kind === 'system') {
        const r = await systemOcr(req.imageDataUrl)
        if (r.lines.length > 0) return { ok: true as const, text: r.fullText, lines: r.lines }
        return { ok: false as const, error: r.rawOcrText ?? '系统 OCR 未识别出文字' }
      }
      return req.engine.kind === 'deepseek'
        ? req.engine.apiKey
          ? await deepseekOcr(req)
          : { ok: false, error: '尚未配置 DeepSeek API Key（设置 → 模型 → 提供商与模型）' }
        : await localOcr(req)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'OCR 失败' }
    }
  })

  ipcMain.handle('caps:tts', async (_e, req: CapsTtsRequest): Promise<CapsTtsResult> => {
    try {
      if (!req?.engine || !req.text?.trim()) return { ok: false, error: 'TTS 请求缺少引擎或文本' }
      return req.engine.kind === 'deepseek'
        ? req.engine.apiKey
          ? await deepseekTts(req)
          : { ok: false, error: '尚未配置 DeepSeek API Key（设置 → 模型 → 提供商与模型）' }
        : await localTts(req)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'TTS 失败' }
    }
  })

  ipcMain.handle('caps:stt', async (_e, req: CapsSttRequest): Promise<CapsSttResult> => {
    try {
      if (!req?.engine || !(req.samples instanceof Float32Array) || req.samples.length === 0) {
        return { ok: false, error: '识别请求缺少引擎或音频' }
      }
      const wav = encodeWavFromFloat32(req.samples, req.sampleRate || 16_000)
      return req.engine.kind === 'deepseek'
        ? req.engine.apiKey
          ? await deepseekAsr(req, wav)
          : { ok: false, error: '尚未配置 DeepSeek API Key（设置 → 模型 → 提供商与模型）' }
        : await localStt(req, wav)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '识别失败' }
    }
  })

  /* ---------- 结果缓存（KV） ---------- */

  ipcMain.handle('caps:cacheGet', async (_e, key: unknown): Promise<CapsCacheGetResult> => {
    if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) return { ok: true, value: null }
    const value = await cacheGet(root, key)
    return { ok: true, value }
  })

  ipcMain.handle('caps:cacheSet', async (_e, key: unknown, value: unknown): Promise<CapsCacheSetResult> => {
    if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) return { ok: false, error: '缓存键必须是 hashKey 的产物' }
    await cacheSet(root, key, value)
    return { ok: true }
  })

  /* ---------- Files API（可选能力；四端点只暴露有 UI 消费的三条 + 单条检索） ---------- */

  ipcMain.handle('caps:files:list', async (_e, req: CapsFilesListRequest): Promise<CapsFilesListResult> => {
    try {
      if (!req?.engine?.apiKey) return { ok: false, error: '尚未配置 DeepSeek API Key' }
      return await deepseekFilesList(req)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '列出文件失败' }
    }
  })

  ipcMain.handle('caps:files:create', async (_e, req: CapsFilesCreateRequest): Promise<CapsFilesCreateResult> => {
    try {
      if (!req?.engine?.apiKey) return { ok: false, error: '尚未配置 DeepSeek API Key' }
      return await deepseekFilesCreate(req)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '上传文件失败' }
    }
  })

  ipcMain.handle('caps:files:retrieve', async (_e, req: CapsFilesRetrieveRequest): Promise<CapsFilesRetrieveResult> => {
    try {
      if (!req?.engine?.apiKey) return { ok: false, error: '尚未配置 DeepSeek API Key' }
      if (!req.fileId) return { ok: false, error: '缺少文件 ID' }
      const res = await fetch(`https://api.deepseek.com/files/${encodeURIComponent(req.fileId)}`, {
        headers: { Authorization: `Bearer ${req.engine.apiKey}` },
      })
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const parsed = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!parsed?.id) return { ok: false, error: '响应缺少文件对象' }
      const file: CapsFileEntry = {
        id: String(parsed.id),
        object: String(parsed.object ?? 'file'),
        bytes: Number(parsed.bytes ?? 0),
        created_at: Number(parsed.created_at ?? 0),
        filename: String(parsed.filename ?? ''),
        purpose: String(parsed.purpose ?? ''),
        ...(typeof parsed.expires_at === 'number' ? { expires_at: parsed.expires_at } : {}),
      }
      return { ok: true, file }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '查询文件失败' }
    }
  })

  ipcMain.handle('caps:files:delete', async (_e, req: CapsFilesDeleteRequest): Promise<CapsFilesDeleteResult> => {
    try {
      if (!req?.engine?.apiKey) return { ok: false, error: '尚未配置 DeepSeek API Key' }
      return await deepseekFilesDelete(req)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '删除文件失败' }
    }
  })
}

/** 供 WebUI 服务端路由复用的转发入口（server/routes/capabilities.ts）：与 IPC 同一套分流 */
export async function dispatchCapsOcr(req: CapsOcrRequest): Promise<CapsOcrResult> {
  if (req.engine.kind === 'system') {
    const r = await systemOcr(req.imageDataUrl)
    if (r.lines.length > 0) return { ok: true as const, text: r.fullText, lines: r.lines }
    return { ok: false as const, error: r.rawOcrText ?? '系统 OCR 未识别出文字' }
  }
  return req.engine.kind === 'deepseek' ? deepseekOcr(req) : localOcr(req)
}

export async function dispatchCapsTts(req: CapsTtsRequest): Promise<CapsTtsResult> {
  return req.engine.kind === 'deepseek' ? deepseekTts(req) : localTts(req)
}

export async function dispatchCapsStt(req: CapsSttRequest): Promise<CapsSttResult> {
  const wav = encodeWavFromFloat32(req.samples, req.sampleRate || 16_000)
  return req.engine.kind === 'deepseek' ? deepseekAsr(req, wav) : localStt(req, wav)
}

export { cacheGet, cacheSet }
