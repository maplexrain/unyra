/**
 * 守卫 agent 的**运行时**（严格专注的监控回路）。
 *
 * 分工：判定怎么解析、策略怎么定是纯逻辑（learn/focusGuard）；这里管的是
 * 「周期性地看一眼」这件事本身——拿屏幕/摄像头的媒体流、抽帧、带历史发给模型、
 * 把判定翻译成动作（警告/暂停/熔断）交给宿主（LearnWorkspace 注入的 hooks）。
 *
 * 它是一个模块级单例，**不属于超级导师**：自己的系统提示词、自己的历史、
 * 自己的页签（TabRef kind 'guard'）。不打开页签它也在后台跑——每次严格专注开始
 * 就自动建一份上下文；页签只是旁路观察它上下文构建的一个窗口。
 *
 * 隐私的三道闸（改这里之前先读一遍）：
 * 1. 帧只活在内存里——发给模型、画进页签，**从不落盘**；报告里只留判定不留图；
 * 2. 会话结束（完成/停止/熔断）立即停掉全部媒体流，预览随之熄灭；
 * 3. 熔断（privacy）是最高优先级动作：先停流再通知宿主，晚一拍都是事故。
 */

import { resolveGlobal } from '../ai/settings'
import { streamChatWith } from '../ai/client'
import type { ChatContentPart, ChatMessage } from '../ai/types'
import { t } from '../i18n'
import {
  GUARD_ROUND_MS,
  MAX_HISTORY_ROUNDS,
  WARN_COOLDOWN_MS,
  decideGuardAction,
  guardSystemPrompt,
  parseVerdict,
  type GuardAction,
  type GuardMonitors,
  type GuardVerdict,
} from '../learn/focusGuard'

/** 单轮模型调用的超时：带图请求不快，但不能无限等 */
const ROUND_TIMEOUT_MS = 90_000
/**
 * 单轮输出预算。给小了推理模型的思考会把预算烧成空/截断输出（learn/title 当年
 * 「标题永远失败」的同一口坑），而且截断的响应有些后端不写缓存——下一轮前缀
 * 从头冷起。判定本身只有几十个 token，预算大头留给思考。
 */
const ROUND_MAX_TOKENS = 2048
/** 开跑后第一轮等多久：给个首查，也让用户马上看到守卫「动了」 */
const FIRST_ROUND_DELAY_MS = 5_000
/** 抽帧的画面宽度：屏幕要看清内容给 800，摄像头认人给 480 */
const FRAME_WIDTH = { screen: 800, camera: 480 } as const
/** JPEG 质量：隐私与 token 之间取低不取高——这本来就不是取证录像 */
const FRAME_QUALITY = 0.6

/** 一轮监控的完整记录（页签按它画；images 是这一轮真正送给模型的帧） */
export interface GuardRound {
  at: number
  screen: boolean
  camera: boolean
  images: { mime: string; data: string }[]
  /** 随图发给模型的现场说明（番茄钟走到哪了、距上次交互多久） */
  context: string
  /** 模型回复原文（解析失败时它就是唯一证据） */
  raw: string
  reasoning: string
  verdict: GuardVerdict | null
  action: GuardAction
  error?: string
}

export type GuardState = 'running' | 'paused' | 'fused' | 'ended'

/** 当前（或最近一次）的守卫会话；rounds 持有图像字节，只活在内存里 */
export interface GuardSession {
  id: string
  startedAt: number
  monitors: GuardMonitors
  state: GuardState
  endedAt?: number
  rounds: GuardRound[]
  warnings: { at: number; reason: string }[]
  /** 每次暂停的起止（resumedAt 为 null = 还在暂停里） */
  pauseSpans: { at: number; resumedAt: number | null }[]
  fuse?: { at: number; reason: string }
}

/** 宿主注入的动作出口：LearnWorkspace 用它把守卫的判定落到番茄钟与界面上 */
export interface GuardHooks {
  onPause: (reason: string) => void
  onResume: () => void
  onWarn: (reason: string) => void
  onFuse: (reason: string) => void
  onToast: (msg: string) => void
  /** 每一轮随图发给模型的现场说明（「第 2/3 组专注 · 还剩 12 分钟」这种） */
  contextLine: () => string
}

