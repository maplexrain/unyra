/**
 * 基于浏览器/Electron 原生 Web Speech API 的 TTS 适配器。
 *
 * 特点：
 * - 零依赖、零网络请求、零 API Key；
 * - 纯端侧调用操作系统内置 TTS 引擎（如 Windows SAPI / Microsoft Natural Voices）；
 * - 开箱即用，是响应最快、可用性最高的保底适配器。
 */

import { cleanTextForSpeech } from '../cleanText'
import type { TTSAdapter, TTSSpeakOptions, TTSVoice } from '../types'

export class WebSpeechAdapter implements TTSAdapter {
  readonly id = 'web-speech'
  readonly name = '系统原生语音 (Web Speech)'
  readonly description = '调用操作系统内置语音合成引擎，零流量、零门槛免配置开箱即用。'

  private currentUtterance: SpeechSynthesisUtterance | null = null
  private isSpeaking = false

  isAvailable(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
  }

  async getVoices(): Promise<TTSVoice[]> {
    if (!this.isAvailable()) return []

    const synth = window.speechSynthesis
    let voices = synth.getVoices()

    // Chromium 中 getVoices 首次调用可能为空，需等待 voiceschanged 事件
    if (voices.length === 0) {
      await new Promise<void>((resolve) => {
        const handler = () => {
          synth.removeEventListener('voiceschanged', handler)
          voices = synth.getVoices()
          resolve()
        }
        synth.addEventListener('voiceschanged', handler)
        // 500ms 超时保底
        setTimeout(() => {
          synth.removeEventListener('voiceschanged', handler)
          resolve()
        }, 500)
      })
    }

    return voices.map((v) => ({
      id: v.voiceURI || v.name,
      name: v.name,
      lang: v.lang,
      gender: v.name.toLowerCase().includes('female')
        ? 'female'
        : v.name.toLowerCase().includes('male')
          ? 'male'
          : 'neutral',
      localService: v.localService,
    }))
  }

  async speak(text: string, options?: TTSSpeakOptions): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('当前环境不支持 Web Speech API')
    }

    this.stop()

    const cleaned = cleanTextForSpeech(text)
    if (!cleaned) return

    const synth = window.speechSynthesis
    // 某些 Chromium 版本在后台挂起时可能会卡在 paused 状态，先 cancel 彻底复位
    synth.cancel()

    const utter = new SpeechSynthesisUtterance(cleaned)
    this.currentUtterance = utter
    this.isSpeaking = true

    if (options?.rate) utter.rate = Math.max(0.5, Math.min(2.0, options.rate))
    if (options?.pitch) utter.pitch = Math.max(0.5, Math.min(2.0, options.pitch))
    if (options?.volume) utter.volume = Math.max(0.0, Math.min(1.0, options.volume))

    // 选择音色：若指定了 voiceId 则查找匹配；否则优先选中文自然人声
    const voices = synth.getVoices()
    if (options?.voiceId) {
      const match = voices.find((v) => v.voiceURI === options.voiceId || v.name === options.voiceId)
      if (match) utter.voice = match
    } else {
      // 优先匹配中文语言的音色（如 Xiaoxiao, Yaoyao, Huihui 或 zh-CN）
      const preferred =
        voices.find((v) => v.lang.startsWith('zh') && (v.name.includes('Natural') || v.name.includes('Xiaoxiao') || v.name.includes('Yunxi'))) ||
        voices.find((v) => v.lang.startsWith('zh')) ||
        voices[0]
      if (preferred) utter.voice = preferred
    }

    return new Promise((resolve, reject) => {
      utter.onstart = () => {
        options?.onStart?.()
      }

      utter.onend = () => {
        this.isSpeaking = false
        this.currentUtterance = null
        options?.onEnd?.()
        resolve()
      }

      utter.onerror = (e) => {
        // 'canceled' / 'interrupted' 通常是用户主动 stop() 触发的，不作为异常抛出
        if (e.error === 'canceled' || e.error === 'interrupted') {
          this.isSpeaking = false
          this.currentUtterance = null
          options?.onEnd?.()
          resolve()
          return
        }
        this.isSpeaking = false
        this.currentUtterance = null
        const err = new Error(`Web Speech 合成失败: ${e.error}`)
        options?.onError?.(err)
        reject(err)
      }

      synth.speak(utter)
    })
  }

  pause(): void {
    if (this.isAvailable() && this.isSpeaking) {
      window.speechSynthesis.pause()
    }
  }

  resume(): void {
    if (this.isAvailable()) {
      window.speechSynthesis.resume()
    }
  }

  stop(): void {
    if (this.isAvailable()) {
      window.speechSynthesis.cancel()
    }
    if (this.currentUtterance) {
      this.currentUtterance = null
    }
    this.isSpeaking = false
  }
}
