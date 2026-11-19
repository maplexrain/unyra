/**
 * SuperAgent 核心编排引擎 (SuperAgentEngine)
 *
 * 三平面架构中枢：
 * 1. Frontline Host：唯一的直接面向用户端，单轮/极速调度，严格无代码沙箱；
 * 2. Worker Pool：隔离工坊，独立上下文，独立 AbortController 与独立 prefixGate，正文零拷贝直出；
 * 3. Mailbox & Blackboard：Worker 静默入队 mailbox（不唤醒 Host），随下次用户请求拼头注入，沉淀结构化黑板。
 */

import type { ChatMessage, ReasoningEffort, StreamFn } from '../../ai/types'
import { streamChatWith, type ResolvedProvider } from '../../ai/client'
import { runAgent } from '../runtime'
import { assertPrefixStable } from '../prefixGate'
import type { AgentEvent, AgentPart, AgentTool, ConversationMessage } from '../types'
import { toChatHistory } from '../../learn/agent/history'
import { applyEvent } from '../../learn/agent/events'
import { createHostTools } from './hostTools'
import { buildHostUserPayload, extractChatText } from './projection'
import { findArtifact, upsertBlackboardEntry } from './blackboard'
import type {
  ArtifactRecord,
  SuperAgentEvent,
  SuperAgentState,
  WorkerReceipt,
  WorkerSession,
  WorkerStatus,
} from './types'

export interface SuperAgentEngineOptions {
  id?: string
  initialState?: Partial<SuperAgentState>
  provider: ResolvedProvider
  model: string
  effort?: ReasoningEffort
  contextWindow?: number
  /** 测试注入替身流，默认使用实际 client */
  chatFn?: StreamFn
  /** 工坊 Worker 可选工具集工厂（如 sandbox execute） */
  createWorkerTools?: (workerId: string) => AgentTool[]
  onEvent?: (event: SuperAgentEvent) => void
  onStateChange?: (state: SuperAgentState) => void
}

interface WorkerHandle {
  ctrl: AbortController
  inbox: string[]
}

const DEFAULT_HOST_SYSTEM = `你是 Frontline Host（前台总调度助手）。
你的职责是作为用户的唯一接待前台，倾听学习者的需求：
1. 简单问答、概念解释、闲聊或确认性提问：直接作答，言简意赅，不要创建 Worker；
2. 复杂任务、需要资料检索、讲义编写、试卷编排或数据实验的长任务：调用 spawn_worker 委派给后台隔离工坊去执行；
3. 需要修正或补充后台任务：调用 steer_worker；取消任务调用 cancel_worker；查看历史或索引调用 query_blackboard / inspect_worker；
4. 你自身没有长耗时沙箱，严格禁止假装已经完成了复杂产出；委派任务后即刻向用户汇报已派出专员即可。`

const DEFAULT_WORKER_SYSTEM = `你是专职执行工单的后台 Worker。
请聚焦完成被指派的目标，产出清晰、严谨、面向学习者的内容。
在收口时直接输出完整的高质量成果正文。`

export class SuperAgentEngine {
  private state: SuperAgentState
  private options: SuperAgentEngineOptions
  private hostRunning = false
  private workerHandles = new Map<string, WorkerHandle>()

  constructor(options: SuperAgentEngineOptions) {
    this.options = options
    const id = options.id || crypto.randomUUID()
    this.state = {
      id,
      hostSystemPrompt: options.initialState?.hostSystemPrompt || DEFAULT_HOST_SYSTEM,
      hostMessages: options.initialState?.hostMessages || [],
      workers: options.initialState?.workers || {},
      mailbox: options.initialState?.mailbox || [],
      blackboard: options.initialState?.blackboard || [],
    }
  }

  public getState(): SuperAgentState {
    return this.state
  }

  private emit(event: SuperAgentEvent): void {
    this.options.onEvent?.(event)
  }

  private notifyStateChange(): void {
    this.options.onStateChange?.(this.state)
  }

