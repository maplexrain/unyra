/**
 * useAgent 导师轮的**流式循环**（从 useAgent.ts 原样搬出）：一次 runAgent 调用——
 * 「思考 → 工具 → 观察 → 再思考」跑到收口为止。这里负责：
 * - 发请求前对一遍前缀账（assertPrefixStable + contextDebug 记账）；
 * - 每跳 usage 进 token 账（tally），实时速度与实时占用写回各自的会话槽；
 * - **缓存哨兵**：同一会话的前缀逐字节只增，命中骤降当场定格进对比调试器；
 * - 流式片段进 parts 并更新 streaming 槽，里程碑事件触发立即落库（scheduleFlush）。
 *
 * 收口（落库、清槽、工作流出队、压缩应用）不在这里——那是 turnClose 的事。
 */

import type { Dispatch, SetStateAction } from 'react'
import { runAgent, type AgentInjection } from '../../agent/runtime'
import type { resolveGlobal } from '../../ai/settings'
import { captureDrop, lastDropReport, noteRequest } from '../../agent/contextDebug'
import { assertPrefixStable, currentEpoch, lastCacheRead, noteCacheRead } from '../../agent/prefixGate'
import type { AgentPart, Conversation, MessageUsage } from '../../agent/types'
import type { AgentRunTarget } from '../agent/sandboxOps'
import { applyEvent } from '../agent/events'
import { toChatHistory } from '../agent/history'
import { loadImagesById, loadImagesFor } from '../images'
import { loadAttachTexts } from '../agent/transfer'
import type { StreamingSlot } from './slots'

/** 这一轮的 token 账（导师轮与自由聊天共用同一份 shape）：各跳 usage 的累计与最后一跳的即时速度 */
export interface AgentTurnTally {
  context: number
  total: number
  output: number
  read: number
  miss: number
  estimated: boolean
  turns: number
  tps: number
}

/**
 * 跑一轮导师对话的模型循环（runAgent）。调用方已把历史、工具、槽位初始化好；
 * 这个函数只负责「发请求 → 收事件 → 记账 → 更新流式槽」，直到这一轮自然收口
 * 或被中止（中止以异常的形式抛出，收口落库由调用方的 finally 接手）。
 */
