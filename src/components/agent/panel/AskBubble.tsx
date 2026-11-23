/**
 * 通道里的 ask 气泡：把结构化表单从「输入框上方」搬进消息流。
 *
 * 关键是它**有时效性**：底部一条进度条按 expiresAt 倒计时，时间一到表单失效；
 * 气泡本身仍留在聊天记录里，用户能看到「已失效 / 已提交 / 已取消」的状态。
 * work 发起的 ask 也走这里——身份用所属 role，界面不需要知道是 work 在问。
 */
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Clock3, HelpCircle, XCircle } from 'lucide-react'
import type { AskAnswers } from '../../../agent/tools'
import type { ChannelAsk } from '../../../agent/types'
import { AskFormCard } from './AskFormCard'

export function AskBubble({
  ask,
  actorName,
  createdAt,
  onSubmit,
  onCancel,
  onExpire,
}: {
  ask: ChannelAsk
  actorName: string
  /** 气泡消息的 ts：用来算总时长（进度条从 1 走到 0，而不是从某个中途开始） */
  createdAt: number
  onSubmit?: (answers: AskAnswers) => void
  onCancel?: () => void
  onExpire?: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  const expiredRef = useRef(false)
  const pending = ask.status === 'pending' && ask.expiresAt > now
  const stalePending = ask.status === 'pending' && ask.expiresAt <= now
  const remaining = Math.max(0, ask.expiresAt - now)
  const total = Math.max(1, ask.expiresAt - createdAt)
  const ratio = Math.max(0, Math.min(1, remaining / total))
  const seconds = Math.ceil(remaining / 1000)

  useEffect(() => {
    if (ask.status !== 'pending') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [ask.status])

  useEffect(() => {
    if (ask.status !== 'pending' || remaining > 0 || expiredRef.current) return
    expiredRef.current = true
    onExpire?.()
  }, [ask.status, remaining, onExpire])

  const statusLine =
    ask.status === 'answered'
      ? '✅ 已提交'
      : ask.status === 'cancelled'
        ? '已取消'
        : ask.status === 'expired' || stalePending
          ? '⌛ 已失效'
          : ''

  return (
    <div className="w-full max-w-[700px] rounded-2xl border border-seal/25 bg-bubble-agent px-3 py-2.5 shadow-[0_8px_24px_rgba(31,27,23,0.08)]">
      <div className="flex items-center gap-1.5 px-0.5 pb-1.5 text-[11px]">
        {pending ? <Clock3 size={12} className="shrink-0 text-seal" /> : <HelpCircle size={12} className="shrink-0 text-ink-faint" />}
        <span className="min-w-0 flex-1 truncate font-medium text-ink-strong">
          {actorName} · {ask.form.title || '想先确认几件事'}
        </span>
        {pending ? (
          <span className="shrink-0 tabular-nums text-ink-faint">{seconds}s</span>
        ) : (
          <span className="shrink-0 text-ink-faint">{statusLine}</span>
        )}
      </div>
      {pending ? (
        <AskFormCard
          form={ask.form}
          hideTitle
          onSubmit={(answers) => onSubmit?.(answers)}
          onCancel={() => onCancel?.()}
        />
      ) : (
        <div className="flex items-center gap-1.5 rounded-lg bg-line/20 px-2.5 py-2 text-[11.5px] text-ink-soft">
          {ask.status === 'answered' ? <CheckCircle2 size={13} className="text-seal" /> : <XCircle size={13} className="text-ink-faint" />}
          <span>{ask.status === 'answered' ? '答案已交回，表单关闭。' : ask.status === 'expired' || stalePending ? '等待超时，表单已失效。' : '表单已取消。'}</span>
        </div>
      )}
      {pending ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-line/50" aria-label="剩余时间">
          <div
            className="h-full rounded-full bg-seal/70 transition-[width] duration-1000 ease-linear"
            style={{ width: Math.round(ratio * 100) + '%' }}
          />
        </div>
      ) : null}
    </div>
  )
}
