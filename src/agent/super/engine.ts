/**
 * SuperAgent 核心编排引擎 (SuperAgentEngine)
 *
 * 三平面架构中枢：
 * 1. Frontline Host：唯一的直接面向用户端，单轮/极速调度，严格无代码沙箱；
 * 2. Worker Pool：隔离工坊，独立上下文，独立 AbortController 与独立 prefixGate，正文零拷贝直出；
 * 3. Mailbox & Blackboard：Worker 静默入队 mailbox（不唤醒 Host），随下次用户请求拼头注入，沉淀结构化黑板。
 */

import type { ReasoningEffort } from '../../ai/types'
import { type ResolvedProvider } from '../../ai/client'
import { runAgent } from '../runtime'
import { assertPrefixStable } from '../prefixGate'
import type { AgentPart, ConversationMessage } from '../types'
import { toChatHistory } from '../../learn/agent/history'
import { applyEvent } from '../../learn/agent/events'
import { createHostTools } from './hostTools'
import { buildHostUserPayload } from './projection'
import { findArtifact, upsertBlackboardEntry } from './blackboard'
import {
  DEFAULT_HOST_SYSTEM,
  hydrateSuperAgentState,
} from './hydration'
export {
  DEFAULT_HOST_SYSTEM,
  DEFAULT_WORKER_SYSTEM,
  hydrateSuperAgentState,
} from './hydration'
import { DelegationTracker } from './delegation'
import { driveWorker, type WorkerHandle } from './workerRunner'
import type {
  DelegatedTaskInput,
  DelegationOutcome,
  SuperAgentEngineOptions,
  SuperAgentEvent,
  SuperAgentState,
  WorkerReceipt,
  WorkerSession,
  WorkerStatus,
} from './types'
export type { SuperAgentEngineOptions } from './types'

export class SuperAgentEngine {
  private state: SuperAgentState
  private options: SuperAgentEngineOptions
  private hostRunning = false
  private hostAbortController: AbortController | null = null
  private hostChain: Promise<string> | null = null
  private workerHandles = new Map<string, WorkerHandle>()
  private delegationTracker = new DelegationTracker()

  constructor(options: SuperAgentEngineOptions) {
    this.options = options
    const id = options.id || crypto.randomUUID()
    this.state = options.initialState
      ? hydrateSuperAgentState({ id, ...options.initialState })
      : {
          id,
          hostSystemPrompt: DEFAULT_HOST_SYSTEM,
          hostMessages: [],
          workers: {},
          mailbox: [],
          blackboard: [],
        }
  }

  public getState(): SuperAgentState {
    return this.state
  }

  public isHostRunning(): boolean {
    return this.hostRunning
  }

  public updateAiConfig(cfg: {
    provider: ResolvedProvider
    model: string
    effort?: ReasoningEffort
  }): void {
    this.options.provider = cfg.provider
    this.options.model = cfg.model
    if (cfg.effort !== undefined) {
      this.options.effort = cfg.effort
    }
  }

  private emit(event: SuperAgentEvent): void {
    this.options.onEvent?.(event)
  }

  private notifyStateChange(): void {
    this.options.onStateChange?.(this.state)
  }

  /**
   * 写入外部静默回执（Mailbox 条目）。
   * 铁律：绝不唤醒 Host，仅入列并广播事件，等待用户下一次发消息时拼头注入。
   */
  public pushExternalReceipt(receipt: WorkerReceipt): void {
    this.state.mailbox.push(receipt)
    this.emit({ type: 'mailbox-enqueued', receipt })
    this.notifyStateChange()
  }

  /**
   * 获取当前 Host 正在处理的委派上下文（若为直接用户交互则为 null）
   */
  public getActiveDelegation(): DelegatedTaskInput | null {
    return this.delegationTracker.getCurrentDelegation()
  }

  /**
   * 发送用户消息
   *
   * 路由逻辑：
   * 1. 快通道 (Direct Route)：指定 targetWorkerId 时，绕过 Host 直接投递指令；
   * 2. 标准主控通道 (Host Route)：通过 Promise 链严格串行排队，原子消费 Mailbox 拼头注入，驱动 Host 单轮调度。
   */
  public async sendUserMessage(
    text: string,
    opts?: { targetWorkerId?: string },
  ): Promise<string> {
    const trimmed = text.trim()
    if (!trimmed) return ''

    // 1. 直连快通道 (Direct Route)
    if (opts?.targetWorkerId) {
      const worker = this.state.workers[opts.targetWorkerId]
      if (!worker) {
        throw new Error(`未找到目标 Worker: ${opts.targetWorkerId}`)
      }
      this.steerWorker(opts.targetWorkerId, trimmed)
      return `已向 Worker ${opts.targetWorkerId} 发送指令`
    }

    // 2. 串行排队进入 Frontline Host 调度通道
    return await this.enqueueHostTurn(trimmed)
  }

