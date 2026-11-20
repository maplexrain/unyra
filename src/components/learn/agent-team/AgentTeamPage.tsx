/**
 * 智能体团队总页面 (AgentTeamPage)
 *
 * 架构：
 * 「左花名册 · 右主视口 (一级流 / 二级交付正文)」纯粹双栏架构：
 * 1. 左侧栏 (TeamRosterRail, 208px)：置顶协作频道 + 5 席专家极简花名册（严格无 Worker 污染）；
 * 2. 右侧主视口 (flex-1)：
 *    - 一级页面：协作频道 (TeamChannelPane) 或 专家专属对话流 (TeamAgentWorkspace)；
 *    - 二级页面 (DeliverableSubpage)：点击工单正文或共享黑板平滑推入，全幅居中 800px 消息流排布，带「← 返回」导航；
 * 3. 经典单导师模式作为兜底对比备用入口。
 */

import { useState, useMemo } from 'react'
import { TeamRosterRail, type TeamSelection } from './TeamRosterRail'
import { TeamChannelPane } from './TeamChannelPane'
import { TeamAgentWorkspace } from './TeamAgentWorkspace'
import { DeliverableSubpage, type SubpageMode } from './DeliverableSubpage'
import { TaskRawDataViewer } from './TaskRawDataViewer'
import { AgentTeamTutorPane } from './AgentTeamTutorPane'
import { useAgentTeam } from '../../../learn/superAgent/useAgentTeam'
import type { LearnStore, TabRef, DocView } from '../../../learn/types'
import type { useAgent } from '../../../learn/useAgent'
import type { loadAgentSettings } from '../../../agent/settings'
import { goalFocusByGoal } from '../workspace/goalFocus'
import { t } from '../../../i18n'
import { AlertCircle, Layers, X, FileJson } from 'lucide-react'

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

  // 聊天区二级页面目标（工单交付正文或共享黑板，平滑在主聊天视口展示）
  const [activeSubpage, setActiveSubpage] = useState<{
    agentId: string
    mode: SubpageMode
  } | null>(null)

  // 任务派发裸数据检视弹层开关
  const [showRawViewer, setShowRawViewer] = useState(false)

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

  // 二级页面所指向的 Agent 快照
  const subpageAgentSnapshot = useMemo(() => {
    if (!activeSubpage) return null
    return team.agents[activeSubpage.agentId] || null
  }, [activeSubpage, team.agents])

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

        <div className="flex items-center gap-2">
          {workbenchMode === 'team' && (
            <button
              type="button"
              onClick={() => setShowRawViewer(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-ink-subtle hover:text-seal bg-card border border-line hover:border-line-strong transition cursor-pointer shadow-2xs"
              title={t('透明化检视所有跨专家委派、隔离工坊工单与 Mailbox 回执')}
            >
              <FileJson size={12} className="text-seal" />
              <span>{t('任务派发裸数据')}</span>
            </button>
          )}

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
              {t('多智能体团队 (三栏工作台)')}
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
      </div>

      {/* 异常警示条 */}
      {team.error && (
        <div className="px-3.5 py-1.5 bg-rose-500/10 border-b border-rose-500/20 text-rose-600 dark:text-rose-400 text-[11px] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 truncate">
            <AlertCircle size={12} className="shrink-0" />
            <span className="truncate">{team.error}</span>
          </div>
          <button
            type="button"
            onClick={team.clearError}
            className="p-0.5 rounded text-rose-500 hover:text-rose-700 cursor-pointer"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* 主体视口 */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {workbenchMode === 'team' ? (
          /* ===== 「左花名册 · 右聊天主视口 (一级流/二级交付正文)」 ===== */
          <>
            {/* 1. 左侧栏：Agent 花名册 + 协作频道 (紧凑 208px，严格无 Worker) */}
            <div className="w-52 shrink-0 h-full">
              <TeamRosterRail
                profiles={team.profiles}
                agents={team.agents}
                delegations={team.delegations}
                selected={selection}
                onSelect={(sel) => {
                  setSelection(sel)
                  setActiveSubpage(null) // 切换花名册时重置二级页面，返回新目标的一级视口
                }}
                goalTitle={goalTitle}
              />
            </div>

            {/* 2. 中间主视口：支持一级对话流与二级正文页平滑切换 */}
            <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
              {activeSubpage && subpageAgentSnapshot ? (
                /* 二级页面：工单交付正文或共享黑板 */
                <DeliverableSubpage
                  mode={activeSubpage.mode}
                  agentName={subpageAgentSnapshot.profile.name}
                  workers={subpageAgentSnapshot.workers}
                  workerStreams={subpageAgentSnapshot.workerStreams}
                  blackboard={subpageAgentSnapshot.blackboard}
                  backLabel={
                    selection.kind === 'channel'
                      ? t('返回协作频道')
                      : t('返回「{0}」', currentAgentSnapshot?.profile.name || subpageAgentSnapshot.profile.name)
                  }
                  onSelectWorker={(wid) =>
                    setActiveSubpage((prev) =>
                      prev ? { ...prev, mode: { kind: 'worker', workerId: wid } } : null,
                    )
                  }
                  onCancelWorker={(wid) =>
                    team.cancelWorker(activeSubpage.agentId, wid)
                  }
                  onBack={() => setActiveSubpage(null)}
                />
              ) : selection.kind === 'channel' ? (
                /* 一级页面：协作频道视口 */
                <TeamChannelPane
                  messages={team.channelMessages}
                  delegations={team.delegations}
                  profiles={team.profiles}
                  onSendMessage={team.sendChannelMessage}
                  onSelectAgent={(agentId) => {
                    setSelection({ kind: 'agent', agentId })
                    setActiveSubpage(null)
                  }}
                  onViewWorker={(agentId, workerId) =>
                    setActiveSubpage({ agentId, mode: { kind: 'worker', workerId } })
                  }
                  onResetChannel={team.resetChannel}
                  onStopAll={team.stopAll}
                />
              ) : currentAgentSnapshot ? (
                /* 一级页面：专业 Agent 独立工作区 */
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
                  onSelectAgent={(agentId) => {
                    setSelection({ kind: 'agent', agentId })
                    setActiveSubpage(null)
                  }}
                  onOpenWorkerDrawer={(wid) =>
                    setActiveSubpage({
                      agentId: currentAgentSnapshot.profile.id,
                      mode: { kind: 'worker', workerId: wid },
                    })
                  }
                  onOpenBlackboardDrawer={() =>
                    setActiveSubpage({
                      agentId: currentAgentSnapshot.profile.id,
                      mode: { kind: 'blackboard' },
                    })
                  }
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

      {/* 任务派发裸数据检视弹层 */}
      <TaskRawDataViewer
        isOpen={showRawViewer}
        onClose={() => setShowRawViewer(false)}
        delegations={team.delegations}
        agents={team.agents}
        channelMessages={team.channelMessages}
      />
    </div>
  )
}
