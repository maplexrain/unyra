/**
 * 全局群消息推送：群里有 agent `@用户 ` 时，从窗口顶部水平居中弹出一条可点击的
 * 轻量提示。它不是群聊页的一部分，固定悬浮在整个应用之上；点击直接打开对应目标
 * 的智能体群聊页，关闭则只收起这一次提示。
 */
import { createPortal } from 'react-dom'
import { Bell, Users, X } from 'lucide-react'
import { t } from '../../../i18n'

export interface GroupMentionPushData {
  id: string
  goalId: string
  fromName: string
  text: string
}

export function GroupMentionPush({
  push,
  onOpen,
  onClose,
}: {
  push: GroupMentionPushData
  onOpen: (push: GroupMentionPushData) => void
  onClose: () => void
}) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      data-group-mention-push
      className="fixed left-1/2 top-4 z-[75] w-[min(520px,calc(100vw-32px))] -translate-x-1/2"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(push)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen(push)
          }
        }}
        className="group flex cursor-pointer items-start gap-2.5 rounded-xl border border-line-strong/80 bg-card/95 px-3.5 py-2.5 shadow-[0_10px_32px_rgba(31,27,23,0.22)] backdrop-blur-md transition-colors hover:border-seal/45 hover:bg-card"
      >
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-seal/12 text-seal-deep">
          <Bell size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-faint">
            <Users size={11} className="shrink-0" />
            <span className="truncate">{t('群消息 · {0} 在群里 @了你', push.fromName)}</span>
          </span>
          <span className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-strong">
            {push.text}
          </span>
          <span className="mt-0.5 block text-[10.5px] font-medium text-seal-deep">
            {t('点击打开智能体群聊')}
          </span>
        </span>
        <button
          type="button"
          aria-label={t('关闭推送')}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="shrink-0 rounded-md p-1 text-ink-faint transition-colors hover:bg-line/30 hover:text-ink"
        >
          <X size={13} />
        </button>
      </div>
    </div>,
    document.body,
  )
}
