/**
 * 思维列表里的「已派发 work」观察卡。
 *
 * 它不是一条消息、不写进会话，也不参与上下文：只从宿主当前 role 的
 * `WorkSession[]` 现推，插在**启动 work 的那条 execute 消息之后**，让用户一眼看到
 * 「这次 mind 到底派了什么活、各自跑到哪、占了多少上下文」。
 *
 * 点击一张卡进入 mind 的二级 work 页（见 AgentPanel 的 nestedWorkId）；这里不直接
 * 调 `openAgentTab`，避免把观察入口又变回顶层页签。
 */
import { useMemo } from 'react'
import { ChevronRight, GitBranch, ListTodo } from 'lucide-react'
import type { MessageUsage, WorkSession } from '../../../agent/types'
import { contextRatio, formatTokens, totalUsage } from '../../../lib/usage'
import { t, useLocale } from '../../../i18n'

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
}: {
  works: WorkSession[]
  onOpenWork?: (workId: string) => void
  activeWorkId?: string | null
}) {
  useLocale()
  const sorted = useMemo(
    () => [...works].sort((a, b) => b.lastActiveAt - a.lastActiveAt),
    [works],
  )
  if (!sorted.length) return null
  return (
    <section
      data-work-dispatch-list
      aria-label={t('已派发的 work')}
      className="mb-3 rounded-xl border border-line/80 bg-paper-deep/35 px-2.5 py-2"
    >
      <div className="mb-1.5 flex min-w-0 items-center gap-1.5">
        <ListTodo size={12} className="shrink-0 text-seal/75" />
        <span className="text-[11.5px] font-medium text-ink-strong">{t('已派发的 work')}</span>
        <span className="rounded-full bg-line/55 px-1.5 py-0.5 text-[10px] tabular-nums text-ink-soft">
          {sorted.length}
        </span>
        <span className="ml-auto text-[10px] text-ink-faint">{t('仅界面观察 · 不进上下文')}</span>
      </div>
      <div className="flex flex-col gap-1">
        {sorted.map((work) => {
          const status = statusOf(work)
          const totals = totalUsage(usagesOf(work))
          const ratio = totals ? contextRatio(totals) : null
          const preview = (work.lastDelivery || work.lastIssue || '').replace(/\s+/g, ' ').trim()
          return (
            <button
              key={work.id}
              type="button"
              data-work-id={work.id}
              onClick={() => onOpenWork?.(work.id)}
              title={t('进入 work 二级页')}
              className={
                'group/wk flex w-full min-w-0 flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-line/35 ' +
                (work.id === activeWorkId ? 'bg-seal/10 ring-1 ring-seal/20' : '')
              }
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
          )
        })}
      </div>
    </section>
  )
}
