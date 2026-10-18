/**
 * 一次语音输入的会话：**按一下开始录 → 边说边把文字写进输入框 → 再按一下（或敲空格）结束**。
 *
 * 文字怎么做到「实时」：把这一段音频一直攒着（不切片），说话途中每约 1.2 秒把
 * **整段**送去识别一次，拿回来的全文**整段替换**输入框里这一段已经写下的字。
 * 于是用户看到的是文字越写越完整，而不是等停顿才冒出来；模型每次都有完整上下文，
 * 也不会像 1 秒切片那样被拦腰截断、对着噪声编词。
 *
 * 什么时候定稿（之后另起一段）：识别结果以句末标点收尾、并且已经静下来一小会儿，
 * 或者这一段攒到 12 秒（防止单次推理无上限变慢），或者用户按了结束。
 *
 * **静音不送识别**：每一拍取一次话筒的峰值电平，只看**最近两秒的起伏**判断有没有人声
 * （稳态噪声是平的，再响也不算）；一直没有人声就把缓存丢掉，绝不把纯静音送给模型。
 * 送识别前还会裁掉段首段尾的静音，模型少看见静音就少「编」。
 *
 * 文字怎么落地：这一层不认识输入框，只把「这一段最新的全文」交给**登记的接收方**
 * （见 setVoiceSink 的 update / commit）。输入框那一侧负责记住落点、整段替换。
 *
 * 音频不出内存：录到的 PCM 只在这一次识别里存在，解完就丢，不写盘、不留存。
 */

import { t } from '../../i18n'
import { native } from '../native'
import { SAMPLE_RATE, startMic, type MicChunk, type MicSession } from './mic'
import { modelStatus } from './model'
import { loadVoiceSettings, voiceGpu } from './settings'

export type VoicePhase = 'idle' | 'recording' | 'working' | 'error'

export interface VoiceState {
  phase: VoicePhase
  /** 已经录了多少秒（录音时给界面报数） */
  seconds: number
  /** 话筒电平（0..1）：录音中那颗红点跟着它放大，用户能看出「它听得见」 */
  level: number
  /** 出错时的一句话；空串表示没有话说 */
  message: string
}

/**
 * 输入框那一侧的落字接口：
 * - update：这一段的**全文**（不是增量）——替换上一次写进去的同段文字；
 * - commit：这一段定稿，下一段文字另起。
 */
export interface VoiceSink {
  update(text: string): void
  commit(): void
}

/** 取话筒数据的节拍：100ms 一拍，够快，也不至于每帧都去碰音频 */
const TICK_MS = 100
/**
 * 一次最多录多久。到点自动收尾（与手动结束同一条路）：
 * 忘了按结束的人不该把麦克风一直占着。
 */
const MAX_SECONDS = 120
/** 比这还短的录音直接丢掉：多半是误触，解出来只会是幻觉 */
const MIN_SECONDS = 0.4
/** 说话途中每隔这么久把整段重解一次（送的是整段，不是切片） */
const ATTEMPT_MS = 1200
/** 第一次至少攒这么久再解：太短的音频既切不出话，也容易让模型瞎猜 */
const FIRST_ATTEMPT_SECONDS = 1.5
/** 一段话最长攒多久就定稿：不是固定切片，只是一句特别长的话的上限 */
const MAX_SEGMENT_SECONDS = 12
/** 静下来这么久算这一句说完：把已经写下的文字定稿，下一句另起 */
const COMMIT_PAUSE_MS = 1200
/** 连续这么久没检测到人声：缓存丢掉，**不送识别**（送进去只会得到编出来的字） */
const SILENCE_DROP_MS = 3000
/**
 * 判断「这一段到底有没有人声」不能只看绝对电平：话筒增益差别太大，安静的人说话
 * 可能是 0.003，而吵的屋子底噪就有 0.004；风扇再响也是平的。所以看**最近两秒的起伏**。
 *
 * 门限随「降噪强度」（设置 → 插件 → 语音输入）缩放：0 = 几乎不降噪（最灵敏），
 * 100 = 只对明显、持续的人声反应。三个数一起动：
 * - 起伏倍数：1 → 3.5；
 * - 最低峰值：0.0002 → 0.003；
 * - 持续块数：1 → 2（约 250ms）。
 */
const GATE_RATIO_LOW = 1
const GATE_RATIO_HIGH = 3.5
const GATE_PEAK_LOW = 0.0002
const GATE_PEAK_HIGH = 0.003

/** 结束时兜底的「确实有音频」底线：不随滑杆抬高（宁可多解一次，也别把话吞掉） */
const HARD_AUDIBLE_PEAK = 0.0006

