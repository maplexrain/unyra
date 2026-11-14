/**
 * 能力接入的门面：读「设置 → 模型 → 能力接入」的配置、判断各能力开没开、
 * 把配置装配成主进程认识的 engine 描述（shared/ipc/capabilities 的 CapsEngine）。
 *
 * 为什么要有这一层：调用点（PDF 文字层、录音会话、TTS 适配器）不该各自去翻
 * AI 设置的形状——它们只问三个问题：
 *   「这个能力开了吗」「引擎是谁」「引擎的参数齐了吗」。
 * DeepSeek 模式复用 DeepSeek 提供商的 API Key（与网络搜索同源，见 ai/settings 的
 * findReferencedDeepSeekKey）；本地模式用用户自架服务的地址。Key/地址缺了就不算开
 * ——调用点拿到 null 引擎时给用户一句「去设置里配」的提示，而不是发一个必败请求。
 */

import { findReferencedDeepSeekKey, loadAiSettings, subscribeAiSettings } from '../ai/settings'
import { DEFAULT_CAPABILITIES, type AiCapabilities, type LocalServiceConfig } from '../ai/capabilitySettings'
import type { CapsEngine } from '../../shared/ipc'

export function loadCapabilities(settings = loadAiSettings()): AiCapabilities {
  return settings.capabilities ?? DEFAULT_CAPABILITIES
}

/** 订阅能力配置变化（AI 设置的订阅口子转发——能力的落点就在 ai 片里） */
export function subscribeCapabilities(listener: () => void): () => void {
  return subscribeAiSettings(listener)
}

/**
 * 一个模式 + 本地配置 → 主进程认识的引擎描述；参数不齐返回 null。
 * DeepSeek 模式下 Key 来自已配置的 DeepSeek 提供商（用户填 Key 的地方只有一处）。
 */
export function capsEngineFor(mode: 'deepseek' | 'local', local?: LocalServiceConfig): CapsEngine | null {
  if (mode === 'deepseek') {
    const key = findReferencedDeepSeekKey()?.apiKey ?? ''
    return key ? { kind: 'deepseek', apiKey: key } : null
  }
  const baseUrl = local?.baseUrl?.trim()
  return baseUrl && /^https?:\/\//.test(baseUrl)
    ? { kind: 'local', baseUrl: baseUrl.replace(/\/+$/, ''), ...(local?.apiKey ? { apiKey: local.apiKey } : {}), ...(local?.model ? { model: local.model } : {}), ...(local?.voice ? { voice: local.voice } : {}) }
    : null
}

/* ---------- OCR ---------- */

export function capsOcrOn(): boolean {
  const caps = loadCapabilities()
  // system 模式没有本地参数要配（Windows 内置 OCR），接入即用
  if (caps.ocr.mode === 'system') return true
  return caps.ocr.mode !== 'off' && capsEngineFor(caps.ocr.mode, caps.ocr.local) !== null
}

/** OCR 的引擎与档位；没开 / 配置不齐返回 null */
export function ocrEngineOf(): { engine: CapsEngine; purpose: 'text_recognition' | 'rich_layout_recognition' } | null {
  const caps = loadCapabilities()
  if (caps.ocr.mode === 'off') return null
  if (caps.ocr.mode === 'system') return { engine: { kind: 'system' }, purpose: caps.ocr.purpose }
  const engine = capsEngineFor(caps.ocr.mode, caps.ocr.local)
  return engine ? { engine, purpose: caps.ocr.purpose } : null
}

/** OCR 接入了但参数没配齐（DeepSeek 没填 Key / 本地没填地址）：调用点据此提示去设置 */
export function ocrNeedsConfig(): boolean {
  const caps = loadCapabilities()
  if (caps.ocr.mode === 'system') return false
  return caps.ocr.mode !== 'off' && capsEngineFor(caps.ocr.mode, caps.ocr.local) === null
}

/* ---------- STT ---------- */

export function capsSttOn(): boolean {
  const caps = loadCapabilities()
  return caps.stt.mode !== 'off' && capsEngineFor(caps.stt.mode, caps.stt.local) !== null
}

/** STT 的引擎与识别语言；没开 / 配置不齐返回 null */
export function sttEngineOf(): { engine: CapsEngine; language: string } | null {
  const caps = loadCapabilities()
  if (caps.stt.mode === 'off') return null
  const engine = capsEngineFor(caps.stt.mode, caps.stt.local)
  return engine ? { engine, language: caps.stt.language || 'auto' } : null
}

/* ---------- TTS ---------- */

export type CapsTtsMode = 'system' | 'deepseek' | 'local' | 'off'

export function ttsModeOf(): CapsTtsMode {
  return loadCapabilities().tts.mode
}

/** TTS 的引擎与音色；system/off 或配置不齐返回 null */
export function ttsEngineOf(): { engine: CapsEngine; voiceId?: string } | null {
  const caps = loadCapabilities()
  if (caps.tts.mode !== 'deepseek' && caps.tts.mode !== 'local') return null
  const engine = capsEngineFor(caps.tts.mode, caps.tts.local)
  return engine ? { engine, voiceId: caps.tts.voiceId } : null
}
