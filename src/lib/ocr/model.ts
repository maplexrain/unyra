/**
 * OCR 模型的渲染层调用与状态管理。
 *
 * 封装与 Electron 主进程之间的 IPC 通道，提供多模型下载进度监听、
 * 镜像源切换、本地模型导入与删除等能力。
 */

import { t } from '../../i18n'
import {
  native,
  type OcrDownloadRequest,
  type OcrDownloadResult,
  type OcrModelOption,
  type OcrModelProgress,
  type OcrModelStatus,
} from '../native'

export type {
  OcrDownloadRequest,
  OcrDownloadResult,
  OcrModelOption,
  OcrModelProgress,
  OcrModelStatus,
}

/** 查询所有 OCR 模型与下载源状态 */
export async function setActiveOcrModel(modelId: string): Promise<boolean> {
  try {
    return await native().ocr.setActiveModel(modelId)
  } catch {
    return false
  }
}

export async function ocrModelStatus(): Promise<OcrModelStatus> {
  try {
    return await native().ocr.modelStatus()
  } catch {
    return {
      activeModelId: 'pp-ocrv4-mobile',
      models: [],
      sources: [],
      dir: '',
    }
  }
}

/** 订阅下载进度事件；返回取消订阅函数 */
export function onOcrModelProgress(cb: (p: OcrModelProgress) => void): () => void {
  try {
    return native().ocr.onModelProgress(cb)
  } catch {
    return () => {}
  }
}

/**
 * 启动下载指定的 OCR 模型。
 * @param modelId 模型唯一 ID（如 pp-ocrv4-mobile / pp-ocrv4-server 等）
 * @param sourceId 指定的下载源 ID（如 hf-mirror / huggingface / modelscope 等）
 */
export async function downloadOcrModel(
  modelId: string,
  sourceId?: string,
): Promise<OcrDownloadResult> {
  try {
    const res = await native().ocr.downloadModel({ modelId, sourceId })
    return res.ok ? res : { ok: false, error: res.error ?? t('下载失败') }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : t('下载失败') }
  }
}

/** 取消当前正在进行的模型下载 */
export async function cancelOcrDownload(): Promise<boolean> {
  try {
    return await native().ocr.cancelDownload()
  } catch {
    return false
  }
}

/** 从本地挑一份离线 OCR 模型权重文件导入 */
export async function chooseOcrModelFile(): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
  try {
    return await native().ocr.chooseModel()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : t('导入失败') }
  }
}

/** 删除本地已下载的某款模型 */
export async function removeOcrModel(modelId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    return await native().ocr.removeModel(modelId)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : t('删除失败') }
  }
}

/** 在系统文件管理器中打开 OCR 模型存储目录 */
export async function revealOcrModelDir(): Promise<boolean> {
  try {
    return await native().ocr.revealModel()
  } catch {
    return false
  }
}

/** 字节格式化工具函数 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
