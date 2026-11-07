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
import { createExecuteTool } from '../../agent/tools'
import type { SandboxOptions } from '../../agent/sandbox/types'
import { loadAgentSettings } from '../../agent/settings'
import { globalContextWindow, loadAiSettings, resolveGlobal } from '../../ai/settings'
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
}) {
  const { conversationId, trimmed, docFiles, imageFiles, onNoticeRef, namingRef, getLatest, set, setStreaming, setRunning, setTps, setLiveUsage, abortMapRef } = io
  // 转存图片与文件附件至 free/static
  const [attachedImages, attachedFiles] = await Promise.all([
    imageFiles.length ? transferFreePendingImages(imageFiles) : Promise.resolve({ images: [] as MessageImage[], error: undefined }),
    docFiles.length ? transferFreePendingFiles(docFiles) : Promise.resolve({ files: [] as MessageFile[], error: undefined }),
  ])
  if (attachedImages.error) onNoticeRef.current?.(attachedImages.error)
  if (attachedFiles.error) onNoticeRef.current?.(attachedFiles.error)

  appendFreeMessage(conversationId, {
    id: crypto.randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text: trimmed }],
    ...(attachedImages.images.length ? { images: attachedImages.images } : {}),
    ...(attachedFiles.files.length ? { files: attachedFiles.files } : {}),
    ts: Date.now(),
  })
  const stored = freeConversationById(conversationId)
  if (!stored) return
  const settings = loadAiSettings()
  const agentSettings = loadAgentSettings()
  // 自由聊天的系统提示词同样固化进会话（见 Conversation.systemPrompt）：系统提示词变动时自动同步最新规范
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
  const global = resolveGlobal(settings)
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
  const freeSandbox: SandboxOptions = {
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
     * 日程：聊天 agent 也排得了日程（需求明确）。它写的是**用户级**的那张表
     * （state.json 的 schedule），与自由聊天没有目标这件事不冲突——goalId 只是
     * 日程上的一个可选标记，这里给 FREE_GOAL_ID，界面按「自由聊天」显示。
     */
    schedule: createScheduleOps({ getLatest, set, goalId: () => FREE_GOAL_ID }),
    apiAllow: ['web', 'fetch', 'schedule'],
    apiBrief:
      'DeepSeek 官方搜索与抓取服务：\n' +
      'api.web.search({ query, count?: 5, ori_question?, need_content? })：网络搜索并获取多维度权威检索结果；\n' +
      "api.fetch({ url: 'https://...' }) 或 api.fetch('https://...')：抓取网页正文并转为 Markdown 格式；\n" +
      'api.web.fetch({ url })：抓取网页正文（api.fetch 别名）；\n' +
      'api.schedule.list({ days? }) / api.schedule.create({ title, date?, time, minutes?, remindBefore? })：' +
      '看用户的日程、给他排一条提醒（到点由宿主响铃，用户自己确认或稍后提醒）。',
    signal: ctrl.signal,
  }
  const tools = [createExecuteTool(freeSandbox)]

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
