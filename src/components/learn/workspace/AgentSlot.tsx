import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
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
import { goalFocusByGoal } from './goalFocus'
import { AgentRosterSidebar } from '../agent-team/AgentRosterSidebar'
import { AgentHistorySidebar } from '../agent-team/AgentHistorySidebar'
import { sortConversationsByTimeDesc, type AgentTeamMode } from '../agent-team/conversationList'
import type { useAgent } from '../../../learn/useAgent'
import type { useWorkflowStarters } from './useWorkflowStarters'
import { t } from '../../../i18n'

type AgentApi = ReturnType<typeof useAgent>
type StartersApi = ReturnType<typeof useWorkflowStarters>
type AgentSettings = ReturnType<typeof loadAgentSettings>

/**
 * agent 栏（左侧 Agent 列表 + 中间 keepalive 面板 + 右侧对话历史侧栏）需要的宿主能力与派生值。
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
}

/**
 * 智能体团队三栏工作台：
 * 左栏（Agent 垂直列表：仅聊天 / 导师） + 中栏（keepalive AgentPanel） + 右栏（按对话时间降序的对话历史侧栏）。
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
  } = deps

  // 当工作区尚无激活目标时，允许用户点击「导师」停留并呈现目标选择空态
  const [emptyTutorMode, setEmptyTutorMode] = useState(false)

  const tutorGoalId = useMemo(() => {
    if (activeAgentTab.kind === 'goal') return activeAgentTab.goalId
    if (activeAgentTab.kind === 'sub') {
      return conversationById(store, activeAgentTab.conversationId)?.goalId ?? store.activeGoalId ?? null
    }
    return store.activeGoalId ?? null
  }, [activeAgentTab, store])

  const mode: AgentTeamMode =
    activeAgentTab.kind !== 'free'
      ? 'tutor'
      : tutorGoalId === null && emptyTutorMode
        ? 'tutor'
        : 'free'

  const goalTitleOf = (goalId: string): string => {
    const goal = store.goals.find((g) => g.id === goalId)
    if (!goal) return ''
    return nodeById(store, goal.rootNodeId)?.title || goal.title || goal.question || t('未命名目标')
  }

  const activeGoalTitle = tutorGoalId ? goalTitleOf(tutorGoalId) : null

  const sortedFreeChats = useMemo(() => sortConversationsByTimeDesc(freeChats), [freeChats])
  const sortedGoalChats = useMemo(
    () =>
      tutorGoalId
        ? sortConversationsByTimeDesc(store.conversations.filter((c) => c.goalId === tutorGoalId))
        : [],
    [store.conversations, tutorGoalId],
  )

  const activeTutorConvId = useMemo(() => {
    if (activeAgentTab.kind === 'sub') return activeAgentTab.conversationId
    if (activeAgentTab.kind === 'goal') {
      if (
        activeAgentTab.conversationId &&
        conversationById(store, activeAgentTab.conversationId)?.goalId === activeAgentTab.goalId
      ) {
        return activeAgentTab.conversationId
      }
      return resolveDisplayedConversation(store, activeAgentTab.goalId) ?? sortedGoalChats[0]?.id ?? null
    }
    return null
  }, [activeAgentTab, store, sortedGoalChats])

  const subViewMeta = useMemo(() => {
    if (activeAgentTab.kind !== 'sub') return null
    const conv = conversationById(store, activeAgentTab.conversationId)
    if (!conv) return null
    const session = conv.subagents?.sessions.find((s) => s.id === activeAgentTab.sessionId)
    const def = session ? conv.subagents?.defs.find((d) => d.key === session.defKey) : undefined
    return {
      key: agentTabKey(activeAgentTab),
      goalId: conv.goalId,
      conversationId: conv.id,
      name: def?.name ?? session?.defKey ?? t('子代理'),
    }
  }, [activeAgentTab, store])

  const freeRunning = freeChats.some((c) => Boolean(agent.runningByConversation[c.id]))
  const tutorRunning = store.conversations.some(
    (c) =>
      Boolean(agent.runningByConversation[c.id]) ||
      agent.subRunsAll.some((r) => r.conversationId === c.id),
  )
  const tutorHasAsk = store.conversations.some((c) => Boolean(agent.pendingAskByConv[c.id]))

  const scheduleFocus = () => {
    window.setTimeout(() => focusAgentInput(), 30)
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
      selectTutorGoal(tutorGoalId)
      scheduleFocus()
      return
    }
    setEmptyTutorMode(true)
  }

  const handleHistorySelect = (convId: string) => {
    if (mode === 'free') {
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

  const handleHistoryCreate = () => {
    if (mode === 'free') {
      setEmptyTutorMode(false)
      activateAgentTab('free')
      const created = addFreeConversation()
      setFreeConvId(created.id)
      scheduleFocus()
      return
    }
    if (!tutorGoalId) return
    handleNewGoalConversation(tutorGoalId)
    scheduleFocus()
  }

  const handleHistoryDelete = (convId: string) => {
    if (mode === 'free') {
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
    const target = goalId && convId ? { goalId, nodeId: nodeId || null, conversationId: convId } : null
    const bucket = conv?.subagents
    const sessions = bucket?.sessions ?? []
    const session = isSub ? (sessions.find((x) => x.id === tab.sessionId) ?? null) : null
    const stream = convId ? agent.streams[convId] : undefined
    const goalConversations = goalId
      ? sortConversationsByTimeDesc(store.conversations.filter((c) => c.goalId === goalId))
      : []
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

  return (
    <div className="flex h-full min-h-0 w-full flex-row overflow-hidden">
      {/* 左侧垂直 Agent 列表：仅聊天 / 导师 */}
      <AgentRosterSidebar
        mode={mode}
        onSelectMode={handleSelectMode}
        activeGoalTitle={activeGoalTitle}
        freeRunning={freeRunning}
        tutorRunning={tutorRunning}
        tutorHasAsk={tutorHasAsk}
      />

      {/* 中间对话主工作区 */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-paper-deep/40">
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
          {agentPanes.map((tab) => {
            const key = agentTabKey(tab)
            const on = tabActive && showCenterPane && key === activeAgentTabId
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
      </div>

      {/* 右侧对话历史侧栏：按对话时间降序，支持创建与删除 */}
      <AgentHistorySidebar
        mode={mode}
        conversations={mode === 'free' ? sortedFreeChats : sortedGoalChats}
        activeConversationId={mode === 'free' ? currentFreeConvId : activeTutorConvId}
        runningByConversation={agent.runningByConversation}
        pendingAskByConv={agent.pendingAskByConv}
        activeGoalId={tutorGoalId}
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
      />
    </div>
  )
}
