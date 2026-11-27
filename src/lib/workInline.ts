/**
 * 聊天正文里的 work 引用：`[标题](work: work-id)`。
 *
 * 只在**独占一行**时生效，避免普通正文里的 Markdown 链接被误判成状态块；
 * 代码围栏里的同形文本也不解析。`work-id` 既可以是 work 的 name（role 最常拿到的
 * 标识），也可以是内部 id；同名时优先有实时输出、最近活跃的那个。
 */
import type { AgentPart, Conversation, WorkSession } from '../agent/types'
import { lastLineOf } from './lastLine'

export type WorkInlineSegment =
  | { type: 'text'; text: string }
  | { type: 'work'; title: string; workRef: string }

export interface WorkInlineRun {
  workId: string
  runId: string
  /** 实时轮次的开始时刻，同名 work 有多个实时轮时取最新 */
  ts: number
  /** 实时轮次所属会话；群聊汇总时用来按目标过滤 */
  conversationId?: string
  parts: AgentPart[]
}

export interface WorkInlineSource {
  sessions: WorkSession[]
  live: WorkInlineRun[]
}

/** 从某个目标（或几段会话）的 work 账本与实时轮次里拼出正文引用要用的数据源。 */
export function workInlineSourceOf(
  conversations: Conversation[],
  live: WorkInlineRun[],
  goalId?: string | null,
): WorkInlineSource {
  const scoped = goalId ? conversations.filter((c) => c.goalId === goalId) : conversations
  const ids = new Set(scoped.map((c) => c.id))
  return {
    sessions: scoped.flatMap((c) => c.works?.sessions ?? []),
    live: live
      .filter((run) => !run.conversationId || ids.has(run.conversationId))
      .map(({ workId, runId, ts, parts }) => ({ workId, runId, ts, parts })),
  }
}

export type WorkInlineActivity =
  | { kind: 'thinking'; key: string; text: string }
  | { kind: 'text'; key: string; text: string }
  | { kind: 'tool'; key: string; text: string; name: string; args: string }
  | { kind: 'idle'; key: string; text: string; error?: boolean }

const WORK_LINE =
  /^[ \t]*\[([^\]\n]+)\]\(work:\s*([^)\n]+?)\s*\)[ \t]*$/

