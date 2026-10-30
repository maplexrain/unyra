/**
 * 这个文件负责「一轮对话怎么跑」：把 Agent 运行时绑定到学习 store 的 useAgent hook
 * （发送 / 停止 / 工作流 / 手动与自动压缩 / ask 表单与实时账）。
 *
 * 原先住在这里的纯逻辑已按职责搬进 learn/agent/（历史还原、附件转存、事件累加、沙箱装配，
 * 见 docs/refactor-plan.md 3.8）：这个文件只留 hook 本体，并把原有的公开符号原样再导出一次
 * ——从 './useAgent' 取用它们的调用方一行都不用改。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type AgentPart,
  type Conversation,
  type ConversationMessage,
  type MessageFile,
  type MessageImage,
  type MessageQuote,
  type MessageUsage,
  type PendingFile,
  type PendingImage,
} from '../agent/types'
import { runAgent, type AgentInjection } from '../agent/runtime'
import { emptyDelivery, hasDelivery, mergeDelivery, normalizeDelivery } from '../agent/delivery'
import { createExecuteTool, type AskAnswers, type AskFormPayload, type ExamToolDeps } from '../agent/tools'
import { ASK_IDLE_TIMEOUT_MS } from '../agent/sandbox/limits'
import { ensureActivityListeners, userIdleMs } from '../lib/userActivity'
import { captureDrop, lastDropReport, noteRequest } from '../agent/contextDebug'
import { assertPrefixStable, currentEpoch, lastCacheRead, noteCacheRead, resetPrefixGate } from '../agent/prefixGate'
import { globalContextWindow, hasApiKey, loadAiSettings, resolveGlobal } from '../ai/settings'
import { appendFreeMessage, freeConversationById, getFreeConversations, mutateFreeConversation, FREE_GOAL_ID } from './freeChat'
import { setEffortContextProbe } from './effortGuard'
import { loadAgentSettings } from '../agent/settings'
import { makeMcpOps } from '../agent/mcp/ops'
import { makePermissionOps } from '../agent/permissions'
import { getActiveSkills, getSkillsDigest, needsSkillsAnnounce, skillsAnnounceMessage } from '../agent/skill/registry'
import { getMcpDigest, mcpAnnounceMessage, needsMcpAnnounce } from '../agent/mcp/announce'
import type { LearnStore } from './types'
import { buildFreeChatSystem, buildTeacherSystem } from './ai'
import { fetchForAgent, searchForAgent } from './webSearch'
import type { SandboxOptions } from '../agent/sandbox/types'
import { MIN_ACTIVE_MESSAGES, activeMessages, applyCompaction, shouldCompact } from './compact'
import { needsPersonaAnnounce, personaMessage } from '../agent/persona'
import { needsDocFormatAnnounce, docFormatMessage, docFormatAllowsModule } from '../agent/docFormat'
import { conversationById, nodeById, resolveDisplayedConversation, addConversation } from './graph'
import { resolveNode } from './paths'
import { makeExamTool } from './agentOps'
import { findWorkflow, renderWorkflowInstruction, workflowPrep, workflowModules } from './workflows'
import { generateConversationTitle, namingSource } from './title'
import { createMemoryOps } from './memory'
import { createScheduleOps } from './schedule'
import { saveScreenshot } from './screenshots'
import { makeBrowserOps, type BrowserDeps } from './web/browserOps'
import { loadImagesById, loadImagesFor, releasePending } from './images'
import {
  dropQueued as dropQueuedItem,
  enqueueQueued,
  queueOf,
  takeQueued,
  type QueuedMessage,
  type Queues,
} from './agentQueue'
import { native } from '../lib/native'
import { storageAbsPath } from '../lib/storage'
import { applyEvent } from './agent/events'
import { toChatHistory } from './agent/history'
import { TURN_FLUSH_MS, upsertAssistantInFlight } from './agent/inflight'
import { loadAttachTexts, transferPendingFiles, transferPendingImages } from './agent/transfer'
import { applyAskToProfile, learnSandboxOps, type AgentRunTarget, type AgentUiDeps } from './agent/sandboxOps'
import { createSubAgentManager, type SubAgentManager } from '../agent/subagent/manager'
import { EMPTY_SUB_BUCKET } from '../agent/subagent/registry'
import {
  missingPromptModules,
  promptModuleByKey,
  promptModuleMessage,
  type PromptModule,
} from './ai/promptModules'
import { t } from '../i18n'

/*
 * 这几行是**入口不变的保证**：这些符号原先就从这个文件导出（路径与名字都没动），
 * 实现搬进 learn/agent/ 之后在这里原样再导出一次——LearnWorkspace 与 scripts/tests
 * 的探针照旧从 './learn/useAgent' 取，零改动。
 */
export { toChatHistory }
export { loadAttachTexts }
export { learnSandboxOps }
export type { AgentRunTarget, AgentUiDeps }

/**
 * wf.invoke 允许连着的触发次数（见 pendingWfRef 那一段）。
 *
 * 链本身是合法的编排：开讲 → 出卷 → 阅卷，一条跟着一条走。要防的是**无限的链**——
 * 一条指令里写着「做完再触发它自己」的工作流，会一轮接一轮地烧下去，而每一轮都要真花钱。
 * 三次之后再调就当场拒掉，并把话说给模型听（它该收尾了，而不是再排一条）。
 */
