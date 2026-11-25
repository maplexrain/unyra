/**
 * useAgent 本体：把 Agent 运行时绑定到学习 store 的 hook（发送 / 停止 / 工作流 /
 * 手动与自动压缩 / ask 表单与实时账）。从 useAgent.ts 原样搬出（入口门面还在
 * learn/useAgent.ts，调用方零改动）。
 *
 * 机制块已按职责拆进本目录，这里只留 hook 的装配与「一轮怎么排」的编排：
 * - slots.ts      会话分槽状态（streaming / running / pendingAsk / tps / liveUsage / 子代理实时槽）
 * - session.ts    会话级副作用（落库 / 起名 / 子代理管理器）
 * - agentPrompt.ts 一轮的入口组装（用户消息 + 人格 / 格式 / 画像 / 技能 / MCP 补发）
 * - toolRig.ts    工具装配（沙箱基座、wf.invoke 排队、子代理、MCP、ask、交付登记……）
 * - streamLoop.ts 流式循环（runAgent 调用、token 账、缓存哨兵、流式槽更新）
 * - turnClose.ts  轮次收口（落库、清槽、工作流出队、压缩应用）
 * - freeTurn.ts   自由聊天的一轮
 * - queue.ts      等待队列（排队 / 撤回 / 立即发送 / 收口派发）
 * - actions.ts    动作入口（send / runWorkflow / compactNow / autoTeach / runHidden / resumeInterrupted）
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  type AgentPart,
  type ChannelStamp,
  type Conversation,
  type ConversationMessage,
  type MessageFile,
  type MessageImage,
  type MessageQuote,
  type PendingFile,
  type PendingImage,
} from '../../agent/types'
import type { AskAnswers, ExamToolDeps } from '../../agent/tools'
import { hasApiKey, loadAiSettings } from '../../ai/settings'
import { freeConversationById, getFreeConversations, mutateFreeConversation } from '../freeChat'
import { type AgentVoice } from '../../agent/agentProfile'
import { setEffortContextProbe } from '../effortGuard'
import type { LearnStore } from '../types'
import { conversationById, nodeById } from '../graph'
import type { BrowserDeps } from '../web/browserOps'
import { TURN_FLUSH_MS, upsertAssistantInFlight } from '../agent/inflight'
import { transferPendingFiles, transferPendingImages } from '../agent/transfer'
import type { AgentRunTarget, AgentUiDeps } from '../agent/sandboxOps'
import { activeMessages } from '../compact'
import { missingPromptModules, promptModuleMessage, type PromptModule } from '../ai/promptModules'
import type { AgentProfileId } from '../../agent/agentProfile'
import type { RoleWorkDispatcher } from '../roleWork/dispatch'
import { roleOfConversation } from '../roleWork/roles'
import {
  flushChannelInbox,
  setRoleWorkDispatcher,
  takeChannelInjection,
} from '../roleWork/dispatch'
import { inboundMessage, withUserEnvelopeAttachments } from '../roleWork/channels'
import { pauseAskTimer, resumeAskTimer } from '../roleWork/askTimers'
import { useAgentSlots } from './slots'
import { useAgentSession } from './session'
import { assembleTurnEntry } from './agentPrompt'
import { rigTurnTools } from './toolRig'
import { runTurnLoop } from './streamLoop'
import { settleTurn } from './turnClose'
import { runFreeTurn } from './freeTurn'
import { useAgentQueue } from './queue'
import { useAgentActions } from './actions'

/**
 * 把 Agent 运行时绑定到学习 store。
 * - 上下文按**目标**隔离：一个目标一份会话，目标下的节点共用它，切节点不换上下文
 * - send 支持指定目标（用于刚创建节点后的自动开讲，避免切换状态未生效）
 * - 流式内容按 conversationId 归属，切换会话不会串台
 */
