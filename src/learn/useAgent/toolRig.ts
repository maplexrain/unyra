/**
 * useAgent 一轮的**工具装配**（从 useAgent.ts 原样搬出）：这一轮唯一的工具（execute）
 * 在这里拿到它的全部能力——沙箱基座（learnSandboxOps）、工作流排队（wf.invoke）、
 * work 管理器、MCP 外部服务、人机协作表单（ask）与权限审批、考试、记忆、等待、提醒、
 * 界面操作（ui.*）、内置浏览器（browser.*），以及交付（delivery）的登记。
 *
 * 装配只在轮首做一次：本函数返回这一轮的中止器、工具数组、交付账与全局模型解析，
 * 轮次循环（streamLoop）与收口（turnClose）从返回值里取。
 */

import type { Dispatch, SetStateAction } from 'react'
import { createExecuteTools, type AskFormPayload, type ExamToolDeps } from '../../agent/tools'
import { ASK_BUBBLE_TTL_MS } from '../../agent/sandbox/limits'
import { type AiSettings, globalContextWindow } from '../../ai/settings'
import { agentRuntimeApiAllow, agentWfGrant, profileOf, resolveAgentGlobal, type AgentVoice } from '../../agent/agentProfile'
import { applyAskToProfile, learnSandboxOps, type AgentRunTarget, type AgentUiDeps } from '../agent/sandboxOps'
import { makeMcpOps } from '../../agent/mcp/ops'
import { makePermissionOps } from '../../agent/permissions'
import { createMemoryOps } from '../memory'
import { makeExamTool } from '../agentOps'
import { saveScreenshot } from '../screenshots'
import { makeBrowserOps, type BrowserDeps } from '../web/browserOps'
import type { WorkManager } from '../../agent/work/manager'
import { createChatOps } from '../ops/chat'
import { resolveChatAttachments } from '../roleWork/attachments'
import { agentNameOf, AGENT_ROLE_IDS, DEFAULT_AGENT_NAME, type AgentProfileId } from '../../agent/agentProfile'
import { isAgentRoleId } from '../../agent/roleWork/types'
import type { ChannelAskStatus, ChannelMessage, ConversationMessage } from '../../agent/types'
import { ensureRoleConversation, roleConversationsOfGoal } from '../roleWork/roles'
import { registerAskTimer } from '../roleWork/askTimers'
import { groupPeer, inboundEnvelope, outboundEnvelope, peerOf, userPeer } from '../roleWork/channels'
import { deliverInbound } from '../roleWork/dispatch'
import { groupSelfMentionError, hasMentionOf, mentionedRoleIdsOf, mentionsUserInGroup, type MentionRole } from '../roleWork/groupTargets'
import { appendGroupMessage, patchGroupMessage } from '../groupChat'
import { planGroupThread } from '../roleWork/groupThread'
import { emptyDelivery, mergeDelivery, normalizeDelivery } from '../../agent/delivery'
import { native } from '../../lib/native'
import { nodeById } from '../graph'
import { nodePathOf, resolveNode } from '../paths'
import type { LearnStore } from '../types'
import type { AgentSettings } from '../../agent/settings'

/**
 * wf.invoke 允许连着的触发次数（见 pendingWfRef 那一段）。
 *
 * 链本身是合法的编排：开讲 → 出卷 → 阅卷，一条跟着一条走。要防的是**无限的链**——
 * 一条指令里写着「做完再触发它自己」的工作流，会一轮接一轮地烧下去，而每一轮都要真花钱。
 * 三次之后再调就当场拒掉，并把话说给模型听（它该收尾了，而不是再排一条）。
 */
const MAX_WF_CHAIN = 3

/**
 * 装配这一轮的工具（与沙箱基座、ask 表单通道、交付账）。返回：
 * - ctrl：本轮的中止器（ask / wait 的中止语义需要它，停止按钮也从这里摘）；
 * - tools：交给 runAgent 的工具数组（唯一的 execute 工具）；
 * - turnDelivery：本轮的交付账（文件变动 / 参考引证，收口时挂到消息上）；
 * - global / window：全局提供商 / 模型 / 档位与上下文窗口（work 与 runAgent 都要用）。
 */
