/**
 * 子代理会话的簿记（纯函数，可在 Node 探针里跑）。
 *
 * 会话的消息就是普通的 ConversationMessage[]：导师的任务是一条 user 消息、每次任务
 * 是一条 assistant 回复。界面渲染与 toChatHistory 共用这一份，所以簿记只做「追加」，
 * 绝不改写已有的消息——前缀缓存能命中的唯一判据就是它只增不改。
 *
 * 会话住在 Conversation.subagents 上、随 chat.json 落盘（生命周期 = 导师对话）：
 * 簿记产出的都是新对象，由调用方（useAgent 的 setBucket）写回对话并持久化。
 */
import type { AgentPart, ConversationMessage, MessageUsage, SubAgentBucket, SubAgentDef, SubAgentSession, SubAgentStatus } from '../types'

/** 读一个对话的桶；没有就给空桶（调用方不该改这个共享常量） */
export const EMPTY_SUB_BUCKET: SubAgentBucket = { defs: [], sessions: [] }

/**
 * 载入时的防御归一化（parse.ts 调用）：磁盘上的东西可能被手改过、也可能是旧版本写的。
 * 形状不对整桶丢弃（宁可不显示，也不让坏数据炸掉渲染）；**残留的「运行中」复位为
 * 「被中断」**——进程被杀时正在跑的那场任务已经没了，留着 running 状态点会永远脉冲。
 */
export function normalizeSubBucket(raw: unknown): SubAgentBucket | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const v = raw as { defs?: unknown; sessions?: unknown }
  const defs = Array.isArray(v.defs)
    ? v.defs.filter(
        (d): d is SubAgentDef =>
          !!d && typeof d === 'object' && typeof (d as SubAgentDef).key === 'string' &&
          typeof (d as SubAgentDef).system === 'string' && Array.isArray((d as SubAgentDef).apiGroups),
      )
    : []
  const sessions = Array.isArray(v.sessions)
    ? v.sessions
        .filter(
          (s): s is SubAgentSession =>
            !!s && typeof s === 'object' && typeof (s as SubAgentSession).id === 'string' &&
            typeof (s as SubAgentSession).defKey === 'string' && Array.isArray((s as SubAgentSession).messages),
        )
        .map((s) => ({ ...s, status: (s.status === 'running' ? 'interrupted' : s.status) as SubAgentStatus }))
    : []
  if (!defs.length && !sessions.length) return undefined
  return { defs, sessions }
}

export function createSession(def: SubAgentDef): SubAgentSession {
  return {
    id: crypto.randomUUID(),
    defKey: def.key,
    status: 'idle',
    runs: 0,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    messages: [],
  }
}

/** 按 defKey 找活着的会话（复用的凭据就是它） */
export function sessionOf(bucket: SubAgentBucket, defKey: string): SubAgentSession | undefined {
  return bucket.sessions.find((s) => s.defKey === defKey)
}

/**
 * 追加一条任务消息（导师派下来的活）。界面上它就是一条用户气泡——
 * 子会话视图里看得到导师要它干什么。
 */
export function withTaskMessage(session: SubAgentSession, task: string): { session: SubAgentSession; message: ConversationMessage } {
  const message: ConversationMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text: task }],
    ts: Date.now(),
  }
  return {
    session: { ...session, messages: [...session.messages, message], lastActiveAt: Date.now() },
    message,
  }
}

export interface SubRunRecord {
  /** 这次任务的 runId（同一条 assistant 消息的身份；流式渲染也按它剔重） */
  runId: string
  taskMessageId: string
  parts: AgentPart[]
  usage: MessageUsage | null
  status: SubAgentSession['status']
  delivery: string | null
  issue?: string
}

/** 任务跑完，把回复消息与结果状态落进会话（就地换新对象，不改旧的） */
export function withRunResult(session: SubAgentSession, record: SubRunRecord): SubAgentSession {
  const message: ConversationMessage = {
    id: record.runId,
    role: 'assistant',
    parts: record.parts,
    ...(record.usage ? { usage: record.usage } : {}),
    ts: Date.now(),
  }
  return {
    ...session,
    messages: [...session.messages, message],
    status: record.status === 'running' ? 'idle' : record.status,
    runs: session.runs + 1,
    lastActiveAt: Date.now(),
    ...(record.delivery ? { lastDelivery: record.delivery.slice(0, 120) } : {}),
    ...(record.issue ? { lastIssue: record.issue } : {}),
  }
}

/** 标记正在跑（面板的状态点与入口按钮的脉冲靠它） */
export function withRunning(session: SubAgentSession, running: boolean): SubAgentSession {
  return { ...session, status: running ? 'running' : 'idle', lastActiveAt: Date.now() }
}

/** fresh 重开：清空上下文从头来。前缀门禁的账由调用方一并 reset（键见 tools.ts） */
export function withFreshContext(session: SubAgentSession): SubAgentSession {
  return { ...session, messages: [], status: 'idle', lastIssue: undefined, lastActiveAt: Date.now() }
}
