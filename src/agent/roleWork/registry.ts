/**
 * role-work 的载入归一化与旧数据迁移。
 *
 * - channels：只留最近 200 条，字段不合法整条丢弃；
 * - works：校验 name/id/status/messages；running 重启后复位为 interrupted；
 * - 旧 Conversation.subagents.sessions → works（名称取 def.name，system 取 def.system，
 *   消息/状态/轮次保留），旧的委托会话（dv:）在会话层过滤，不进 works。
 */
import type { AgentProfileId } from '../agentProfile'
import type { ChannelMessage, Conversation, ConversationMessage, WorkSession, WorkStatus } from '../types'

/** 旧 subagent 数据（只在迁移时读，旧结构已从类型面移除） */
interface LegacySubSession {
  id: string
  defKey: string
  status?: WorkStatus
  runs?: number
  createdAt?: number
  lastActiveAt?: number
  messages?: ConversationMessage[]
  lastDelivery?: string
  lastIssue?: string
}
interface LegacySubBucket {
  sessions?: LegacySubSession[]
  defs?: Array<{ key: string; name?: string; system?: string }>
}

const STATUSES: readonly WorkStatus[] = ['idle', 'running', 'interrupted', 'stopped', 'error']
const CHANNEL_CAP = 200
const NAME_PATTERN = /^[^\s/\\:*?"<>|]{1,32}$/

export function normalizeChannels(raw: unknown): ChannelMessage[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: ChannelMessage[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const m = item as Partial<ChannelMessage>
    if (typeof m.id !== 'string' || !m.id) continue
    if (m.kind !== 'user' && m.kind !== 'agent' && m.kind !== 'work') continue
    if (m.direction !== 'in' && m.direction !== 'out') continue
    if (!m.from || !m.to || typeof m.text !== 'string') continue
    out.push({
      id: m.id,
      kind: m.kind,
      direction: m.direction,
      from: m.from,
      to: m.to,
      text: m.text,
      ts: typeof m.ts === 'number' ? m.ts : Date.now(),
      ...(m.attachments ? { attachments: m.attachments } : {}),
      ...(m.quoteMessageId ? { quoteMessageId: m.quoteMessageId } : {}),
      ...(m.auto ? { auto: true } : {}),
    })
  }
  const kept = out.slice(-CHANNEL_CAP)
  return kept.length ? kept : undefined
}

function normalizeMessage(raw: unknown): ConversationMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Partial<ConversationMessage>
  if (typeof m.id !== 'string' || !m.id) return null
  if (m.role !== 'user' && m.role !== 'assistant') return null
  if (!Array.isArray(m.parts)) return null
  return { ...m, id: m.id, role: m.role, parts: m.parts, ts: typeof m.ts === 'number' ? m.ts : Date.now() } as ConversationMessage
}

export function normalizeWork(raw: unknown, roleId: AgentProfileId, conversationId: string): WorkSession | null {
  if (!raw || typeof raw !== 'object') return null
  const w = raw as Partial<WorkSession>
  if (typeof w.id !== 'string' || !w.id) return null
  const name = typeof w.name === 'string' && NAME_PATTERN.test(w.name.trim()) ? w.name.trim() : ''
  if (!name) return null
  const messages = Array.isArray(w.messages) ? w.messages.map(normalizeMessage).filter((m): m is ConversationMessage => !!m) : []
  const status = STATUSES.includes(w.status as WorkStatus) ? (w.status as WorkStatus) : 'idle'
  return {
    id: w.id,
    name,
    roleId,
    roleConversationId: conversationId,
    status: status === 'running' ? 'interrupted' : status,
    runs: typeof w.runs === 'number' ? w.runs : 0,
    createdAt: typeof w.createdAt === 'number' ? w.createdAt : Date.now(),
    lastActiveAt: typeof w.lastActiveAt === 'number' ? w.lastActiveAt : Date.now(),
    runtimeMs: typeof w.runtimeMs === 'number' ? w.runtimeMs : 0,
    systemPrompt: typeof w.systemPrompt === 'string' ? w.systemPrompt : '',
    messages,
    ...(w.lastDelivery ? { lastDelivery: w.lastDelivery } : {}),
    ...(w.lastIssue ? { lastIssue: w.lastIssue } : {}),
    execTrace: Array.isArray(w.execTrace)
      ? w.execTrace.filter((t) => t && typeof t.title === 'string' && typeof t.at === 'number').slice(-30)
      : [],
  }
}

export function normalizeWorks(raw: unknown, roleId: AgentProfileId, conversationId: string): WorkSession[] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const sessions = (raw as { sessions?: unknown }).sessions
  if (!Array.isArray(sessions)) return undefined
  const out: WorkSession[] = []
  for (const w of sessions) {
    const normalized = normalizeWork(w, roleId, conversationId)
    if (!normalized) continue
    // 名字在一个 role 内唯一：盘上被改坏出现重名时，后来的那条丢掉（先出现的继续可用）
    if (out.some((x) => x.name === normalized.name)) continue
    out.push(normalized)
  }
  return out.length ? out : undefined
}

/**
 * 旧 subagent 会话 → work。只迁会话，不迁 defs；旧定义里的 system 直接成为 work 的固化了提示词，
 * 名称优先用 def.name，找不到就用旧 key。迁移后 `subagents` 字段由调用方删除。
 */
export function migrateLegacySubagents(
  bucket: LegacySubBucket | undefined,
  roleId: AgentProfileId,
  conversationId: string,
): WorkSession[] | undefined {
  if (!bucket?.sessions?.length) return undefined
  const defs = new Map(bucket.defs?.map((d) => [d.key, d]) ?? [])
  const out: WorkSession[] = []
  for (const s of bucket.sessions) {
    if (!s.defKey) continue
    const def = defs.get(s.defKey)
    const name = (def?.name || s.defKey || 'work').trim().slice(0, 32)
    if (!name || out.some((w) => w.name === name)) continue
    out.push({
      id: s.id,
      name,
      roleId,
      roleConversationId: conversationId,
      status: s.status === 'running' ? 'interrupted' : s.status ?? 'idle',
      runs: s.runs ?? 0,
      createdAt: s.createdAt ?? Date.now(),
      lastActiveAt: s.lastActiveAt ?? Date.now(),
      runtimeMs: 0,
      systemPrompt: def?.system || '',
      messages: (s.messages ?? []) as ConversationMessage[],
      ...(s.lastDelivery ? { lastDelivery: s.lastDelivery } : {}),
      ...(s.lastIssue ? { lastIssue: s.lastIssue } : {}),
      execTrace: [],
    })
  }
  return out.length ? out : undefined
}

/** 会话层迁移：works 优先；没有就用旧 subagents 迁一份 */
export function withRoleWorks(conv: Conversation): Conversation {
  if (conv.works) return conv
  const works = migrateLegacySubagents((conv as Conversation & { subagents?: LegacySubBucket }).subagents, (conv.voice ?? 'tutor') as AgentProfileId, conv.id)
  return works ? { ...conv, works: { sessions: works } } : conv
}
