/**
 * TeamBus 多 Agent 协作中枢协调器
 *
 * 核心职责：
 * 1. 批量管理与托管当前目标下的所有专业 Agent（SuperAgentEngine 实例）；
 * 2. 协作频道广播与路由：处理用户在频道的提问，解析 @精准路由 或默认分发 Leader；
 * 3. 跨 Agent 异步委派调度：记录 DelegationRecord，驱动目标 Agent 异步执行，并在终态时自动向发起方静默入队 Mailbox；
 * 4. 彻底物理隔离：各 Agent 的 KV 前缀门禁、存储与 Workers 互不干扰。
 */

import type { ResolvedProvider } from '../../ai/client'
import type { ReasoningEffort, StreamFn } from '../../ai/types'
import type { AgentTool } from '../types'
import { SuperAgentEngine } from '../super/engine'
import type { SuperAgentEvent, SuperAgentState, WorkerReceipt } from '../super/types'
import { DEFAULT_TEAM_PROFILES } from './presets'
import { createTeamHostTools, type TeammateInfo } from './teamTools'
import {
  buildTeamHostSystemPrompt,
  buildTeamWorkerSystemPrompt,
} from '../../learn/superAgent/prompts'
import type {
  ChannelMessage,
  DelegationRecord,
  TeamAgentProfile,
  TeamEvent,
  TeamState,
} from './types'

export interface TeamBusOptions {
  scopeId: string
  profiles?: TeamAgentProfile[]
  provider: ResolvedProvider
  model: string
  effort?: ReasoningEffort
  contextWindow?: number
  chatFn?: StreamFn
  /** 为各 Agent 的 Worker 按权限白名单装配沙箱工具 */
  createWorkerTools?: (agentId: string, workerId: string, allowedGroups: string[]) => AgentTool[]
  initialState?: Partial<TeamState>
  agentInitialStates?: Record<string, Partial<SuperAgentState>>
  onEvent?: (event: TeamEvent) => void
  onStateChange?: (state: TeamState) => void
  onAgentStateChange?: (agentId: string, state: SuperAgentState) => void
  onAgentEvent?: (agentId: string, event: SuperAgentEvent) => void
}

export class TeamBus {
  private scopeId: string
  private options: TeamBusOptions
  private profiles: TeamAgentProfile[]
  private engines = new Map<string, SuperAgentEngine>()
  private state: TeamState

  constructor(options: TeamBusOptions) {
    this.scopeId = options.scopeId
    this.options = options
    this.profiles = options.profiles?.length ? options.profiles : [...DEFAULT_TEAM_PROFILES]

    this.state = {
      scopeId: this.scopeId,
      agents: this.profiles,
      channelMessages: options.initialState?.channelMessages ? [...options.initialState.channelMessages] : [],
      delegations: options.initialState?.delegations ? { ...options.initialState.delegations } : {},
      updatedAt: Date.now(),
    }

    this.initEngines()
  }

  private initEngines(): void {
    for (const profile of this.profiles) {
      const agentId = profile.id
      const engineKey = `${this.scopeId}:${agentId}`

      // 装配 Frontline Host 专属团队协作工具
      const teamTools = createTeamHostTools({
        selfAgentId: agentId,
        selfAgentName: profile.name,
        listTeammates: () => this.listTeammates(agentId),
        delegateToAgent: (params) =>
          this.dispatchDelegation({
            fromAgentId: agentId,
            ...params,
          }),
        postChannelMessage: (content) => {
          this.postChannelAnnouncement(agentId, content)
          return { ok: true, message: '已发布' }
        },
        getActiveDelegation: () => {
          const eng = this.engines.get(agentId)
          return eng?.getActiveDelegation() ?? null
        },
      })

      const hostPrompt = buildTeamHostSystemPrompt(profile, this.profiles, {
        goalTitle: this.scopeId,
      })
      const workerPrompt = buildTeamWorkerSystemPrompt(profile, {
        goalTitle: this.scopeId,
      })

      const engine = new SuperAgentEngine({
        id: engineKey,
        initialState: {
          hostSystemPrompt: hostPrompt,
          ...this.options.agentInitialStates?.[agentId],
        },
        provider: this.options.provider,
        model: this.options.model,
        effort: this.options.effort,
        contextWindow: this.options.contextWindow,
        chatFn: this.options.chatFn,
        extraHostTools: teamTools,
        workerSystemPrompt: workerPrompt,
        onEvent: (event) => {
          this.options.onAgentEvent?.(agentId, event)
        },
        createWorkerTools: (workerId) => {
          if (this.options.createWorkerTools) {
            return this.options.createWorkerTools(agentId, workerId, profile.allowedApiGroups)
          }
          return []
        },
        onStateChange: (agentState) => {
          this.options.onAgentStateChange?.(agentId, agentState)
          this.emit({ type: 'agent-state-changed', agentId, state: agentState })
        },
      })

      this.engines.set(agentId, engine)
    }
  }

  private emit(event: TeamEvent): void {
    this.options.onEvent?.(event)
  }

