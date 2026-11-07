/**
 * 这个文件负责什么：IPC 契约的**OCR 文字识别**通道组——识别结果结构、模型清单/状态/
 * 进度与下载、识别请求/结果（见 electron/ocr.ts）。
 * 原先与其它组同写在 shared/ipc.ts，按通道组拆到这里；形状逐字未动，
 * 对外一律经门面 shared/ipc.ts 原样转出，调用方 import 路径不变。
 */

/* ---------- OCR 文字识别 ---------- */

export interface OcrBBox {
  /** 归一化坐标 0~1，相对于页面宽度与高度 */
  x: number
  y: number
  width: number
  height: number
}

export interface OcrWordItem {
  text: string
  bbox: OcrBBox
  confidence?: number
}

export interface OcrLineItem {
  text: string
  bbox: OcrBBox
  words?: OcrWordItem[]
  confidence?: number
}

export interface OcrPageResult {
  page: number
  lines: OcrLineItem[]
  fullText: string
  modelId: string
  createdAt: number
}

export interface OcrModelOption {
  id: string
  name: string
  description: string
  sizeMb: number
  exists: boolean
  bytes: number
  totalBytes: number
  tags: string[]
}

export interface OcrModelStatus {
  activeModelId: string
  models: OcrModelOption[]
  sources: Array<{ id: string; name: string; speedHint: string }>
  dir: string
}

export interface OcrModelProgress {
  modelId: string
  received: number
  total: number
  percent: number
  note?: string
}

export interface OcrDownloadRequest {
  modelId: string
  sourceId?: string
}

export interface OcrDownloadResult {
  ok: boolean
  modelId?: string
  error?: string
  source?: string
  bytes?: number
}

export interface OcrRecognizeRequest {
  imageDataUrl: string
  modelId?: string
  page?: number
}

export interface OcrRecognizeResult {
  ok: boolean
  error?: string
  result?: OcrPageResult
  fromCache?: boolean
  durationMs?: number
}

