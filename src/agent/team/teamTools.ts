/**
 * 多 Agent 协作控制面工具 (Team Tools)
 *
 * 挂载于各专业 Agent 的 Frontline Host 上：
 * 1. list_teammates：查看团队成员专长与当前在跑任务；
 * 2. delegate_to_agent：跨 Agent 异步派单，三道硬编码防死循环护栏（禁自委派、路径防环、MAX_HOPS=3）；
 * 3. post_channel_message：协作频道纯公告广播（不唤醒其他 Agent）。
 */

import type { AgentTool } from '../types'
import type { DelegatedTaskInput } from '../super/types'

export const MAX_COLLAB_HOPS = 3

export interface TeammateInfo {
  id: string
  name: string
  role: string
  capabilities: string[]
  runningWorkers: number
}

export interface TeamHostToolsContext {
  selfAgentId: string
  selfAgentName: string
  listTeammates: () => TeammateInfo[]
  delegateToAgent: (params: {
    targetAgentId: string
    task: string
    inputRefs?: string[]
    chain: string[]
    hopCount: number
    announceInChannel?: boolean
  }) => { ok: boolean; delegationId?: string; message: string }
  postChannelMessage: (content: string) => { ok: boolean; message: string }
  getActiveDelegation: () => DelegatedTaskInput | null
}

export function createTeamHostTools(ctx: TeamHostToolsContext): AgentTool[] {
  const listTeammatesTool: AgentTool = {
    name: 'list_teammates',
    description:
      '查看当前目标下的所有专家团队成员及其专长、能力清单与在跑任务数量。在需要协同且不确定该派给谁时调用。',
    parameters: {
      type: 'object',
      properties: {},
    },
    run: async () => {
      const teammates = ctx.listTeammates()
      return {
        ok: true,
        content: JSON.stringify(teammates, null, 2),
      }
    },
  }

  const delegateToAgentTool: AgentTool = {
    name: 'delegate_to_agent',
    description:
      '向团队中的另一位专业专家派发异步协作工单。该调用会立即返回 delegationId，绝不阻塞当前对话。' +
      '目标专家处理完毕后，结果将自动生成回执并在下一次交互时汇报。',
    parameters: {
      type: 'object',
      properties: {
        targetAgentId: {
          type: 'string',
          description:
            '目标专家 ID（如 agent-author 讲义研究员, agent-director 课堂导演, agent-examiner 测评官, agent-lab 实验室工程师）',
        },
        task: {
          type: 'string',
          description: '委托的具体任务目标、范围与交付要求',
        },
        inputRefs: {
          type: 'array',
          items: { type: 'string' },
          description: '可选：需要提供给对方参考的前置产物 ID 清单',
        },
        announceInChannel: {
          type: 'boolean',
          description: '可选：是否在协作频道公开同步这一派单进展（默认 true）',
        },
      },
      required: ['targetAgentId', 'task'],
    },
    run: async (args) => {
      const targetAgentId = String(args.targetAgentId || '').trim()
      const task = String(args.task || '').trim()
      const inputRefs = Array.isArray(args.inputRefs) ? (args.inputRefs as string[]) : []
      const announceInChannel = args.announceInChannel !== false

      if (!targetAgentId || !task) {
        return { ok: false, content: '错误：targetAgentId 与 task 为必填项' }
      }

      // 护栏 1：禁止自委派
      if (targetAgentId === ctx.selfAgentId) {
        return {
          ok: false,
          content: '【安全拦截】禁止向自己委派任务。若需要处理内部繁重任务，请直接使用内部 spawn_worker。',
        }
      }

      // 提取当前活跃的委派链上下文
      const active = ctx.getActiveDelegation()
      const incomingChain = active?.chain?.length
        ? active.chain
        : active?.fromAgentId
          ? [active.fromAgentId]
          : []
      const currentChain = [...incomingChain, ctx.selfAgentId]
      const currentHop = (active?.hopCount ?? 0) + 1

      // 护栏 2：路径防环（A -> B -> A 拦截）
      if (currentChain.includes(targetAgentId)) {
        return {
          ok: false,
          content: `【安全拦截：环路委派】目标专家 (${targetAgentId}) 已存在于当前委派链路 [${currentChain.join(' -> ')}] 中，禁止循环委派。`,
        }
      }

      // 护栏 3：最大跳数上限（MAX_COLLAB_HOPS = 3 拦截）
      if (currentHop > MAX_COLLAB_HOPS) {
        return {
          ok: false,
          content: `【安全拦截：跳数超限】当前协作链路跳数已达 ${currentHop}（上限 ${MAX_COLLAB_HOPS}）。请直接回复或收敛当前任务，不可继续深层委派。`,
        }
      }

      const res = ctx.delegateToAgent({
        targetAgentId,
        task,
        inputRefs,
        chain: currentChain,
        hopCount: currentHop,
        announceInChannel,
      })

      if (!res.ok) {
        return { ok: false, content: `委派失败：${res.message}` }
      }

      return {
        ok: true,
        content: `已成功创建跨专家委派单 (工单ID: ${res.delegationId})，目标专家正在异步处理。你可以向用户总结安排并收口回复。`,
      }
    },
  }

  const postChannelMessageTool: AgentTool = {
    name: 'post_channel_message',
    description:
      '向团队协作频道发布进度公告或阶段总结。注意：该公告仅供人类可见与频道存档，绝不会唤醒其他专家进行链式闲聊。',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '公告或阶段交付正文',
        },
      },
      required: ['content'],
    },
    run: async (args) => {
      const content = String(args.content || '').trim()
      if (!content) {
        return { ok: false, content: '错误：公告内容不可为空' }
      }
      ctx.postChannelMessage(content)
      return { ok: true, content: '已向协作频道发布公告。' }
    },
  }

  return [listTeammatesTool, delegateToAgentTool, postChannelMessageTool]
}