/** 把正文切成普通文本与 work 引用块（保留普通文本的换行结构）。 */
export function splitWorkRefs(text: string): WorkInlineSegment[] {
  if (!text) return []
  const out: WorkInlineSegment[] = []
  const lines = text.split(/\r?\n/)
  let buffer: string[] = []
  let inFence = false

  const flush = () => {
    if (!buffer.length) return
    const joined = buffer.join('\n')
    if (joined.trim()) out.push({ type: 'text', text: joined })
    buffer = []
  }

  for (const line of lines) {
    // 围栏本身照样留在文本里；只有围栏内部不解析 work 链接。
    if (/^[ \t]*(```|~~~)/.test(line)) {
      inFence = !inFence
      buffer.push(line)
      continue
    }
    if (inFence) {
      buffer.push(line)
      continue
    }
    const hit = WORK_LINE.exec(line)
    if (!hit) {
      buffer.push(line)
      continue
    }
    const title = hit[1].trim()
    const workRef = hit[2].trim()
    if (!title || !workRef) {
      buffer.push(line)
      continue
    }
    flush()
    out.push({ type: 'work', title, workRef })
  }
  flush()
  return out
}

/** 按 name / id 找到 work 会话；同名时优先正在跑的，再取最近活跃的。 */
export function resolveWorkInline(
  source: WorkInlineSource | undefined,
  workRef: string,
): { session: WorkSession; live?: WorkInlineRun } | null {
  if (!source) return null
  const ref = workRef.trim()
  if (!ref) return null
  const candidates = source.sessions.filter((w) => w.name === ref || w.id === ref)
  if (!candidates.length) return null

  const liveOf = (w: WorkSession) =>
    source.live
      .filter((run) => run.workId === w.id)
      .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))[0]

  const session = candidates
    .slice()
    .sort((a, b) => {
      const liveA = liveOf(a)
      const liveB = liveOf(b)
      if (Boolean(liveA) !== Boolean(liveB)) return liveA ? -1 : 1
      return b.lastActiveAt - a.lastActiveAt
    })[0]

  return { session, ...(liveOf(session) ? { live: liveOf(session) } : {}) }
}

function parseToolTitle(name: string, args: string): string {
  try {
    const parsed = JSON.parse(args) as { description?: unknown }
    const description = typeof parsed.description === 'string' ? parsed.description.trim() : ''
    return description || name || 'execute'
  } catch {
    return name || 'execute'
  }
}

function cleanInline(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 预览只看当前内容的最后一行；单行内部的空白保留，避免把代码/公式压扁。 */
function tailInline(text: string): string {
  return lastLineOf(text).trim()
}

/** 同一个 work 在列表里的去重键：能解析到会话就用会话 id，解析不到才退回原始引用。 */
export function workInlineKey(source: WorkInlineSource | undefined, workRef: string): string {
  const resolved = resolveWorkInline(source, workRef)
  return resolved ? `work:${resolved.session.id}` : `ref:${workRef.trim()}`
}

/**
 * 同一条列表里，一个 work 只让**最新一条**消息显示内嵌状态。
 *
 * 返回「去重键 → 应显示它的消息 id」。调用方把这份表交给 BubbleBody：只有表里
 * 指向的那条消息才渲染 WorkInline，旧消息里的同名引用直接跳过。这样连续多轮
 * 汇报不会堆出一排一模一样的运行卡片。
 */
export function latestWorkAnchors(
  messages: Array<{ id: string; text: string }>,
  source?: WorkInlineSource,
): Map<string, string> {
  const anchors = new Map<string, string>()
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    for (const segment of splitWorkRefs(m.text)) {
      if (segment.type !== 'work') continue
      const key = workInlineKey(source, segment.workRef)
      if (!anchors.has(key)) anchors.set(key, m.id)
    }
  }
  return anchors
}

type PickedPart = {
  part: Extract<AgentPart, { type: 'thinking' | 'text' | 'tool' }>
  key: string
}

function latestVisiblePart(parts: AgentPart[], prefix: string): PickedPart | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (part.type === 'thinking' || part.type === 'text') {
      return { part, key: `${prefix}:${i}` }
    }
    if (part.type === 'tool') {
      return { part, key: `${prefix}:${part.id}` }
    }
    // hop / prompt-module / channel-message / notice 不是「当前在做什么」；
    // 继续往前找，避免状态行被内部边界刷成空白。
  }
  return null
}

function activityOfPart(picked: PickedPart): WorkInlineActivity {
  if (picked.part.type === 'thinking') {
    return {
      kind: 'thinking',
      key: picked.key,
      text: tailInline(picked.part.text) || '思考中…',
    }
  }
  if (picked.part.type === 'text') {
    return {
      kind: 'text',
      key: picked.key,
      text: tailInline(picked.part.text) || '等待输出…',
    }
  }
  return {
    kind: 'tool',
    key: picked.key,
    text: parseToolTitle(picked.part.name, picked.part.args),
    name: picked.part.name,
    args: picked.part.args,
  }
}

function lastStoredActivity(session: WorkSession): WorkInlineActivity | null {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i]
    if (message.role !== 'assistant') continue
    const picked = latestVisiblePart(message.parts, message.id)
    if (picked) return activityOfPart(picked)
  }
  return null
}

/**
 * 状态组件第二行的内容来源：实时流优先；空闲时退回该 work 最后一条 assistant
 * 回复里最后一个可见片段。只取一个片段，不拼接历史（下一步会覆盖上一步）。
 */
export function workActivityOf(session: WorkSession, live?: WorkInlineRun): WorkInlineActivity {
  if (live?.parts.length) {
    const picked = latestVisiblePart(live.parts, live.runId ?? `live:${live.workId}`)
    if (picked) return activityOfPart(picked)
  }
  if (session.status === 'running') {
    return { kind: 'idle', key: `running:${session.id}`, text: '正在准备…' }
  }
  const stored = lastStoredActivity(session)
  if (stored) return stored
  const issue = session.lastIssue?.trim()
  if (issue) {
    return {
      kind: 'idle',
      key: `issue:${session.id}`,
      text: cleanInline(issue),
      ...(session.status === 'error' ? { error: true } : {}),
    }
  }
  return {
    kind: 'idle',
    key: `idle:${session.id}`,
    text: session.runs > 0 ? '本轮已完成' : '等待任务',
  }
}
