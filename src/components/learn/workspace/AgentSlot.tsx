import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { ArrowLeft, Bot, GraduationCap } from 'lucide-react'
import type { AgentTabRef, DocView, LearnStore, TabRef } from '../../../learn/types'
import { agentTabKey } from '../../../learn/agentTabs'
import { queueOf } from '../../../learn/agentQueue'
import {
  addFreeConversation,
  deleteFreeConversation,
  freeConversationById,
} from '../../../learn/freeChat'
import { conversationById, deleteMessage, nodeById, resolveDisplayedConversation, updateMessageText } from '../../../learn/graph'
import { resetPrefixGate } from '../../../agent/prefixGate'
import { saveAgentSettings, loadAgentSettings } from '../../../agent/settings'
import { personaOf } from '../../../agent/persona'
import { docFormatOf } from '../../../agent/docFormat'
import type { Conversation, PendingFile, PendingImage } from '../../../agent/types'
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
import { agentAvatarIdOf, profileOf, resetAgentProfile, updateAgentProfile, type AgentVoice } from '../../../agent/agentProfile'
import { voiceOfConversation, voiceConversationId } from '../../../learn/agentTeam/voiceConvs'
import { AGENT_ROSTER_ORDER, type AgentVoiceStats } from '../agent-team/agentRoster'
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

