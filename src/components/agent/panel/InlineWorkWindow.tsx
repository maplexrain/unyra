/**
 * work 消息的内嵌窗口：替代原来的 work 独立二级页。
 *
 * 默认只露一条可折叠标题；展开后上面是当前 role 的 work 列表，下面是选中 work 的
 * 只读消息流。work 仍然在后台跑，窗口只负责观察，不把用户带离 role 对话。
 */
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { ChevronDown, Wrench } from 'lucide-react'
import type { AgentPart, MessageImage, WorkSession } from '../../../agent/types'
import { t } from '../../../i18n'
import { MindMessageRow } from './MindMessageRow'
import { Parts } from './MessageBubble'
import { WorkDispatchList } from './WorkDispatchList'

export function InlineWorkWindow({
  works,
  live,
  open,
  activeWorkId,
  onToggle,
  onSelectWork,
  onStopWork,
  onStopWorkWithStatement,
  onDeleteWork,
  onOpenFile,
  setBubblePreview,
  goalId,
}: {
  works: WorkSession[]
  live: Array<{ workId: string; runId: string; parts: AgentPart[] }>
  open: boolean
  activeWorkId: string | null
  onToggle: () => void
  onSelectWork: (workId: string) => void
  onStopWork?: (workId: string) => void
  onStopWorkWithStatement?: (workId: string, statement: string) => void
  onDeleteWork?: (workId: string) => void
  onOpenFile?: (pathOrRel: string, title?: string) => void
  setBubblePreview: Dispatch<SetStateAction<MessageImage | null>>
  goalId?: string
}) {
  const selected = works.find((work) => work.id === activeWorkId) ?? works[0] ?? null
  const liveParts = selected ? (live.find((item) => item.workId === selected.id)?.parts ?? null) : null
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const runningCount = works.filter((work) => work.status === 'running').length

  useEffect(() => {
    if (!open || !selected) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [open, selected, selected?.messages.length, liveParts?.length])

  if (!works.length) return null

  return (
    <section
      data-inline-work-window
      className="mx-auto mb-3 mt-3 w-full max-w-[700px] shrink-0 overflow-hidden rounded-xl border border-line/80 bg-paper-deep/35"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-line/20"
      >
        <Wrench size={13} className="shrink-0 text-seal/75" />
        <span className="text-[11.5px] font-medium text-ink-strong">{t('工作窗口')}</span>
        <span className="rounded-full bg-line/55 px-1.5 py-0.5 text-[10px] tabular-nums text-ink-soft">
          {works.length}
        </span>
        {runningCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-[10.5px] text-seal-deep">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-seal" />
            {t('{0} 个进行中', runningCount)}
          </span>
        ) : null}
        <span className="ml-auto text-[10px] text-ink-faint">
          {open ? t('收起') : t('展开查看 work 消息')}
        </span>
        <ChevronDown
          size={13}
          className={'shrink-0 text-ink-faint transition-transform ' + (open ? 'rotate-180' : '')}
        />
      </button>

      {open ? (
        <div className="border-t border-line/60">
          <div className="px-2 pt-2">
            <WorkDispatchList
              embedded
              works={works}
              activeWorkId={activeWorkId}
              title={t('work 列表')}
              onOpenWork={onSelectWork}
              onStopWork={onStopWork}
              onStopWorkWithStatement={onStopWorkWithStatement}
              onDeleteWork={onDeleteWork}
            />
          </div>
          {selected ? (
            <div className="border-t border-line/60">
              <div className="flex min-w-0 items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ink-strong">
                  {selected.name}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
                  {t('{0} 次任务', selected.runs)}
                </span>
              </div>
              <div
                ref={scrollRef}
                data-inline-work-messages
                className="max-h-[min(42vh,380px)] overflow-y-auto border-t border-line/50 px-2 py-1"
              >
                {selected.messages.filter((m) => !m.hidden).map((m) => (
                  <MindMessageRow
                    key={m.id}
                    m={m}
                    agentName={selected.name}
                    faded={false}
                    flash={false}
                    setBubblePreview={setBubblePreview}
                    onOpenFile={onOpenFile}
                    goalId={goalId}
                  />
                ))}
                {liveParts && liveParts.length > 0 ? (
                  <div className="border-b border-line/40 py-2">
                    <Parts parts={liveParts} streaming />
                  </div>
                ) : null}
                {!selected.messages.length && !liveParts?.length ? (
                  <p className="px-2 py-4 text-center text-[11px] text-ink-faint">
                    {t('这个 work 还没有消息')}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