const MAX_WF_CHAIN = 3

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
  examDeps?: (nodeId: string) => ExamToolDeps | undefined
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
  const [streaming, setStreaming] = useState<Record<string, { conversationId: string; messageId: string; parts: AgentPart[] }>>(
    {},
  )
  /**
   * 在跑的轮次按**会话**记（agent 栏页签化之后，几位导师可以同时各跑各的；
   * 键 = conversationId）。UI 读的是当前会话那一份，页签的关闭守卫读整张表——
   * 「导师正在跑」的判定与「眼前看的是哪位」是两回事。
   */
  const [running, setRunning] = useState<Record<string, true>>({})
  /** 每个会话一个中止器：停止按钮只停当前会话，别的导师不受牵连 */
  const abortMapRef = useRef(new Map<string, AbortController>())
  /** 同一会话的轮次串行化（见 runTurn 的说明）：conversationId → 在途轮次的结束承诺 */
  const turnChainRef = useRef(new Map<string, Promise<void>>())
  /**
   * wf.invoke 的队列（键 = conversationId）：导师在一轮里把活交给某条工作流时先排在这儿，
   * 这一轮收口后才由宿主起（见 WorkflowOps.invoke 与 wfDrainRef）。几位导师各跑各的，
   * 谁交的活归谁那一轮。
   */
  const pendingWfRef = useRef(new Map<string, Array<{ id: string; params?: Record<string, string | number> }>>())
  /** 这条会话上连着触发了几条工作流（见 MAX_WF_CHAIN）；链一断就归零 */
  const wfChainRef = useRef(new Map<string, number>())
  const onNeedKeyRef = useRef(onNeedKey)
  /** 转存失败之类的话要能说出来，但不该进 runTurn 的依赖（回调每次渲染都是新的） */
  const onNoticeRef = useRef(opts.onNotice)
  /**
   * api.ask 的待回答表单**按会话各挂各的**（表单卡只渲染在发起它的那个会话的输入框上方），
   * 与它的「收卷人」。ask 在工具执行里阻塞等待，表单提交 / 取消 / 停止按钮三条路
   * 都要能把它唤醒（见 runTurn 里的装配）；收卷人按表单 id 认领——并发时多个导师
   * 各问各的，交卷必须落到问话的那一位手里。
   */
  const [pendingAsk, setPendingAsk] = useState<Record<string, { id: string; form: AskFormPayload }>>({})
  const askWaitersRef = useRef(new Map<string, (value: unknown) => void>())
  /**
   * 最近一跳实测的输出速度（tok/s，见 ChatUsage.tps）。轮次开始时清零，
   * 每跳 usage 带着它来就更新——输入区的状态条读它（跑完之后回退到消息里的存量）。
   */
  const [tps, setTps] = useState<Record<string, number>>({})
  /**
   * 正在跑的这一轮**到目前为止**的账（每跳 usage 来就重算一份），按会话分开。
   * 输入区的上下文占用圆环要的是「现在这一跳结束时占了多少」，而不是整轮跑完、
   * 落进会话的那一份——一轮里模型要来回好几跳，每跳输入都在涨，等轮末才更新
   * 圆环就错过了全程。轮次结束随落库一起清空（圆环回退到持久化的那份）。
   */
  const [liveUsage, setLiveUsage] = useState<Record<string, MessageUsage>>({})

  /**
   * 等待队列（键 = conversationId，见 learn/agentQueue）：导师正在跑时用户发出去的消息
   * 排在这里，当前这一轮一收口就往下发一条。
   *
   * 为什么队列住在这里、而不是住在输入区那枚面板里：它是**对话的属性**，不是面板的。
   * 页签关掉再打开、切到别的节点又切回来，面板会重挂，而排队等着的那几条不该跟着消失
   * （用户已经把它们发出去了）。另外「什么时候往下发」也只能在这里看准：一轮的收口点
   * 就在这个文件里（runTurn / sendFree 的 finally），宿主那侧看得见的是「running 变没变」，
   * 而它比真实收口晚一拍、也没看见工作流排队这类内部接力。
   *
   * 状态与 ref 各一份：渲染读 state，派发路径（收口回调、立即发送）读 ref——
   * setState 是异步的，收口那一刻读到的会是旧队列。两份永远同进同出（见 writeQueue）。
   */
  const [queues, setQueues] = useState<Queues>({})
  const queuesRef = useRef<Queues>({})
  /**
   * 队列往前走一步（把队首发出去）。挂在 ref 上是因为它要被**收口点**调用，而那两个
   * 收口点（runTurn / sendFree 的 finally）定义在它前面、又在依赖上追不到它——
   * 每次渲染刷新一份（与 autoCompactRef 同一个套路）。
   */
  const drainQueueRef = useRef<(convId: string) => void>(() => {})

  /**
   * 子代理会话住在 Conversation.subagents 上、随 chat.json 落盘（生命周期 = 这段
   * 导师对话，见 docs/subagent-architecture.md）——这里不再另立状态，读走对话、
   * 写走子代理管理器的 setBucket。留在内存的只有两样：
   * - subRuns：并发在跑的各场任务的流式输出（一段对话可同时跑多场，按 runId 分槽）；
   * - 子代理管理器（按 conversationId 各一个，跨轮存活——轮次结束仍在后台跑的任务
   *   由它继续管着，下一轮的 wait 领回交付）。
   */
  const [subRuns, setSubRuns] = useState<Array<{ conversationId: string; sessionId: string; runId: string; parts: AgentPart[] }>>([])
  const subManagersRef = useRef(new Map<string, SubAgentManager>())

  useEffect(() => {
    onNeedKeyRef.current = onNeedKey
    onNoticeRef.current = opts.onNotice
  })

  useEffect(
    () => () => {
      for (const c of abortMapRef.current.values()) c.abort()
      for (const m of subManagersRef.current.values()) m.abortAll()
    },
    [],
  )

  const conversation = useMemo<Conversation | null>(
    () => (conversationId ? (conversationById(store, conversationId) ?? null) : null),
    [store, conversationId],
  )

  const persist = useCallback(
    (next: Conversation) => {
      const s = getLatest()
      const exists = s.conversations.some((c) => c.id === next.id)
      const conversations = exists
        ? s.conversations.map((c) => (c.id === next.id ? next : c))
        : [...s.conversations, next]
      set({ ...s, conversations })
    },
    [getLatest, set],
  )

  /**
   * 子代理管理器：一段对话一个、跨轮存活（在跑的任务不随轮次结束而停，
   * 交付挂起在它手里，下一轮的 wait 领回）。桶的读写都在这条对话上。
   */
  const getOrCreateSubManager = useCallback(
    (conversationId: string): SubAgentManager => {
      let m = subManagersRef.current.get(conversationId)
      if (!m) {
        m = createSubAgentManager({
          getBucket: () => conversationById(getLatest(), conversationId)?.subagents ?? EMPTY_SUB_BUCKET,
          setBucket: (update) => {
            const stored = conversationById(getLatest(), conversationId)
            if (!stored) return
            const next = update(stored.subagents ?? EMPTY_SUB_BUCKET)
            // 空桶不存字段：没有子代理的对话不该在 chat.json 里多一截空结构
            persist({ ...stored, subagents: next.defs.length || next.sessions.length ? next : undefined })
          },
          onEvent: (sessionId, runId, e) => {
            setSubRuns((prev) => {
              const cur = prev.find((r) => r.runId === runId)
              const parts = cur ? [...cur.parts] : []
              applyEvent(parts, e)
              return cur
                ? prev.map((r) => (r.runId === runId ? { ...r, parts } : r))
                : [...prev, { conversationId, sessionId, runId, parts }]
            })
          },
          onRunEnd: (_sessionId, runId) => {
            setSubRuns((prev) => prev.filter((r) => r.runId !== runId))
          },
        })
        subManagersRef.current.set(conversationId, m)
      }
      return m
    },
    [getLatest, persist],
  )

  /**
   * 给这段对话起个名（见 learn/title）。**只在一段对话还没有标题时做一次**，
   * 失败就安静地算了——起名是锦上添花，不能影响任何一次真正的对话。
   *
   * 为什么挂在 runTurn 里、而不是「新建对话」那一刻：新建时对话是空的，一句话都没有，
   * 拿什么起名。第一轮跑起来时那句话才刚进会话（见 runTurn 里 persist 之后的那一处）。
   *
   * namingRef 是在途标记：第一轮还没跑完用户又发了一条时，不要再发一次起名请求。
   */
  const namingRef = useRef(new Set<string>())
  const nameConversation = useCallback(
    (conv: Conversation) => {
      if (conv.title || namingRef.current.has(conv.id)) return
      const goal = getLatest().goals.find((g) => g.id === conv.goalId)
      const source = namingSource(conv, goal?.question ?? '')
      if (!source) return
      namingRef.current.add(conv.id)
      void generateConversationTitle({ text: source })
        .then((title) => {
          const cur = conversationById(getLatest(), conv.id)
          // 期间它可能被删掉了、或已经由别的路径起了名（换用户时整份 store 会换掉）
          if (!cur || cur.title) return
          persist({ ...cur, title })
        })
        .catch((err: unknown) => {
          console.warn('[agent] 对话起名失败', err)
        })
        .finally(() => namingRef.current.delete(conv.id))
    },
    [getLatest, persist],
  )

  /** 用户在表单卡里点了「提交」：把答案交回给阻塞中的沙箱（缺省 = 当前会话挂着的那一张） */
  const submitAsk = useCallback(
    (answers: AskAnswers, convId?: string) => {
      const ask = pendingAsk[convId ?? conversationId ?? '']
      if (ask) askWaitersRef.current.get(ask.id)?.({ ok: true, cancelled: false, answers })
    },
    [pendingAsk, conversationId],
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
    [pendingAsk, conversationId],
  )

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
       * 这一轮触发前要注入的提示词模块（动态提示词注入，见 learn/ai/promptModules）。
       * 由 runWorkflow 算好带来（内置 promptModule / 登记的 prompt）。注入点与人格补发
       * 同一处——排在用户消息之前、只在队尾追加（前缀缓存安全）；活着的消息里已有
       * 标记的自动跳过，同一上下文绝不重复注入。
       */
      modules?: PromptModule[],
      /** 工作流启动实参（runWorkflow 的 params）：随隐藏指令落库，分界条展开时展示 */
      wfParams?: Record<string, string | number>,
    ) => {
      const trimmed = text.trim()
      // 与 runTurn 同一道门：纯图片/纯文件（无字）放行——图片转存与消息组装都在后面
      if (!trimmed && !(pending?.length || files?.length)) return
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
        : { images: [] as MessageImage[], error: undefined }
      const docFiles = (files ?? []).filter((x) => !x.image)
      const attachedFiles = docFiles.length
        ? await transferPendingFiles(getLatest, set, target.goalId, docFiles)
        : { files: [] as MessageFile[], error: undefined }
      if (attachedFiles.error) onNoticeRef.current?.(attachedFiles.error)

      let conv = conversationById(before, target.conversationId) ?? {
        id: target.conversationId,
        goalId: target.goalId,
        messages: [] as ConversationMessage[],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      /**
       * **节点上下文不再自动注入**（2026-10-23 的架构决定）：「当前学习目标 / 目标规划 /
       * 当前节点 / 写入目标」那几行曾经每轮拼进消息——它是随节点与进度**每轮都在变**的
       * 内容，不属于任何一边（既不是固定的提示词，也不是当次的指令），还会在新对话的
       * 第一条指令前面垫上一大块，把指令本身覆盖掉。现在：
       * - 沙箱的「当前节点」语义照旧（省略 path 的 doc.write / outline.write 落在
       *   target.nodeId 上，宿主解析，模型不必知道路径）；
       * - 模型需要目标 / 节点 / 规划状态时**自己去查**：api.node.list()（回执带 current
       *   与全部节点）、节点对象 content、api.state.read()；
       * - 调用方真正要交给模型的**当次参数**（画布的目标项定位、选段位置）仍走 context
       *   参数——那是指令的一部分，不是会变的背景。
       */
      const extraContext = context?.trim()
      const userMsg: ConversationMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: trimmed }],
        ts: Date.now(),
        hidden,
        /*
         * 带 mark 的隐藏轮就是**工作流指令**（runWorkflow 把工作流名当 mark 传下来，
         * runHidden 那几个动作同理）：界面上画一条分界条，定位条给它一个锚点。
         * 提示词注入（人格 / 格式 / 技能库 / 模块）自己带 inject: 'prompt'，不走这里——
         * 两者从前混在一条分界条上，几条一起注入时那行字会被挤爆（见 agent/messageKind）。
         */
        ...(hidden && mark ? { mark, inject: 'instruction' as const } : {}),
        // 工作流的启动实参：界面的分界条展开时画参数行、并高亮指令里对应的文字
        ...(hidden && mark && wfParams ? { wfParams } : {}),
        // 只带调用方给的当次参数（选段位置 / 画布意图）；节点背景不再自动注入（见上面的说明）
        ...(extraContext ? { context: extraContext } : {}),
        ...(quote ? { quote } : {}),
        ...(attached.images.length ? { images: attached.images } : {}),
        ...(attachedFiles.files.length ? { files: attachedFiles.files } : {}),
      }
      /*
       * 导师人格：这一段对话里还没交代过（或那条已经被压缩掉）时，先补一条隐藏指令。
       *
       * 它是**中途插进历史的一条 user 消息**，不是系统提示词的一部分——所以换人格只影响
       * 它之后的内容，前面的前缀照旧命中服务端缓存（见 agent/persona 顶部那段说明）。
       * 一条对话里同一个人格只补一次；人格变了就是新 id，自然再补一次。
       */
      const agentSettings = loadAgentSettings()
      const personaId = agentSettings.persona
      /*
       * 系统提示词固化进对话（见 agent/types 的 Conversation.systemPrompt）：第一次请求
       * 抓一份、之后每一轮都用固化的那份，不再每轮现拼。老数据没有这个字段——在这里
       * 现场抓一份补上，随下面 conv 组装后的 persist 一并落盘，之后与新数据完全一致。
       */
      let teacherSystem = conv.systemPrompt
      if (!teacherSystem) {
        teacherSystem = buildTeacherSystem({
          // 画像**不在这里传**：导师要贴合这个人时自己 api.userInfo.get() 取（见 ai 的说明）
          extraSystemPrompt:
            agentSettings.extraSystemPromptEnabled && agentSettings.extraSystemPrompt?.trim()
              ? agentSettings.extraSystemPrompt.trim()
              : undefined,
        })
        conv = { ...conv, systemPrompt: teacherSystem }
      }
      const announcer = needsPersonaAnnounce(conv.messages, personaId)
        ? [personaMessage(personaId, Date.now(), crypto.randomUUID(), agentSettings.customPersonas)]
        : []

      /*
       * 文档格式策略：与人格同一位置、同一条纪律（见 agent/docFormat）——
       * 一条对话里同一种格式只补一次；格式变了就是新 id，自然再补一次；
       * 被压缩掉（retired）之后自动补回来。
       */
      const formatAnnouncer = needsDocFormatAnnounce(conv.messages, agentSettings.docFormat)
        ? [docFormatMessage(agentSettings.docFormat, Date.now(), crypto.randomUUID(), agentSettings.customDocFormats)]
        : []

      // 动态技能清单注入：不在系统提示词中硬编码，而在消息流中按需注入与变更更新（保持前缀缓存稳定）
      const activeSkills = getActiveSkills(agentSettings.skills)
      const currentSkillsDigest = getSkillsDigest(activeSkills)
      const hasPreviousSkillsAnnounce = conv.messages.some((m) => !m.retired && m.skillsDigest !== undefined)
      const skillsAnnouncer = needsSkillsAnnounce(conv.messages, currentSkillsDigest)
        ? [
            skillsAnnounceMessage(
              activeSkills,
              storageAbsPath('skills') ?? undefined,
              Date.now(),
              crypto.randomUUID(),
              currentSkillsDigest,
              hasPreviousSkillsAnnounce,
            ),
          ]
        : []

      // MCP 感知注入：与技能发现层同一套机制（隐藏消息 + digest 变更重注入）。
      // 主观能动性的前提是知情——agent 不知道有哪些外部服务，就不会在任务需要时想到它们
      const currentMcpDigest = getMcpDigest(agentSettings.mcp)
      const hasPreviousMcpAnnounce = conv.messages.some((m) => !m.retired && m.mcpDigest !== undefined)
      const mcpAnnouncer = needsMcpAnnounce(conv.messages, currentMcpDigest)
        ? [
            mcpAnnounceMessage(
              agentSettings.mcp,
              Date.now(),
              crypto.randomUUID(),
              currentMcpDigest,
              hasPreviousMcpAnnounce,
            ),
          ]
        : []

      // 提示词模块与技能 Slash 命令检测：支持用户以 /<skill-id> 显式指定，提前将技能注入上下文
      //
      // 工作流指定的模块同样要过格式策略过滤（「开讲」「学习大纲」会强制带上 doc-html）：
      // 纯 Markdown 策略下那份 HTML 配方与格式指令直接冲突，拦在这里——
      // 内容触发那一头的同一个过滤拦在 sandbox/execute 的注入点（见 agent/docFormat）。
      const effectiveModules = (modules ?? []).filter((m) => docFormatAllowsModule(m.key, agentSettings.docFormat))
      const slashMatch = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/)
      if (slashMatch) {
        const cmd = slashMatch[1].toLowerCase()
        const availableSkills = getActiveSkills(agentSettings.skills)
        const matchedSkill = availableSkills.find((s) => s.id === cmd || s.id.startsWith(cmd + '-'))
        if (matchedSkill) {
          const skillMod = promptModuleByKey(`skill:${matchedSkill.id}`)
          if (skillMod && !effectiveModules.some((m) => m.key === skillMod.key)) {
            effectiveModules.push(skillMod)
          }
        }
      }

      // 提示词模块：与人格补发同一位置、同一条纪律（retired 的不算数，压缩后自动重注）
      const moduleMsgs = effectiveModules.length
        ? missingPromptModules(conv.messages, effectiveModules.map((m) => m.key))
            .map((key) => {
              const mod = promptModuleByKey(key) ?? effectiveModules.find((m) => m.key === key)
              return mod ? promptModuleMessage(mod, crypto.randomUUID(), Date.now()) : null
            })
            .filter((m): m is ConversationMessage => m !== null)
        : []
      conv = {
        ...conv,
        messages: [...conv.messages, ...announcer, ...formatAnnouncer, ...skillsAnnouncer, ...mcpAnnouncer, ...moduleMsgs, userMsg],
        updatedAt: Date.now(),
        // 在途标记：这一轮没收口（进程被杀）时，载入恢复据此找到这条回复（见 learn/agent/inflight）
        inflight: { messageId: assistantId, startedAt: Date.now() },
      }
      persist(conv)
      // 这一段对话还没有标题就顺手起一个（不阻塞这一轮，见 nameConversation）
      nameConversation(conv)

      /**
       * 唯一的工具：模型写一段 JS，经由沙箱里的 api 完成读写。
       * 文档、节点、描述、试卷、临时变量、长期记忆、人机协作（ask / tiktok）
       * 与界面操作（ui.*）的全部能力都从这里进出（见 agent/tools）。
       */
      const ctrl = new AbortController()
      const signal = ctrl.signal
      /**
       * 本轮 execute 报上来的提示词模块 key（apiGroup / 内容触发，见 learn/ai/promptModules）。
       * 只收集不落库：轮末 finally 里统一去重、统一追加——绝不在这里改会话。
       */
      const moduleQueue = new Set<string>()
      // ui 依赖现取最新的一份（见 uiRef 的说明）
      const uiDeps = uiRef.current
      // browser 依赖现取最新的一份（webMeta 活信息随渲染变，与 uiRef 同款说明）
      const browserDeps = browserFnRef.current?.()
      /**
       * 全局提供商 / 模型 / 思考等级：所有 AI 功能的共同基底。提前到这里，
       * 因为子代理要跑在导师同一轮的模型与档位上（见 subagent 的说明）。
       */
      const global = resolveGlobal(settings)
      const window = globalContextWindow(settings)
      /**
       * 沙箱基座：一轮对话与子代理共用同一套能力（learnSandboxOps 的产物）。
       * execute 拿全量，子代理按定义的 apiGroups 取子集（见 subagent/manager）。
       */
      const sandboxBase = learnSandboxOps({
        getLatest,
        set,
        // 这一轮冲着来的节点是沙箱里的「当前节点」——不是界面上此刻选中的那个
        nodeId: () => target.nodeId,
        goalId: () => target.goalId,
        ...(afterNodeEditRef.current ? { afterNodeEdit: afterNodeEditRef.current } : {}),
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
      /**
       * 子代理管理器：喂给这一轮的模型配置与沙箱基座；它启动的子代理任务用
       * 启动那一刻的配置跑完（换轮不漂移）。
       */
      const manager = getOrCreateSubManager(target.conversationId)
      manager.setTurn({
        sandbox: sandboxBase,
        provider: global.provider,
        model: global.model,
        // 档位全应用唯一（全局滑条）：子代理与它的宿主同档，绝不各自翻面（见 learn/effortGuard）
        effort: global.effort,
        contextWindow: window,
      })
      // subagent api 挂进沙箱（导师专用；子代理的 apiAllow 白名单里没有这一组）
      sandboxBase.subagent = manager.api
      /*
       * MCP 外部服务挂进沙箱（mcp.list / mcp.discover / mcp.call，见 agent/mcp/ops）。
       * 配置是这一轮现取的快照：用户改了 MCP 设置，下一轮就生效；
       * 总开关关着时不注入——与旧做法「关闭时不注入任何 MCP 工具」同一口径。
       * 子代理的 apiAllow 白名单里没有 mcp，subsetSandbox 也不带它——只敞给导师。
       */
      const mcpOps = makeMcpOps(agentSettings.mcp)
      if (mcpOps) sandboxBase.mcp = mcpOps
      /**
       * ask 的表单通道抽成局部函数：permission.request 的审批复用同一条管线
       * （展示、限时、停止中断全都一致）；区别只在结果的去向——批准由宿主直接落
       * 放行配置（agent/permissions），不把答案交给模型。
       */
      const askHost = (form: AskFormPayload): Promise<unknown> =>
        new Promise<unknown>((resolve) => {
          let idleTimer: ReturnType<typeof setInterval> | null = null
          const askId = crypto.randomUUID()
          const finish = (value: unknown): void => {
            if (askWaitersRef.current.get(askId) !== finish) return
            askWaitersRef.current.delete(askId)
            signal.removeEventListener('abort', onAbort)
            if (idleTimer) clearInterval(idleTimer)
            // 只收走自己挂的那一张：并发时别的会话可能也挂着表单
            setPendingAsk((prev) => {
              if (prev[target.conversationId]?.id !== askId) return prev
              const next = { ...prev }
              delete next[target.conversationId]
              return next
            })
            // 标了 userInfo 的题目：答案在**用户提交的那一刻**就落进画像（见 user/fields），
            // 导师拿到答案时画像已经写好了——不必再 update 一遍，也就没有「转述走样」这一步
            void applyAskToProfile(form, value).then(resolve, () => resolve(value))
          }
          const onAbort = () =>
            finish({ ok: false, content: '用户停止了这一轮，表单已关闭。不要假设用户的回答。' })
          signal.addEventListener('abort', onAbort, { once: true })
          askWaitersRef.current.set(askId, finish)
          setPendingAsk((prev) => ({ ...prev, [target.conversationId]: { id: askId, form } }))
          /*
           * 表单限时：挂出一分钟后用户**没有任何操作**（鼠标键盘都不动，任意操作都会续住它，
           * 见 lib/userActivity）就自动收起并带回 timedOut——agent 据此自行决定继续或交付，
           * 不能为一个没人理的表单把整轮沙箱无限吊着。
           */
          ensureActivityListeners()
          idleTimer = setInterval(() => {
            if (askWaitersRef.current.get(askId) !== finish) return
            if (userIdleMs() >= ASK_IDLE_TIMEOUT_MS) {
              finish({
                ok: false,
                timedOut: true,
                content: '表单挂出一分钟，用户没有任何操作（超时自动收起）。不要假设用户的回答。',
              })
            }
          }, 5_000)
        })
      /*
        这一轮的交付账（文件变动 / 参考引证）。用局部变量而不是 state：它是这一轮的副作用，
        不该触发渲染；收口时挂到消息上，组件自然就出来了（见 agent/delivery）。
      */
      const turnDelivery = emptyDelivery()
      const tools = [
        createExecuteTool({
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
                    if (target.nodeId) {
                      const targetNode = nodeById(st, target.nodeId)
                      if (targetNode && (cleanPath === targetNode.title || cleanPath === targetNode.id)) {
                        f.nodeId = targetNode.id
                      }
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
            const deps = target.nodeId ? examDeps?.(target.nodeId) : undefined
            return deps ? makeExamTool(deps) : undefined
          })(),
          // 动态提示词注入的触发口：execute 只报 key，去重与落库都在轮末（见 moduleQueue）
          onPromptModule: (key) => moduleQueue.add(key),
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
          permission: makePermissionOps({ ask: askHost }),
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
        }),
      ]
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
            /**
             * 工作流轮与隐藏指令轮（mark 在）**跳间不注入**：模块若在多跳中途插到
             * 请求流末尾，下一跳它就成了「最后一条 user 消息」——注意力权重最高，
             * 排版配方这类规范会压过本轮工作流指令的职责约束（「本轮交付物是 X」）。
             * 工作流自带的模块在轮前已注入（userMsg 之前，那才是它该在的位置）；
             * execute 动态触发的延后到轮末 finally 统一落库，作为历史进入下一轮。
             */
            if (mark) return null
            if (!moduleQueue.size) return null
            const stored = conversationById(getLatest(), target.conversationId)
            if (!stored) {
              moduleQueue.clear()
              return null
            }
            const keys = missingPromptModules(activeMessages(stored.messages), [...moduleQueue])
            if (!keys.length) {
              moduleQueue.clear()
              return null
            }
            const mod = promptModuleByKey(keys[0])
            if (!mod) return null
            moduleQueue.delete(keys[0])
            parts.push({ type: 'prompt-module', key: mod.key, text: mod.text })
            // 片段立即落库（与工具卡片同一条里程碑纪律）：进程被杀也不丢这笔账
            flushTurn()
            // 模块是「怎么做」的声明：以 assistant 边进历史（与轮前的模块消息同一分工）
            return { role: 'assistant', content: mod.text }
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
      } finally {
        // 只摘自己的中止器：并发时后启动的轮次可能已经换了这一格
        if (abortMapRef.current.get(convKey) === ctrl) abortMapRef.current.delete(convKey)
        if (flushTimer) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
        /**
         * 收口落库：同一条 id 整条替换（带上 token 账）并清掉在途标记——载入恢复从此
         * 不再认这条（用户点「停止」的轮次也算正常收口，不会被误标成中断）。
         * 落库要在 setStreaming(null) 之前：顺序反了会有一帧「列表里没有、流式也没了」的空档。
         */
        if (parts.length) {
          const stored = conversationById(getLatest(), target.conversationId)
          if (stored) {
            const assistantMsg: ConversationMessage = {
              id: assistantId,
              role: 'assistant',
              parts,
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
              // 这一轮登记过交付才带上：空记录不写盘，界面上也就不会出现一个空组件
              ...(hasDelivery(turnDelivery) ? { delivery: turnDelivery } : {}),
              ts: Date.now(),
            }
            persist(upsertAssistantInFlight(stored, assistantMsg, true))
          }
        }
        /*
         * 动态提示词注入（apiGroup / 内容触发，见 learn/ai/promptModules）：本轮 execute
         * 报上来的模块在此刻统一落库——排在刚收口的回复之后、只在队尾追加（前缀缓存安全）。
         * 去重以**活着的消息**为准（activeMessages 与请求走同一份口径）：已注过的不重注。
         * 模块消息随后若被压缩折掉（retired），下次使用会重新注入——那是设计内行为。
         */
        if (moduleQueue.size) {
          const stored = conversationById(getLatest(), target.conversationId)
          if (stored) {
            const keys = missingPromptModules(activeMessages(stored.messages), [...moduleQueue])
            const msgs = keys
              .map((key) => {
                const mod = promptModuleByKey(key)
                return mod ? promptModuleMessage(mod, crypto.randomUUID(), Date.now()) : null
              })
              .filter((m): m is ConversationMessage => m !== null)
            if (msgs.length) {
              persist({ ...stored, messages: [...stored.messages, ...msgs], updatedAt: Date.now() })
            }
          }
        }
        // 只清自己这一场：并发的其他导师的实时槽各归各
        setRunning((prev) => {
          if (!prev[convKey]) return prev
          const next = { ...prev }
          delete next[convKey]
          return next
        })
        setStreaming((prev) => {
          if (!(convKey in prev)) return prev
          const next = { ...prev }
          delete next[convKey]
          return next
        })
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
        // 表单若还挂着（异常路径）也一并收掉
        setPendingAsk((prev) => {
          if (!(convKey in prev)) return prev
          const next = { ...prev }
          delete next[convKey]
          return next
        })

        /*
         * wf.invoke 的出口（见 WorkflowOps.invoke）：这一轮里导师把活交给了某条工作流，
         * 在这一刻起它——工作流的指令要作为一条 user 消息进上下文，而刚才那一轮还在跑，
         * 在正在跑的循环底下插用户消息是不行的。drained 也用来挡掉顺手的那次自动压缩：
         * 两件事都要新起一轮，挨在一起只会互相插队（压缩本身会让刚排的指令一起失活）。
         */
        const drained = wfDrainRef.current?.(target) ?? false
        /*
         * 本轮 loop 结束——**这里**才应用压缩。
         *
         * api.compact 在跑到一半时就可能被调用，但把上下文从正在跑的循环底下抽走是不行的
         * （下一跳请求正拿着它）。所以摘要先记在会话上（pending），到这里才把之前的消息
         * 全部标成失活：此后只有摘要 + 之后的新消息进上下文。
         * 这一轮自己的消息（那条隐藏指令、写摘要的工具调用、收尾那句话）也一起失活——
         * 「一条原消息都不留」是压缩的定义，否则摘要后面还跟着一段「我刚才把摘要写好了」的噪音。
         */
        const after = conversationById(getLatest(), target.conversationId)
        const applied = after ? applyCompaction(after) : null
        if (after && applied && applied.label) {
          persist(applied.conv)
          // 压缩把前面的消息整段换成了一条摘要——设计内的前缀重写，这一会话的账重新开始记
          // （见 agent/prefixGate）
          resetPrefixGate(target.conversationId)
          onNoticeRef.current?.(applied.label)
        } else if (after && !drained && autoCompactRef.current && !isCompactTurn) {
          /*
           * 没压成，看看该不该自动压：判据是**上一轮报回来的上下文占用**（服务端真的收了多少 token），
           * 不是估算。压缩轮自己不会再触发（它一定产生了 applied.label），所以不会自激。
           */
          const cfg = loadAgentSettings().compact
          const ratio = window ? tally.context / window : 0
          if (cfg.auto && shouldCompact(activeMessages(after.messages).length, ratio, cfg.threshold)) {
            autoCompactRef.current(ratio)
          }
        }
      }
    },
    [examDeps, getLatest, getOrCreateSubManager, nameConversation, persist, set],
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
    ) => {
      /*
       * 空文本 + 带附件（纯图片 / 纯文件）也是合法消息：气泡（MessageBubble 只在
       * 有字时才画文字泡）与历史组装（agent/history 只在 context 有值时才带）都为
       * 「只发图」留好了位置——门只拦「什么都没有」的那条。
       */
      if (!text.trim() && !(pending?.length || files?.length)) return
      if (!hasApiKey(loadAiSettings())) {
        if (!hidden) onNeedKeyRef.current()
        return
      }
      const chain = turnChainRef.current
      const prev = chain.get(target.conversationId)
      let release!: () => void
      const ticket = new Promise<void>((resolve) => {
        release = resolve
      })
      chain.set(target.conversationId, ticket)
      try {
        if (prev) await prev
        await runTurnUnchecked(target, text, hidden, context, quote, pending, files, mark, isCompactTurn, modules, wfParams)
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
    [runTurnUnchecked],
  )

  /**
   * 向当前会话发送用户消息。
   * context 只进模型上下文、不显示在气泡里；images 是随消息带出去的图片附件。
   * 参数用对象而不是位置参数：能带的东西已经有三样，位置参数太容易传错位。
   */
  const send = useCallback(
    (
      text: string,
      opts?: {
        context?: string
        quote?: MessageQuote
        images?: PendingImage[]
        files?: PendingFile[]
        /**
         * 显式目标：keepalive 的页签面板各自绑定自己的会话——后台页签的输入框
         * 发出去也要落到它自己那一段对话上，不能借用「眼前激活的页签」。
         */
        target?: AgentRunTarget
      },
    ) => {
      let t = opts?.target ?? null
      if (!t) {
        const s = getLatest()
        const effectiveGoalId = goalId ?? s.activeGoalId ?? null
        if (effectiveGoalId) {
          const effectiveConvId =
            (conversationId && conversationById(s, conversationId)?.goalId === effectiveGoalId
              ? conversationId
              : null) ?? resolveDisplayedConversation(s, effectiveGoalId)
          const effectiveNodeId =
            (nodeId && nodeById(s, nodeId)?.goalId === effectiveGoalId ? nodeId : null) ??
            (s.goals.find((g) => g.id === effectiveGoalId)?.rootNodeId || s.nodes.find((n) => n.goalId === effectiveGoalId)?.id || null)

          if (effectiveConvId) {
            t = { goalId: effectiveGoalId, nodeId: effectiveNodeId || null, conversationId: effectiveConvId }
          }
        }
      }
      if (!t) return
      void runTurn(
        t,
        text,
        false,
        opts?.context,
        opts?.quote,
        opts?.images,
        opts?.files,
      )
    },
    [goalId, nodeId, conversationId, runTurn, getLatest],
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
    (conversationId: string, text: string, opts?: { files?: PendingFile[]; images?: PendingImage[] }) => {
      // 图片附件在这里没有去处（static 资源库按目标目录落盘，自由聊天没有目标目录）：
      // 有图就先说一声——纯图片那条在自由聊天里没有可发的东西（下面会拦），不能闷声吞掉
      if (opts?.images?.length) onNoticeRef.current?.(t('自由聊天暂不支持图片，图片已去掉'))
      if (!text.trim()) return
      if (!freeConversationById(conversationId)) return
      if (!hasApiKey(loadAiSettings())) {
        onNeedKeyRef.current()
        return
      }
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
          // 文本附件直接拼进正文：附件的 text 在拾取时已按上限读好/截断（见 PendingFile）
          const attach = (opts?.files ?? [])
            .filter((f) => f.text)
            .map((f) => '\n\n【附件 ' + f.name + '】\n' + f.text)
            .join('')
          appendFreeMessage(conversationId, {
            id: crypto.randomUUID(),
            role: 'user',
            parts: [{ type: 'text', text: text.trim() + attach }],
            ts: Date.now(),
          })
          const stored = freeConversationById(conversationId)
          if (!stored) return
          const settings = loadAiSettings()
          const agentSettings = loadAgentSettings()
          // 自由聊天的系统提示词同样固化进会话（见 Conversation.systemPrompt）：第一次请求抓一份、之后每轮用它
          let freeSystem = stored.systemPrompt
          if (!freeSystem) {
            freeSystem = buildFreeChatSystem({
              extraSystemPrompt:
                agentSettings.extraSystemPromptEnabled && agentSettings.extraSystemPrompt?.trim()
                  ? agentSettings.extraSystemPrompt.trim()
                  : undefined,
            })
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

          try {
            await runAgent({
              provider: global.provider,
              model: global.model,
              reasoningEffort: global.effort,
              system: freeSystem,
              messages: toChatHistory(stored.messages),
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
        } finally {
          release()
          if (chain.get(conversationId) === ticket) chain.delete(conversationId)
          // 同 runTurn 的收口：这一轮结束，排队等着的下一条往下走
          drainQueueRef.current(conversationId)
        }
      })()
    },
    [],
  )

  /**
   * 手动压缩上下文（输入区「更多 → 压缩上下文」）。
   *
   * 与自动压缩共用 summarize，差别只在谁触发（记进摘要里，界面上那句说明会跟着变）。
   * 跑着的时候不让压：这一轮结束时还要往会话里写回复，中途把历史换掉，
   * 那一轮的结果就落在一份已经作废的历史上了。
   */
  /** 正在手动压缩的是哪一段会话（null = 没在压）：keepalive 后多个面板要各认各的 */
  const [compactingConv, setCompactingConv] = useState<string | null>(null)

  /**
   * 触发一个工作流（内置或登记过的）。指令以 **user 角色**整段进入上下文（隐藏消息，
   * 带名字作分界条），不碰系统提示词——这是「工作流」与「提示词」的分界，登记表也照此语义存储。
   *
   * target 缺省**按节点归属解析**（与 runHidden 同一条口径）：nodeId 所属目标的会话收这条指令——
   * agent 栏页签化之后，「眼前看的是哪位导师」与「这件事该归哪位导师」是两回事；
   * 节点属于当前会话的目标时才直接用当前会话。autoTeach 那类「节点刚建、状态还没切过去」
   * 的调用方传显式 target。
   *
   * 触发前的响铃**只有带 prep 的才做**（见 workflowPrep）；主栏不再由这里切——
   * agent 栏页签化之后，「眼前看的是哪位导师」由用户自己决定。
   */
  const runWorkflow = useCallback(
    (
      ref: string,
      opts?: {
        /** 冲着哪个节点来（缺省 = 当前节点） */
        nodeId?: string
        /** 指令里 {{占位符}} 的实参（如回忆的 title、出卷的类型等级） */
        params?: Record<string, string | number>
        /** 跟着这条指令进上下文的额外说明（如大纲里那句定位） */
        hint?: string
        /** 显式目标：节点刚创建、hook 状态还没跟上时用 */
        target?: AgentRunTarget
        /** 附带的图片附件 */
        images?: PendingImage[]
        /** 附带的文件附件 */
        files?: PendingFile[]
      },
    ) => {
      let target = opts?.target ?? null
      if (!target) {
        const s = getLatest()
        const targetNodeId = opts?.nodeId ?? nodeId ?? s.activeNodeId ?? null
        const targetNode = targetNodeId ? nodeById(s, targetNodeId) : null
        const targetGoalId = targetNode?.goalId ?? goalId ?? s.activeGoalId ?? null

        if (targetGoalId) {
          // 外部触发的工作流必须优先使用当前显示的上下文（正在交互的导师会话）
          const convId =
            (conversationId && conversationById(s, conversationId)?.goalId === targetGoalId
              ? conversationId
              : null) ?? resolveDisplayedConversation(s, targetGoalId)

          const nid =
            (targetNode && targetNode.goalId === targetGoalId ? targetNode.id : null) ??
            (nodeId && nodeById(s, nodeId)?.goalId === targetGoalId ? nodeId : null) ??
            (s.goals.find((g) => g.id === targetGoalId)?.rootNodeId || s.nodes.find((n) => n.goalId === targetGoalId)?.id || null)


          if (convId) {
            target = { goalId: targetGoalId, nodeId: nid || null, conversationId: convId }
          }
        }
      }
      if (!target) return
      const found = findWorkflow(getLatest(), target.goalId, ref)
      if (!found) {
        onNoticeRef.current?.(t('没有叫「{0}」的工作流（列表见超级导师设置，或让导师 api.wf.list()）', ref))
        return
      }
      // 响铃：workflowPrep 说该响就响一声（提醒用户「导师要问你东西了」）
      if (workflowPrep(found.prep).beep) {
        try {
          native().window.beep()
        } catch {
          // 测试环境没有 native 桥：提醒本来就是「尽力」
        }
      }
      // 档位全应用唯一（全局滑条）：聊天轮与工作流轮同档，绝不自动翻面（见 learn/effortGuard）。
      // 把这一轮的 promise 交回给调用方：手动压缩要知道「这一轮什么时候跑完」（见 compactNow）
      return runTurn(
        target,
        renderWorkflowInstruction(found.instruction, opts?.params),
        true,
        opts?.hint,
        undefined,
        opts?.images,
        opts?.files,
        found.name,
        // 压缩轮跑完不再触发自动压缩（否则写不成摘要时会一轮接一轮，见 isCompactTurn 的说明）
        found.id === 'compact',
        // 触发时随指令注入的提示词模块（内置 promptModule / 登记的 prompt；
        // 同一上下文只注一次，重复触发靠活消息上的标记去重）
        workflowModules(found),
        // 启动实参随指令落库：分界条展开时画参数行、高亮指令里对应的文字
        opts?.params,
      )
    },
    [nodeId, conversationId, getLatest, runTurn],
  )

  /**
   * 手动压缩（「更多 → 压缩上下文」）：跑一轮**压缩工作流**。convId 缺省 = 当前会话；
   * keepalive 的页签面板各自传自己的会话（压缩中标记也按会话记，见 compactingConv）。
   *
   * 与上一版的分别：不再由宿主另起一次「把历史重发一遍再总结」的模型请求——
   * 导师本来就看得到整段上下文，让它自己把摘要写出来（见 learn/compact 与工作流指令）。
   * 「旧消息失活」发生在那轮 loop 结束时（见 runTurn 的 finally）。
   */
  const compactNow = useCallback(async (convId?: string) => {
    const id = convId ?? conversationId
    if (!id) return
    if (running[id]) {
      onNoticeRef.current?.(t('导师正在回答，等这一轮结束再压缩'))
      return
    }
    const latest = getLatest()
    const conv = conversationById(latest, id)
    if (!conv) return
    if (activeMessages(conv.messages).length < MIN_ACTIVE_MESSAGES) {
      onNoticeRef.current?.(t('这一段对话还很短，现在压缩省不下什么'))
      return
    }
    setCompactingConv(id)
    try {
      // 显式会话：目标整份给全（nodeId 取该目标的总目标节点，压缩轮不看节点，只为凑齐 target）
      if (convId && id !== conversationId) {
        const goal = latest.goals.find((g) => g.id === conv.goalId)
        await runWorkflow('compact', {
          target: { goalId: conv.goalId, nodeId: goal?.rootNodeId || null, conversationId: id },
        })
      } else {
        await runWorkflow('compact')
      }
    } finally {
      setCompactingConv(null)
    }
  }, [conversationId, running, getLatest, runWorkflow])

  /**
   * 到阈值自动压缩：本轮结束后起一轮压缩工作流（触发点在 runTurn 的 finally）。
   *
   * 为什么走 ref 而不是直接调：runTurn 定义在 runWorkflow 之前，它的 finally 里要用到
   * 「现在能不能自动压、怎么起一轮」；挂在 ref 上每次渲染刷新，闭包永远是最新的一份。
   * 压缩轮自己不会再触发（它一定产生了 applied.label），所以不会自激。
   */
  const autoCompactRef = useRef<((ratio: number) => void) | null>(null)
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
    autoCompactRef.current = (ratio: number) => {
      onNoticeRef.current?.(t('上下文已用到 {0}%，正在压缩前面的对话…', Math.round(ratio * 100)))
      void runWorkflow('compact')
    }
    wfDrainRef.current = (target: AgentRunTarget) => {
      const q = pendingWfRef.current.get(target.conversationId)
      if (!q || !q.length) {
        // 链断了（这一轮没再交活）：这条会话的触发计数归零，下次重新数
        wfChainRef.current.delete(target.conversationId)
        return false
      }
      const next = q.shift() as { id: string; params?: Record<string, string | number> }
      if (!q.length) pendingWfRef.current.delete(target.conversationId)
      wfChainRef.current.set(target.conversationId, (wfChainRef.current.get(target.conversationId) ?? 0) + 1)
      void runWorkflow(next.id, { params: next.params, target })
      return true
    }
  })

