/**
 * useAgent **自由聊天的一轮**（从 useAgent.ts 原样搬出，原 sendFree 的轮次主体）：
 * agent 栏最左那枚固定页签——**没有系统提示词、没有工具、没有人格与提示词模块**，
 * 就是一段裸对话；沙箱只开放 web / fetch / schedule 三组。
 *
 * 会话存 learn/freeChat（users/{uid}/free-chat.json），不在 store.conversations 里——
 * 那里的每一段都挂在目标上、写进 {目标}/chat.json，自由聊天没有目标可挂。
 * 流式骨架（streaming/running/tps 的分槽记账、中止器）与导师轮共用同一套（见 slots），
 * 所以页签的运行点、停止键、状态条都不必知道「这是不是自由聊天」。
 */

import type { Dispatch, SetStateAction } from 'react'
import type { AgentPart, MessageFile, MessageImage, PendingFile, PendingImage } from '../../agent/types'
import type { MessageUsage } from '../../agent/types'
import { runAgent } from '../../agent/runtime'
import { createExecuteTools } from '../../agent/tools'
import type { SandboxOptions } from '../../agent/sandbox/types'
import { loadAgentSettings } from '../../agent/settings'
import { FREE_AGENT_GROUPS, FREE_AGENT_TOP_LEVEL, profileOf, resolveAgentGlobal } from '../../agent/agentProfile'
import { globalContextWindow, loadAiSettings } from '../../ai/settings'
import { applyEvent } from '../agent/events'
import { toChatHistory } from '../agent/history'
import { loadAttachTexts } from '../agent/transfer'
import { upsertAssistantInFlight } from '../agent/inflight'
import { loadImagesFor } from '../images'
import {
  transferFreePendingFiles,
  transferFreePendingImages,
} from '../agent/transfer'
import { fetchForAgent, searchForAgent } from '../webSearch'
import { createScheduleOps } from '../schedule'
import { FREE_GOAL_ID, appendFreeMessage, freeConversationById, mutateFreeConversation } from '../freeChat'
import { buildFreeChatSystem } from '../ai'
import { generateConversationTitle, namingSource } from '../title'
import { t } from '../../i18n'
import type { LearnStore } from '../types'
import type { StreamingSlot } from './slots'
import type { WorkManager } from '../../agent/work/manager'
import type { ChatCallResult, ChatSendInput } from '../../agent/roleWork/types'
import { isAgentRoleId } from '../../agent/roleWork/types'
import { channelTextOf, inboundEnvelope, outboundEnvelope, peerOf, userPeer } from '../roleWork/channels'
import { deliverInbound, takeChannelInjection } from '../roleWork/dispatch'
import { roleOfConversation } from '../roleWork/roles'
import { resolveChatAttachments } from '../roleWork/attachments'
import type { ChannelStamp } from '../../agent/types'

/**
 * 跑自由聊天的一轮（原 sendFree 的轮次主体）。调用方（hook 的 sendFree）已做好
 * 守卫与轮次串行化（turnChain 领票），收口后的队列派发也在调用方的 finally 里；
 * 这里从转存附件开始，到起名为止。
 */
