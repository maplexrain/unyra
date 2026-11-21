/**
 * 智能体团队编排（team.*）这一组 ops 的宿主实现（见 learn/agentTeam/delegations）。
 *
 * 委托的发起方是任意执行声部（导师 / 命题官 / 判卷官 / 资料员——装配了 teamFrom 的
 * 轮都带 team.*；仅聊天没有 execute，收口即自动交付）。承接方也可以是任一声部——
 * 目标会话由宿主派发器在 delegate 时刻解析并钉住（承接声部按发起方所在目标解析，
 * 还没有会话时给确定性 id，首轮启动落库，见 learn/agentTeam/voiceConvs）。
 */

import type { TeamOps } from '../../agent/tools'
import type { AgentOpsDeps } from './deps'
import { AGENT_TEAM_IDS, type AgentProfileId } from '../../agent/agentProfile'
import { agentStatus, armAwake, completeDelegation, createDelegation, listAgents } from '../agentTeam/delegations'

/** awake 的时长上限：自启动是收尾与接续用的，不是定时任务器 */
const AWAKE_MAX_MS = 10 * 60_000

const AGENT_ID_NOTE =
  '先用 team.list() 看可用名单（free=仅聊天 / tutor=导师 / examiner=命题官 / grader=判卷官 / researcher=资料员）。'

export function createTeamOps(deps: Pick<AgentOpsDeps, 'teamFrom'>): TeamOps {
  // teamFrom 由装配层把关（deps.teamFrom 不在就没有 team 这一组，见 assemble）；探针直构造时也总给。
  // 缺省兜一份空身份，只是让 TS 的可选性满足——真打到这里说明装配层漏了闸。
  const from = () =>
    deps.teamFrom?.() ?? { conversationId: '', agent: 'tutor' as AgentProfileId, goalId: '' }

  return {
    list: () => ({
      ok: true,
      agents: listAgents(),
      note: 'id 是 delegate / status 用的身份；每位声部的分工见自己的回执与提示词。',
    }),

    status: (agentId) => {
      const id = String(agentId ?? '').trim().toLowerCase() as AgentProfileId
      if (!AGENT_TEAM_IDS.includes(id)) {
        return { ok: false, error: '没有这位智能体：「' + (agentId || '（空）') + '」。' + AGENT_ID_NOTE }
      }
      return { ok: true, ...agentStatus(id, from().goalId) }
    },

    /**
     * 委托：只排队，**不堵塞**。插入位从队尾往前找——preemptible 窗口内的委托可被
     * 越过（见 delegations 的插队算法）；目标空闲立即启动，忙碌等收口接续。
     */
    delegate: (input) => {
      const rec = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
      const to = String(rec.to ?? '').trim().toLowerCase() as AgentProfileId
      if (!AGENT_TEAM_IDS.includes(to)) {
        return { ok: false, error: 'delegate 需要 to（目标智能体 id：free / tutor / examiner / grader / researcher）。' + AGENT_ID_NOTE }
      }
      const instruction = String(rec.instruction ?? '').trim()
      if (!instruction) {
        return { ok: false, error: 'delegate 需要 instruction（委托指令全文：做什么、边界与产物要求——它是目标那一轮的指令）。' }
      }
      const self = from()
      const nowMs = Date.now()
      let preemptibleUntil = nowMs
      if (typeof rec.preemptibleUntil === 'number' && Number.isFinite(rec.preemptibleUntil)) {
        preemptibleUntil = Math.max(nowMs, rec.preemptibleUntil)
      } else if (typeof rec.preemptibleMs === 'number' && Number.isFinite(rec.preemptibleMs) && rec.preemptibleMs > 0) {
        preemptibleUntil = nowMs + rec.preemptibleMs
      }
      // 承接会话按发起方所在目标解析（承接声部一段工作会话；free 取最近活跃那段）
      const toConversationId = agentStatus(to, self.goalId).conversationId
      if (!toConversationId) {
        return {
          ok: false,
          error:
            '「' + to + '」当前没有可承接的会话（导师还没有激活的学习目标 / 仅聊天还没有会话），稍后再试。',
        }
      }
      // nodeId 可选：活长在某个节点上的委托（判卷、修图）要靠它装配节点级工具
      const nodeId = typeof rec.nodeId === 'string' && rec.nodeId.trim() ? rec.nodeId.trim() : undefined
      const { delegation, position } = createDelegation({
        fromAgent: self.agent,
        fromConversationId: self.conversationId,
        toAgent: to,
        toConversationId,
        goalId: self.goalId,
        ...(nodeId ? { nodeId } : {}),
        instruction,
        preemptibleUntil,
        now: nowMs,
      })
      const selfNote = toConversationId === self.conversationId ? '目标是你自己的会话：它会在你本轮收口后接续。' : ''
      return {
        ok: true,
        id: delegation.id,
        to,
        position,
        queueAhead: position,
        note:
          '已排队（第 ' +
          (position + 1) +
          ' 位），不堵塞当前进程：目标空闲时立即启动，忙碌则收口后接续。' +
          '它做完会用 complete 把交付结果传回你——你空闲时会被激活，运行中在跳边界注入。' +
          '不要轮询等待，继续你自己的工作。' +
          selfNote,
      }
    },

    /** 收口自己承接的委托：交付全文传回委托者（空闲激活 / 运行中跳边界注入） */
    complete: (input) => {
      const rec = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
      const result = String(rec.result ?? '').trim()
      if (!result) {
        return { ok: false, error: 'complete 需要 result（交付全文：结论、产物位置与下一步，写给委托者看）。' }
      }
      const r = completeDelegation({
        id: typeof rec.id === 'string' ? rec.id : undefined,
        result,
        byConversationId: from().conversationId,
      })
      if (!r.ok) return r
      return {
        ok: true,
        id: r.delegation.id,
        delivered: r.delivered,
        note:
          r.delivered === 'injected'
            ? '委托者正在运行：交付结果将在它当前轮的单次 loop 结束后注入，接着继续运行。'
            : '委托者当前空闲：已被激活，将在新一轮里收到交付结果。',
      }
    },

    /** 本轮收口后延迟自启动；期间若有新启动则失效 */
    awake: (input) => {
      let ms: number
      if (typeof input === 'number' && Number.isFinite(input)) {
        ms = input
      } else if (input && typeof input === 'object') {
        const rec = input as Record<string, unknown>
        if (typeof rec.seconds === 'number' && Number.isFinite(rec.seconds)) ms = rec.seconds * 1000
        else if (typeof rec.ms === 'number' && Number.isFinite(rec.ms)) ms = rec.ms
        else return { ok: false, error: 'awake 需要 ms 或 { seconds }。' }
      } else {
        return { ok: false, error: 'awake 需要 ms 或 { seconds }。' }
      }
      if (!(ms > 0)) return { ok: false, error: 'awake 的等待时长必须大于 0。' }
      const capped = Math.min(ms, AWAKE_MAX_MS)
      const { fireAt } = armAwake(from().conversationId, capped, Date.now())
      return {
        ok: true,
        fireAt,
        note:
          '已布防：本轮收口后约 ' +
          Math.round(capped / 1000) +
          ' 秒自启动（上限 10 分钟）。计时从本轮收口才开始；期间若有过新启动（用户发消息、委托交付激活）则当场失效。',
      }
    },
  }
}
