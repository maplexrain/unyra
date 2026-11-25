/**
 * 群聊与宿主 store 的桥：把群聊流水订阅、按目标过滤、用户发言投递从 AgentSlot 拆出来。
 *
 * 群聊是独立账本（learn/groupChat），role 的私聊 / mind 是另一套会话；这里只负责：
 * - 读群聊流水并按当前目标过滤；
 * - 用户群聊发言时先落群流水，再给被 @ 的 role 各投一条 `channel:'group'` 入站消息；
 * - 没有 @ 时不指定默认 role，而是交给幕后的群消息调度 agent 判断，再投给选中的 role。
 *
 * 放在独立模块是为了让 AgentSlot 保持「读 props → 组织布局」的薄壳，不把通道细节堆回去。
 */
import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { AgentVoice } from '../../../agent/agentProfile'
import type { ChannelMessage, PendingFile, PendingImage } from '../../../agent/types'
import type { LearnStore } from '../../../learn/types'
import { transferPendingFiles, transferPendingImages } from '../../../learn/agent/transfer'
import { ensureRoleConversation } from '../../../learn/roleWork/roles'
import { groupPeer, inboundEnvelope, peerOf, userPeer } from '../../../learn/roleWork/channels'
import { deliverInbound } from '../../../learn/roleWork/dispatch'
import { firstMentionedRoleIdOf, mentionedRoleIdsOf, type MentionRole } from '../../../learn/roleWork/groupTargets'
import { triageGroupMessageWithRetry } from '../../../learn/roleWork/groupTriage'
import { appendGroupMessage, getGroupChatMessages, groupThreadIdOf, patchGroupMessage, subscribeGroupChat, threadRootIdOf } from '../../../learn/groupChat'
import type { GroupChatAgent } from '../../agent/panel/GroupChatPanel'

/** 分类三次重试仍失败时，交给用户手动指定目标。 */
export interface GroupTriageFallback {
  message: ChannelMessage
  agents: GroupChatAgent[]
}

/** 群聊待发送附件（还没落盘；发送那一刻由桥转存进目标资源库） */
export interface GroupSendAttachments {
  images?: PendingImage[]
  files?: PendingFile[]
}

export interface GroupChatBridge {
  /** 当前目标下的群聊消息（从旧到新；一级主楼与评论区回复都在里面，界面自行分层） */
  messages: ChannelMessage[]
  /**
   * 用户群聊发言：@ 指定成员；没有 @ 时交给群消息调度 agent 判断（不默认调度龟）。
   * 传 threadId 时落到该评论串（索引 `通道id>消息id`），回复仍投给被点名/调度选中的成员。
   * 带附件时返回 Promise：先转存图片/文件，再把带引用的消息落账；转存失败会拒绝，
   * 不会退化成一条没有附件的消息。
   * 返回 false = 拒绝发送；返回 true = 消息已落群流水，无 @ 的投递在后台异步完成。
   */
  send: (
    text: string,
    targetIds: GroupChatAgent['id'][],
    threadId?: string,
    attachments?: GroupSendAttachments,
  ) => boolean | Promise<boolean>
  /** 调度自动重试仍失败：由群聊面板弹出选择，用户显式指定接手人 */
  triageFallback: GroupTriageFallback | null
  assignTriageFallback: (agentId: GroupChatAgent['id']) => void
  dismissTriageFallback: () => void
}

