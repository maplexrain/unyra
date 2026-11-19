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
import { SuperAgentRail, type SuperRailView } from './SuperAgentRail'
import { SuperHostPane } from './SuperHostPane'
import { SuperWorkerPane } from './SuperWorkerPane'
import { SuperBlackboardPane } from './SuperBlackboardPane'
import { useSuperAgent } from '../../../learn/superAgent/useSuperAgent'
import type { LearnStore, TabRef, DocView } from '../../../learn/types'
import type { useAgent } from '../../../learn/useAgent'
import type { loadAgentSettings } from '../../../agent/settings'
import { resolveDisplayedConversation } from '../../../learn/graph'
import { t } from '../../../i18n'
import { Sparkles, Bot, Layers } from 'lucide-react'

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
  const effectiveGoalId =
    goalId ||
    activeGoalId ||
    store?.activeGoalId ||
    (store?.goals && store.goals.length > 0 ? store.goals[0].id : 'global-scope')

  const activeGoal = useMemo(() => {
    if (goals) return goals.find((g) => g.id === effectiveGoalId)
    if (store?.goals) return store.goals.find((g) => g.id === effectiveGoalId)
    return null
  }, [goals, store?.goals, effectiveGoalId])

  const goalTitle = activeGoal?.title

  // 工作台模式：'super'（三平面架构工作台，默认）与 'classic'（经典导师备用对比）
  const [workbenchMode, setWorkbenchMode] = useState<'super' | 'classic'>('super')

  // 三平面导航视图
  const [railView, setRailView] = useState<SuperRailView>({ kind: 'host' })

  // 挂载三平面 SuperAgent Hook
  const superAgent = useSuperAgent({
    scopeId: effectiveGoalId,
    goalTitle,
    store,
    getLatest,
    set,
    nodeId: null,
    onToast,
  })

  // 活跃 Worker 列表
  const activeWorkers = useMemo(
    () => superAgent.workers.filter((w) => w.status === 'running'),
    [superAgent.workers],
  )

  // 选中的 Worker
  const selectedWorker = useMemo(() => {
    if (railView.kind !== 'worker') return null
    return superAgent.workers.find((w) => w.id === railView.workerId) || null
  }, [railView, superAgent.workers])

  // --- 经典导师模式下的兼容状态 ---
  const [agents, setAgents] = useState<TeamAgent[]>(() => loadTeamAgents(goalId))
  const [messages, setMessages] = useState<TeamMessage[]>(() => loadTeamMessages(goalId))
  const [selected, setSelected] = useState<TeamChatSelection>('agent-tutor')
  const [isSimulating, setIsSimulating] = useState(false)

  useEffect(() => {
    setAgents(loadTeamAgents(goalId))
    setMessages(loadTeamMessages(goalId))
    setSelected('agent-tutor')
  }, [goalId])

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

  const convId = useMemo(() => {
    if (!store || !effectiveGoalId) return null
    return resolveDisplayedConversation(store, effectiveGoalId)
  }, [store, effectiveGoalId])

  const isTutorRunning = Boolean(convId && agent?.runningByConversation[convId])

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-paper select-text">
      {/* 顶部极其低调的模式切换控制条 */}
      <div className="px-4 py-1.5 border-b border-line/40 bg-card/40 flex items-center justify-between text-[11.5px] shrink-0">
        <div className="flex items-center gap-1.5 text-ink-faint">
          <Layers size={13} className="text-seal" />
          <span className="font-semibold text-ink-strong">{t('智能体团队')}</span>
          <span>·</span>
          <span>{goalTitle || t('全局空间')}</span>
        </div>

        {/* 模式切换胶囊 */}
        <div className="flex items-center bg-line/50 p-0.5 rounded-lg">
          <button
            type="button"
            onClick={() => setWorkbenchMode('super')}
            className={`px-2.5 py-0.8 rounded-md font-medium transition cursor-pointer ${
              workbenchMode === 'super'
                ? 'bg-paper text-seal font-semibold shadow-2xs'
                : 'text-ink-faint hover:text-ink'
            }`}
          >
            {t('三平面工作台 (推荐)')}
          </button>
          <button
            type="button"
            onClick={() => setWorkbenchMode('classic')}
            className={`px-2.5 py-0.8 rounded-md font-medium transition cursor-pointer ${
              workbenchMode === 'classic'
                ? 'bg-paper text-seal font-semibold shadow-2xs'
                : 'text-ink-faint hover:text-ink'
            }`}
          >
            {t('经典导师')}
          </button>
        </div>
      </div>

      {/* 主体视口 */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {workbenchMode === 'super' ? (
          /* ===== 三平面工作台 (SuperAgent Workbench) ===== */
          <>
            {/* 左侧导航轨 */}
            <div className="w-72 md:w-80 shrink-0 h-full border-r border-line/60">
              <SuperAgentRail
                currentView={railView}
                onSelectView={setRailView}
                hostRunning={superAgent.hostRunning}
                mailboxCount={superAgent.mailboxCount}
                workers={superAgent.workers}
                blackboardCount={superAgent.blackboard.length}
                onCancelWorker={superAgent.cancelWorker}
                goalTitle={goalTitle}
              />
            </div>

            {/* 右侧工作台主视口 */}
            <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
              {railView.kind === 'host' && (
                <SuperHostPane
                  messages={superAgent.state?.hostMessages || []}
                  streaming={superAgent.hostStreaming}
                  isRunning={superAgent.hostRunning}
                  mailboxCount={superAgent.mailboxCount}
                  activeWorkers={activeWorkers}
                  onSendMessage={superAgent.sendToHost}
                  onStopHost={superAgent.stopAll}
                  onReset={superAgent.resetSuperAgent}
                  onSelectWorker={(wId) => setRailView({ kind: 'worker', workerId: wId })}
                  goalTitle={goalTitle}
                />
              )}

              {railView.kind === 'worker' && selectedWorker && (
                <SuperWorkerPane
                  worker={selectedWorker}
                  streamSlot={superAgent.workerStreams[selectedWorker.id]}
                  onBackToHost={() => setRailView({ kind: 'host' })}
                  onSendToWorker={superAgent.sendToWorker}
                  onCancelWorker={superAgent.cancelWorker}
                />
              )}

              {railView.kind === 'worker' && !selectedWorker && (
                <div className="h-full flex flex-col items-center justify-center p-8 text-center text-ink-faint">
                  <p className="text-[13px] mb-3">{t('该工单不存在或已被移除')}</p>
                  <button
                    type="button"
                    onClick={() => setRailView({ kind: 'host' })}
                    className="px-4 py-1.5 rounded-xl bg-seal text-white text-[12px] font-semibold cursor-pointer"
                  >
                    {t('返回前台主控')}
                  </button>
                </div>
              )}

              {railView.kind === 'blackboard' && (
                <SuperBlackboardPane
                  blackboard={superAgent.blackboard}
                  onSelectWorker={(wId) => setRailView({ kind: 'worker', workerId: wId })}
                  onBackToHost={() => setRailView({ kind: 'host' })}
                />
              )}
            </div>
          </>
        ) : (
          /* ===== 经典导师模式 (Classic Mode) ===== */
          <>
            <div className="w-80 md:w-88 xl:w-96 shrink-0 h-full border-r border-line/70">
              <AgentTeamRoster
                agents={agents}
                selected={selected}
                onSelect={setSelected}
                onAddAgent={(newAgent) => handleUpdateAgents([...agents, newAgent])}
                onDeleteAgent={(id) => {
                  const updated = agents.filter((a) => a.id !== id)
                  handleUpdateAgents(updated)
                  if (selected === id) setSelected('agent-tutor')
                }}
                goalTitle={goalTitle}
                isTutorRunning={isTutorRunning}
              />
            </div>

            <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
              {selected === 'group' ? (
                <div className="flex h-full w-full flex-col items-center justify-center p-8 text-center bg-card/20">
                  <div className="w-16 h-16 rounded-3xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center mb-4 border border-indigo-500/20 shadow-xs">
                    <Sparkles size={28} />
                  </div>
                  <h3 className="text-[17px] font-bold text-ink-strong mb-2">
                    {t('协作频道暂无消息')}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setSelected('agent-tutor')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-seal text-white font-semibold text-[13px] hover:bg-seal-deep transition-all shadow-sm cursor-pointer"
                  >
                    <Bot size={15} />
                    <span>{t('向超级导师派发任务')}</span>
                  </button>
                </div>
              ) : store && agent && getLatest && set ? (
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
                <AgentTeamChat
                  selected={selected}
                  agents={agents}
                  messages={messages}
                  onSendMessage={(content, mentions) => {
                    const next: TeamMessage = {
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
                    handleUpdateMessages([...messages, next])
                  }}
                  onSimulateWorkflow={() => {
                    setIsSimulating(true)
                    handleUpdateMessages(PRESET_SIMULATION_MESSAGES)
                    setIsSimulating(false)
                  }}
                  isSimulating={isSimulating}
                  onClearMessages={() => handleUpdateMessages([])}
                  onBackToGroup={() => setSelected('group')}
                  goalTitle={goalTitle}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
