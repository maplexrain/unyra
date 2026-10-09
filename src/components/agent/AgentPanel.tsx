import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import type {  AgentPart,
  Conversation,
  MessageImage,
  MessageUsage,
  PendingFile,
  PendingImage,
} from '../../agent/types'
import type { AskAnswers, AskFormPayload } from '../../agent/tools'
import type { PersonaId } from '../../agent/persona'
import type { SubAgentDef, SubAgentSession } from '../../agent/subagent/types'
import type { ReasoningEffort } from '../../ai/types'
import PersonaPicker from './PersonaPicker'
import { ImageLightbox, PendingLightbox } from './panel/Images'
import { MsgRail } from './panel/MsgRail'
import type { MsgAnchor } from './panel/types'
import { useMessageList } from './panel/useMessageList'
import { ComposerUi } from './panel/useComposerUi'
import { PaceStrip } from './panel/PaceStrip'
import { FollowLatestButton } from './panel/MessageBubble'
import { SubAgentMenu } from './panel/SubAgentMenu'
import { toolLabel } from './panel/toolLabel'
import { useComposer } from './panel/useComposer'
import { useMsgRail } from './panel/useMsgRail'
import { useScrollFollow } from './panel/useScrollFollow'
import { t, useLocale } from '../../i18n'

/**
 * AI Agent 面板：按顺序呈现「思考过程 → 工具调用 → 回复正文」。
 * 支持多对话（每个目标可开多个）、消息编辑与删除；隐藏的内部指令不展示。
 *
 * 拆到 panel/ 之后的这份文件只剩「读 props → 组织布局 → 接起来」：
 * 滚动跟随见 panel/useScrollFollow、定位条见 panel/useMsgRail + panel/MsgRail、
 * 消息列表见 panel/MessageList、输入区见 panel/Composer（菜单在 panel/PlusMenu）。
 */

