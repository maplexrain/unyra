/**
 * 语音模型的渲染层入口：问状态、下载、取字节。
 *
 * 真正干活的在主进程（见 electron/voice.ts）——渲染层的 CSP 只允许连 llm-proxy:，
 * 直连 huggingface.co 会被拦掉。这里只做三件事：把主进程的状态问出来、
 * 把进度订阅转发给界面、把字节取回来交给引擎。
 */

import { t } from '../../i18n'
import { native, type VoiceModelProgress, type VoiceModelStatus } from '../native'

export type ModelStatus = VoiceModelStatus

/** 模型在不在本机 */
export function modelStatus(): Promise<ModelStatus> {
  return native().voice.modelStatus()
}

/** 订阅下载进度；返回取消订阅函数（组件卸载时必须调用） */
export function onModelProgress(cb: (p: VoiceModelProgress) => void): () => void {
  return native().voice.onModelProgress(cb)
}

/**
 * 下一份 base q5_1（约 57 MB）。
 * 主进程会按「官方源 → 国内镜像」的顺序试（见 electron/voice.ts），
 * 回来时带上用的是哪个源。失败返回一句中文说明，不抛
 */
export async function downloadModel(): Promise<{ ok: boolean; error?: string; source?: string }> {
  const res = await native().voice.downloadModel()
  return res.ok ? { ok: true, source: res.source } : { ok: false, error: res.error ?? t('下载失败') }
}

export function cancelDownload(): Promise<boolean> {
  return native().voice.cancelDownload()
}

/** 从本机挑一份模型文件（离线环境用） */
export function chooseModelFile(): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
  return native().voice.chooseModel()
}

export function removeModel(): Promise<{ ok: boolean; error?: string }> {
  return native().voice.removeModel()
}

export function revealModel(): Promise<boolean> {
  return native().voice.revealModel()
}

/**
 * 取模型字节。57 MB 过一趟 IPC 大约几十毫秒，但**每次都要复制一份**，
 * 所以调用方拿到之后应当把它交给引擎就不再留着（引擎那边只加载一次）。
 */
export async function readModelBytes(): Promise<Uint8Array> {
  const res = await native().voice.readModel()
  if (!res.ok || !res.bytes) throw new Error(res.error ?? t('读不到语音模型'))
  return res.bytes
}

/** 人类可读的体积：设置面板里显示「已下载 57 MB」 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / 1024 / 1024).toFixed(0) + ' MB'
}