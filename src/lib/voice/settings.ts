/**
 * 录音降噪的偏好（存在 setting.yaml 的 voice 一段里）。
 *
 * 2026-11-14 语音识别迁到「设置 → 模型 → 能力接入」之后，这里只剩**录音链路自己的
 * 参数**：降噪强度。它作用于话筒端（静音裁剪的门限，见 lib/voice/session 的
 * noiseGateOf），跟识别引擎是谁无关——所以识别语言跟引擎走（ai/capabilities 的
 * stt.language），开不开也由引擎配置决定，都不再放这里。
 */

import { useEffect, useState } from 'react'
import { readUserSettings, writeUserSettings } from '../userSettings'

export interface VoiceSettings {
  /**
   * 降噪强度（0–100）：越高越不容易把环境噪声当成说话，也越容易漏掉轻声。
   *
   * 这一档必须交给用户：话筒增益、房间噪声与说话音量千差万别，同一个门限
   * 在 A 的机器上「全是噪声」、在 B 的机器上「一个字都不出」。默认取中间偏左的一档
   * （30）——先保证听得见，嫌吵再往右调。
   */
  noiseGate: number
}

const DEFAULT: VoiceSettings = { noiseGate: 30 }

function normalize(raw: unknown): VoiceSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT }
  const r = raw as Record<string, unknown>
  const gate =
    typeof r.noiseGate === 'number' && Number.isFinite(r.noiseGate)
      ? Math.min(100, Math.max(0, Math.round(r.noiseGate)))
      : DEFAULT.noiseGate
  return { noiseGate: gate }
}

const listeners = new Set<() => void>()

export function loadVoiceSettings(): VoiceSettings {
  return normalize(readUserSettings('voice'))
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

/** 设置面板那一层读它：改一项要立刻反映到界面上 */
export function useVoiceSettings(): VoiceSettings {
  const [value, setValue] = useState(loadVoiceSettings)
  useEffect(() => subscribeVoiceSettings(() => setValue(loadVoiceSettings())), [])
  return value
}
