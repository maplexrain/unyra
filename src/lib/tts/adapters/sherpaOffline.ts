/**
 * 基于 Sherpa-ONNX 本地离线神经网络的 TTS 适配器。
 *
 * 支持多款高品质端侧离线模型并允许随时切换：
 * - MeloTTS: 44.1kHz 超清 CD 级音质，支持中英文自然混读，约 60MB；
 * - AISHELL-3: 8kHz 极速轻量，内置 174 位发音人，约 42MB。
 *
 * 特性：
 * - 纯端侧离线推理，不经过任何云端网络，隐私零外泄；
 * - 毫秒级极速生成，发音清晰自然；
 * - 首次使用时按需下载，不随安装包分发。
 */

import { cleanTextForSpeech } from '../cleanText'
import type { TTSAdapter, TTSSpeakOptions, TTSVoice } from '../types'
import { isWeb, native } from '../../native'

export const STORAGE_ACTIVE_OFFLINE_MODEL = 'moji-tts-active-offline-model'
export const DEFAULT_OFFLINE_MODEL = 'vits-melo-tts-zh_en'

export class SherpaOfflineTTSAdapter implements TTSAdapter {
  readonly id = 'sherpa-offline'
  readonly name = '本地离线模型 (Sherpa-ONNX · VITS)'
  readonly description = '纯端侧运行的高保真神经网络模型，零云端网络依赖，支持 44.1kHz MeloTTS 与 AISHELL-3 等多种优质音色。'

  private currentAudio: HTMLAudioElement | null = null

  getActiveModelId(): string {
    try {
      return localStorage.getItem(STORAGE_ACTIVE_OFFLINE_MODEL) || DEFAULT_OFFLINE_MODEL
    } catch {
      return DEFAULT_OFFLINE_MODEL
    }
  }

  setActiveModelId(modelId: string): void {
    try {
      localStorage.setItem(STORAGE_ACTIVE_OFFLINE_MODEL, modelId)
    } catch {}
  }

  async isAvailable(): Promise<boolean> {
    if (isWeb() || !window.mojiNative?.tts) return false
    try {
      const modelId = this.getActiveModelId()
      const status = await native().tts.modelStatus(modelId)
      return status.exists
    } catch {
      return false
    }
  }

  async getVoices(): Promise<TTSVoice[]> {
    if (isWeb() || !window.mojiNative?.tts) {
      return [
        { id: '0', name: 'MeloTTS 自然女声 (44.1kHz 高保真)', lang: 'zh/en', gender: 'female', localService: true },
      ]
    }
    try {
      const activeModelId = this.getActiveModelId()
      const status = await native().tts.modelStatus(activeModelId)
      const currentDef = status.availableModels?.find((m) => m.id === activeModelId)
      if (currentDef && currentDef.speakers && currentDef.speakers.length > 0) {
        return currentDef.speakers.map((s) => ({
          id: s.id,
          name: s.name,
          lang: s.lang || 'zh-CN',
          gender: s.gender as any,
          localService: true,
        }))
      }
    } catch {}
    return [
      { id: '0', name: 'MeloTTS 自然女声 (44.1kHz 高保真)', lang: 'zh/en', gender: 'female', localService: true },
    ]
  }

  async speak(text: string, options?: TTSSpeakOptions): Promise<void> {
    if (isWeb() || !window.mojiNative?.tts) {
      throw new Error('Web 浏览器环境暂不支持本地离线推理，请使用桌面客户端')
    }

    const available = await this.isAvailable()
    if (!available) {
      throw new Error('当前选中的本地离线语音模型尚未下载，请前往【设置 → 插件 → 语音合成】进行下载')
    }

    this.stop()

    const cleaned = cleanTextForSpeech(text)
    if (!cleaned) return

    const speakerId = options?.voiceId ? Number.parseInt(options.voiceId, 10) || 0 : 0
    const speed = options?.rate || 1.0
    const modelId = this.getActiveModelId()

    const res = await native().tts.synthesize({
      text: cleaned,
      speed,
      speakerId,
      modelId,
    })

    if (!res.ok || !res.audioDataUrl) {
      throw new Error(res.error || '离线语音合成失败')
    }

    const audio = new Audio(res.audioDataUrl)
    this.currentAudio = audio

    if (options?.volume !== undefined) {
      audio.volume = Math.max(0, Math.min(1, options.volume))
    }

    return new Promise((resolve, reject) => {
      audio.onplay = () => {
        options?.onStart?.()
      }

      audio.onended = () => {
        this.currentAudio = null
        options?.onEnd?.()
        resolve()
      }

      audio.onerror = () => {
        this.currentAudio = null
        const err = new Error('离线音频解码播放失败')
        options?.onError?.(err)
        reject(err)
      }

      audio.play().catch((err) => {
        this.currentAudio = null
        options?.onError?.(err)
        reject(err)
      })
    })
  }

  pause(): void {
    if (this.currentAudio && !this.currentAudio.paused) {
      this.currentAudio.pause()
    }
  }

  resume(): void {
    if (this.currentAudio && this.currentAudio.paused) {
      this.currentAudio.play().catch(() => {})
    }
  }

  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause()
      this.currentAudio.currentTime = 0
      this.currentAudio = null
    }
  }
}
