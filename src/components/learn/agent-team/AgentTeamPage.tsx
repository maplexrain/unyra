import { useState, useEffect, useCallback, useMemo } from 'react'
import type { TeamAgent, TeamChatSelection, TeamMessage } from './types'
import {
  loadTeamAgents,
  saveTeamAgents,
  loadTeamMessages,
  saveTeamMessages,
  PRESET_SIMULATION_MESSAGES,
} from './agentTeamData'
import { AgentTeamRoster } from './AgentTeamRoster'
import { AgentTeamChat } from './AgentTeamChat'
import { AgentTeamTutorPane } from './AgentTeamTutorPane'
import type { LearnStore, TabRef, DocView } from '../../../learn/types'
import type { useAgent } from '../../../learn/useAgent'
import type { loadAgentSettings } from '../../../agent/settings'
import { resolveDisplayedConversation } from '../../../learn/graph'
import { t } from '../../../i18n'
import { Sparkles, Bot } from 'lucide-react'

type AgentApi = ReturnType<typeof useAgent>
type AgentSettings = ReturnType<typeof loadAgentSettings>

export interface AgentTeamPageProps {
  goalId?: string
  goals?: Array<{ id: string; title?: string }>
  activeGoalId?: string | null
  store?: LearnStore
  getLatest?: () => LearnStore
  set?: (s: LearnStore) => void
  agent?: AgentApi
  agentSettings?: AgentSettings
  hasKey?: boolean
  openTab?: (ref: TabRef, preferredView?: DocView) => void
  onToast?: (msg: string) => void
}

export default function AgentTeamPage({
  goalId,
  goals,
  activeGoalId,
  store,
  getLatest,
  set,
  agent,
  agentSettings,
  hasKey,
  openTab,
  onToast,
}: AgentTeamPageProps) {
  const effectiveGoalId = goalId || activeGoalId || undefined
  const activeGoal = useMemo(() => {
    if (goals) return goals.find((g) => g.id === effectiveGoalId)
    if (store?.goals) return store.goals.find((g) => g.id === effectiveGoalId)
    return null
  }, [goals, store?.goals, effectiveGoalId])

  const goalTitle = activeGoal?.title

  const [agents, setAgents] = useState<TeamAgent[]>(() => loadTeamAgents(goalId))
  const [messages, setMessages] = useState<TeamMessage[]>(() => loadTeamMessages(goalId))
  // 默认选中超级导师，方便立即向超级导师派发任务
  const [selected, setSelected] = useState<TeamChatSelection>('agent-tutor')
  const [isSimulating, setIsSimulating] = useState(false)

  // 当 goalId 变化时重新加载数据
  useEffect(() => {
    setAgents(loadTeamAgents(goalId))
    setMessages(loadTeamMessages(goalId))
    setSelected('agent-tutor')
  }, [goalId])

  // 持久化保存
  const handleUpdateAgents = useCallback(
    (newAgents: TeamAgent[]) => {
      setAgents(newAgents)
      saveTeamAgents(newAgents, goalId)
    },
    [goalId],
  )

  const handleUpdateMessages = useCallback(
    (newMessages: TeamMessage[]) => {
      setMessages(newMessages)
      saveTeamMessages(newMessages, goalId)
    },
    [goalId],
  )

  const handleAddAgent = (newAgent: TeamAgent) => {
    const updated = [...agents, newAgent]
    handleUpdateAgents(updated)
  }

  const handleDeleteAgent = (agentId: string) => {
    const updated = agents.filter((a) => a.id !== agentId)
    handleUpdateAgents(updated)
    if (selected === agentId) {
      setSelected('agent-tutor')
    }
  }

  // 计算超级导师当前是否在运行中
  const convId = useMemo(() => {
    if (!store || !effectiveGoalId) return null
    return resolveDisplayedConversation(store, effectiveGoalId)
  }, [store, effectiveGoalId])

  const isTutorRunning = Boolean(convId && agent?.runningByConversation[convId])

  // 发送模拟消息（供独立聊天组件使用）
  const handleSendMessage = (content: string, mentions?: string[]) => {
    const userMsg: TeamMessage = {
      id: `msg-${Date.now()}`,
      senderId: 'user',
      senderName: '学习者 (You)',
      avatar: '👤',
      content,
      timestamp: Date.now(),
      mentions,
      isGroupChat: selected === 'group',
      targetAgentId: selected === 'group' ? undefined : selected,
    }

    const nextMessages = [...messages, userMsg]
    handleUpdateMessages(nextMessages)
  }

  const handleSimulateWorkflow = () => {
    if (isSimulating) return
    setIsSimulating(true)
    handleUpdateMessages(PRESET_SIMULATION_MESSAGES)
    setIsSimulating(false)
  }

  const handleClearMessages = () => {
    handleUpdateMessages([])
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-paper select-text">
      {/* 左侧：各个agent的列表（含置顶群聊） */}
      <div className="w-80 md:w-88 xl:w-96 shrink-0 h-full border-r border-line/70">
        <AgentTeamRoster
          agents={agents}
          selected={selected}
          onSelect={setSelected}
          onAddAgent={handleAddAgent}
          onDeleteAgent={handleDeleteAgent}
          goalTitle={goalTitle}
          isTutorRunning={isTutorRunning}
        />
      </div>

      {/* 右侧：聊天框 (群聊 / 超级导师任务派发) */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
        {selected === 'group' ? (
          /* 协作频道：当前空着待命 */
          <div className="flex h-full w-full flex-col items-center justify-center p-8 text-center bg-card/20">
            <div className="w-16 h-16 rounded-3xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center mb-4 border border-indigo-500/20 shadow-xs">
              <Sparkles size={28} />
            </div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-line/60 text-ink-faint text-[11px] font-semibold mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-ink-faint/50" />
              <span>{t('协作频道 · 待命中')}</span>
            </div>
            <h3 className="text-[17px] font-bold text-ink-strong mb-2">{t('协作频道暂无消息')}</h3>
            <p className="max-w-md text-[12.5px] text-ink-soft leading-relaxed mb-6">
              {t(
                '多智能体协同网络已接入。当超级导师触发多智能体协作、或开启复杂任务流水线时，各智能体之间的工单分发、协同检索与成果校验将在此频道实时广播。',
              )}
            </p>
            <button
              type="button"
              onClick={() => setSelected('agent-tutor')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-seal text-white font-semibold text-[13px] hover:bg-seal-deep transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              <Bot size={15} />
              <span>{t('向超级导师派发任务')}</span>
            </button>
          </div>
        ) : store && agent && getLatest && set ? (
          /* 超级导师真实任务派发区（与全局 Agent 栏一致能力） */
          <AgentTeamTutorPane
            goalId={effectiveGoalId}
            store={store}
            getLatest={getLatest}
            set={set}
            agent={agent}
            agentSettings={agentSettings}
            hasKey={hasKey}
            openTab={openTab}
            onToast={onToast}
          />
        ) : (
          /* 预览模式备用组件 */
          <AgentTeamChat
            selected={selected}
            agents={agents}
            messages={messages}
            onSendMessage={handleSendMessage}
            onSimulateWorkflow={handleSimulateWorkflow}
            isSimulating={isSimulating}
            onClearMessages={handleClearMessages}
            onBackToGroup={() => setSelected('group')}
            goalTitle={goalTitle}
          />
        )}
      </div>
    </div>
  )
}