export async function runTurnLoop(io: {
  global: ReturnType<typeof resolveGlobal>
  /** 上下文窗口大小：实时占用圆环与收口账都要它 */
  window: number
  /** 系统提示词（对话里固化的那份，见 assembleTurnEntry） */
  teacherSystem: string
  history: Conversation
  tools: Parameters<typeof runAgent>[0]['tools']
  ctrl: AbortController
  parts: AgentPart[]
  tally: AgentTurnTally
  convKey: string
  target: AgentRunTarget
  assistantId: string
  setStreaming: Dispatch<SetStateAction<Record<string, StreamingSlot>>>
  setTps: Dispatch<SetStateAction<Record<string, number>>>
  setLiveUsage: Dispatch<SetStateAction<Record<string, MessageUsage>>>
  scheduleFlush: (immediate: boolean) => void
}) {
  const { global, window, teacherSystem, history, tools, ctrl, parts, tally, convKey, target, assistantId, setStreaming, setTps, setLiveUsage, scheduleFlush } = io
  await runAgent({
    provider: global.provider,
    model: global.model,
    // 工作流轮的档位由触发方按三态配置解析好传进来；聊天轮用全局滑条
    reasoningEffort: global.effort,
    /**
     * 系统提示词用**对话里固化的那份**（见上面的固化逻辑）：只描述目标、不含当前
     * 节点，切节点一字不变（前缀缓存不被整段作废）；节点背景不再随消息注入，
     * 模型需要时自己 api.node.list / 节点对象 content 现查。固化之后，这段对话
     * 生命周期内的 system 段逐字节稳定——设置中途改动也不会把进行中的对话前缀打断。
     */
    system: teacherSystem,
    /**
     * 历史里的图片要先读回内存：落盘的只有一条引用（见 agent/types 的 MessageImage），
     * 字节在 {目标}/images 下。整段历史都读，而不是只读这一轮新增的那张——
     * 模型要能看见前几轮聊过的那张图。
     */
    messages: toChatHistory(history.messages, await loadImagesFor(history.messages), {
      files: await loadAttachTexts(history.messages),
      summary: history.summary,
    }),
    // 工具附带的图片（res.read 看了张图）也要读成字节才能挂上：与用户消息里的图同一条路
    loadImages: loadImagesById,
    tools,
    ctx: { nodeId: target.nodeId, goalId: target.goalId },
    signal: ctrl.signal,
    /**
     * 上下文对比调试器的记账口：每跳请求发出前收下实发的上下文（见 agent/contextDebug）。
     * 滚动只留最近两份、不累积；命中骤降时由哨兵定格成报告（开不开着窗口都在记，
     * 这正是「不录制、只在出事时摆出来」的前提）。
     */
    onContext: (snapshot) => {
      // 前缀门禁：此刻的 system / messages / tools 与实发完全一致（见 agent/runtime），
      // 正好在发出去之前对一遍账（见 agent/prefixGate）
      assertPrefixStable(
        target.conversationId,
        snapshot.messages,
        snapshot.tools as Parameters<typeof assertPrefixStable>[2],
      )
      noteRequest(target.conversationId, snapshot)
    },
    /**
     * 动态提示词注入的边界通道（触发在 execute 里发生，onPromptModule 只入队）。
     * runtime 在「当前这条请求已经完整」的边界拉一次——正是「等当前 loop 请求结束」
     * 的那一点：绝不打断半截输出。有积压就注入**一个**模块（去重按 key 记），runtime
     * 把它追加到请求流末尾并继续 loop——不等整轮结束。
     *
     * 镜像方式：模块记成回复里的一个 prompt-module **片段**（与思考/工具同层，
     * 界面渲染成轮内折叠块，不分割轮次），toChatHistory 在片段位置补发 assistant
     * 消息（见 agent/history）——数组顺序天然与实发一致，不需要任何切分。
     */
    injections: async (): Promise<AgentInjection | null> => {
      // 不再按需在 loop 中途动态注入提示词模块：全量提示词与规程已在首轮全量就绪
      return null
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
        // 留最后一跳的值：状态条要的是「现在吐字多快」，不是全程平均
        // 缓存哨兵：同一会话的前缀逐字节只增（前缀门禁在管），命中因此只许涨不许跌。
      // 跌了（且超过一块的量）= 服务端看到的前缀与我们发的不一致，或缓存被部分逐出——
      // 当场把数字喊出来，配合开发者模式的上下文调试器（两份快照逐条比对）就能定位到条。
      // 账本带纪元、挂在门禁上：设计内的前缀搬家（超预算裁剪 / 压缩·编辑后的重置）
      // 服务商缓存是真丢，但那不是分叉——跨了纪元的读数不比较，不喊狼来了。
      const prevRead = lastCacheRead(convKey)
      if (prevRead && prevRead.epoch === currentEpoch(convKey) && e.usage.cacheRead + 512 < prevRead.read) {
        // 定格：把前后两份实发上下文摆进对比调试器（断点已标注，见 agent/contextDebug）
        captureDrop(convKey, prevRead.read, e.usage.cacheRead)
        // 身份差异（模型/档位翻面）跟着喊出来：它不在字节比对里，却常是骤降的真正原因
        const identity = lastDropReport()?.identity
        console.warn(
          `[cache-watch] ${convKey} 命中骤降：${prevRead.read} → ${e.usage.cacheRead}（-${prevRead.read - e.usage.cacheRead}）。` +
            (identity ? `请求身份变了：${identity}。` : '') +
            '前后两份上下文已摆进对比调试器（断点已标注）。',
        )
      }
      noteCacheRead(convKey, e.usage.cacheRead)
      if (e.usage.tps) {
          tally.tps = e.usage.tps
          setTps((prev) => ({ ...prev, [convKey]: e.usage.tps as number }))
        }
        // 圆环的实时账：每跳结束就重算一份（与轮末落库的 shape 完全一致）
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
        // 输出中的实时估算：每秒一条，先撑起数字，结束时由精确值替换
        setTps((prev) => ({ ...prev, [convKey]: e.tps }))
      }
      applyEvent(parts, e)
      // 里程碑立即落库，流式内容节流（见 flushTurn 的说明）
      if (e.type === 'tool-call' || e.type === 'tool-result' || e.type === 'notice') scheduleFlush(true)
      else if (e.type === 'text' || e.type === 'thinking') scheduleFlush(false)
      setStreaming((prev) => ({ ...prev, [convKey]: { conversationId: convKey, messageId: assistantId, parts: [...parts] } }))
    },
  })
}