export function rigTurnTools(io: {
  getLatest: () => LearnStore
  set: (store: LearnStore) => void
  target: AgentRunTarget
  /** 本轮现取的全局 AI 设置快照（runTurnUnchecked 在轮首读的那份） */
  settings: AiSettings
  /** 本轮现取的 agent 设置快照（assembleTurnEntry 读的那份；MCP 配置从这儿来） */
  agentSettings: AgentSettings
  /**
   * 本轮工作流的启动实参（runWorkflow 的 params）。考试工具拿它钉住阅卷对象：
   * 交卷触发的阅卷轮带着 examId / attemptId——判分进行中学习者又交了另一份卷子时，
   * 「最新待判」已经换了人，不钉住就会把 B 卷的分数判到 A 卷的对话里（见 makeExamDeps）。
   */
  wfParams?: Record<string, string | number>
  /** 考试工具依赖；由工作区注入，按节点与阶段动态提供 */
  examDeps?: (nodeId: string, wfParams?: Record<string, string | number>) => ExamToolDeps | undefined
  /**
   * 节点编辑成功后的宿主动作（出卷后的视觉自检等）：由界面层注入，
   * learnSandboxOps 会把它接到节点通道的 afterEdit 上。
   */
  afterNodeEdit?: (uuid: string, kind: string) => void
  /** ui 依赖现取最新的一份（见 hook 里 uiRef 的说明） */
  uiRef: { current: AgentUiDeps | undefined }
  /** browser 依赖工厂现取最新的一份（webMeta 活信息随渲染变，与 uiRef 同款说明） */
  browserFnRef: { current: (() => BrowserDeps | undefined) | undefined }
  wfChainRef: { current: Map<string, number> }
  pendingWfRef: { current: Map<string, Array<{ id: string; params?: Record<string, string | number> }>> }
  askWaitersRef: { current: Map<string, (value: unknown) => void> }
  setPendingAsk: Dispatch<SetStateAction<Record<string, { id: string; form: AskFormPayload }>>>
  /** 转存失败之类的话要能说出来（ui.toast 缺席时的回落通道，见 hook 里 onNoticeRef 的说明） */
  onNoticeRef: { current: ((message: string) => void) | undefined }
  /**
   * 这一轮由哪位 role 来说话：决定模型覆盖（按 role 的 profile）、
   * api 能力面（agentRuntimeApiAllow）、工作流面（agentWfGrant）与 chat.work 的身份。
   * 缺省 = 导师（老调用方零改动）。
   */
  voice?: AgentVoice
  /** 当前 role 对话的 work 管理器（一段对话一个、跨轮存活） */
  workManager: WorkManager
}) {
  const { getLatest, set, target, settings, agentSettings, wfParams, examDeps, afterNodeEdit, uiRef, browserFnRef, wfChainRef, pendingWfRef, askWaitersRef, setPendingAsk, onNoticeRef, workManager } = io
  const voice = io.voice ?? 'tutor'
  /** MCP / 权限放行仍是导师层的机制（其它 role 的分工面里没有这两组） */
  const isTutor = voice === 'tutor'
  /**
   * 唯一的工具：模型写一段 JS，经由沙箱里的 api 完成读写。
   * 文档、节点、描述、试卷、临时变量、长期记忆、人机协作（ask / tiktok）
   * 与界面操作（ui.*）的全部能力都从这里进出（见 agent/tools）。
   */
  const ctrl = new AbortController()
  const signal = ctrl.signal
  // 动态提示词注入的 moduleQueue 已退役（2026-11 全量静态提示词：规程随系统提示词
  // 首轮在场，工作流触发的模块在轮首注入——见 hook 的 runTurnUnchecked）。
  // ui 依赖现取最新的一份（见 uiRef 的说明）
  const uiDeps = uiRef.current
  // browser 依赖现取最新的一份（webMeta 活信息随渲染变，与 uiRef 同款说明）
  const browserDeps = browserFnRef.current?.()
  /**
   * 全局提供商 / 模型 / 思考等级：所有 AI 功能的共同基底。提前到这里，
   * 因为 work 要跑在宿主同一轮的模型与档位上（见 work/manager 的说明）。
   * 叠加本 role 的独立设置（agent/agentProfile）：提供商-模型与档位覆盖，
   * 没配就逐字回落全局默认（resolveAgentGlobal 的缺省语义）。
   */
  const global = resolveAgentGlobal(settings, profileOf(agentSettings, voice))
  const window = globalContextWindow(settings)
  /**
   * 沙箱基座：一轮 role 对话与它派出的 work 共用同一套能力（learnSandboxOps 的产物）。
   * execute 的能力面按 role 分工走（agentRuntimeApiAllow 的运行时清单 + 提示词速查同源）；
   * work 按 WORK_API_PLANES 取子集（见 work/manager）。
   * workflowGrant 是本 role 的工作流授权面（内置规程面由分工固定；登记条目只有导师可调）。
   */
  const sandboxBase = learnSandboxOps({
    getLatest,
    set,
    // 这一轮冲着来的节点是沙箱里的「当前节点」——不是界面上此刻选中的那个
    nodeId: () => target.nodeId,
    goalId: () => target.goalId,
    workflowGrant: agentWfGrant(agentSettings, voice),
    apiAllow: agentRuntimeApiAllow(voice),
    ...(afterNodeEdit ? { afterNodeEdit } : {}),
    /**
     * wf.invoke 的落点（见 WorkflowOps.invoke）：**只排队，不当场跑**。
     * 这一轮还在跑，工作流的指令要作为一条新的 user 消息进上下文，只能等收口（见下面 finally）。
     *
     * 两条克制：一次编排最多排一条（工作流是独占一轮的流程，排两条等于让模型自己编排两轮
     * 对话）；同一条不重复排（它在同一轮里被调两次，意图只有一个）。上限见 MAX_WF_CHAIN。
     */
    invokeWorkflow: (id, wfOpts) => {
      const depth = wfChainRef.current.get(target.conversationId) ?? 0
      if (depth >= MAX_WF_CHAIN) {
        return {
          error:
            '这条链上已经连着触发了 ' + MAX_WF_CHAIN + ' 条工作流，不能再排了。请就此打住：' +
            '把已经做完的事、看到的结论与下一步交给用户。',
        }
      }
      const q = pendingWfRef.current.get(target.conversationId) ?? []
      if (q.some((x) => x.id === id)) return { ok: true }
      if (q.length) {
        return {
          error:
            '这一轮已经排了一条工作流（它本轮收口后就跑）。不要一次交两件活——' +
            '真要连着做，就把第二件写进你这一轮的收尾，让用户决定。',
        }
      }
      q.push({ id, ...(wfOpts.params ? { params: wfOpts.params } : {}) })
      pendingWfRef.current.set(target.conversationId, q)
      return { ok: true }
    },
  })
  /*
   * work 的 ask 要用**它自己的 run 信号**，不能用 role 本轮的中止器：
   * role 轮早结束了，work 还在跑。回调本体在下面 askHost 定义之后装填。
   */
  const workAskRef: { current: ((workId: string, form: AskFormPayload, signal: AbortSignal) => Promise<unknown>) | null } = { current: null }
  /*
   * work 管理器：喂给这一轮的模型与沙箱基座；它启动的 work 用启动那一刻的配置跑完
   * （换轮不漂移）。role 侧通过 work.* 管理多个 work，每个 work 的上下文独立。
   */
  workManager.setTurn({
    sandbox: sandboxBase,
    provider: global.provider,
    model: global.model,
    // 档位全应用唯一（全局滑条）：work 与它的 role 同档，绝不各自翻面（见 learn/effortGuard）
    effort: global.effort,
    contextWindow: window,
    ask: (workId, form, signal) =>
      workAskRef.current?.(workId, form, signal) ??
      Promise.resolve({ ok: false, content: '当前宿主没有接上 work 的 ask 通道。' }),
  })
  sandboxBase.work = workManager.api
  const roleName = agentNameOf(profileOf(agentSettings, voice as AgentProfileId), voice as AgentProfileId)
  const appendChannel = (convId: string, envelope: ChannelMessage): void => {
    const cur = getLatest().conversations.find((c) => c.id === convId)
    if (!cur) return
    const conversations = getLatest().conversations.map((c) =>
      c.id === convId ? { ...c, channels: [...(c.channels ?? []), envelope].slice(-200), updatedAt: Date.now() } : c,
    )
    set({ ...getLatest(), conversations })
  }
  /*
   * 找/建 role 会话只走 roleWork/roles 的同一套判据：`Conversation.voice` 与确定性 id
   * 都要认（见 roleOfConversation）。这里曾经手写 `c.voice ?? 'tutor'`，把
   * `cv:designer:*` 这类漏标 voice 的旧会话当成了导师会话；群聊 @导师龟 时若设计龟
   * 那段最近更新，就会把邮件投进设计龟的 mind，界面上却还显示导师龟。
   */
  const ensureRole = (role: AgentProfileId, goalId: string): string => {
    const store = getLatest()
    const ensured = ensureRoleConversation(store, role as AgentVoice, goalId)
    if (ensured.store !== store) set(ensured.store)
    return ensured.conversationId
  }
  const resolveRole = (role: AgentProfileId, goalId?: string | null): string | null => {
    if (!goalId) return null
    return roleConversationsOfGoal(getLatest(), goalId, role)[0]?.id ?? null
  }
  const roleNameOf = (role: AgentProfileId): string => agentNameOf(profileOf(agentSettings, role), role)
  sandboxBase.chat = createChatOps({
    roleId: voice as AgentProfileId,
    roleName,
    conversationId: target.conversationId,
    ...(target.goalId ? { goalId: target.goalId } : {}),
    getConversation: (id) => getLatest().conversations.find((c) => c.id === id) ?? null,
    appendChannel,
    userPeer: () => userPeer(),
    resolveRoleConversation: (role, goalId) => resolveRole(role, goalId),
    ensureRoleConversation: (role, goalId) => ensureRole(role, goalId),
    roleNameOf,
    messageOf: (messageId): ConversationMessage | null =>
      getLatest().conversations.find((c) => c.id === target.conversationId)?.messages.find((m) => m.id === messageId) ?? null,
    deliveryOf: (messageId) => {
      const conv = getLatest().conversations.find((c) => c.id === target.conversationId)
      // 先找 role 会话消息（work 交付唤醒后的那条 user 消息带 delivery），
      // 再找通道流水（work / agent 信封本身就带 delivery，不必等它进 messages）。
      const fromMessage = conv?.messages.find((m) => m.id === messageId)?.delivery
      if (fromMessage) return fromMessage
      return conv?.channels?.find((m) => m.id === messageId)?.delivery
    },
    resolveAttachments: (items) =>
      resolveChatAttachments(items, {
        getLatest,
        set,
        ...(target.goalId ? { goalId: target.goalId } : {}),
      }),
    sendToWork: async (name, text, messageId, attachments) => {
      const r = await workManager.api.send({
        name,
        text,
        ...(messageId ? { messageId } : {}),
        ...(attachments?.images?.length ? { images: attachments.images } : {}),
        ...(attachments?.files?.length ? { files: attachments.files } : {}),
      })
      return { ok: r.ok, channel: 'work', to: name, ...(r.error ? { error: r.error } : {}) }
    },
    sendToGroup: async ({ text, detail, mentions, mention, messageId, attachments, extra, delivery, silent }) => {
      const goalId = target.goalId
      if (!goalId) return { ok: false, error: '当前 role 会话不挂在目标上，无法进入群聊' }
      const mentionRoles: MentionRole[] = AGENT_ROLE_IDS.filter((id) => id !== 'free').map((id) => ({
        id,
        names: [roleNameOf(id), DEFAULT_AGENT_NAME[id]],
      }))
      /*
       * 正文里的 `@名字` 是群聊投递的唯一真源：模型传的 mentions 只作补充。
       * 所有 @ 都只是「把这句话抄进对方上下文」，不激活任何 loop。
       * 唯一会起轮的是 `mention`（一条消息最多一个）。
       */
      const textIds = mentionedRoleIdsOf(text, mentionRoles)
      const mentionsUser = mentionsUserInGroup(text, userPeer().name)
      const selfMentionError = groupSelfMentionError(textIds, voice, roleNameOf(voice))
      if (selfMentionError) return { ok: false, error: selfMentionError }
      let ids: AgentProfileId[] = textIds
      if (!ids.length) {
        const rawIds = [...new Set((mentions ?? []).map((id) => id.trim()).filter(Boolean))]
        // 正文只 @用户：这是给用户看的结论，即使模型误填了 to / mentions 也不投递给任何 role。
        if (!(mentionsUser && !textIds.length)) {
          if (rawIds.length) {
            ids = rawIds
              .map((raw) => {
                if (isAgentRoleId(raw)) return raw as AgentProfileId
                return AGENT_ROLE_IDS.find(
                  (id) => id !== 'free' && (roleNameOf(id) === raw || DEFAULT_AGENT_NAME[id] === raw),
                )
              })
              .filter((id): id is AgentProfileId => Boolean(id))
            if (ids.length !== rawIds.length) return { ok: false, error: '群聊 @ 的目标 role id / 名字不合法' }
            const rawSelfError = groupSelfMentionError(ids, voice, roleNameOf(voice))
            if (rawSelfError) return { ok: false, error: rawSelfError }
            for (const id of ids) {
              if (!hasMentionOf(text, [roleNameOf(id), DEFAULT_AGENT_NAME[id]])) {
                return { ok: false, error: `群聊消息要投给 ${roleNameOf(id)}，正文必须显式写 \`@${roleNameOf(id)} \`（名字后留一个空格）` }
              }
            }
          } else if (text.includes('@')) {
            // 写了 @ 却一个成员都没解析出来：不能悄悄退回默认调度，否则会把话投错。
            return { ok: false, error: '群聊正文里的 @ 没有匹配到任何成员；请检查名字，并在 `@名字 ` 后留一个空格' }
          }
        }
      }
      /*
       * mention：唯一会启动目标一轮的那个人。它必须在正文里被 @；@ 可以有很多个，mention 只能有一个。
       * ChatOps 把旧 `to` 兼容成 mention；用户消息则由群聊桥把首个 @ 解析成 mention。
       */
      const rawMention = mention?.trim()
      let mentionId: AgentProfileId | undefined
      if (rawMention) {
        mentionId = isAgentRoleId(rawMention)
          ? (rawMention as AgentProfileId)
          : AGENT_ROLE_IDS.find((id) => id !== 'free' && (roleNameOf(id) === rawMention || DEFAULT_AGENT_NAME[id] === rawMention))
        if (!mentionId) return { ok: false, error: 'mention 的目标 role id / 名字不合法' }
        if (mentionId === voice) {
          return { ok: false, error: `群聊里不能 mention 自己（${roleNameOf(voice)}）；mention 只能给对方` }
        }
        if (!ids.includes(mentionId)) {
          return { ok: false, error: `mention 的 ${roleNameOf(mentionId)} 必须同时出现在正文 \`@${roleNameOf(mentionId)} \` 里` }
        }
      }
      if (silent && mentionId) {
        return { ok: false, error: 'silent 静默汇报不能带 mention：它只入上下文，不激活目标' }
      }
      const from = peerOf('agent', voice, roleName)
      // 正文没有 @ 时不再默认投给调度龟：agent 的群聊发言可以只是说给群里听。
      const mentionPeers = ids.map((id) => peerOf('agent', id, roleNameOf(id)))
      const activePeer = mentionId ? mentionPeers.find((p) => p.id === mentionId) : undefined
      /*
       * 评论串路由（纯函数 planGroupThread）：
       * - 只有真正会激活某位 role 的 mention 才开 / 续任务串；纯抄送的 @ 不拉人开会；
       * - 最终 @用户 的汇报、以及 ask 气泡留在一级群聊。
       */
      const conv = getLatest().conversations.find((c) => c.id === target.conversationId)
      const latestGroupMsg = [...(conv?.channels ?? [])].reverse().find((m) => m.kind === 'group')
      const groupMsgId = 'g-' + crypto.randomUUID()
      const threadPlan = planGroupThread({
        goalId,
        messageId: groupMsgId,
        latestThreadId: latestGroupMsg?.threadId,
        mentionsUser,
        targetIds: mentionId ? [mentionId] : [],
      })
      const threadId = threadPlan.threadId
      const threadRootId = threadPlan.threadRootId
      const groupMsg = outboundEnvelope({
        channel: 'group',
        from,
        to: groupPeer(),
        id: groupMsgId,
        text,
        ...(detail ? { detail } : {}),
        ...(messageId ? { quoteMessageId: messageId } : {}),
        ...(attachments ? { attachments } : {}),
        ...(mentionPeers.length ? { mentions: mentionPeers } : {}),
        ...(activePeer ? { mention: activePeer } : {}),
        ...(delivery ? { delivery } : {}),
        ...(extra ? { extra } : {}),
        goalId,
        ...(threadId ? { threadId } : {}),
        ...(threadRootId ? { threadRootId } : {}),
        ...(silent ? { silent: true } : {}),
      })
      appendGroupMessage(groupMsg)
      // 自己这一侧的 mind 也留一条出站流水（群聊层另开，不混进私聊）
      appendChannel(target.conversationId, groupMsg)
      for (const id of ids) {
        if (id === voice) continue
        const targetConvId = resolveRole(id, goalId) ?? ensureRole(id, goalId)
        const toPeer = peerOf('agent', id, roleNameOf(id))
        const inbound = inboundEnvelope({
          channel: 'group',
          from,
          to: toPeer,
          text,
          id: groupMsg.id,
          ts: groupMsg.ts,
          ...(detail ? { detail } : {}),
          ...(attachments ? { attachments } : {}),
          ...(extra ? { extra } : {}),
          ...(delivery ? { delivery } : {}),
          mentions: mentionPeers,
          ...(activePeer && activePeer.id === id ? { mention: activePeer } : {}),
          goalId,
          ...(threadId ? { threadId } : {}),
          ...(threadRootId ? { threadRootId } : {}),
          ...(silent ? { silent: true } : {}),
        })
        deliverInbound(
          {
            conversationId: targetConvId,
            role: id,
            goalId,
            text,
            stamp: {
              channel: 'group',
              from,
              to: toPeer,
              ts: groupMsg.ts,
              envelopeId: groupMsg.id,
              goalId,
              ...(threadId ? { threadId } : {}),
              ...(threadRootId ? { threadRootId } : {}),
              ...(id === mentionId ? { mention: true } : {}),
              ...(delivery ? { delivery } : {}),
            },
            envelopeId: groupMsg.id,
            ...(delivery ? { delivery } : {}),
            ...(attachments?.images ? { images: attachments.images } : {}),
            ...(attachments?.files ? { files: attachments.files } : {}),
          },
          inbound,
          // 只有唯一的 mention 起轮；其余 @ 一律只注入上下文。
          { silent: silent || id !== mentionId },
        )
      }
      return {
        ok: true,
        channel: 'group',
        id: groupMsg.id,
        ...(ids.length ? { to: ids.join(',') } : {}),
        ...(mentionId ? { mention: mentionId } : {}),
      }
    },
  })
  /*
   * MCP 外部服务挂进沙箱（mcp.list / mcp.discover / mcp.call，见 agent/mcp/ops）。
   * 配置是这一轮现取的快照：用户改了 MCP 设置，下一轮就生效；
   * 总开关关着时不注入——与旧做法「关闭时不注入任何 MCP 工具」同一口径。
   * 其它 role 分工面里没有 mcp 组，也不给它们起外部连接。
   */
  if (isTutor) {
    const mcpOps = makeMcpOps(agentSettings.mcp)
    if (mcpOps) sandboxBase.mcp = mcpOps
  }

  /**
   * ask 气泡：宿主要把一次问询做成**通道消息**，而不是只压在输入框上方。
   *
   * - role 层的 ask 用 role 自己的本轮信号；
   * - work 的 ask 用 work 自己 run 的信号（role 轮早已结束，不能拿旧 ctrl 当命）；
   * - 气泡落在该 role 最近一条外部入站的通道：group 就进群聊流水，否则进 user 私聊。
   *   这样 work 不需要 role “感知”，界面仍然看到当前 role 的身份在问。
   */
  const askInChannel = (
    form: AskFormPayload,
    askSignal: AbortSignal,
    opts: { pending: boolean },
  ): Promise<unknown> =>
    new Promise<unknown>((resolve) => {
      const askId = crypto.randomUUID()
      const expiresAt = Date.now() + ASK_BUBBLE_TTL_MS
      const conv = getLatest().conversations.find((c) => c.id === target.conversationId)
      const lastInbound = [...(conv?.channels ?? [])]
        .reverse()
        .find((m) => m.direction === 'in' && m.kind !== 'work')
      const channel = lastInbound?.kind === 'group' ? 'group' : 'user'
      /*
       * ask 永远落一级群聊，不放进评论区；但若当前任务本身在评论串里，气泡带上 threadId
       * （不填 threadRootId），后续 agent 回复仍能沿这条串继续，不会因为一次问询就断线。
       */
      const askThreadId =
        channel === 'group'
          ? [...(conv?.channels ?? [])].reverse().find((m) => m.kind === 'group')?.threadId
          : undefined
      const from = peerOf('agent', voice, roleName)
      const to = channel === 'group' ? groupPeer() : userPeer()
      const askMessage = outboundEnvelope({
        channel,
        from,
        to,
        text: form.title || '需要你确认一下',
        ...(target.goalId && channel === 'group' ? { goalId: target.goalId } : {}),
        ...(askThreadId ? { threadId: askThreadId } : {}),
        ask: { id: askId, form, expiresAt, status: 'pending' },
      })
      appendChannel(target.conversationId, askMessage)
      if (channel === 'group') appendGroupMessage(askMessage)

      let timer: ReturnType<typeof setTimeout> | null = null
      let waiter: (value: unknown) => void = () => {}
      /** 到期计时器的有效截止时间；悬停暂停时用它算剩余 */
      let deadline = expiresAt
      let paused = false
      let unregister: () => void = () => {}
      const statusOf = (value: unknown): ChannelAskStatus => {
        if (value && typeof value === 'object') {
          const rec = value as { ok?: boolean; cancelled?: boolean; timedOut?: boolean }
          if (rec.timedOut) return 'expired'
          if (rec.cancelled) return 'cancelled'
          if (rec.ok) return 'answered'
        }
        return 'cancelled'
      }
      const settle = (status: ChannelAskStatus, value: unknown): void => {
        if (askWaitersRef.current.get(askId) !== waiter) return
        askWaitersRef.current.delete(askId)
        askSignal.removeEventListener('abort', onAbort)
        if (timer) clearTimeout(timer)
        timer = null
        unregister()
        setPendingAsk((prev) => {
          if (prev[target.conversationId]?.id !== askId) return prev
          const next = { ...prev }
          delete next[target.conversationId]
          return next
        })
        // 状态写回气泡：提交 / 取消 / 超时后表单失效，倒计时也停。
        // 截止时间可能已被悬停暂停改写过，取当前落盘的那一份，而不是最初的 askMessage。
        const state = getLatest()
        const cur = state.conversations.find((c) => c.id === target.conversationId)
        const currentAsk = cur?.channels?.find((m) => m.id === askMessage.id)?.ask ?? askMessage.ask!
        const settled = {
          ...currentAsk,
          status,
          settledAt: Date.now(),
        }
        if (cur) {
          const conversations = state.conversations.map((c) =>
            c.id === target.conversationId
              ? {
                  ...c,
                  channels: (c.channels ?? []).map((m) => (m.id === askMessage.id ? { ...m, ask: settled } : m)),
                  updatedAt: Date.now(),
                }
              : c,
          )
          set({ ...state, conversations })
        }
        if (channel === 'group') patchGroupMessage(askMessage.id, { ask: settled })
        void applyAskToProfile(form, value).then(resolve, () => resolve(value))
      }
      /** 悬停暂停会延长有效期：把新的截止时间同时写回会话流水与群聊，刷新后仍是同一份剩余。 */
      const writeAskExpiry = (expiresAt: number): void => {
        const state = getLatest()
        const cur = state.conversations.find((c) => c.id === target.conversationId)
        const currentAsk = cur?.channels?.find((m) => m.id === askMessage.id)?.ask
        if (!cur || !currentAsk) return
        const nextAsk = { ...currentAsk, expiresAt }
        const conversations = state.conversations.map((c) =>
          c.id === target.conversationId
            ? {
                ...c,
                channels: (c.channels ?? []).map((m) => (m.id === askMessage.id ? { ...m, ask: nextAsk } : m)),
                updatedAt: Date.now(),
              }
            : c,
        )
        set({ ...state, conversations })
        if (channel === 'group') patchGroupMessage(askMessage.id, { ask: nextAsk })
      }
      waiter = (value: unknown): void => settle(statusOf(value), value)
      const onAbort = () =>
        settle('cancelled', { ok: false, content: '用户停止了这一轮，表单已关闭。不要假设用户的回答。' })
      const expire = () => {
        timer = null
        settle('expired', {
          ok: false,
          timedOut: true,
          content: '表单已到时自动失效。不要假设用户的回答。',
        })
      }
      const arm = (ms: number) => {
        deadline = Date.now() + ms
        timer = setTimeout(expire, ms)
      }
      /*
       * 悬停暂停：鼠标停在气泡上时界面会冻结自己的进度条，这里同步停掉宿主
       * 的 setTimeout，并把剩余时长留住；移出后按同一份剩余重新起算。
       * 只停「当前这一张」ask，别的 ask 不受影响。
       */
      unregister = registerAskTimer(askId, {
        pause: () => {
          if (paused || !timer) return
          clearTimeout(timer)
          timer = null
          paused = true
          deadline = Math.max(0, deadline - Date.now())
          writeAskExpiry(Date.now() + deadline)
        },
        resume: () => {
          if (!paused) return
          paused = false
          arm(deadline)
          writeAskExpiry(deadline)
        },
      })
      if (askSignal.aborted) {
        askWaitersRef.current.set(askId, waiter)
        onAbort()
        return
      }
      askSignal.addEventListener('abort', onAbort, { once: true })
      askWaitersRef.current.set(askId, waiter)
      if (opts.pending) {
        setPendingAsk((prev) => ({ ...prev, [target.conversationId]: { id: askId, form } }))
      }
      /*
       * 硬时限：**从挂出那一刻起算**，不随鼠标键盘续期（用户要的是可预期，
       * 而不是「动一下就一直挂着」）。到期只收自己的 waiter，并带回 timedOut。
       * 唯一例外是鼠标悬停在气泡上——用户正在填表，暂停计时（见上面的 pause/resume）。
       */
      arm(Math.max(0, expiresAt - Date.now()))
    })

  /** role 自己的 ask（以及审批）走这条；work 在下面单独接上自己的信号。 */
  const askHost = (form: AskFormPayload): Promise<unknown> =>
    askInChannel(form, signal, { pending: true })
  workAskRef.current = (_workId, form, workSignal) =>
    askInChannel(form, workSignal, { pending: false })
  /*
    这一轮的交付账（文件变动 / 参考引证）。用局部变量而不是 state：它是这一轮的副作用，
    不该触发渲染；收口时挂到消息上，组件自然就出来了（见 agent/delivery）。
  */
  const turnDelivery = emptyDelivery()
  const tools = createExecuteTools({
    ...sandboxBase,
      /*
       * 交付登记：只收结构化数据。正文里不用再复述文件清单与参考来源——
       * 界面在消息底部按「一行一条」统一展示（见 DeliveryBlock）。
       */
      delivery: {
        submit: (input) => {
          const rec = normalizeDelivery(input)
          if (!rec) {
            return {
              ok: false,
              files: 0,
              sources: 0,
              error:
                '至少要给 files 或 sources 里的一项：files: [{ path, action?: created|updated|deleted, note? }]，sources: [{ title, url }]（只收 http/https）',
            }
          }
          if (target.goalId) {
            const st = getLatest()
            for (const f of rec.files) {
              if (!f.goalId) f.goalId = target.goalId
              if (!f.nodeId) {
                // 课堂节点（不在 nodes 里）：uuid / #uuid / 「课堂/标题」都认——不然生成
                // 课堂的工作流没有任何合法 path 可填，交付账上永远缺席
                const classroom = (st.classrooms ?? []).find(
                  (cl) => cl.id === f.path || (f.path.startsWith('#') && cl.id === f.path.slice(1)) || f.path === '课堂/' + cl.title,
                )
                if (classroom) {
                  f.nodeId = classroom.id
                  f.path = '课堂/' + classroom.title
                  continue
                }
                const byId = st.nodes.find((n) => n.id === f.path || (f.path.startsWith('#') && n.id === f.path.slice(1)))
                if (byId) {
                  f.nodeId = byId.id
                  continue
                }
                const res = resolveNode(st, { goalId: target.goalId, currentNodeId: target.nodeId ?? null }, f.path)
                if (res.ok) {
                  f.nodeId = res.value.id
                  continue
                }
                const cleanPath = f.path.replace(/\.md$/i, '').trim()
                if (cleanPath !== f.path) {
                  const resClean = resolveNode(st, { goalId: target.goalId, currentNodeId: target.nodeId ?? null }, cleanPath)
                  if (resClean.ok) {
                    f.nodeId = resClean.value.id
                    continue
                  }
                }
                // 兼容 .node.json 磁盘路径或文件名匹配
                const diskMatch = st.nodes.find((n) => {
                  if (n.goalId !== target.goalId) return false
                  const base = n.title
                  return f.path.endsWith(`/${base}.node.json`) || f.path.endsWith(`/${base}.teaching.md`) || f.path === `${base}.node.json` || f.path === `${base}.teaching.md`
                })
                if (diskMatch) {
                  f.nodeId = diskMatch.id
                  continue
                }
                if (target.nodeId) {
                  const targetNode = nodeById(st, target.nodeId)
                  if (targetNode && (cleanPath === targetNode.title || cleanPath === targetNode.id)) {
                    f.nodeId = targetNode.id
                  }
                }
              }
              if (f.nodeId) {
                const matchedNode = nodeById(st, f.nodeId)
                if (matchedNode && (f.path.endsWith('.node.json') || f.path === f.nodeId || f.path === '#' + f.nodeId)) {
                  f.path = nodePathOf(st, target.goalId, f.nodeId) || matchedNode.title
                }
              }
            }
          }
          mergeDelivery(turnDelivery, rec)
          return { ok: true, files: turnDelivery.files.length, sources: turnDelivery.sources.length }
        },
      },
      /*
       * 考试工具：作用对象是这一轮冲着来的那个节点（target.nodeId），
       * 不是「此刻界面上选中的那个」——一轮可能跑好几十秒，期间用户切了节点
       * 也不该把阅卷对象换掉。
       *
       * 「读永远成功、写才看阶段」的翻译全在 learn/agentOps 的 makeExamTool 里
       * （纯装配，Node 探针钉得住）。
       */
      exam: (() => {
        const deps = target.nodeId ? examDeps?.(target.nodeId, wfParams) : undefined
        return deps ? makeExamTool(deps) : undefined
      })(),
      // 动态提示词注入的触发口已退役（onPromptModule 不再传入，execute 的嗅探也随之拆除）
      // 用户点「停止」时，正在等用户的 ask 与正在睡的 wait 要能立刻退场
      signal,
      /** 记忆：长期跨目标、工作按目标；绝不自动拼进上下文，agent 需要时主动读写 */
      memory: createMemoryOps({ getLatest, set, goalId: () => target.goalId }),
      wait: (ms) =>
        new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => {
            cleanup()
            resolve()
          }, ms)
          const onAbort = () => {
            cleanup()
            reject(new Error('等待被用户中止'))
          }
          const cleanup = () => {
            clearTimeout(t)
            signal.removeEventListener('abort', onAbort)
          }
          signal.addEventListener('abort', onAbort, { once: true })
        }),
      ask: askHost,
      // 路径放行（导师专用）：审批复用 askHost 那条管线，批准由宿主直接落配置
      ...(isTutor ? { permission: makePermissionOps({ ask: askHost }) } : {}),
      tiktok: async () => {
        // Electron 的 beep：响一声即返回；不在 Electron 里跑时静默跳过
        try {
          native().window.beep()
        } catch {
          // 测试环境没有 native 桥：tiktok 本来就是「尽力提醒」
        }
      },
      ui: {
        ...(uiDeps?.point ? { point: uiDeps.point } : {}),
        ...(uiDeps?.scroll ? { scroll: uiDeps.scroll } : {}),
        ...(uiDeps?.domRoot ? { domRoot: uiDeps.domRoot } : {}),
        ...(uiDeps?.openSuper ? { openSuper: uiDeps.openSuper } : {}),
        // 界面没给 toast 就退回对话栏自己那句提示：都是「说一句话」
        toast: (message) => {
          if (uiDeps?.toast) uiDeps.toast(message)
          else onNoticeRef.current?.(message)
        },
        ...(uiDeps?.captureDoc
          ? {
              capture: async () => {
                const cap = await uiDeps.captureDoc!()
                if (!cap.ok) return { ok: false as const, error: cap.error }
                const saved = await saveScreenshot(getLatest, set, target.goalId, cap.dataUrl)
                if (!saved.ok) return { ok: false as const, error: saved.error }
                return {
                  ok: true as const,
                  path: saved.image.rel,
                  uuid: saved.image.id,
                  note:
                    `截图已保存为文件 "${saved.image.rel}"（可通过 api.files.read 读取），并已注入视觉上下文。`,
                  images: [saved.image],
                }
              },
            }
          : {}),
      },
      // 内置浏览器（browser.*）：宿主依赖在场的回合才有这一组（见 learn/web/browserOps）
      ...(browserDeps ? { browser: makeBrowserOps(browserDeps, target.goalId) } : {}),
    })
  return { ctrl, tools, turnDelivery, global, window }
}