interface Props {
  nodeTitle: string
  conversation: Conversation | null
  conversations: Conversation[]
  streaming: AgentPart[] | null
  /** 自由聊天（固定页签）：没有导师身份——子代理、人格与「正在辅导」全部收起 */
  free?: boolean
  /** 轮次进行中那条回复的 id：它在轮次内就分次进了会话（增量落库），列表里要剔掉防止两边都画 */
  streamingMessageId: string | null
  running: boolean
  hasKey: boolean
  /** 当前提供商的显示名，仅用于「未配置」提示 */
  providerLabel: string
  /** 模型选择器改了全局提供商/模型后的回调：外层据此刷新 hasKey 等派生状态 */
  onModelChanged: () => void
  /** 当前模型收不收图（决定能不能贴图）。见 ai/settings 的 supportsImage */
  vision: boolean
  /**
   * 发送。images / files 是**还没落盘**的待发送附件（见 agent/types 的 PendingImage、PendingFile）：
   * 转存由 learn/useAgent 在真正开始这一轮时做（那时候才知道这条消息发不发得出去）。
   */
  onSend: (text: string, images: PendingImage[], files: PendingFile[]) => void
  /**
   * 更多 → 工作流 → 回忆：请超级导师带用户做一次主动回忆。
   *
   * 与文档区悬浮组那颗「回忆」按钮是同一件事，但**这里不二次确认**：那边是鼠标
   * 扫过右边顺手点一下，这里是用户主动翻菜单找出来的——误触概率差着一个量级（见 DocFloat）。
   */
  onRecall: () => void
  /** 更多 → 工作流 → 超级实验室：触发内置工作流「超级实验室」——导师先问想做什么实验，再生成一份可交互的超级文档 */
  onSuperLab: () => void
  /**
   * 更多 → 工作流 → 打卡：请导师按今天读到的内容出几道题，答到门槛才算打卡。
   *
   * 与顶栏那颗打卡是同一件事：那边是「顺手看一眼今天还差什么」，这里是
   * 「翻菜单主动找出来做」——所以这里也不二次确认，直接跑。
   */
  onCheckin: () => void
  /** 更多 → 工作流 → 浏览器操作：替用户驱动内置浏览器完成任务（看=截图、输入=模拟鼠标键盘） */
  onBrowserUse: () => void
  /** 更多 → 压缩上下文：把前面的对话折成一份摘要 */
  onCompact: () => void
  /** 正在压缩（菜单项置灰，避免连点两次） */
  compacting: boolean
  /** 更多 → 超级导师设置：打开超级导师自己的设置页签（与全局设置不是同一个） */
  onOpenAgentSettings: () => void
  /** 更多 → 记忆：打开导师长期记忆的管理页签（learn/mind） */
  onOpenMinds: () => void
  /** 斜杠 /exam：跑内置工作流「出卷」（与文档区、资源管理器里的入口是同一个 newExam） */
  onExam: () => void
  /** 全局推理等级（斜杠 /effort 的二级菜单读它、写它） */
  effort: ReasoningEffort
  onSetEffort: (e: ReasoningEffort) => void
  /** 自动压缩阈值（0~1），菜单项上如实说明「到多少会自己压」 */
  compactThreshold: number
  /**
   * 导师人格（见 agent/persona）：显示与选择在输入框底行（子代理按钮右侧），切换即时写进设置。
   */
  persona: PersonaId
  onPickPersona: (id: PersonaId) => void
  /** 提示一句话（图片不合适、模型不支持图片输入等） */
  onNotice: (message: string) => void
  onStop: () => void
  onNewConversation: () => void
  onSelectConversation: (id: string) => void
  onDeleteConversation: (id: string) => void
  onEditMessage: (messageId: string, text: string) => void
  onDeleteMessage: (messageId: string) => void
  /**
   * 继续被中断的一轮（消息列表中断说明旁的「继续」按钮）。可选：宿主没接就不画按钮。
   * 面板内走 ref 转发保持回调身份恒定——memo 过的消息行不因它每次渲染换身份而整列重渲染。
   */
  onResumeInterrupted?: () => void
  /**
   * 这一枚面板是不是「眼前那一枚」（agent 栏页签化后所有页签常挂——keepalive）。
   * 从隐藏切回可见时重新量一遍定位条锚点：display:none 里量到的全是零矩形，
   * 不补这一遍，消息定位条要等下一次滚动才恢复。
   */
  active?: boolean
  /**
   * 待回答的结构化表单（api.ask 发起的）：显示在输入框上方，提交前沙箱一直阻塞着。
   * id 是这一次表单的身份（重开一张表单时 key 换掉，旧答案不会串）。
   */
  ask: { id: string; form: AskFormPayload } | null
  onAskSubmit: (answers: AskAnswers) => void
  onAskCancel: () => void
  /**
   * 最近一跳实测的输出速度（tok/s，运行时掐表测得）。跑着的时候来自实时上报，
   * 空闲时为 null——状态条会退回用最后一条回复里存的值。
   */
  tps: number | null
  /** 正在跑的这一轮到目前为止的账（每跳 usage 重算）：圆环的实时数据源，空闲时为 null */
  liveUsage?: MessageUsage | null
  /**
   * 子代理（见 docs/subagent-architecture.md）：当前对话的会话列表 + 正在跑的那场的
   * 实时输出。面板据此画入口按钮、弹出会话列表与子会话视图——子会话的渲染与导师
   * 视图是同一套（消息列表、工具卡片、流式），只是数据源换掉、输入禁用。
   */
  sub?: {
    sessions: SubAgentSession[]
    /** 本对话里 subagent.create 登记的定义（会话按 defKey 认名字） */
    defs: SubAgentDef[]
    running: boolean
    /** 每场在跑任务的实时流式（并发时多场同时在跑，按会话挑自己那一份） */
    live: Array<{ sessionId: string; runId: string; parts: AgentPart[] }>
  }
  /**
   * 子会话视图：看哪个子代理会话由**页签**决定（agent 栏页签化，见 AgentTabStrip）——
   * 页签指着哪个会话，整个面板就看哪一边。消息列表、流式输出、状态条与定位条的输入
   * 全部换成子会话那一份——渲染机制与导师视图完全同一套，换的只是数据源；
   * 传 null 就是导师对话本身。
   */
  viewSubId?: string | null
  /** 子代理会话入口被点：宿主把它的页签开好并置前（替代旧的面板内视图切换） */
  onOpenSub?: (sessionId: string) => void
}

