import { readUserSettings, settingsRevision, settingsUid, writeUserSettings } from '../lib/userSettings'
import { DEFAULT_PERSONA, personaOf, type PersonaId } from './persona'

/**
 * 超级导师自己的设置（与全局设置分开）。
 *
 * 为什么另立一份而不是塞进 ai/settings：那一片回答的是「用哪家的哪个模型、Key 是什么」——
 * 是全站所有 AI 功能（描述生成、阅卷、短释义）的共同基底；这一片只回答「这个 Agent
 * 怎么跑」：上下文什么时候压、压到什么程度。前者换一次影响一大片，后者只影响对话区。
 * 界面上也因此是两个窗口：全局设置管「模型」，agent 设置管「这个 Agent 自己」。
 *
 * 存在同一个用户配置文件里（setting.yaml 的 agent 段）：它同样是「跟着用户走」的东西，
 * 同一份文件、同一个生命周期，分开的只是模块。
 */

export interface CompactSettings {
  /** 到阈值自动压缩；关掉之后只有手动「压缩上下文」会压 */
  auto: boolean
  /**
   * 自动压缩的阈值：上下文占用（input tokens ÷ 窗口）超过它就先压一轮。
   *
   * 默认 0.7。为什么不等到 0.9：一轮里模型要来回好几跳，每一跳的输入都比上一跳大
   * （工具结果要回填），压到只剩 10% 的余量时，最后那一跳很容易顶着窗口报错；
   * 而且**压缩本身**也要花一轮工作流。留三成余量，够把这一轮跑完。
   */
  threshold: number
}

export interface AgentSettings {
  version?: number
  compact: CompactSettings
  /**
   * 导师人格（见 agent/persona）。
   *
   * 它属于「这个 Agent 怎么跑」而不是「用哪个模型」，所以与压缩阈值住在同一份设置里。
   * 切换是即时的：人格不改系统提示词，而是以一条隐藏的 user 消息补进对话
   * （下一轮生效，见 useAgent 的 runTurn）——所以换人格不重发历史、不破前缀缓存。
   */
  persona: PersonaId
  /**
   * 开发者向的开关（设置里的「开发者」分页，见 components/AgentSettingsModal）。
   * 全部默认关闭：它们是调试工具，不是功能。
   */
  dev: AgentDevSettings
}

export interface AgentDevSettings {
  /**
   * 上下文比对调试器：开着时，runtime 在每次把上下文发往 API 之前记录一份快照
   * （见 agent/contextFilter），调试器窗口据此比对两轮之间上下文差异出现在哪个部位。
   */
  contextDebugger: boolean
}

/** 阈值的可选区间：低于 0.4 会压得太勤（每一轮都在压），高于 0.95 就没有余量了 */
export const COMPACT_THRESHOLD_MIN = 0.4
export const COMPACT_THRESHOLD_MAX = 0.95
export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  version: 1,
  compact: { auto: true, threshold: 0.7 },
  // 默认「标准导师」：不追求极致效率也不追求极致趣味，大多数情况下最自然的那一个
  persona: DEFAULT_PERSONA,
  dev: { contextDebugger: false },
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return Math.min(hi, Math.max(lo, n))
}

/**
 * 归一化。存进来的可能是旧版本、手改过的 YAML，也可能是别的版本写的——
 * 一律按「缺什么补什么、越界就夹回去」处理，绝不抛异常：设置读不出来不该让应用起不来。
 */
export function normalizeAgentSettings(raw: unknown): AgentSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<AgentSettings>
  const compact = (src.compact && typeof src.compact === 'object' ? src.compact : {}) as Partial<CompactSettings>
  const dev = (src.dev && typeof src.dev === 'object' ? src.dev : {}) as Partial<AgentDevSettings>
  return {
    version: 1,
    compact: {
      auto: typeof compact.auto === 'boolean' ? compact.auto : DEFAULT_AGENT_SETTINGS.compact.auto,
      threshold: clamp(compact.threshold, COMPACT_THRESHOLD_MIN, COMPACT_THRESHOLD_MAX, DEFAULT_AGENT_SETTINGS.compact.threshold),
    },
    // 认不出的人格（老设置文件、手改成了别的词）就按默认那个走：设置读不出来不该让对话哑掉
    persona: personaOf(src.persona).id,
    dev: {
      contextDebugger:
        typeof dev.contextDebugger === 'boolean' ? dev.contextDebugger : DEFAULT_AGENT_SETTINGS.dev.contextDebugger,
    },
  }
}

/* ---------- 读写 ---------- */

// 与 ai/settings 同一套缓存口径：键是「用户 + 配置版本」，切换用户或重新载入自然失效
let cache: { key: string; value: AgentSettings } | null = null

const cacheKey = (): string => `${settingsUid() ?? ''}#${settingsRevision()}`

export function loadAgentSettings(): AgentSettings {
  const key = cacheKey()
  if (cache && cache.key === key) return cache.value
  cache = { key, value: normalizeAgentSettings(readUserSettings('agent')) }
  return cache.value
}

export function saveAgentSettings(next: AgentSettings): void {
  const value = normalizeAgentSettings(next)
  cache = { key: cacheKey(), value }
  writeUserSettings('agent', value)
  for (const listener of [...listeners]) listener()
}

/* ---------- 变更订阅 ---------- */

const listeners = new Set<() => void>()

/** 供 useSyncExternalStore 用：agent 设置是模块级状态，不通知的话界面拿着旧快照 */
export function subscribeAgentSettings(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
