/**
 * 当前 role 的 work 状态列表。
 *
 * 它不是一条消息、不写进会话，也不参与上下文：从宿主当前 role 的
 * `WorkSession[]` 现推，挂在思维页右侧状态面板（或私聊消息列表）里，让用户一眼看到
 * 「这个 role 手上有哪些活、各自跑到哪、占了多少上下文」。
 *
 * 点击卡片主体进入对应 work 消息；右侧是删除 / 终止两个动作。
 * 两个动作都先弹确认框：终止尤其要用户写清声明，写不了就只能强制终止。
 */
import { useMemo, useState } from 'react'
import { ChevronRight, GitBranch, ListTodo, Square, Trash2 } from 'lucide-react'
import type { MessageUsage, WorkSession } from '../../../agent/types'
import { contextRatio, formatTokens, totalUsage } from '../../../lib/usage'
import { t, useLocale } from '../../../i18n'
import ConfirmDialog from '../../ConfirmDialog'
import { WorkStopDialog } from './WorkStopDialog'

function usagesOf(work: WorkSession): MessageUsage[] {
  return work.messages.flatMap((m) => (m.role === 'assistant' && m.usage ? [m.usage] : []))
}

function statusOf(work: WorkSession): { text: string; tone: string; dot: string } {
  if (work.status === 'running') {
    return { text: t('运行中'), tone: 'text-seal-deep', dot: 'animate-pulse bg-seal' }
  }
  if (work.status === 'error') {
    return { text: t('出错'), tone: 'text-warn-deep', dot: 'bg-warn' }
  }
  if (work.status === 'stopped' || work.status === 'interrupted') {
    return { text: t('已停止'), tone: 'text-amber-700', dot: 'bg-amber-500' }
  }
  return { text: t('空闲'), tone: 'text-ink-faint', dot: 'bg-ink-faint/45' }
}

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function WorkDispatchList({
  works,
  onOpenWork,
  activeWorkId,
  title = t('已派发的 work'),
  onStopWork,
  onStopWorkWithStatement,
  onDeleteWork,
  embedded = false,
}: {
  works: WorkSession[]
  onOpenWork?: (workId: string) => void
  activeWorkId?: string | null
  /** 私聊里用「当前 agent 的 work」，mind 里保留旧标题 */
  title?: string
  /** 嵌在状态面板里时不再画自己的卡片外壳 */
  embedded?: boolean
  /** 强制终止：只关 loop，不向 role 发说明 */
  onStopWork?: (workId: string) => void
  /** 带声明终止：关 loop 后把声明发给 role 并激活它 */
  onStopWorkWithStatement?: (workId: string, statement: string) => void
  onDeleteWork?: (workId: string) => void
}) {
  useLocale()
  const [stopTarget, setStopTarget] = useState<WorkSession | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WorkSession | null>(null)
  const sorted = useMemo(
    () => [...works].sort((a, b) => b.lastActiveAt - a.lastActiveAt),
    [works],
  )
  if (!sorted.length) return null
  const stopWork = stopTarget ? sorted.find((w) => w.id === stopTarget.id) ?? null : null
  const deleting = deleteTarget ? sorted.find((w) => w.id === deleteTarget.id) ?? null : null
  return (
    <section
      data-work-dispatch-list
      aria-label={title}
      className={
        embedded
          ? 'mb-0 rounded-none border-0 bg-transparent px-0 py-0'
          : 'mb-3 rounded-xl border border-line/80 bg-card/55 px-2.5 py-2'
      }
    >
      {!embedded ? (
        <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
          <ListTodo size={12} className="shrink-0 text-seal/75" />
          <span className="text-[11.5px] font-medium text-ink-strong">{title}</span>
          <span className="rounded-full bg-line/55 px-1.5 py-0.5 text-[10px] tabular-nums text-ink-soft">
            {sorted.length}
          </span>
        </div>
      ) : null}
      <div className="flex flex-col">
        {sorted.map((work) => {
          const status = statusOf(work)
          const totals = totalUsage(usagesOf(work))
          const ratio = totals ? contextRatio(totals) : null
          const preview = (work.lastDelivery || work.lastIssue || '').replace(/\s+/g, ' ').trim()
          const canStop = work.status === 'running' && Boolean(onStopWork)
          return (
            <div
              key={work.id}
              className={
                'group/wk mb-1 flex min-w-0 items-stretch gap-1 rounded-md border border-line/55 bg-card/60 transition ' +
                (work.id === activeWorkId ? 'border-line-strong/70 bg-card' : 'hover:border-line-strong/60 hover:bg-card/80')
              }
            >
              <button
                type="button"
                data-work-id={work.id}
                onClick={() => onOpenWork?.(work.id)}
                title={t('展开 work 消息')}
                className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span aria-hidden="true" className={'h-1.5 w-1.5 shrink-0 rounded-full ' + status.dot} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] leading-snug text-ink-soft group-hover/wk:text-ink">
                    {work.name}
                  </span>
                  <span className={'shrink-0 text-[10.5px] ' + status.tone}>{status.text}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
                    {timeOf(work.lastActiveAt)}
                  </span>
                  <ChevronRight size={11} className="shrink-0 opacity-0 transition group-hover/wk:opacity-55" />
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 pl-3 text-[10.5px] tabular-nums text-ink-faint">
                  <span>{t('{0} 次任务', work.runs)}</span>
                  {totals ? (
                    <>
                      <span className="inline-flex items-center gap-0.5">
                        <GitBranch size={9} className="shrink-0" />
                        {t('上下文 {0} · {1}', ratio === null ? '—' : Math.round(ratio * 100) + '%', formatTokens(totals.contextTokens))}
                      </span>
                      <span>{t('累计 {0}', formatTokens(totals.input))}</span>
                    </>
                  ) : (
                    <span>{t('尚无上下文账')}</span>
                  )}
                  {preview && (
                    <span className="min-w-0 flex-1 truncate" title={preview}>
                      · {preview}
                    </span>
                  )}
                </span>
              </button>
              {(canStop || onDeleteWork) && (
                <div className="flex shrink-0 items-center gap-0.5 pr-1">
                  {canStop && (
                    <button
                      type="button"
                      data-work-stop
                      title={t('终止这个 work')}
                      aria-label={t('终止 {0}', work.name)}
                      onClick={() => setStopTarget(work)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-seal/10 hover:text-seal"
                    >
                      <Square size={12} />
                    </button>
                  )}
                  {onDeleteWork && (
                    <button
                      type="button"
                      data-work-delete
                      title={t('删除这个 work')}
                      aria-label={t('删除 {0}', work.name)}
                      onClick={() => setDeleteTarget(work)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-rose-500/10 hover:text-rose-600"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {stopWork && (
        <WorkStopDialog
          workName={stopWork.name}
          onCancel={() => setStopTarget(null)}
          onForceStop={() => {
            onStopWork?.(stopWork.id)
            setStopTarget(null)
          }}
          onStopWithStatement={(statement) => {
            onStopWorkWithStatement?.(stopWork.id, statement)
            setStopTarget(null)
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('删除 work「{0}」？', deleting.name)}
          message={t(
            '删除会终止正在跑的 loop，并移除这个 work 的会话与上下文，不可恢复。想保留上下文、以后还能续跑，请改用「终止」。',
          )}
          confirmLabel={t('删除 work')}
          onConfirm={() => {
            onDeleteWork?.(deleting.id)
            setDeleteTarget(null)
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </section>
  )
}