/** 页签要读的快照（useSyncExternalStore：每次变更换新对象） */
export interface GuardSnapshot {
  session: GuardSession | null
  lastSession: GuardSession | null
  /** 预览 tile 据此知道自己该不该有画面 */
  streams: { screen: boolean; camera: boolean }
}

/* ---------- 快照与订阅 ---------- */

let session: GuardSession | null = null
let lastSession: GuardSession | null = null
let snap: GuardSnapshot = { session: null, lastSession: null, streams: { screen: false, camera: false } }
const listeners = new Set<() => void>()

function publish(): void {
  snap = {
    session: session ? { ...session, rounds: [...session.rounds] } : null,
    lastSession: lastSession ? { ...lastSession, rounds: [...lastSession.rounds] } : null,
    streams: { screen: !!streams.screen, camera: !!streams.camera },
  }
  for (const fn of listeners) fn()
}

export function subscribeGuard(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function guardSnapshot(): GuardSnapshot {
  return snap
}

/** 守卫此刻在当值吗（running / paused 都算） */
export function guardActive(): boolean {
  return !!session && (session.state === 'running' || session.state === 'paused')
}

/* ---------- 媒体流：屏幕与摄像头 ---------- */

const streams: { screen: MediaStream | null; camera: MediaStream | null } = { screen: null, camera: null }
const videos: { screen: HTMLVideoElement | null; camera: HTMLVideoElement | null } = { screen: null, camera: null }
const streamListeners = new Set<() => void>()

/**
 * 常驻的隐藏 <video>：预览 tile 用的那一份是观众，这一份才是抽帧的来源——
 * tip 关了、预览卸了，抽帧照常（守卫在后台跑）。分离于 DOM 的 video 不保证解码，
 * 所以真的挂在 body 上，缩成两像素、零透明度、不接指针。
 */
function hiddenVideo(kind: keyof typeof streams): HTMLVideoElement {
  const existing = videos[kind]
  if (existing) return existing
  const el = document.createElement('video')
  el.muted = true
  el.playsInline = true
  el.setAttribute('aria-hidden', 'true')
  el.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1'
  document.body.appendChild(el)
  videos[kind] = el
  return el
}

/** 确保某一路媒体流在跑（幂等）；失败回 null（无摄像头 / 被拒 / 被占用） */
export async function ensureStream(kind: 'screen' | 'camera'): Promise<MediaStream | null> {
  if (streams[kind] && streams[kind]!.active) return streams[kind]
  try {
    const stream =
      kind === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false })
        : await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 } }, audio: false })
    streams[kind] = stream
    // 用户在系统层停了共享（任务栏的屏幕共享按钮）：跟着熄掉，别抽黑帧
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      streams[kind] = null
      publish()
      notifyStreams()
    })
    const video = hiddenVideo(kind)
    video.srcObject = stream
    void video.play().catch(() => {})
    publish()
    notifyStreams()
    return stream
  } catch {
    return null
  }
}

/** 停掉一路（会话结束 / 用户取消勾选）；没有就当停过了 */
export function stopStream(kind: 'screen' | 'camera'): void {
  streams[kind]?.getTracks().forEach((track) => track.stop())
  if (videos[kind]) videos[kind].srcObject = null
  streams[kind] = null
  publish()
  notifyStreams()
}

/** 会话收尾的全部媒体流——熔断、完成、停止都走这里 */
function stopAllStreams(): void {
  for (const kind of ['screen', 'camera'] as const) stopStream(kind)
}

/** 预览 tile 的订阅：哪一路有流了/断了 */
export function subscribeGuardStreams(fn: () => void): () => void {
  streamListeners.add(fn)
  return () => {
    streamListeners.delete(fn)
  }
}

function notifyStreams(): void {
  for (const fn of streamListeners) fn()
}

