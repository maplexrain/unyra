/**
 * 三平面工作台左侧导航轨 (SuperAgentRail)
 *
 * 结构：
 * 1. 置顶：前台主控 (Frontline Host) + 待同步 Mailbox 计数徽标；
 * 2. 中段：工单工坊 (Workers)，状态优先排序，悬停快捷中止；
 * 3. 底部：外置共享黑板 (Blackboard) 索引入口。
 */

import { memo } from 'react'
import {
  Bot,
  CheckCircle2,
  Clock,
  Inbox,
  LayoutGrid,
  Loader2,
  StopCircle,
  XCircle,
} from 'lucide-react'
import type { WorkerSession, WorkerStatus } from '../../../agent/super/types'
import { t } from '../../../i18n'

export type SuperRailView =
  | { kind: 'host' }
  | { kind: 'worker'; workerId: string }
  | { kind: 'blackboard' }

export interface SuperAgentRailProps {
  currentView: SuperRailView
  onSelectView: (view: SuperRailView) => void
  hostRunning: boolean
  mailboxCount: number
  workers: WorkerSession[]
  blackboardCount: number
  onCancelWorker: (workerId: string) => void
  goalTitle?: string
}

function StatusIndicator({ status }: { status: WorkerStatus }) {
  switch (status) {
    case 'running':
      return <Loader2 size={13} className="animate-spin text-amber-500 shrink-0" />
    case 'waiting_input':
      return <Clock size={13} className="text-sky-500 shrink-0" />
    case 'done':
      return <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
    case 'failed':
      return <XCircle size={13} className="text-rose-500 shrink-0" />
    case 'cancelled':
      return <StopCircle size={13} className="text-ink-faint shrink-0" />
    default:
      return <div className="w-2 h-2 rounded-full bg-ink-faint/50 shrink-0" />
  }
}

export const SuperAgentRail = memo(function SuperAgentRail({
  currentView,
  onSelectView,
  hostRunning,
  mailboxCount,
  workers,
  blackboardCount,
  onCancelWorker,
  goalTitle,
}: SuperAgentRailProps) {
  const isHostSelected = currentView.kind === 'host'
  const isBlackboardSelected = currentView.kind === 'blackboard'
  const selectedWorkerId = currentView.kind === 'worker' ? currentView.workerId : null

  return (
    <div className="flex flex-col h-full w-full bg-paper select-none border-r border-line/60">
      {/* 轨顶栏：目标标识 */}
      <div className="p-3.5 border-b border-line/60 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-[10.5px] font-semibold text-seal uppercase tracking-wider">
            {t('三平面架构')}
          </div>
          <div className="text-[13px] font-bold text-ink-strong truncate" title={goalTitle}>
            {goalTitle || t('智能体团队')}
          </div>
        </div>
      </div>

      {/* 置顶：前台主控 (Frontline Host) */}
      <div className="p-2 border-b border-line/40">
        <button
          type="button"
          onClick={() => onSelectView({ kind: 'host' })}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition cursor-pointer ${
            isHostSelected
              ? 'bg-seal/10 text-seal font-semibold'
              : 'text-ink-soft hover:bg-line/40 hover:text-ink'
          }`}
        >
          <div className="relative flex items-center justify-center w-7 h-7 rounded-lg bg-seal/15 text-seal shrink-0">
            <Bot size={16} />
            {hostRunning && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="text-[13px] truncate">{t('前台主控 (Host)')}</span>
              {mailboxCount > 0 && (
                <span
                  title={t('下次发送消息时自动同步给前台主控')}
                  className="flex items-center gap-0.5 px-1.5 py-0.2 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10.5px] font-bold"
                >
                  <Inbox size={10} />
                  <span>{mailboxCount}</span>
                </span>
              )}
            </div>
            <div className="text-[11px] text-ink-faint truncate">
              {hostRunning ? t('调度中...') : t('极速接单 · 永不阻塞')}
            </div>
          </div>
        </button>
      </div>

      {/* 中段：工单工坊 (Workers) 列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <div className="px-2 py-1 text-[11px] font-medium text-ink-faint flex items-center justify-between">
          <span>{t('工单工坊 (Workers)')}</span>
          <span className="text-[10px] bg-line/60 px-1.5 rounded-full">{workers.length}</span>
        </div>

        {workers.length === 0 ? (
          <div className="p-4 text-center text-[12px] text-ink-faint leading-relaxed">
            {t('暂无工单')}<br />
            {t('向前台主控发任务即可秒级派单')}
          </div>
        ) : (
          workers.map((worker) => {
            const isSelected = selectedWorkerId === worker.id
            const isRunning = worker.status === 'running'

            return (
              <div
                key={worker.id}
                onClick={() => onSelectView({ kind: 'worker', workerId: worker.id })}
                className={`group relative flex items-start gap-2.5 px-2.5 py-2 rounded-xl text-left transition cursor-pointer ${
                  isSelected
                    ? 'bg-seal/10 text-ink-strong font-medium shadow-xs'
                    : 'text-ink-soft hover:bg-line/40 hover:text-ink'
                }`}
              >
                <div className="pt-0.5">
                  <StatusIndicator status={worker.status} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] truncate font-medium">{worker.title}</div>
                  <div className="text-[11px] text-ink-faint truncate">{worker.goal}</div>
                </div>

                {/* 运行中悬停中止按钮 */}
                {isRunning && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onCancelWorker(worker.id)
                    }}
                    title={t('中止此工单')}
                    className="opacity-0 group-hover:opacity-100 p-1 text-ink-faint hover:text-rose-500 rounded transition cursor-pointer"
                  >
                    <StopCircle size={13} />
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* 底部：外置共享黑板入口 */}
      <div className="p-2 border-t border-line/60">
        <button
          type="button"
          onClick={() => onSelectView({ kind: 'blackboard' })}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition cursor-pointer ${
            isBlackboardSelected
              ? 'bg-seal/10 text-seal font-semibold'
              : 'text-ink-soft hover:bg-line/40 hover:text-ink'
          }`}
        >
          <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-indigo-500/10 text-indigo-500 shrink-0">
            <LayoutGrid size={14} />
          </div>
          <div className="min-w-0 flex-1 flex items-center justify-between">
            <span className="text-[12.5px] truncate">{t('外置黑板 (Blackboard)')}</span>
            <span className="text-[11px] text-ink-faint">{blackboardCount}</span>
          </div>
        </button>
      </div>
    </div>
  )
})
