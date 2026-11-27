/**
 * work 的宿主管理器：一段 role 对话一个实例（useAgent 按 conversationId 持有，跨轮存活）。
 *
 * - role 侧通过 WorkSandboxApi 调 list/status/stop/create/kill/send；
 * - work 侧只有 HostSandboxApi：host.send 把交付写回 role 的 Work 通道；
 * - 多个 work 可并发；一个 work 同一时刻只跑一轮，运行中 send 进跳边界注入；
 * - work 没有人格、没有 role 的上下文；系统提示词每轮由 buildSystem 现拼，不读创建时快照。
 *
 * 会话账本住在 Conversation.works 上（随 chat.json 落盘、随 role 对话删除消失）；
 * 管理器自己只留内存态：在跑句柄、注入队列。进程被杀后 running 复位为 interrupted
 * （registry 载入归一化），注入队列随进程消失。
 */
import type { ReasoningEffort, StreamFn } from '../../ai/types'
import type { ResolvedProvider } from '../../ai/client'
import type { AgentEvent, AgentPart, ChannelExtra, ConversationMessage, MessageUsage, WorkSession, WorkStatus } from '../types'
import type { AgentProfileId } from '../agentProfile'
import { createExecuteTools } from '../sandbox/execute'
import type { AskFormPayload } from '../tools'
import { emptyDelivery, mergeDelivery, normalizeDelivery, type DeliveryRecord } from '../delivery'
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
  /**
   * work 的 api.ask：工作层不经过 role 的头脑，但问询要借 role 的身份落进它当前通道。
   * 由宿主注入；没有就退回沙箱基座里 role 自己的 ask（通常更短命，不推荐）。
   */
  ask?: (workId: string, form: AskFormPayload, signal: AbortSignal) => Promise<unknown>
}

export interface WorkManagerDeps {
  roleId: AgentProfileId
  /** role 的显示名：写进 Work 通道的元信息，避免模型/界面只看到 role id */
  roleName?: string
  roleConversationId: string
  goalId?: string
  getWorks: () => WorkSession[]
  setWorks: (update: (prev: WorkSession[]) => WorkSession[]) => void
  /** 每轮取当前提示词文件顺序现拼的系统提示词（无任何人设） */
  buildSystem: (roleId: AgentProfileId) => string
  /** role 会话里按 messageId 找一条用户消息（转发用） */
  roleMessage: (messageId: string) => ConversationMessage | null
  /** 把一条 outbound work 通道消息记到 role 的通道流水 */
  appendOutbound: (work: WorkSession, text: string, meta: { quoteMessageId?: string; auto?: boolean; extra?: ChannelExtra; delivery?: DeliveryRecord }) => void
  /** host.send / 自动兜底：把交付写回 role（宿主负责写通道 + 注入/起轮） */
  deliverToRole: (work: WorkSession, text: string, meta: { quoteMessageId?: string; auto?: boolean; extra?: ChannelExtra; delivery?: DeliveryRecord }) => void
  onEvent?: (workId: string, runId: string, e: AgentEvent) => void
  onRunEnd?: (workId: string, runId: string) => void
  stream?: StreamFn
}

export interface WorkManager {
  api: WorkSandboxApi
  setTurn(config: WorkTurnConfig): void
  abortAll(): void
  hasRunning(): boolean
  /**
   * UI 专用：带终止声明的停止。先关闭当前 loop，再把声明作为 Work 通道消息
   * 发给 role 并激活它；没有声明时调用方应走 api.stop（强制终止，不通知 role）。
   */
  stopWithStatement(name: string, statement: string): WorkCallResult
}

interface PendingInjection {
  text: string
  /** 被注入的任务消息：等当前一段 parts 落库之后再 append，保持 user/assistant 的真实顺序 */
  message: ConversationMessage
}

