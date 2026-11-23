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
 * 智能体声部 id（agent team 左栏的六位执行声部，与 components 的 AgentTeamMode 同形）：
 * - tutor       导师：主讲与协调（教学对话、大纲、画像、日程），教学主线执行声部；
 * - dispatcher  调度员：接收用户需求、按路由表把任务委托给对应声部、交付结果——
 *               **节点宇宙与其他地方发起的工作流统一经过它路由**；
 * - examiner    出卷师：试卷命题、判分与错题讲解；
 * - designer    设计师：互动课堂课件与超级实验室；
 * - researcher  调研员：联网调研与内置浏览器实操（为其他声部提供网络消息的调研）；
 * - fixer       维修员：修复问题（目前仅解析失败的函数图像语法，用户主动触发）；
 * - free        仅聊天：不挂目标的纯对话（固定页签，无 execute 工具面）。
 */
export type AgentProfileId = 'free' | 'tutor' | 'dispatcher' | 'examiner' | 'designer' | 'researcher' | 'fixer'

/** 挂在目标上的执行声部（free 不挂目标，是固定页签） */
export type AgentVoice = Exclude<AgentProfileId, 'free'>

/** 全部执行声部（tutor 在前：老数据没有 voice 字段时兜到它；调度员随后——它是任务入口） */
export const AGENT_VOICES: readonly AgentVoice[] = ['tutor', 'dispatcher', 'examiner', 'designer', 'researcher', 'fixer']

/** team.* 的完整名单（free 也算：它可以承接纯对话性质的委托） */
export const AGENT_TEAM_IDS: readonly AgentProfileId[] = [
  'free', 'tutor', 'dispatcher', 'examiner', 'designer', 'researcher', 'fixer',
]

/**
 * **可交流**标签：学习者可以选中直接发消息启动的声部。不在这个集合里的声部
 * （调研员 / 维修员）只能由**工作流触发**或**被其他声部委托**来启动——界面据此
 * 禁用输入区、选中时也不现场建会话。调度员可交流：用户直接把需求说给它听。
 */
export const COMMUNICABLE_VOICES: ReadonlySet<AgentVoice> = new Set(['tutor', 'dispatcher', 'examiner', 'designer'])

/**
 * **内容生成**标签：注入**写作策略**（文档格式策略，见 agent/docFormat）与**学习者
 * 画像**（见 agent/userInfo）的声部——产出面向学习者的内容才需要贴合这个人；
 * 调研 / 修复类声部拿到画像只是噪声。
 */
export const CONTENT_VOICES: ReadonlySet<AgentVoice> = new Set(['tutor', 'examiner', 'designer'])

/** 可交流口径（free 恒可聊）；含 legacy 声部时先映射到现役 */
export function isCommunicable(id: AgentProfileId): boolean {
  return id === 'free' || COMMUNICABLE_VOICES.has(id as AgentVoice)
}

/**
 * 已退役声部的**legacy 别名**：老数据里还有它们的痕迹（确定性会话 id 的声部段、
 * 固化提示词的角色行），载入时映射到承接了其职责的现役声部——判卷官并入了出卷师。
 */
export const LEGACY_VOICE_ALIAS: Readonly<Record<string, AgentVoice>> = { grader: 'examiner' }

/** 一位智能体的独立设置。缺省字段 = 跟随默认 / 全局，见模块顶部说明 */
export interface AgentProfile {
  /** 显示名覆盖；空 / 缺省 = 默认名（聊天龟 / 导师龟 / 出卷龟 …） */
  name?: string
  /** 头像 id（AGENT_AVATARS 目录）；缺省 = 默认头像（各自的那只龟龟） */
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

/**
 * 头像目录：id → 展示名。可视映射在 components 一侧（agentAvatars.tsx：龟龟图片 +
 * lucide 图标），这里只存纯数据。龟龟是默认形象（每位声部一只），图标款是设置里的备选。
 */
export const AGENT_AVATARS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'turtle-chat', label: '聊天龟' },
  { id: 'turtle-tutor', label: '导师龟' },
  { id: 'turtle-dispatcher', label: '调度龟' },
  { id: 'turtle-examiner', label: '出卷龟' },
  { id: 'turtle-designer', label: '设计龟' },
  { id: 'turtle-researcher', label: '调研龟' },
  { id: 'turtle-fixer', label: '维修龟' },
  { id: 'chat', label: '对话气泡' },
  { id: 'grad', label: '导师帽' },
  { id: 'bot', label: '机器人' },
  { id: 'book', label: '书本' },
  { id: 'flask', label: '实验瓶' },
  { id: 'compass', label: '指南针' },
  { id: 'spark', label: '灵感' },
  { id: 'brain', label: '思维' },
  { id: 'wrench', label: '扳手' },
  { id: 'palette', label: '调色盘' },
  { id: 'route', label: '路线' },
]

