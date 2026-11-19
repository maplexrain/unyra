import { useState, useCallback, useMemo } from 'react'
import AgentPanel from '../../agent/AgentPanel'
import {
  conversationById,
  deleteMessage,
  ensureConversation,
  resolveDisplayedConversation,
  updateMessageText,
  addConversation,
  deleteConversation,
} from '../../../learn/graph'
import { resetPrefixGate } from '../../../agent/prefixGate'
import { loadAgentSettings, saveAgentSettings } from '../../../agent/settings'
import { personaOf } from '../../../agent/persona'
import { docFormatOf } from '../../../agent/docFormat'
import { queueOf } from '../../../learn/agentQueue'
import {
  activeLabel,
  loadAiSettings,
  saveAiSettings,
  globalEffort,
  supportsImage,
  hasApiKey,
} from '../../../ai/settings'
import type { ReasoningEffort } from '../../../ai/types'
import type { AskAnswers } from '../../../agent/tools'
import type { Conversation, PendingFile, PendingImage } from '../../../agent/types'
import type { LearnStore, TabRef, DocView } from '../../../learn/types'
import type { useAgent } from '../../../learn/useAgent'
import { t } from '../../../i18n'
import { FolderPlus } from 'lucide-react'

type AgentApi = ReturnType<typeof useAgent>
type AgentSettings = ReturnType<typeof loadAgentSettings>

export interface AgentTeamTutorPaneProps {
  goalId?: string
  store: LearnStore
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  agent: AgentApi
  agentSettings?: AgentSettings
  hasKey?: boolean
  openTab?: (ref: TabRef, preferredView?: DocView) => void
  onToast?: (msg: string) => void
}

