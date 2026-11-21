import { readUserSettings, settingsRevision, settingsUid, writeUserSettings } from '../lib/userSettings'
import { DEFAULT_PERSONA, personaOf, type Persona, type PersonaId } from './persona'
import { DEFAULT_DOC_FORMAT, docFormatOf, type DocFormat, type DocFormatId } from './docFormat'

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

import { DEFAULT_SKILL_SETTINGS, type SkillSettings } from './skill/types'
import { DEFAULT_MCP_SETTINGS, DEFAULT_MCP_SERVE_SETTINGS, type McpServeSettings, type McpServerConfig, type McpSettings } from './mcp/types'
import { REASONING_EFFORTS, type ReasoningEffort } from '../ai/types'
import { AGENT_TEAM_IDS, type AgentProfile, type AgentProfileId } from './agentProfile'

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
  /** 用户自定义导师人格列表 */
  customPersonas?: Persona[]
  /**
   * 文档格式策略（见 agent/docFormat）：教学文档「怎么排、用什么写」——
   * 混合（Markdown 为主，默认）/ 纯 Markdown / 纯 HTML。
   *
   * 与人格同一套注入机制：不改系统提示词，切换时补一条隐藏 user 消息（下一轮生效）。
   * 两种覆盖态（纯 Markdown / 纯 HTML）靠这条指令在上下文里把口径从系统提示词的
   * 「Markdown 为主」掰到各自的写法上——所以它必须和人格一样能补、能重补（压缩后）。
   */
  docFormat: DocFormatId
  /** 用户自定义文档生成格式策略列表 */
  customDocFormats?: DocFormat[]
  /**
   * 开发者向的开关（设置里的「开发者」分页，见 components/AgentSettingsPanel）。
   * 全部默认关闭：它们是调试工具，不是功能。
   */
  dev: AgentDevSettings
  /**
   * 专长技能 (Skill) 配置：
   * 扩展导师的思维模式、认知框架与特定领域行动指南。
   */
  skills?: SkillSettings
  /**
   * Model Context Protocol (MCP) 基础设施配置：
   * 支持通过标准协议挂载外部工具与上下文服务。
   */
  mcp?: McpSettings
  /**
   * 对外 MCP 服务（应用本身当 MCP server）：外部 harness 经命名管道连进来当外设智能体。
   * 见 electron/mcp/serve 与设置里的「对外 MCP 服务」分页。
   */
  mcpServe?: McpServeSettings
  /**
   * 额外系统提示词配置：
   * 允许用户全局追加自定义系统提示词，默认不启用。
   */
  extraSystemPrompt?: string
  extraSystemPromptEnabled?: boolean
  /**
   * 基础原生工具安全权限配置：
   * 目标数据目录默认完全放行；外部真实系统目录需在此白名单放行。
   */
  permissions?: AgentPermissionsSettings
  /**
   * 智能体的独立设置（per-agent profile，见 agent/agentProfile）：
   * agent team 里每位声部（仅聊天 / 导师）自己的名字、头像、api 白名单、
   * 工作流、提供商-模型与思考档位。缺省字段 = 跟随全局默认。
   */
  profiles?: Partial<Record<AgentProfileId, AgentProfile>>
}

export interface AgentPermissionsSettings {
  /** 外部允许直接访问的白名单目录列表 */
  allowedDirs: string[]
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
  customPersonas: [],
  // 默认「混合（Markdown 为主）」：与系统提示词的正文排版规范一致
  docFormat: DEFAULT_DOC_FORMAT,
  customDocFormats: [],
  extraSystemPrompt: '',
  extraSystemPromptEnabled: false,
  dev: { contextDebugger: false },
  skills: DEFAULT_SKILL_SETTINGS,
  mcp: DEFAULT_MCP_SETTINGS,
  mcpServe: DEFAULT_MCP_SERVE_SETTINGS,
  permissions: {
    allowedDirs: [],
  },
  profiles: {},
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return Math.min(hi, Math.max(lo, n))
}