  private notifyStateChange(): void {
    this.state.updatedAt = Date.now()
    this.options.onStateChange?.(this.state)
  }

  public getScopeId(): string {
    return this.scopeId
  }

  public getProfiles(): TeamAgentProfile[] {
    return this.profiles
  }

  public getTeamState(): TeamState {
    return this.state
  }

  public getAgentEngine(agentId: string): SuperAgentEngine | undefined {
    return this.engines.get(agentId)
  }

  public listTeammates(excludeAgentId?: string): TeammateInfo[] {
    return this.profiles
      .filter((p) => p.id !== excludeAgentId)
      .map((p) => {
        const eng = this.engines.get(p.id)
        const st = eng?.getState()
        const running = st
          ? Object.values(st.workers).filter(
              (w) => w.status === 'running' || w.status === 'waiting_input',
            ).length
          : 0
        return {
          id: p.id,
          name: p.name,
          role: p.role,
          capabilities: p.capabilities,
          runningWorkers: running,
        }
      })
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
    for (const engine of this.engines.values()) {
      engine.updateAiConfig(cfg)
    }
  }

  /**
   * 私聊直通：直接向指定专家的 Host（或指定内部 Worker 快通道）发送消息
   */
  public async sendDirectMessage(
    agentId: string,
    text: string,
    opts?: { targetWorkerId?: string },
  ): Promise<void> {
    const engine = this.engines.get(agentId)
    if (!engine) {
      throw new Error(`未找到指定专家: ${agentId}`)
    }
    await engine.sendUserMessage(text, opts)
  }

  /**
   * 协作频道交互：用户向频道发言
   * 路由规则：
   * 1. 若正文中明确包含 @Agent名称 或 @agentId，分发给这些专家；
   * 2. 若未 @ 任何人，默认路由给 Leader（总导师）。
   */
  public async sendChannelMessage(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return

    // 1. 记录用户频道消息
    const msg: ChannelMessage = {
      id: 'cmsg-' + crypto.randomUUID().slice(0, 8),
      senderId: 'user',
      senderName: '学习者',
      avatar: '👤',
      content: trimmed,
      timestamp: Date.now(),
    }
    this.state.channelMessages.push(msg)
    this.emit({ type: 'channel-message', message: msg })
    this.notifyStateChange()

    // 2. 解析提及的目标 Agent
    const matchedAgents: TeamAgentProfile[] = []
    for (const profile of this.profiles) {
      if (
        trimmed.includes(`@${profile.name}`) ||
        trimmed.includes(`@${profile.id}`) ||
        trimmed.includes(`@${profile.role}`)
      ) {
        matchedAgents.push(profile)
      }
    }

    const targets = matchedAgents.length
      ? matchedAgents
      : [this.profiles.find((p) => p.isLeader) || this.profiles[0]]

    // 3. 并发触发所选专家的 Host，并将专家回复写回协作频道
    await Promise.all(
      targets.map(async (target) => {
        const engine = this.engines.get(target.id)
        if (engine) {
          const reply = await engine.sendUserMessage(trimmed)
          if (reply && reply.trim()) {
            const replyMsg: ChannelMessage = {
              id: 'cmsg-' + crypto.randomUUID().slice(0, 8),
              senderId: target.id,
              senderName: target.name,
              avatar: target.avatar || '🤖',
              color: target.color,
              content: reply.trim(),
              timestamp: Date.now(),
              refAgentId: target.id,
            }
            this.state.channelMessages.push(replyMsg)
            this.emit({ type: 'channel-message', message: replyMsg })
            this.notifyStateChange()
          }
        }
      }),
    )
  }

  /**
   * 专家向协作频道发布公告（不唤醒其他 Agent）
   */
  public postChannelAnnouncement(agentId: string, content: string): void {
    const profile = this.profiles.find((p) => p.id === agentId)
    const msg: ChannelMessage = {
      id: 'cmsg-' + crypto.randomUUID().slice(0, 8),
      senderId: agentId,
      senderName: profile?.name || agentId,
      avatar: profile?.avatar || '🤖',
      color: profile?.color,
      content,
      timestamp: Date.now(),
      isAnnouncement: true,
    }
    this.state.channelMessages.push(msg)
    this.emit({ type: 'channel-message', message: msg })
    this.notifyStateChange()
  }

