/**
 * 基于 Sherpa-ONNX 本地离线神经网络的 TTS 适配器 (VITS aishell3 轻量版)。
 *
 * 特性：
 * - 纯端侧离线推理，不经过任何云端网络，隐私零外泄；
 * - 毫秒级极速生成，发音清晰自然；
 * - 多达 174 位预设说话人；
 * - 首次使用时按需下载（仅约 42MB），不随安装包分发。
 */

import { cleanTextForSpeech } from '../cleanText'
import type { TTSAdapter, TTSSpeakOptions, TTSVoice } from '../types'
import { isWeb, native } from '../../native'

const PRESET_SPEAKERS: TTSVoice[] = [
  { id: '0', name: '播音女声 (ID: 0)', lang: 'zh-CN', gender: 'female', localService: true },
  { id: '17', name: '甜美女声 (ID: 17)', lang: 'zh-CN', gender: 'female', localService: true },
  { id: '60', name: '清亮女声 (ID: 60)', lang: 'zh-CN', gender: 'female', localService: true },
  { id: '1', name: '自然男声 (ID: 1)', lang: 'zh-CN', gender: 'male', localService: true },
  { id: '45', name: '稳重男声 (ID: 45)', lang: 'zh-CN', gender: 'male', localService: true },
  { id: '88', name: '磁性男声 (ID: 88)', lang: 'zh-CN', gender: 'male', localService: true },
]

export class SherpaOfflineTTSAdapter implements TTSAdapter {
  readonly id = 'sherpa-offline'
  readonly name = '本地离线模型 (Sherpa-ONNX · VITS)'
  readonly description = '完全端侧运行的极速轻量 VITS 神经网络模型（约 42MB），零网络依赖，支持 174 位音色。'

  private currentAudio: HTMLAudioElement | null = null

  async isAvailable(): Promise<boolean> {
    if (isWeb() || !window.mojiNative?.tts) return false
    try {
      const status = await native().tts.modelStatus()
      return status.exists
    } catch {
      return false
    }
  }

  async getVoices(): Promise<TTSVoice[]> {
    return PRESET_SPEAKERS
  }

  async speak(text: string, options?: TTSSpeakOptions): Promise<void> {
    if (isWeb() || !window.mojiNative?.tts) {
      throw new Error('Web 浏览器环境暂不支持本地离线推理，请使用桌面客户端')
    }

    const available = await this.isAvailable()
    if (!available) {
      throw new Error('本地离线语音模型尚未下载，请前往【设置 → 插件 → 语音合成】进行下载')
    }

    this.stop()

    const cleaned = cleanTextForSpeech(text)
    if (!cleaned) return

    const speakerId = options?.voiceId ? Number.parseInt(options.voiceId, 10) || 0 : 0
    const speed = options?.rate || 1.0

    const res = await native().tts.synthesize({
      text: cleaned,
      speed,
      speakerId,
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
    this.currentAudio?.pause()
  }

  resume(): void {
    void this.currentAudio?.play().catch(() => undefined)
  }

  stop(): void {
    if (this.currentAudio) {
      this.currentAudio.pause()
      this.currentAudio = null
    }
  }
}