export function useGroupChatBridge({
  goalId,
  agents,
  getLatest,
  set,
}: {
  goalId: string | null
  agents: GroupChatAgent[]
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
}): GroupChatBridge {
  const all = useSyncExternalStore(subscribeGroupChat, getGroupChatMessages, getGroupChatMessages)
  const messages = useMemo(
    () => (goalId ? all.filter((m) => m.kind === 'group' && m.goalId === goalId) : []),
    [all, goalId],
  )
  /**
   * 无 @ 消息的调度串行队列：两条消息紧挨着发出时，先让第一条分类完、投递完，
   * 第二条再基于已落账的群聊判断；否则两条分类会同时读到同一份历史并互相插队。
   */
  const triageQueue = useRef<Promise<void>>(Promise.resolve())
  const [triageFallback, setTriageFallback] = useState<GroupTriageFallback | null>(null)
  // 换目标时不要把上一个目标的失败弹窗带过来；消息本身仍留在它自己的群流水里。
  const currentFallback =
    triageFallback && triageFallback.message.goalId === goalId ? triageFallback : null

  /**
   * 把一条已落账的群消息投给某位 role。
   *
   * `activate` 决定这一跳是否真是「激活」：只有唯一目标会起轮，其他 @ 只抄送上下文。
   * 群消息本体不带 `mention` 字段，避免界面把调度器选出的目标伪装成用户 @ 了谁。
   */
  const deliverGroupInbound = (
    message: ChannelMessage,
    target: GroupChatAgent,
    activate: boolean,
  ): void => {
    const targetGoalId = message.goalId
    if (!targetGoalId) return
    const ensured = ensureRoleConversation(getLatest(), target.id as AgentVoice, targetGoalId)
    if (ensured.store !== getLatest()) set(ensured.store)
    const to = peerOf('agent', target.id, target.name)
    const activePeer = activate ? peerOf('agent', target.id, target.name) : undefined
    const mentions = message.mentions ?? []
    const inbound = inboundEnvelope({
      channel: 'group',
      from: message.from,
      to,
      text: message.text,
      id: message.id,
      ts: message.ts,
      ...(message.attachments ? { attachments: message.attachments } : {}),
      ...(mentions.length ? { mentions } : {}),
      ...(activePeer ? { mention: activePeer } : {}),
      goalId: targetGoalId,
      ...(message.threadId && message.threadRootId
        ? { threadId: message.threadId, threadRootId: message.threadRootId }
        : {}),
    })
    deliverInbound(
      {
        conversationId: ensured.conversationId,
        role: target.id as AgentVoice,
        goalId: targetGoalId,
        text: message.text,
        stamp: {
          channel: 'group',
          from: message.from,
          to,
          ts: message.ts,
          envelopeId: message.id,
          goalId: targetGoalId,
          ...(message.threadId && message.threadRootId
            ? { threadId: message.threadId, threadRootId: message.threadRootId }
            : {}),
          ...(activePeer ? { mention: true } : {}),
        },
        envelopeId: message.id,
        ...(message.attachments?.images ? { images: message.attachments.images } : {}),
        ...(message.attachments?.files ? { files: message.attachments.files } : {}),
      },
      inbound,
      { silent: !activate },
    )
  }

  interface SendPlan {
    body: string
    targets: GroupChatAgent['id'][]
    activeId?: GroupChatAgent['id']
    explicitMentions: boolean
    needsTriage: boolean
    threadId?: string
    threadRootId?: string | null
  }

  /**
   * 先把「发得出去吗」判完，再动磁盘。
   *
   * 顺序很重要：@ 写错时不能先把图片转存进资源库——那会留下永远没人引用的孤儿。
   * 所以校验与落账分成两步，附件转存只发生在 plan 已确定之后。
   */
  const buildSendPlan = (
    text: string,
    targetIds: GroupChatAgent['id'][],
    threadId: string | undefined,
    hasAttachments: boolean,
  ): SendPlan | null => {
    const trimmed = text.trim()
    // 群聊 @ 的分隔符就是名字后的空格：末尾的这一个空格不能被 trim 掉。
    const body = trimmed && /[ \u3000]$/.test(text) ? trimmed + ' ' : trimmed
    if ((!body && !hasAttachments) || !goalId) return null
    const threadRootId = threadId ? threadRootIdOf(threadId) : null
    if (threadId && (!threadRootId || threadId !== groupThreadIdOf(goalId, threadRootId))) return null
    /*
     * 和 role 侧同一条纪律：正文里的 `@名字` 比调用方传的 targetIds 更可信。
     * 这样即使 UI / 模型把目标算错，@导师龟 也只会投给导师龟，不会误投设计龟。
     */
    const mentionRoles: MentionRole[] = agents.map((agent) => ({
      id: agent.id,
      names: [agent.name, ...(agent.aliases ?? [])].map((name) => name.trim()).filter(Boolean),
    }))
    const mentionedIds = mentionedRoleIdsOf(body, mentionRoles)
    const explicitMentions = mentionedIds.length > 0
    // 正文里出现 @ 却解析不到任何成员时拒绝，避免误投；正文完全没有 @ 时才进入调度。
    if (!explicitMentions && body.includes('@')) return null
    const targets = [
      ...new Set((explicitMentions ? mentionedIds : targetIds).filter((id) => agents.some((a) => a.id === id))),
    ]
    const activeId = explicitMentions ? firstMentionedRoleIdOf(body, mentionRoles) : targets[0]
    const active = activeId ? agents.find((a) => a.id === activeId) : undefined
    /*
     * 没 @ 且调用方也没给目标 = 这条消息要交给群消息调度 agent；先落群流水，
     * 再异步分类投递。有 @ / 显式目标时仍走同步投递，保持原来的严格 @ 语义。
     */
    const needsTriage = !explicitMentions && targets.length === 0
    if (!needsTriage && !active) return null
    return {
      body,
      targets,
      ...(activeId ? { activeId } : {}),
      explicitMentions,
      needsTriage,
      ...(threadId ? { threadId } : {}),
      ...(threadRootId ? { threadRootId } : {}),
    }
  }

  /** plan 已确定后的落账与投递：正文、@、评论串索引都在这里定形 */
  const commitSend = (
    plan: SendPlan,
    attachments?: ChannelMessage['attachments'],
  ): boolean => {
    if (!goalId) return false
    const from = userPeer()
    const now = Date.now()
    const mentions = plan.explicitMentions
      ? plan.targets.map((id) => {
          const agent = agents.find((a) => a.id === id)!
          return peerOf('agent', id, agent.name)
        })
      : []
    const active = plan.activeId ? agents.find((a) => a.id === plan.activeId) : undefined
    const activePeer = active ? peerOf('agent', active.id, active.name) : undefined
    const hasAttach = Boolean(attachments?.images?.length || attachments?.files?.length)
    const message: ChannelMessage = {
      id: 'g-' + crypto.randomUUID(),
      kind: 'group',
      direction: 'in',
      from,
      to: groupPeer(),
      text: plan.body,
      ts: now,
      ...(hasAttach && attachments ? { attachments } : {}),
      ...(mentions.length ? { mentions } : {}),
      ...(plan.explicitMentions && activePeer ? { mention: activePeer } : {}),
      goalId,
      ...(plan.threadId && plan.threadRootId
        ? { threadId: plan.threadId, threadRootId: plan.threadRootId }
        : {}),
    }
    appendGroupMessage(message)
    // 一级主楼先被评论时补上 threadId（它仍是一级消息，因为 threadRootId 只在评论里出现）。
    if (plan.threadId && plan.threadRootId) patchGroupMessage(plan.threadRootId, { threadId: plan.threadId })

    if (!plan.needsTriage) {
      for (const target of plan.targets.map((id) => agents.find((a) => a.id === id)!)) {
        deliverGroupInbound(message, target, target.id === active?.id)
      }
      return true
    }

    // 当前群成员（不含 free）——职责一句话来自 AgentSlot 传入的 duty。
    const triageAgents = agents
      .filter((agent) => agent.id !== 'free')
      .map((agent) => ({
        id: agent.id as AgentVoice,
        name: agent.name,
        duty: agent.duty?.trim() || agent.name,
      }))
    if (!triageAgents.length) return true
    const triageText = plan.body || '（用户发来了附件）'
    const messageId = message.id
    triageQueue.current = triageQueue.current
      .then(async () => {
        const recent = getGroupChatMessages()
          .filter((m) => m.kind === 'group' && m.goalId === goalId && m.id !== messageId)
          .slice(-10)
        const result = await triageGroupMessageWithRetry({ text: triageText, agents: triageAgents, recent })
        const target = triageAgents.find((agent) => agent.id === result.agentId)
        if (!target) return
        deliverGroupInbound(message, { id: target.id, name: target.name, duty: target.duty }, true)
      })
      .catch((err: unknown) => {
        // 三次重试仍失败：不伪造一条群消息，弹出显式选择让用户指定接手人。
        console.warn('[group-triage] 无 @ 群消息调度失败，等待用户手动指定', err)
        setTriageFallback({ message, agents: triageAgents })
      })
    return true
  }

  /** 发送那一刻才把附件落盘：只存引用进群消息，字节在目标资源库 */
  const saveAttachments = async (
    pending: GroupSendAttachments,
  ): Promise<ChannelMessage['attachments'] | undefined> => {
    if (!goalId) return undefined
    const savedImages = pending.images?.length
      ? await transferPendingImages(getLatest, set, goalId, pending.images)
      : { images: [], error: undefined }
    const savedFiles = pending.files?.length
      ? await transferPendingFiles(
          getLatest,
          set,
          goalId,
          pending.files.filter((f) => !f.image),
        )
      : { files: [], error: undefined }
    /**
     * 转存失败不能静默降级成「一条没有附件的消息」：用户明明选了图，气泡与 role
     * 信封却什么都没有，看起来就像根本没上传。这里直接拒绝发送，让输入区保留附件
     * 与原话，并由 GroupChatPanel 把真实原因显示出来。
     */
    const error = savedImages.error ?? savedFiles.error
    if (error) throw new Error(error)
    const images = savedImages.images
    const files = savedFiles.files
    if (!images.length && !files.length) return undefined
    return {
      ...(images.length ? { images } : {}),
      ...(files.length ? { files } : {}),
    }
  }

  const send = (
    text: string,
    targetIds: GroupChatAgent['id'][],
    threadId?: string,
    pending?: GroupSendAttachments,
  ): boolean | Promise<boolean> => {
    const hasPending = Boolean(pending?.images?.length || pending?.files?.length)
    const plan = buildSendPlan(text, targetIds, threadId, hasPending)
    if (!plan) return false
    if (!hasPending || !pending) return commitSend(plan)
    return (async () => {
      const attachments = await saveAttachments(pending)
      return commitSend(plan, attachments)
    })()
  }

  const assignTriageFallback = (agentId: GroupChatAgent['id']): void => {
    const pending = currentFallback
    if (!pending) return
    const target = pending.agents.find((agent) => agent.id === agentId)
    if (!target) return
    deliverGroupInbound(pending.message, target, true)
    setTriageFallback(null)
  }

  const dismissTriageFallback = (): void => {
    setTriageFallback(null)
  }

  return { messages, send, triageFallback: currentFallback, assignTriageFallback, dismissTriageFallback }
}
