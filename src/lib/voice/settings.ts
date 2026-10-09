/**
 * 语音识别的偏好（存在 setting.yaml 的 voice 一段里）：识别语言、走不走显卡。
 *
 * 「开不开」不在这里——那是插件开关（见 lib/voice/plugin 与 lib/plugins），
 * 因为它要在「设置 → 插件」里跟别的插件排在一起，还要受「模型下了没有」的守卫管。
 *
 * 模型放在哪儿、下没下完，也仍然是主进程的事实（见 electron/voice.ts），这里不存第二份。
 */

import { useEffect, useState } from 'react'
import { native } from '../native'
import { readUserSettings, writeUserSettings } from '../userSettings'

/** SenseVoice 认的几种语言；auto 让它自己判（默认） */
export const VOICE_LANGUAGES = ['auto', 'zh', 'en', 'ja', 'ko', 'yue'] as const
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number]

export interface VoiceSettings {
  language: VoiceLanguage
  /**
   * 走不走显卡。**null = 跟着设备走**（默认）：机器上有显卡就用，
   * 开机时由 refreshVoiceGpuDefault() 问一次（见 electron/voice.ts 的 detectGpu）。
   *
   * 为什么要有这一档：显卡驱动千奇百怪，而「有没有显卡」是我们能自己问出来的。
   * 让用户去理解「DirectML / 执行提供者」是把这个决定推给了他，默认值替他说了就好；
   * 真出了问题（识别报错、慢得反常）再让他关掉。
   */
  gpu: boolean | null
}

const DEFAULT: VoiceSettings = { language: 'auto', gpu: null }

function normalize(raw: unknown): VoiceSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT }
  const r = raw as Record<string, unknown>
  const language = VOICE_LANGUAGES.includes(r.language as VoiceLanguage) ? (r.language as VoiceLanguage) : 'auto'
  return { language, gpu: typeof r.gpu === 'boolean' ? r.gpu : null }
}

const listeners = new Set<() => void>()

export function loadVoiceSettings(): VoiceSettings {
  return normalize(readUserSettings('voice'))
}

/** 这台机器上有没有显卡；启动时问一次（还没问到就当没有：CPU 是那个一定跑得起来的一侧） */
let deviceHasGpu = false
let deviceGpuName = ''

/**
 * 问一次设备信息。启动时调（见 lib/boot），设置页打开时也会再调一次
 * （换了显卡 / 插了外置坞，用户不该为了让它认出来而重启）。
 */
export async function refreshVoiceGpuDefault(): Promise<void> {
  try {
    const info = await native().voice.gpuInfo()
    deviceHasGpu = info.hasGpu
    deviceGpuName = info.name
  } catch {
    deviceHasGpu = false
    deviceGpuName = ''
  }
  for (const cb of [...listeners]) cb()
}

/** 这台机器上检测到的显卡名（空串 = 没检测到） */
export const voiceGpuName = (): string => deviceGpuName
/** 这台机器上有没有显卡 */
export const voiceHasGpu = (): boolean => deviceHasGpu

/** 这一次识别到底走不走显卡：用户显式设过就听他的，没设过就按设备定 */
export function voiceGpu(): boolean {
  const v = loadVoiceSettings().gpu
  return v ?? deviceHasGpu
}

export function setVoiceSetting(patch: Partial<VoiceSettings>): void {
  writeUserSettings('voice', { ...loadVoiceSettings(), ...patch })
  for (const cb of [...listeners]) cb()
}

/** 把「跟随设备」落成一个显式值（开关被拨动时用） */
export function pinVoiceGpu(next: boolean): void {
  setVoiceSetting({ gpu: next })
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
