/**
 * 智能体的**独立设置**（per-agent profile）与**团队分工**（能力面分配）。
 *
 * 为什么要单独一份而不是塞进 AgentSettings 的顶层字段：设置里的每片配置原本回答的是
 * 「超级导师（导师声部）怎么跑」——但 agent team 里不止一位声部，它们各有各的名字与
 * 头像、各自能碰哪些 api、各自能触发哪些工作流、各自跑在哪家模型上。这些「按声部各
 * 一份」的配置就住进 profiles：<声部 id> → AgentProfile。
 *
 * 存储跟着 AgentSettings 走（setting.yaml 的 agent 段，users/{uid}/setting.yaml）：
 * 同一份文件、同一个生命周期、同一套订阅（saveAgentSettings 会广播）。
 *
 * 缺省语义贯穿始终：**profile 里没写的字段 = 跟随现状**——名字用默认名、模型跟随全局
 * 默认、档位跟随全局滑条、api 与工作流按团队分工面走。只有用户显式改过的字段才落盘，
 * 所以归一化剥掉空壳（没有任何自定义字段的 profile 不存）。
 */

import type { ReasoningEffort } from '../ai/types'
import { resolveGlobal, type AiSettings } from '../ai/settings'
import type { ResolvedProvider } from '../ai/client'
import { loadAgentSettings, saveAgentSettings, type AgentSettings } from './settings'

/**
 * 智能体声部 id（agent team 左栏的五位，与 components 的 AgentTeamMode 同形）：
 * - tutor      导师：主讲与协调（教学对话、大纲、画像、日程），团队里的分诊入口；
 * - examiner   命题官：试卷命题、课堂课件、超级实验室、伪编译与图像修复；
 * - grader     判卷官：判分与错题讲解（交卷后的阅卷轮跑在它的会话里）；
 * - researcher 资料员：联网调研、内置浏览器实操、项目与文章解读、视频总览；
 * - free       仅聊天：不挂目标的纯对话（固定页签，无 execute 工具面）。
 */
export type AgentProfileId = 'free' | 'tutor' | 'examiner' | 'grader' | 'researcher'

/** 挂在目标上的执行声部（free 不挂目标，是固定页签） */
export type AgentVoice = Exclude<AgentProfileId, 'free'>

/** 全部执行声部（tutor 在前：老数据没有 voice 字段时兜到它） */
export const AGENT_VOICES: readonly AgentVoice[] = ['tutor', 'examiner', 'grader', 'researcher']

/** team.* 的完整名单（free 也算：它可以承接纯对话性质的委托） */
export const AGENT_TEAM_IDS: readonly AgentProfileId[] = ['free', 'tutor', 'examiner', 'grader', 'researcher']

/** 一位智能体的独立设置。缺省字段 = 跟随默认 / 全局，见模块顶部说明 */
export interface AgentProfile {
  /** 显示名覆盖；空 / 缺省 = 默认名（仅聊天 / 导师 / 命题官 …） */
  name?: string
  /** 头像 id（AGENT_AVATARS 目录）；缺省 = 默认头像 */
  avatar?: string
  /** 允许触发的工作流 id 清单（只管登记的全局 / 目标级，内置规程面由团队分工固定）；undefined = 全部可用（仅导师） */
  workflows?: string[]
  /** 提供商覆盖（providers 的 id）；缺省 = 跟随全局默认 */
  providerId?: string
  /** 模型覆盖（必须属于生效的提供商，否则回落该提供商默认模型） */
  model?: string
  /** 思考档位覆盖；缺省 = 跟随全局滑条（全应用唯一那份） */
  effort?: ReasoningEffort
}

/** 头像目录：id → 展示名。图标组件映射在 components 一侧（agentAvatars.tsx），这里只存纯数据 */
export const AGENT_AVATARS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'chat', label: '对话气泡' },
  { id: 'grad', label: '导师帽' },
  { id: 'bot', label: '机器人' },
  { id: 'book', label: '书本' },
  { id: 'flask', label: '实验瓶' },
  { id: 'compass', label: '指南针' },
  { id: 'spark', label: '灵感' },
  { id: 'brain', label: '思维' },
]

export const DEFAULT_AGENT_NAME: Record<AgentProfileId, string> = {
  free: '仅聊天',
  tutor: '导师',
  examiner: '命题官',
  grader: '判卷官',
  researcher: '资料员',
}
export const DEFAULT_AGENT_AVATAR: Record<AgentProfileId, string> = {
  free: 'chat',
  tutor: 'grad',
  examiner: 'spark',
  grader: 'brain',
  researcher: 'compass',
}