export default function AgentPanel({
  nodeTitle,
  conversation,
  conversations,
  streaming,
  free,
  streamingMessageId,
  running,
  hasKey,
  providerLabel,
  onModelChanged,
  vision,
  onSend,
  onNotice,
  onRecall,
  onSuperLab,
  onCheckin,
  onBrowserUse,
  onCompact,
  compacting,
  onOpenAgentSettings,
  onOpenMinds,
  onExam,
  effort,
  onSetEffort,
  compactThreshold,
  persona,
  onPickPersona,
  onStop,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  onEditMessage,
  onDeleteMessage,
  onResumeInterrupted,
  ask,
  onAskSubmit,
  onAskCancel,
  tps,
  liveUsage,
  sub,
  viewSubId = null,
  onOpenSub,
  active = true,
}: Props) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  /** 点开看大图的附件。两种来源各一份状态：已进资源库的气泡图与还在内存里的待发送图 */
  const [preview, setPreview] = useState<PendingImage | null>(null)
  const [bubblePreview, setBubblePreview] = useState<MessageImage | null>(null)
  /** 上下文压缩后的摘要展开着（消息列表里那块分界线上的「看摘要」） */
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  /**
   * 待确认删除那条的「当下值」：state 给渲染用（那一行的删除按钮变成「确认」），
   * ref 给点击判据用——于是 clickDelete 的身份可以恒定，memo 过的消息行才不会
   * 因为「有人点了一下删除」就整列重渲染。这个组件里只有 clickDelete 会改它，两处永远同步。
   */
  const confirmDelRef = useRef<string | null>(null)

  /*
   * 隐藏指令照旧不显示，**但带 mark 的那种要显示成一条分界条**（回忆 / 探针 / 出卷 / 阅卷 / 开讲）：
   * 它们是导师自己发起的动作，对话里没有任何用户消息可以当锚点——不画出来的话，
   * 「导师带我做的那次回忆」在长对话里就再也找不回来了（消息定位条也点不到）。
   */
  const messages = useMemo(
    () =>
      (conversation?.messages ?? [])
        .filter((m) => !m.hidden || !!m.mark)
        // 轮次进行中，那条回复的 store 副本（增量落库写的）不进列表：渲染走 streaming，
        // 两边都画就重复了；轮次收口后 streaming 清空，store 副本自动接管
        .filter((m) => m.id !== streamingMessageId),
    [conversation, streamingMessageId],
  )

  /**
   * 子会话视图的解析（viewSubId 由页签给，见 Props 的说明）。
   */
  const subSession = useMemo(
    () => (sub && viewSubId ? (sub.sessions.find((s) => s.id === viewSubId) ?? null) : null),
    [sub, viewSubId],
  )
  /**
   * 正看着的这场任务在跑吗（实时流式来自 sub.live 里属于这个会话的那一份）。
   * 并发模型下过程是边跑边落库的（介入插入前固化一段、收口再固化一段），
   * 会话消息与实时流式天然不重不漏——不再需要按 runId 剔重的过滤。
   */
  const subLive = useMemo(
    () => (sub && viewSubId ? (sub.live.find((l) => l.sessionId === viewSubId) ?? null) : null),
    [sub, viewSubId],
  )
  const viewMessages = useMemo(() => (subSession ? subSession.messages : messages), [subSession, messages])
  const viewStreaming = subSession ? (subLive ? subLive.parts : null) : streaming
  const viewRunning = subSession ? !!(subLive || subSession.status === 'running') : running
  /** 子会话头部要显示的定义信息（名字 / 内置标记） */
  const subDef = subSession ? (sub?.defs ?? []).find((d) => d.key === subSession.defKey) : undefined
  /**
   * 这个对话里所有回复的 token 账，圆环与浮层据此汇总。
   * 跑着的时候把**实时账**追加在最后（每跳 usage 重算）：一轮里模型来回好几跳，
   * 每跳输入都在涨——只等轮末落库，圆环就会在整个编排过程中一动不动。
   * 轮次结束实时账清空、落库的那份接管，两边口径一致，无缝衔接。
   */
  const usages = useMemo(
    () => [
      ...viewMessages.flatMap((m) => (m.role === 'assistant' && m.usage ? [m.usage] : [])),
      ...(!subSession && liveUsage ? [liveUsage] : []),
    ],
    [viewMessages, subSession, liveUsage],
  )
  /**
   * 失活的分界线：从这一条（下标）起还在上下文里，前面的已经被折进摘要、只作显示。
   *
   * 判据是消息自己的 retired 标记（见 learn/compact）——不再有「压到哪一条」的分界点：
   * 压缩就是「一条原消息都不留 + 摘要成为第一条消息」。全部都失活时给 messages.length
   * （那时摘要下面还没有新消息，分界线画在列表开头，由上面那句 summary 单独渲染）。
   */
  const summary = subSession ? null : (conversation?.summary ?? null)
  const summaryStart = useMemo(() => {
    const i = viewMessages.findIndex((m) => !m.retired)
    return i < 0 ? viewMessages.length : i
  }, [viewMessages])

  /* ---------- 定位条、滚动跟随与字号 ---------- */

  /** 整块面板：Ctrl + 滚轮的区域就是它（表头、列表、输入区都算，划过哪里都生效） */
  const rootRef = useRef<HTMLDivElement | null>(null)
  /** 滚动容器：列表、定位条、缩放共用它的实时几何 */
  const scrollRef = useRef<HTMLDivElement | null>(null)
  /** 每条消息的 DOM：定位条靠它算位置，缩放时也靠它把视口顶部那条贴回原处 */
  const msgRefs = useRef(new Map<string, HTMLDivElement>())
  /**
   * 定位条当前的点位：useMsgRail 量完写进来，useScrollFollow 的 onScroll 读它。
   *
   * 为什么不直接把 anchors 传进 useScrollFollow：那两个 hook 的**调用顺序必须与拆分前
   * 一致**（各自的 useLayoutEffect 谁先跑是有讲究的，见各自的注释），而点位又得先有
   * 量锚点的那一个。于是走 ref：写的是事件/布局阶段，读的是事件回调，都不参与渲染。
   */
  const railAnchorsRef = useRef<MsgAnchor[]>([])
  /** 现在读到哪一条（定位条高亮那一个）：onScroll 写，渲染读 */
  const [railActive, setRailActive] = useState<string | null>(null)

  const {
    onWheel,
    onScroll,
    pinned,
    jumpToMessage,
    restoreFollow,
    stickToBottom,
    flashId,
    chatScale,
    zoomPct,
    zoomHud,
  } = useScrollFollow(
    viewMessages,
    { scrollRef, rootRef, msgRefs, railAnchorsRef },
    setRailActive,
  )

  /** 跟随状态下，内容每长一点就贴到底部；脱离之后一律不动 */
  useEffect(() => {
    stickToBottom()
  }, [stickToBottom, viewMessages.length, viewStreaming, viewRunning])

  // 定位条排在后面：它的 useLayoutEffect 与上面那个「贴底」谁先跑与拆分前一致（见各自注释）
  const { railWide, anchors, railHover, setRailHover, hoverAnchor, measureAnchors } = useMsgRail(
    viewMessages,
    { scrollRef, rootRef, msgRefs, railAnchorsRef },
  )
  // 消息、流式内容一变就重新量一遍（正文还在长，位置一直在动）；容器尺寸变化同理
  useLayoutEffect(() => {
    measureAnchors()
  }, [measureAnchors, viewStreaming, viewRunning, chatScale])

  const composer = useComposer({
    running,
    vision,
    onSend,
    onNotice,
    onSent: restoreFollow,
  })

  /*
   * 两个对外的回调（编辑 / 删除消息）在调用方是内联箭头，每渲染一次就换一个身份。
   * 消息行是 memo 过的，把它们原样接下去等于流式每一跳都把整列历史消息的 memo 打掉；
   * 而它们真正要的东西（消息 id 与文本）由行自己带上来，什么时候调用、传什么，与原来逐字相同。
   * 于是走「最新值 ref」：渲染期只读 props，回调里读 ref——身份恒定，行为不变。
   */
  const messagesApiRef = useRef({ onEditMessage, onDeleteMessage })
  // 用 layout effect 而不是 effect：它在这次提交里**同步**跑完，于是任何一个点击回调
  // 读到的都一定是最近一次渲染的那一份 props（被动 effect 要等画完，理论上会差一拍）
  useLayoutEffect(() => {
    messagesApiRef.current = { onEditMessage, onDeleteMessage }
  })

  /** 「继续」按钮的恒定身份包装（见 Props.onResumeInterrupted 的说明） */
  const resumeRef = useRef(onResumeInterrupted)
  useLayoutEffect(() => {
    resumeRef.current = onResumeInterrupted
  })
  const resumeInterrupted = useCallback(() => resumeRef.current?.(), [])

  /*
   * keepalive：页签从隐藏切回可见的那一刻重新量锚点。display:none 期间量到的全是
   * 零矩形（元素没有布局），不补这一遍，定位条要等下一次消息或滚动才恢复；
   * 顺带让跟随状态落回它该在的位置（贴底的照旧贴底，脱离的不动）。
   */
  useEffect(() => {
    if (!active) return
    measureAnchors()
    stickToBottom()
  }, [active, measureAnchors, stickToBottom])

  /**
   * 保存编辑：id 与文本由消息行带上来（原来是从 editing 那份状态里读的，两者在调用点上等值——
   * 编辑框只在 editing.id === 这一条 时才画出来）。于是它不依赖 editing，身份恒定：
   * 在某一条里打字时，其余消息行不会被带着重渲染。
   */
  const saveEdit = useCallback((id: string, text: string) => {
    const trimmed = text.trim()
    if (trimmed) messagesApiRef.current.onEditMessage(id, trimmed)
    setEditing(null)
  }, [])

  /**
   * 删除：第一次点只是请人再确认一次，第二次点才真删。判据读 confirmDelRef（与 state 同步），
   * 于是这里不必依赖 state，身份恒定——memo 过的消息行只会在 confirming 真的变了的那一条上重渲染。
   */
  const clickDelete = useCallback((id: string) => {
    if (confirmDelRef.current !== id) {
      confirmDelRef.current = id
      setConfirmDel(id)
      window.setTimeout(() => {
        // 2.6 秒里没再点同一条就撤回这次待确认（原来的写法是 setConfirmDel(c => c === id ? null : c)）
        if (confirmDelRef.current === id) {
          confirmDelRef.current = null
          setConfirmDel(null)
        }
      }, 2600)
      return
    }
    confirmDelRef.current = null
    setConfirmDel(null)
    messagesApiRef.current.onDeleteMessage(id)
  }, [])

  /**
   * 底部状态条的数据。轮数 = 导师回复（跑着的那一轮也算一条）；
   * token = 各回复账目的总和。
   * 都从「消息 + 正在流式的那一份」现推，不另立状态——数据只有一份，不会对不上。
   *
   * 这三个数都是**纯派生**：只认 messages / streaming / usages / tps。流式写作时逐跳重渲染，
   * 而这三样里只有 streaming 在变——不缓存就等于每来一个 chunk 都把全部历史消息从头扫一遍
   * （其中还有一处 [...messages].reverse() 要整份复制数组）。缓存下来，输出与现算逐字相同：
   * 同样的输入给同样的数，什么时候算、算几次都不影响结果。
   */
  const { turns, tokensTotal, tpsNow } = useMemo(() => {
    const turns = viewMessages.filter((m) => m.role === 'assistant').length + (viewStreaming ? 1 : 0)
    /**
     * 最后一条带 tps 的导师回复。原来是 [...messages].reverse().find(...)：先整份复制再倒着找，
     * 这里改成从后往前的 for——找到的是同一条（倒过来之后的第一个 = 原来最后一个），
     * 也照样跳过 tps 为 0 / 缺失的那些。
     */
    const lastStoredTps = (): number | null => {
      for (let i = viewMessages.length - 1; i >= 0; i--) {
        const m = viewMessages[i]
        if (m.role === 'assistant' && m.usage?.tps) return m.usage.tps
      }
      return null
    }
    // 实时值优先：跑着的时候读这一轮上报的；空闲时退回最后一条回复里存的存量
    const tpsNow = tps ?? lastStoredTps()
    return { turns, tokensTotal: usages.reduce((n, u) => n + u.totalTokens, 0), tpsNow }
  }, [viewMessages, viewStreaming, usages, tps])

  /**
   * loop 还在跑时，消息列表末尾那行波浪的说明文字。
   * 尽量说清现在卡在哪一步——「在读文档」和「模型在想」对用户的体感完全不同，
   * 后者才需要耐心，前者说明它正在动。
   *
   * 「已经在吐字」那一档说的不是「继续生成中」而是**导师正在准备**：用户看到的是
   * 前面那段内容已经写出来了、它还在往下写，用「导师」当主语读起来更像有人在场
   * （这行字本来就配着一道循环掠过的高光，见 styles/motion.css 的 .moji-sheen）。
   */
  // useLocale() 订阅界面语言：语言切换时本组件重渲染，下面的文案函数自然重算。
  // loopLabel 不进 useMemo：纯字符串拼装，一次渲染算两回也花不了几个钱，
  // 而把 locale 塞进依赖数组只会换来一条「多余依赖」的 lint 警告。
  useLocale()
  const lastStreaming = viewStreaming?.[viewStreaming.length - 1]
  const loopLabel =
    lastStreaming && lastStreaming.type === 'tool' && lastStreaming.status === 'running'
      ? t('正在{0}…', toolLabel(lastStreaming.name, lastStreaming.args))
      : viewStreaming?.length
        ? subSession
          ? t('子代理正在准备')
          : t('导师正在准备')
        : t('思考中…')

  // 消息列表那一段 JSX：状态与回调都在上面，这里只负责把它渲染出来
  const messageList = useMessageList({
    messages: viewMessages,
    summaryStart,
    summary,
    summaryOpen,
    setSummaryOpen,
    streaming: viewStreaming,
    running: viewRunning,
    loopLabel,
    flashId,
    msgRefs,
    editing,
    setEditing,
    saveEdit,
    confirmDel,
    clickDelete,
    onResumeNotice: resumeInterrupted,
    setBubblePreview,
  })

  return (
    // relative：定位条贴着这一块的右边挂（它要的是整块面板的坐标，不是消息列的）
    <div ref={rootRef} className="relative flex h-full min-h-0 flex-col bg-paper-deep/40">
      {/*
        内容上限 768px：这一栏的容器可以被拉到 800 宽，两列对调之后还会占住左边那一大块，
        但对话本身（消息 / 输入区）始终不超过 768——一行拉得太长就读不动了。
        三段各写一次同一个上限，而不是外面再包一层：这样底色的铺满范围不变，
        宽出来的部分就是这一栏自己的留白，三段的左右边缘也正好对齐。

        顶栏（超级导师 + 人格 + 「正在辅导」）随 agent 栏页签化撤掉：页签自己就回答着
        「现在跟谁在说」——目标级页签的标题就是目标的标题，子代理页签就是会话名。
        「正在辅导」与对话标题搬到了输入框下面的状态行（见下面那一行）。
      */}
      <div className="relative mx-auto min-h-0 w-full max-w-[768px] flex-1">
        {/* moji-selectable：聊天列表是全站仅有的两处「可选文字、可拖拽」的区域之一
            （另一处是左侧文档浏览区），见 index.css 的只读界面规则 */}
        <div
          ref={scrollRef}
          onWheel={onWheel}
          onScroll={onScroll}
          // 不显示滚动条（moji-scroll-none）：右边那条位置留给定位条，见 index.css。
          // pr-9 而不是 px-3.5：最宽的那个点（18px）也要与正文留出空隙（几何见 panel/constants.ts）
          // 顶边距不放在容器上：容器一垫，下面的 sticky 渐隐就贴不住滚动口顶端（空出一截）
          className="moji-scroll-none moji-selectable h-full overflow-y-auto pb-3 pl-3.5 pr-9"
        >
          {/*
            顶部渐隐：滚出去的内容在这条渐变里淡出，而不是被容器上缘一刀切掉。
            背景色就是面板这一层的底色（paper-deep 四成叠在 paper 上，见根节点的
            bg-paper-deep/40），color-mix 在这里现算出同一个合成色；sticky 负下边距
            让它压住列表顶端而不占布局。
          */}
          <div
            aria-hidden="true"
            className="pointer-events-none sticky top-0 z-[1] -mb-12 h-12 shrink-0"
            style={{
              background:
                'linear-gradient(to bottom, color-mix(in srgb, var(--color-paper-deep) 40%, var(--color-paper)), transparent)',
            }}
          />
          {/* 字号系数挂在这一层、而不是滚动容器上：滚动条与内边距不该跟着缩放（上边距 20px：列表内容与页签栏之间留一口呼吸） */}
          <div className="pt-5" style={{ zoom: chatScale } as CSSProperties}>
            {messageList}
          </div>
        </div>


        {/*
          字号比例提示：贴在列表右下角、那颗「回到最新」的左边。
          常挂不卸载、只切透明度，进出都平滑（与文档区那颗同一套做法）。
        */}
        <div
          aria-hidden={!zoomHud}
          className={
            'no-print pointer-events-none absolute bottom-3 right-16 z-10 flex items-baseline gap-1.5 rounded-lg border border-line-strong bg-card/95 px-3 py-1.5 shadow-[0_6px_20px_rgba(31,27,23,0.12)] transition-opacity duration-300 ' +
            (zoomHud ? 'opacity-100' : 'opacity-0')
          }
        >
          <span className="text-[10.5px] text-ink-faint">{t('字号')}</span>
          <span className="text-[13px] font-medium tabular-nums text-ink-strong">{zoomPct}%</span>
        </div>

        {!pinned && <FollowLatestButton onClick={restoreFollow} />}
      </div>

      {/* 输入区与列表之间不画分隔线：输入卡片自己那圈边框已经把它分出来了，多一条线只是噪音 */}
      {/*
        上内边距为 0：输入卡片与上面的消息列表之间只留卡片自己那圈边框，
        上面那一条 10px 的空白把「对话」与「我要说的话」切成了两段，而且它一直是空的。
      */}
      <div className="mx-auto w-full max-w-[768px] shrink-0 px-3.5 pb-3 pt-0">
        <ComposerUi
          composer={composer}
          running={running}
          hasKey={hasKey}
          providerLabel={providerLabel}
          ask={ask}
          onAskSubmit={onAskSubmit}
          onAskCancel={onAskCancel}
          usages={usages}
          onModelChanged={onModelChanged}
          onStop={onStop}
          onNewConversation={onNewConversation}
          conversations={conversations}
          conversation={conversation}
          onSelectConversation={onSelectConversation}
          onDeleteConversation={onDeleteConversation}
          onRecall={onRecall}
          onSuperLab={onSuperLab}
          onCheckin={onCheckin}
          onBrowserUse={onBrowserUse}
          onCompact={onCompact}
          compacting={compacting}
          compactThreshold={compactThreshold}
          onOpenAgentSettings={onOpenAgentSettings}
          onOpenMinds={onOpenMinds}
          onExam={onExam}
          effort={effort}
          onSetEffort={onSetEffort}
          onOpenPreview={setPreview}
          subMode={subSession ? { name: subDef?.name ?? subSession.defKey, running: viewRunning } : undefined}
          subAgentSlot={
            free ? undefined : (
              <SubAgentMenu sessions={sub?.sessions ?? []} defs={sub?.defs ?? []} onOpen={(id) => onOpenSub?.(id)} />
            )
          }
          // 人格入口：输入框底行、子代理按钮右侧（原顶栏撤除后的新家；向上展开——它已贴近窗口底缘）
          personaSlot={free ? undefined : <PersonaPicker persona={persona} onPick={onPickPersona} />}
          // 自由聊天：菜单只留 新建对话 / 对话历史 / 文件（见 usePlusMenu 的 FREE_MENU）
          free={free}
          // keepalive：隐藏面板不登记 chip 落点（模块级单槽，谁最后登记谁赢）
          active={active}
        />

        {/*
          状态行：输入框底下的一条细字。左边是「正在辅导哪个节点 / 这段对话叫什么」
          （子代理页签则是这场任务的履历），右边是轮数 / 速度 / token——一行读全：
          在看谁、跑到哪、花了多少。人格选择器不在这行：它搬进了输入框底行，
          与提供商切换同一排（见 ComposerUi 的 personaSlot）。
        */}
        <div className="flex min-w-0 items-center gap-2.5 px-1 pb-1.5 pt-1.5">
          {subSession ? (
            <>
              <span
                className={'shrink-0 text-[11px] leading-none ' + (viewRunning ? 'text-seal' : 'text-ink-faint')}
              >
                {viewRunning
                  ? t('任务进行中')
                  : subSession.status === 'interrupted'
                    ? t('上次被中断')
                    : subSession.status === 'error'
                      ? t('上次出错')
                      : t('空闲')}
              </span>
              <span className="min-w-0 truncate text-[11px] leading-none text-ink-faint">
                {t('独立上下文 · {0} 次任务', subSession.runs)}
              </span>
            </>
          ) : free ? (
            <>
              {/*
                自由聊天没有「正在辅导谁」：这里只放这段对话的名字（同一条起名规矩：
                没起好名字时什么都不显示，不挂占位）。
              */}
              {conversation?.title && (
                <span title={conversation.title} className="min-w-0 truncate text-[11px] leading-none text-ink-soft">
                  {conversation.title}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="shrink-0 text-[11px] leading-none text-ink-faint">
                {t('正在辅导「{0}」', nodeTitle)}
              </span>
              {/*
                这一段对话叫什么。名字由模型读第一句话起（见 learn/title），还没起好时**什么都不显示**——
                挂一个「对话 1」占着地方，等于告诉用户"它叫这个"，而它其实还没名字。
              */}
              {conversation?.title && (
                <span title={conversation.title} className="min-w-0 truncate text-[11px] leading-none text-ink-soft">
                  {conversation.title}
                </span>
              )}
            </>
          )}
          <span className="min-w-0 flex-1" aria-hidden="true" />
          <PaceStrip turns={turns} tps={tpsNow} tokens={tokensTotal} usages={usages} />
        </div>
      </div>

      {/*
        消息定位条：一条用户消息一个点，从上到下就是第一条到最后一条（等距，见 useMsgRail 里的 measureAnchors）。
        长对话里「刚才说过的那句在哪」比滚动条好用——滚动条只说相对位置，
        这里点一下直接落到那一条上，悬停还能先看一眼预览。

        挂在**整块面板**上而不是消息列里（点的 y 已经把表头那一段算进去了，见 measureAnchors）：
        消息列有 768px 的上限、还可能居中，挂在它里面的话，面板一宽点就跑到中间去了；
        贴着面板右边才是「随时能点到」的位置。
        只在两个条件下出现：用户消息不止一条（一个点定位不了任何东西），
        且这一栏够宽（见 RAIL_MIN_WIDTH）——窄栏里它挤掉的是消息本身。
        每一项的命中区就是整个间距，上下相接：鼠标顺着条子走不会在两点之间踩空。
      */}
      {railWide && anchors.length > 1 && (
        <MsgRail
          anchors={anchors}
          railActive={railActive}
          railHover={railHover}
          setRailHover={setRailHover}
          hoverAnchor={hoverAnchor}
          onJump={jumpToMessage}
        />
      )}

      {/* 输入框里的附件还没落盘：用 PendingLightbox（内存里的 object URL） */}
      {preview && <PendingLightbox image={preview} onClose={() => setPreview(null)} />}
      {bubblePreview && (
        <ImageLightbox image={bubblePreview} onClose={() => setBubblePreview(null)} />
      )}

    </div>
  )
}