/** 预览 tile 拿画面用（tile 自己管 srcObject 的挂与卸） */
export function getStream(kind: 'screen' | 'camera'): MediaStream | null {
  return streams[kind] && streams[kind]!.active ? streams[kind] : null
}

/** 从隐藏 video 抽一帧 JPEG（base64 不带头）；画面还没就绪回 null，这一轮就少一张图 */
function captureFrame(kind: 'screen' | 'camera'): { mime: string; data: string } | null {
  const video = videos[kind]
  const stream = streams[kind]
  if (!video || !stream || !stream.active || video.readyState < 2 || !video.videoWidth) return null
  const width = Math.min(FRAME_WIDTH[kind], video.videoWidth)
  const height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * width))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, width, height)
  const url = canvas.toDataURL('image/jpeg', FRAME_QUALITY)
  const prefix = 'data:image/jpeg;base64,'
  return url.startsWith(prefix) ? { mime: 'image/jpeg', data: url.slice(prefix.length) } : null
}

/* ---------- 会话与轮次 ---------- */

let hooks: GuardHooks | null = null
let lastInputAt: number | null = null
let lastWarnAt = 0
let timer: ReturnType<typeof setTimeout> | null = null
let roundInFlight = false
let interactionBound = false

/** 交互监听：指针按下、敲键、滚动都算「回来了」；平时只记时刻（屏幕模式的「人不在」代理） */
function onInteraction(): void {
  lastInputAt = Date.now()
  if (session?.state === 'paused') resumeGuard()
}

function bindInteraction(): void {
  if (interactionBound) return
  interactionBound = true
  for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
    window.addEventListener(type, onInteraction, { capture: true, passive: true })
  }
}

function unbindInteraction(): void {
  if (!interactionBound) return
  interactionBound = false
  for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
    window.removeEventListener(type, onInteraction, { capture: true })
  }
}

/**
 * 开一次守卫会话。勾了监控才算严格专注：哪一路媒体流都没拿到（被拒/没有设备）就
 * 不开守卫，让调用方按纯番茄钟继续。已开的旧会话先收掉——重新开始是新的一段。
 * 实际拿到的媒体流可能比请求的少（某一路失败），会话里的 monitors 以实到为准。
 */
export async function startGuard(requested: GuardMonitors, nextHooks: GuardHooks): Promise<GuardMonitors | null> {
  stopGuard('new session')
  hooks = nextHooks
  const got: GuardMonitors = { screen: false, camera: false }
  if (requested.screen) got.screen = !!(await ensureStream('screen'))
  if (requested.camera) got.camera = !!(await ensureStream('camera'))
  if (!got.screen && !got.camera) {
    hooks = null
    nextHooks.onToast(t('屏幕与摄像头都没拿到，严格专注没有开起来（普通番茄钟继续）'))
    return null
  }
  if (requested.screen !== got.screen || requested.camera !== got.camera) {
    nextHooks.onToast(t('有一路监控没拿到（权限或设备占用），按拿到的继续'))
  }
  lastInputAt = Date.now()
  lastWarnAt = 0
  // 上下文的头一件东西：按实到的监控现算的系统提示词（新一轮会话从空历史起步）
  history = [{ role: 'system', content: guardSystemPrompt(got) }]
  session = {
    id: 'g' + Date.now().toString(36),
    startedAt: Date.now(),
    monitors: got,
    state: 'running',
    rounds: [],
    warnings: [],
    pauseSpans: [],
  }
  lastSession = session
  bindInteraction()
  publish()
  scheduleRound(FIRST_ROUND_DELAY_MS)
  return got
}

/** 收掉当前会话（完成/停止/熔断都走）；日志留给 lastSession 供报告取用 */
export function stopGuard(_reason: string): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!session || session.state === 'ended' || session.state === 'fused') {
    if (session) {
      session = { ...session, state: 'ended', endedAt: session.endedAt ?? Date.now() }
      publish()
    }
    return
  }
  session = { ...session, state: 'ended', endedAt: Date.now() }
  lastSession = session
  stopAllStreams()
  unbindInteraction()
  publish()
}

