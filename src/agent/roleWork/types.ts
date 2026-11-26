/**
 * role-work 对宿主与沙箱的契约类型。
 *
 * 持久化结构（WorkSession / ChannelMessage）放在 agent/types，避免 Conversation 与
 * 角色层互相 import 形成环；这里只放「调用面」与回执，供 sandbox ops / 宿主实现共用。
 */
import type { AgentProfileId, AgentVoice } from '../agentProfile'
import type { ChannelExtra, ChannelKind, MessageFile, MessageImage, WorkSession, WorkStatus } from '../types'

export type { ChannelKind, ChannelMessage, ChannelPeer, ChannelStamp, WorkExecuteTrace, WorkSession, WorkStatus, WorkBucket } from '../types'

/** role 能看到的 work 摘要（list 回执） */
export interface WorkSummary {
  name: string
  status: WorkStatus
  runs: number
  runtimeMs: number
  lastActiveAt: number
}

/** role.status 回执：只有状态与 execute 标题，不返回正文/参数 */
export interface WorkStatusResult extends WorkSummary {
  recentExecutes: Array<{ at: number; title: string }>
  lastDelivery?: string
  lastIssue?: string
}

export interface WorkCreateInput {
  name?: string
}

export interface WorkSendInput {
  name: string
  text?: string
  /** 引用 role 会话里的用户消息 id，连同附件转发 */
  messageId?: string
  /**
   * 可选：把这次运行的实时状态挂在某个通道消息上（私聊通道或群聊都算）。
   * 只是展示绑定，不影响任务内容；不传也能正常发。
   */
  bindMessageId?: string
  /** 随任务一起带过去的附件（chat.send 到 work 通道时用） */
  images?: MessageImage[]
  files?: MessageFile[]
}

export interface WorkCallResult {
  ok: boolean
  name?: string
  status?: WorkStatus
  mode?: 'started' | 'queued'
  error?: string
}

/** role 的 work 调用面 */
export interface WorkSandboxApi {
  list: () => WorkSummary[] | Promise<WorkSummary[]>
  status: (name: string) => WorkStatusResult | { error: string } | Promise<WorkStatusResult | { error: string }>
  stop: (name: string) => WorkCallResult | Promise<WorkCallResult>
  create: (input?: WorkCreateInput) => WorkCallResult | Promise<WorkCallResult>
  kill: (name: string) => WorkCallResult | Promise<WorkCallResult>
  send: (input: WorkSendInput) => WorkCallResult | Promise<WorkCallResult>
}

export interface ChatAttachmentInput {
  /** 图片地址：moji:static/...、工作区路径或 http(s) */
  image?: string
  /** 其它文件地址（工作区路径） */
  file?: string
  name?: string
  /** 已知体积 / MIME（可选；解析器会现取） */
  bytes?: number
  mime?: string
}

export interface ChatSendInput {
  channel: ChannelKind
  /** agent 通道 = role id；work 通道 = work 名；group 通道 = 被点名的 role id（可省略在群里回复用户） */
  to?: string
  /** 抄送对象：正文必须出现 `@名字 `；只同步上下文，不激活、不跑新一轮，可多位 */
  cc?: string[]
  /**
   * 唯一要激活的 mention（群聊）。只能一位，且必须在正文里 `@名字 `；
   * 用户消息的首个 @ 由宿主自动解析成它。传 `to` 时按旧兼容视作 mention。
   */
  mention?: string
  /**
   * 对外正文。交付物完成通知可用单独一行 `---` 分隔：
   * 分隔线前是一句话口语化短汇报，后面是详细改动 / 索引名 / 标识符 / 专业说明。
   * 渲染层默认只显示分隔线前的内容，用户可切换查看详细段；普通对话不要用该分隔。
   */
  text: string
  /** 引用当前 role 会话里的用户消息（转发并标注来源） */
  messageId?: string
  attachments?: ChatAttachmentInput[]
  /**
   * 正文之外的额外数据（长日志 / 原始结果 / JSON）：不占气泡正文，界面折叠展示。
   * 两个 agent 之间搬运大块材料时必须放这里，避免把聊天列表刷屏。
   */
  extra?: ChannelExtra
  /**
   * 把另一条消息上的交付账随这条消息一起转发（值为消息 id）。
   * Work 交付消息的 id 在来源元信息里；role 转发给群聊 / 私聊时用它，
   * 不要自己重抄 files / sources。
   */
  deliveryFrom?: string
  /**
   * 静默汇报：只写入目标 role 的上下文与通道流水，不启动目标 role 一轮。
   * 只允许 agent / group；适合「我正在直接对接用户，只需让经理龟知道进度」的截断点。
   */
  silent?: boolean
}

export interface ChatCallResult {
  ok: boolean
  channel?: ChannelKind
  to?: string
  /** 实际被激活的 mention（没有 mention 时不返回） */
  mention?: string
  id?: string
  error?: string
}

/** role 的通道发送面 */
export interface ChatSandboxApi {
  send: (input: ChatSendInput) => ChatCallResult | Promise<ChatCallResult>
}

export interface HostSendInput {
  text: string
  /** 引用 role 发来的任务消息 id */
  messageId?: string
  /** 长结果 / 原始数据走附加字段，不刷聊天列表 */
  extra?: ChannelExtra
}

export interface HostCallResult {
  ok: boolean
  delivered?: boolean
  error?: string
}

/** work 的唯一回传面 */
export interface HostSandboxApi {
  send: (input: HostSendInput) => HostCallResult | Promise<HostCallResult>
}

/** 通道附件解析后的形态 */
export interface ResolvedChannelAttachments {
  images?: MessageImage[]
  files?: MessageFile[]
}

/** 工作会话的创建上下文（宿主创建时注入，不写进 API） */
export interface WorkCreateContext {
  roleId: AgentProfileId
  roleConversationId: string
  goalId?: string
  systemPrompt: string
}

/** role 的通道流水视图过滤（聊天层用） */
export type ChatChannelFilter = (kind: ChannelKind) => boolean

/** role 通道地址：agent 通道需要合法 role id */
export function isAgentRoleId(value: string): value is AgentVoice {
  return ['tutor', 'dispatcher', 'examiner', 'designer', 'researcher', 'fixer'].includes(value)
}

/** 工作会话展示名：role 内唯一，默认 work-N */
export function defaultWorkName(existing: readonly WorkSession[]): string {
  for (let i = 1; i < 1000; i += 1) {
    const name = `work-${i}`
    if (!existing.some((w) => w.name === name)) return name
  }
  return `work-${Date.now()}`
}