/**
 * 老预设的修复迁移（幂等）：内置预设一度指向**不存在的 npm 包**或死路径——
 * `@modelcontextprotocol/server-fetch` / `server-sqlite` 在 npm 上都是 404，
 * filesystem 的 `./workspace` 在数据根下也不存在。配过那些预设的服务存下来的
 * 就是这些死参数，只换预设定义救不了它们。这里按**包名精确匹配**替换：
 * 用户自己改过的参数（别的包、别的路径）一律不碰。
 */
function migrateMcpServers(servers: McpServerConfig[]): McpServerConfig[] {
  let touched = false
  const next = servers.map((s) => {
    if (!s || typeof s !== 'object') return s
    const args = Array.isArray(s.args) ? s.args.map(String) : []
    if (s.transport !== 'stdio' || !args.length) return s
    if (args.includes('@modelcontextprotocol/server-fetch')) {
      touched = true
      return { ...s, args: args.map((a) => (a === '@modelcontextprotocol/server-fetch' ? '@tokenizin/mcp-npx-fetch' : a)) }
    }
    if (args.includes('@modelcontextprotocol/server-sqlite')) {
      // 旧包不存在，且新包形态完全不同（--db-path 取消，数据库路径按调用传）
      touched = true
      return { ...s, args: ['-y', 'mcp-sqlite-server'] }
    }
    if (args.includes('@modelcontextprotocol/server-filesystem') && args.includes('./workspace')) {
      touched = true
      return { ...s, args: args.map((a) => (a === './workspace' ? '.' : a)) }
    }
    return s
  })
  return touched ? next : servers
}

/**
 * 归一化。存进来的可能是旧版本、手改过的 YAML，也可能是别的版本写的——
 * 一律按「缺什么补什么、越界就夹回去」处理，绝不抛异常：设置读不出来不该让应用起不来。
 */