/** 把 0–100 的降噪强度换算成三条人声门限 */
function noiseGateOf(): { ratio: number; minPeak: number; chunks: number } {
  const s = Math.min(100, Math.max(0, loadVoiceSettings().noiseGate)) / 100
  return {
    ratio: GATE_RATIO_LOW + s * (GATE_RATIO_HIGH - GATE_RATIO_LOW),
    minPeak: GATE_PEAK_LOW + s * (GATE_PEAK_HIGH - GATE_PEAK_LOW),
    chunks: s >= 0.5 ? 2 : 1,
  }
}

/** 人声判据只看最近这么久：一声「咔哒」最多影响两秒，之后必须让位给新的判断 */
const LEVEL_WINDOW_MS = 2000
/** 「刚才还在说话」的相对门限：低于最近两秒最响的四分之一，就算停顿 */
const VOICE_RATIO = 0.25
/** 句末标点：识别结果以它收尾、且已经静下来，就把这一段定稿 */
const TERMINAL = /[。！？.!?…]$/
/**
 * 只有标点 / 空白的结果：模型对着静音经常吐一个「。」。它不算文字，
 * 一律当没听见——否则噪声每一次触发识别都会在输入框里落一个句号。
 */
const PUNCT_ONLY = /^[\s。．.，,、；;：:！？!?…·~～\-—_'"“”‘’()（）[\]【】]*$/
/** 识别前从段首 / 段尾各留一点余量裁掉无人声的部分：静音少了，模型就不容易「编」 */
const TRIM_HEAD_MS = 200
const TRIM_TAIL_MS = 350

let state: VoiceState = { phase: 'idle', seconds: 0, level: 0, message: '' }
const listeners = new Set<() => void>()
/** 这一段最新的全文交给谁（见 setVoiceSink） */
let sink: VoiceSink | null = null
/**
 * 接收方的登记序号：页签是 keepalive 的（每枚都挂着一个输入框），后登记的会顶掉先登记的；
 * 注销时只有「自己还是最新的那一个」才清空，否则切页签时旧面板的清理会把新面板顶掉。
 */
let sinkSeq = 0
let mic: MicSession | null = null
let timer: number | null = null
/** 递增令牌：取消 / 重新开始之后，旧的那一趟回来时认得出自己已经过期 */
let token = 0

/**
 * 这一段的音频（自上一次定稿 / 丢弃以来攒的）。
 * 它按**自然停顿**切段，不是按固定时长——这是不把一句话拦腰截断的关键。
 */
let seg: Float32Array[] = []
let segSamples = 0
/** 这一段里最大的电平：结束兜底与裁静音都以它为参照 */
let segPeak = 0
/** 最近两秒每块的电平（时间 + 峰值）：人声判据看窗口，一声「咔哒」会随时间退场 */
let levels: Array<{ at: number; peak: number }> = []
/** 第一块 / 最后一块像人声的采样位置：送识别前据此裁掉首尾静音 */
let voiceFrom = -1
let voiceTo = 0
/** 最后一次检测到「还在说话」的时刻：停顿判据以它为起点 */
let lastVoiceAt = 0
/** 这一段已经写进输入框的全文（含与上一段之间的空格） */
let segText = ''
/** 这一段开头的分隔符（中英交界处补的那个空格） */
let segPrefix = ''
/** 上一次送去识别时，这一段有多少采样：只有新到了音频才值得再解一次 */
let attemptedSamples = 0
/** 上一次送识别的时间：控制说话途中的重解节奏 */
let lastAttemptAt = 0

/** 这一趟有没有落过字（决定结束时「没听清」要不要说出口） */
let sessionText = false
/** 识别桥报回来的错：先记着，结束时一起交给用户，不在录音途中弹红条 */
let streamError = ''
/** 上一段认出来的尾巴：中文直接接上，英文段之间补一个空格（见 needSeparator） */
let lastChunk = ''
/** 没有接收方时先攒着的文字：等到结束再一起说 */
let orphanText = ''
/** 正在解的那一段：同一时刻只跑一路识别（两路挤在一起只会更慢） */
let inFlight: Promise<void> | null = null

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

/**
 * 记下「这一段最新的全文交给谁」。
 * 返回注销函数：只有仍是**最后一次**登记的那一方才能把它清掉（见 sinkSeq）。
 */
export function setVoiceSink(next: VoiceSink): () => void {
  sink = next
  const mine = ++sinkSeq
  return () => {
    if (sinkSeq !== mine) return
    sink = null
    sinkSeq++
  }
}

/** 最近两秒里最响的一块（只看窗口：旧的「咔哒」不该一直抬着门槛） */
function recentPeak(now: number): number {
  let max = 0
  for (const p of levels) if (now - p.at <= LEVEL_WINDOW_MS && p.peak > max) max = p.peak
  return max
}

/** 两段之间要不要补空格：中文（以及标点）直接接上，英文/数字之间补一个 */
function needSeparator(text: string): boolean {
  return /[A-Za-z0-9]$/.test(lastChunk) && /^[A-Za-z0-9]/.test(text)
}

/** 把一截新到的音频接进当前段，并按峰值电平累计「有声时长」 */
function absorb(chunk: MicChunk): void {
  /*
   * 兼容旧形状（drain 曾经直接返回 Float32Array）：热更新或旧构建里，
   * mic 与 session 两个模块可能一新一旧，读不到 `.samples` 时按「整块都是声音」处理，
   * 免得整趟录音一个字都出不来（真正修好它需要完整重启一次应用）。
   */
  const legacy = ArrayBuffer.isView(chunk) ? (chunk as unknown as Float32Array) : null
  const samples = legacy ?? chunk.samples
  if (!(samples instanceof Float32Array) || !samples.length) return
  const peak = legacy ? 1 : Number.isFinite(chunk.peak) ? chunk.peak : 1

  const at = segSamples
  seg.push(samples)
  segSamples += samples.length
  if (peak > segPeak) segPeak = peak
  const now = Date.now()
  levels.push({ at: now, peak })
  while (levels.length && now - levels[0].at > LEVEL_WINDOW_MS) levels.shift()
  const gate = noiseGateOf()
  // 送识别时只保留「有真实音频」的那一段（首尾的数字静音裁掉）
  if (peak >= gate.minPeak) {
    if (voiceFrom < 0) voiceFrom = at
    voiceTo = at + samples.length
  }
  // 「刚才还在说话」：接近最近两秒最响的时候才算，掉到四分之一以下就是停顿
  if (peak > Math.max(gate.minPeak, recentPeak(now) * VOICE_RATIO)) lastVoiceAt = now
}

/**
 * 这一段有没有人声（见文件头那两条判据）。
 * 只看**最近两秒**：一声「咔哒」也会让峰值跳起来，但它撑不过 200 多毫秒，
 * 两秒之后就从窗口里退场了，不会把一整段录音永久判成「有人声」。
 */
function hasVoiceNow(): boolean {
  const now = Date.now()
  const recent = levels.filter((p) => now - p.at <= LEVEL_WINDOW_MS)
  const gate = noiseGateOf()
  if (recent.length < gate.chunks) return false
  let max = 0
  let min = Infinity
  for (const p of recent) {
    if (p.peak > max) max = p.peak
    if (p.peak < min) min = p.peak
  }
  if (max < gate.minPeak) return false
  let voiced = 0
  const voicedAt = Math.max(gate.minPeak, max * 0.35)
  for (const p of recent) if (p.peak >= voicedAt) voiced++
  if (voiced < gate.chunks) return false
  // 只有「起伏」才是人声：稳态的风扇、空调、电流声都是平的，再响也不算
  return min > 0 && max >= min * gate.ratio
}

/** 识别结果里只有标点（模型对着静音常吐一个「。」）：当没听见 */
function cleanText(text: string): string {
  const t = text.trim()
  return PUNCT_ONLY.test(t) ? '' : t
}

/** 送识别的那一段：把段首段尾的静音裁掉，只留人声附近 */
function speechSlice(all: Float32Array): Float32Array {
  if (voiceFrom < 0 || !all.length) return all
  const from = Math.max(0, voiceFrom - Math.round((SAMPLE_RATE * TRIM_HEAD_MS) / 1000))
  const to = Math.min(all.length, voiceTo + Math.round((SAMPLE_RATE * TRIM_TAIL_MS) / 1000))
  return to > from ? all.subarray(from, to) : all
}

/** 把这一段音频拼成一整段 */
function concatSeg(): Float32Array {
  const out = new Float32Array(segSamples)
  let at = 0
  for (const c of seg) {
    out.set(c, at)
    at += c.length
  }
  return out
}

function resetSeg(): void {
  seg = []
  segSamples = 0
  segPeak = 0
  levels = []
  voiceFrom = -1
  voiceTo = 0
  lastVoiceAt = Date.now()
  segText = ''
  segPrefix = ''
  attemptedSamples = 0
  lastAttemptAt = 0
}

/** 从缓存头部吃掉 n 个采样（只清已经变成文字的那一截） */
function consumeFront(n: number): void {
  let left = n
  while (left > 0 && seg.length) {
    const head = seg[0]
    if (head.length <= left) {
      left -= head.length
      seg.shift()
    } else {
      seg[0] = head.slice(left)
      left = 0
    }
  }
  segSamples = Math.max(0, segSamples - n)
  // 人声区间也跟着往前挪；整个区间都被吃掉就重置
  if (voiceFrom >= 0) {
    voiceFrom = Math.max(0, voiceFrom - n)
    voiceTo = Math.max(0, voiceTo - n)
    if (voiceTo <= voiceFrom) {
      voiceFrom = -1
      voiceTo = 0
    }
  }
}

/**
 * 这一段定稿：把已经写下的文字封口，并清掉已经变成文字的那一段音频。
 * 快照之后新到的音频留着（那是下一段的开头）。
 */
function commitSegment(consumed: number): void {
  if (sink) sink.commit()
  consumeFront(consumed)
  segText = ''
  segPrefix = ''
  attemptedSamples = 0
  lastAttemptAt = 0
  if (segSamples <= 0) {
    seg = []
    segSamples = 0
    segPeak = 0
    levels = []
    voiceFrom = -1
    voiceTo = 0
    lastVoiceAt = Date.now()
  }
}

function dropSeg(): void {
  resetSeg()
}

/**
 * 把当前段整段送去识别一次，拿回来的全文交给接收方（整段替换）。
 * **不阻塞**录音的那条定时器（录音继续、文字异步跟上），同一时刻只允许一趟。
 *
 * `cut` = 这一段已经太长了：解完就定稿，下一段另起。
 */
function attempt(id: number, cut = false): Promise<void> {
  if (inFlight) return inFlight
  if (!segSamples) return Promise.resolve()
  const snapshot = segSamples
  const all = concatSeg()
  // 只送人声附近那一段：两头静音裁掉，模型少看见静音就少「编」
  const samples = speechSlice(all)
  // 说话途中：裁完不足 0.35 秒的不值得解（多半是噪声的边角）；结束时照解不误
  if (!cut && samples.length < SAMPLE_RATE * 0.35) return Promise.resolve()
  attemptedSamples = snapshot
  lastAttemptAt = Date.now()
  const run = (async () => {
    try {
      const res = await native().voice.transcribe({
        samples,
        sampleRate: SAMPLE_RATE,
        language: loadVoiceSettings().language,
        gpu: voiceGpu(),
      })
      if (id !== token) return
      if (!res.ok) {
        // 桥那头出错了：这一段先别反复重试，把话留到结束时说（录音本身继续）
        streamError = res.error ?? t('识别失败')
        return
      }
      const text = cleanText(res.text ?? '')
      if (text) {
        if (!segText) {
          segPrefix = needSeparator(text) ? ' ' : ''
          lastChunk = text
        }
        const full = segPrefix + text
        if (full !== segText) {
          segText = full
          sessionText = true
          if (sink) sink.update(full)
          else orphanText = full
        }
      }
      const settled = segSamples === snapshot
      const quiet = Date.now() - lastVoiceAt
      if (cut && (text || segText)) {
        // 这一段已经够长了：不管后面还在不在说，先把解过的这一截定稿（剩下的留作下一段）
        commitSegment(snapshot)
      } else if (settled && text && (TERMINAL.test(text) || quiet >= COMMIT_PAUSE_MS)) {
        commitSegment(snapshot)
      }
    } catch {
      // 这一段解失败不打断录音：下一段照常攒、照常解
    } finally {
      inFlight = null
    }
  })()
  inFlight = run
  return run
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
  // 上一趟可能还有一段在解：等它收尾再开新的一路，别让两路推理叠在一起
  if (inFlight) await inFlight.catch(() => undefined)
  if (id !== token) return
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
  resetSeg()
  sessionText = false
  streamError = ''
  lastChunk = ''
  orphanText = ''
  emit({ phase: 'recording', seconds: 0, level: 0, message: '' })
  timer = window.setInterval(() => {
    if (!mic || state.phase !== 'recording') return
    const seconds = mic.seconds()
    emit({ seconds, level: mic.level() })
    if (seconds >= MAX_SECONDS) {
      void stopRecording()
      return
    }
    absorb(mic.drain())
    if (inFlight) return

    const now = Date.now()
    const quiet = now - lastVoiceAt
    const hasVoice = hasVoiceNow()
    const newAudio = segSamples > attemptedSamples

    // 这一句已经很长了：解一次并定稿，别让单次推理无限变慢
    if (hasVoice && segSamples >= SAMPLE_RATE * MAX_SEGMENT_SECONDS) {
      void attempt(id, true)
      return
    }
    // 还在说（或刚停下不到定稿门槛）：有新音频就整段重解，文字实时跟上
    if (
      hasVoice &&
      newAudio &&
      quiet < COMMIT_PAUSE_MS &&
      segSamples >= SAMPLE_RATE * FIRST_ATTEMPT_SECONDS &&
      now - lastAttemptAt >= ATTEMPT_MS
    ) {
      void attempt(id)
      return
    }
    // 静下来了：已经写过字就把这一句定稿；一个字都没有就是纯静音，到点丢掉
    if (hasVoice && quiet >= COMMIT_PAUSE_MS) {
      if (segText) {
        commitSegment(segSamples)
        return
      }
      if (quiet >= SILENCE_DROP_MS) {
        dropSeg()
      }
      return
    }
    // 整段都没听见人声：三秒一到就丢，**绝不送识别**
    if (!hasVoice && segSamples >= (SAMPLE_RATE * SILENCE_DROP_MS) / 1000) {
      dropSeg()
    }
  }, TICK_MS)
}

/** 结束录音并接着识别（点按钮、敲空格、录满上限，走的都是这一条） */
export async function stopRecording(): Promise<void> {
  if (state.phase !== 'recording' || !mic) return
  const id = token
  clearTimer()
  const session = mic
  mic = null
  const seconds = session.seconds()
  session.stop()
  // 话筒关掉之后把最后这一截也收进来（前面每 100ms 取过一次，剩下的最多一拍）
  absorb(session.drain())

  emit({ phase: 'working', seconds, level: 0, message: t('识别中…') })
  // 先把正在跑的那一段等回来：它属于这一趟，结果照常落字
  if (inFlight) await inFlight.catch(() => undefined)
  if (id !== token) return

  const hasVoice = hasVoiceNow()
  const gate = noiseGateOf()
  /*
   * 兜底：门限可能因为底噪估计偏高而漏掉安静的麦克风，但只要这一段确实有真实音频，
   * 结束时就一定解一次（判据比门限更低，见 noiseGateOf 的下限）。
   */
  const audible = hasVoice || segPeak >= Math.min(gate.minPeak, HARD_AUDIBLE_PEAK)
  // 一行诊断：出问题时（尤其「一个字都没有」）这几个数比任何猜测都有用
  console.info(
    '[voice] 录音 %s 秒 · 峰值 %s · 判定 %s',
    seconds.toFixed(1),
    segPeak.toFixed(4),
    audible ? (hasVoice ? '有话' : '有音频') : '静音',
  )

  if (seconds < MIN_SECONDS || !segSamples) {
    // 误触：什么都不说，安静地回到空闲
    dropSeg()
    emit({ phase: 'idle', seconds: 0, level: 0, message: '' })
    return
  }
  if (!audible) {
    /*
     * 这一趟连真实音频都没有：不送识别（否则模型会对着数字静音编字）。
     * 已经落过字就安静收尾；一个字都没有才说一句「没听清」。
     */
    dropSeg()
    emit({ phase: 'idle', seconds: 0, level: 0, message: '' })
    if (!sessionText && seconds >= 1) {
      emit({
        phase: 'error',
        message: streamError || t('这一段没有听清（{0} 秒），再说一次试试', seconds.toFixed(1)),
      })
    }
    return
  }

  // 最后一遍：把剩下的音频整段解出来并定稿
  await attempt(id, true)
  if (id !== token) return
  if (segText) {
    if (sink) sink.commit()
    else emit({ phase: 'error', message: orphanText })
    segText = ''
    segPrefix = ''
  }
  emit({ phase: 'idle', seconds: 0, level: 0, message: '' })
  if (!sessionText) {
    emit({ phase: 'error', message: streamError || t('这一段没有听清（{0} 秒），再说一次试试', seconds.toFixed(1)) })
  }
}

/** 丢掉这一段：不识别，也不留文字（Esc / 组件卸载时用） */
export function cancelRecording(): void {
  token++
  clearTimer()
  mic?.stop()
  mic = null
  dropSeg()
  emit({ phase: 'idle', seconds: 0, level: 0, message: '' })
}

/** 把错误那一行收掉（用户看到了、或者又按了一次开始） */
export function clearVoiceMessage(): void {
  if (state.phase === 'error') emit({ phase: 'idle', seconds: 0, level: 0, message: '' })
}