export async function runFreeTurn(io: {
  conversationId: string
  trimmed: string
  /** 不带图片的文件附件（sendFree 已按 image 拆好两路） */
  docFiles: PendingFile[]
  imageFiles: PendingImage[]
  onNoticeRef: { current: ((message: string) => void) | undefined }
  /** 起名在途标记（与导师对话的 nameConversation 共用同一纪律） */
  namingRef: { current: Set<string> }
  /** 学习 store 的读写（日程 ops 写的是用户级表，装配时与导师轮同一对函数） */
  getLatest: () => LearnStore
  set: (store: LearnStore) => void
  setStreaming: Dispatch<SetStateAction<Record<string, StreamingSlot>>>
  setRunning: Dispatch<SetStateAction<Record<string, true>>>
  setTps: Dispatch<SetStateAction<Record<string, number>>>
  setLiveUsage: Dispatch<SetStateAction<Record<string, MessageUsage>>>
  abortMapRef: { current: Map<string, AbortController> }
  /** 自由对话的 work 管理器（hook 跨轮持有；账本住 free-chat.json） */
  workManager?: WorkManager
  /**
   * Work 通道交付（role 空闲时由宿主直接起这一轮）：不是用户发言，不写 user 通道，
   * 只把交付作为带 Work 来源戳的 user 侧消息进入历史。
   */
  delivery?: { text: string; stamp: ChannelStamp; envelopeId: string }
}) {
  const { conversationId, trimmed, docFiles, imageFiles, onNoticeRef, namingRef, getLatest, set, setStreaming, setRunning, setTps, setLiveUsage, abortMapRef, workManager, delivery } = io
  // 转存图片与文件附件至 free/static
  const [attachedImages, attachedFiles] = await Promise.all([
    imageFiles.length ? transferFreePendingImages(imageFiles) : Promise.resolve({ images: [] as MessageImage[], error: undefined }),
    docFiles.length ? transferFreePendingFiles(docFiles) : Promise.resolve({ files: [] as MessageFile[], error: undefined }),
  ])
  if (attachedImages.error) onNoticeRef.current?.(attachedImages.error)
  if (attachedFiles.error) onNoticeRef.current?.(attachedFiles.error)

  const userEnvelope = delivery
    ? null
    : inboundEnvelope({
        channel: 'user',
        from: userPeer(),
        to: peerOf('agent', 'free', 'free'),
        text: trimmed || '[附件]',
      })
  appendFreeMessage(conversationId, {
    id: crypto.randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text: delivery?.text ?? trimmed }],
    channel: delivery
      ? delivery.stamp
      : {
          channel: 'user',
          from: userEnvelope!.from,
          to: userEnvelope!.to,
          ts: userEnvelope!.ts,
          envelopeId: userEnvelope!.id,
        },
    ...(!delivery && attachedImages.images.length ? { images: attachedImages.images } : {}),
    ...(!delivery && attachedFiles.files.length ? { files: attachedFiles.files } : {}),
    ts: Date.now(),
  })
  if (userEnvelope) {
    mutateFreeConversation(conversationId, (c) => ({
      ...c,
      channels: [...(c.channels ?? []), userEnvelope].slice(-200),
      updatedAt: Date.now(),
    }))
  }
  const stored = freeConversationById(conversationId)
  if (!stored) return
  const settings = loadAiSettings()
  const agentSettings = loadAgentSettings()
  // 自由聊天的系统提示词同样固化进会话（见 Conversation.systemPrompt）：系统提示词变动时自动同步最新规范。
  // 能力面由架构固定（内置组不可卸载），提示词恒定——没有随 profile 变化的字段。
  const desiredFreeSystem = buildFreeChatSystem({
    extraSystemPrompt:
      agentSettings.extraSystemPromptEnabled && agentSettings.extraSystemPrompt?.trim()
        ? agentSettings.extraSystemPrompt.trim()
        : undefined,
  })
  let freeSystem = stored.systemPrompt
  if (!freeSystem || freeSystem !== desiredFreeSystem) {
    freeSystem = desiredFreeSystem
    mutateFreeConversation(conversationId, (c) => ({ ...c, systemPrompt: freeSystem }))
  }
  // 仅聊天声部的独立设置（agent/agentProfile）：提供商-模型与档位覆盖，缺省逐字回落全局
  const global = resolveAgentGlobal(settings, profileOf(agentSettings, 'free'))
  const window = globalContextWindow(settings)
  const assistantId = crypto.randomUUID()
  const convKey = conversationId
  const parts: AgentPart[] = []
  setStreaming((prev2) => ({ ...prev2, [convKey]: { conversationId: convKey, messageId: assistantId, parts: [] } }))
  setRunning((prev2) => (prev2[convKey] ? prev2 : { ...prev2, [convKey]: true }))
  const ctrl = new AbortController()
  abortMapRef.current.set(convKey, ctrl)

  /*
   * 聊天沙箱只开放 web / fetch / schedule（apiAllow），文档与节点两组永远到不了——
   * 但 buildApi 无条件装配它们，所以要给一份占位。用 Proxy 而不是手写方法表：
   * 接口再加方法也不会漂（早先手写的那份就已经和真实接口对不上了）。
   */
  const unreachableOps = <T extends object>(label: string): T =>
    new Proxy({} as T, {
      get: () => () => {
        throw new Error('自由聊天沙箱没有' + label + '能力')
      },
    })

  const appendChannel = (envelope: ReturnType<typeof outboundEnvelope>): void => {
    mutateFreeConversation(conversationId, (c) => ({
      ...c,
      channels: [...(c.channels ?? []), envelope].slice(-200),
      updatedAt: Date.now(),
    }))
  }

  let sentToUser = false
  const chatSend = async (input: ChatSendInput): Promise<ChatCallResult> => {
    const text = input.text.trim()
    if (!text) return { ok: false, channel: input.channel, error: 'chat.send 需要 text' }
    if (input.silent && input.channel !== 'agent') {
      return { ok: false, channel: input.channel, error: '自由对话的 silent 只支持 agent 通道' }
    }
    const resolved = input.attachments?.length
      ? await resolveChatAttachments(input.attachments, { getLatest, set })
      : undefined
    if (resolved && 'error' in resolved) return { ok: false, channel: input.channel, error: resolved.error }
    const attachments = resolved && !('error' in resolved) ? {
      ...(resolved.images?.length ? { images: resolved.images } : {}),
      ...(resolved.files?.length ? { files: resolved.files } : {}),
    } : undefined
    if (input.channel === 'user') {
      sentToUser = true
      appendChannel(
        outboundEnvelope({
          channel: 'user',
          from: peerOf('agent', 'free', 'free'),
          to: userPeer(),
          text,
          ...(attachments && (attachments.images || attachments.files) ? { attachments } : {}),
        }),
      )
      return { ok: true, channel: 'user' }
    }
    if (input.channel === 'work') {
      if (!input.to) return { ok: false, channel: 'work', error: 'work 通道需要 to（work 名）' }
      if (!workManager) return { ok: false, channel: 'work', error: '当前没有可用的 work 管理器' }
      const to = peerOf('work', input.to, input.to)
      const stamp = { channel: 'agent' as const, from: peerOf('agent', 'free', 'free'), to, ts: Date.now(), envelopeId: crypto.randomUUID() }
      const r = await workManager.api.send({
        name: input.to,
        text: channelTextOf(stamp, text),
        ...(attachments?.images?.length ? { images: attachments.images } : {}),
        ...(attachments?.files?.length ? { files: attachments.files } : {}),
      })
      return r.ok ? { ok: true, channel: 'work', to: input.to } : { ok: false, channel: 'work', to: input.to, error: r.error ?? '发送失败' }
    }
    // agent 通道：自由页签没有目标上下文，只能在现有 store 会话里找一位 role 的最近会话
    if (!input.to) return { ok: false, channel: 'agent', error: 'agent 通道需要 to（role id）' }
    if (input.to === 'free') return { ok: false, channel: 'agent', error: '不能给自己发 agent 通道消息' }
    if (!isAgentRoleId(input.to)) return { ok: false, channel: 'agent', error: '不认识的 role：' + input.to }
    const target = [...getLatest().conversations]
      .filter((c) => c.goalId !== FREE_GOAL_ID && roleOfConversation(c) === input.to)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
    if (!target) return { ok: false, channel: 'agent', error: '找不到 ' + input.to + ' 的会话；请到对应任务页签再协作' }
    const from = peerOf('agent', 'free', 'free')
    const to = peerOf('agent', input.to, input.to)
    const own = outboundEnvelope({
      channel: 'agent',
      from,
      to,
      text,
      ...(attachments && (attachments.images || attachments.files) ? { attachments } : {}),
    })
    appendChannel(own)
    const envelope = inboundEnvelope({
      channel: 'agent',
      from,
      to,
      text,
      ...(attachments && (attachments.images || attachments.files) ? { attachments } : {}),
      ...(input.silent ? { silent: true } : {}),
    })
    deliverInbound(
      {
        conversationId: target.id,
        role: input.to,
        text,
        stamp: { channel: 'agent', from, to, ts: envelope.ts, envelopeId: envelope.id },
        envelopeId: envelope.id,
        ...(input.messageId ? { mark: 'Agent 来信' } : {}),
        ...(attachments?.images ? { images: attachments.images } : {}),
        ...(attachments?.files ? { files: attachments.files } : {}),
      },
      envelope,
      { silent: input.silent },
    )
    return { ok: true, channel: 'agent', to: input.to }
  }

  // work 的基座：自由对话派出的 work 仍要联网与排日程；role 自己的沙箱不暴露这两组
  const freeWorkBase: SandboxOptions = {
    nodeId: () => null,
    resolveNode: () => ({ ok: false, message: '自由聊天不挂在知识节点上' }),
    resolveDoc: () => ({ ok: false, message: '自由聊天不挂载教学文档上' }),
    docOps: unreachableOps<SandboxOptions['docOps']>('文档'),
    nodes: { service: () => null },
    web: {
      fetch: fetchForAgent,
      search: searchForAgent,
    },
    /*
     * 日程：自由对话派出的 work 也要排日程（需求明确）。它写的是**用户级**的那张表
     * （state.json 的 schedule），与自由聊天没有目标这件事不冲突——goalId 只是
     * 日程上的一个可选标记，这里给 FREE_GOAL_ID，界面按「自由聊天」显示。
     */
    schedule: createScheduleOps({ getLatest, set, goalId: () => FREE_GOAL_ID }),
    ...(workManager
      ? {
          work: workManager.api,
          chat: { send: chatSend },
        }
      : {}),
  }
  const freeSandbox: SandboxOptions = {
    ...freeWorkBase,
    // role 层单会话：联网 / 日程不在 role 面，调用会被 apiAllow 拒绝；这里连实现都不注入
    web: undefined,
    schedule: undefined,
    // role 的固定面：tmp / work / chat + compact
    apiAllow: [...FREE_AGENT_GROUPS, ...FREE_AGENT_TOP_LEVEL],
    apiBrief:
      'api.work.list() / api.work.create({ name? }) / api.work.status(name)：管理自己的 work；\n' +
      'api.work.send({ name, text })：把任务交给 work，调用立即返回；\n' +
      'api.chat.send({ channel: \'user\'|\'agent\'|\'work\', to?, text })：对外发消息。\n' +
      '联网检索、网页抓取、日程读写都只在 work 面：需要就 create/send 一个 work。',
    signal: ctrl.signal,
  }
  if (workManager) {
    workManager.setTurn({
      sandbox: freeWorkBase,
      provider: global.provider,
      model: global.model,
      ...(global.effort ? { effort: global.effort } : {}),
      contextWindow: window,
    })
  }
  const tools = createExecuteTools(freeSandbox)

  const tally = { turns: 0, context: 0, total: 0, output: 0, read: 0, miss: 0, tps: 0, estimated: false }

  // 读取整段历史中的图片与附件文本，忠实还原给模型
  const [imagesMap, attachTexts] = await Promise.all([
    loadImagesFor(stored.messages),
    loadAttachTexts(stored.messages),
  ])

  try {
    await runAgent({
      provider: global.provider,
      model: global.model,
      reasoningEffort: global.effort,
      system: freeSystem,
      messages: toChatHistory(stored.messages, imagesMap, { files: attachTexts }),
      tools,
      ctx: { nodeId: '', goalId: FREE_GOAL_ID },
      signal: ctrl.signal,
      injections: async () => {
        const next = takeChannelInjection(convKey)
        if (!next) return null
        parts.push({ type: 'channel-message', channelId: next.envelopeId, text: next.text })
        mutateFreeConversation(convKey, (c) =>
          upsertAssistantInFlight(c, { id: assistantId, role: 'assistant', parts: [...parts], ts: Date.now() }),
        )
        setStreaming((prev2) => ({
          ...prev2,
          [convKey]: { conversationId: convKey, messageId: assistantId, parts: [...parts] },
        }))
        return { role: 'user', content: next.text }
      },
      onEvent: (e) => {
        if (e.type === 'usage') {
          tally.turns++
          tally.context = e.usage.input
          tally.total += e.usage.input
          tally.output += e.usage.output
          tally.read += e.usage.cacheRead
          tally.miss += Math.max(0, e.usage.input - e.usage.cacheRead)
          tally.estimated = tally.estimated || e.usage.estimated === true
          if (e.usage.tps) {
            tally.tps = e.usage.tps
            setTps((prev) => ({ ...prev, [convKey]: e.usage.tps as number }))
          }
          setLiveUsage((prev) => ({
            ...prev,
            [convKey]: {
              contextTokens: tally.context,
              contextWindow: window,
              totalTokens: tally.total,
              outputTokens: tally.output,
              cacheReadTokens: tally.read,
              cacheMissTokens: tally.miss,
              estimated: tally.estimated,
              ...(tally.tps ? { tps: tally.tps } : {}),
            },
          }))
        } else if (e.type === 'pace') {
          setTps((prev) => ({ ...prev, [convKey]: e.tps }))
        }
        applyEvent(parts, e)
        setStreaming((prev2) => ({
          ...prev2,
          [convKey]: { conversationId: convKey, messageId: assistantId, parts: [...parts] },
        }))
      },
    })

    const cur = freeConversationById(convKey)
    if (cur && parts.length) {
      mutateFreeConversation(convKey, (c) =>
        upsertAssistantInFlight(
          c,
          {
            id: assistantId,
            role: 'assistant',
            parts: [...parts],
            ...(tally.turns
              ? {
                  usage: {
                    contextTokens: tally.context,
                    contextWindow: window,
                    totalTokens: tally.total,
                    outputTokens: tally.output,
                    cacheReadTokens: tally.read,
                    cacheMissTokens: tally.miss,
                    estimated: tally.estimated,
                    ...(tally.tps ? { tps: tally.tps } : {}),
                  },
                }
              : {}),
            ts: Date.now(),
          },
          true,
        ),
      )
    }

    // 自由对话的最终正文就是用户看到的聊天回复，这里补一条 user 通道镜像供 chat 层渲染；
    // role 的 mind 正文不同：不自动外发、不转发到群聊，所有对外内容必须显式 chat.send。
    const answer = parts
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('')
      .trim()
    if (answer && !sentToUser) {
      appendChannel(
        outboundEnvelope({
          channel: 'user',
          from: peerOf('agent', 'free', 'free'),
          to: userPeer(),
          text: answer,
          auto: true,
        }),
      )
    }
  } catch (err: unknown) {
    // 中断与出错都把已有的半截话收口——与 runTurn 的收口同一条规矩
    const cur = freeConversationById(convKey)
    if (cur && parts.length) {
      mutateFreeConversation(convKey, (c) =>
        upsertAssistantInFlight(c, { id: assistantId, role: 'assistant', parts: [...parts], ts: Date.now() }, true),
      )
    }
    if ((err as Error)?.name !== 'AbortError') {
      console.warn('[freeChat] 一轮失败：', err)
      onNoticeRef.current?.(t('这一轮没有跑完：{0}', (err as Error)?.message ?? String(err)))
    }
  } finally {
    if (abortMapRef.current.get(convKey) === ctrl) abortMapRef.current.delete(convKey)
    setRunning((prev2) => {
      if (!prev2[convKey]) return prev2
      const next = { ...prev2 }
      delete next[convKey]
      return next
    })
    setStreaming((prev2) => {
      if (!(convKey in prev2)) return prev2
      const next = { ...prev2 }
      delete next[convKey]
      return next
    })
  }
  // 第一句话进来给这段对话起名（与导师对话同一套起名器，只是不挂目标问题）
  const after = freeConversationById(convKey)
  if (after && !after.title && !namingRef.current.has(convKey)) {
    const source = namingSource(after, '')
    if (source) {
      namingRef.current.add(convKey)
      void generateConversationTitle({ text: source })
        .then((title) => {
          mutateFreeConversation(convKey, (c) => (c.title ? c : { ...c, title }))
        })
        .catch((err2: unknown) => console.warn('[freeChat] 起名失败', err2))
        .finally(() => namingRef.current.delete(convKey))
    }
  }
}
