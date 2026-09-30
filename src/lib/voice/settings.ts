/**
 * 语音输入的开关与偏好（存在 setting.yaml 的 voice 一段里）。
 *
 * 只有「开不开」这一件事：模型放在哪儿、下没下完，是主进程的事实（见 electron/voice.ts），
 * 不在这里存第二份——两份状态迟早会不一致。
 *
 * 默认开着：没模型时按快捷键会得到一句「还没下载模型」的明确提示，
 * 而不是让人以为这个功能不存在。
 */

import { useEffect, useState } from 'react'
import { readUserSettings, writeUserSettings } from '../userSettings'

export interface VoiceSettings {
  enabled: boolean
  /**
   * 用 WebGPU 跑识别（默认开）。实测差 40 倍（base 模型 3 秒音频：CPU 16.4 s、GPU 1.3 s），
   * 所以默认就该开；但显卡驱动千奇百怪，起不来时要能关掉退回 CPU
   * （而且 session.ts 里还有一层自动回退：GPU 起不来就当场换 CPU，不用用户操心）。
   */
  gpu: boolean
}

const DEFAULT: VoiceSettings = { enabled: true, gpu: true }

function normalize(raw: unknown): VoiceSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT }
  const r = raw as Record<string, unknown>
  return { enabled: r.enabled !== false, gpu: r.gpu !== false }
}

const listeners = new Set<() => void>()

export function loadVoiceSettings(): VoiceSettings {
  return normalize(readUserSettings('voice'))
}

export function voiceEnabled(): boolean {
  return loadVoiceSettings().enabled
}

/** 要不要试 WebGPU（识别跑在 Worker 里，这里读的是用户级设置） */
export function voiceGpu(): boolean {
  return loadVoiceSettings().gpu
}

export function setVoiceSetting(patch: Partial<VoiceSettings>): void {
  writeUserSettings('voice', { ...loadVoiceSettings(), ...patch })
  for (const cb of [...listeners]) cb()
}

export function subscribeVoiceSettings(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** 设置面板 / 快捷键那一层读它：改开关要立刻反映到「快捷键还响不响应」上 */
export function useVoiceSettings(): VoiceSettings {
  const [value, setValue] = useState(loadVoiceSettings)
  useEffect(() => subscribeVoiceSettings(() => setValue(loadVoiceSettings())), [])
  return value
}