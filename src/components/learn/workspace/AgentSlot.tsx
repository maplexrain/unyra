import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { ArrowLeft, Bot, GraduationCap } from 'lucide-react'
import type { AgentTabRef, DocView, LearnStore, TabRef } from '../../../learn/types'
import { agentTabKey } from '../../../learn/agentTabs'
import { queueOf } from '../../../learn/agentQueue'
import {
  deleteFreeConversation,
  ensureFreeConversation,
  freeConversationById,
} from '../../../learn/freeChat'
import { conversationById, deleteMessage, nodeById, resolveDisplayedConversation, updateMessageText } from '../../../learn/graph'
import { resetPrefixGate } from '../../../agent/prefixGate'
import { saveAgentSettings, loadAgentSettings } from '../../../agent/settings'
import { personaOf } from '../../../agent/persona'
import { docFormatOf } from '../../../agent/docFormat'
import type { AgentPart, ChannelStamp, Conversation, PendingFile, PendingImage, WorkSession } from '../../../agent/types'
import type { AskAnswers } from '../../../agent/tools'
import type { ReasoningEffort } from '../../../ai/types'
import { userAbsPath } from '../../../lib/storage'
import { focusAgentInput } from '../../../lib/agentFocus'
import { wsChipUserRel } from '../../../learn/chipRef'
import { wsRefOfRel } from '../../../learn/workspace'
import { AgentTabPane } from './AgentTabPane'
import { goalConvByGoal, goalFocusByGoal } from './goalFocus'
import { AgentRosterSidebar } from '../agent-team/AgentRosterSidebar'
import { AgentSettingsView } from '../agent-team/AgentSettingsView'
import {
  agentAvatarIdOf,
  COMMUNICABLE_VOICES,
  DEFAULT_AGENT_NAME,
  isCommunicable,
  profileOf,
  resetAgentProfile,
  updateAgentProfile,
  type AgentProfileId,
  type AgentVoice,
} from '../../../agent/agentProfile'
import {
  ensureRoleConversation,
  roleOfConversation,
} from '../../../learn/roleWork/roles'
import { inboundEnvelope, peerOf, userPeer } from '../../../learn/roleWork/channels'
import { GroupChatPanel, type GroupChatAgent } from '../../agent/panel/GroupChatPanel'
import { useGroupChatBridge } from './useGroupChatBridge'
import { AGENT_ROSTER_META, AGENT_ROSTER_ORDER, type AgentVoiceStats } from '../agent-team/agentRoster'
import { AgentAvatarGlyph } from '../agent-team/AgentAvatarGlyph'
import { listWorkflowRows, type WorkflowRow } from '../../../learn/workflows'
import {
  conversationTimeOf,
  lastMessagePreview,
  sortConversationsByTimeDesc,
  type AgentTeamMode,
} from '../agent-team/conversationList'
import type { useAgent } from '../../../learn/useAgent'
import type { useWorkflowStarters } from './useWorkflowStarters'
import { t } from '../../../i18n'

type AgentApi = ReturnType<typeof useAgent>
type StartersApi = ReturnType<typeof useWorkflowStarters>
type AgentSettings = ReturnType<typeof loadAgentSettings>
const EMPTY_CONVERSATIONS: Conversation[] = []
const EMPTY_WF_ROWS: WorkflowRow[] = []
const EMPTY_WORK_RUNS: Array<{ conversationId: string; workId: string; runId: string; parts: AgentPart[] }> = []

/**
 * agent 栏（左侧 Agent 列表——上块声部名册 + 下块当前声部对话历史 + 中间 keepalive 面板）需要的宿主能力与派生值。
 */
export interface AgentSlotDeps {
  store: LearnStore
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  agent: AgentApi
  /** 仅聊天模式的会话列表（learn/freeChat） */
  freeChats: Conversation[]
  currentFreeConvId: string | null
  setFreeConvId: Dispatch<SetStateAction<string | null>>
  onToast: (msg: string) => void
  openTab: (ref: TabRef, preferredView?: DocView) => void
  effort: ReasoningEffort
  setGlobalEffort: (next: ReasoningEffort) => void
  hasKey: boolean
  providerName: string
  vision: boolean
  agentSettings: AgentSettings
  setSettingsEpoch: Dispatch<SetStateAction<number>>
  /** 常挂面板的列表 = 全部页签 */
  agentPanes: AgentTabRef[]
  activeAgentTab: AgentTabRef
  activeAgentTabId: string | null
  activateAgentTab: (key: string) => void
  openAgentTab: (ref: AgentTabRef, activate?: boolean) => void
  selectTutorGoal: (goalId: string) => void
  handleNewGoalConversation?: (goalId?: string) => void
  removeConversation: (conversationId: string) => void
  newConversationIn?: (tab: AgentTabRef) => void
  selectConversationIn: (tab: AgentTabRef, conversationId: string) => void
  pruneImagesOf: (s: LearnStore) => void
  startSuperLab: StartersApi['startSuperLab']
  newExam: StartersApi['newExam']
  shouldWaitInLine: (convId: string) => boolean
  /** 宿主 Tab 页签是否当前可见（agentTeam 页签后台保活时降为 false，切回再激活） */
  tabActive?: boolean
  /** 若由目标专属智能体团队页签挂载，则固定绑定到该目标（仅聊天仍跨目标共享） */
  tabGoalId?: string
  /** 是否将左右侧栏折叠状态持久化到 localStorage（传送窗格中置为 false，避免影响原页签） */
  persistLayout?: boolean
}

