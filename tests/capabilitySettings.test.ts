/**
 * 能力接入配置（ai/capabilitySettings）与提供商扩展字段的清洗/合成测试。
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAPABILITIES,
  cleanServerTools,
  engineFingerprint,
  normalizeCapabilities,
} from '../src/ai/capabilitySettings'
import { normalizeAiSettings, resolveProvider, type AiSettings } from '../src/ai/settings'
import { DEFAULT_PROVIDER_ID } from '../src/ai/providers'

describe('能力配置的清洗（normalizeCapabilities）', () => {
  it('空数据回落默认值：TTS 走系统原生，STT/OCR 关闭', () => {
    const caps = normalizeCapabilities(undefined)
    expect(caps).toEqual(DEFAULT_CAPABILITIES)
    expect(caps.tts.mode).toBe('system')
    expect(caps.stt.mode).toBe('off')
    expect(caps.ocr.purpose).toBe('text_recognition')
  })

  it('非法模式与畸形字段逐项丢弃，合法值原样保留', () => {
    const caps = normalizeCapabilities({
      tts: { mode: 'quantum', voiceId: 'tide' },
      stt: { mode: 'deepseek', language: '  zh ' },
      ocr: { mode: 'local', purpose: 'nope', local: { baseUrl: 'http://127.0.0.1:8000/v1/' } },
    })
    expect(caps.tts.mode).toBe('system')
    expect(caps.tts.voiceId).toBe('tide')
    expect(caps.stt.mode).toBe('deepseek')
    expect(caps.stt.language).toBe('zh')
    expect(caps.ocr.purpose).toBe('text_recognition')
    expect(caps.ocr.local?.baseUrl).toBe('http://127.0.0.1:8000/v1')
  })

  it('本地适配器的 baseUrl 不像 URL 就整个丢掉', () => {
    const caps = normalizeCapabilities({
      tts: { mode: 'local', local: { baseUrl: '127.0.0.1:8000' } },
    })
    expect(caps.tts.local).toBeUndefined()
  })

  it('引擎指纹：换模式/档位/音色任何一个都变', () => {
    const base = engineFingerprint('deepseek', 'text_recognition', 'stella')
    expect(base).not.toBe(engineFingerprint('local', 'text_recognition', 'stella'))
    expect(base).not.toBe(engineFingerprint('deepseek', 'rich_layout_recognition', 'stella'))
    expect(base).not.toBe(engineFingerprint('deepseek', 'text_recognition', 'tide'))
    expect(base).toBe(engineFingerprint('deepseek', 'text_recognition', 'stella'))
  })
})

describe('服务端工具与 Files 开关的清洗', () => {
  it('半份开关（只给一个键）整个丢弃，回落预设默认', () => {
    expect(cleanServerTools({ webSearch: true })).toBeUndefined()
    expect(cleanServerTools('yes')).toBeUndefined()
    expect(cleanServerTools({ webSearch: false, readUrl: true })).toEqual({ webSearch: false, readUrl: true })
  })
})

describe('resolveProvider 的服务端工具 / Files 合成', () => {
  const baseSettings = (): AiSettings =>
    normalizeAiSettings({
      version: 3,
      providers: [{ id: DEFAULT_PROVIDER_ID, kind: 'provider', apiKey: 'sk-test', models: ['deepseek-flash'] }],
      global: { providerId: DEFAULT_PROVIDER_ID, model: 'deepseek-flash', effort: 'medium' },
    })

  it('DeepSeek 预设开箱即用：用户没设置时服务端工具全开、Files 默认开', () => {
    const resolved = resolveProvider(baseSettings())
    expect(resolved.serverTools).toEqual({ webSearch: true, readUrl: true })
    expect(resolved.files).toEqual({ enabled: true })
  })

  it('用户显式设置覆盖预设默认', () => {
    const settings = baseSettings()
    settings.providers = settings.providers.map((p) => ({ ...p, serverTools: { webSearch: false, readUrl: true }, files: { enabled: false } }))
    const resolved = resolveProvider(settings)
    expect(resolved.serverTools).toEqual({ webSearch: false, readUrl: true })
    expect(resolved.files).toEqual({ enabled: false })
  })

  it('非 DeepSeek 提供商：没有预设声明就不出现这两个字段', () => {
    const settings = normalizeAiSettings({
      version: 3,
      providers: [{ id: 'moonshot', kind: 'provider', apiKey: 'k', models: ['kimi-k2.5'] }],
      global: { providerId: 'moonshot', model: 'kimi-k2.5', effort: 'medium' },
    })
    const resolved = resolveProvider(settings)
    expect(resolved.serverTools).toBeUndefined()
    expect(resolved.files).toBeUndefined()
  })

  it('能力配置挂在 AiSettings 上随 normalize 落盘往返', () => {
    const settings = baseSettings()
    settings.capabilities = normalizeCapabilities({ tts: { mode: 'deepseek', voiceId: 'tide' } })
    const round = normalizeAiSettings(JSON.parse(JSON.stringify(settings)))
    expect(round.capabilities?.tts.mode).toBe('deepseek')
    expect(round.capabilities?.tts.voiceId).toBe('tide')
  })
})
