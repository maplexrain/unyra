/**
 * work 的宿主管理器：一段 role 对话一个实例（useAgent 按 conversationId 持有，跨轮存活）。
 *
 * - role 侧通过 WorkSandboxApi 调 list/status/stop/create/kill/send；
 * - work 侧只有 HostSandboxApi：host.send 把交付写回 role 的 Work 通道；
 * - 多个 work 可并发；一个 work 同一时刻只跑一轮，运行中 send 进跳边界注入；
 * - work 没有人格、没有 role 的上下文，systemPrompt 创建时固化。
 *
 * 会话账本住在 Conversation.works 上（随 chat.json 落盘、随 role 对话删除消失）；
 * 管理器自己只留内存态：在跑句柄、注入队列。进程被杀后 running 复位为 interrupted
 * （registry 载入归一化），注入队列随进程消失。
 */
import type { ReasoningEffort, StreamFn } from '../../ai/types'
import type { ResolvedProvider } from '../../ai/client'
import type { AgentEvent, AgentPart, ConversationMessage, MessageUsage, WorkSession, WorkStatus } from '../types'
import type { AgentProfileId } from '../agentProfile'
import { createExecuteTools } from '../sandbox/execute'
import type { HostSendInput, WorkCallResult, WorkCreateInput, WorkSendInput, WorkStatusResult, WorkSummary, WorkSandboxApi } from '../roleWork/types'
import { defaultWorkName } from '../roleWork/types'
import { apiBriefForGroups } from './groups'
import { workRuntimeApiAllow } from '../agentProfile'
import { runWorkTask, type WorkRunOutcome } from './runner'
import { loadImagesFor } from '../../learn/images'
import { loadAttachTexts } from '../../learn/agent/transfer'