/* ---------- 团队分工：api 能力面 ---------- */

/**
 * 一位声部的 execute 能力面。**由架构固定、不可增删**（设置里纯只读展示）——
 * 「谁会什么」是团队分工，不是用户偏好；分配原则：
 * - core 顶层原语（wait / ask / tiktok / compact / fetch / see）按需给：ask / see 给
 *   要与人交互、要看图面的声部；fetch 只给有 web 组的声部；
 * - 域专属组只给对应的声部（exam → 判卷官、classroom → 命题官、browser → 资料员、
 *   subagent / mcp / permission → 只有导师）——职责拆分就是能力面拆分；
 * - delivery / tmp / team 全体执行声部都有：交付登记、临时变量与团队协作是协作纪律。
 */
export interface AgentApiPlane {
  /** 文档与设置页展示的 api 组（'core' 只作文档展示；运行时放行走 topLevel + 组名） */
  groups: readonly string[]
  /** 运行时放行的顶层函数（core 组的成员在运行时按裸函数名对账，见 sandbox/execute） */
  topLevel: readonly string[]
}

/** 全体执行声部都有的顶层原语：等待、表单、响铃与压缩交接 */
const CORE_TOP_LEVEL_ALL = ['wait', 'ask', 'tiktok', 'compact'] as const
/** 带联网的声部额外拿 fetch（web.fetch 的别名）；看图面另给 see */
const CORE_TOP_LEVEL_WEB = [...CORE_TOP_LEVEL_ALL, 'fetch', 'see'] as const

export const AGENT_API_PLANES: Record<AgentVoice, AgentApiPlane> = {
  tutor: {
    groups: [
      'node', 'memory', 'schedule', 'tmp', 'res', 'workspace', 'userInfo', 'method', 'wf',
      'code', 'chip', 'delivery', 'web', 'browser', 'mcp', 'ui', 'subagent', 'permission',
      'files', 'process', 'skill', 'video', 'project', 'team',
    ],
    topLevel: CORE_TOP_LEVEL_WEB,
  },
  examiner: {
    groups: [
      'node', 'tmp', 'res', 'workspace', 'userInfo', 'method', 'wf', 'code', 'chip',
      'delivery', 'web', 'ui', 'files', 'classroom', 'project', 'team',
    ],
    topLevel: CORE_TOP_LEVEL_WEB,
  },
  grader: {
    groups: ['node', 'exam', 'tmp', 'wf', 'delivery', 'team'],
    topLevel: ['wait', 'compact'],
  },
  researcher: {
    groups: [
      'node', 'tmp', 'res', 'workspace', 'wf', 'chip', 'delivery', 'web', 'browser',
      'files', 'project', 'video', 'team',
    ],
    topLevel: CORE_TOP_LEVEL_WEB,
  },
}

/**
 * 运行时 apiAllow（sandbox/execute 通道口按 `api.<名>` 的首段对账）：声部的组名 +
 * 放行的顶层函数名。'core' 只是文档展示组，运行时不存在 api.core.*，不进清单。
 */
export function agentRuntimeApiAllow(voice: AgentVoice): string[] {
  return [...AGENT_API_PLANES[voice].groups.filter((g) => g !== 'core'), ...AGENT_API_PLANES[voice].topLevel]
}

/* ---------- 团队分工：工作流面 ---------- */

/**
 * 每位声部固定可触发的**内置**工作流（设置里只读、不可增删）：
 * - 导师留下教学主线（开讲 / 大纲 / 导读 / 划词注解）与压缩交接；
 * - 命题官拿走创作域（出卷 / 课堂 / 超级实验室 / 伪编译 / 修图）；
 * - 判卷官只管阅卷；
 * - 资料员拿走调研域（浏览器操作 / 项目解读 / 视频总览）。
 * compact 全员都有：自动压缩不分声部，长会话都要能交接。
 */
export const AGENT_WORKFLOW_PLANES: Record<AgentVoice, readonly string[]> = {
  tutor: ['teach-node', 'outline', 'outline-guide', 'explain', 'compact'],
  examiner: ['exam', 'classroom', 'superlab', 'plot-fix', 'code-compile', 'compact'],
  grader: ['exam-grade', 'compact'],
  researcher: ['browser-use', 'project-interpret', 'video-overview', 'compact'],
}