/**
 * 新建普通节点 / 学习目标后的隐藏指令（「开讲」与「学习大纲」两个**内置工作流**）。
 *
 * 节点现在是**先建出来、再交给 Agent 收拾**的：标题先用用户选中的原词占位，
 * 描述与教学文档都由 Agent 来写。这么做是为了让用户点一下就立刻得到反馈——
 * 旧流程要先等一次「生成描述」的模型请求，描述回来了 Agent 才开始工作，
 * 用户盯着空文档要多等好几秒，那几秒里他看不到任何东西在发生。
 *
 * 指令文本本体在 learn/workflows（与其它内置工作流统一管理；autoTeach 只是
 * 「带显式目标触发一次工作流」的旧入口）。
 */

  /**
   * 创建节点后自动开讲（隐藏指令，不展示给用户）；目标节点走大纲指令。
   * extra 是额外上下文（如 AI 大纲里那句定位说明），跟着这一轮进模型。
   * attachments 是目标创建或新建节点时带进来的图片与文件附件。
   */
  const autoTeach = useCallback(
    (
      target: AgentRunTarget,
      _goal = false,
      extra?: string,
      attachments?: { images?: PendingImage[]; files?: PendingFile[] },
    ) => {
      runWorkflow('teach-node', {
        target,
        hint: extra,
        params: target.nodeId ? { target: target.nodeId } : {},
        images: attachments?.images,
        files: attachments?.files,
      })
    },
    [runWorkflow],
  )

  /**
   * 发起一次隐藏指令（交卷后的自动阅卷、一键出题）。
   * nodeId 可覆盖：这些指令有时是冲着刚切过去的那个节点发的，
   * 但那一帧 store.activeNodeId 还没更新。
   *
   * 目标归属**按节点算**，不再借用当前会话：agent 栏页签化之后，「眼前看的是哪位导师」
   * 与「这件事该归哪位导师」是两回事——交卷的节点属于目标 B 时，哪怕页签停在 A 的
   * 导师上，阅卷也得进 B 的会话。目标没有会话时现场建一段（addConversation 不换激活态）。
   */
  const runHidden = useCallback(
    (text: string, on?: string, mark?: string) => {
      const s = getLatest()
      const target = on ?? nodeId
      const node = target ? nodeById(s, target) : null
      if (!node) return
      // 节点属于当前会话的目标时直接用当前会话；否则落到该目标当前显示的上下文（没有就新建）
      const conv =
        (conversationId && conversationById(s, conversationId)?.goalId === node.goalId
          ? conversationId
          : null) ??
        resolveDisplayedConversation(s, node.goalId) ??
        (() => {
          const made = addConversation(s, node.goalId)
          set(made.store)
          return made.conversation.id
        })()
      void runTurn({ goalId: node.goalId, nodeId: node.id, conversationId: conv }, text, true, undefined, undefined, undefined, undefined, mark)
    },
    [nodeId, conversationId, getLatest, set, runTurn],
  )

  const stop = useCallback(
    (convId?: string) => {
      const id = convId ?? conversationId
      if (!id) return
      abortMapRef.current.get(id)?.abort()
      // 子代理在后台跑：停止这一轮时把当前对话所有在跑的一并中断（级联）
      subManagersRef.current.get(id)?.abortAll()
    },
    [conversationId],
  )

  /* ---------- 等待队列：导师在跑时用户发出去的消息排在这里（见 learn/agentQueue） ---------- */

  /**
   * 写队列：state 与 ref 一起更新，两份永远同进同出。
   *
   * 两条路都要写：渲染读 state；派发路径（收口回调、立即发送、撤回）读 ref——它们都在
   * 事件回调里跑，而 setState 是异步的，收口那一刻读 state 读到的会是上一轮队列。
   * 空队列不留键（与 store 里其它可选字段同一条规矩）。
   */
  const writeQueue = useCallback((convId: string, update: (cur: QueuedMessage[]) => QueuedMessage[]) => {
    const next = update(queuesRef.current[convId] ?? [])
    const map = { ...queuesRef.current }
    if (next.length) map[convId] = next
    else delete map[convId]
    queuesRef.current = map
    setQueues(map)
  }, [])

  /**
   * 把一条排队消息真正发出去：导师轮走 runTurn（带着排进队列时记下的目标——那一刻他在
   * 哪个目标/节点下，就发到哪个目标/节点），自由聊天走 sendFree。
   *
   * 附件在此刻**交棒**：这一轮转存读的是 File 原件，预览地址随即可放（与「直接发送」
   * 那条路的时机一致）；不放就是每发一条图漏一份内存。
   */
  const dispatchQueued = useCallback(
    (m: QueuedMessage) => {
      releasePending(m.images)
      if (m.free) {
        sendFree(m.conversationId, m.text, { images: m.images, files: m.files })
        return
      }
      if (!m.target) return
      void runTurn(m.target, m.text, false, undefined, undefined, m.images, m.files)
    },
    [runTurn, sendFree],
  )

  /**
   * 队列往前走一步：把队首发出去。
   *
   * 这是**唯一的派发入口**，三处会来敲它：一轮收口时（runTurn / sendFree 的 finally）、
   * 用户刚排进一条时（若这一轮其实已经收口了，不必干等下一次收口）、以及「立即发送」。
   * 判据只有一条「链上还有没有轮次」——有就什么都不做，那一轮会走到自己的 finally。
   */
  useEffect(() => {
    drainQueueRef.current = (convId: string) => {
      // 还有轮次在跑（或在链上排着）：它收口时会再敲一次，这里不抢
      if (turnChainRef.current.has(convId)) return
      const head = queueOf(queuesRef.current, convId)[0]
      if (!head) return
      /*
       * 没配 Key 就先不动它：发出去也只会换来一次「请先填 Key」，而这条消息会从队列里
       * 消失——用户写的字不该被这样吞掉。留在队里，等他配好 Key 之后下一次收口再走。
       */
      if (!hasApiKey(loadAiSettings())) {
        onNeedKeyRef.current()
        return
      }
      writeQueue(convId, (cur) => dropQueuedItem(cur, head.id))
      dispatchQueued(head)
    }
  })

  /**
   * 把一条消息排进队尾（宿主在「导师正在跑、或队列里还排着人」时调它，见 learn/agentQueue
   * 的 shouldEnqueue）。排完立刻试走一步：用户刚点完停止又发了一条，那会儿链上已经空了，
   * 没有这一步就要干等到下一轮收口——而下一轮可能永远不会来。
   */
  const enqueueMessage = useCallback(
    (item: Omit<QueuedMessage, 'id' | 'at'>) => {
      const m: QueuedMessage = { ...item, id: crypto.randomUUID(), at: Date.now() }
      writeQueue(m.conversationId, (cur) => enqueueQueued(cur, m))
      drainQueueRef.current(m.conversationId)
    },
    [writeQueue],
  )

  /** 撤回一条：它还没跑起来，摘掉就是摘掉——附件也一并放掉（那张图再也用不到了） */
  const dropQueuedMessage = useCallback(
    (convId: string, id: string) => {
      const item = queueOf(queuesRef.current, convId).find((m) => m.id === id)
      if (!item) return
      releasePending(item.images)
      writeQueue(convId, (cur) => dropQueuedItem(cur, id))
    },
    [writeQueue],
  )

  /**
   * 立即发送一条：不等了，就它先来。
   *
   * 当前这一轮若还在跑，**先把它停掉**——用户点的就是「现在」，而一轮 Agent 是一次
   * 完整的模型循环，半路挤一条进去会让这一轮实发的上下文自相矛盾（见 agent/prefixGate）。
   * 停掉之后那条消息接在链上：它并不与刚中止的那一轮并行，而是等它真的收口（几毫秒的事，
   * 中止是立刻生效的），所以上下文仍然干净。其余排队的原样留在队里，这条之后继续走。
   */
  const sendQueuedNow = useCallback(
    (convId: string, id: string) => {
      const { item, rest } = takeQueued(queueOf(queuesRef.current, convId), id)
      if (!item) return
      writeQueue(convId, () => rest)
      if (turnChainRef.current.has(convId)) stop(convId)
      dispatchQueued(item)
    },
    [writeQueue, stop, dispatchQueued],
  )

  /**
   * 继续「应用退出时被中断」的那一轮（消息列表中断说明旁的「继续」按钮）。
   * target 缺省按当前会话；keepalive 的页签面板各自传自己的目标。
   *
   * 走一条**隐藏指令**起一轮新的 loop：被中断的那条回复已经收口（恢复是载入时做的，
   * inflight 标记已清），旧轮次本身救不回来——能做的是让导师读到中断说明后接着做。
   * 指令不显示（中断说明本身已经把事情讲清楚了，再来一个用户气泡只会占地方），
   * 但带 mark：对话里落一条「继续」分界条，这一轮在长对话里找得回来。
   */
  const resumeInterrupted = useCallback(
    (override?: AgentRunTarget) => {
      // 局部变量避开 t：外层那个 t 是 i18n 函数，指令文本要用它
      const tgt = override ?? (goalId && conversationId ? { goalId, nodeId: nodeId || null, conversationId } : null)
      if (!tgt) return
      if (running[tgt.conversationId]) {
        onNoticeRef.current?.(t('导师正在回答，等这一轮结束再继续'))
        return
      }
      void runTurn(
        tgt,
        t('上一轮回复在应用退出时被中断，以上是中断前保存的进度。请从中断处接着做，把没完成的部分完成；已经完成的部分不要重做。'),
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        t('继续'),
      )
    },
    [goalId, nodeId, conversationId, running, runTurn],
  )

  /**
   * 当前会话的实时槽。分槽之后同一时刻可能有几位导师都在跑，这里只交出
   * **眼前这一位**的那一份——面板渲染的是激活页签；页签守卫读的是整张表（见下）。
   */
  const streamingLive = conversationId ? (streaming[conversationId] ?? null) : null
  const streamingParts = streamingLive?.parts ?? null

  /**
   * 子代理视图数据：当前对话的会话列表 + 正在跑的那场的实时输出。
   * 面板据此画入口按钮（会话数）、弹出列表与子会话视图（实时流式与导师视图同一套渲染）。
   */
  const subBucket = conversation?.subagents

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
    /** 全部在跑的子代理实时槽（带 conversationId）：每枚页签的 sub 数据各筛各的 */
    subRunsAll: subRuns,
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
    /** api.ask 的表单状态与两条出口（由 AgentPanel 渲染成输入框上方的卡片） */
    pendingAsk: conversationId ? (pendingAsk[conversationId] ?? null) : null,
    submitAsk,
    cancelAsk,
    /** 最近一跳实测的输出速度（tok/s）；没在跑、或服务端没流式回包时为 null */
    tps: conversationId ? (tps[conversationId] ?? null) : null,
    /** 正在跑的这一轮到目前为止的账（每跳 usage 重算）：上下文占用圆环的实时数据源 */
    liveUsage: conversationId ? (liveUsage[conversationId] ?? null) : null,
    /** 子代理：当前对话的会话与各场在跑任务的实时流（见 docs/subagent-architecture.md） */
    sub: {
      sessions: subBucket?.sessions ?? [],
      // 定义只来自本对话（subagent.create 登记的；面板的会话列表按 defKey 认名字）
      defs: subBucket?.defs ?? [],
      running: subRuns.some((r) => r.conversationId === conversationId),
      live: subRuns
        .filter((r) => r.conversationId === conversationId)
        .map(({ sessionId, runId, parts }) => ({ sessionId, runId, parts })),
    },
  }
}
