/**
 * 这个文件负责什么：IPC 契约的**语音模型与识别**通道组——模型文件/状态/下载进度、
 * 下载结果与识别请求/结果（见 electron/voice.ts）。
 * 原先与其它组同写在 shared/ipc.ts，按通道组拆到这里；形状逐字未动，
 * 对外一律经门面 shared/ipc.ts 原样转出，调用方 import 路径不变。
 */

/* ---------- 语音模型与识别 ---------- */

/**
 * 语音模型（SenseVoiceSmall，sherpa-onnx 导出的 int8 ONNX）里的一个文件。
 * 谁在用：主进程 electron/voice.ts 的 statusOf、渲染层 src/lib/voice/model.ts 的进度显示。
 */
export interface VoiceModelFile {
  name: string
  /** 已经下回来多少字节（没下就是 0） */
  bytes: number
  /** 下完应该是多少字节 */
  expect: number
  done: boolean
}

/** 语音模型在本机的状态。
 *  谁在用：主进程 electron/voice.ts 的 statusOf、preload 的 voice.modelStatus，
 *  渲染层 src/lib/voice/model.ts。 */
export interface VoiceModelStatus {
  /** 模型目录（点「在文件夹中显示」打开的就是它） */
  dir: string
  /** 主模型文件（model.int8.onnx）的完整路径 */
  path: string
  /** 全部文件都下齐了才算 true */
  exists: boolean
  /** 已经下回来多少字节（合计） */
  bytes: number
  /** 全部下齐是多少字节（合计） */
  totalBytes: number
  files: VoiceModelFile[]
  /** 官方下载地址（模型目录页） */
  url: string
  /** 有哪几个下载源（官方 + 国内镜像） */
  sources: string[]
}

/** 下载进度（主进程每 512 KB 推一次）。
 *  谁在用：主进程 electron/voice.ts 推送的 voice:modelProgress、preload 的 voice.onModelProgress，
 *  渲染层 src/lib/voice/model.ts。 */
export interface VoiceModelProgress {
  received: number
  total: number
  percent: number
  /** 一句话进度说明（换源、开始下载、正在下哪个文件时给） */
  note?: string
}

/** 下载（或换一份）语音模型的结果。
 *  谁在用：主进程 electron/voice.ts、preload 的 voice.downloadModel / voice.chooseModel。 */
export interface VoiceDownloadResult {
  ok: boolean
  error?: string
  bytes?: number
  /** 这一份是从哪个源下回来的（界面要告诉用户，出问题时好排查） */
  source?: string
}

/**
 * 一次识别请求：16 kHz 单声道 PCM（-1..1）+ 两个偏好。
 * 谁在用：渲染层 src/lib/voice/session.ts 经 preload 的 voice.transcribe 递过来。
 */
export interface VoiceTranscribeRequest {
  samples: Float32Array
  sampleRate: number
  /** 识别语言：auto（默认）/ zh / en / ja / ko / yue */
  language: string
  /** 走不走 GPU（显卡提供者起不来时主进程会当场退回 CPU，回执里说明） */
  gpu: boolean
}

/** 一次识别的结果。text 为空串是正常的（那一段没有人声）。
 *  谁在用：主进程 electron/voice.ts、渲染层 src/lib/voice/session.ts。 */
export interface VoiceTranscribeResult {
  ok: boolean
  text?: string
  error?: string
  /** 这一趟实际用的后端：gpu / cpu（退回时界面能说清为什么慢） */
  backend?: 'gpu' | 'cpu'
  /** 退回 CPU 的原因（一句话） */
  fallbackReason?: string
  /** 这一趟花了多少毫秒（调试与「怎么这么久」的排查） */
  ms?: number
}

