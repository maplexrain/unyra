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
import { userAbsPath } from '../../../lib/storage'
import { wsChipUserRel } from '../../../learn/chipRef'
import { wsRefOfRel } from '../../../learn/workspace'
import { goalFocusByGoal } from '../workspace/goalFocus'
import { t } from '../../../i18n'
import { ArrowLeft, Bot, Brain, FolderPlus, Plus, Settings } from 'lucide-react'

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
  activeSubSessionId?: string | null
  onExitSubSession?: () => void
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
  activeSubSessionId,
  onExitSubSession,
}: AgentTeamTutorPaneProps) {
  const [settingsEpoch, setSettingsEpoch] = useState(0)
  const [viewSubId, setViewSubId] = useState<string | null>(activeSubSessionId ?? null)

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

  const activeNodeId = useMemo(() => {
    if (!effectiveGoalId) return null
    return (
      goalFocusByGoal.get(effectiveGoalId) ??
      (store.goals.find((g) => g.id === effectiveGoalId)?.rootNodeId ||
        store.nodes.find((n) => n.goalId === effectiveGoalId)?.id ||
        null)
    )
  }, [effectiveGoalId, store.goals, store.nodes])

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
      nodeId: activeNodeId,
      conversationId: convId,
    }
  }, [effectiveGoalId, convId, activeNodeId])

  const stream = convId ? agent.streams[convId] : undefined
  const running = Boolean(convId && agent.runningByConversation[convId])
  const queue = queueOf(agent.queues, convId)

  // 1. 发送消息
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

  // 2. 新建对话
  const handleNewConversation = useCallback(() => {
    if (!effectiveGoalId) return
    const s = getLatest()
    const { store: withConv, conversation } = addConversation(s, effectiveGoalId)
    set({
      ...withConv,
      activeGoalId: effectiveGoalId,
      activeConversationId: conversation.id,
    })
    setViewSubId(null)
    onToast?.(t('已为当前目标新建一段对话'))
  }, [effectiveGoalId, getLatest, set, onToast])

  // 3. 切换对话
  const handleSelectConversation = useCallback(
    (id: string) => {
      set({ ...getLatest(), activeConversationId: id })
      setViewSubId(null)
    },
    [getLatest, set],
  )

  // 4. 删除对话
  const handleDeleteConversation = useCallback(
    (id: string) => {
      if (id && agent.runningByConversation[id]) {
        onToast?.(t('这一段对话正在运行，请先停止再删除'))
        return
      }
      resetPrefixGate(id)
      const s = getLatest()
      const next = deleteConversation(s, id)
      const remaining = next.conversations.filter((c) => c.goalId === effectiveGoalId)
      if (next.activeConversationId === id) {
        if (remaining.length > 0) {
          next.activeConversationId = remaining[0].id
        } else if (effectiveGoalId) {
          const { store: withNew, conversation } = addConversation(next, effectiveGoalId)
          next.activeConversationId = conversation.id
          set(withNew)
          return
        }
      }
      set(next)
      setViewSubId(null)
      onToast?.(t('已删除对话'))
    },
    [agent.runningByConversation, effectiveGoalId, getLatest, set, onToast],
  )

  // 5. 消息改写与删除
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

  // 6. 工作流：超级实验室与随堂出题
  const handleSuperLab = useCallback(() => {
    if (!activeNodeId) {
      onToast?.(t('超级实验室需要选定一个知识点，请先选择一个节点'))
      return
    }
    agent.runWorkflow('superlab', { nodeId: activeNodeId })
  }, [activeNodeId, agent, onToast])

  const handleExam = useCallback(() => {
    if (!activeNodeId) {
      onToast?.(t('出题需要选定一个知识点，请先选择一个节点'))
      return
    }
    agent.runWorkflow('exam', { nodeId: activeNodeId, params: { target: activeNodeId } })
  }, [activeNodeId, agent, onToast])

  // 7. 文件打开桥：点击聊天中的文件或附件时在工作区页签打开
  const handleOpenFile = useCallback(
    (pathOrRel: string, title?: string) => {
      const norm = pathOrRel.replace(/\\/g, '/')
      const isAbs = /^[a-zA-Z]:[/\\]|^[/\\]{2}|^\//.test(norm)
      if (!isAbs) {
        const targetGoalId = effectiveGoalId ?? undefined
        const wsRel = wsChipUserRel(getLatest(), norm, targetGoalId)
        const wsRef = wsRel ? wsRefOfRel(getLatest(), wsRel) : null
        if (wsRef) {
          openTab?.(wsRef)
          return
        }
      }
      const abs = isAbs ? norm : (userAbsPath(norm) ?? norm)
      openTab?.({ kind: 'local', path: abs, ...(title ? { title } : {}) })
    },
    [effectiveGoalId, getLatest, openTab],
  )

  // 8. 子代理会话处理
  const handleOpenSub = useCallback((sid: string) => {
    setViewSubId(sid)
  }, [])

  const handleExitSub = useCallback(() => {
    setViewSubId(null)
    onExitSubSession?.()
  }, [onExitSubSession])

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
  const currentSubSession = viewSubId ? sessions.find((s) => s.id === viewSubId) : null
  const currentSubDef = currentSubSession
    ? (bucket?.defs ?? []).find((d) => d.key === currentSubSession.defKey)
    : null

  return (
    <div className="h-full w-full flex flex-col min-h-0 min-w-0 bg-card/20 select-text">
      {/* 顶部工具条：导师身份、目标、会话切换、记忆与设置 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-line/60 bg-card/60 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-sm shadow-xs shrink-0 select-none">
              🧠
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold text-ink-strong truncate">
                  {t('超级导师')}
                </span>
                {running ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9.5px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    <span>{t('执行中')}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9.5px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>{t('在线')}</span>
                  </span>
                )}
                <span className="text-[10px] text-ink-faint truncate max-w-[120px]">
                  {providerLabel}
                </span>
              </div>
              <div className="text-[10.5px] text-ink-faint truncate">
                {t('当前目标')}：<span className="text-ink-soft font-medium">{activeGoal.title}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧动作群：会话切换、新建、记忆管理、设置 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {conversations.length > 1 && (
            <select
              value={convId ?? ''}
              onChange={(e) => handleSelectConversation(e.target.value)}
              className="px-2 py-1 rounded-lg bg-paper-deep border border-line text-[11px] text-ink focus:outline-none focus:border-seal max-w-[130px] truncate"
              title={t('切换会话历史')}
            >
              {conversations.map((c, i) => (
                <option key={c.id} value={c.id}>
                  {c.title || t('对话 {0}', i + 1)}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={handleNewConversation}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-line/50 hover:bg-line text-ink text-[11px] font-medium transition cursor-pointer"
            title={t('为当前目标新建一段会话')}
          >
            <Plus size={12} />
            <span>{t('新建对话')}</span>
          </button>

          <button
            type="button"
            onClick={() => openTab?.({ kind: 'mind', goalId: effectiveGoalId })}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-line/50 hover:bg-line text-ink text-[11px] font-medium transition cursor-pointer"
            title={t('打开当前目标的记忆管理')}
          >
            <Brain size={12} />
            <span>{t('记忆')}</span>
          </button>

          <button
            type="button"
            onClick={() => openTab?.({ kind: 'agentSettings' })}
            className="p-1.5 rounded-lg text-ink-soft hover:text-ink hover:bg-line/50 transition cursor-pointer"
            title={t('超级导师设置')}
          >
            <Settings size={13} />
          </button>
        </div>
      </div>

      {/* 子代理会话横条（查看某个子代理会话时显现） */}
      {viewSubId && (
        <div className="flex items-center justify-between px-4 py-1.5 bg-violet-500/10 border-b border-violet-500/20 text-violet-700 dark:text-violet-300 text-[11.5px] shrink-0">
          <div className="flex items-center gap-1.5">
            <Bot size={13} className="text-violet-600 dark:text-violet-400" />
            <span className="font-semibold">
              {t('子代理会话')}：{currentSubDef?.name ?? currentSubSession?.defKey ?? viewSubId}
            </span>
          </div>
          <button
            type="button"
            onClick={handleExitSub}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-card/80 hover:bg-card border border-line text-[11px] font-medium text-ink transition cursor-pointer"
          >
            <ArrowLeft size={11} />
            <span>{t('返回主对话')}</span>
          </button>
        </div>
      )}

      {/* 主聊天面板（承载消息、流式、思考链、工具执行、输入框等完整功能） */}
      <div className="flex-1 min-h-0 relative">
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
          onSuperLab={handleSuperLab}
          onExam={handleExam}
          onCompact={() => {
            if (convId) void agent.compactNow(convId)
          }}
          compacting={Boolean(convId && agent.compactingConvId === convId)}
          onOpenAgentSettings={() => openTab?.({ kind: 'agentSettings' })}
          onOpenSettings={() => openTab?.({ kind: 'agentSettings' })}
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
          viewSubId={viewSubId}
          onOpenSub={handleOpenSub}
          onOpenFile={handleOpenFile}
          active={true}
        />
      </div>
    </div>
  )
}