/** 默认显示名（龟龟一家：归一的 xx 龟，提示词里的身份口径与此一致；排行与龟号见 learn/ai/turtleClan 的龟门总纲） */
export const DEFAULT_AGENT_NAME: Record<AgentProfileId, string> = {
  free: '聊天龟',
  tutor: '导师龟',
  dispatcher: '调度龟',
  examiner: '出卷龟',
  designer: '设计龟',
  researcher: '调研龟',
  fixer: '维修龟',
}
export const DEFAULT_AGENT_AVATAR: Record<AgentProfileId, string> = {
  free: 'turtle-chat',
  tutor: 'turtle-tutor',
  dispatcher: 'turtle-dispatcher',
  examiner: 'turtle-examiner',
  designer: 'turtle-designer',
  researcher: 'turtle-researcher',
  fixer: 'turtle-fixer',
}

/* ---------- 团队分工：api 能力面 ---------- */

/**
 * 一位声部的 execute 能力面。**由架构固定、不可增删**（设置里纯只读展示）——
 * 「谁会什么」是团队分工，不是用户偏好；分配原则：
 * - core 顶层原语（wait / ask / tiktok / compact / fetch / see）按需给：ask / see 给
 *   要与人交互、要看图面的声部；fetch 只给有 web 组的声部；
 * - 域专属组只给对应的声部（exam → 出卷师、classroom → 设计师、browser → 调研员、
 *   subagent / mcp / permission → 只有导师）——职责拆分就是能力面拆分；
 * - 交付登记（delivery）与临时变量（tmp）按声部给；团队协作（team）全体执行声部都有
 *   （被委托方收口交付的唯一通道）；调度员轻装（team/tmp/node）——它的活全靠委托。
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
      'node', 'memory', 'schedule', 'tmp', 'workspace', 'userInfo', 'method', 'wf',
      'chip', 'delivery', 'mcp', 'ui', 'subagent', 'permission',
      'files', 'process', 'skill', 'video', 'project', 'team', 'design',
    ],
    // 联网调研已分给调研员：导师没有 web / browser / fetch，只有看图的 see
    topLevel: [...CORE_TOP_LEVEL_ALL, 'see'] as const,
  },
  dispatcher: {
    // 调度员轻装上阵：路由与跟踪全走 team，node 用来现查目标结构好把指令写准
    groups: ['team', 'tmp', 'node'],
    // 接需求要 ask 澄清；交付完成要响铃提醒
    topLevel: CORE_TOP_LEVEL_ALL,
  },
  examiner: {
    groups: [
      'node', 'exam', 'tmp', 'workspace', 'userInfo', 'wf', 'chip',
      'delivery', 'web', 'ui', 'files', 'project', 'team', 'design',
    ],
    topLevel: CORE_TOP_LEVEL_WEB,
  },
  designer: {
    // team 是被委托后的交付通道（complete）——所有承接声部都必须有
    groups: ['node', 'tmp', 'method', 'delivery', 'classroom', 'team', 'design'],
    // 课堂与实验都不联网：问需求要 ask（超级实验室的第一步），没有 fetch / see
    topLevel: CORE_TOP_LEVEL_ALL,
  },
  researcher: {
    groups: ['tmp', 'workspace', 'delivery', 'web', 'browser', 'team'],
    topLevel: CORE_TOP_LEVEL_WEB,
  },
  fixer: {
    groups: ['node', 'tmp', 'team'],
    topLevel: ['wait', 'compact'],
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
 * 每位声部固定可触发的**内置**工作流（设置里只读、不可增删）。口径（用户定稿：工作流
 * 统一经调度员路由）：这是各声部的**规程面**——承接调度员委托进来的活照规程干，不再
 * 是触发入口（触发口一律 voiceForWorkflow → 调度员）：
 * - 导师：教学主线（开讲 / 大纲 / 导读 / 划词注解）；
 * - 出卷师：出卷与阅卷；设计师：课件与实验；调研员：浏览器操作；维修员：修图；
 * - 调度员没有执行面（它的活全靠委托），只有 compact。
 * compact 全员都有：自动压缩不分声部，长会话都要能交接。
 */
export const AGENT_WORKFLOW_PLANES: Record<AgentVoice, readonly string[]> = {
  tutor: ['teach-node', 'outline', 'outline-guide', 'explain', 'compact'],
  dispatcher: ['compact'],
  examiner: ['exam', 'exam-grade', 'compact'],
  designer: ['classroom', 'superlab', 'compact'],
  researcher: ['browser-use', 'compact'],
  fixer: ['plot-fix', 'compact'],
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
 * 工作流入口的**统一路由**（用户定稿：节点宇宙与其他地方发起的工作流统一经过调度员）：
 * 工作流轮一律起在**调度员**的会话上，调度员按自己提示词里的路由表把活委托给对应声部，
 * 等交付后向用户汇报。AGENT_WORKFLOW_PLANES 因此只是各声部的规程面（承接委托时照着干），
 * 不再是触发入口。compact 例外：压缩是当前会话的维护操作，走 runWorkflow 的无 voice 路径，
 * 不经调度员（把调度员的上下文压了没有意义）。
 */
export function voiceForWorkflow(_id: string): AgentVoice {
  return 'dispatcher'
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
