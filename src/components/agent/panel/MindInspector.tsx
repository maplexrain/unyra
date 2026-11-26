/**
 * 思维页右侧的固定状态面板。
 *
 * 它不是消息列表的一部分，也不跟着列表滚动：页宽够（>= 1400）时挂在列表右侧，
 * 上半是当前 role 的 mind 上下文账，下半是当前 agent 的 work 状态列表与各自的上下文账。
 * 页宽不够时整块隐藏，列表恢复满宽。
 */
import { Database, ListTodo } from 'lucide-react'
import type { MessageUsage, WorkSession } from '../../../agent/types'
import { t, useLocale } from '../../../i18n'
import { MindContextSummary } from './MindContextSummary'
import { WorkDispatchList } from './WorkDispatchList'

export function MindInspector({
  usages,
  subject,
  works,
  activeWorkId,
  onOpenWork,
  onStopWork,
  onStopWorkWithStatement,
  onDeleteWork,
}: {
  usages: MessageUsage[]
  subject?: string
  works: WorkSession[]
  activeWorkId?: string | null
  onOpenWork?: (workId: string) => void
  onStopWork?: (workId: string) => void
  onStopWorkWithStatement?: (workId: string, statement: string) => void
  onDeleteWork?: (workId: string) => void
}) {
  useLocale()
  return (
    <aside
      data-mind-inspector
      className="flex h-full w-[360px] shrink-0 flex-col gap-4 overflow-y-auto bg-card/30 px-3 py-3"
    >
      <section className="min-w-0">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-ink-strong">
          <Database size={12} className="shrink-0 text-seal/75" />
          <span>{t('role 上下文')}</span>
        </div>
        {usages.length ? (
          <MindContextSummary usages={usages} subject={subject} embedded />
        ) : (
          <p className="px-1 text-[11px] leading-relaxed text-ink-faint">{t('尚无上下文账')}</p>
        )}
      </section>

      <section className="min-w-0">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-ink-strong">
          <ListTodo size={12} className="shrink-0 text-seal/75" />
          <span>{t('work 层')}</span>
          <span className="ml-auto rounded-full bg-line/55 px-1.5 py-0.5 text-[10px] tabular-nums text-ink-soft">
            {works.length}
          </span>
        </div>
        {works.length ? (
          <WorkDispatchList
            works={works}
            activeWorkId={activeWorkId}
            onOpenWork={onOpenWork}
            onStopWork={onStopWork}
            onStopWorkWithStatement={onStopWorkWithStatement}
            onDeleteWork={onDeleteWork}
            embedded
          />
        ) : (
          <p className="px-1 text-[11px] leading-relaxed text-ink-faint">{t('暂无 work')}</p>
        )}
      </section>
    </aside>
  )
}