export function normalizeAgentSettings(raw: unknown): AgentSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<AgentSettings>
  const compact = (src.compact && typeof src.compact === 'object' ? src.compact : {}) as Partial<CompactSettings>
  const dev = (src.dev && typeof src.dev === 'object' ? src.dev : {}) as Partial<AgentDevSettings>
  const skills = (src.skills && typeof src.skills === 'object' ? src.skills : {}) as Partial<SkillSettings>
  const mcp = (src.mcp && typeof src.mcp === 'object' ? src.mcp : {}) as Partial<McpSettings>
  const mcpServe = (src.mcpServe && typeof src.mcpServe === 'object' ? src.mcpServe : {}) as Partial<McpServeSettings>
  const permissions = (src.permissions && typeof src.permissions === 'object' ? src.permissions : {}) as Partial<AgentPermissionsSettings>
  /**
   * 智能体独立设置（profiles）：逐字段白名单重建，形状不对的整条丢弃、空壳不存。
   * 与其它段同一条纪律——归一化跑在每次读写上，这里就是「新字段必须透传」的那一关。
   */
  const profiles: Partial<Record<AgentProfileId, AgentProfile>> = {}
  if (src.profiles && typeof src.profiles === 'object') {
    for (const id of AGENT_TEAM_IDS) {
      const p = (src.profiles as Partial<Record<AgentProfileId, unknown>>)[id]
      if (!p || typeof p !== 'object') continue
      const rec = p as Partial<AgentProfile>
      const next: AgentProfile = {}
      // 身份字段存非空值：空串与缺省同义（显示侧回落默认名/头像），不落盘
      if (typeof rec.name === 'string' && rec.name.trim()) next.name = rec.name
      if (typeof rec.avatar === 'string' && rec.avatar.trim()) next.avatar = rec.avatar
      // apiGroups 刻意不在白名单里：execute 能力面已定稿为架构固定（按声部的团队分工面，
      // 见 agent/agentProfile 的 AGENT_API_PLANES），旧版本存下的清单在这里被静默作废——不透传即弃
      if (Array.isArray(rec.workflows)) next.workflows = rec.workflows.map(String).filter((w) => w.trim())
      if (typeof rec.providerId === 'string' && rec.providerId.trim()) next.providerId = rec.providerId
      if (typeof rec.model === 'string' && rec.model.trim()) next.model = rec.model
      if (typeof rec.effort === 'string' && REASONING_EFFORTS.includes(rec.effort as ReasoningEffort)) {
        next.effort = rec.effort as ReasoningEffort
      }
      if (Object.keys(next).length) profiles[id] = next
    }
  }
  const customPersonas = Array.isArray(src.customPersonas)
    ? src.customPersonas.filter(
        (p): p is Persona =>
          !!p &&
          typeof p.id === 'string' &&
          typeof p.label === 'string' &&
          typeof p.instruction === 'string',
      )
    : []
  const customDocFormats = Array.isArray(src.customDocFormats)
    ? src.customDocFormats.filter(
        (f): f is DocFormat =>
          !!f &&
          typeof f.id === 'string' &&
          typeof f.label === 'string' &&
          typeof f.instruction === 'string',
      )
    : []

  return {
    version: 1,
    compact: {
      auto: typeof compact.auto === 'boolean' ? compact.auto : DEFAULT_AGENT_SETTINGS.compact.auto,
      threshold: clamp(compact.threshold, COMPACT_THRESHOLD_MIN, COMPACT_THRESHOLD_MAX, DEFAULT_AGENT_SETTINGS.compact.threshold),
    },
    persona: personaOf(src.persona, customPersonas).id,
    customPersonas,
    // 同理：认不出的格式（老设置文件里根本没有这一项）按默认的「混合」走
    docFormat: docFormatOf(src.docFormat, customDocFormats).id,
    customDocFormats,
    extraSystemPrompt: typeof src.extraSystemPrompt === 'string' ? src.extraSystemPrompt : '',
    extraSystemPromptEnabled:
      typeof src.extraSystemPromptEnabled === 'boolean' ? src.extraSystemPromptEnabled : false,
    dev: {
      contextDebugger:
        typeof dev.contextDebugger === 'boolean' ? dev.contextDebugger : DEFAULT_AGENT_SETTINGS.dev.contextDebugger,
    },
    skills: {
      enabled: typeof skills.enabled === 'boolean' ? skills.enabled : DEFAULT_SKILL_SETTINGS.enabled,
      skills: Array.isArray(skills.skills) ? skills.skills : DEFAULT_SKILL_SETTINGS.skills,
    },
    mcp: {
      enabled: typeof mcp.enabled === 'boolean' ? mcp.enabled : DEFAULT_MCP_SETTINGS.enabled,
      servers: Array.isArray(mcp.servers) ? migrateMcpServers(mcp.servers) : DEFAULT_MCP_SETTINGS.servers,
    },
    mcpServe: {
      enabled: typeof mcpServe.enabled === 'boolean' ? mcpServe.enabled : DEFAULT_MCP_SERVE_SETTINGS.enabled,
    },
    permissions: {
      allowedDirs: Array.isArray(permissions.allowedDirs)
        ? permissions.allowedDirs.map(String).map((d) => d.trim()).filter(Boolean)
        : [],
    },
    profiles,
  }
}

/* ---------- 读写 ---------- */

// 与 ai/settings 同一套缓存口径：键是「用户 + 配置版本」，切换用户或重新载入自然失效
let cache: { key: string; value: AgentSettings } | null = null

const cacheKey = (): string => `${settingsUid() ?? ''}#${settingsRevision()}`

function syncNativePermissions(dirs: string[]): void {
  try {
    if (typeof window !== 'undefined' && window.mojiNative?.base?.syncPermissions) {
      window.mojiNative.base.syncPermissions(dirs).catch(() => {})
    }
  } catch {
    // 忽略非 Electron 或未初始化环境
  }
}

export function loadAgentSettings(): AgentSettings {
  const key = cacheKey()
  if (cache && cache.key === key) return cache.value
  cache = { key, value: normalizeAgentSettings(readUserSettings('agent')) }
  syncNativePermissions(cache.value.permissions?.allowedDirs || [])
  return cache.value
}

export function saveAgentSettings(next: AgentSettings): void {
  const value = normalizeAgentSettings(next)
  cache = { key: cacheKey(), value }
  writeUserSettings('agent', value)
  syncNativePermissions(value.permissions?.allowedDirs || [])
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