interface RunHandle {
  runId: string
  ctrl: AbortController
  /** role 在跑动中补的指令，连同任务消息一起排队 */
  injections: PendingInjection[]
  stopRequested: boolean
  /** 用户写下的终止声明；有它时收口说明写成「用户终止」，不是 role 强制停止 */
  stopStatement?: string
  /** 宿主级联停止（role 停止 / 卸载）导致的中断，不要再反过来给 role 上报 */
  hostAborted: boolean
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
      deps.deliverToRole(work, text, {
        ...(input.messageId ? { quoteMessageId: input.messageId } : {}),
        ...(input.extra ? { extra: input.extra } : {}),
        ...(work.delivery ? { delivery: work.delivery } : {}),
      })
      return { ok: true, delivered: true }
    },
  })

  /**
   * work 的交付账：和 role 的 turnDelivery 分开记，避免 work 跑完把文件清单写到 role
   * 当时那一轮的气泡上。同一轮多次 submit 合并去重；host.send 与自动兜底都带这份账。
   */
  const submitDelivery = (workId: string, input: unknown): { ok: boolean; files: DeliveryRecord['files']; sources: DeliveryRecord['sources']; error?: string } => {
    const rec = normalizeDelivery(input)
    if (!rec) return { ok: false, files: [], sources: [], error: 'delivery.submit 需要至少一个 files / sources 项' }
    const current = deps.getWorks().find((w) => w.id === workId)
    if (!current) return { ok: false, files: [], sources: [], error: '这个 work 已经被删除了' }
    const merged = mergeDelivery(
      current.delivery
        ? { files: [...current.delivery.files], sources: [...current.delivery.sources] }
        : emptyDelivery(),
      rec,
    )
    patch(workId, (w) => ({ ...w, delivery: merged, lastActiveAt: Date.now() }))
    return { ok: true, files: merged.files, sources: merged.sources }
  }

  const workSandbox = (cfg: WorkTurnConfig, workId: string) => ({
    ...cfg.sandbox,
    // work 不能再派 work、不能发通道、不能审批外部路径；这些组即使基座里有也被 apiAllow 挡死，
    // 这里再把注入字段清掉，避免 buildApi 装配出空壳。
    work: undefined,
    chat: undefined,
    permission: undefined,
    delivery: { submit: (input: unknown) => submitDelivery(workId, input) },
    host: hostApi(workId),
    ...(cfg.ask ? { ask: (form: AskFormPayload) => cfg.ask!(workId, form, running.get(workId)?.ctrl.signal ?? new AbortController().signal) } : {}),
    // wait 与 ask 一样用 work 自己的 run 信号：role 轮早已结束，不能拿 role 的 ctrl 当命。
    wait: (ms: number) =>
      new Promise<void>((resolve, reject) => {
        const signal = running.get(workId)?.ctrl.signal
        if (signal?.aborted) {
          reject(new Error('等待被用户中止'))
          return
        }
        const timer = setTimeout(() => {
          cleanup()
          resolve()
        }, ms)
        const onAbort = () => {
          cleanup()
          reject(new Error('等待被用户中止'))
        }
        const cleanup = () => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
        }
        signal?.addEventListener('abort', onAbort, { once: true })
      }),
    apiAllow: workRuntimeApiAllow(deps.roleId),
    apiBrief: apiBriefForGroups(workRuntimeApiAllow(deps.roleId)),
  })

  /**
   * work 异常终止时的系统上报：不是用户/role 主动叫停，role 必须知道这轮没有正常交付。
   * 它走普通 Work 通道消息，role 空闲就起一轮、在跑就在跳边界注入。
   */
  const reportAbnormal = (work: WorkSession, issue: string, kind: 'error' | 'interrupted' | 'incomplete' | 'unavailable'): void => {
    const label =
      kind === 'error'
        ? '出错'
        : kind === 'interrupted'
          ? '被中断'
          : kind === 'incomplete'
            ? '异常结束（输出不完整）'
            : '无法启动'
    const text = [
      `【work 异常终止】work「${work.name}」本轮${label}。`,
      kind === 'incomplete' ? '已交付的部分可能不完整，请先核对再决定是否沿用。' : '本轮没有正常交付。',
      `原因：${issue}`,
      '上下文与已完成的进度仍然保留。请据此判断：续派同一个 work、改用其它 work，或先向用户说明当前结果。',
    ].join('\n')
    const latest = deps.getWorks().find((w) => w.id === work.id) ?? work
    deps.deliverToRole(latest, text, {
      auto: true,
      ...(latest.delivery ? { delivery: latest.delivery } : {}),
    })
  }

  const startLoop = (work: WorkSession): void => {
    const cfg = turn
    if (!cfg) {
      patch(work.id, (w) => ({ ...w, status: 'error', lastIssue: '没有可用的轮次配置（模型/沙箱未就绪）' }))
      reportAbnormal(work, '没有可用的轮次配置（模型/沙箱未就绪）', 'unavailable')
      return
    }
    const handle: RunHandle = {
      runId: crypto.randomUUID(),
      ctrl: new AbortController(),
      injections: [],
      stopRequested: false,
      hostAborted: false,
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
        system: deps.buildSystem(work.roleId),
        workId: work.id,
        messages: work.messages,
        images,
        files,
        tools: createExecuteTools(workSandbox(cfg, work.id)),
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
          pull: () => {
            const item = handle.injections.shift()
            return item ? { text: item.text, commit: () => appendMessage(work.id, item.message) } : null
          },
          flush: (ps) => flushParts(work.id, ps),
          /*
           * 任务消息不能在 send 时先落库：当前这一轮可能还有 parts 没 flush，
           * 先落会变成「user 任务在 assistant 回复之前」，下一次还原历史时前缀就分叉了。
           * 这里等 flush 完再 append，保证落库顺序与实发顺序一致。
           */
          append: (injection) => injection.commit?.(),
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
        ? handle.stopStatement
          ? '用户终止：' + handle.stopStatement
          : '被 role 强制停止'
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
    const nextRuns = work.runs + (outcome.status === 'complete' || outcome.status === 'incomplete' ? 1 : 0)
    const nextRuntimeMs = work.runtimeMs + Math.max(0, Date.now() - handle.startedAt)
    patch(work.id, (w) => ({
      ...w,
      status,
      runs: nextRuns,
      runningSince: undefined,
      runtimeMs: nextRuntimeMs,
      ...(outcome.delivery && !handle.delivered ? { lastDelivery: outcome.delivery } : {}),
      ...(issue ? { lastIssue: issue } : {}),
    }))
    if (outcome.parts.length) flushParts(work.id, outcome.parts, outcome.usage ?? undefined)
    /*
     * 收口时还排着的注入没有机会再进跳边界：按「先 assistant 收口、再 user 任务」的顺序
     * 补落库，至少不把任务和已经实发的回复倒过来；下一轮 send 可以接着处理它们。
     */
    for (const pending of handle.injections.splice(0)) appendMessage(work.id, pending.message)
    deps.onRunEnd?.(work.id, handle.runId)

    // host.send 是主路径；漏了就把最后一段正文自动回传（标记 auto），role 仍能收口。
    if (!handle.delivered && !handle.stopRequested && outcome.delivery && outcome.status !== 'interrupted' && outcome.status !== 'error') {
      const latest = deps.getWorks().find((w) => w.id === work.id) ?? work
      deps.deliverToRole(latest, outcome.delivery, {
        auto: true,
        ...(latest.delivery ? { delivery: latest.delivery } : {}),
      })
    }

    /*
     * 异常终止与「用户/role 主动停止」分开：主动停止已经由 stopWithStatement / api.stop
     * 负责（后者明确不通知 role），只有出错、非主动中断、输出不完整或无法启动才由系统
     * 自动上报，避免停止操作反过来又激活 role。hostAborted 是 role 停止 / 页面卸载时
     * 的级联中断，也排除。
     */
    if (
      !handle.stopRequested &&
      !handle.hostAborted &&
      (outcome.status === 'error' || outcome.status === 'interrupted' || outcome.status === 'incomplete')
    ) {
      const latest = deps.getWorks().find((w) => w.id === work.id) ?? work
      reportAbnormal(
        latest,
        issue ?? (outcome.status === 'error' ? 'work 执行失败' : '任务被中止，没有交付'),
        outcome.status,
      )
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
      const handle = running.get(w.id)
      deps.appendOutbound(w, body, { ...(quoted ? { quoteMessageId: quoted.id } : {}) })
      if (handle) {
        // 运行中：任务消息不能先落库，和注入一起排队；到跳边界 flush 完当前 parts 再 append。
        // 否则本次已实发的 assistant 消息会被新任务挤到后面，下次重建历史时前缀从中间分叉。
        handle.injections.push({ text: body, message: task })
        patch(w.id, (cur) => ({ ...cur, lastActiveAt: Date.now() }))
        return { ok: true, name: w.name, mode: 'queued' }
      }
      appendMessage(w.id, task)
      const latest = deps.getWorks().find((cur) => cur.id === w.id)
      startLoop(latest ?? { ...w, messages: [...w.messages, task] })
      return { ok: true, name: w.name, mode: 'started' }
    },
  }

  return {
    api,
    setTurn: (config) => {
      turn = config
    },
    abortAll: () => {
      for (const h of running.values()) {
        h.hostAborted = true
        h.ctrl.abort()
      }
    },
    hasRunning: () => running.size > 0,
    stopWithStatement: (name: string, statement: string): WorkCallResult => {
      const w = find(name)
      if (!w) return { ok: false, error: '没有叫「' + name + '」的 work' }
      const text = statement.trim()
      if (!text) return { ok: false, error: '终止声明不能为空；不写声明只能强制终止' }
      const handle = running.get(w.id)
      if (handle) {
        handle.stopStatement = text
        handle.stopRequested = true
        handle.ctrl.abort()
      } else {
        patch(w.id, (cur) => ({
          ...cur,
          status: 'stopped',
          runningSince: undefined,
          lastActiveAt: Date.now(),
          lastIssue: '用户终止：' + text,
        }))
      }
      const latest = deps.getWorks().find((x) => x.id === w.id) ?? w
      deps.deliverToRole(
        latest,
        [
          '【用户终止 work】',
          'work「' + w.name + '」' + (handle ? '的当前 loop 已关闭。' : '已被终止（当前没有在跑的 loop）。'),
          '终止声明：' + text,
          '已有上下文仍然保留；请根据这条声明决定后续安排，必要时给用户一句收口说明。',
        ].join('\n'),
        {},
      )
      return { ok: true, name: w.name, status: 'stopped' }
    },
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