export function useAgent(opts: {
  store: LearnStore
  set: (s: LearnStore) => void
  getLatest: () => LearnStore
  goalId: string | null
  nodeId: string | null
  conversationId: string | null
  onNeedKey: () => void
  /** 说一句话（目前只有「附件没能转存」这类） */
  onNotice?: (message: string) => void
  /** 考试工具依赖；由工作区注入，按节点与阶段动态提供 */
  examDeps?: (nodeId: string, wfParams?: Record<string, string | number>) => ExamToolDeps | undefined
  /** ui.* 与截图需要的能力（见 AgentUiDeps） */
  ui?: AgentUiDeps
  /**
   * 节点编辑成功后的宿主动作（出卷后的视觉自检等）：由界面层注入，
   * learnSandboxOps 会把它接到节点通道的 afterEdit 上。
   */
  afterNodeEdit?: (uuid: string, kind: string) => void
  /** browser.* 的宿主依赖工厂（web 页签动作与活信息，见 learn/web/browserOps）；不注入就没有这一组 */
  browserDeps?: () => BrowserDeps | undefined
}) {
  const { store, set, getLatest, goalId, nodeId, conversationId, onNeedKey, examDeps } = opts
  /**
   * 界面侧能力（ui.*）走 ref 而不是闭包：runTurn 的依赖数组不追它，
   * 直接解构会永远拿到首轮那份旧回调（页签换过之后，point 就指到别的文档上去了）。
   */
  const uiRef = useRef(opts.ui)
  const afterNodeEditRef = useRef(opts.afterNodeEdit)
  useEffect(() => {
    uiRef.current = opts.ui
    afterNodeEditRef.current = opts.afterNodeEdit
  })
  /** browser.* 的宿主依赖（web 页签动作与活信息）：同 uiRef 的理由，每渲染刷新 */
  const browserFnRef = useRef(opts.browserDeps)
  useEffect(() => {
    browserFnRef.current = opts.browserDeps
  })
  /*
   * 会话分槽的状态与 ref（六张槽表 + 子代理实时槽，以及中止器、轮次链、工作流队列
   * 这几条会话级 ref）：集中在 useAgent/slots 声明，各槽位的语义注释都在那里。
   */
  const {
    streaming,
    setStreaming,
    running,
    setRunning,
    abortMapRef,
    turnChainRef,
    pendingWfRef,
    wfChainRef,
    pendingAsk,
    setPendingAsk,
    askWaitersRef,
    tps,
    setTps,
    liveUsage,
    setLiveUsage,
    workRuns,
    setWorkRuns,
    workManagersRef,
  } = useAgentSlots()
  const onNeedKeyRef = useRef(onNeedKey)
  /** 转存失败之类的话要能说出来，但不该进 runTurn 的依赖（回调每次渲染都是新的） */
  const onNoticeRef = useRef(opts.onNotice)
  /**
   * 队列往前走一步（把队首发出去）。挂在 ref 上是因为它要被**收口点**调用，而那两个
   * 收口点（runTurn / sendFree 的 finally）定义在它前面、又在依赖上追不到它——
   * 每次渲染刷新一份（与 autoCompactRef 同一个套路）。
   */
  const drainQueueRef = useRef<(convId: string) => void>(() => {})

  /**
   * 到阈值自动压缩：本轮结束后起一轮压缩工作流（触发点在 runTurn 的 finally）。
   *
   * 为什么走 ref 而不是直接调：runTurn 定义在 runWorkflow 之前，它的 finally 里要用到
   * 「现在能不能自动压、怎么起一轮」；挂在 ref 上每次渲染刷新，闭包永远是最新的一份。
   * 压缩轮自己不会再触发（它一定产生了 applied.label），所以不会自激。
   * （本体在这里声明、早于 runTurnUnchecked；装填在 useAgent/actions 的每次渲染里。）
   */
  const autoCompactRef = useRef<((ratio: number, target?: AgentRunTarget) => void) | null>(null)
  /**
   * wf.invoke 的出队口：一轮收口时把导师交出去的活起起来（见 pendingWfRef 与 runTurn 的 finally）。
   *
   * 与 autoCompactRef 同一条理由——runWorkflow 声明在 runTurn 之后，前面那个闭包要么
   * 追一个新依赖（把 runTurn 整段重建），要么挂在这个每次渲染刷新的 ref 上。
   *
   * 返回值 = 「这一轮真的排了工作流」：调用方据此跳过顺手的那次自动压缩（见 finally）。
   */
  const wfDrainRef = useRef<((target: AgentRunTarget) => boolean) | null>(null)

  useEffect(() => {
    onNeedKeyRef.current = onNeedKey
    onNoticeRef.current = opts.onNotice
  })

  useEffect(
    () => () => {
      for (const c of abortMapRef.current.values()) c.abort()
      for (const m of workManagersRef.current.values()) m.abortAll()
    },
    [abortMapRef, workManagersRef],
  )

  const conversation = useMemo<Conversation | null>(
    () => (conversationId ? (conversationById(store, conversationId) ?? null) : null),
    [store, conversationId],
  )

  // 会话级副作用（落库 / 起名 / 子代理管理器）整段在 useAgent/session；namingRef 由自由聊天共用
  const { persist, namingRef, nameConversation, getOrCreateWorkManager, getOrCreateFreeWorkManager } = useAgentSession({
    getLatest,
    set,
    workManagersRef,
    setWorkRuns,
  })

  /** 用户在表单卡里点了「提交」：把答案交回给阻塞中的沙箱（缺省 = 当前会话挂着的那一张） */
  const submitAsk = useCallback(
    (answers: AskAnswers, convId?: string) => {
      const ask = pendingAsk[convId ?? conversationId ?? '']
      if (ask) askWaitersRef.current.get(ask.id)?.({ ok: true, cancelled: false, answers })
    },
    // askWaitersRef 是跨渲染稳定的 ref：列进依赖不改变记忆化行为
    [pendingAsk, conversationId, askWaitersRef],
  )

  /** 用户点了「不回答了」：告诉沙箱没有答案（不是失败，别让它把取消当成错误重试） */
  const cancelAsk = useCallback(
    (convId?: string) => {
      const ask = pendingAsk[convId ?? conversationId ?? '']
      if (!ask) return
      askWaitersRef.current.get(ask.id)?.({
        ok: true,
        cancelled: true,
        answers: [],
        note: '用户取消了表单，没有给出任何回答。不要假设他的偏好或答案；把要问的话直接写进回复里，或先继续不需要回答的部分。',
      })
    },
    // askWaitersRef 是跨渲染稳定的 ref：列进依赖不改变记忆化行为
    [pendingAsk, conversationId, askWaitersRef],
  )

  /** 气泡里的 ask 不依赖 pendingAsk（work 发起的问询不在 role 的表单槽里） */
  const submitAskById = useCallback(
    (askId: string, answers: AskAnswers) => {
      askWaitersRef.current.get(askId)?.({ ok: true, cancelled: false, answers })
    },
    [askWaitersRef],
  )

  const cancelAskById = useCallback(
    (askId: string) => {
      askWaitersRef.current.get(askId)?.({
        ok: true,
        cancelled: true,
        answers: [],
        note: '用户取消了表单，没有给出任何回答。不要假设他的偏好或答案。',
      })
    },
    [askWaitersRef],
  )

  /** UI 倒计时走到 0 时先收口；宿主定时器随后会撞上同一个 waiter，不会重复。 */
  const expireAskById = useCallback(
    (askId: string) => {
      askWaitersRef.current.get(askId)?.({
        ok: false,
        timedOut: true,
        content: '表单已到时自动失效。不要假设用户的回答。',
      })
    },
    [askWaitersRef],
  )

  /**
   * 气泡悬停：暂停 / 恢复宿主侧的 ask 到期定时器。
   * 只控制计时，不改变 ask 状态；真正的到期仍由 toolRig 的 settle 收口。
   */
  const setAskHover = useCallback((askId: string, hovering: boolean) => {
    if (hovering) pauseAskTimer(askId)
    else resumeAskTimer(askId)
  }, [])

  /**
   * runTurn 的本体，不做并发控制（守卫与排队在 runTurn 里）。
   */
  const runTurnUnchecked = useCallback(
    async (
      target: AgentRunTarget,
      text: string,
      hidden = false,
      context?: string,
      quote?: MessageQuote,
      /**
       * 输入框里还没落盘的附件。转存就发生在下面——**收到这条消息、确认真的要发出去之后**，
       * 不是贴进输入框的那一刻（理由见 transferPendingImages）。
       */
      pending?: PendingImage[],
      /** 同上的文件附件（文本 / 二进制 / 图片，见 learn/attachments） */
      files?: PendingFile[],
      /** 隐藏指令是「哪件事」，显示成对话流里的分界条并参与消息定位（见 agent/types 的 mark） */
      mark?: string,
      /**
       * 这一轮就是**压缩轮**（「压缩上下文」工作流）。
       *
       * 它的用处只有一个：跑完不要再触发一次自动压缩。判据不能只看「有没有产生摘要」——
       * 模型没写成摘要（或者被拒）时 applied.label 是空的，只看它会让自动压缩一轮接一轮地
       * 自激下去（每一轮都花真钱）。见下面 finally 里的自动触发。
       */
      isCompactTurn = false,
      /**
       * 这一轮触发前要注入的提示词模块（见 learn/ai/promptModules）。由 runWorkflow
       * 算好带来（登记工作流的 prompt 字段；内置规程已随全量静态提示词进
       * WORKFLOWS_GUIDE）。注入点与人格补发同一处——排在当轮指令之前、只在队尾追加
       * （前缀缓存安全）；活着的消息里已有标记的自动跳过，同一上下文绝不重复注入。
       */
      modules?: PromptModule[],
      /** 工作流启动实参（runWorkflow 的 params）：随隐藏指令落库，分界条展开时展示 */
      wfParams?: Record<string, string | number>,
      /** 这条用户消息的来源通道（用户 / agent / work），写进消息后由 history 补时间戳 */
      channel?: ChannelStamp,
      /**
       * 已经落过盘、只带引用的附件（群聊 / 渠道入站走这里）：
       * 不再转存，直接把引用并进这一轮的用户消息。字节留在资源库，role 的历史里
       * 只留元信息，work 拿 messageId 时才读内容。
       */
      known?: { images?: MessageImage[]; files?: MessageFile[] },
    ) => {
      const trimmed = text.trim()
      // 与 runTurn 同一道门：纯图片/纯文件（无字）放行——图片转存与消息组装都在后面
      if (!trimmed && !(pending?.length || files?.length || known?.images?.length || known?.files?.length)) return
      const settings = loadAiSettings()
      const before = getLatest()
      if (!before.goals.some((g) => g.id === target.goalId)) return
      if (target.nodeId && !nodeById(before, target.nodeId)) return
      /**
       * 这一轮回复的固定身份：轮次内增量落库按它整条替换（见 flushTurn 的说明），
       * 也随 inflight 标记写进会话——进程被杀后，载入恢复靠它找到那条没收口的回复
       * （见 learn/agent/inflight 的 recoverInterruptedTurn）。
       */
      const assistantId = crypto.randomUUID()

      /*
       * 到这一刻才转存：这一轮真的会发出去，这些附件才真的会进上下文。
       * 菜单里选来的图片也是 PendingFile（它可能是一张 png），这里把它们并进图片那一路——
       * 两条入口（贴图 / 选文件）落到同一个出口，图片就只有一套处理。
       */
      const imageFiles: PendingImage[] = (files ?? [])
        .filter((x) => x.image)
        .map((x) => ({ id: x.id, name: x.name, bytes: x.bytes, file: x.image as File, previewUrl: '' }))
      const allImages = [...(pending ?? []), ...imageFiles]
      const attached = allImages.length
        ? await transferPendingImages(getLatest, set, target.goalId, allImages)
        : { images: known?.images ?? ([] as MessageImage[]), error: undefined }
      const docFiles = (files ?? []).filter((x) => !x.image)
      const attachedFiles = docFiles.length
        ? await transferPendingFiles(getLatest, set, target.goalId, docFiles)
        : { files: known?.files ?? ([] as MessageFile[]), error: undefined }
      if (attachedFiles.error) onNoticeRef.current?.(attachedFiles.error)

      /**
       * 声部以**会话**为最终事实源：会话已存在（哪怕 voice 字段漏标——voiceOfConversation
       * 会从确定性 id 愈合）就按它的声部走，否则才信 target（承接声部的首轮）。
       * 漏标的承接会话在这里就地补标（幂等；导师对话不写 voice，与老数据同形）。
       */
      const existing = conversationById(before, target.conversationId)
      const voice: AgentVoice = existing
        ? (roleOfConversation(existing) as AgentVoice)
        : (target.voice ?? 'tutor')
      let conv = existing ?? {
        id: target.conversationId,
        goalId: target.goalId,
        messages: [] as ConversationMessage[],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        // 承接声部的第一轮就在这里把会话落库并标上声部（导师对话不写 voice，与老数据同形）
        ...(voice !== 'tutor' ? { voice } : {}),
      }
      if (voice !== 'tutor' && !conv.voice) conv = { ...conv, voice }
      // 入口组装（当轮用户消息 + 人格 / 格式 / 画像 / 技能 / MCP 各路补发，以及系统提示词
      // 的固化与 inflight 标记）整段在 assembleTurnEntry；这里只接回组装好的会话并落库。
      const entry = assembleTurnEntry({ trimmed, hidden, mark, wfParams, context, quote, attached, attachedFiles, assistantId, voice, conv, ...(channel ? { channel } : {}) })
      conv = entry.conv
      /**
       * 私聊页只读 channels，不读 messages：用户自己发的图片/文件在进入这一轮前只是
       * PendingImage / PendingFile（还没有资源库引用），所以 AgentSlot 建 user 信封时
       * 只能先写文字。转存完成后把同一枚信封补上 attachments，气泡才会画出宫格；
       * 纯附件消息也靠这一步从「空信封」变成可见消息。
       */
      conv = withUserEnvelopeAttachments(conv, channel, attached.images, attachedFiles.files)
      // 工作流触发时随指令注入的规程模块（登记工作流的 prompt 字段）：作为隐藏
      // assistant 声明插在当轮指令之前——声明归 assistant 边、指令归 user（见
      // promptModuleMessage 的分工说明）。同一上下文同 key 只注一次，压缩折掉后自动补回。
      if (modules?.length) {
        const missing = missingPromptModules(conv.messages, modules.map((m) => m.key))
        const injects = modules
          .filter((m) => missing.includes(m.key))
          .map((m) => promptModuleMessage(m, crypto.randomUUID(), Date.now()))
        if (injects.length) {
          const messages = [...conv.messages]
          messages.splice(messages.length - 1, 0, ...injects)
          conv = { ...conv, messages }
        }
      }
      persist(conv)
      // 这一段对话还没有标题就顺手起一个（不阻塞这一轮，见 nameConversation）
      nameConversation(conv)

      // 工具装配（沙箱基座 / wf.invoke 排队 / 子代理 / MCP / ask 表单通道 / 交付登记 /
      // 考试 / 记忆 / 界面操作 / 内置浏览器）整段在 rigTurnTools；中止器也从那里回来。
      const rig = rigTurnTools({
        getLatest,
        set,
        target,
        channel,
        settings,
        agentSettings: entry.agentSettings,
        wfParams,
        voice,
        examDeps,
        afterNodeEdit: afterNodeEditRef.current,
        uiRef,
        browserFnRef,
        wfChainRef,
        pendingWfRef,
        askWaitersRef,
        setPendingAsk,
        onNoticeRef,
        workManager: getOrCreateWorkManager(target.conversationId),
      })
      const ctrl = rig.ctrl
      const parts: AgentPart[] = []

      /**
       * 轮次内的增量落库：回复在跑的过程中就分次进会话（固定 id 整条替换，
       * 见 learn/agent/inflight）。里程碑事件（工具调用/返回、运行时提示）立刻落——
       * 工具卡片是「导师做过什么」的账，最不能丢；流式正文/思考走节流。
       * 进程被杀最多丢一个节流间隔的增量，而不是一整轮（过去是整轮全丢，
       * 而工具副作用早已落库，「做过什么」的记录反而没了）。
       * 界面在轮次进行中不画这份 store 副本（AgentPanel 按 streamingMessageId 过滤），
       * 渲染仍走 streaming，不因此多一次重渲染。
       */
      let flushTimer: ReturnType<typeof setTimeout> | null = null
      const flushTurn = () => {
        if (flushTimer) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
        if (!parts.length) return
        const stored = conversationById(getLatest(), target.conversationId)
        if (!stored) return
        persist(
          upsertAssistantInFlight(stored, {
            id: assistantId,
            role: 'assistant',
            parts: [...parts],
            ts: Date.now(),
          }),
        )
      }
      const scheduleFlush = (immediate: boolean) => {
        if (immediate) flushTurn()
        else if (!flushTimer) flushTimer = setTimeout(flushTurn, TURN_FLUSH_MS)
      }

      const history = conversationById(getLatest(), target.conversationId) ?? conv

      /**
       * 这一轮的 token 账。每跳（模型→工具→模型）都会来一条 usage：
       * 最后一跳的输入量就是「当前上下文占用」，各跳累加则是这一轮的总量。
       * （contextWindow 在上面的工具装配处已取好——子代理要用同一个数。）
       */
      const tally = { context: 0, total: 0, output: 0, read: 0, miss: 0, estimated: false, turns: 0, tps: 0 }
      const convKey = target.conversationId
      setStreaming((prev) => ({ ...prev, [convKey]: { conversationId: convKey, messageId: assistantId, parts: [] } }))
      setRunning((prev) => (prev[convKey] ? prev : { ...prev, [convKey]: true }))
      setTps((prev) => {
        if (!(convKey in prev)) return prev
        const next = { ...prev }
        delete next[convKey]
        return next
      })
      setLiveUsage((prev) => {
        if (!(convKey in prev)) return prev
        const next = { ...prev }
        delete next[convKey]
        return next
      })
      // ctrl 在上面的工具装配处创建（ask / wait 的中止语义需要它），这里只挂到 ref 上
      abortMapRef.current.set(convKey, ctrl)
      try {
        // 模型循环（runAgent + 前缀对账 + usage 记账 + 流式槽更新）整段在 runTurnLoop
        await runTurnLoop({
          global: rig.global,
          window: rig.window,
          teacherSystem: entry.teacherSystem,
          history,
          tools: rig.tools,
          ctrl,
          parts,
          tally,
          convKey,
          target,
          assistantId,
          setStreaming,
          setTps,
          setLiveUsage,
          scheduleFlush,
          /**
           * 跳边界注入：通道交付回传（work host.send / Agent 来信 → role 运行中 →
           * 单次 loop 结束后插入，见 learn/roleWork/dispatch 与 agent/history）。
           * 镜像纪律：交付全文记成 channel-message 片段挂在当前回复的跳边界上、随增量
           * 落库——toChatHistory 会在同一位置重放同一条 user 消息，下一轮前缀逐字节对得上。
           */
          injections: async () => {
            const delivery = takeChannelInjection(target.conversationId)
            if (!delivery) return null
            parts.push({ type: 'channel-message', channelId: delivery.envelopeId, text: delivery.text })
            const storedConv = conversationById(getLatest(), target.conversationId)
            if (storedConv) {
              persist(
                upsertAssistantInFlight(storedConv, {
                  id: assistantId,
                  role: 'assistant',
                  parts: [...parts],
                  ts: Date.now(),
                }),
              )
            }
            scheduleFlush(true)
            return { role: 'user', content: delivery.text }
          },
        })
      } finally {
        // 只摘自己的中止器：并发时后启动的轮次可能已经换了这一格
        if (abortMapRef.current.get(convKey) === ctrl) abortMapRef.current.delete(convKey)
        if (flushTimer) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
        // 收口落库、清各槽、wf.invoke 出口与压缩的应用整段在 settleTurn
        settleTurn({
          convKey,
          target,
          assistantId,
          parts,
          tally,
          window: rig.window,
          turnDelivery: rig.turnDelivery,
          isCompactTurn,
          persist,
          getLatest,
          setRunning,
          setStreaming,
          setTps,
          setLiveUsage,
          setPendingAsk,
          wfDrainRef,
          autoCompactRef,
          onNoticeRef,
        })
        // 通道收口：本轮若还有排着的通道消息，接着起下一轮（见 learn/roleWork/dispatch）
        flushChannelInbox(target.conversationId)
      }
    },
    // 后面追加的全是跨渲染稳定的 ref / setState：列进依赖不改变记忆化行为（与拆分前一致）
    [examDeps, getLatest, getOrCreateWorkManager, nameConversation, persist, set, setStreaming, setRunning, setTps, setLiveUsage, setPendingAsk, abortMapRef, askWaitersRef, pendingWfRef, wfChainRef],
  )

  /**
   * 跑一轮对话。同一会话的轮次在这里**串行化**：并发跑两轮时，后发那条的用户消息会落库在
   * 先发那一轮的回复**之前**，下一轮还原出的历史与任何一次实发都对不上——前缀缓存整段作废，
   * 前缀门禁也会把它拦下来（见 agent/prefixGate）。排队等上一轮跑完再开始，两轮的上下文都完整。
   * 守卫放在进队列之前：空文本、没配 Key 用不着排队。
   */
  const runTurn = useCallback(
    async (
      target: AgentRunTarget,
      text: string,
      hidden = false,
      context?: string,
      quote?: MessageQuote,
      pending?: PendingImage[],
      files?: PendingFile[],
      mark?: string,
      isCompactTurn = false,
      /** 工作流触发时随指令注入的提示词模块（见 runTurnUnchecked 同名参数） */
      modules?: PromptModule[],
      /** 工作流启动实参（见 runTurnUnchecked 同名参数） */
      wfParams?: Record<string, string | number>,
      /** 用户消息的来源通道（见 runTurnUnchecked 同名参数） */
      channel?: ChannelStamp,
      /** 已经落过盘的附件引用（群聊 / 渠道入站；见 runTurnUnchecked 同名参数） */
      known?: { images?: MessageImage[]; files?: MessageFile[] },
    ) => {
      /*
       * 空文本 + 带附件（纯图片 / 纯文件）也是合法消息：气泡（MessageBubble 只在
       * 有字时才画文字泡）与历史组装（agent/history 只在 context 有值时才带）都为
       * 「只发图」留好了位置——门只拦「什么都没有」的那条。
       */
      if (!text.trim() && !(pending?.length || files?.length || known?.images?.length || known?.files?.length)) return
      if (!hasApiKey(loadAiSettings())) {
        if (!hidden) onNeedKeyRef.current()
        return
      }
      // 任何一轮真正开始，该会话积压的通道消息不再触发自启动
      const chain = turnChainRef.current
      const prev = chain.get(target.conversationId)
      let release!: () => void
      const ticket = new Promise<void>((resolve) => {
        release = resolve
      })
      chain.set(target.conversationId, ticket)
      try {
        if (prev) await prev
        await runTurnUnchecked(target, text, hidden, context, quote, pending, files, mark, isCompactTurn, modules, wfParams, channel, known)
      } finally {
        release()
        if (chain.get(target.conversationId) === ticket) chain.delete(target.conversationId)
        /*
         * 这一轮收口了：等待队列往下走一步（见 drainQueueRef）。放在最后一行是有讲究的——
         * 前一行刚把本轮的票从链上摘掉，drain 才认得出「现在没人跑了」；早一行调，
         * 它会以为这一轮还在跑而什么都不做，那条排着的消息就要一直等到下一次收口。
         * 有轮次在链上等着跑（工作流接力 / 别的发送）时，drain 自己会让路（见它的判据）。
         */
        drainQueueRef.current(target.conversationId)
      }
    },
    // turnChainRef 是跨渲染稳定的 ref：列进依赖不改变记忆化行为
    [runTurnUnchecked, turnChainRef],
  )

  /**
   * 自由聊天的一轮（agent 栏最左那枚固定页签）：**没有系统提示词、没有工具、
   * 没有人格与提示词模块**——就是一段裸对话。流式骨架（streaming/running/tps 的
   * 分槽记账、中止器、串行化）与 runTurn 共用同一套，所以页签的运行点、停止键、
   * 状态条都不必知道「这是不是自由聊天」。
   *
   * 会话存 learn/freeChat（users/{uid}/free-chat.json），不在 store.conversations 里——
   * 那里的每一段都挂在目标上、写进 {目标}/chat.json，自由聊天没有目标可挂。
   */
  const sendFree = useCallback(
    (
      conversationId: string,
      text: string,
      opts?: {
        files?: PendingFile[]
        images?: PendingImage[]
        /** Work 通道交付：role 空闲时由交付唤醒，不当作新的用户发言 */
        delivery?: { text: string; stamp: ChannelStamp; envelopeId: string }
      },
    ) => {
      const trimmed = text.trim()
      const delivery = opts?.delivery
      const docFiles = (opts?.files ?? []).filter((x) => !x.image)
      const imageFiles: PendingImage[] = [
        ...(opts?.images ?? []),
        ...(opts?.files ?? [])
          .filter((x) => x.image)
          .map((x) => ({ id: x.id, name: x.name, bytes: x.bytes, file: x.image as File, previewUrl: '' })),
      ]
      // 允许纯图片或纯文件发送（无字放行）；Work 交付与附件无关，直接放行
      if (!delivery && !trimmed && !docFiles.length && !imageFiles.length) return
      if (!freeConversationById(conversationId)) return
      if (!hasApiKey(loadAiSettings())) {
        onNeedKeyRef.current()
        return
      }
      // 任何一轮真正开始：该会话积压的通道消息在这里消费
      const chain = turnChainRef.current
      const prev = chain.get(conversationId)
      let release!: () => void
      const ticket = new Promise<void>((resolve) => {
        release = resolve
      })
      chain.set(conversationId, ticket)
      void (async () => {
        try {
          if (prev) await prev
          // 轮次主体（转存附件、固化系统提示词、受限沙箱、流式循环与起名）整段在 runFreeTurn
          await runFreeTurn({
            conversationId,
            trimmed,
            docFiles,
            imageFiles,
            onNoticeRef,
            namingRef,
            getLatest,
            set,
            setStreaming,
            setRunning,
            setTps,
            setLiveUsage,
            abortMapRef,
            workManager: getOrCreateFreeWorkManager(conversationId),
            ...(delivery ? { delivery } : {}),
          })
        } finally {
          release()
          if (chain.get(conversationId) === ticket) chain.delete(conversationId)
          // 同 runTurn 的收口：这一轮结束，排队等着的下一条往下走
          drainQueueRef.current(conversationId)
        }
      })()
    },
    // 后面列的全是跨渲染稳定的 ref / setState：列进依赖不改变记忆化行为
    // （getLatest / set 维持不列——原实现如此，见 lint 的既有告警）
    [setStreaming, setRunning, setTps, setLiveUsage, turnChainRef, abortMapRef, namingRef, getOrCreateFreeWorkManager],
  )

  // 动作入口（send / runWorkflow / compactNow / autoTeach / runHidden / resumeInterrupted，
  // 以及自动压缩 / 工流出队两个收口 ref 的装填）整段在 useAgent/actions
  const { send, compactingConv, runWorkflow, compactNow, autoTeach, runHidden, resumeInterrupted } = useAgentActions({
    getLatest,
    set,
    goalId,
    nodeId,
    conversationId,
    running,
    onNoticeRef,
    pendingWfRef,
    wfChainRef,
    autoCompactRef,
    wfDrainRef,
    runTurn,
  })

  const stop = useCallback(
    (convId?: string) => {
      const id = convId ?? conversationId
      if (!id) return
      abortMapRef.current.get(id)?.abort()
      // work 在后台跑：停止这一轮时把当前对话所有在跑的一并中断（级联）
      workManagersRef.current.get(id)?.abortAll()
    },
    // 两个都是跨渲染稳定的 ref：列进依赖不改变记忆化行为
    [conversationId, abortMapRef, workManagersRef],
  )

  /**
   * 停止某个 work 正在跑的那一轮：只认这一个 work，不碰 role 的对话，
   * 也不连坐同目录下别的 work。work 已经空闲时是 no-op。
   */
  const stopWork = useCallback(
    (workId: string, convId?: string) => {
      const id = convId ?? conversationId
      if (!id) return
      const work = getLatest()
        .conversations.find((c) => c.id === id)
        ?.works?.sessions.find((w) => w.id === workId)
      if (!work) return
      workManagersRef.current.get(id)?.api.stop(work.name)
    },
    [conversationId, getLatest, workManagersRef],
  )

  /**
   * UI 的「终止并通知 role」：关闭 loop，同时把用户写的终止声明发到 role 的
   * Work 通道并唤醒 role。强制终止仍走 stopWork，不碰 role 的上下文。
   */
  const stopWorkWithStatement = useCallback(
    (workId: string, statement: string, convId?: string) => {
      const id = convId ?? conversationId
      if (!id) return
      const work = getLatest()
        .conversations.find((c) => c.id === id)
        ?.works?.sessions.find((w) => w.id === workId)
      if (!work) return
      workManagersRef.current.get(id)?.stopWithStatement(work.name, statement)
    },
    [conversationId, getLatest, workManagersRef],
  )

  /** 删除 work 会话：管理器会先停 loop，再把它从账本里摘掉。 */
  const deleteWork = useCallback(
    (workId: string, convId?: string) => {
      const id = convId ?? conversationId
      if (!id) return
      const work = getLatest()
        .conversations.find((c) => c.id === id)
        ?.works?.sessions.find((w) => w.id === workId)
      if (!work) return
      workManagersRef.current.get(id)?.api.kill(work.name)
    },
    [conversationId, getLatest, workManagersRef],
  )

  /* ---------- 等待队列：导师在跑时用户发出去的消息排在这里（见 learn/agentQueue） ---------- */

  // 等待队列的机制（writeQueue / dispatchQueued / drain / 排队 / 撤回 / 立即发送）
  // 整段搬进 useAgent/queue（useAgentQueue）：队列的 state 与 ref 在那里声明，
  // 收口点 drainQueueRef 还是本文件早在 runTurn 之前准备好的那一个。
  const { queues, enqueueMessage, dropQueuedMessage, sendQueuedNow } = useAgentQueue({
    turnChainRef,
    onNeedKeyRef,
    drainQueueRef,
    runTurn,
    sendFree,
    stop,
  })

  /* ---------- role/work 三通道（user / agent / work）的宿主派发器 ---------- */

  /**
   * 通道注册表（learn/roleWork/dispatch）只管落账、排队与唤醒，**启动一轮**永远是宿主的事：
   * 目标 role 的会话走 runTurn（target.voice 按 role 装配提示词与能力面）。
   * 目标会话解析：同一目标下该 role 最新的一段会话；导师没给目标时退回界面当前会话。
   * 经 getter 取用——dispatcherRef 每次渲染刷新一份，注册表每次都拿到最新闭包。
   */
  const dispatcherRef = useRef<RoleWorkDispatcher | null>(null)
  /**
   * 运行态从 true → false 时补一次通道收口：`settleTurn` 里立即 flush 读到的还是旧
   * running 状态；等 React 提交后再扫一遍，保证运行中排队的 Work 交付一定起下一轮。
   */
  const prevRunningRef = useRef<Record<string, boolean>>({})
  useEffect(() => {
    const prev = prevRunningRef.current
    for (const id of Object.keys(prev)) {
      if (prev[id] && !running[id]) flushChannelInbox(id)
    }
    prevRunningRef.current = running
  }, [running])
  useEffect(() => {
    dispatcherRef.current = {
      isConversationRunning: (convId) => Boolean(running[convId]),
      resolveRoleConversation: (role, gid) => findRoleConversation(getLatest(), role, gid),
      startRoleTurn: (req) => {
        if (!hasApiKey(loadAiSettings())) return
        if (req.role === 'free') {
          if (!freeConversationById(req.conversationId)) return
          void sendFree(req.conversationId, '', {
            delivery: { text: req.text, stamp: req.stamp, envelopeId: req.envelopeId },
          })
          return
        }
        const conv = conversationById(getLatest(), req.conversationId)
        const goal = req.goalId ?? conv?.goalId
        if (!goal) return
        const voice: AgentVoice = req.role
        void runTurn(
          {
            goalId: goal,
            nodeId: null,
            conversationId: req.conversationId,
            voice,
          },
          req.text,
          false,
          undefined,
          undefined,
          undefined,
          undefined,
          req.mark,
          false,
          undefined,
          undefined,
          req.stamp,
          req.images?.length || req.files?.length
            ? { ...(req.images?.length ? { images: req.images } : {}), ...(req.files?.length ? { files: req.files } : {}) }
            : undefined,
        )
      },
      appendChannel: (convId, envelope) => {
        const cur = conversationById(getLatest(), convId)
        if (cur) {
          persist({ ...cur, channels: [...(cur.channels ?? []), envelope].slice(-200), updatedAt: Date.now() })
          return
        }
        const free = freeConversationById(convId)
        if (free) {
          mutateFreeConversation(convId, (c) => ({
            ...c,
            channels: [...(c.channels ?? []), envelope].slice(-200),
            updatedAt: Date.now(),
          }))
        }
      },
      /**
       * 静默汇报：只把消息写进目标会话的上下文与通道流水，不启动一轮、不进排队。
       * 通道流水由 deliverInbound 先落过，这里只补 `messages` 里的那一条 user 侧消息；
       * 下一轮组历史时它带 channel stamp 出现，模型能看到这段进度。
       */
      appendSilentInbound: (req, _envelope) => {
        const message = inboundMessage(req.text, req.stamp, {
          ...(req.images ? { images: req.images } : {}),
          ...(req.files ? { files: req.files } : {}),
          ...(req.hidden ? { hidden: true } : {}),
          ...(req.mark ? { mark: req.mark } : {}),
          ...(req.delivery ? { delivery: req.delivery } : {}),
        })
        const cur = conversationById(getLatest(), req.conversationId)
        if (cur) {
          persist({ ...cur, messages: [...cur.messages, message], updatedAt: Date.now() })
          return
        }
        const free = freeConversationById(req.conversationId)
        if (free) {
          mutateFreeConversation(req.conversationId, (c) => ({
            ...c,
            messages: [...c.messages, message],
            updatedAt: Date.now(),
          }))
        }
      },
    }
  })
  useEffect(() => {
    setRoleWorkDispatcher(() => dispatcherRef.current)
    return () => setRoleWorkDispatcher(null)
  }, [])

  /**
   * 当前会话的实时槽。分槽之后同一时刻可能有几位 role 都在跑，这里只交出
   * **眼前这一位**的那一份——面板渲染的是激活页签；页签守卫读的是整张表（见下）。
   */
  const streamingLive = conversationId ? (streaming[conversationId] ?? null) : null
  const streamingParts = streamingLive?.parts ?? null

  /** 当前 role 对话下的 work 账本与实时流 */
  const workBucket = conversation?.works

  /**
   * 思考档位唯一性守卫的探针（见 learn/effortGuard）：档位全应用只有全局滑条一份，
   * ModelPicker 在用户手动切档前问这里一句「有没有已带上下文的对话」——导师会话与
   * 自由聊天都算。卸载时注销，不留悬空闭包。
   */
  useEffect(() => {
    setEffortContextProbe(() => {
      const s = getLatest()
      return (
        s.conversations.some((c) => activeMessages(c.messages).length > 0) ||
        getFreeConversations().some((c) => activeMessages(c.messages).length > 0)
      )
    })
    return () => setEffortContextProbe(null)
  }, [getLatest])

  return {
    conversation,
    streaming: streamingParts,
    /** 轮次进行中那条回复的固定 id：AgentPanel 据此把它从静态列表里剔掉（渲染走 streaming） */
    streamingMessageId: streamingLive?.messageId ?? null,
    running: !!running[conversationId ?? ''],
    /**
     * 整张「谁在跑」的表（键 = conversationId）：agent 栏页签的关闭守卫读它——
     * 「那位导师正在跑」与「眼前看的是哪位」是两回事。
     */
    runningByConversation: running as Record<string, boolean>,
    /**
     * 分槽的**原始数据**（键 = conversationId）：keepalive 的页签面板每枚各取自己
     * 会话的那一份——后台页签的流式、表单、账目与眼前这位互不借用。
     */
    streams: streaming,
    pendingAskByConv: pendingAsk,
    tpsByConv: tps,
    liveUsageByConv: liveUsage,
    /** 全部在跑的 work 实时槽（带 conversationId）：每枚页签的 work 数据各筛各的 */
    workRunsAll: workRuns,
    compactingConvId: compactingConv,
    compacting: !!compactingConv,
    /**
     * 等待队列（键 = conversationId）：输入框上方那一块读它（见 learn/agentQueue）。
     * 排进来 / 撤回 / 立即发送三条路都在下边，它们只认 convId，不认「眼前是哪一枚页签」——
     * keepalive 之后后台页签的队列也该是它自己那一段对话的。
     */
    queues,
    enqueueMessage,
    dropQueuedMessage,
    sendQueuedNow,
    send,
    sendFree,
    autoTeach,
    runHidden,
    /** 继续被中断的一轮（消息列表中断说明旁的「继续」按钮），见上方说明 */
    resumeInterrupted,
    /** 触发一个工作流（内置或登记过的）：指令以 user 消息进上下文，见上方说明 */
    runWorkflow,
    compactNow,
    stop,
    stopWork,
    stopWorkWithStatement,
    deleteWork,
    /** api.ask 的表单状态与两条出口（由 AgentPanel 渲染成输入框上方的卡片） */
    pendingAsk: conversationId ? (pendingAsk[conversationId] ?? null) : null,
    submitAsk,
    cancelAsk,
    submitAskById,
    cancelAskById,
    expireAskById,
    setAskHover,
    /** 最近一跳实测的输出速度（tok/s）；没在跑、或服务端没流式回包时为 null */
    tps: conversationId ? (tps[conversationId] ?? null) : null,
    /** 正在跑的这一轮到目前为止的账（每跳 usage 重算）：上下文占用圆环的实时数据源 */
    liveUsage: conversationId ? (liveUsage[conversationId] ?? null) : null,
    /** work：当前 role 对话下的会话与各场在跑任务的实时流 */
    work: {
      sessions: workBucket?.sessions ?? [],
      running: workRuns.some((r) => r.conversationId === conversationId),
      live: workRuns
        .filter((r) => r.conversationId === conversationId)
        .map(({ workId, runId, parts }) => ({ workId, runId, parts })),
    },
  }
}

/** 同一目标下某 role 最新的一段会话；没有就 null（通道投递不自动建会话） */
function findRoleConversation(
  store: LearnStore,
  role: AgentProfileId,
  goalId?: string | null,
): string | null {
  const matches = store.conversations.filter(
    (c) => roleOfConversation(c) === role && (goalId == null || c.goalId === goalId),
  )
  matches.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  return matches[0]?.id ?? null
}