  /**
   * 派发跨专家协作工单并处理后台全生命周期结算
   */
  private dispatchDelegation(params: {
    fromAgentId: string
    targetAgentId: string
    task: string
    inputRefs?: string[]
    chain: string[]
    hopCount: number
    announceInChannel?: boolean
  }): { ok: boolean; delegationId?: string; message: string } {
    const { fromAgentId, targetAgentId, task, inputRefs, chain, hopCount, announceInChannel } = params

    const targetEngine = this.engines.get(targetAgentId)
    const targetProfile = this.profiles.find((p) => p.id === targetAgentId)
    const fromProfile = this.profiles.find((p) => p.id === fromAgentId)

    if (!targetEngine || !targetProfile) {
      return { ok: false, message: `目标专家 ${targetAgentId} 不存在` }
    }

    const delegationId = 'del-' + crypto.randomUUID().slice(0, 8)
    const fromName = fromProfile?.name || fromAgentId
    const targetName = targetProfile.name

    const record: DelegationRecord = {
      id: delegationId,
      fromAgentId,
      fromAgentName: fromName,
      targetAgentId,
      targetAgentName: targetName,
      task,
      inputRefs,
      chain,
      hopCount,
      status: 'running',
      createdAt: Date.now(),
    }

    this.state.delegations[delegationId] = record
    this.emit({ type: 'delegation-created', record })

    // 若需要在频道同步，广播派单公告
    if (announceInChannel) {
      const channelMsg: ChannelMessage = {
        id: 'cmsg-' + crypto.randomUUID().slice(0, 8),
        senderId: fromAgentId,
        senderName: fromName,
        avatar: fromProfile?.avatar || '🤖',
        color: fromProfile?.color,
        content: `📢 **【跨专家协作派单】** ${fromName} 委派给 **${targetName}** (工单: ${delegationId})：\n${task}`,
        timestamp: Date.now(),
        delegationId,
        isAnnouncement: true,
      }
      this.state.channelMessages.push(channelMsg)
      this.emit({ type: 'channel-message', message: channelMsg })
    }
    this.notifyStateChange()

    // 异步驱动目标 Agent，不阻塞发起方
    void (async () => {
      try {
        const outcome = await targetEngine.runDelegatedTask({
          delegationId,
          fromAgentId,
          fromAgentName: fromName,
          task,
          inputRefs,
          chain,
          hopCount,
          announceInChannel,
        })
        this.settleDelegation(record, outcome)
      } catch (err) {
        this.settleDelegation(record, {
          delegationId,
          status: 'failed',
          summary: err instanceof Error ? err.message : String(err),
          artifactIds: [],
        })
      }
    })()

    return {
      ok: true,
      delegationId,
      message: `已向 ${targetName} 派单`,
    }
  }

  /**
   * 委派终态结算
   */
  private settleDelegation(
    record: DelegationRecord,
    outcome: {
      delegationId: string
      status: 'done' | 'failed' | 'cancelled'
      summary: string
      artifactIds: string[]
      chatText?: string
    },
  ): void {
    record.status = outcome.status
    record.summary = outcome.summary
    record.artifactIds = outcome.artifactIds
    record.settledAt = Date.now()

    this.emit({ type: 'delegation-updated', record })

    // 1. 在协作频道记录精炼交付总结（严格控制在 <=120 字，绝不淹没频道）
    const targetProfile = this.profiles.find((p) => p.id === record.targetAgentId)
    const icon = outcome.status === 'done' ? '✅' : outcome.status === 'cancelled' ? '🚫' : '⚠️'
    const statusText = outcome.status === 'done' ? '完成交付' : outcome.status === 'cancelled' ? '已取消' : '执行失败'

    const briefSummary = outcome.summary && outcome.summary.length > 120
      ? outcome.summary.slice(0, 120) + '...'
      : (outcome.summary || (outcome.status === 'done' ? '任务已顺利完成' : '未能产出有效结果'))

    const deliveryMsg: ChannelMessage = {
      id: 'cmsg-' + crypto.randomUUID().slice(0, 8),
      senderId: record.targetAgentId,
      senderName: record.targetAgentName,
      avatar: targetProfile?.avatar || '🤖',
      color: targetProfile?.color,
      content: `${icon} **【协作工单${statusText}】** ${record.targetAgentName} 交付了来自 ${record.fromAgentName} 的工单 (${record.id})：\n${briefSummary}`,
      briefSummary,
      timestamp: Date.now(),
      delegationId: record.id,
      refAgentId: record.targetAgentId,
      refWorkerId: record.id,
      isAnnouncement: true,
    }
    this.state.channelMessages.push(deliveryMsg)
    this.emit({ type: 'channel-message', message: deliveryMsg })

    // 2. 静默将外部回执压入发起方 Agent 的 Mailbox（绝对不唤醒发起方 LLM）
    const fromEngine = this.engines.get(record.fromAgentId)
    if (fromEngine) {
      const receipt: WorkerReceipt = {
        id: crypto.randomUUID(),
        workerId: record.id,
        delegationId: record.id,
        sourceType: 'agent',
        sourceAgentId: record.targetAgentId,
        sourceAgentName: record.targetAgentName,
        title: `协作任务：${record.task.slice(0, 28)}`,
        status: outcome.status,
        summary: outcome.summary,
        artifactIds: outcome.artifactIds,
        ts: Date.now(),
      }
      fromEngine.pushExternalReceipt(receipt)
    }

    this.notifyStateChange()
  }

  public stopAgent(agentId: string): void {
    const engine = this.engines.get(agentId)
    engine?.stopAll()
  }

  public stopAll(): void {
    for (const engine of this.engines.values()) {
      engine.stopAll()
    }
  }
}
