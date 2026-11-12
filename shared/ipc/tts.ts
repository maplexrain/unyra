/**
 * TTS (语音合成) 主进程与渲染层跨进程 IPC 契约定义。
 */

export interface TtsModelFile {
  name: string
  bytes: number
  expect: number
  done: boolean
}

export interface TtsModelStatus {
  dir: string
  path: string
  exists: boolean
  bytes: number
  totalBytes: number
  files: TtsModelFile[]
  url: string
  sources: string[]
}

export interface TtsModelProgress {
  received: number
  total: number
  percent: number
  note?: string
}

export interface TtsDownloadResult {
  ok: boolean
  error?: string
  bytes?: number
}

export interface TtsSynthesizeRequest {
  text: string
  speed?: number
  speakerId?: number
}

export interface TtsSynthesizeResult {
  ok: boolean
  error?: string
  /** 音频文件的 base64 或 dataUrl (audio/wav) */
  audioDataUrl?: string
  durationMs?: number
}
