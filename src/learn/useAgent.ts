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
import { runAgent } from '../agent/runtime'
import { createExecuteTool, type AskAnswers, type AskFormPayload, type ExamToolDeps } from '../agent/tools'
import { ASK_IDLE_TIMEOUT_MS } from '../agent/sandbox/limits'
import { ensureActivityListeners, userIdleMs } from '../lib/userActivity'
import { recordContext } from '../agent/contextFilter'
import { assertPrefixStable, resetPrefixGate } from '../agent/prefixGate'
import { globalContextWindow, hasApiKey, loadAiSettings, resolveGlobal } from '../ai/settings'
import type { ReasoningEffort } from '../ai/types'
import { loadAgentSettings } from '../agent/settings'
import type { LearnStore } from './types'
import { buildTeacherSystem } from './ai'
import { MIN_ACTIVE_MESSAGES, activeMessages, applyCompaction, shouldCompact } from './compact'
import { needsPersonaAnnounce, personaMessage } from '../agent/persona'
import { conversationById, nodeById } from './graph'
import { currentNodeBlock, makeExamTool } from './agentOps'
import { findWorkflow, renderWorkflowInstruction, resolveWorkflowEffort, workflowPrep } from './workflows'
import { generateConversationTitle, namingSource } from './title'
import { createMindOps } from './mind'
import { saveScreenshot } from './screenshots'
import { makeBrowserOps, type BrowserDeps } from './web/browserOps'
import { loadImagesById, loadImagesFor } from './images'
import { native } from '../lib/native'
import { applyEvent } from './agent/events'
import { toChatHistory } from './agent/history'
import { TURN_FLUSH_MS, upsertAssistantInFlight } from './agent/inflight'
import { loadAttachTexts, transferPendingFiles, transferPendingImages } from './agent/transfer'
import { applyAskToProfile, learnSandboxOps, type AgentRunTarget, type AgentUiDeps } from './agent/sandboxOps'
import { createSubAgentTools } from '../agent/subagent/tools'
import { BUILTIN_SUBAGENTS } from '../agent/subagent/builtin'
import { EMPTY_SUB_BUCKET } from '../agent/subagent/registry'
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
  /** browser.* 的宿主依赖工厂（web 页签动作与活信息，见 learn/web/browserOps）；不注入就没有这一组 */
  browserDeps?: () => BrowserDeps | undefined
}) {
  const { store, set, getLatest, goalId, nodeId, conversationId, onNeedKey, examDeps } = opts
  /**
   * 界面侧能力（ui.*）走 ref 而不是闭包：runTurn 的依赖数组不追它，
   * 直接解构会永远拿到首轮那份旧回调（agentLeft 一变，switchMain 就指错方向）。
   */
  const uiRef = useRef(opts.ui)
  /** browser.* 的宿主依赖（web 页签动作与活信息）：同 uiRef 的理由，每渲染刷新 */
  const browserFnRef = useRef(opts.browserDeps)
  useEffect(() => {
    uiRef.current = opts.ui
    browserFnRef.current = opts.browserDeps
  })
  const [streaming, setStreaming] = useState<{ conversationId: string; messageId: string; parts: AgentPart[] } | null>(
    null,
  )
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  /** 同一会话的轮次串行化（见 runTurn 的说明）：conversationId → 在途轮次的结束承诺 */
  const turnChainRef = useRef(new Map<string, Promise<void>>())
  const onNeedKeyRef = useRef(onNeedKey)
  /** 转存失败之类的话要能说出来，但不该进 runTurn 的依赖（回调每次渲染都是新的） */
  const onNoticeRef = useRef(opts.onNotice)
  /**
   * api.ask 的待回答表单与它的「收卷人」。ask 在工具执行里阻塞等待，
   * 表单提交 / 取消 / 停止按钮三条路都要能把它唤醒（见 runTurn 里的装配）。
   */
  const [pendingAsk, setPendingAsk] = useState<{ id: string; form: AskFormPayload } | null>(null)
  const askWaiterRef = useRef<((value: unknown) => void) | null>(null)
  /** api.iwanna 预告的计划：一轮跑完就清掉（它说的是「接下来」，不是「做过什么」） */
  const [iwanna, setIwanna] = useState<string[] | null>(null)
  /**
   * 最近一跳实测的输出速度（tok/s，见 ChatUsage.tps）。轮次开始时清零，
   * 每跳 usage 带着它来就更新——输入区的状态条读它（跑完之后回退到消息里的存量）。
   */
  const [tps, setTps] = useState<number | null>(null)
  /**
   * 正在跑的这一轮**到目前为止**的账（每跳 usage 来就重算一份）。
   * 输入区的上下文占用圆环要的是「现在这一跳结束时占了多少」，而不是整轮跑完、
   * 落进会话的那一份——一轮里模型要来回好几跳，每跳输入都在涨，等轮末才更新
   * 圆环就错过了全程。轮次结束随落库一起清空（圆环回退到持久化的那份）。
   */
  const [liveUsage, setLiveUsage] = useState<MessageUsage | null>(null)

  /**
   * 子代理会话住在 Conversation.subagents 上、随 chat.json 落盘（生命周期 = 这段
   * 导师对话，见 docs/subagent-architecture.md）——这里不再另立状态，读走对话、
   * 写走 setBucket（在 createSubAgentTools 的装配处）。唯一留在内存的是 subLive：
   * 正在跑的那场任务的流式输出（落库只在任务收口时发生一次）。
   */
  const [subLive, setSubLive] = useState<{
    conversationId: string
    sessionId: string
    runId: string
    parts: AgentPart[]
  } | null>(null)

  useEffect(() => {
    onNeedKeyRef.current = onNeedKey
    onNoticeRef.current = opts.onNotice
  })

  useEffect(() => () => abortRef.current?.abort(), [])

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

  /** 用户在表单卡里点了「提交」：把答案交回给阻塞中的沙箱 */
  const submitAsk = useCallback((answers: AskAnswers) => {
    askWaiterRef.current?.({ ok: true, cancelled: false, answers })
  }, [])

  /** 用户点了「不回答了」：告诉沙箱没有答案（不是失败，别让它把取消当成错误重试） */
  const cancelAsk = useCallback(() => {
    askWaiterRef.current?.({
      ok: true,
      cancelled: true,
      answers: [],
      note: '用户取消了表单，没有给出任何回答。不要假设他的偏好或答案；把要问的话直接写进回复里，或先继续不需要回答的部分。',
    })
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
       * 这一轮的思考档位覆盖。聊天轮不传（用全局滑条）；工作流轮由 runWorkflow 按
       * 三态配置解析好再传进来（见 resolveWorkflowEffort）——聊天滑条只对聊天轮
       * 直接生效，工作流轮的档位独立于它。
       */
      effortOverride?: ReasoningEffort,
    ) => {
      const trimmed = text.trim()
      if (!trimmed) return
      const settings = loadAiSettings()
      const before = getLatest()
      if (!nodeById(before, target.nodeId)) return

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
      if (attached.error) onNoticeRef.current?.(attached.error)
      const attachedFiles = files?.length
        ? await transferPendingFiles(getLatest, set, target.goalId, files)
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
       * 当前节点信息跟着每条消息走：系统提示词固定在目标一级（切节点不作废前缀缓存），
       * 「此刻在哪个节点、它写过什么」就只能靠这条隐藏上下文交代。调用方给的上下文
       * （如选段位置）接在后面，两者一起进模型、都不显示在气泡里。
       */
      const nodeContext = currentNodeBlock(before, target.goalId, target.nodeId)
      const extraContext = context?.trim()
      const userMsg: ConversationMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: trimmed }],
        ts: Date.now(),
        hidden,
        ...(hidden && mark ? { mark } : {}),
        context: extraContext ? nodeContext + '\n\n' + extraContext : nodeContext,
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
      const personaId = loadAgentSettings().persona
      const announcer = needsPersonaAnnounce(conv.messages, personaId)
        ? [personaMessage(personaId, Date.now(), crypto.randomUUID())]
        : []
      conv = {
        ...conv,
        messages: [...conv.messages, ...announcer, userMsg],
        updatedAt: Date.now(),
        // 在途标记：这一轮没收口（进程被杀）时，载入恢复据此找到这条回复（见 learn/agent/inflight）
        inflight: { messageId: assistantId, startedAt: Date.now() },
      }
      persist(conv)
      // 这一段对话还没有标题就顺手起一个（不阻塞这一轮，见 nameConversation）
      nameConversation(conv)

      /**
       * 唯一的工具：模型写一段 JS，经由沙箱里的 api 完成读写。
       * 文档、节点、描述、试卷、临时变量、长期记忆、人机协作（ask / iwanna / tiktok）
       * 与界面操作（ui.*）的全部能力都从这里进出（见 agent/tools）。
       */
      const ctrl = new AbortController()
      const signal = ctrl.signal
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
       * execute 拿全量，子代理按定义的 apiGroups 取子集（见 createSubAgentTools）。
       */
      const sandboxBase = learnSandboxOps({
        getLatest,
        set,
        // 这一轮冲着来的节点是沙箱里的「当前节点」——不是界面上此刻选中的那个
        nodeId: () => target.nodeId,
        goalId: () => target.goalId,
      })
      /** 子代理实时槽的 parts 按次累积（runId → parts），任务结束随手清掉 */
      const subRunParts = new Map<string, AgentPart[]>()
      const tools = [
        createExecuteTool({
          ...sandboxBase,
          /*
           * 考试工具：作用对象是这一轮冲着来的那个节点（target.nodeId），
           * 不是「此刻界面上选中的那个」——一轮可能跑好几十秒，期间用户切了节点
           * 也不该把阅卷对象换掉。
           *
           * 「读永远成功、写才看阶段」的翻译全在 learn/agentOps 的 makeExamTool 里
           * （纯装配，Node 探针钉得住）。
           */
          exam: (() => {
            const deps = examDeps?.(target.nodeId)
            return deps ? makeExamTool(deps) : undefined
          })(),
          // 用户点「停止」时，正在等用户的 ask 与正在睡的 wait 要能立刻退场
          signal,
          /** 长期记忆：按目标归档；绝不自动拼进上下文，agent 需要时主动读写 */
          mind: createMindOps({ getLatest, set, goalId: () => target.goalId }),
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
          ask: (form) =>
            new Promise<unknown>((resolve) => {
              let idleTimer: ReturnType<typeof setInterval> | null = null
              const finish = (value: unknown): void => {
                if (askWaiterRef.current !== finish) return
                askWaiterRef.current = null
                signal.removeEventListener('abort', onAbort)
                if (idleTimer) clearInterval(idleTimer)
                setPendingAsk(null)
                // 标了 userInfo 的题目：答案在**用户提交的那一刻**就落进画像（见 user/fields），
                // 导师拿到答案时画像已经写好了——不必再 update 一遍，也就没有「转述走样」这一步
                void applyAskToProfile(form, value).then(resolve, () => resolve(value))
              }
              const onAbort = () =>
                finish({ ok: false, content: '用户停止了这一轮，表单已关闭。不要假设用户的回答。' })
              signal.addEventListener('abort', onAbort, { once: true })
              askWaiterRef.current = finish
              setPendingAsk({ id: crypto.randomUUID(), form })
              /*
               * 表单限时：挂出一分钟后用户**没有任何操作**（鼠标键盘都不动，任意操作都会续住它，
               * 见 lib/userActivity）就自动收起并带回 timedOut——agent 据此自行决定继续或交付，
               * 不能为一个没人理的表单把整轮沙箱无限吊着。
               */
              ensureActivityListeners()
              idleTimer = setInterval(() => {
                if (askWaiterRef.current !== finish) return
                if (userIdleMs() >= ASK_IDLE_TIMEOUT_MS) {
                  finish({
                    ok: false,
                    timedOut: true,
                    content: '表单挂出一分钟，用户没有任何操作（超时自动收起）。不要假设用户的回答。',
                  })
                }
              }, 5_000)
            }),
          iwanna: (items) => setIwanna(items),
          tiktok: async () => {
            // Electron 的 beep：响一声即返回；不在 Electron 里跑时静默跳过
            try {
              native().window.beep()
            } catch {
              // 测试环境没有 native 桥：tiktok 本来就是「尽力提醒」
            }
          },
          ui: {
            ...(uiDeps?.switchMain ? { switchMain: uiDeps.switchMain } : {}),
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
                      note:
                        '截图已存进资源库（res.list 里能看到），并附在你的下一步里——它同时会出现在文档侧的资源清单中。',
                      images: [saved.image],
                    }
                  },
                }
              : {}),
          },
          // 内置浏览器（browser.*）：宿主依赖在场的回合才有这一组（见 learn/web/browserOps）
          ...(browserDeps ? { browser: makeBrowserOps(browserDeps, target.goalId) } : {}),
        }),
        /**
         * 子代理三件工具（agent_define / agent_run / agent_list）：每轮都声明、
         * 形状不变——工具声明参与前缀，中途换工具集会把缓存整段作废。
         * agent_run 阻塞到子代理交付，导师的循环在它返回前不会前进（「父等子」）。
         */
        ...createSubAgentTools({
          conversationId: target.conversationId,
          sandbox: sandboxBase,
          provider: global.provider,
          model: global.model,
          effort: effortOverride ?? global.effort,
          contextWindow: window,
          signal,
          // 子代理桶住在对话上：现读走 getLatest，写回 = 更新这条对话（persist 走落盘队列）
          getBucket: () => conversationById(getLatest(), target.conversationId)?.subagents ?? EMPTY_SUB_BUCKET,
          setBucket: (update) => {
            const stored = conversationById(getLatest(), target.conversationId)
            if (!stored) return
            const next = update(stored.subagents ?? EMPTY_SUB_BUCKET)
            // 空桶不存字段：没有子代理的对话不该在 chat.json 里多一截空结构
            persist({ ...stored, subagents: next.defs.length || next.sessions.length ? next : undefined })
          },
          onEvent: (sessionId, runId, e) => {
            let runParts = subRunParts.get(runId)
            if (!runParts) {
              runParts = []
              subRunParts.set(runId, runParts)
            }
            applyEvent(runParts, e)
            setSubLive({
              conversationId: target.conversationId,
              sessionId,
              runId,
              parts: [...runParts],
            })
          },
          onRunEnd: (_sessionId, runId) => {
            subRunParts.delete(runId)
            setSubLive((cur) => (cur && cur.runId === runId ? null : cur))
          },
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
      setStreaming({ conversationId: target.conversationId, messageId: assistantId, parts: [] })
      setRunning(true)
      setTps(null)
      setLiveUsage(null)
      // ctrl 在上面的工具装配处创建（ask / wait 的中止语义需要它），这里只挂到 ref 上
      abortRef.current = ctrl
      try {
        await runAgent({
          provider: global.provider,
          model: global.model,
          // 工作流轮的档位由触发方按三态配置解析好传进来；聊天轮用全局滑条
          reasoningEffort: effortOverride ?? global.effort,
          /**
           * 系统提示词只描述**目标**，不含当前节点。
           *
           * 这是目标级上下文的关键：切节点时系统提示词一字不变，服务端的前缀缓存
           * 才不会被整段作废；「此刻在哪个节点」由每条消息带的隐藏上下文交代
           * （见 currentNodeBlock）。目标问题取自用户原话，Agent 之后改标题也不会动它。
           */
          system: buildTeacherSystem({
            goalQuestion: getLatest().goals.find((g) => g.id === target.goalId)?.question ?? '',
            // 画像**不在这里传**：导师要贴合这个人时自己 api.userInfo.get() 取（见 ai 的说明）
          }),
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
           * 上下文过滤器：每跳请求发出前把实发的上下文交给过滤器记录（见 agent/contextFilter）。
           * 只在开发者模式的调试器开着时才记——快照会拷下整段历史，平时不值得花这个内存。
           */
          onContext: (snapshot) => {
            // 前缀门禁：此刻的 system / messages / tools 与实发完全一致（见 agent/runtime），
            // 正好在发出去之前对一遍账（见 agent/prefixGate）
            assertPrefixStable(
              target.conversationId,
              snapshot.messages,
              snapshot.tools as Parameters<typeof assertPrefixStable>[2],
            )
            if (loadAgentSettings().dev.contextDebugger) recordContext(snapshot)
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
              if (e.usage.tps) {
                tally.tps = e.usage.tps
                setTps(e.usage.tps)
              }
              // 圆环的实时账：每跳结束就重算一份（与轮末落库的 shape 完全一致）
              setLiveUsage({
                contextTokens: tally.context,
                contextWindow: window,
                totalTokens: tally.total,
                outputTokens: tally.output,
                cacheReadTokens: tally.read,
                cacheMissTokens: tally.miss,
                estimated: tally.estimated,
                ...(tally.tps ? { tps: tally.tps } : {}),
              })
            } else if (e.type === 'pace') {
              // 输出中的实时估算：每秒一条，先撑起数字，结束时由精确值替换
              setTps(e.tps)
            }
            applyEvent(parts, e)
            // 里程碑立即落库，流式内容节流（见 flushTurn 的说明）
            if (e.type === 'tool-call' || e.type === 'tool-result' || e.type === 'notice') scheduleFlush(true)
            else if (e.type === 'text' || e.type === 'thinking') scheduleFlush(false)
            setStreaming({ conversationId: target.conversationId, messageId: assistantId, parts: [...parts] })
          },
        })
      } finally {
        abortRef.current = null
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
              ts: Date.now(),
            }
            persist(upsertAssistantInFlight(stored, assistantMsg, true))
          }
        }
        setRunning(false)
        setStreaming(null)
        // 实时账功成身退：落库的那一份已经进会话，圆环从它读同一口径的数
        setLiveUsage(null)
        // 「接下来要做」只属于跑着的那一轮；表单若还挂着（异常路径）也一并收掉
        setIwanna(null)
        setPendingAsk(null)

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
        } else if (after && autoCompactRef.current && !isCompactTurn) {
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
    [examDeps, getLatest, nameConversation, persist, set],
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
      effortOverride?: ReasoningEffort,
    ) => {
      if (!text.trim()) return
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
        await runTurnUnchecked(target, text, hidden, context, quote, pending, files, mark, isCompactTurn, effortOverride)
      } finally {
        release()
        if (chain.get(target.conversationId) === ticket) chain.delete(target.conversationId)
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
      opts?: { context?: string; quote?: MessageQuote; images?: PendingImage[]; files?: PendingFile[] },
    ) => {
      if (!goalId || !nodeId || !conversationId) return
      void runTurn(
        { goalId, nodeId, conversationId },
        text,
        false,
        opts?.context,
        opts?.quote,
        opts?.images,
        opts?.files,
      )
    },
    [goalId, nodeId, conversationId, runTurn],
  )

  /**
   * 手动压缩上下文（输入区「更多 → 压缩上下文」）。
   *
   * 与自动压缩共用 summarize，差别只在谁触发（记进摘要里，界面上那句说明会跟着变）。
   * 跑着的时候不让压：这一轮结束时还要往会话里写回复，中途把历史换掉，
   * 那一轮的结果就落在一份已经作废的历史上了。
   */
  const [compacting, setCompacting] = useState(false)

  /**
   * 触发一个工作流（内置或登记过的）。指令以 **user 角色**整段进入上下文（隐藏消息，
   * 带名字作分界条），不碰系统提示词——这是「工作流」与「提示词」的分界，登记表也照此语义存储。
   *
   * target 缺省按当前会话目标（runHidden 的老规矩）；autoTeach 那类「节点刚建、状态还没切过去」
   * 的调用方传显式 target。
   *
   * 触发前那两下（响铃、切主位）**只有 prep: 'ask' 才做**，见下面那一段的说明。
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
      },
    ) => {
      const target =
        opts?.target ??
        (goalId && conversationId && (opts?.nodeId ?? nodeId)
          ? { goalId, nodeId: opts?.nodeId ?? (nodeId as string), conversationId }
          : null)
      if (!target) return
      const found = findWorkflow(getLatest(), target.goalId, ref)
      if (!found) {
        onNoticeRef.current?.(t('没有叫「{0}」的工作流（列表见超级导师设置，或让导师 api.wf.list()）', ref))
        return
      }
      /*
       * 触发前那两下：响铃归两种 prep，**切主位只归 'ask'**（规矩与理由见 workflowPrep）。
       * 一句话：切主位是从用户手里抢视线，只有「不回答就走不下去」的表单才值得；
       * 「伪编译」那种交付物在对话里的，回执画在他点的地方，不该把面板拽过来。
       */
      const pre = workflowPrep(found.prep)
      if (pre.beep) {
        try {
          native().window.beep()
        } catch {
          // 测试环境没有 native 桥：提醒本来就是「尽力」
        }
      }
      if (pre.takeMain) uiRef.current?.switchMain?.('agent')
      // 这一轮的思考档位按三态配置解析：'default' 用内置推荐、'chat' 跟随滑条、其余固定档。
      // 聊天滑条只对聊天轮直接生效——工作流的档位独立于它（见 resolveWorkflowEffort）。
      const effort = resolveWorkflowEffort(found, resolveGlobal().effort)
      // 把这一轮的 promise 交回给调用方：手动压缩要知道「这一轮什么时候跑完」（见 compactNow）
      return runTurn(
        target,
        renderWorkflowInstruction(found.instruction, opts?.params),
        true,
        opts?.hint,
        undefined,
        undefined,
        undefined,
        found.name,
        // 压缩轮跑完不再触发自动压缩（否则写不成摘要时会一轮接一轮，见 isCompactTurn 的说明）
        found.id === 'compact',
        effort,
      )
    },
    [goalId, nodeId, conversationId, getLatest, runTurn],
  )

  /**
   * 手动压缩（「更多 → 压缩上下文」）：跑一轮**压缩工作流**。
   *
   * 与上一版的分别：不再由宿主另起一次「把历史重发一遍再总结」的模型请求——
   * 导师本来就看得到整段上下文，让它自己把摘要写出来（见 learn/compact 与工作流指令）。
   * 「旧消息失活」发生在那轮 loop 结束时（见 runTurn 的 finally）。
   */
  const compactNow = useCallback(async () => {
    if (!conversationId) return
    if (running) {
      onNoticeRef.current?.(t('导师正在回答，等这一轮结束再压缩'))
      return
    }
    const conv = conversationById(getLatest(), conversationId)
    if (!conv) return
    if (activeMessages(conv.messages).length < MIN_ACTIVE_MESSAGES) {
      onNoticeRef.current?.(t('这一段对话还很短，现在压缩省不下什么'))
      return
    }
    setCompacting(true)
    try {
      await runWorkflow('compact')
    } finally {
      setCompacting(false)
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
  useEffect(() => {
    autoCompactRef.current = (ratio: number) => {
      onNoticeRef.current?.(t('上下文已用到 {0}%，正在压缩前面的对话…', Math.round(ratio * 100)))
      void runWorkflow('compact')
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
   */
  const autoTeach = useCallback(
    (target: AgentRunTarget, goal = false, extra?: string) => {
      runWorkflow(goal ? 'goal-outline' : 'teach-node', { target, hint: extra })
    },
    [runWorkflow],
  )

  /**
   * 发起一次隐藏指令（交卷后的自动阅卷、一键出题）。
   * nodeId 可覆盖：这些指令有时是冲着刚切过去的那个节点发的，
   * 但那一帧 store.activeNodeId 还没更新。
   */
  const runHidden = useCallback(
    (text: string, on?: string, mark?: string) => {
      if (!goalId || !conversationId) return
      const target = on ?? nodeId
      if (!target) return
      void runTurn({ goalId, nodeId: target, conversationId }, text, true, undefined, undefined, undefined, undefined, mark)
    },
    [goalId, nodeId, conversationId, runTurn],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  /**
   * 继续「应用退出时被中断」的那一轮（消息列表中断说明旁的「继续」按钮）。
   *
   * 走一条**隐藏指令**起一轮新的 loop：被中断的那条回复已经收口（恢复是载入时做的，
   * inflight 标记已清），旧轮次本身救不回来——能做的是让导师读到中断说明后接着做。
   * 指令不显示（中断说明本身已经把事情讲清楚了，再来一个用户气泡只会占地方），
   * 但带 mark：对话里落一条「继续」分界条，这一轮在长对话里找得回来。
   */
  const resumeInterrupted = useCallback(() => {
    if (!goalId || !nodeId || !conversationId) return
    if (running) {
      onNoticeRef.current?.(t('导师正在回答，等这一轮结束再继续'))
      return
    }
    void runTurn(
      { goalId, nodeId, conversationId },
      t('上一轮回复在应用退出时被中断，以上是中断前保存的进度。请从中断处接着做，把没完成的部分完成；已经完成的部分不要重做。'),
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      t('继续'),
    )
  }, [goalId, nodeId, conversationId, running, runTurn])

  const streamingLive = streaming && streaming.conversationId === conversationId ? streaming : null
  const streamingParts = streamingLive?.parts ?? null

  /**
   * 子代理视图数据：当前对话的会话列表 + 正在跑的那场的实时输出。
   * 面板据此画入口按钮（会话数）、弹出列表与子会话视图（实时流式与导师视图同一套渲染）。
   */
  const subBucket = conversation?.subagents
  const subLiveHere = subLive && subLive.conversationId === conversationId ? subLive : null

  return {
    conversation,
    streaming: streamingParts,
    /** 轮次进行中那条回复的固定 id：AgentPanel 据此把它从静态列表里剔掉（渲染走 streaming） */
    streamingMessageId: streamingLive?.messageId ?? null,
    running,
    compacting,
    send,
    autoTeach,
    runHidden,
    /** 继续被中断的一轮（消息列表中断说明旁的「继续」按钮），见上方说明 */
    resumeInterrupted,
    /** 触发一个工作流（内置或登记过的）：指令以 user 消息进上下文，见上方说明 */
    runWorkflow,
    compactNow,
    stop,
    /** api.ask 的表单状态与两条出口（由 AgentPanel 渲染成输入框上方的卡片） */
    pendingAsk,
    submitAsk,
    cancelAsk,
    /** api.iwanna 预告的计划（一轮结束自动清空） */
    iwanna,
    /** 最近一跳实测的输出速度（tok/s）；没在跑、或服务端没流式回包时为 null */
    tps,
    /** 正在跑的这一轮到目前为止的账（每跳 usage 重算）：上下文占用圆环的实时数据源 */
    liveUsage,
    /** 子代理：当前对话的会话与实时槽（见 docs/subagent-architecture.md） */
    sub: {
      sessions: subBucket?.sessions ?? [],
      // 定义 = 内置 + 本对话登记的（面板的会话列表按 defKey 认名字与内置标记）
      defs: [...BUILTIN_SUBAGENTS, ...(subBucket?.defs ?? [])],
      running: !!subLiveHere,
      streamingSessionId: subLiveHere?.sessionId ?? null,
      streamingRunId: subLiveHere?.runId ?? null,
      streaming: subLiveHere?.parts ?? null,
    },
  }
}