/**
 * 智能体团队两栏工作台：
 * 左栏垂直分两块（高度权重 2:1）——上块声部名册、下块当前选中声部的对话历史
 * （含新建 / 目标切换 / 设置齿轮）+ 中栏（keepalive AgentPanel）。不再有右栏。
 */
export function AgentSlot({ deps }: { deps: AgentSlotDeps }) {
  const {
    store,
    getLatest,
    set,
    agent,
    freeChats,
    currentFreeConvId,
    setFreeConvId,
    onToast,
    openTab,
    effort,
    setGlobalEffort,
    hasKey,
    providerName,
    vision,
    agentSettings,
    setSettingsEpoch,
    agentPanes,
    activeAgentTab,
    activeAgentTabId,
    activateAgentTab,
    openAgentTab,
    selectTutorGoal,
    removeConversation,
    selectConversationIn,
    pruneImagesOf,
    startSuperLab,
    newExam,
    shouldWaitInLine,
    tabActive = true,
    tabGoalId,
    persistLayout = true,
  } = deps

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [containerWidth, setContainerWidth] = useState<number | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const syncWidth = (w: number) => {
      if (Number.isFinite(w) && w > 0) {
        setContainerWidth((prev) => (prev === Math.round(w) ? prev : Math.round(w)))
      }
    }
    syncWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width
      if (typeof w === 'number') syncWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const hasMeasuredWidth = containerWidth !== null && containerWidth > 0
  // 宽度 < 800：左侧竖栏不再是「收起且禁用的 48px 轨」，改为对话区上方的顶部横栏
  const rosterTopBar = hasMeasuredWidth && containerWidth < 800
  const workRunsAll = agent.workRunsAll ?? EMPTY_WORK_RUNS

  // 当工作区尚无激活目标时，允许用户点击「导师」停留并呈现目标选择空态
  const [emptyTutorMode, setEmptyTutorMode] = useState(false)
  /**
   * 选中了**还没有会话**的声部（不可交流声部：会话只能由工作流与委托触发）：中央区
   * 显示该声部的空白页而不是上一段对话。渲染期派生自证清白——该声部一旦有了会话
   * （工作流 / 委托落的），空白态自动让位给正常派生，不需要 effect 清理。
   */
  const [emptyVoiceMode, setEmptyVoiceMode] = useState<AgentTeamMode | null>(null)
  /**
   * 智能体设置态：非 null 时中央工作区显示这位声部的独立设置页（AgentSettingsView），
   * 替代对话流。选择声部 / 选对话 / 新建对话 / 切目标都会退出设置态回到对话。
   */
  const [settingsAgent, setSettingsAgent] = useState<AgentTeamMode | null>(null)
  /** 群聊页：名册里固定多出来的一张卡；它不是某个 role 的会话，只读群通道流水 */
  const [groupOpen, setGroupOpen] = useState(false)

  const tutorGoalId = useMemo(() => {
    if (tabGoalId) return tabGoalId
    if (activeAgentTab.kind === 'goal') return activeAgentTab.goalId
    if (activeAgentTab.kind === 'work') {
      return conversationById(store, activeAgentTab.conversationId)?.goalId ?? store.activeGoalId ?? null
    }
    return store.activeGoalId ?? null
  }, [tabGoalId, activeAgentTab, store])


  const goalTitleOf = (goalId: string): string => {
    const goal = store.goals.find((g) => g.id === goalId)
    if (!goal) return ''
    return nodeById(store, goal.rootNodeId)?.title || goal.title || goal.question || t('未命名目标')
  }

  const activeGoalTitle = tutorGoalId ? goalTitleOf(tutorGoalId) : null

  const sortedFreeChats = useMemo(() => sortConversationsByTimeDesc(freeChats), [freeChats])
  /**
   * 会话按目标 × 声部分桶（agent team 分工：store.conversations 里既有导师对话、也有
   * 承接声部的工作会话——各声部的子列表、激活会话与统计各认各的桶，见 voiceConvs）。
   */
  const goalConversationsByGoal = useMemo(() => {
    const grouped = new Map<string, Map<AgentTeamMode, Conversation[]>>()
    for (const c of store.conversations) {
      const voice = roleOfConversation(c) as AgentTeamMode
      let bucket = grouped.get(c.goalId)
      if (!bucket) {
        bucket = new Map()
        grouped.set(c.goalId, bucket)
      }
      let list = bucket.get(voice)
      if (!list) {
        list = []
        bucket.set(voice, list)
      }
      list.push(c)
    }
    const sorted = new Map<string, Partial<Record<AgentTeamMode, Conversation[]>>>()
    for (const [gid, bucket] of grouped) {
      const out: Partial<Record<AgentTeamMode, Conversation[]>> = {}
      for (const [voice, list] of bucket) out[voice] = sortConversationsByTimeDesc(list)
      sorted.set(gid, out)
    }
    return sorted
  }, [store.conversations])
  const voiceChatsOf = (voice: AgentTeamMode): Conversation[] =>
    tutorGoalId ? (goalConversationsByGoal.get(tutorGoalId)?.[voice] ?? EMPTY_CONVERSATIONS) : EMPTY_CONVERSATIONS
  const sortedGoalChats = useMemo(
    () => (tutorGoalId ? (goalConversationsByGoal.get(tutorGoalId)?.tutor ?? EMPTY_CONVERSATIONS) : EMPTY_CONVERSATIONS),
    [goalConversationsByGoal, tutorGoalId],
  )
  /**
   * 左栏下块的数据：每个 agent 名下的 work 上下文。
   * role 层每个 agent 只有一段会话，列它等于把同一个标题重复一遍；真正要看的是 work。
   * 一个 work 只认 id 一次（历史数据里同一段 role 会话可能被多个入口看到）。
   */
  const worksByAgent = useMemo(() => {
    const collect = (convs: Conversation[]): WorkSession[] => {
      const byId = new Map<string, WorkSession>()
      for (const conv of convs) for (const work of conv.works?.sessions ?? []) byId.set(work.id, work)
      return [...byId.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    }
    const out: Partial<Record<AgentTeamMode, WorkSession[]>> = {
      free: collect(sortedFreeChats),
    }
    for (const voice of AGENT_ROSTER_ORDER) {
      if (voice === 'free') continue
      out[voice] = collect(tutorGoalId ? (goalConversationsByGoal.get(tutorGoalId)?.[voice] ?? []) : [])
    }
    return out
  }, [sortedFreeChats, goalConversationsByGoal, tutorGoalId])

  const openWorkFromRoster = (agentId: AgentTeamMode, workId: string) => {
    const work = worksByAgent[agentId]?.find((w) => w.id === workId)
    if (!work) return
    setGroupOpen(false)
    setSettingsAgent(null)
    setEmptyTutorMode(false)
    setEmptyVoiceMode(null)
    openAgentTab({ kind: 'work', conversationId: work.roleConversationId, workId: work.id }, true)
  }

  const activeTutorConvId = useMemo(() => {
    if (activeAgentTab.kind === 'work') {
      const workConv = conversationById(store, activeAgentTab.conversationId)
      if (!tabGoalId || workConv?.goalId === tabGoalId) return activeAgentTab.conversationId
    }
    if (activeAgentTab.kind === 'goal' && (!tabGoalId || activeAgentTab.goalId === tabGoalId)) {
      if (
        activeAgentTab.conversationId &&
        conversationById(store, activeAgentTab.conversationId)?.goalId === activeAgentTab.goalId
      ) {
        return activeAgentTab.conversationId
      }
      return resolveDisplayedConversation(store, activeAgentTab.goalId) ?? sortedGoalChats[0]?.id ?? null
    }
    if (tabGoalId) {
      const remembered = goalConvByGoal.get(tabGoalId)
      if (remembered && conversationById(store, remembered)?.goalId === tabGoalId) {
        return remembered
      }
      return resolveDisplayedConversation(store, tabGoalId) ?? sortedGoalChats[0]?.id ?? null
    }
    return null
  }, [activeAgentTab, store, sortedGoalChats, tabGoalId])

  /**
   * 眼前这段对话属于哪位声部（mode 的 goal 侧取值）：goal 页签指向的会话本身就是身份
   * （Conversation.voice）。子代理页签的 activeTutorConvId 是父会话（导师），天然正确。
   */
  const activeVoice: AgentTeamMode = roleOfConversation(
    conversationById(store, activeTutorConvId ?? ''),
  ) as AgentTeamMode

  /**
   * 选中了还没有会话的声部（空白页态）：只在它真的还没有会话时生效——工作流 / 委托
   * 给它落的会话一出现，这里就自然让位回正常派生（渲染期自证清白，见 emptyVoiceMode）。
   */
  const emptyVoiceActive: AgentTeamMode | null =
    emptyVoiceMode && tutorGoalId && voiceChatsOf(emptyVoiceMode).length === 0 ? emptyVoiceMode : null

  const mode: AgentTeamMode =
    emptyVoiceActive ??
    (activeAgentTab.kind !== 'free'
      ? activeVoice
      : tutorGoalId === null && emptyTutorMode
        ? 'tutor'
        : 'free')

  const workViewMeta = useMemo(() => {
    if (activeAgentTab.kind !== 'work') return null
    const conv =
      freeConversationById(activeAgentTab.conversationId) ?? conversationById(store, activeAgentTab.conversationId)
    if (!conv) return null
    if (tabGoalId && conv.goalId && conv.goalId !== tabGoalId) return null
    const work = conv.works?.sessions.find((w) => w.id === activeAgentTab.workId)
    if (!work) return null
    return {
      key: agentTabKey(activeAgentTab),
      goalId: conv.goalId,
      conversationId: conv.id,
      workId: work.id,
      name: work.name,
    }
  }, [activeAgentTab, store, tabGoalId])

  /**
   * 各 role 的近况统计（左栏联系人卡片的运行点 / 表单点 / 预览 / 时间 / 未读数）。
   * 作用域与旧的 tutor 口径一致：固定目标页签只看该目标；全局看 store 全部（按 role 过滤）。
   */
  const voiceStats = useMemo(() => {
    const out: Partial<Record<AgentTeamMode, AgentVoiceStats>> = {}
    for (const voice of AGENT_ROSTER_ORDER) {
      const list = tabGoalId
        ? (goalConversationsByGoal.get(tabGoalId)?.[voice] ?? EMPTY_CONVERSATIONS)
        : store.conversations.filter((c) => roleOfConversation(c) === voice)
      const latest = list[0]
      out[voice] = {
        running: list.some(
          (c) =>
            Boolean(agent.runningByConversation[c.id]) ||
            workRunsAll.some((r) => r.conversationId === c.id),
        ),
        hasAsk: list.some((c) => Boolean(agent.pendingAskByConv[c.id])),
        preview: lastMessagePreview(latest),
        lastTime: latest ? conversationTimeOf(latest) : 0,
        count: list.length,
      }
    }
    return out
    // agent.* 的三张表是状态槽（引用随运行变化），一并列进来
  }, [tabGoalId, store.conversations, agent.runningByConversation, agent.pendingAskByConv, workRunsAll, goalConversationsByGoal])

  const scheduleFocus = () => {
    window.setTimeout(() => focusAgentInput(), 30)
  }

  /**
   * 打开群聊：群聊是名册里的固定入口，不属于任何目标/role 会话。
   * 打开时清掉设置态与空态，中央区换成群聊面板；没有目标时面板仍在，输入区禁用。
   */
  const handleOpenGroup = () => {
    setSettingsAgent(null)
    setEmptyTutorMode(false)
    setEmptyVoiceMode(null)
    setGroupOpen(true)
  }

  /**
   * 打开一位声部的独立设置：先把它切成当前声部（左栏高亮跟着走），再进设置态。
   * handleSelectMode 会顺手退出设置态，所以顺序是先切声部、后置设置目标。
   */
  const openAgentSettings = (id: AgentTeamMode) => {
    setGroupOpen(false)
    if (mode !== id) handleSelectMode(id)
    setSettingsAgent(id)
  }

  const handleDeleteFreeConversation = (id: string) => {
    if (id && agent.runningByConversation[id]) {
      onToast(t('这一段正在运行，先停止再删除'))
      return
    }
    const remaining = sortedFreeChats.filter((c) => c.id !== id)
    deleteFreeConversation(id)
    if (id === currentFreeConvId) {
      setFreeConvId(remaining[0]?.id ?? null)
    }
  }

  const handleSelectMode = (next: AgentTeamMode) => {
    setGroupOpen(false)
    setSettingsAgent(null)
    setEmptyVoiceMode(null)
    if (next === 'free') {
      setEmptyTutorMode(false)
      activateAgentTab('free')
      if (!currentFreeConvId && sortedFreeChats.length > 0) {
        setFreeConvId(sortedFreeChats[0].id)
      }
      scheduleFocus()
      return
    }
    if (workViewMeta) {
      if (workViewMeta.goalId) {
        activateAgentTab('ga:' + workViewMeta.goalId + ':' + workViewMeta.conversationId)
      } else {
        activateAgentTab('free')
        setFreeConvId(workViewMeta.conversationId)
      }
      scheduleFocus()
      return
    }
    if (tutorGoalId) {
      setEmptyTutorMode(false)
      if (next !== 'tutor') {
        // 不可交流的 role（调研员 / 维修员）：会话只能由工作流或其它 role 经通道启动，选中不现场建。
        // 有会话就看最近的一段；还没有也允许选中——中央区落本 role 的空白页
        // （会话由工作流与通道触发后才出现，见 emptyVoiceMode）
        if (!isCommunicable(next as AgentProfileId)) {
          const list = voiceChatsOf(next)
          if (list.length) {
            selectConversationIn({ kind: 'goal', goalId: tutorGoalId, conversationId: list[0].id }, list[0].id)
          } else {
            setEmptyVoiceMode(next as AgentTeamMode)
          }
          return
        }
        // 可交流的承接声部：选中它在该目标下**唯一**的工作会话（还没有就落确定性 id 的一段）
        if (!isCommunicable(next as AgentProfileId)) {
          const list = voiceChatsOf(next)
          if (list.length) {
            selectConversationIn({ kind: 'goal', goalId: tutorGoalId, conversationId: list[0].id }, list[0].id)
          } else {
            setEmptyVoiceMode(next as AgentTeamMode)
          }
          return
        }
        const ensured = ensureRoleConversation(getLatest(), next as AgentVoice, tutorGoalId)
        if (ensured.store !== getLatest()) set(ensured.store)
        selectConversationIn({ kind: 'goal', goalId: tutorGoalId, conversationId: ensured.conversationId }, ensured.conversationId)
        scheduleFocus()
        return
      }
      selectTutorGoal(tutorGoalId)
      scheduleFocus()
      return
    }
    setEmptyTutorMode(true)
  }

  const handleHistoryCreate = (agentId: AgentTeamMode) => {
    setGroupOpen(false)
    setSettingsAgent(null)
    setEmptyVoiceMode(null)
    if (agentId === 'free') {
      setEmptyTutorMode(false)
      activateAgentTab('free')
      // role 层单会话：不再新建，复用当前唯一的一段
      setFreeConvId(ensureFreeConversation().id)
      scheduleFocus()
      return
    }
    if (!tutorGoalId) return
    // role 层单会话：已有就选它，没有才落确定性 id；不再新建第二段
    handleSelectMode(agentId)
    scheduleFocus()
  }

  /** 各声部的显示名（profile 覆盖后的）：roster 卡片与空态标题共用这一份 */
  const agentNames = useMemo(
    () => Object.fromEntries(AGENT_ROSTER_ORDER.map((v) => [v, profileOf(agentSettings, v).name ?? ''])),
    [agentSettings],
  )
  /** 各声部的头像 id（profile 覆盖后的）：roster 卡片与声部空白页共用这一份 */
  const agentAvatarIds = useMemo(
    () =>
      Object.fromEntries(
        AGENT_ROSTER_ORDER.map((v) => [v, agentAvatarIdOf(profileOf(agentSettings, v), v)]),
      ) as Record<AgentTeamMode, string>,
    [agentSettings],
  )

  /** 群聊成员：有目标上下文的 role（不含仅聊天的 free；群聊消息最终要落到目标级 role 会话） */
  const groupAgents = useMemo<GroupChatAgent[]>(
    () =>
      AGENT_ROSTER_ORDER.filter((id) => id !== 'free').map((id) => ({
        id,
        name: agentNames?.[id]?.trim() || DEFAULT_AGENT_NAME[id],
        avatarId: agentAvatarIds[id],
        running: Boolean(voiceStats[id]?.running),
      })),
    [agentAvatarIds, agentNames, voiceStats],
  )

  const groupBridge = useGroupChatBridge({
    goalId: tutorGoalId,
    agents: groupAgents,
    getLatest,
    set,
  })
  const groupMessagesForGoal = groupBridge.messages
  const sendGroupMessage = (text: string, targetIds: AgentTeamMode[]): boolean =>
    groupBridge.send(text, targetIds)

  /**
   * 一枚 agent 运行时条目对应的完整 AgentPanel props。
   */
  const agentTabProps = (tab: AgentTabRef) => {
    if (tab.kind === 'free') {
      const convId = currentFreeConvId
      const conv = freeConversationById(convId)
      const stream = convId ? agent.streams[convId] : undefined
      const nope = () => {}
      return {
        conversation: conv ?? null,
        conversations: sortedFreeChats,
        streaming: stream?.parts ?? null,
        streamingMessageId: stream?.messageId ?? null,
        running: !!(convId && agent.runningByConversation[convId]),
        free: true,
        emptyVoice: 'free',
        emptyName: agentNames?.free?.trim() || DEFAULT_AGENT_NAME.free,
        agentAvatarId: agentAvatarIds.free,
        agentNames,
        agentAvatars: agentAvatarIds,
        onSend: (text: string, images: PendingImage[], files: PendingFile[]) => {
          // role 层单会话：没有当前段时也只补唯一的一段，不再多开
          const id = convId ?? ensureFreeConversation().id
          if (id !== convId) setFreeConvId(id)
          if (shouldWaitInLine(id)) {
            agent.enqueueMessage({ conversationId: id, free: true, text, images, files })
            return 'queued' as const
          }
          agent.sendFree(id, text, { files, images })
          return 'sent' as const
        },
        queue: queueOf(agent.queues, convId),
        onQueueDrop: (id: string) => {
          if (convId) agent.dropQueuedMessage(convId, id)
        },
        onQueueSendNow: (id: string) => {
          if (convId) agent.sendQueuedNow(convId, id)
        },
        onStop: () => agent.stop(convId ?? undefined),
        onEditMessage: () => {},
        onDeleteMessage: () => {},
        onResumeInterrupted: () => {},
        ask: null,
        onAskSubmit: () => {},
        onAskCancel: () => {},
        tps: (convId ? agent.tpsByConv[convId] : null) ?? null,
        liveUsage: (convId ? agent.liveUsageByConv[convId] : null) ?? null,
        compacting: false,
        onCompact: nope,
        onSuperLab: nope,
        onExam: nope,
        work: { sessions: [], running: false, live: [] },
        viewWorkId: null,
        onOpenWork: () => {},
        onNewConversation: () => {
          // 单会话：不新开，只回到当前这段
          setFreeConvId(ensureFreeConversation().id)
        },
        onSelectConversation: (id: string) => setFreeConvId(id),
        onDeleteConversation: handleDeleteFreeConversation,
      }
    }
    const isWork = tab.kind === 'work'
    // work 页签的 conversationId 既可能是目标会话，也可能是自由聊天（两者都可能有 work 桶）
    const workConv = isWork
      ? (freeConversationById(tab.conversationId) ?? conversationById(store, tab.conversationId) ?? null)
      : null
    const goalId = isWork ? (workConv?.goalId ?? null) : tab.goalId
    const convId = isWork
      ? (workConv?.id ?? tab.conversationId)
      : tab.conversationId &&
          conversationById(store, tab.conversationId)?.goalId === tab.goalId
        ? tab.conversationId
        : (resolveDisplayedConversation(store, tab.goalId) ?? null)
    const nodeId = goalId
      ? (goalFocusByGoal.get(goalId) ??
          (store.goals.find((g) => g.id === goalId)?.rootNodeId ||
            store.nodes.find((n) => n.goalId === goalId)?.id ||
            null))
      : null
    const conv = isWork ? workConv : convId ? (conversationById(store, convId) ?? null) : null
    const target =
      goalId && convId
        ? { goalId, nodeId: nodeId || null, conversationId: convId, voice: roleOfConversation(conv) as AgentVoice }
        : null
    const works = conv?.works?.sessions ?? []
    const work = isWork ? (works.find((x) => x.id === tab.workId) ?? null) : null
    const stream = convId ? agent.streams[convId] : undefined
    // 面板的会话列表只列本 role 的（导师对话与 specialists 的工作会话互不串台）
    const convVoice = roleOfConversation(conv) as AgentTeamMode
    // keepalive 下多个 role 的页签同时挂着：每一枚面板的抬头/兜底头像必须跟它自己的会话 role 走，
    // 不能使用全局 mode（否则会出现“头像渲染没对上”）
    const panelVoice = (conv ? convVoice : mode) as AgentTeamMode
    const goalConversations = goalId
      ? (goalConversationsByGoal.get(goalId)?.[convVoice] ?? EMPTY_CONVERSATIONS)
      : EMPTY_CONVERSATIONS
    // 锁输入区：不可交流 role 的工作会话（用户只能看，不能直接往里发）
    const chatLocked = conv
      ? !COMMUNICABLE_VOICES.has(roleOfConversation(conv) as AgentVoice)
      : mode !== 'tutor' && mode !== 'free' && !isCommunicable(mode as AgentProfileId)
    return {
      goalId,
      chatLocked,
      emptyVoice: panelVoice,
      emptyName: agentNames?.[panelVoice]?.trim() || DEFAULT_AGENT_NAME[panelVoice],
      agentAvatarId: agentAvatarIds[panelVoice],
      agentNames,
      agentAvatars: agentAvatarIds,
      conversation: conv,
      conversations: goalConversations,
      streaming: stream?.parts ?? null,
      streamingMessageId: stream?.messageId ?? null,
      running: !!(convId && agent.runningByConversation[convId]),
      onSend: (text: string, images: PendingImage[], files: PendingFile[]) => {
        if (!target) return 'sent' as const
        // 不可交流 role 的硬闸：输入区已锁，这里再拦一道（工作流触发不走这条路）
        if (!COMMUNICABLE_VOICES.has(target.voice)) return 'sent' as const
        // user 通道入站：对话层只读 channels，用户自己说的话也要有来源与时间戳
        const stored = conversationById(getLatest(), target.conversationId)
        let channel: ChannelStamp | undefined
        if (stored && text.trim()) {
          const envelope = inboundEnvelope({
            channel: 'user',
            from: userPeer(),
            to: peerOf('agent', target.voice, agentNames?.[target.voice]?.trim() || DEFAULT_AGENT_NAME[target.voice]),
            text,
          })
          channel = { channel: 'user', from: envelope.from, to: envelope.to, ts: envelope.ts, envelopeId: envelope.id }
          set({
            ...getLatest(),
            conversations: getLatest().conversations.map((c) =>
              c.id === stored.id
                ? { ...c, channels: [...(c.channels ?? []), envelope].slice(-200), updatedAt: Date.now() }
                : c,
            ),
          })
        }
        if (shouldWaitInLine(target.conversationId)) {
          agent.enqueueMessage({
            conversationId: target.conversationId,
            target,
            text,
            images,
            files,
            ...(channel ? { channel } : {}),
          })
          return 'queued' as const
        }
        agent.send(text, {
          target,
          ...(images.length || files.length
            ? { images: images.length ? images : undefined, files: files.length ? files : undefined }
            : {}),
          ...(channel ? { channel } : {}),
        })
        return 'sent' as const
      },
      queue: queueOf(agent.queues, convId),
      onQueueDrop: (id: string) => {
        if (convId) agent.dropQueuedMessage(convId, id)
      },
      onQueueSendNow: (id: string) => {
        if (convId) agent.sendQueuedNow(convId, id)
      },
      onStop: () => agent.stop(convId ?? undefined),
      onEditMessage: (messageId: string, text: string) => {
        resetPrefixGate(convId ?? '')
        set(updateMessageText(getLatest(), convId ?? '', messageId, text))
      },
      onDeleteMessage: (messageId: string) => {
        resetPrefixGate(convId ?? '')
        const next = deleteMessage(getLatest(), convId ?? '', messageId)
        set(next)
        pruneImagesOf(next)
      },
      onResumeInterrupted: () => {
        if (target) agent.resumeInterrupted(target)
      },
      ask: (convId ? agent.pendingAskByConv[convId] : null) ?? null,
      onAskSubmit: (answers: AskAnswers) => {
        if (convId) agent.submitAsk(answers, convId)
      },
      onAskCancel: () => {
        if (convId) agent.cancelAsk(convId)
      },
      tps: (convId ? agent.tpsByConv[convId] : null) ?? null,
      liveUsage: (convId ? agent.liveUsageByConv[convId] : null) ?? null,
      compacting: !!convId && agent.compactingConvId === convId,
      onCompact: () => {
        if (convId) void agent.compactNow(convId)
      },
      onSuperLab: () => {
        if (nodeId) startSuperLab(nodeId)
      },
      onExam: () => newExam(nodeId ?? undefined),
      work: {
        sessions: works,
        running: workRunsAll.some((r) => r.conversationId === convId),
        live: workRunsAll
          .filter((r) => r.conversationId === convId)
          .map(({ workId, runId, parts }) => ({ workId, runId, parts })),
      },
      viewWorkId: work?.id ?? null,
      onOpenWork: (wid: string) => {
        if (convId) openAgentTab({ kind: 'work', conversationId: convId, workId: wid }, true)
      },
      // role 层单会话：加号不新建，只回到当前 role 的唯一会话
      onNewConversation: () =>
        handleHistoryCreate(
          (convId ? roleOfConversation(conversationById(store, convId)) : 'tutor') as AgentTeamMode,
        ),
      onSelectConversation: (id: string) => selectConversationIn(tab, id),
      onDeleteConversation: removeConversation,
    }
  }

  const showCenterPane = groupOpen || mode === 'free' || Boolean(tutorGoalId)

  const scopedPanes = useMemo(() => {
    if (!tabGoalId) return agentPanes
    const out = agentPanes.filter((tab) => {
      if (tab.kind === 'free') return true
      if (tab.kind === 'goal') return tab.goalId === tabGoalId
      // 自由聊天也可以是 work 的宿主（它同样有独立 work 桶）
      if (freeConversationById(tab.conversationId)) return true
      return conversationById(store, tab.conversationId)?.goalId === tabGoalId
    })
    const hasActiveGoalPane = activeTutorConvId
      ? out.some(
          (tab) => tab.kind === 'goal' && tab.goalId === tabGoalId && tab.conversationId === activeTutorConvId,
        )
      : out.some((tab) => tab.kind === 'goal' && tab.goalId === tabGoalId)
    if (!hasActiveGoalPane) {
      out.push({ kind: 'goal', goalId: tabGoalId, conversationId: activeTutorConvId })
    }
    return out
  }, [agentPanes, tabGoalId, store, activeTutorConvId])

  const renderedActivePaneId = useMemo(() => {
    if (groupOpen) return null
    if (mode === 'free') return 'free'
    if (workViewMeta) return workViewMeta.key
    if (tabGoalId) {
      // 一个学习目标在 agentTabs 里可以并存多个会话页签（ga:<goalId>:<convId>），
      // 必须按 activeTutorConvId 精确匹配当前激活的那一段对话，否则永远只会命中第一枚。
      const matched =
        (activeTutorConvId
          ? scopedPanes.find(
              (t) =>
                t.kind === 'goal' &&
                t.goalId === tabGoalId &&
                t.conversationId === activeTutorConvId,
            )
          : undefined) ?? scopedPanes.find((t) => t.kind === 'goal' && t.goalId === tabGoalId)
      return matched ? agentTabKey(matched) : activeAgentTabId
    }
    return activeAgentTabId
  }, [groupOpen, mode, workViewMeta, tabGoalId, activeTutorConvId, scopedPanes, activeAgentTabId])

  return (
    <div
      ref={containerRef}
      data-agent-roster-top={rosterTopBar ? 'true' : undefined}
      className={
        'flex h-full min-h-0 w-full overflow-hidden ' + (rosterTopBar ? 'flex-col' : 'flex-row')
      }
    >
      {/* Agent 列表（仅聊天 / 导师）：常规为左侧竖栏；宽度 < 800 时切顶部横栏形态 */}
      <AgentRosterSidebar
        mode={mode}
        onSelectMode={handleSelectMode}
        activeGoalTitle={activeGoalTitle}
        voiceStats={voiceStats}
        variant={rosterTopBar ? 'top' : 'side'}
        persistCollapsed={persistLayout}
        worksByAgent={worksByAgent}
        activeGoalId={tutorGoalId}
        goalLocked={Boolean(tabGoalId)}
        goals={store.goals}
        goalTitleOf={goalTitleOf}
        onSelectGoal={(goalId) => {
          setEmptyTutorMode(false)
          setEmptyVoiceMode(null)
          selectTutorGoal(goalId)
          scheduleFocus()
        }}
        onOpenWork={openWorkFromRoster}
        onOpenSettings={openAgentSettings}
        agentNames={agentNames}
        agentAvatars={agentAvatarIds}
        groupActive={groupOpen}
        onOpenGroup={handleOpenGroup}
      />

      {/* 中间对话主工作区；设置态下整块替换为这位声部的独立设置页 */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-paper-deep/40">
        {settingsAgent ? (
          <AgentSettingsView
            agentId={settingsAgent}
            profile={profileOf(agentSettings, settingsAgent)}
            onChange={(patch) => updateAgentProfile(settingsAgent, patch)}
            onReset={() => {
              resetAgentProfile(settingsAgent)
              onToast(t('已恢复默认设置'))
            }}
            onClose={() => setSettingsAgent(null)}
            flowRows={settingsAgent === 'tutor' ? listWorkflowRows(store, tutorGoalId) : EMPTY_WF_ROWS}
          />
        ) : (
          <>
        {workViewMeta && mode === 'tutor' && !groupOpen && (
          <div className="flex shrink-0 items-center gap-2 border-b border-line/70 bg-card/70 px-3.5 py-1.5 text-[12px]">
            <button
              type="button"
              onClick={() => activateAgentTab('ga:' + workViewMeta.goalId + ':' + workViewMeta.conversationId)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-ink-soft transition hover:bg-line/50 hover:text-ink-strong"
            >
              <ArrowLeft size={13} />
              <span>{t('返回角色对话')}</span>
            </button>
            <span aria-hidden="true" className="h-3.5 w-px bg-line" />
            <Bot size={13} className="shrink-0 text-seal" />
            <span className="truncate font-medium text-ink-strong">{workViewMeta.name}</span>
            <span className="truncate text-[11px] text-ink-faint">{t('工作层 · 独立上下文')}</span>
          </div>
        )}

        {!showCenterPane && !emptyVoiceActive ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-600 dark:text-sky-300">
              <GraduationCap size={22} />
            </div>
            <div className="space-y-1">
              <div className="text-[14px] font-medium text-ink-strong">{t('超级导师')}</div>
              <p className="max-w-[280px] text-[12px] leading-relaxed text-ink-faint">
                {store.goals.length > 0
                  ? t('当前未选择学习目标，可从下方挑选一个目标直接开启导师对话：')
                  : t('打开或新建一个学习目标后，它的导师会在这里出现。')}
              </p>
            </div>
            {store.goals.length > 0 && (
              <div className="mt-1 flex max-w-[420px] flex-wrap items-center justify-center gap-2">
                {store.goals.map((g) => {
                  const title = goalTitleOf(g.id)
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => {
                        setEmptyTutorMode(false)
                        setEmptyVoiceMode(null)
                        selectTutorGoal(g.id)
                        scheduleFocus()
                      }}
                      className="rounded-xl border border-line/80 bg-card/80 px-3 py-1.5 text-[12px] font-medium text-ink-strong transition hover:border-line-strong hover:bg-card"
                    >
                      {title}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ) : null}

        {/* 选中了还没有会话的声部：本声部的空白页（会话由工作流与委托触发后才出现） */}
        {emptyVoiceActive ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <span
              className={
                'flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border ' +
                AGENT_ROSTER_META[emptyVoiceActive].avatarClass
              }
            >
              <AgentAvatarGlyph
                avatarId={agentAvatarIds[emptyVoiceActive]}
                fallback={AGENT_ROSTER_META[emptyVoiceActive].fallbackIcon}
                size={24}
                imgSize={44}
                imgClassName="h-11 w-11 rounded-full"
              />
            </span>
            <div className="space-y-1">
              <div className="text-[14px] font-medium text-ink-strong">
                {agentNames?.[emptyVoiceActive]?.trim() || DEFAULT_AGENT_NAME[emptyVoiceActive]}
              </div>
              <p className="max-w-[280px] text-[12px] leading-relaxed text-ink-faint">
                {t(AGENT_ROSTER_META[emptyVoiceActive].emptyHint)}
              </p>
            </div>
          </div>
        ) : null}

        <div className={showCenterPane && !emptyVoiceActive ? 'relative min-h-0 flex-1' : 'hidden'}>
          {groupOpen ? (
            <div className="absolute inset-0 z-10 overflow-hidden bg-paper-deep/40">
              <GroupChatPanel
                messages={groupMessagesForGoal}
                agents={groupAgents}
                disabledReason={
                  tutorGoalId
                    ? undefined
                    : t('群聊挂在学习目标上：先选择一个目标，再在群里 @ 指定 agent。')
                }
                onSend={sendGroupMessage}
              />
            </div>
          ) : null}
          {scopedPanes.map((tab) => {
            const key = agentTabKey(tab)
            const on = tabActive && showCenterPane && !groupOpen && key === renderedActivePaneId
            const props = agentTabProps(tab)
            return (
              <AgentTabPane
                key={key}
                tabKey={key}
                active={on}
                hasKey={hasKey}
                providerLabel={providerName}
                onModelChanged={() => setSettingsEpoch((n) => n + 1)}
                vision={vision}
                onNotice={onToast}
                onOpenAgentSettings={() => openTab({ kind: 'agentSettings' })}
                onOpenSettings={() => openTab({ kind: 'agentSettings' })}
                effort={effort}
                onSetEffort={setGlobalEffort}
                compactThreshold={agentSettings.compact.threshold}
                persona={agentSettings.persona}
                onPickPersona={(id) => {
                  saveAgentSettings({ ...agentSettings, persona: id })
                  onToast(t('导师人格已切到「{0}」，从下一轮开始生效', personaOf(id).label))
                }}
                docFormat={agentSettings.docFormat}
                onPickDocFormat={(id) => {
                  saveAgentSettings({ ...agentSettings, docFormat: id })
                  onToast(t('文档格式已切到「{0}」，从下一轮开始生效', docFormatOf(id).label))
                }}
                onOpenFile={(pathOrRel, title) => {
                  const norm = pathOrRel.replace(/\\/g, '/')
                  const isAbs = /^[a-zA-Z]:[/\\]|^[/\\]{2}|^\//.test(norm)
                  if (!isAbs) {
                    const targetGoalId = tab.kind === 'goal' ? tab.goalId : (store.activeGoalId ?? undefined)
                    const wsRel = wsChipUserRel(getLatest(), norm, targetGoalId)
                    const wsRef = wsRel ? wsRefOfRel(getLatest(), wsRel) : null
                    if (wsRef) {
                      openTab(wsRef)
                      return
                    }
                  }
                  const abs = isAbs ? norm : (userAbsPath(norm) ?? norm)
                  openTab({ kind: 'local', path: abs, ...(title ? { title } : {}) })
                }}
                {...props}
              />
            )
          })}
        </div>
          </>
        )}
      </div>
    </div>
  )
}
