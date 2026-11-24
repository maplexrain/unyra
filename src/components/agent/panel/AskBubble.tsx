/**
 * 通道里的 ask 气泡：把结构化表单从「输入框上方」搬进消息流。
 *
 * 关键是它**有时效性**：底部一条进度条按 expiresAt 倒计时，时间一到表单失效；
 * 气泡本身仍留在聊天记录里，用户能看到「已失效 / 已提交 / 已取消」的状态。
 * work 发起的 ask 也走这里——身份用所属 role，界面不需要知道是 work 在问。
 *
 * 鼠标停在气泡上时**冻结本地倒计时，并通知宿主暂停到期定时器**：
 * 用户已经在填表，不能因为读题 / 打字让表单在手下到期。
 */
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Clock3, HelpCircle, XCircle } from 'lucide-react'
import type { AskAnswers } from '../../../agent/tools'
import type { ChannelAsk } from '../../../agent/types'
import { ASK_BUBBLE_TTL_MS } from '../../../agent/sandbox/limits'
import { AskFormCard } from './AskFormCard'

export function AskBubble({
  ask,
  actorName,
  onSubmit,
  onCancel,
  onExpire,
  onHover,
}: {
  ask: ChannelAsk
  actorName: string
  onSubmit?: (answers: AskAnswers) => void
  onCancel?: () => void
  onExpire?: () => void
  /** 悬停 / 移出：宿主据此暂停或恢复 ask 的到期定时器 */
  onHover?: (hovering: boolean) => void
}) {
  const [now, setNow] = useState(() => Date.now())
  /** 本地的有效截止时间：悬停期间会冻结，移出时按剩余时长重新起算 */
  const [deadline, setDeadline] = useState(ask.expiresAt)
  /** 进度条的总时长：宿主一律按 ASK_BUBBLE_TTL_MS 挂出；悬停延长 expiresAt 不能把比例重新拉满 */
  const totalRef = useRef(Math.max(1, ASK_BUBBLE_TTL_MS))
  const [hovering, setHovering] = useState(false)
  /** 悬停开始那一刻剩下的时间；悬停期间倒计时读数与进度条都用它 */
  const [heldRemaining, setHeldRemaining] = useState<number | null>(null)
  const expiredRef = useRef(false)
  const hoveringRef = useRef(false)
  const onHoverRef = useRef(onHover)

  useEffect(() => {
    onHoverRef.current = onHover
  }, [onHover])

  /** 切走 / 关闭时气泡会卸载：不能把宿主定时器永久留在暂停态。 */
  useEffect(() => {
    return () => {
      if (hoveringRef.current) {
        hoveringRef.current = false
        onHoverRef.current?.(false)
      }
    }
  }, [])

  useEffect(() => {
    setDeadline(ask.expiresAt)
    setNow(Date.now())
    expiredRef.current = false
  }, [ask.id, ask.expiresAt])

  const remaining =
    hovering && heldRemaining !== null ? heldRemaining : Math.max(0, deadline - now)
  const pending = ask.status === 'pending' && remaining > 0
  const stalePending = ask.status === 'pending' && remaining <= 0
  const total = totalRef.current
  const ratio = Math.max(0, Math.min(1, remaining / total))
  const seconds = Math.ceil(remaining / 1000)

  useEffect(() => {
    if (ask.status !== 'pending' || hovering) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [ask.status, hovering])

  useEffect(() => {
    if (ask.status !== 'pending' || hovering || remaining > 0 || expiredRef.current) return
    expiredRef.current = true
    onExpire?.()
  }, [ask.status, hovering, remaining, onExpire])

  const handleEnter = () => {
    if (ask.status !== 'pending') return
    hoveringRef.current = true
    setHeldRemaining(Math.max(0, deadline - Date.now()))
    setHovering(true)
    onHover?.(true)
  }

  const handleLeave = () => {
    if (!hovering) return
    hoveringRef.current = false
    const left = heldRemaining ?? Math.max(0, deadline - Date.now())
    setDeadline(Date.now() + left)
    setNow(Date.now())
    setHovering(false)
    setHeldRemaining(null)
    onHover?.(false)
  }

  const statusLine =
    ask.status === 'answered'
      ? '✅ 已提交'
      : ask.status === 'cancelled'
        ? '已取消'
        : ask.status === 'expired' || stalePending
          ? '⌛ 已失效'
          : ''

  return (
    <div
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className="w-full max-w-[700px] rounded-2xl border border-seal/25 bg-bubble-agent px-3 py-2.5 shadow-[0_8px_24px_rgba(31,27,23,0.08)]"
    >
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
