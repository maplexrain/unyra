/**
 * TTS 适配器统一管理器 (TTSAdapterManager)
 *
 * 职责：
 * 1. 集中注册与管理所有 TTS 适配器（系统原生、云端 API、本地离线模型等）；
 * 2. 统一调度全局唯一的音频播放通道，防止多段声音同时发声冲突；
 * 3. 维护全局播放状态（播放中、暂停、停止、当前文本、语速），并通过订阅机制向 UI 响应式推送；
 * 4. 提供 React 专属 Hook `useTTS()` 供组件一键消费。
 */

import { useSyncExternalStore } from 'react'
import type { TTSAdapter, TTSSpeakOptions, TTSPlaybackState, TTSVoice } from './types'
import { WebSpeechAdapter } from './adapters/webSpeech'
import { OpenAICompatibleTTSAdapter } from './adapters/openaiCompatible'
import { SherpaOfflineTTSAdapter } from './adapters/sherpaOffline'

const STORAGE_ACTIVE_ADAPTER = 'moji:tts:activeAdapter'
const STORAGE_RATE = 'moji:tts:rate'

export interface TTSStateSnapshot {
  state: TTSPlaybackState
  activeAdapterId: string
  currentText: string | null
  rate: number
}

export class TTSAdapterManager {
  private adapters = new Map<string, TTSAdapter>()
  private activeId: string = 'web-speech'
  private playbackState: TTSPlaybackState = 'idle'
  private currentText: string | null = null
  private rate: number = 1.0
  private listeners = new Set<() => void>()
  private snapshot: TTSStateSnapshot = {
    state: 'idle',
    activeAdapterId: 'web-speech',
    currentText: null,
    rate: 1.0,
  }

  constructor() {
    // 1. 注册核心基础适配器
    this.registerAdapter(new WebSpeechAdapter())
    this.registerAdapter(new SherpaOfflineTTSAdapter())
    this.registerAdapter(new OpenAICompatibleTTSAdapter())

    // 2. 恢复偏好设置
    try {
      const savedAdapter = localStorage.getItem(STORAGE_ACTIVE_ADAPTER)
      if (savedAdapter && this.adapters.has(savedAdapter)) {
        this.activeId = savedAdapter
      }
      const savedRate = localStorage.getItem(STORAGE_RATE)
      if (savedRate) {
        const parsedRate = Number.parseFloat(savedRate)
        if (!Number.isNaN(parsedRate) && parsedRate >= 0.5 && parsedRate <= 2.0) {
          this.rate = parsedRate
        }
      }
    } catch {
      // ignore
    }
    this.updateSnapshot()
  }

  /** 注册新的 TTS 适配器（统一管理入口） */
  registerAdapter(adapter: TTSAdapter): void {
    this.adapters.set(adapter.id, adapter)
    this.notify()
  }

  /** 获取所有已登记的适配器 */
  getAdapters(): TTSAdapter[] {
    return Array.from(this.adapters.values())
  }

  /** 获取指定适配器 */
  getAdapter(id: string): TTSAdapter | undefined {
    return this.adapters.get(id)
  }

  /** 获取当前激活的适配器 */
  getActiveAdapter(): TTSAdapter {
    return this.adapters.get(this.activeId) || this.adapters.get('web-speech')!
  }

  /** 切换激活的适配器 */
  setActiveAdapter(id: string): void {
    if (this.adapters.has(id) && this.activeId !== id) {
      this.stop()
      this.activeId = id
      try {
        localStorage.setItem(STORAGE_ACTIVE_ADAPTER, id)
      } catch {}
      this.notify()
    }
  }

  /** 获取当前全局播放语速 */
  getRate(): number {
    return this.rate
  }

  /** 设置全局播放语速 */
  setRate(newRate: number): void {
    const clamped = Math.max(0.5, Math.min(2.0, Number(newRate.toFixed(2))))
    this.rate = clamped
    try {
      localStorage.setItem(STORAGE_RATE, String(clamped))
    } catch {}
    this.notify()
  }

  /** 获取当前可用音色列表 */
  async getVoices(): Promise<TTSVoice[]> {
    const adapter = this.getActiveAdapter()
    return adapter.getVoices()
  }

  /** 发起朗读 */
  async speak(text: string, options?: TTSSpeakOptions): Promise<void> {
    const adapter = this.getActiveAdapter()

    // 若当前正在朗读相同文本，则视为停止动作
    if (this.playbackState === 'playing' && this.currentText === text) {
      this.stop()
      return
    }

    // 切换前先完全停止已有播放
    this.stop()

    this.currentText = text
    this.playbackState = 'loading'
    this.notify()

    const mergedOptions: TTSSpeakOptions = {
      ...options,
      rate: options?.rate ?? this.rate,
      onStart: () => {
        this.playbackState = 'playing'
        this.notify()
        options?.onStart?.()
      },
      onEnd: () => {
        this.playbackState = 'idle'
        this.currentText = null
        this.notify()
        options?.onEnd?.()
      },
      onError: (err) => {
        this.playbackState = 'idle'
        this.currentText = null
        this.notify()
        options?.onError?.(err)
      },
      onPause: () => {
        this.playbackState = 'paused'
        this.notify()
        options?.onPause?.()
      },
      onResume: () => {
        this.playbackState = 'playing'
        this.notify()
        options?.onResume?.()
      },
    }

    try {
      await adapter.speak(text, mergedOptions)
    } catch (err) {
      this.playbackState = 'idle'
      this.currentText = null
      this.notify()
      throw err
    }
  }

  pause(): void {
    if (this.playbackState === 'playing') {
      const adapter = this.getActiveAdapter()
      adapter.pause()
      this.playbackState = 'paused'
      this.notify()
    }
  }

  resume(): void {
    if (this.playbackState === 'paused') {
      const adapter = this.getActiveAdapter()
      adapter.resume()
      this.playbackState = 'playing'
      this.notify()
    }
  }

  stop(): void {
    if (this.playbackState !== 'idle') {
      const adapter = this.getActiveAdapter()
      adapter.stop()
      this.playbackState = 'idle'
      this.currentText = null
      this.notify()
    }
  }

  /** 获取当前状态快照（用于 useSyncExternalStore，引用稳定） */
  getSnapshot = (): TTSStateSnapshot => {
    return this.snapshot
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private updateSnapshot(): void {
    this.snapshot = {
      state: this.playbackState,
      activeAdapterId: this.activeId,
      currentText: this.currentText,
      rate: this.rate,
    }
  }

  private notify(): void {
    this.updateSnapshot()
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {}
    }
  }
}

/** 全局单例管理器 */
export const ttsManager = new TTSAdapterManager()

/** React 响应式 Hook */
export function useTTS(): TTSStateSnapshot & {
  manager: TTSAdapterManager
  speak: (text: string, options?: TTSSpeakOptions) => Promise<void>
  pause: () => void
  resume: () => void
  stop: () => void
  setRate: (rate: number) => void
  setActiveAdapter: (id: string) => void
  adapters: TTSAdapter[]
} {
  const snapshot = useSyncExternalStore(ttsManager.subscribe, ttsManager.getSnapshot)

  return {
    ...snapshot,
    manager: ttsManager,
    speak: (text, opts) => ttsManager.speak(text, opts),
    pause: () => ttsManager.pause(),
    resume: () => ttsManager.resume(),
    stop: () => ttsManager.stop(),
    setRate: (rate) => ttsManager.setRate(rate),
    setActiveAdapter: (id) => ttsManager.setActiveAdapter(id),
    adapters: ttsManager.getAdapters(),
  }
}
