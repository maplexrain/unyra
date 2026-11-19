/**
 * Frontline Host 专属控制面工具
 *
 * 铁律：
 * 1. 严格禁止挂载 execute 沙箱或任何任意代码执行环境；
 * 2. 5 个原语均为纯轻量 JSON 工具，秒级响应，绝不在工具内长轮询或 await 结果；
 * 3. 任何繁重、长耗时任务必须经由 spawn_worker 委派给隔离工坊。
 */

import type { AgentTool, AgentToolResult } from '../types'
import { searchBlackboard } from './blackboard'
import type { SuperAgentState } from './types'

export interface HostToolDeps {
  getState: () => SuperAgentState
  spawnWorker: (params: {
    title: string
    goal: string
    inputArtifactIds?: string[]
    tags?: string[]
  }) => { workerId: string; status: string }
  steerWorker: (workerId: string, instruction: string) => { ok: boolean; message: string }
  cancelWorker: (workerId: string, reason?: string) => { ok: boolean; message: string }
}

/**
 * 创建 Frontline Host 的 5 个轻量控制面工具
 */
export function createHostTools(deps: HostToolDeps): AgentTool[] {
  const spawnWorkerTool: AgentTool = {
    name: 'spawn_worker',
    description:
      '启动一个专职的后台 Worker 独立工坊去处理复杂、耗时或需要工具探索的子任务。该工具会立即返回 workerId，不会阻塞当前对话。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Worker 任务简明标题，如「微积分第一章讲义检索」' },
        goal: { type: 'string', description: '交付的具体目标、范围与验收标准' },
        inputArtifactIds: {
          type: 'array',
          items: { type: 'string' },
          description: '可选：前置任务产出的产物 ID 清单，将作为输入上下文传递给新 Worker',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '可选：便于黑板检索与分类的标签',
        },
      },
      required: ['title', 'goal'],
    },
    async run(args) {
      const title = String(args.title || '').trim()
      const goal = String(args.goal || '').trim()
      const inputArtifactIds = Array.isArray(args.inputArtifactIds)
        ? (args.inputArtifactIds as string[])
        : []
      const tags = Array.isArray(args.tags) ? (args.tags as string[]) : []

      if (!title || !goal) {
        return { ok: false, content: 'spawn_worker 必须提供 title 和 goal' }
      }

      const res = deps.spawnWorker({ title, goal, inputArtifactIds, tags })
      return {
        ok: true,
        content: JSON.stringify({
          success: true,
          workerId: res.workerId,
          status: res.status,
          message: `已为「${title}」创建后台任务 (ID: ${res.workerId})，后台已开始执行。`,
        }),
      }
    },
  }

  const steerWorkerTool: AgentTool = {
    name: 'steer_worker',
    description:
      '向正在运行或等待输入的 Worker 插队下达补充指令或答复其问题。如果 Worker 正在推理，指令将在下一个跳边界安全注入。',
    parameters: {
      type: 'object',
      properties: {
        workerId: { type: 'string', description: '目标 Worker ID' },
        instruction: { type: 'string', description: '补充要求、修正意见或答复内容' },
      },
      required: ['workerId', 'instruction'],
    },
    async run(args) {
      const workerId = String(args.workerId || '').trim()
      const instruction = String(args.instruction || '').trim()
      if (!workerId || !instruction) {
        return { ok: false, content: 'steer_worker 必须提供 workerId 和 instruction' }
      }

      const res = deps.steerWorker(workerId, instruction)
      return {
        ok: res.ok,
        content: JSON.stringify(res),
      }
    },
  }

  const cancelWorkerTool: AgentTool = {
    name: 'cancel_worker',
    description: '终止指定 Worker 的运行。',
    parameters: {
      type: 'object',
      properties: {
        workerId: { type: 'string', description: '目标 Worker ID' },
        reason: { type: 'string', description: '取消原因' },
      },
      required: ['workerId'],
    },
    async run(args) {
      const workerId = String(args.workerId || '').trim()
      const reason = args.reason ? String(args.reason) : undefined
      if (!workerId) {
        return { ok: false, content: 'cancel_worker 必须提供 workerId' }
      }

      const res = deps.cancelWorker(workerId, reason)
      return {
        ok: res.ok,
        content: JSON.stringify(res),
      }
    },
  }

  const queryBlackboardTool: AgentTool = {
    name: 'query_blackboard',
    description: '检索历史或当前全部工单、产物元数据与结构化黑板索引。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，如「微积分」、「讲义」、「数据清洗」' },
        limit: { type: 'number', description: '返回最大条数，默认 5' },
      },
      required: ['query'],
    },
    async run(args) {
      const query = String(args.query || '').trim()
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(20, args.limit)) : 5
      const state = deps.getState()
      const matches = searchBlackboard(state.blackboard, query, limit)
      return {
        ok: true,
        content: JSON.stringify({
          query,
          count: matches.length,
          results: matches,
        }),
      }
    },
  }

  const inspectWorkerTool: AgentTool = {
    name: 'inspect_worker',
    description: '检查指定 Worker 的当前产出正文 (chat) 或最近几步过程思考 (tail_mind)。',
    parameters: {
      type: 'object',
      properties: {
        workerId: { type: 'string', description: '目标 Worker ID' },
        mode: {
          type: 'string',
          enum: ['chat', 'tail_mind'],
          description: '检查模式：chat 为面向用户的正文产出（默认），tail_mind 为最后几步过程',
        },
      },
      required: ['workerId'],
    },
    async run(args) {
      const workerId = String(args.workerId || '').trim()
      const mode = args.mode === 'tail_mind' ? 'tail_mind' : 'chat'
      const state = deps.getState()
      const worker = state.workers[workerId]
      if (!worker) {
        return { ok: false, content: `未找到 ID 为 ${workerId} 的 Worker` }
      }

      if (mode === 'chat') {
        return {
          ok: true,
          content: JSON.stringify({
            workerId,
            title: worker.title,
            status: worker.status,
            chatText: worker.chatText || '（暂无正文产出）',
            artifacts: worker.artifacts.map((a) => ({ id: a.id, title: a.title, kind: a.kind })),
          }),
        }
      }

      // tail_mind 模式：提取最近一条 assistant 消息的最近几个 parts
      const lastAssistantMsg = [...worker.messages].reverse().find((m) => m.role === 'assistant')
      const tailParts = lastAssistantMsg ? lastAssistantMsg.parts.slice(-5) : []
      return {
        ok: true,
        content: JSON.stringify({
          workerId,
          title: worker.title,
          status: worker.status,
          tailParts,
        }),
      }
    },
  }

  return [
    spawnWorkerTool,
    steerWorkerTool,
    cancelWorkerTool,
    queryBlackboardTool,
    inspectWorkerTool,
  ]
}