  /**
   * 执行跨专家协作委派任务
   */
  public async runDelegatedTask(input: DelegatedTaskInput): Promise<DelegationOutcome> {
    return new Promise<DelegationOutcome>((resolve, reject) => {
      this.delegationTracker.startDelegation(input, resolve, reject)

      const fromName = input.fromAgentName || input.fromAgentId
      const refsSnippet = input.inputRefs?.length
        ? `\n【参考产物ID】: ${input.inputRefs.join(', ')}`
        : ''
      const userText = `【跨专家协作委派单】\n来自专家: ${fromName}\n工单ID: ${input.delegationId}\n任务描述: ${input.task}${refsSnippet}`

      this.enqueueHostTurn(userText, input.delegationId).catch((err) => {
        this.delegationTracker.hostTurnFailed(input.delegationId, err)
      })
    })
  }

  private async enqueueHostTurn(text: string, delegationId?: string): Promise<string> {
    const prev = this.hostChain
    let taskPromise!: Promise<string>
    taskPromise = (async () => {
      try {
        if (prev) await prev
        return await this.doSendHostMessage(text, delegationId)
      } finally {
        if (this.hostChain === taskPromise) {
          this.hostChain = null
        }
      }
    })()
    this.hostChain = taskPromise
    return taskPromise
  }

