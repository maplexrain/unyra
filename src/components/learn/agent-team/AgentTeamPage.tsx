/**
 * 智能体团队总页面 (AgentTeamPage)
 *
 * 架构：
 * 1. 默认团队工作台 (TeamBus)：
 *    - 左侧栏 (TeamRosterRail)：置顶协作频道 + 5 席独立专家花名册（绝对无 Worker）；
 *    - 右侧主区：
 *      - 选中「协作频道」：全局协作广播、跨专家工单进度与 @指定专家输入；
 *      - 选中特定专家：进入该专家专属三平面工作台 (TeamAgentWorkspace)，内嵌 Worker 卡片与内部工单/黑板；
 * 2. 经典单导师模式备用保留（极简低调切换入口）。
 */

import { useState, useMemo } from 'react'
import { TeamRosterRail, type TeamSelection } from './TeamRosterRail'
import { TeamChannelPane } from './TeamChannelPane'
import { TeamAgentWorkspace } from './TeamAgentWorkspace'
import { AgentTeamTutorPane } from './AgentTeamTutorPane'
import { useAgentTeam } from '../../../learn/superAgent/useAgentTeam'
import type { LearnStore, TabRef, DocView } from '../../../learn/types'
import type { useAgent } from '../../../learn/useAgent'
import type { loadAgentSettings } from '../../../agent/settings'
import { goalFocusByGoal } from '../workspace/goalFocus'
import { t } from '../../../i18n'
import { Layers } from 'lucide-react'

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

  const effectiveNodeId = useMemo(() => {
    if (!effectiveGoalId || !store) return null
    return (
      goalFocusByGoal.get(effectiveGoalId) ??
      (store.goals.find((g) => g.id === effectiveGoalId)?.rootNodeId ||
        store.nodes.find((n) => n.goalId === effectiveGoalId)?.id ||
        null)
    )
  }, [effectiveGoalId, store])

  // 工作台模式：'team'（多 Agent 双层工作台，默认）与 'classic'（经典单导师兜底对比）
  const [workbenchMode, setWorkbenchMode] = useState<'team' | 'classic'>('team')

  // 左侧花名册当前选中项：默认选中协作频道
  const [selection, setSelection] = useState<TeamSelection>({ kind: 'channel' })

  // 挂载多 Agent 团队 Hook
  const team = useAgentTeam({
    scopeId: effectiveGoalId,
    goalTitle,
    store,
    getLatest,
    set,
    nodeId: effectiveNodeId,
    onToast,
  })

  // 当前选中的特定专家快照
  const currentAgentSnapshot = useMemo(() => {
    if (selection.kind !== 'agent') return null
    return team.agents[selection.agentId] || null
  }, [selection, team.agents])

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
            onClick={() => setWorkbenchMode('team')}
            className={`px-2.5 py-0.8 rounded-md font-medium transition cursor-pointer ${
              workbenchMode === 'team'
                ? 'bg-paper text-seal font-semibold shadow-2xs'
                : 'text-ink-faint hover:text-ink'
            }`}
          >
            {t('多智能体团队 (双层工作台)')}
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
            {t('经典单导师')}
          </button>
        </div>
      </div>

      {/* 主体视口 */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {workbenchMode === 'team' ? (
          /* ===== 多 Agent 双层工作台 ===== */
          <>
            {/* 左侧栏：Agent 花名册 + 协作频道 (严格无 Worker) */}
            <div className="w-64 md:w-72 shrink-0 h-full">
              <TeamRosterRail
                profiles={team.profiles}
                agents={team.agents}
                delegations={team.delegations}
                selected={selection}
                onSelect={setSelection}
                goalTitle={goalTitle}
              />
            </div>

            {/* 右侧主视口 */}
            <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
              {selection.kind === 'channel' ? (
                /* 协作频道视口 */
                <TeamChannelPane
                  messages={team.channelMessages}
                  delegations={team.delegations}
                  profiles={team.profiles}
                  onSendMessage={team.sendChannelMessage}
                  onSelectAgent={(agentId) => setSelection({ kind: 'agent', agentId })}
                  onResetChannel={team.resetChannel}
                  onStopAll={team.stopAll}
                />
              ) : currentAgentSnapshot ? (
                /* 专业 Agent 独立工作区 */
                <TeamAgentWorkspace
                  key={currentAgentSnapshot.profile.id}
                  profile={currentAgentSnapshot.profile}
                  agent={currentAgentSnapshot}
                  onSendMessage={(text) =>
                    team.sendDirectMessage(currentAgentSnapshot.profile.id, text)
                  }
                  onSendToWorker={(wid, text) =>
                    team.sendToWorker(currentAgentSnapshot.profile.id, wid, text)
                  }
                  onCancelWorker={(wid) =>
                    team.cancelWorker(currentAgentSnapshot.profile.id, wid)
                  }
                  onSelectAgent={(agentId) => setSelection({ kind: 'agent', agentId })}
                  onResetAgent={() => team.resetAgent(currentAgentSnapshot.profile.id)}
                  onStopAgent={() => team.stopAgent(currentAgentSnapshot.profile.id)}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-ink-faint text-[12px]">
                  {t('请在左侧选择需要协作的智能体')}
                </div>
              )}
            </div>
          </>
        ) : store && getLatest && set && agent ? (
          /* ===== 经典单导师模式（备用） ===== */
          <div className="flex-1 h-full overflow-hidden">
            <AgentTeamTutorPane
              store={store}
              getLatest={getLatest}
              set={set}
              agent={agent}
              goalId={effectiveGoalId}
              agentSettings={agentSettings}
              hasKey={hasKey}
              openTab={openTab}
              onToast={onToast}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-ink-faint text-[12px]">
            {t('暂无可用状态')}
          </div>
        )}
      </div>
    </div>
  )
}
