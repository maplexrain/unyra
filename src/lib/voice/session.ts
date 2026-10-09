/**
 * 一次语音输入的会话：**按一下开始录 → 再按一下（或敲空格）结束 → 识别 → 落成文字**。
 *
 * 为什么不是「边说边出字」：SenseVoiceSmall 是**非流式**模型，一次吃一整段音频、
 * 吐一整段文字。从前 whisper 那条路要「一边录一边把整段重跑一遍」来假装实时，
 * 是因为它每一趟的成本固定（十几秒，与音频长短无关）；SenseVoice 在 CPU 上解 5 秒
 * 音频只要 0.2 秒（实测），**根本没有必要边录边解**——录完再解，一次就是最终结果，
 * 也不会出现「中间那版被后面那版改掉」的抖动。
 *
 * 文字怎么落地：这一层不认识输入框，识别完把文本交给**登记的接收方**
 * （见 setVoiceSink，输入框那一侧负责插到光标处）。于是这一层只有「录、解、交出去」
 * 三件事，换成别处触发（笔记、试卷填空）也不必动它。
 *
 * 音频不出内存：录到的 PCM 只在这一次识别里存在，解完就丢，不写盘、不留存。
 */

import { t } from '../../i18n'
import { native } from '../native'
import { SAMPLE_RATE, startMic, type MicSession } from './mic'
import { modelStatus } from './model'
import { loadVoiceSettings, voiceGpu } from './settings'

export type VoicePhase = 'idle' | 'recording' | 'working' | 'error'

export interface VoiceState {
  phase: VoicePhase
  /** 已经录了多少秒（录音时给界面报数） */
  seconds: number
  /** 话筒电平（0..1，画那几根跳动的竖条） */
  level: number
  /** 出错时的一句话；空串表示没有话说 */
  message: string
}

/**
 * 一次最多录多久。到点自动收尾（与手动结束同一条路）：
 * 忘了按结束的人不该把麦克风一直占着，也不该攒出一段几分钟的音频。
 */
const MAX_SECONDS = 120
/** 比这还短的录音直接丢掉：多半是误触，解出来只会是幻觉 */
const MIN_SECONDS = 0.4

let state: VoiceState = { phase: 'idle', seconds: 0, level: 0, message: '' }
const listeners = new Set<() => void>()
/** 识别完把文本交给谁（见 setVoiceSink）；没人接就留在 state.message 里 */
let sink: ((text: string) => void) | null = null
let mic: MicSession | null = null
let timer: number | null = null
/** 递增令牌：取消 / 重新开始之后，旧的那一趟回来时认得出自己已经过期 */
let token = 0

export const voiceState = (): VoiceState => state
export const isVoiceRecording = (): boolean => state.phase === 'recording'
/** 正在录或正在解：两种都表示「这一趟还没结束」 */
export const voiceBusy = (): boolean => state.phase === 'recording' || state.phase === 'working'

export function subscribeVoice(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function emit(patch: Partial<VoiceState>): void {
  state = { ...state, ...patch }
  for (const cb of [...listeners]) cb()
}

function clearTimer(): void {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}

/** 记下「识别完把文字交给谁」；传 null 注销（组件卸载时） */
export function setVoiceSink(fn: ((text: string) => void) | null): void {
  sink = fn
}

/**
 * 开始录。已经在下一次了就什么也不做（连按两下不该开出两路麦克风）。
 *
 * 先检查模型：没下模型时**当场说清**，而不是让用户对着一个转圈的按钮等，
 * 最后收到一句「识别失败」。
 */
export async function startRecording(): Promise<void> {
  if (voiceBusy()) return
  const id = ++token
  const status = await modelStatus().catch(() => null)
  if (id !== token) return
  if (!status?.exists) {
    emit({ phase: 'error', message: t('还没下载语音模型：到「设置 → 插件 → 语音输入」里下载') })
    return
  }
  try {
    mic = await startMic()
  } catch (err) {
    emit({ phase: 'error', message: err instanceof Error ? err.message : t('打不开麦克风') })
    return
  }
  if (id !== token) {
    mic.stop()
    mic = null
    return
  }
  emit({ phase: 'recording', seconds: 0, level: 0, message: '' })
  timer = window.setInterval(() => {
    if (!mic) return
    const seconds = mic.seconds()
    emit({ seconds, level: mic.level() })
    if (seconds >= MAX_SECONDS) void stopRecording()
  }, 120)
}

/** 结束录音并接着识别（点按钮、敲空格、录满上限，走的都是这一条） */
export async function stopRecording(): Promise<void> {
  if (state.phase !== 'recording' || !mic) return
  const id = ++token
  clearTimer()
  const session = mic
  mic = null
  const seconds = session.seconds()
  session.stop()

  if (seconds < MIN_SECONDS) {
    emit({ phase: 'idle', seconds: 0, level: 0, message: '' })
    return
  }

  emit({ phase: 'working', seconds, level: 0, message: t('识别中…') })
  const samples = session.read()
  try {
    const res = await native().voice.transcribe({
      samples,
      sampleRate: SAMPLE_RATE,
      language: loadVoiceSettings().language,
      gpu: voiceGpu(),
    })
    if (id !== token) return
    if (!res.ok) {
      emit({ phase: 'error', message: res.error ?? t('识别失败') })
      return
    }
    const text = (res.text ?? '').trim()
    emit({ phase: 'idle', seconds: 0, level: 0, message: '' })
    if (!text) {
      // 认出来是空的：说一句「没听清」，别让按钮悄悄弹回去（那看起来像没反应）
      emit({ phase: 'error', message: t('这一段没有听清（{0} 秒），再说一次试试', seconds.toFixed(1)) })
      return
    }
    if (sink) sink(text)
    else emit({ phase: 'error', message: text })
  } catch (err) {
    if (id !== token) return
    emit({ phase: 'error', message: err instanceof Error ? err.message : t('识别失败') })
  }
}

/** 丢掉这一段：不识别，也不留文字（Esc / 组件卸载时用） */
export function cancelRecording(): void {
  token++
  clearTimer()
  mic?.stop()
  mic = null
  emit({ phase: 'idle', seconds: 0, level: 0, message: '' })
}

/** 把错误那一行收掉（用户看到了、或者又按了一次开始） */
export function clearVoiceMessage(): void {
  if (state.phase === 'error') emit({ phase: 'idle', seconds: 0, level: 0, message: '' })
}
