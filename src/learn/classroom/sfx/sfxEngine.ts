/**
 * 课堂音效引擎 (sfxEngine.ts)
 *
 * 全部音效由 WebAudio 实时合成——零音频资源文件、零网络依赖、任意倍速不失真。
 * 信号链：
 *   voiceDry ─→ voiceBus ──────────→ master(音量) → 柔性压缩 → destination
 *   voiceWet ─→ voiceWetBus ─→ 暖木厅混响(Convolver + 3.6kHz LPF) ─┘
 *
 * 声音设计原则：
 * - 音效是「标点」，不是「背景墙」：一幕里只给 1-3 个戏剧节点配音效；
 * - 纸墨与木质触感：正弦/三角波与整形滤波噪声为主，温润短促，杜绝刺耳方波与街机感；
 * - 确定性静音：快进（seek）与预览未播放状态永远保持静音；暂停/跳过即刻柔和收尾。
 */
import { SFX_RECIPES, createSfxKit } from './sfxLibrary'
import { getExternalClassroomSound } from '../registry'

export interface SfxSettings {
  enabled: boolean
  /** 0 ~ 1 主音量 */
  volume: number
}

export interface PlaySfxOptions {
  /** 单次音量倍率（0 ~ 1.5，默认 1） */
  volume?: number
  /** 时长型音效（typing / count）的持续毫秒 */
  duration?: number
  /** 播放倍速（仅作用于时长型音效） */
  rate?: number
  /** 忽略全局开关（音效试听） */
  force?: boolean
}

export interface SfxHandle {
  stop: () => void
}

/** 合成配方拿到的发声上下文 */
export interface SfxVoice {
  ctx: AudioContext
  dry: AudioNode
  wet: AudioNode
  /** 起始时刻（ctx.currentTime 基准） */
  t: number
  /** 单次音量倍率 */
  vol: number
  /** 时长型音效的持续秒数 */
  dur: number
  /** 注册随声部停止的清理回调（如定时器） */
  onStop: (fn: () => void) => void
}

const STORAGE_KEY = 'moji:classroom:sfx'
const DEFAULT_SETTINGS: SfxSettings = { enabled: true, volume: 0.55 }

let settings: SfxSettings | null = null
const listeners = new Set<(s: SfxSettings) => void>()

let ctx: AudioContext | null = null
let master: GainNode | null = null
let reverbIn: AudioNode | null = null
const lastPlayed = new Map<string, number>()
const activeHandles = new Set<SfxHandle>()

export function getSfxSettings(): SfxSettings {
  if (settings) return settings
  settings = { ...DEFAULT_SETTINGS }
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (raw) {
      const p = JSON.parse(raw) as Partial<SfxSettings>
      if (typeof p.enabled === 'boolean') settings.enabled = p.enabled
      if (typeof p.volume === 'number' && Number.isFinite(p.volume)) {
        settings.volume = Math.min(1, Math.max(0, p.volume))
      }
    }
  } catch {
    /* 读坏了就用默认 */
  }
  return settings
}

export function setSfxSettings(patch: Partial<SfxSettings>): SfxSettings {
  const next = { ...getSfxSettings(), ...patch }
  next.volume = Math.min(1, Math.max(0, next.volume))
  settings = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* 存不下不影响播放 */
  }
  if (master && ctx) master.gain.setTargetAtTime(next.volume, ctx.currentTime, 0.02)
  listeners.forEach((fn) => fn(next))
  return next
}

