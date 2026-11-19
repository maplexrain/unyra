/**
 * 团队花名册侧栏 (TeamRosterRail)
 *
 * 铁律：
 * 1. 左侧栏专属于「协作频道」与 5 席「专业 Agent」，绝对禁止铺陈任何内部 Worker！
 * 2. 状态指示纯粹克制：展示各 Agent 的 Host 运行呼吸灯、后台在跑工单数、待消费回执数与等待输入标记。
 */

import { memo, useMemo } from 'react'
import {
  Sparkles,
  Users,
  ChevronRight,
  Brain,
  BookOpen,
  Clapperboard,
  FileCheck2,
  FlaskConical,
  Bot,
  Clock,
  Layers,
} from 'lucide-react'
import type { TeamAgentProfile, DelegationRecord } from '../../../agent/team/types'
import type { AgentViewSnapshot } from '../../../learn/superAgent/useAgentTeam'
import { t } from '../../../i18n'

export type TeamSelection =
  | { kind: 'channel' }
  | { kind: 'agent'; agentId: string }

export interface TeamRosterRailProps {
  profiles: TeamAgentProfile[]
  agents: Record<string, AgentViewSnapshot>
  delegations: Record<string, DelegationRecord>
  selected: TeamSelection
  onSelect: (sel: TeamSelection) => void
  goalTitle?: string
}

function RoleIcon({ id, className }: { id: string; className?: string }) {
  switch (id) {
    case 'agent-mentor':
      return <Brain className={className || 'size-4'} />
    case 'agent-author':
      return <BookOpen className={className || 'size-4'} />
    case 'agent-director':
      return <Clapperboard className={className || 'size-4'} />
    case 'agent-examiner':
      return <FileCheck2 className={className || 'size-4'} />
    case 'agent-lab':
      return <FlaskConical className={className || 'size-4'} />
    default:
      return <Bot className={className || 'size-4'} />
  }
}

export const TeamRosterRail = memo(function TeamRosterRail({
  profiles,
  agents,
  delegations,
  selected,
  onSelect,
  goalTitle,
}: TeamRosterRailProps) {
  // 活跃中的跨专家委派数
  const activeDelegationsCount = useMemo(() => {
    return Object.values(delegations).filter((d) => d.status === 'running').length
  }, [delegations])

  const isChannelSelected = selected.kind === 'channel'

  return (
    <div className="flex flex-col h-full w-full bg-card/65 backdrop-blur-md select-none border-r border-line/60">
      {/* 顶栏：团队标题 */}
      <div className="p-3.5 border-b border-line/60 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/15 text-indigo-500 flex items-center justify-center shrink-0 border border-indigo-500/20">
            <Users size={14} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[13px] font-bold text-ink-strong leading-tight truncate">
              {t('智能体团队')}
            </h2>
            <p className="text-[10.5px] text-ink-faint truncate max-w-[160px]">
              {goalTitle ? `${goalTitle}` : t('当前目标协作集群')}
            </p>
          </div>
        </div>
      </div>

      {/* 列表主体 */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-3">
        {/* 置顶项：全局协作频道 */}
        <div>
          <div className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider px-1.5 mb-1 flex items-center gap-1.5">
            <Sparkles size={11} className="text-indigo-400" />
            <span>{t('协作频道')}</span>
          </div>

          <div
            onClick={() => onSelect({ kind: 'channel' })}
            className={`group relative rounded-xl p-2.5 transition-all duration-150 cursor-pointer border ${
              isChannelSelected
                ? 'bg-indigo-500/15 border-indigo-500/40 shadow-xs ring-1 ring-indigo-500/20'
                : 'bg-card/70 hover:bg-card border-line/70 hover:border-indigo-500/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                  <Sparkles size={14} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12.5px] font-bold text-ink-strong truncate">
                      {t('协作频道')}
                    </span>
                    {activeDelegationsCount > 0 ? (
                      <span className="flex items-center gap-0.5 px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-amber-500 text-white animate-pulse">
                        <span className="w-1 h-1 rounded-full bg-white" />
                        {activeDelegationsCount}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-line/80 text-ink-faint border border-line">
                        {t('待命')}
                      </span>
                    )}
                  </div>
                  <span className="text-[10.5px] text-ink-faint truncate block">
                    {activeDelegationsCount > 0
                      ? t('{0} 项委派执行中...', activeDelegationsCount)
                      : t('多专家协同与全局广播')}
                  </span>
                </div>
              </div>
              <ChevronRight
                size={13}
                className={`transition-transform duration-150 shrink-0 ${
                  isChannelSelected ? 'text-indigo-500 translate-x-0.5' : 'text-ink-faint'
                }`}
              />
            </div>
          </div>
        </div>

        {/* 专家列表 */}
        <div>
          <div className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider px-1.5 mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Layers size={11} className="text-ink-faint" />
              <span>{t('专业智能体 ({0})', profiles.length)}</span>
            </span>
          </div>

          <div className="space-y-1">
            {profiles.map((profile) => {
              const isSelected = selected.kind === 'agent' && selected.agentId === profile.id
              const snap = agents[profile.id]
              const runningWorkers = snap?.runningWorkersCount ?? 0
              const waitingWorkers = snap?.waitingWorkersCount ?? 0
              const mailboxCount = snap?.mailboxCount ?? 0
              const isHostRunning = snap?.hostRunning ?? false

              return (
                <div
                  key={profile.id}
                  onClick={() => onSelect({ kind: 'agent', agentId: profile.id })}
                  className={`group relative rounded-xl p-2.5 transition-all duration-150 cursor-pointer border ${
                    isSelected
                      ? 'bg-paper-deep border-seal/50 shadow-xs ring-1 ring-seal/20'
                      : 'bg-card/40 hover:bg-card/90 border-transparent hover:border-line/70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* 图标与在跑呼吸灯 */}
                      <div className="relative shrink-0">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center border text-[13px] ${
                            isSelected
                              ? 'bg-seal/15 border-seal/30 text-seal'
                              : 'bg-paper-deep border-line text-ink-subtle group-hover:text-ink'
                          }`}
                        >
                          <RoleIcon id={profile.id} />
                        </div>
                        {isHostRunning && (
                          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-card animate-pulse" />
                        )}
                      </div>

                      {/* 姓名与角色 */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-[12px] font-semibold text-ink-strong truncate">
                            {profile.name}
                          </span>
                          {profile.isLeader && (
                            <span className="px-1 py-0.2 rounded text-[8.5px] font-bold bg-indigo-500/15 text-indigo-500 border border-indigo-500/20 shrink-0">
                              {t('主控')}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-ink-faint truncate block">
                          {profile.role}
                        </span>
                      </div>
                    </div>

                    {/* 状态徽标 */}
                    <div className="flex flex-col items-end gap-1 shrink-0 pt-0.5">
                      {waitingWorkers > 0 ? (
                        <span
                          className="flex items-center gap-0.5 px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/20"
                          title={t('有工单正在等待你的输入')}
                        >
                          <Clock size={9} />
                          <span>{waitingWorkers}</span>
                        </span>
                      ) : runningWorkers > 0 ? (
                        <span
                          className="flex items-center gap-0.5 px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                          title={t('后台在跑工单')}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                          <span>{runningWorkers}</span>
                        </span>
                      ) : mailboxCount > 0 ? (
                        <span
                          className="flex items-center gap-0.5 px-1.5 py-0.2 rounded-full text-[9px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                          title={t('待同步回执')}
                        >
                          <span>{mailboxCount} 回执</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
})