/** 登记工作流的授权面：builtin = 声部固定面；registered = 登记条目（null = 全部可用） */
export interface AgentWfGrant {
  builtin: ReadonlySet<string>
  registered: ReadonlySet<string> | null
}

/** 登记的工作流只有导师管（教学编排是导师的活，设置里的白名单也只对导师有意义） */
export function agentWfGrant(settings: AgentSettings, voice: AgentVoice): AgentWfGrant {
  const list = settings.profiles?.[voice]?.workflows
  return {
    builtin: new Set(AGENT_WORKFLOW_PLANES[voice]),
    registered: voice === 'tutor' ? wfAllowOf(list) : new Set<string>(),
  }
}

/**
 * 按工作流 id 反查该由哪位声部跑（系统侧触发口的分诊口径：界面的出卷 / 阅卷 /
 * 课件按钮直接把轮开到对应声部的工作会话）。不在任何分工面里的 id（登记条目）归导师。
 */
export function voiceForWorkflow(id: string): AgentVoice {
  const key = id.trim().toLowerCase()
  for (const voice of AGENT_VOICES) {
    if (AGENT_WORKFLOW_PLANES[voice].includes(key)) return voice
  }
  return 'tutor'
}

function wfAllowOf(list: string[] | undefined): ReadonlySet<string> | null {
  if (!list) return null
  return new Set(list.map((w) => w.trim().toLowerCase()).filter(Boolean))
}

/** 显示名：profile 的非空名字覆盖，否则默认名（团队编排 / 委托的称呼都走这里） */
export function agentNameOf(profile: AgentProfile | undefined, id: AgentProfileId): string {
  const v = profile?.name?.trim()
  return v || DEFAULT_AGENT_NAME[id]
}

/** 头像 id 的兜底校验：认不出的一律回默认头像 */
export function agentAvatarIdOf(profile: AgentProfile | undefined, id: AgentProfileId): string {
  const v = profile?.avatar?.trim()
  return v && AGENT_AVATARS.some((a) => a.id === v) ? v : DEFAULT_AGENT_AVATAR[id]
}

/* ---------- 读写 ---------- */

export function profileOf(settings: AgentSettings, id: AgentProfileId): AgentProfile {
  return settings.profiles?.[id] ?? {}
}

/**
 * 合并一位智能体的 profile（patch 里的 undefined 字段 = 清除该覆盖）。
 * 全部字段都被清掉时整条删除，不在设置文件里积空壳。
 */
export function updateAgentProfile(id: AgentProfileId, patch: Partial<AgentProfile>): void {
  const cur = loadAgentSettings()
  const next: AgentProfile = { ...cur.profiles?.[id], ...patch }
  const hasAny = Object.values(next).some((v) => v !== undefined)
  const profiles: Partial<Record<AgentProfileId, AgentProfile>> = { ...(cur.profiles ?? {}) }
  if (hasAny) profiles[id] = next
  else delete profiles[id]
  saveAgentSettings({ ...cur, profiles })
}

/** 整条恢复默认（删除这位智能体的全部覆盖） */
export function resetAgentProfile(id: AgentProfileId): void {
  const cur = loadAgentSettings()
  if (!cur.profiles?.[id]) return
  const profiles: Partial<Record<AgentProfileId, AgentProfile>> = { ...(cur.profiles ?? {}) }
  delete profiles[id]
  saveAgentSettings({ ...cur, profiles })
}

/* ---------- 运行时解析 ---------- */

/**
 * 一轮对话的模型选择解析：在全局默认之上叠加 profile 覆盖。
 * 提供商不存在 / 没配时回落全局默认；模型不属于生效提供商时回落该提供商默认模型；
 * 档位缺省沿用全局滑条（全应用唯一的档位真相，见 learn/effortGuard）。
 */
export function resolveAgentGlobal(
  settings: AiSettings,
  profile: AgentProfile,
): { provider: ResolvedProvider; model: string; effort: ReasoningEffort } {
  const g = resolveGlobal(settings, {
    providerId: profile.providerId?.trim() || undefined,
    model: profile.model?.trim() || undefined,
  })
  return { ...g, effort: profile.effort ?? g.effort }
}

/**
 * 仅聊天的沙箱基座只有 web / fetch / schedule 三组 ops（见 useAgent/freeTurn），
 * 能力面同样由架构固定。
 */
export const FREE_AGENT_GROUPS = ['web', 'fetch', 'schedule'] as const
export const FREE_AGENT_API_ITEMS = ['web', 'schedule'] as const
