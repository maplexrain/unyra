/**
 * TTS (文本转语音) 系统的核心类型定义与适配器接口。
 *
 * 采用适配器模式（Adapter Pattern）：
 * 将浏览器原生 Web Speech、模型能力（DeepSeek 官方或用户自架的 OpenAI 兼容本地服务）
 * 等不同实现统一收敛为标准 TTSAdapter。
 */

export interface TTSVoice {
  id: string
  name: string
  lang: string
  gender?: 'male' | 'female' | 'neutral'
  localService?: boolean
}

export interface TTSSpeakOptions {
  voiceId?: string
  /** 语速：0.5 ~ 2.0，默认 1.0 */
  rate?: number
  /** 音调：0.5 ~ 2.0，默认 1.0 */
  pitch?: number
  /** 音量：0.0 ~ 1.0，默认 1.0 */
  volume?: number
  onStart?: () => void
  onEnd?: () => void
  onError?: (error: Error) => void
  onPause?: () => void
  onResume?: () => void
}

export type TTSPlaybackState = 'idle' | 'loading' | 'playing' | 'paused'

/**
 * 统一 TTS 适配器契约：
 * 所有具体的发音源（系统原生、云端 API、本地离线模型等）必须实现此接口。
 */
export interface TTSAdapter {
  /** 适配器唯一标识，如 'web-speech' | 'model-caps' */
  readonly id: string
  /** 人类可读名称 */
  readonly name: string
  /** 适配器特性描述或运行说明 */
  readonly description: string

  /** 检查当前环境该适配器是否可用 */
  isAvailable(): Promise<boolean> | boolean

  /** 获取当前适配器支持的音色列表 */
  getVoices(): Promise<TTSVoice[]>

  /** 发起文本朗读 */
  speak(text: string, options?: TTSSpeakOptions): Promise<void>

  /** 暂停播放 */
  pause(): void

  /** 恢复播放 */
  resume(): void

  /** 停止播放并释放音频资源 */
  stop(): void
}
