/**
 * 语音模型的渲染层入口：问状态、下载、换一份、删掉。
 *
 * 真正干活的在主进程（见 electron/voice.ts）——渲染层的 CSP 只允许连 llm-proxy:，
 * 直连 huggingface.co 会被拦掉；推理也在那边（sherpa-onnx 的原生构建）。
 * 这里只做三件事：把主进程的状态问出来、把进度订阅转发给界面、把动作转过去。
 */

import { t } from '../../i18n'
import { native, type VoiceModelProgress, type VoiceModelStatus } from '../native'

export type ModelStatus = VoiceModelStatus

/** 模型的名字与体积：界面文案与「能不能开」的守卫都用它，只写一处 */
export const VOICE_MODEL_NAME = 'SenseVoiceSmall'
export const VOICE_MODEL_MB = 228

/** 模型在不在本机（全都下齐了才算） */
export function modelStatus(): Promise<ModelStatus> {
  return native().voice.modelStatus()
}

/** 订阅下载进度；返回取消订阅函数（组件卸载时必须调用） */
export function onModelProgress(cb: (p: VoiceModelProgress) => void): () => void {
  return native().voice.onModelProgress(cb)
}

/**
 * 下 SenseVoiceSmall（约 228 MB）。
 * 主进程会按「官方源 → 国内镜像」的顺序试（见 electron/voice.ts），
 * 回来时带上用的是哪个源。失败返回一句中文说明，不抛。
 */
export async function downloadModel(): Promise<{ ok: boolean; error?: string; source?: string }> {
  const res = await native().voice.downloadModel()
  return res.ok ? { ok: true, source: res.source } : { ok: false, error: res.error ?? t('下载失败') }
}

export function cancelDownload(): Promise<boolean> {
  return native().voice.cancelDownload()
}

/** 从本机挑一份模型（离线环境用）：挑 model.int8.onnx，词表从同一个目录里找 */
export function chooseModelFile(): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
  return native().voice.chooseModel()
}

export function removeModel(): Promise<{ ok: boolean; error?: string }> {
  return native().voice.removeModel()
}

export function revealModel(): Promise<boolean> {
  return native().voice.revealModel()
}

/** 人类可读的体积：设置面板里显示「已下载 228 MB」 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / 1024 / 1024).toFixed(0) + ' MB'
}
