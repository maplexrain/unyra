/**
 * 正文里的内嵌 work 状态块：`[标题](work: work-id)` 的 React 渲染件。
 *
 * 两行、无边框、无底色，和正文同一层排版：
 * - 第一行：标题 + work 名 / id + 运行状态 + 累计耗时；
 * - 第二行：只显示 work 当前最后一步（思考流 / execute 标题 / 正文），单行省略。
 *
 * 第二行换步骤时做一次 3D 立方体向后翻面：旧面绕 X 轴向后倒，新面从前方立起来。
 * 同一个步骤内部流式增长不触发翻面，否则每个 token 都会闪一下。
 */
import { useEffect, useRef, useState } from 'react'
import { Brain, GitBranch, Wrench } from 'lucide-react'
import type { WorkSession } from '../../../agent/types'
import {
  resolveWorkInline,
  workActivityOf,
  type WorkInlineActivity,
  type WorkInlineSource,
} from '../../../lib/workInline'
import { t } from '../../../i18n'
import { TailText } from './TailText'
import { toolLabel } from './toolLabel'

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

function statusOf(session: WorkSession): { text: string; tone: string; dot: string } {
  if (session.status === 'running') {
    return { text: t('运行中'), tone: 'text-seal-deep', dot: 'animate-pulse bg-seal' }
  }
  if (session.status === 'error') {
    return { text: t('出错'), tone: 'text-warn-deep', dot: 'bg-warn' }
  }
  if (session.status === 'interrupted') {
    return { text: t('已中断'), tone: 'text-amber-700', dot: 'bg-amber-500' }
  }
  if (session.status === 'stopped') {
    return { text: t('已停止'), tone: 'text-amber-700', dot: 'bg-amber-500' }
  }
  return session.runs > 0
    ? { text: t('已完成'), tone: 'text-ink-soft', dot: 'bg-ink-faint/45' }
    : { text: t('空闲'), tone: 'text-ink-faint', dot: 'bg-ink-faint/45' }
}

function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [running])
  return now
}

function ActivityLine({ activity }: { activity: WorkInlineActivity }) {
  const text = activity.kind === 'tool' ? toolLabel(activity.name, activity.args) : t(activity.text)
  const Icon =
    activity.kind === 'thinking' ? Brain : activity.kind === 'tool' ? Wrench : null
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {Icon ? <Icon size={11} className="shrink-0 text-ink-faint" aria-hidden="true" /> : null}
      <TailText
        text={text}
        className={
          activity.kind === 'thinking'
            ? 'italic text-ink-faint'
            : activity.kind === 'tool'
              ? 'text-ink-soft'
              : activity.kind === 'idle' && activity.error
                ? 'text-warn-deep'
                : 'text-ink-soft'
        }
      />
    </span>
  )
}

/** 单行高度的翻面容器：旧面倒下去、新面立起来，新步骤覆盖旧步骤。 */
function FlipLine({ activity }: { activity: WorkInlineActivity }) {
  const [current, setCurrent] = useState(activity)
  const [leaving, setLeaving] = useState<WorkInlineActivity | null>(null)
  const [turn, setTurn] = useState(0)
  const currentRef = useRef(activity)

  useEffect(() => {
    const prev = currentRef.current
    if (activity.key !== prev.key) {
      currentRef.current = activity
      setLeaving(prev)
      setCurrent(activity)
      setTurn((n) => n + 1)
      const timer = window.setTimeout(() => setLeaving(null), 260)
      return () => window.clearTimeout(timer)
    }
    if (activity.text !== prev.text) {
      currentRef.current = activity
      setCurrent(activity)
    }
  }, [activity])

  return (
    <div
      className="relative h-[17px] overflow-hidden"
      style={{ perspective: '520px', perspectiveOrigin: '50% 0%' }}
      data-work-inline-line={activity.kind}
    >
      {leaving ? (
        <div
          className="moji-work-inline-face moji-work-inline-face-out absolute inset-0 flex items-center"
          aria-hidden="true"
        >
          <ActivityLine activity={leaving} />
        </div>
      ) : null}
      <div
        key={turn}
        className={
          'moji-work-inline-face absolute inset-0 flex items-center' +
          (leaving ? ' moji-work-inline-face-in' : '')
        }
      >
        <ActivityLine activity={current} />
      </div>
    </div>
  )
}

export function WorkInline({
  title,
  workRef,
  source,
}: {
  title: string
  workRef: string
  source?: WorkInlineSource
}) {
  const found = resolveWorkInline(source, workRef)
  const session = found?.session
  const running = session?.status === 'running'
  const now = useNow(running)
  const runtime = session
    ? session.runtimeMs + (running && session.runningSince ? Math.max(0, now - session.runningSince) : 0)
    : 0
  const status = session ? statusOf(session) : null
  const activity = session ? workActivityOf(session, found?.live) : null

  return (
    <div
      className="my-1.5 flex min-w-0 flex-col gap-1 text-[11.5px] leading-[17px]"
      data-work-inline={session?.id ?? workRef}
      data-work-inline-name={session?.name ?? workRef}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[10.5px] leading-4">
        <GitBranch size={11} className="shrink-0 text-ink-faint" aria-hidden="true" />
        <span className="min-w-0 max-w-[46%] truncate font-medium text-ink-strong" title={title}>
          {title}
        </span>
        <span
          className="min-w-0 max-w-[112px] truncate font-mono text-[10px] text-ink-faint"
          title={session?.id ?? workRef}
        >
          {session?.name ?? workRef}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {status ? (
            <>
              <span aria-hidden="true" className={'h-1.5 w-1.5 rounded-full ' + status.dot} />
              <span className={status.tone}>{status.text}</span>
            </>
          ) : (
            <span className="text-amber-700">{t('未找到')}</span>
          )}
        </span>
        {session ? (
          <span className="shrink-0 tabular-nums text-ink-faint" title={t('累计耗时')}>
            {formatRuntime(runtime)}
          </span>
        ) : null}
      </div>
      {activity ? (
        <FlipLine activity={activity} />
      ) : (
        <div className="h-[17px] truncate text-ink-faint">
          {t('未找到 work「{0}」', workRef)}
        </div>
      )}
    </div>
  )
}