const NAME_PATTERN = /^[^\s/\\:*?"<>|]{1,32}$/

export interface WorkTurnConfig {
  sandbox: Parameters<typeof createExecuteTools>[0]
  provider: ResolvedProvider
  model: string
  effort?: ReasoningEffort
  contextWindow: number
}

export interface WorkManagerDeps {
  roleId: AgentProfileId
  /** role 的显示名：写进 Work 通道的元信息，避免模型/界面只看到 role id */
  roleName?: string
  roleConversationId: string
  goalId?: string
  getWorks: () => WorkSession[]
  setWorks: (update: (prev: WorkSession[]) => WorkSession[]) => void
  /** 创建 work 时固化的系统提示词（无任何人设） */
  buildSystem: (roleId: AgentProfileId) => string
  /** role 会话里按 messageId 找一条用户消息（转发用） */
  roleMessage: (messageId: string) => ConversationMessage | null
  /** 把一条 outbound work 通道消息记到 role 的通道流水 */
  appendOutbound: (work: WorkSession, text: string, meta: { quoteMessageId?: string; auto?: boolean }) => void
  /** host.send / 自动兜底：把交付写回 role（宿主负责写通道 + 注入/起轮） */
  deliverToRole: (work: WorkSession, text: string, meta: { quoteMessageId?: string; auto?: boolean }) => void
  onEvent?: (workId: string, runId: string, e: AgentEvent) => void
  onRunEnd?: (workId: string, runId: string) => void
  stream?: StreamFn
}

export interface WorkManager {
  api: WorkSandboxApi
  setTurn(config: WorkTurnConfig): void
  abortAll(): void
  hasRunning(): boolean
}

interface RunHandle {
  runId: string
  ctrl: AbortController
  /** role 在跑动中补的指令 */
  injections: string[]
  stopRequested: boolean
  /** 本轮是否已经显式 host.send */
  delivered: boolean
  startedAt: number
}

export function createWorkManager(deps: WorkManagerDeps): WorkManager {
  const running = new Map<string, RunHandle>()
  let turn: WorkTurnConfig | null = null

  const save = (next: WorkSession): void => {
    deps.setWorks((prev) => (prev.some((w) => w.id === next.id) ? prev.map((w) => (w.id === next.id ? next : w)) : [...prev, next]))
  }

  const find = (raw: string): WorkSession | null => {
    const name = raw.trim()
    return deps.getWorks().find((w) => w.name === name || w.id === name) ?? null
  }

  const patch = (id: string, fn: (w: WorkSession) => WorkSession): void => {
    deps.setWorks((prev) => prev.map((w) => (w.id === id ? fn(w) : w)))
  }

  const appendMessage = (id: string, message: ConversationMessage): void => {
    patch(id, (w) => ({ ...w, messages: [...w.messages, message], lastActiveAt: Date.now() }))
  }

  const flushParts = (id: string, parts: AgentPart[], usage?: MessageUsage): void => {
    if (!parts.length) return
    const msg: ConversationMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      parts,
      ...(usage ? { usage } : {}),
      ts: Date.now(),
    }
    appendMessage(id, msg)
  }

  const hostApi = (workId: string): NonNullable<Parameters<typeof createExecuteTools>[0]['host']> => ({
    send: (input: HostSendInput) => {
      const work = deps.getWorks().find((w) => w.id === workId)
      if (!work) return { ok: false, error: '这个 work 已经被删除了' }
      const text = input.text.trim()
      if (!text) return { ok: false, error: 'host.send 需要 text' }
      const handle = running.get(workId)
      if (handle) handle.delivered = true
      patch(workId, (w) => ({ ...w, lastDelivery: text }))
      deps.deliverToRole(work, text, { ...(input.messageId ? { quoteMessageId: input.messageId } : {}) })
      return { ok: true, delivered: true }
    },
  })

  const workSandbox = (base: WorkTurnConfig['sandbox'], workId: string) => ({
    ...base,
    // work 不能再派 work、不能发通道、不能审批外部路径；这些组即使基座里有也被 apiAllow 挡死，
    // 这里再把注入字段清掉，避免 buildApi 装配出空壳。
    work: undefined,
    chat: undefined,
    permission: undefined,
    host: hostApi(workId),
    apiAllow: workRuntimeApiAllow(deps.roleId),
    apiBrief: apiBriefForGroups(workRuntimeApiAllow(deps.roleId)),
  })

  const startLoop = (work: WorkSession): void => {
    const cfg = turn
    if (!cfg) {
      patch(work.id, (w) => ({ ...w, status: 'error', lastIssue: '没有可用的轮次配置（模型/沙箱未就绪）' }))
      return
    }
    const handle: RunHandle = {
      runId: crypto.randomUUID(),
      ctrl: new AbortController(),
      injections: [],
      stopRequested: false,
      delivered: false,
      startedAt: Date.now(),
    }
    running.set(work.id, handle)
    patch(work.id, (w) => ({ ...w, status: 'running', runningSince: handle.startedAt, lastActiveAt: handle.startedAt }))

    void drive(cfg, work, handle)
  }

  const drive = async (cfg: WorkTurnConfig, work: WorkSession, handle: RunHandle): Promise<void> => {
    let outcome: WorkRunOutcome
    try {
      // role 转发来的图片 / 文件正文必须随 work 历史一起还原，否则 work 只看到文件名。
      const [images, files] = await Promise.all([
        loadImagesFor(work.messages),
        loadAttachTexts(work.messages),
      ])
      outcome = await runWorkTask({
        system: work.systemPrompt,
        workId: work.id,
        messages: work.messages,
        images,
        files,
        tools: createExecuteTools(workSandbox(cfg.sandbox, work.id)),
        provider: cfg.provider,
        model: cfg.model,
        ...(cfg.effort ? { effort: cfg.effort } : {}),
        contextWindow: cfg.contextWindow,
        signal: handle.ctrl.signal,
        onEvent: (e) => {
          if (e.type === 'tool-call' && e.name === 'execute') {
            const title = executeTitleOf(e.args)
            patch(work.id, (w) => ({
              ...w,
              execTrace: [...w.execTrace, { at: Date.now(), title }].slice(-30),
            }))
          }
          deps.onEvent?.(work.id, handle.runId, e)
        },
        injections: {
          pull: () => handle.injections.shift() ?? null,
          flush: (ps) => flushParts(work.id, ps),
          // 任务消息在 send 时已经落进 work.messages（排队与起轮都走那一份），
          // 这里不能再 append：否则同一句注入会被存两遍。
          append: () => {},
        },
        ...(deps.stream ? { stream: deps.stream } : {}),
      })
    } catch (err) {
      outcome = {
        status: 'error',
        delivery: null,
        parts: [{ type: 'notice', level: 'warn', text: err instanceof Error ? err.message : 'work 执行失败' }],
        usage: null,
        error: err instanceof Error ? err.message : 'work 执行失败',
      }
    }
    finishRun(work, handle, outcome)
  }

  const finishRun = (work: WorkSession, handle: RunHandle, outcome: WorkRunOutcome): void => {
    running.delete(work.id)
    const exists = deps.getWorks().some((w) => w.id === work.id)
    if (!exists) {
      deps.onRunEnd?.(work.id, handle.runId)
      return
    }
    const issue =
      outcome.error ??
      (handle.stopRequested
        ? '被 role 强制停止'
        : outcome.status === 'interrupted'
          ? '任务被中止，没有交付'
          : outcome.status === 'incomplete'
            ? '输出提前结束，交付可能不完整'
            : undefined)
    const status: WorkStatus = handle.stopRequested
      ? 'stopped'
      : outcome.status === 'complete' || outcome.status === 'incomplete'
        ? 'idle'
        : outcome.status
    patch(work.id, (w) => ({
      ...w,
      status,
      runs: w.runs + (outcome.status === 'complete' || outcome.status === 'incomplete' ? 1 : 0),
      runningSince: undefined,
      runtimeMs: w.runtimeMs + Math.max(0, Date.now() - handle.startedAt),
      ...(outcome.delivery && !handle.delivered ? { lastDelivery: outcome.delivery } : {}),
      ...(issue ? { lastIssue: issue } : {}),
    }))
    if (outcome.parts.length) flushParts(work.id, outcome.parts, outcome.usage ?? undefined)
    deps.onRunEnd?.(work.id, handle.runId)
    handle.injections.length = 0

    // host.send 是主路径；漏了就把最后一段正文自动回传（标记 auto），role 仍能收口。
    if (!handle.delivered && outcome.delivery && outcome.status !== 'interrupted' && outcome.status !== 'error') {
      const latest = deps.getWorks().find((w) => w.id === work.id) ?? work
      deps.deliverToRole(latest, outcome.delivery, { auto: true })
    }
  }

  const api = {
    list: (): WorkSummary[] =>
      deps.getWorks().map((w) => ({
        name: w.name,
        status: w.status,
        runs: w.runs,
        runtimeMs: w.runtimeMs + (w.runningSince ? Math.max(0, Date.now() - w.runningSince) : 0),
        lastActiveAt: w.lastActiveAt,
      })),

    status: (name: string): WorkStatusResult | { error: string } => {
      const w = find(name)
      if (!w) return { error: '没有叫「' + name + '」的 work；先 work.list() 看有哪些。' }
      return {
        name: w.name,
        status: w.status,
        runs: w.runs,
        runtimeMs: w.runtimeMs + (w.runningSince ? Math.max(0, Date.now() - w.runningSince) : 0),
        lastActiveAt: w.lastActiveAt,
        recentExecutes: w.execTrace.slice(-20),
        ...(w.lastDelivery ? { lastDelivery: w.lastDelivery } : {}),
        ...(w.lastIssue ? { lastIssue: w.lastIssue } : {}),
      }
    },

    stop: (name: string): WorkCallResult => {
      const w = find(name)
      if (!w) return { ok: false, error: '没有叫「' + name + '」的 work' }
      const handle = running.get(w.id)
      if (!handle) return { ok: false, error: '「' + w.name + '」当前没有在跑' }
      handle.stopRequested = true
      handle.ctrl.abort()
      return { ok: true, name: w.name, status: 'stopped' }
    },

    create: (input?: WorkCreateInput): WorkCallResult => {
      const raw = input?.name?.trim()
      if (raw && !NAME_PATTERN.test(raw)) {
        return { ok: false, error: 'work 名不合法：1–32 字，不能含 / \\ : * ? " < > |' }
      }
      const name = raw || defaultWorkName(deps.getWorks())
      if (deps.getWorks().some((w) => w.name === name)) {
        return { ok: false, error: '已经有一个叫「' + name + '」的 work；换一个名字。' }
      }
      const now = Date.now()
      const work: WorkSession = {
        id: crypto.randomUUID(),
        name,
        roleId: deps.roleId,
        roleConversationId: deps.roleConversationId,
        status: 'idle',
        runs: 0,
        createdAt: now,
        lastActiveAt: now,
        runtimeMs: 0,
        systemPrompt: deps.buildSystem(deps.roleId),
        messages: [],
        execTrace: [],
      }
      save(work)
      return { ok: true, name }
    },

    kill: (name: string): WorkCallResult => {
      const w = find(name)
      if (!w) return { ok: false, error: '没有叫「' + name + '」的 work' }
      const handle = running.get(w.id)
      if (handle) {
        handle.stopRequested = true
        handle.ctrl.abort()
      }
      deps.setWorks((prev) => prev.filter((x) => x.id !== w.id))
      running.delete(w.id)
      return { ok: true, name: w.name, status: 'stopped' }
    },

    send: (input: WorkSendInput): WorkCallResult => {
      const w = find(input.name)
      if (!w) return { ok: false, error: '没有叫「' + input.name + '」的 work；先 work.list()。' }
      const text = (input.text ?? '').trim()
      const messageId = (input.messageId ?? '').trim()
      if (!text && !messageId) return { ok: false, error: 'work.send 需要 text 或 messageId' }
      let quoted: ConversationMessage | null = null
      if (messageId) {
        quoted = deps.roleMessage(messageId)
        if (!quoted) return { ok: false, error: '当前 role 会话里找不到消息「' + messageId + '」' }
      }
      const quoteNote = quoted
        ? '【引用 role 会话消息 ' + quoted.id + ' · ' + stampOf(quoted.ts) + '】\n' + plainText(quoted)
        : ''
      const body = [text, quoteNote].filter(Boolean).join('\n\n')
      const task: ConversationMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: body }],
        ts: Date.now(),
        channel: {
          channel: 'work',
          from: { kind: 'role', id: deps.roleId, name: deps.roleName?.trim() || deps.roleId },
          to: { kind: 'work', id: w.id, name: w.name },
          ts: Date.now(),
          envelopeId: crypto.randomUUID(),
        },
        ...(quoted?.images ? { images: quoted.images } : {}),
        ...(quoted?.files ? { files: quoted.files } : {}),
        ...(input.images?.length ? { images: input.images } : {}),
        ...(input.files?.length ? { files: input.files } : {}),
      }
      appendMessage(w.id, task)
      deps.appendOutbound(w, body, { ...(quoted ? { quoteMessageId: quoted.id } : {}) })
      const handle = running.get(w.id)
      if (handle) {
        handle.injections.push(body)
        return { ok: true, name: w.name, mode: 'queued' }
      }
      startLoop({ ...w, messages: [...w.messages, task] })
      return { ok: true, name: w.name, mode: 'started' }
    },
  }

  return {
    api,
    setTurn: (config) => {
      turn = config
    },
    abortAll: () => {
      for (const h of running.values()) h.ctrl.abort()
    },
    hasRunning: () => running.size > 0,
  }
}

function executeTitleOf(args: string): string {
  try {
    const parsed = JSON.parse(args) as { description?: unknown }
    const title = typeof parsed.description === 'string' ? parsed.description.trim() : ''
    return title || 'execute'
  } catch {
    return 'execute'
  }
}

function plainText(m: ConversationMessage): string {
  return m.parts
    .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('')
    .trim()
}

function stampOf(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}