export function subscribeSfxSettings(fn: (s: SfxSettings) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 生成一段温暖木质讲堂的立体声脉冲响应（微暖低通，消除白噪高频毛刺） */
function buildImpulse(c: AudioContext, seconds = 1.25, decay = 3.4): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds)
  const buf = c.createBuffer(2, len, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, decay)
      const white = Math.random() * 2 - 1
      lp = lp * 0.45 + white * 0.55 // 简易单极点暖色柔化
      data[i] = lp * env
    }
  }
  return buf
}

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC: typeof AudioContext | undefined =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!ctx) {
    try {
      ctx = new AC()
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -18
      comp.knee.value = 12
      comp.ratio.value = 3
      comp.attack.value = 0.004
      comp.release.value = 0.2

      master = ctx.createGain()
      master.gain.value = getSfxSettings().volume
      master.connect(comp)
      comp.connect(ctx.destination)

      const convolver = ctx.createConvolver()
      convolver.buffer = buildImpulse(ctx)

      const warmFilter = ctx.createBiquadFilter()
      warmFilter.type = 'lowpass'
      warmFilter.frequency.value = 3600

      const wetGain = ctx.createGain()
      wetGain.gain.value = 0.28

      convolver.connect(warmFilter)
      warmFilter.connect(wetGain)
      wetGain.connect(master)
      reverbIn = convolver
    } catch {
      ctx = null
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  return ctx
}

/** 停止当前所有仍在持续的合成音效（用于快进、暂停或销毁清理） */
export function stopAllSfx(): void {
  activeHandles.forEach((h) => h.stop())
  activeHandles.clear()
}

/**
 * 启动一个可中途停止的音效声部（供 ActionCompiler / Scheduler 使用）。
 * 未知名字 / 'none' / 全局关闭 → 返回 null。
 */
export function startSfx(name: string | undefined | null, opts: PlaySfxOptions = {}): SfxHandle | null {
  if (!name || name === 'none') return null
  const builtin = SFX_RECIPES[name]
  const external = builtin ? undefined : getExternalClassroomSound(name)
  if (!builtin && !external) return null
  const defaultDuration = builtin?.defaultDuration ?? external?.defaultDuration
  const s = getSfxSettings()
  if (!s.enabled && !opts.force) return null

  // 同名音效 55ms 内去重，避免级联元素叠成「机关枪」
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (now - (lastPlayed.get(name) ?? -1e9) < 55) return null
  lastPlayed.set(name, now)

  const c = ensureContext()
  if (!c || !master || !reverbIn) return null

  const voiceDry = c.createGain()
  const voiceWet = c.createGain()
  voiceDry.gain.value = 1
  voiceWet.gain.value = 1
  voiceDry.connect(master)
  voiceWet.connect(reverbIn)

  const stopCallbacks: Array<() => void> = []
  let stopped = false

  const rate = Math.max(0.5, Math.min(3, opts.rate ?? 1))
  const rawDurMs = opts.duration ?? defaultDuration ?? 600
  const durSec = Math.max(0.14, Math.min(3.5, rawDurMs / 1000 / rate))

  const handle: SfxHandle = {
    stop: () => {
      if (stopped) return
      stopped = true
      activeHandles.delete(handle)
      for (const fn of stopCallbacks) {
        try {
          fn()
        } catch {}
      }
      try {
        const t = c.currentTime
        voiceDry.gain.cancelScheduledValues(t)
        voiceWet.gain.cancelScheduledValues(t)
        voiceDry.gain.setTargetAtTime(0.0001, t, 0.012)
        voiceWet.gain.setTargetAtTime(0.0001, t, 0.012)
      } catch {}
    },
  }

  try {
    const voice = {
      ctx: c,
      dry: voiceDry,
      wet: voiceWet,
      t: c.currentTime + 0.005,
      vol: Math.min(1.5, Math.max(0, opts.volume ?? 1)),
      dur: durSec,
      onStop: (fn: () => void) => stopCallbacks.push(fn),
    }
    if (builtin) builtin.play(voice)
    else if (external) external.play(voice, createSfxKit(voice))
    activeHandles.add(handle)
    if (typeof window !== 'undefined') {
      const ttl = Math.max(2200, durSec * 1000 + 1800)
      const timer = window.setTimeout(() => {
        activeHandles.delete(handle)
        try {
          voiceDry.disconnect()
          voiceWet.disconnect()
        } catch {}
      }, ttl)
      stopCallbacks.push(() => window.clearTimeout(timer))
    }
    return handle
  } catch (e) {
    console.warn('[sfx] 合成失败', name, e)
    return null
  }
}

/** 播放一个音效。未知名字 / 'none' / 全局关闭 → 静默返回 false */
export function playSfx(name: string | undefined | null, opts: PlaySfxOptions = {}): boolean {
  return startSfx(name, opts) !== null
}

/**
 * 为可控任务排一个「延迟发声」：到点才响，任务若在此之前被 instantFinish / abort
 * （典型如 seek 快进重放）就取消——快进永远是静音的。
 */
export function scheduleSfx(name: string | undefined, delayMs: number, opts?: PlaySfxOptions): () => void {
  if (!name || name === 'none' || typeof window === 'undefined') return () => {}
  let handle: SfxHandle | null = null
  const id = window.setTimeout(() => {
    handle = startSfx(name, opts)
  }, Math.max(0, delayMs))
  return () => {
    window.clearTimeout(id)
    handle?.stop()
  }
}