/** 守卫判离开：暂停（监控也停——暂停期间不抽帧不发请求） */
export function pauseGuard(reason: string): void {
  if (!session || session.state !== 'running') return
  session = { ...session, state: 'paused', pauseSpans: [...session.pauseSpans, { at: Date.now(), resumedAt: null }] }
  publish()
  hooks?.onPause(reason)
}

/** 交互回来了：续上计时与监控。第一轮不抢拍——回到正常轮询节奏，等满一个间隔再检查 */
export function resumeGuard(): void {
  if (!session || session.state !== 'paused') return
  const spans = session.pauseSpans.map((s, i) => (i === session!.pauseSpans.length - 1 ? { ...s, resumedAt: Date.now() } : s))
  session = { ...session, state: 'running', pauseSpans: spans }
  publish()
  hooks?.onResume()
  /*
   * 恢复后等满一轮（而不是立刻看一眼）：刚坐回来的这一分钟是热身——坐下、
   * 把界面切回学习内容都需要时间，落座就拍一张大概率拍到「正在切换」的
   * 中间态，白白吃一次警告。计时恢复是即时的，等的只是下一次监控。
   */
  scheduleRound(GUARD_ROUND_MS)
}

/** 熔断：先停媒体流（晚一拍都是事故），再交给宿主停番茄钟、写报告、弹窗 */
function fuse(reason: string): void {
  if (!session) return
  const spans = session.pauseSpans.map((s) => (s.resumedAt === null ? { ...s, resumedAt: Date.now() } : s))
  session = { ...session, state: 'fused', endedAt: Date.now(), fuse: { at: Date.now(), reason }, pauseSpans: spans }
  lastSession = session
  stopAllStreams()
  unbindInteraction()
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  publish()
  hooks?.onFuse(reason)
}

function scheduleRound(delayMs: number): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void runRound()
  }, delayMs)
}