export function AgentTeamTutorPane({
  goalId: propGoalId,
  store,
  getLatest,
  set,
  agent,
  agentSettings: propSettings,
  hasKey: propHasKey,
  openTab,
  onToast,
}: AgentTeamTutorPaneProps) {
  const [settingsEpoch, setSettingsEpoch] = useState(0)
  const currentAgentSettings = useMemo(
    () => propSettings ?? loadAgentSettings(),
    [propSettings, settingsEpoch],
  )
  const aiSettings = useMemo(() => loadAiSettings(), [settingsEpoch])
  const providerLabel = useMemo(() => activeLabel(aiSettings), [aiSettings])
  const hasKey = propHasKey ?? hasApiKey(aiSettings)
  const vision = useMemo(() => supportsImage(aiSettings), [aiSettings])
  const effort = useMemo(() => globalEffort(aiSettings), [aiSettings])

  const setGlobalEffort = useCallback((next: ReasoningEffort) => {
    const cur = loadAiSettings()
    saveAiSettings({ ...cur, global: { ...cur.global, effort: next } })
    setSettingsEpoch((n) => n + 1)
  }, [])

  // 当前目标推导：优先使用传入的 goalId，否则回退到 store.activeGoalId 或首个目标
  const effectiveGoalId =
    propGoalId || store.activeGoalId || (store.goals.length > 0 ? store.goals[0].id : null)

  const activeGoal = useMemo(
    () => (effectiveGoalId ? store.goals.find((g) => g.id === effectiveGoalId) ?? null : null),
    [store.goals, effectiveGoalId],
  )

  const convId = useMemo(() => {
    if (!effectiveGoalId) return null
    return (
      resolveDisplayedConversation(store, effectiveGoalId) ??
      ensureConversation(store, effectiveGoalId).conversationId ??
      null
    )
  }, [store, effectiveGoalId])

  const conv: Conversation | null = useMemo(
    () => (convId ? conversationById(store, convId) ?? null : null),
    [store, convId],
  )

  const conversations = useMemo(
    () => (effectiveGoalId ? store.conversations.filter((c) => c.goalId === effectiveGoalId) : []),
    [store.conversations, effectiveGoalId],
  )

  const target = useMemo(() => {
    if (!effectiveGoalId || !convId) return null
    return {
      goalId: effectiveGoalId,
      nodeId: activeGoal?.rootNodeId || null,
      conversationId: convId,
    }
  }, [effectiveGoalId, convId, activeGoal])

  const stream = convId ? agent.streams[convId] : undefined
  const running = Boolean(convId && agent.runningByConversation[convId])
  const queue = queueOf(agent.queues, convId)

  const handleSend = useCallback(
    (text: string, images: PendingImage[], files: PendingFile[]) => {
      if (!target) return 'sent' as const
      const isWaiting =
        convId && (agent.runningByConversation[convId] || queueOf(agent.queues, convId).length > 0)
      if (isWaiting) {
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
          ? {
              images: images.length ? images : undefined,
              files: files.length ? files : undefined,
            }
          : {}),
      })
      return 'sent' as const
    },
    [target, convId, agent],
  )

  const handleNewConversation = useCallback(() => {
    if (!effectiveGoalId) return
    const s = getLatest()
    const { store: withConv, conversation } = addConversation(s, effectiveGoalId)
    set({
      ...withConv,
      activeGoalId: effectiveGoalId,
      activeConversationId: conversation.id,
    })
  }, [effectiveGoalId, getLatest, set])

  const handleSelectConversation = useCallback(
    (id: string) => {
      set({ ...getLatest(), activeConversationId: id })
    },
    [getLatest, set],
  )

  const handleDeleteConversation = useCallback(
    (id: string) => {
      const next = deleteConversation(getLatest(), id)
      set(next)
    },
    [getLatest, set],
  )

  const handleEditMessage = useCallback(
    (messageId: string, text: string) => {
      if (!convId) return
      resetPrefixGate(convId)
      set(updateMessageText(getLatest(), convId, messageId, text))
    },
    [convId, getLatest, set],
  )

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      if (!convId) return
      resetPrefixGate(convId)
      set(deleteMessage(getLatest(), convId, messageId))
    },
    [convId, getLatest, set],
  )

  if (!effectiveGoalId || !activeGoal) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8 text-center bg-card/30">
        <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center mb-4 border border-indigo-500/20">
          <FolderPlus size={26} />
        </div>
        <h3 className="text-[15px] font-bold text-ink-strong mb-1.5">{t('暂未选择学习目标')}</h3>
        <p className="max-w-sm text-[12px] text-ink-faint leading-relaxed mb-4">
          {t('超级导师需要依托具体的学习目标为你提供讲义撰写、概念答疑与任务调度服务。请在知识大纲或左侧列表中选择一个目标。')}
        </p>
      </div>
    )
  }

  const bucket = conv?.subagents
  const sessions = bucket?.sessions ?? []

  return (
    <div className="h-full w-full flex flex-col min-h-0 min-w-0 bg-card/20">
      <AgentPanel
        conversation={conv}
        conversations={conversations}
        streaming={stream?.parts ?? null}
        streamingMessageId={stream?.messageId ?? null}
        running={running}
        hasKey={hasKey}
        providerLabel={providerLabel}
        onModelChanged={() => setSettingsEpoch((n) => n + 1)}
        vision={vision}
        onSend={handleSend}
        queue={queue}
        onQueueDrop={(id) => {
          if (convId) agent.dropQueuedMessage(convId, id)
        }}
        onQueueSendNow={(id) => {
          if (convId) agent.sendQueuedNow(convId, id)
        }}
        onSuperLab={() => {
          onToast?.(t('可直接在输入框中向超级导师下发任务指令'))
        }}
        onCompact={() => {
          if (convId) void agent.compactNow(convId)
        }}
        compacting={Boolean(convId && agent.compactingConvId === convId)}
        onOpenAgentSettings={() => openTab?.({ kind: 'agentSettings' })}
        onExam={() => {
          onToast?.(t('可输入「/exam」或直接向导师申请随堂测验'))
        }}
        effort={effort}
        onSetEffort={setGlobalEffort}
        compactThreshold={currentAgentSettings.compact?.threshold ?? 0.8}
        persona={currentAgentSettings.persona}
        onPickPersona={(id) => {
          saveAgentSettings({ ...currentAgentSettings, persona: id })
          onToast?.(t('导师人格已切到「{0}」，从下一轮开始生效', personaOf(id).label))
        }}
        docFormat={currentAgentSettings.docFormat}
        onPickDocFormat={(id) => {
          saveAgentSettings({ ...currentAgentSettings, docFormat: id })
          onToast?.(t('文档格式已切到「{0}」，从下一轮开始生效', docFormatOf(id).label))
        }}
        onNotice={(msg) => onToast?.(msg)}
        onStop={() => agent.stop(convId ?? undefined)}
        onNewConversation={handleNewConversation}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        onEditMessage={handleEditMessage}
        onDeleteMessage={handleDeleteMessage}
        onResumeInterrupted={() => {
          if (target) agent.resumeInterrupted(target)
        }}
        ask={convId ? agent.pendingAskByConv[convId] ?? null : null}
        onAskSubmit={(answers: AskAnswers) => {
          if (convId) agent.submitAsk(answers, convId)
        }}
        onAskCancel={() => {
          if (convId) agent.cancelAsk(convId)
        }}
        tps={convId ? agent.tpsByConv[convId] ?? null : null}
        liveUsage={convId ? agent.liveUsageByConv[convId] ?? null : null}
        sub={{
          sessions,
          defs: bucket?.defs ?? [],
          running: agent.subRunsAll.some((r) => r.conversationId === convId),
          live: agent.subRunsAll
            .filter((r) => r.conversationId === convId)
            .map(({ sessionId: sid, runId, parts }) => ({ sessionId: sid, runId, parts })),
        }}
        active={true}
      />
    </div>
  )
}
