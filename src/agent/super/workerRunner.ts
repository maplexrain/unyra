/**
 * 隔离工坊 Worker 运行时驱动 (WorkerRunner)
 *
 * 职责：
 * 1. 负责单个 Worker 的长程异步运行与多跳推理；
 * 2. 挂载 request_input 原生挂起原语与外部/角色专属工具集；
 * 3. 严格隔离的 Worker 独立 KV 前缀门禁 (super:worker:${id})；
 * 4. 跳边界注入 (injections / atBoundary) 实时承接快通道插队与挂起唤醒；
 * 5. 正文零拷贝直出至面向人类的 chat 交付通道与 Artifact 沉淀。
 */

import { runAgent } from '../runtime'
import { assertPrefixStable } from '../prefixGate'
import type { AgentPart, AgentTool } from '../types'
import { toChatHistory } from '../../learn/agent/history'
import { applyEvent } from '../../learn/agent/events'
import { extractChatText } from './projection'
import { DEFAULT_WORKER_SYSTEM } from './hydration'
import type {
  ArtifactRecord,
  SuperAgentEngineOptions,
  SuperAgentEvent,
  WorkerSession,
  WorkerStatus,
} from './types'

export interface WorkerHandle {
  ctrl: AbortController
  inbox: string[]
  waitInputResolve?: (answer: string) => void
}

export interface DriveWorkerContext {
  worker: WorkerSession
  handle: WorkerHandle
  options: SuperAgentEngineOptions
  scopeId: string
  emit: (event: SuperAgentEvent) => void
  notifyStateChange: () => void
  onCompleted: (worker: WorkerSession, status: WorkerStatus, issue?: string) => void
}

/**
 * 启动并驱动单个 Worker 运行至终态
 */
export async function driveWorker(ctx: DriveWorkerContext): Promise<void> {
  const { worker, handle, options, scopeId, emit, notifyStateChange, onCompleted } = ctx

  const requestInputTool: AgentTool = {
    name: 'request_input',
    description:
      '向用户提问或请求补充关键信息，并将当前工单挂起为 waiting_input 状态等待回复。' +
      '当缺少必要信息、需要用户做方向抉择或高危操作确认时调用。调用后工单挂起，等待用户通过直连通道输入回复。',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: '向用户提出的明确问题或待确认事项',
        },
      },
      required: ['question'],
    },
    run: async (args) => {
      const question = String(args.question || '').trim() || '请补充指示'
      worker.waitingPrompt = question
      worker.status = 'waiting_input'
      emit({ type: 'worker-need-input', workerId: worker.id, prompt: question })
      emit({ type: 'worker-status', workerId: worker.id, status: 'waiting_input' })
      notifyStateChange()
      return {
        ok: true,
        content: `已发起提问并挂起工单：「${question}」。工单已进入 waiting_input 状态，请等待用户回复。`,
      }
    },
  }

  const customTools = options.createWorkerTools
    ? options.createWorkerTools(worker.id)
    : []
  const workerTools = [requestInputTool, ...customTools]

  let currentTurnParts: AgentPart[] = []
  let currentHop = 0

  // 跳边界介入读取通道
  const atBoundary = async (): Promise<{ role: 'user'; content: string } | null> => {
    // 1. 若当前处于 waiting_input，异步等待用户通过直连通道提供答复
    if (worker.status === 'waiting_input') {
      let answer = handle.inbox.shift()
      if (!answer) {
        answer = await new Promise<string>((resolve) => {
          handle.waitInputResolve = resolve
          if (handle.ctrl.signal.aborted) {
            resolve('')
          } else {
            handle.ctrl.signal.addEventListener('abort', () => resolve(''), { once: true })
          }
        })
      }
      if (!answer || handle.ctrl.signal.aborted) return null

      delete worker.waitingPrompt
      worker.status = 'running'
      emit({ type: 'worker-status', workerId: worker.id, status: 'running' })

      if (currentTurnParts.length) {
        worker.messages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          parts: currentTurnParts,
          ts: Date.now(),
        })
        currentTurnParts = []
      }

      worker.messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: answer }],
        ts: Date.now(),
      })
      notifyStateChange()
      return { role: 'user', content: answer }
    }

    // 2. 正常运行中的在途跳边界插队
    if (!handle.inbox.length) return null
    const inst = handle.inbox.shift()!

    if (currentTurnParts.length) {
      worker.messages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        parts: currentTurnParts,
        ts: Date.now(),
      })
      currentTurnParts = []
    }

    worker.messages.push({
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: inst }],
      ts: Date.now(),
    })
    notifyStateChange()

    return { role: 'user', content: inst }
  }

  let finalStatus: WorkerStatus = 'done'
  let errorMessage: string | undefined

  try {
    await runAgent({
      provider: options.provider,
      model: options.model,
      system: options.workerSystemPrompt || DEFAULT_WORKER_SYSTEM,
      messages: toChatHistory(worker.messages),
      tools: workerTools,
      ctx: { nodeId: null, goalId: scopeId },
      signal: handle.ctrl.signal,
      ...(options.effort ? { reasoningEffort: options.effort } : {}),
      ...(options.chatFn ? { stream: options.chatFn } : {}),
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
        if (e.type === 'hop') {
          currentHop++
          emit({ type: 'worker-hop', workerId: worker.id, hop: currentHop })
        } else if (e.type === 'text') {
          worker.chatText += e.delta
          emit({
            type: 'worker-chat-delta',
            workerId: worker.id,
            delta: e.delta,
            hop: currentHop,
          })
        } else {
          emit({
            type: 'worker-mind-event',
            workerId: worker.id,
            event: e,
            hop: currentHop,
          })
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
  } else if (worker.status === 'waiting_input') {
    finalStatus = 'waiting_input'
  } else if (errorMessage && finalStatus !== 'cancelled') {
    finalStatus = 'failed'
  }

  if (currentTurnParts.length) {
    worker.messages.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      parts: currentTurnParts,
      ts: Date.now(),
    })
  }

  const delivered = extractChatText(currentTurnParts)
  if (delivered) {
    worker.chatText = delivered
  }

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
    emit({ type: 'worker-artifact-updated', workerId: worker.id, artifact: art })
  }

  worker.status = finalStatus
  if (errorMessage) worker.error = errorMessage
  worker.updatedAt = Date.now()

  onCompleted(worker, finalStatus, errorMessage)
}
