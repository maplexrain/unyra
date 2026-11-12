/**
 * 基于 OpenAI 兼容协议 (/v1/audio/speech) 的在线云端 TTS 适配器。
 *
 * 适用于：
 * - OpenAI 官方 TTS 服务；
 * - 硅基流动 (SiliconFlow)、通义千问等兼容 OpenAI 协议的第三方云服务商；
 * - 各种支持 OpenAI 协议规范的本地开源服务或反向代理（如 OneAPI）。
 */

import { cleanTextForSpeech } from '../cleanText'
import type { TTSAdapter, TTSSpeakOptions, TTSVoice } from '../types'

export interface OpenAICompatibleConfig {
  baseUrl: string
  apiKey: string
  model?: string
  defaultVoice?: string
}

const PRESET_VOICES: TTSVoice[] = [
  { id: 'alloy', name: 'Alloy (自然中性)', lang: 'zh/en' },
  { id: 'echo', name: 'Echo (沉稳男声)', lang: 'zh/en', gender: 'male' },
  { id: 'fable', name: 'Fable (英伦语调)', lang: 'zh/en' },
  { id: 'onyx', name: 'Onyx (磁性浑厚)', lang: 'zh/en', gender: 'male' },
  { id: 'nova', name: 'Nova (活泼女声)', lang: 'zh/en', gender: 'female' },
  { id: 'shimmer', name: 'Shimmer (温柔清脆)', lang: 'zh/en', gender: 'female' },
]

export class OpenAICompatibleTTSAdapter implements TTSAdapter {
  readonly id = 'openai-compatible'
  readonly name = '云端 API (OpenAI 协议兼容)'
  readonly description = '接入 OpenAI 或兼容服务商（如 SiliconFlow）的高拟真神经拟人音色。'

  private config: OpenAICompatibleConfig = {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'tts-1',
    defaultVoice: 'alloy',
  }

  private currentAudio: HTMLAudioElement | null = null
  private objectUrl: string | null = null

  constructor(initialConfig?: Partial<OpenAICompatibleConfig>) {
    if (initialConfig) {
      this.updateConfig(initialConfig)
    }
  }

  updateConfig(cfg: Partial<OpenAICompatibleConfig>): void {
    this.config = { ...this.config, ...cfg }
  }

  isAvailable(): boolean {
    return Boolean(this.config.apiKey && this.config.baseUrl)
  }

  async getVoices(): Promise<TTSVoice[]> {
    return PRESET_VOICES
  }

  async speak(text: string, options?: TTSSpeakOptions): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('云端 TTS 尚未配置有效的 API Key 与 Base URL')
    }

    this.stop()

    const cleaned = cleanTextForSpeech(text)
    if (!cleaned) return

    const baseUrl = this.config.baseUrl.replace(/\/+$/, '')
    const url = `${baseUrl}/audio/speech`

    const voice = options?.voiceId || this.config.defaultVoice || 'alloy'
    const speed = options?.rate || 1.0

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model || 'tts-1',
        input: cleaned,
        voice,
        speed,
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`云端 TTS 请求失败 (${res.status}): ${errText || res.statusText}`)
    }

    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    this.objectUrl = blobUrl

    const audio = new Audio(blobUrl)
    this.currentAudio = audio

    if (options?.volume !== undefined) {
      audio.volume = Math.max(0, Math.min(1, options.volume))
    }

    return new Promise((resolve, reject) => {
      audio.onplay = () => {
        options?.onStart?.()
      }

      audio.onended = () => {
        this.cleanup()
        options?.onEnd?.()
        resolve()
      }

      audio.onerror = () => {
        this.cleanup()
        const err = new Error('音频播放失败')
        options?.onError?.(err)
        reject(err)
      }

      audio.play().catch((err) => {
        this.cleanup()
        options?.onError?.(err)
        reject(err)
      })
    })
  }

  pause(): void {
    this.currentAudio?.pause()
  }

  resume(): void {
    void this.currentAudio?.play().catch(() => undefined)
  }

  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause()
      this.cleanup()
    }
  }

  private cleanup(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl)
      this.objectUrl = null
    }
    this.currentAudio = null
  }
}