  /**
   * 发送用户消息
   *
   * 路由逻辑：
   * 1. 快通道 (Direct Route)：指定 targetWorkerId 时，绕过 Host 直接投递指令；
   * 2. 标准主控通道 (Host Route)：弹出 Mailbox，前置拼头注入 user 消息，驱动 Host 单轮调度。
   */
  public async sendUserMessage(
    text: string,
    opts?: { targetWorkerId?: string },
  ): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return

    // 1. 直连快通道 (Direct Route)
    if (opts?.targetWorkerId) {
      const worker = this.state.workers[opts.targetWorkerId]
      if (!worker) {
        throw new Error(`未找到目标 Worker: ${opts.targetWorkerId}`)
      }
      this.steerWorker(opts.targetWorkerId, trimmed)
      return
    }

    // 2. Frontline Host 调度通道
    if (this.hostRunning) {
      throw new Error('Host 正在响应中，请稍候')
    }

    this.hostRunning = true
    try {
      // 消费 mailbox 中全部积压回执（严格一次性弹出）
      const receipts = [...this.state.mailbox]
      this.state.mailbox = []

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
      this.notifyStateChange()

      // 驱动 Host runAgent
      await this.runHost()
    } finally {
      this.hostRunning = false
      this.notifyStateChange()
    }
  }

  /**
   * 启动 Frontline Host 单轮调度
   */
  private async runHost(): Promise<void> {
    const hostTools = createHostTools({
      getState: () => this.state,
      spawnWorker: (params) => this.spawnWorker(params),
      steerWorker: (workerId, inst) => this.steerWorker(workerId, inst),
      cancelWorker: (workerId, reason) => this.cancelWorker(workerId, reason),
    })

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
    }
    this.state.hostMessages.push(assistantMsg)
    this.emit({ type: 'host-done', content: finalContent })
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
      undefined,
      params.tags,
    )

    this.emit({ type: 'worker-created', worker: session })
    this.emit({ type: 'worker-status', workerId, status: 'running' })
    this.notifyStateChange()

    const handle: WorkerHandle = {
      ctrl: new AbortController(),
      inbox: [],
    }
    this.workerHandles.set(workerId, handle)

    // 异步后台并发启动 Worker
    void this.driveWorker(session, handle)

    return { workerId, status: 'running' }
  }

  /**
   * 向指定 Worker 插队指令或答复
   */
  public steerWorker(workerId: string, instruction: string): { ok: boolean; message: string } {
    const worker = this.state.workers[workerId]
    if (!worker) {
      return { ok: false, message: `Worker ${workerId} 不存在` }
    }

    const handle = this.workerHandles.get(workerId)
    if (worker.status === 'running' && handle) {
      // 正在运行中：压入跳边界 inbox 队列
      handle.inbox.push(instruction)
      return { ok: true, message: `指令已挂起，将在 Worker 当前步骤结束后注入` }
    }

    // 非运行状态（waiting_input / idle / done 等）：追加用户消息并重新拉起
    worker.messages.push({
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: instruction }],
      ts: Date.now(),
    })
    worker.status = 'running'
    worker.updatedAt = Date.now()
    this.emit({ type: 'worker-status', workerId, status: 'running' })
    this.notifyStateChange()

    const newHandle: WorkerHandle = {
      ctrl: new AbortController(),
      inbox: [],
    }
    this.workerHandles.set(workerId, newHandle)
    void this.driveWorker(worker, newHandle)

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
   * Worker 异步执行引擎核心
   */
  private async driveWorker(worker: WorkerSession, handle: WorkerHandle): Promise<void> {
    const workerTools = this.options.createWorkerTools
      ? this.options.createWorkerTools(worker.id)
      : []

    let currentTurnParts: AgentPart[] = []

    // 跳边界介入读取通道
    const atBoundary = async (): Promise<{ role: 'user'; content: string } | null> => {
      if (!handle.inbox.length) return null
      const inst = handle.inbox.shift()!

      // 将当前在途的 parts 固化成一段 assistant 消息
      if (currentTurnParts.length) {
        worker.messages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          parts: currentTurnParts,
          ts: Date.now(),
        })
        currentTurnParts = []
      }

      // 将介入指令入列为 user 消息
      worker.messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: inst }],
        ts: Date.now(),
      })
      this.notifyStateChange()

      return { role: 'user', content: inst }
    }

    let finalStatus: WorkerStatus = 'done'
    let errorMessage: string | undefined

    try {
      await runAgent({
        provider: this.options.provider,
        model: this.options.model,
        system: DEFAULT_WORKER_SYSTEM,
        messages: toChatHistory(worker.messages),
        tools: workerTools,
        ctx: { nodeId: null, goalId: this.state.id },
        signal: handle.ctrl.signal,
        ...(this.options.effort ? { reasoningEffort: this.options.effort } : {}),
        ...(this.options.chatFn ? { stream: this.options.chatFn } : {}),
        injections: atBoundary,
        onContext: (snapshot) => {
          // 每个 Worker 独立 key 分隔前缀门禁
          assertPrefixStable(
            'super:worker:' + worker.id,
            snapshot.messages,
            snapshot.tools as Parameters<typeof assertPrefixStable>[2],
          )
        },
        onEvent: (e) => {
          if (e.type === 'text') {
            worker.chatText += e.delta
            // 零拷贝直推面向人类的正文
            this.emit({ type: 'worker-chat-delta', workerId: worker.id, delta: e.delta })
          } else {
            // 过程事件直推折叠区
            this.emit({ type: 'worker-mind-event', workerId: worker.id, event: e })
          }

          if (e.type === 'error') {
            errorMessage = e.message
          }
          applyEvent(currentTurnParts, e)
        },
      })
    } catch (err) {
      if (handle.ctrl.signal.aborted) {
        finalStatus = 'cancelled'
        errorMessage = '任务被中止'
      } else {
        finalStatus = 'failed'
        errorMessage = err instanceof Error ? err.message : String(err)
      }
    }

    if (handle.ctrl.signal.aborted) {
      finalStatus = 'cancelled'
    } else if (errorMessage && finalStatus !== 'cancelled') {
      finalStatus = 'failed'
    }

    // 固化最后一段回复
    if (currentTurnParts.length) {
      worker.messages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        parts: currentTurnParts,
        ts: Date.now(),
      })
    }

    // 更新交付正文
    const delivered = extractChatText(currentTurnParts)
    if (delivered) {
      worker.chatText = delivered
    }

    // 若产出了正文，登记产物
    if (finalStatus === 'done' && worker.chatText.trim()) {
      const art: ArtifactRecord = {
        id: 'art-' + crypto.randomUUID().slice(0, 8),
        workerId: worker.id,
        title: worker.title + '交付物',
        content: worker.chatText,
        kind: 'text',
        updatedAt: Date.now(),
      }
      worker.artifacts.push(art)
      this.emit({ type: 'worker-artifact-updated', workerId: worker.id, artifact: art })
    }

    worker.status = finalStatus
    if (errorMessage) worker.error = errorMessage
    worker.updatedAt = Date.now()

    this.workerHandles.delete(worker.id)
    this.onWorkerCompleted(worker, finalStatus, errorMessage)
  }

  /**
   * Worker 结算：静默写入 Mailbox 与 Blackboard，绝对不触发 Host
   */
  private onWorkerCompleted(
    worker: WorkerSession,
    status: WorkerStatus,
    issue?: string,
  ): void {
    const summary =
      issue ??
      (worker.chatText.length > 80
        ? worker.chatText.slice(0, 80) + '…'
        : worker.chatText || '任务已完成')

    const receipt: WorkerReceipt = {
      id: crypto.randomUUID(),
      workerId: worker.id,
      title: worker.title,
      status: status === 'done' ? 'done' : status === 'cancelled' ? 'cancelled' : 'failed',
      summary,
      artifactIds: worker.artifacts.map((a) => a.id),
      ts: Date.now(),
    }

    // 静默压入 mailbox，不唤醒 Host
    this.state.mailbox.push(receipt)
    this.emit({ type: 'mailbox-enqueued', receipt })

    // 更新黑板
    this.state.blackboard = upsertBlackboardEntry(this.state.blackboard, worker, summary)

    this.emit({ type: 'worker-status', workerId: worker.id, status, error: issue })
    this.notifyStateChange()
  }
}
