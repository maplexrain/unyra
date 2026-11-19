/**
 * 极简团队花名册 (TeamRosterRail)
 *
 * 铁律：
 * 1. 严格收紧宽度（约 208px），视觉零噪音，纯粹展示成员与单一核心状态胶囊；
 * 2. 绝对禁止在花名册内陈列内部 Worker；
 * 3. 状态指示统一收敛至 5 态状态灯，右侧最多 1 个极简胶囊（? > 执行中数 > 待读回执数）。
 */

import { memo, useMemo } from 'react'
import {
  Sparkles,
  Users,
  Brain,
  BookOpen,
  Clapperboard,
  FileCheck2,
  FlaskConical,
  Bot,
} from 'lucide-react'
import type { TeamAgentProfile, DelegationRecord } from '../../../agent/team/types'
import type { AgentViewSnapshot } from '../../../learn/superAgent/useAgentTeam'
import { deriveAgentStatus } from './agentStatusMeta'
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
      return <Brain className={className || 'size-3.5'} />
    case 'agent-author':
      return <BookOpen className={className || 'size-3.5'} />
    case 'agent-director':
      return <Clapperboard className={className || 'size-3.5'} />
    case 'agent-examiner':
      return <FileCheck2 className={className || 'size-3.5'} />
    case 'agent-lab':
      return <FlaskConical className={className || 'size-3.5'} />
    default:
      return <Bot className={className || 'size-3.5'} />
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
  const activeDelegationsCount = useMemo(() => {
    return Object.values(delegations).filter((d) => d.status === 'running').length
  }, [delegations])

  const isChannelSelected = selected.kind === 'channel'

  return (
    <div className="flex flex-col h-full w-full bg-card/60 select-none border-r border-line/60">
      {/* 顶栏 */}
      <div className="p-3 border-b border-line/60 flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-seal/10 text-seal flex items-center justify-center shrink-0">
          <Users size={13} />
        </div>
        <div className="min-w-0">
          <h2 className="text-[12px] font-bold text-ink-strong truncate">
            {t('智能体团队')}
          </h2>
          <p className="text-[9.5px] text-ink-faint truncate max-w-[140px]">
            {goalTitle || t('协作集群')}
          </p>
        </div>
      </div>

      {/* 成员列表 */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        {/* 置顶：协作频道 */}
        <div
          onClick={() => onSelect({ kind: 'channel' })}
          className={`flex items-center justify-between px-2.5 py-2 rounded-xl transition cursor-pointer text-[12px] border ${
            isChannelSelected
              ? 'bg-seal/15 border-seal/40 font-semibold text-seal shadow-2xs'
              : 'border-transparent text-ink-subtle hover:text-ink hover:bg-line/40'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={13} className={isChannelSelected ? 'text-seal' : 'text-indigo-400'} />
            <span className="truncate">{t('协作频道')}</span>
          </div>
          {activeDelegationsCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-amber-500 text-white animate-pulse">
              {activeDelegationsCount}
            </span>
          )}
        </div>

        <div className="pt-1.5 pb-0.5 px-2 text-[9.5px] font-semibold text-ink-faint uppercase tracking-wider">
          {t('专家成员')}
        </div>

        {/* 5 席专家 */}
        {profiles.map((p) => {
          const snapshot = agents[p.id]
          const isSelected = selected.kind === 'agent' && selected.agentId === p.id
          const meta = deriveAgentStatus(snapshot)

          return (
            <div
              key={p.id}
              onClick={() => onSelect({ kind: 'agent', agentId: p.id })}
              className={`flex items-center justify-between px-2.5 py-2 rounded-xl transition cursor-pointer text-[12px] border ${
                isSelected
                  ? 'bg-seal/15 border-seal/40 font-semibold text-seal shadow-2xs'
                  : 'border-transparent text-ink-subtle hover:text-ink hover:bg-line/40'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {/* 统一语义状态点 */}
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dotClass}`} />
                <RoleIcon id={p.id} className={isSelected ? 'text-seal' : 'text-ink-faint'} />
                <span className="truncate">{p.name}</span>
              </div>

              {/* 单一优先级胶囊 */}
              {meta.badgeText && (
                <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold shrink-0 ${meta.pillClass}`}>
                  {meta.badgeText}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})