  private async doSendHostMessage(trimmed: string, delegationId?: string): Promise<string> {
    this.hostRunning = true
    this.hostAbortController = new AbortController()
    this.emit({ type: 'host-start' })
    this.notifyStateChange()
    try {
      // 原子摘除：只消费当前时刻 snapshot 的回执
      const receipts = [...this.state.mailbox]
      const consumedIds = new Set(receipts.map((r) => r.id))

      // 提取当前活跃 Worker 快照
      const activeWorkers = Object.values(this.state.workers).map((w) => ({
        id: w.id,
        title: w.title,
        status: w.status,
        goal: w.goal,
      }))

      // 构建确定性的 payload 拼接到当轮 user 消息头部
      const payload = buildHostUserPayload(trimmed, receipts, activeWorkers)
      const userMsg: ConversationMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: payload }],
        ts: Date.now(),
      }
      this.state.hostMessages.push(userMsg)

      // 成功写入用户消息后，原子摘除已消费的回执（保留 Host 执行期间新写入的回执）
      this.state.mailbox = this.state.mailbox.filter((r) => !consumedIds.has(r.id))
      this.notifyStateChange()

      // 驱动 Host runAgent
      const finalContent = await this.runHost({
        id: userMsg.id,
        sender: '学习者',
        snippet: trimmed.slice(0, 60),
      })

      if (delegationId) {
        this.delegationTracker.hostTurnFinished(
          delegationId,
          finalContent,
          (id) => this.state.workers[id],
        )
      }
      return finalContent
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err)
      this.emit({ type: 'host-done', error: errMsg })
      throw err
    } finally {
      this.hostAbortController = null
      this.hostRunning = false
      this.notifyStateChange()
    }
  }

  /**
   * 启动 Frontline Host 单轮调度
   */
  private async runHost(replyTo?: { id: string; sender: string; snippet: string }): Promise<string> {
    const baseTools = createHostTools({
      getState: () => this.state,
      spawnWorker: (params) => this.spawnWorker(params),
      steerWorker: (workerId, inst) => this.steerWorker(workerId, inst),
      cancelWorker: (workerId, reason) => this.cancelWorker(workerId, reason),
    })
    const hostTools = this.options.extraHostTools?.length
      ? [...baseTools, ...this.options.extraHostTools]
      : baseTools

    let hostParts: AgentPart[] = []
    let finalContent = ''

    await runAgent({
      provider: this.options.provider,
      model: this.options.model,
      system: this.state.hostSystemPrompt,
      messages: toChatHistory(this.state.hostMessages),
      tools: hostTools,
      ctx: { nodeId: null, goalId: this.state.id },
      ...(this.options.effort ? { reasoningEffort: this.options.effort } : {}),
      ...(this.options.chatFn ? { stream: this.options.chatFn } : {}),
      ...(this.hostAbortController ? { signal: this.hostAbortController.signal } : {}),
      onContext: (snapshot) => {
        // 前缀门禁：严格保障 Host 历史只增不改
        assertPrefixStable(
          'super:host:' + this.state.id,
          snapshot.messages,
          snapshot.tools as Parameters<typeof assertPrefixStable>[2],
        )
      },
      onEvent: (e) => {
        if (e.type === 'thinking') {
          this.emit({ type: 'host-thinking', delta: e.delta })
        } else if (e.type === 'text') {
          finalContent += e.delta
          this.emit({ type: 'host-text-delta', delta: e.delta })
        } else if (e.type === 'tool-call') {
          this.emit({ type: 'host-tool-call', id: e.id, name: e.name, args: e.args })
        } else if (e.type === 'tool-result') {
          this.emit({
            type: 'host-tool-result',
            id: e.id,
            name: e.name,
            result: e.result,
            ok: e.ok,
          })
        }
        applyEvent(hostParts, e)
      },
    })

    const assistantMsg: ConversationMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      parts: hostParts,
      ts: Date.now(),
      replyToId: replyTo?.id,
      replyToSender: replyTo?.sender,
      replyToSnippet: replyTo?.snippet,
    }
    this.state.hostMessages.push(assistantMsg)
    this.emit({ type: 'host-done', content: finalContent })
    return finalContent
  }

  /**
   * 启动 Worker
   */
  public spawnWorker(params: {
    title: string
    goal: string
    inputArtifactIds?: string[]
    tags?: string[]
  }): { workerId: string; status: WorkerStatus } {
    const workerId = 'w-' + crypto.randomUUID().slice(0, 8)
    const initialMessages: ConversationMessage[] = []

    // 若有输入产物引用，组装为前置背景注入
    if (params.inputArtifactIds?.length) {
      const artSnippets: string[] = []
      for (const aid of params.inputArtifactIds) {
        const art = findArtifact(this.state, aid)
        if (art) {
          artSnippets.push(`--- 产物【${art.title}】(ID: ${art.id}) ---\n${art.content}`)
        }
      }
      if (artSnippets.length) {
        initialMessages.push({
          id: crypto.randomUUID(),
          role: 'user',
          parts: [{ type: 'text', text: `【前置产物参考】\n${artSnippets.join('\n\n')}` }],
          ts: Date.now(),
        })
      }
    }

    // 任务主指令
    initialMessages.push({
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: `任务目标：${params.goal}` }],
      ts: Date.now(),
    })

    const session: WorkerSession = {
      id: workerId,
      title: params.title,
      goal: params.goal,
      status: 'running',
      messages: initialMessages,
      chatText: '',
      artifacts: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.state.workers[workerId] = session
    this.state.blackboard = upsertBlackboardEntry(
      this.state.blackboard,
      session,
      '任务已启动，正在执行',
      params.tags,
    )
    this.delegationTracker.recordSpawnedWorker(workerId)
    this.emit({ type: 'worker-created', worker: session })
    this.emit({ type: 'worker-status', workerId, status: 'running' })
    this.notifyStateChange()

    const handle: WorkerHandle = {
      ctrl: new AbortController(),
      inbox: [],
    }
    this.workerHandles.set(workerId, handle)
    void driveWorker({
      worker: session,
      handle,
      options: this.options,
      scopeId: this.state.id,
      emit: (e) => this.emit(e),
      notifyStateChange: () => this.notifyStateChange(),
      onCompleted: (w, status, issue) => {
        this.workerHandles.delete(w.id)
        this.onWorkerCompleted(w, status, issue)
      },
    })

    return { workerId, status: 'running' }
  }

  /**
   * 向运行中或挂起的 Worker 注入追加指令或回答提问
   */
  public steerWorker(workerId: string, instruction: string): { ok: boolean; message: string } {
    const worker = this.state.workers[workerId]
    if (!worker) {
      return { ok: false, message: `Worker ${workerId} 不存在` }
    }

    const handle = this.workerHandles.get(workerId)
    if (handle) {
      if (worker.status === 'waiting_input' && handle.waitInputResolve) {
        const resolver = handle.waitInputResolve
        delete handle.waitInputResolve
        resolver(instruction)
        return { ok: true, message: `已向 Worker ${workerId} 回复提问` }
      }
      handle.inbox.push(instruction)
      return { ok: true, message: `指令已进入 Worker ${workerId} 待处理队列` }
    }

    // 脱机或已停止状态（如重启恢复后）：追加用户消息并重新拉起
    worker.messages.push({
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: instruction }],
      ts: Date.now(),
    })
    delete worker.waitingPrompt
    worker.status = 'running'
    worker.updatedAt = Date.now()
    this.emit({ type: 'worker-status', workerId, status: 'running' })
    this.notifyStateChange()

    const newHandle: WorkerHandle = {
      ctrl: new AbortController(),
      inbox: [],
    }
    this.workerHandles.set(workerId, newHandle)
    void driveWorker({
      worker,
      handle: newHandle,
      options: this.options,
      scopeId: this.state.id,
      emit: (e) => this.emit(e),
      notifyStateChange: () => this.notifyStateChange(),
      onCompleted: (w, status, issue) => {
        this.workerHandles.delete(w.id)
        this.onWorkerCompleted(w, status, issue)
      },
    })

    return { ok: true, message: `已重新唤醒 Worker ${workerId} 处理新指令` }
  }

  /**
   * 取消/中止 Worker
   */
  public cancelWorker(workerId: string, reason = '由 Host 或用户取消'): { ok: boolean; message: string } {
    const worker = this.state.workers[workerId]
    if (!worker) {
      return { ok: false, message: `Worker ${workerId} 不存在` }
    }

    const handle = this.workerHandles.get(workerId)
    if (handle) {
      handle.ctrl.abort()
      this.workerHandles.delete(workerId)
    }

    worker.status = 'cancelled'
    worker.error = reason
    worker.updatedAt = Date.now()

    this.onWorkerCompleted(worker, 'cancelled', reason)
    return { ok: true, message: `Worker ${workerId} 已取消` }
  }

  /**
   * 中止全部活跃 Worker
   */
  public stopAll(): void {
    if (this.hostAbortController) {
      this.hostAbortController.abort()
      this.hostAbortController = null
    }
    for (const [wid, handle] of this.workerHandles.entries()) {
      handle.ctrl.abort()
      const w = this.state.workers[wid]
      if (w && (w.status === 'running' || w.status === 'waiting_input')) {
        w.status = 'cancelled'
        w.error = '批量终止'
        this.onWorkerCompleted(w, 'cancelled', '批量终止')
      }
    }
    this.workerHandles.clear()
  }

  /**
   * Worker 结算：静默写入 Mailbox 与 Blackboard，绝对不触发 Host
   */
  private onWorkerCompleted(
    worker: WorkerSession,
    status: WorkerStatus,
    issue?: string,
  ): void {
    if (status === 'waiting_input') {
      this.state.blackboard = upsertBlackboardEntry(
        this.state.blackboard,
        worker,
        worker.waitingPrompt ? `工单挂起：${worker.waitingPrompt}` : '等待用户输入',
      )
      this.notifyStateChange()
      return
    }

    let summary = issue
    if (!summary) {
      if (worker.chatText) {
        summary = worker.chatText.slice(0, 120) + (worker.chatText.length > 120 ? '...' : '')
      } else {
        summary = status === 'done' ? '任务已顺利完成' : '任务未能产出有效结果'
      }
    }

    const receipt: WorkerReceipt = {
      id: crypto.randomUUID(),
      workerId: worker.id,
      title: worker.title,
      status: (status === 'running' || status === 'idle') ? 'done' : status,
      summary,
      artifactIds: worker.artifacts.map((a) => a.id),
      ts: Date.now(),
      sourceType: 'worker',
    }

    this.state.blackboard = upsertBlackboardEntry(
      this.state.blackboard,
      worker,
      summary,
    )
    this.emit({ type: 'worker-status', workerId: worker.id, status, error: issue })

    this.state.mailbox.push(receipt)
    this.emit({ type: 'mailbox-enqueued', receipt })
    this.notifyStateChange()

    // 委派追踪回调检查
    this.delegationTracker.onWorkerTerminal(worker.id, (id) => this.state.workers[id])
  }
}