/**
 * agent 栏（左侧 Agent 列表——声部项内嵌各自对话历史 + 中间 keepalive 面板）需要的宿主能力与派生值。
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
  exitSubagentView: (subKey: string, parentGoalId: string, parentConvId: string) => void
  handleNewGoalConversation: (goalId?: string) => void
  removeConversation: (conversationId: string) => void
  newConversationIn: (tab: AgentTabRef) => void
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
 * 左栏（Agent 垂直列表：仅聊天 / 导师，各声部项内嵌可收展的子对话列表）
 * + 中栏（keepalive AgentPanel）。对话历史只住在左栏声部项下，不再有右栏。
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
    exitSubagentView,
    handleNewGoalConversation,
    removeConversation,
    newConversationIn,
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

  // 当工作区尚无激活目标时，允许用户点击「导师」停留并呈现目标选择空态
  const [emptyTutorMode, setEmptyTutorMode] = useState(false)
  /**
   * 智能体设置态：非 null 时中央工作区显示这位声部的独立设置页（AgentSettingsView），
   * 替代对话流。选择声部 / 选对话 / 新建对话 / 切目标都会退出设置态回到对话。
   */
  const [settingsAgent, setSettingsAgent] = useState<AgentTeamMode | null>(null)

  const tutorGoalId = useMemo(() => {
    if (tabGoalId) return tabGoalId
    if (activeAgentTab.kind === 'goal') return activeAgentTab.goalId
    if (activeAgentTab.kind === 'sub') {
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
      const voice = voiceOfConversation(c) as AgentTeamMode
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

  const activeTutorConvId = useMemo(() => {
    if (activeAgentTab.kind === 'sub') {
      const subConv = conversationById(store, activeAgentTab.conversationId)
      if (!tabGoalId || subConv?.goalId === tabGoalId) return activeAgentTab.conversationId
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
  const activeVoice: AgentTeamMode = voiceOfConversation(
    conversationById(store, activeTutorConvId),
  ) as AgentTeamMode

  const mode: AgentTeamMode =
    activeAgentTab.kind !== 'free'
      ? activeVoice
      : tutorGoalId === null && emptyTutorMode
        ? 'tutor'
        : 'free'

  const subViewMeta = useMemo(() => {
    if (activeAgentTab.kind !== 'sub') return null
    const conv = conversationById(store, activeAgentTab.conversationId)
    if (!conv) return null
    if (tabGoalId && conv.goalId !== tabGoalId) return null
    const session = conv.subagents?.sessions.find((s) => s.id === activeAgentTab.sessionId)
    const def = session ? conv.subagents?.defs.find((d) => d.key === session.defKey) : undefined
    return {
      key: agentTabKey(activeAgentTab),
      goalId: conv.goalId,
      conversationId: conv.id,
      name: def?.name ?? session?.defKey ?? t('子代理'),
    }
  }, [activeAgentTab, store, tabGoalId])

  /**
   * 各声部的近况统计（左栏联系人卡片的运行点 / 表单点 / 预览 / 时间 / 未读数）。
   * 作用域与旧的 tutor 口径一致：固定目标页签只看该目标；全局看 store 全部（按声部过滤）。
   */
  const voiceStats = useMemo(() => {
    const out: Partial<Record<AgentTeamMode, AgentVoiceStats>> = {}
    for (const voice of AGENT_ROSTER_ORDER) {
      const list = tabGoalId
        ? (goalConversationsByGoal.get(tabGoalId)?.[voice] ?? EMPTY_CONVERSATIONS)
        : store.conversations.filter((c) => voiceOfConversation(c) === voice)
      const latest = list[0]
      out[voice] = {
        running: list.some(
          (c) =>
            Boolean(agent.runningByConversation[c.id]) ||
            agent.subRunsAll.some((r) => r.conversationId === c.id),
        ),
        hasAsk: list.some((c) => Boolean(agent.pendingAskByConv[c.id])),
        preview: lastMessagePreview(latest),
        lastTime: latest ? conversationTimeOf(latest) : 0,
        count: list.length,
      }
    }
    return out
    // agent.* 的三张表是状态槽（引用随运行变化），一并列进来
  }, [tabGoalId, store.conversations, agent.runningByConversation, agent.pendingAskByConv, agent.subRunsAll, goalConversationsByGoal])

  const scheduleFocus = () => {
    window.setTimeout(() => focusAgentInput(), 30)
  }

  /**
   * 打开一位声部的独立设置：先把它切成当前声部（左栏高亮跟着走），再进设置态。
   * handleSelectMode 会顺手退出设置态，所以顺序是先切声部、后置设置目标。
   */
  const openAgentSettings = (id: AgentTeamMode) => {
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
    setSettingsAgent(null)
    if (next === 'free') {
      setEmptyTutorMode(false)
      activateAgentTab('free')
      if (!currentFreeConvId && sortedFreeChats.length > 0) {
        setFreeConvId(sortedFreeChats[0].id)
      }
      scheduleFocus()
      return
    }
    if (subViewMeta) {
      exitSubagentView(subViewMeta.key, subViewMeta.goalId, subViewMeta.conversationId)
      scheduleFocus()
      return
    }
    if (tutorGoalId) {
      setEmptyTutorMode(false)
      if (next !== 'tutor') {
        // 承接声部：选中它按目标建好的工作会话（还没有就现场落一段，确定性 id 见 voiceConvs）
        const convId = voiceConversationId(tutorGoalId, next)
        if (!conversationById(getLatest(), convId)) {
          set({
            ...getLatest(),
            conversations: [
              ...getLatest().conversations,
              {
                id: convId,
                goalId: tutorGoalId,
                voice: next,
                messages: [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
            ],
          })
        }
        selectConversationIn({ kind: 'goal', goalId: tutorGoalId, conversationId: convId }, convId)
        scheduleFocus()
        return
      }
      selectTutorGoal(tutorGoalId)
      scheduleFocus()
      return
    }
    setEmptyTutorMode(true)
  }

  const handleHistorySelect = (agentId: AgentTeamMode, convId: string) => {
    setSettingsAgent(null)
    if (agentId === 'free') {
      setEmptyTutorMode(false)
      activateAgentTab('free')
      setFreeConvId(convId)
      scheduleFocus()
      return
    }
    if (!tutorGoalId) return
    selectConversationIn({ kind: 'goal', goalId: tutorGoalId, conversationId: convId }, convId)
    scheduleFocus()
  }

  const handleHistoryCreate = (agentId: AgentTeamMode) => {
    setSettingsAgent(null)
    if (agentId === 'free') {
      setEmptyTutorMode(false)
      activateAgentTab('free')
      const created = addFreeConversation()
      setFreeConvId(created.id)
      scheduleFocus()
      return
    }
    if (agentId !== 'tutor') return
    if (!tutorGoalId) return
    handleNewGoalConversation(tutorGoalId)
    scheduleFocus()
  }

  const handleHistoryDelete = (agentId: AgentTeamMode, convId: string) => {
    if (agentId === 'free') {
      handleDeleteFreeConversation(convId)
      return
    }
    removeConversation(convId)
  }

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
        onSend: (text: string, images: PendingImage[], files: PendingFile[]) => {
          const id = convId ?? addFreeConversation().id
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
        sub: { sessions: [], defs: [], running: false, live: [] },
        viewSubId: null,
        onOpenSub: () => {},
        onNewConversation: () => {
          setFreeConvId(addFreeConversation().id)
        },
        onSelectConversation: (id: string) => setFreeConvId(id),
        onDeleteConversation: handleDeleteFreeConversation,
      }
    }
    const isSub = tab.kind === 'sub'
    const goalId = isSub ? (conversationById(store, tab.conversationId)?.goalId ?? null) : tab.goalId
    const convId = isSub
      ? tab.conversationId
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
    const conv = convId ? (conversationById(store, convId) ?? null) : null
    const target =
      goalId && convId
        ? { goalId, nodeId: nodeId || null, conversationId: convId, voice: voiceOfConversation(conv) as AgentVoice }
        : null
    const bucket = conv?.subagents
    const sessions = bucket?.sessions ?? []
    const session = isSub ? (sessions.find((x) => x.id === tab.sessionId) ?? null) : null
    const stream = convId ? agent.streams[convId] : undefined
    // 面板的会话列表只列本声部的（导师对话与承接声部的工作会话互不串台）
    const convVoice = voiceOfConversation(conv) as AgentTeamMode
    const goalConversations = goalId
      ? (goalConversationsByGoal.get(goalId)?.[convVoice] ?? EMPTY_CONVERSATIONS)
      : EMPTY_CONVERSATIONS
    return {
      goalId,
      conversation: conv,
      conversations: goalConversations,
      streaming: stream?.parts ?? null,
      streamingMessageId: stream?.messageId ?? null,
      running: !!(convId && agent.runningByConversation[convId]),
      onSend: (text: string, images: PendingImage[], files: PendingFile[]) => {
        if (!target) return 'sent' as const
        if (shouldWaitInLine(target.conversationId)) {
          agent.enqueueMessage({
            conversationId: target.conversationId,
            target,
            text,
            images,
            files,
          })
          return 'queued' as const
        }
        agent.send(text, {
          target,
          ...(images.length || files.length
            ? { images: images.length ? images : undefined, files: files.length ? files : undefined }
            : {}),
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
      sub: {
        sessions,
        defs: bucket?.defs ?? [],
        running: agent.subRunsAll.some((r) => r.conversationId === convId),
        live: agent.subRunsAll
          .filter((r) => r.conversationId === convId)
          .map(({ sessionId: sid, runId, parts }) => ({ sessionId: sid, runId, parts })),
      },
      viewSubId: session?.id ?? null,
      onOpenSub: (sid: string) => {
        if (convId) openAgentTab({ kind: 'sub', conversationId: convId, sessionId: sid }, true)
      },
      onNewConversation: () => newConversationIn(tab),
      onSelectConversation: (id: string) => selectConversationIn(tab, id),
      onDeleteConversation: removeConversation,
    }
  }

  const showCenterPane = mode === 'free' || Boolean(tutorGoalId)

  const scopedPanes = useMemo(() => {
    if (!tabGoalId) return agentPanes
    const out = agentPanes.filter((tab) => {
      if (tab.kind === 'free') return true
      if (tab.kind === 'goal') return tab.goalId === tabGoalId
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
    if (mode === 'free') return 'free'
    if (subViewMeta) return subViewMeta.key
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
  }, [mode, subViewMeta, tabGoalId, activeTutorConvId, scopedPanes, activeAgentTabId])

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
        conversationsByAgent={{
          free: sortedFreeChats,
          tutor: sortedGoalChats,
          examiner: voiceChatsOf('examiner'),
          grader: voiceChatsOf('grader'),
          researcher: voiceChatsOf('researcher'),
        }}
        activeConversationByAgent={{
          free: currentFreeConvId,
          tutor: activeTutorConvId,
          examiner: mode === 'examiner' ? activeTutorConvId : (voiceChatsOf('examiner')[0]?.id ?? null),
          grader: mode === 'grader' ? activeTutorConvId : (voiceChatsOf('grader')[0]?.id ?? null),
          researcher: mode === 'researcher' ? activeTutorConvId : (voiceChatsOf('researcher')[0]?.id ?? null),
        }}
        runningByConversation={agent.runningByConversation}
        pendingAskByConv={agent.pendingAskByConv}
        activeGoalId={tutorGoalId}
        goalLocked={Boolean(tabGoalId)}
        goals={store.goals}
        goalTitleOf={goalTitleOf}
        onSelectGoal={(goalId) => {
          setEmptyTutorMode(false)
          selectTutorGoal(goalId)
          scheduleFocus()
        }}
        onSelectConversation={handleHistorySelect}
        onNewConversation={handleHistoryCreate}
        onDeleteConversation={handleHistoryDelete}
        onOpenSettings={openAgentSettings}
        agentNames={Object.fromEntries(AGENT_ROSTER_ORDER.map((v) => [v, profileOf(agentSettings, v).name ?? '']))}
        agentAvatars={Object.fromEntries(
          AGENT_ROSTER_ORDER.map((v) => [v, agentAvatarIdOf(profileOf(agentSettings, v), v)]),
        )}
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
        {subViewMeta && mode === 'tutor' && (
          <div className="flex shrink-0 items-center gap-2 border-b border-line/70 bg-card/70 px-3.5 py-1.5 text-[12px]">
            <button
              type="button"
              onClick={() => exitSubagentView(subViewMeta.key, subViewMeta.goalId, subViewMeta.conversationId)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-ink-soft transition hover:bg-line/50 hover:text-ink-strong"
            >
              <ArrowLeft size={13} />
              <span>{t('返回导师对话')}</span>
            </button>
            <span aria-hidden="true" className="h-3.5 w-px bg-line" />
            <Bot size={13} className="shrink-0 text-seal" />
            <span className="truncate font-medium text-ink-strong">{subViewMeta.name}</span>
            <span className="truncate text-[11px] text-ink-faint">{t('子代理独立会话')}</span>
          </div>
        )}

        {!showCenterPane ? (
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

        <div className={showCenterPane ? 'relative min-h-0 flex-1' : 'hidden'}>
          {scopedPanes.map((tab) => {
            const key = agentTabKey(tab)
            const on = tabActive && showCenterPane && key === renderedActivePaneId
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