/** 一轮监控：抽帧 → 发模型 → 解析判定 → 按策略动作。失败记成错误轮，绝不瞎动作 */
async function runRound(): Promise<void> {
  if (!session || session.state !== 'running' || roundInFlight) return
  roundInFlight = true
  try {
    const images: { mime: string; data: string }[] = []
    if (session.monitors.screen) {
      const frame = captureFrame('screen')
      if (frame) images.push(frame)
    }
    if (session.monitors.camera) {
      const frame = captureFrame('camera')
      if (frame) images.push(frame)
    }
    const sinceInput = lastInputAt === null ? null : Date.now() - lastInputAt
    const context = [
      hooks?.contextLine() ?? '',
      lastInputAt === null
        ? t('还没有收到过任何交互')
        : t('距上一次与应用交互 {0} 秒', Math.round((Date.now() - lastInputAt) / 1000)),
    ]
      .filter(Boolean)
      .join('；')

    const parts: ChatContentPart[] = [
      ...images.map((img) => ({ type: 'image' as const, mime: img.mime, data: img.data })),
      { type: 'text' as const, text: context },
    ]
    const liveMessage: ChatMessage = { role: 'user', content: parts }

    let raw = ''
    let reasoning = ''
    let error: string | undefined
    try {
      const { provider, model } = resolveGlobal()
      const controller = new AbortController()
      const abort = setTimeout(() => controller.abort(), ROUND_TIMEOUT_MS)
      try {
        const res = await streamChatWith(provider, model, {
          messages: historyWith(liveMessage),
          maxTokens: ROUND_MAX_TOKENS,
          reasoningEffort: 'low',
          signal: controller.signal,
          purpose: 'guard',
        })
        raw = res.content
        reasoning = res.reasoning
      } finally {
        clearTimeout(abort)
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }

    const verdict = error ? null : parseVerdict(raw)
    if (!error && !verdict) error = t('回复不是约定的 JSON，这一轮没有动作')
    const action: GuardAction = verdict ? decideGuardAction(verdict, session.monitors, sinceInput) : 'none'

    const round: GuardRound = {
      at: Date.now(),
      screen: session.monitors.screen,
      camera: session.monitors.camera,
      images,
      context,
      raw,
      reasoning,
      verdict,
      action,
      ...(error ? { error } : {}),
    }
    session = { ...session, rounds: [...session.rounds, round] }

    /*
     * 历史里记的是**纯文本**的一问一答（帧只活在当前这条消息里），判定有连续性
     * 靠的是历史里的判定原文，不是重看旧帧。带图的历史是前缀缓存的毒药：
     * 一来不少服务商的前缀缓存不认图像 token，图进前缀就整段永远命不中；
     * 二来请求体积按轮数线性膨胀（40 轮 × 2 图 ≈ 每请求 8 万 token 的重传）。
     * 这一轮附了什么画面用一句固定的注记说清——它在历史里必须逐字节稳定。
     */
    const framesNote = round.screen && round.camera
      ? t('（附屏幕截图与摄像头画面）')
      : round.screen
        ? t('（附屏幕截图）')
        : t('（附摄像头画面）')
    history.push(
      { role: 'user', content: context + framesNote },
      { role: 'assistant', content: raw || (error ?? '') },
    )
    trimHistory()

    if (verdict) {
      const reason = verdict.reason || t('（模型没给说明）')
      if (action === 'fuse') {
        fuse(reason)
        return
      }
      if (action === 'pause') {
        pauseGuard(reason)
        return // 暂停期间不再排轮；恢复时 scheduleRound 会接上
      }
      if (action === 'warn' && Date.now() - lastWarnAt > WARN_COOLDOWN_MS) {
        lastWarnAt = Date.now()
        session = { ...session, warnings: [...session.warnings, { at: Date.now(), reason }] }
        hooks?.onWarn(reason)
      }
    }
    publish()
    scheduleRound(GUARD_ROUND_MS)
  } finally {
    roundInFlight = false
  }
}

/* ---------- 上下文（发请求用的一份消息历史） ---------- */

let history: ChatMessage[] = []

function historyWith(message: ChatMessage): ChatMessage[] {
  return [...history, message]
}

/** 历史有上限：只剪最旧的一问一答，系统提示词永远在最前 */
function trimHistory(): void {
  // 一轮占两条（user + assistant）；MAX_HISTORY_ROUNDS 按「轮」算
  while (history.length > 1 + MAX_HISTORY_ROUNDS * 2) history.splice(1, 2)
}

/* ---------- 给报告取材 ---------- */

export interface GuardFacts {
  startedAt: number
  endedAt: number
  monitors: GuardMonitors
  pausedMs: number
  pauseCount: number
  pauseSpans: { at: number; resumedAt: number | null }[]
  warnings: { at: number; reason: string }[]
  fused?: { at: number; reason: string }
  /** 报告轮：判定与动作都在，图像字节不带（报告是文件，不该存监控帧） */
  rounds: {
    at: number
    screen: boolean
    camera: boolean
    verdict: GuardVerdict | null
    action: GuardAction
    reason: string
  }[]
}

/** 收尾时把这一场的守卫事实交给报告（优先当前会话，其次最近一次） */
export function collectGuardFacts(now = Date.now()): GuardFacts | null {
  const s = session ?? lastSession
  if (!s) return null
  const endedAt = s.endedAt ?? now
  const pausedMs = s.pauseSpans.reduce((sum, span) => sum + Math.max(0, (span.resumedAt ?? endedAt) - span.at), 0)
  return {
    startedAt: s.startedAt,
    endedAt,
    monitors: s.monitors,
    pausedMs,
    pauseCount: s.pauseSpans.length,
    pauseSpans: s.pauseSpans,
    warnings: s.warnings,
    ...(s.fuse ? { fused: s.fuse } : {}),
    rounds: s.rounds.map((r) => ({
      at: r.at,
      screen: r.screen,
      camera: r.camera,
      verdict: r.verdict,
      action: r.action,
      reason: r.verdict?.reason || r.error || '',
    })),
  }
}
