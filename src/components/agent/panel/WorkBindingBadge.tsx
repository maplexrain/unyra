/**
 * 挂在通道消息气泡里的 work 运行状态条。
 *
 * 数据来自消息上的 `work` 快照（work.send 的 bindMessageId 写入，宿主在启动/执行/
 * 收口/停止时原地 patch）。它不是 work 列表，也不占上下文：只让发起任务的那条消息
 * 下面能直接看见「谁在跑、跑了多久、最近在做什么」，省掉来回翻状态面板。
 */
import { useEffect, useState } from 'react'
import { GitBranch } from 'lucide-react'
import type { WorkBinding } from '../../../agent/types'
import { t } from '../../../i18n'

function formatRuntime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const min = Math.floor(total / 60)
  const sec = total % 60
  if (min >= 60) {
    const hour = Math.floor(min / 60)
    return `${hour}:${String(min % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function statusOf(binding: WorkBinding): { text: string; tone: string; dot: string } {
  if (binding.status === 'running') {
    return { text: t('运行中'), tone: 'text-seal-deep', dot: 'animate-pulse bg-seal' }
  }
  if (binding.status === 'error') {
    return { text: t('出错'), tone: 'text-warn-deep', dot: 'bg-warn' }
  }
  if (binding.status === 'stopped' || binding.status === 'interrupted') {
    return { text: t('已停止'), tone: 'text-amber-700', dot: 'bg-amber-500' }
  }
  return binding.runs > 0
    ? { text: t('已完成'), tone: 'text-ink-soft', dot: 'bg-ink-faint/45' }
    : { text: t('空闲'), tone: 'text-ink-faint', dot: 'bg-ink-faint/45' }
}

export function WorkBindingBadge({ binding }: { binding: WorkBinding }) {
  const running = binding.status === 'running'
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running || !binding.startedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running, binding.startedAt])

  const status = statusOf(binding)
  const runtime =
    running && binding.startedAt ? binding.runtimeMs + Math.max(0, now - binding.startedAt) : binding.runtimeMs

  return (
    <div
      className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-line/70 pt-2 text-[11px]"
      data-work-binding={binding.workId}
      title={binding.lastIssue}
    >
      <GitBranch className="h-3 w-3 shrink-0 text-ink-faint" />
      <span className="shrink-0 font-medium text-ink-soft">Work</span>
      <span className="max-w-[160px] truncate text-ink" title={binding.workName}>
        {binding.workName}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <span className={'h-1.5 w-1.5 rounded-full ' + status.dot} />
        <span className={status.tone}>{status.text}</span>
      </span>
      {(running || binding.runtimeMs > 0) && (
        <span className="shrink-0 tabular-nums text-ink-faint">{formatRuntime(runtime)}</span>
      )}
      {binding.runs > 0 && <span className="shrink-0 text-ink-faint">· {t('{0} 轮', binding.runs)}</span>}
      {running && binding.current && (
        <span className="min-w-0 max-w-[240px] truncate text-ink-faint" title={binding.current}>
          {binding.current}
        </span>
      )}
    </div>
  )
}
