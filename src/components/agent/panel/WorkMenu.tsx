/**
 * work 入口：role 输入框底行的一枚按钮 + 弹出列表。
 *
 * work 没有人格，列表只显示名字、状态、轮次与最近交付预览；点开把它的页签置前
 * （work 的消息列表与角色对话同一套渲染，见 AgentPanel 的 work 视图）。
 */
import { useState } from 'react'
import { Bot, ChevronUp } from 'lucide-react'
import type { WorkSession } from '../../../agent/types'
import { t } from '../../../i18n'

export function WorkMenu({ sessions, onOpen }: { sessions: WorkSession[]; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  if (!sessions.length) return null
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] text-ink-soft transition hover:bg-line/50 hover:text-ink-strong"
      >
        <Bot size={13} />
        <span>{t('工作 {0}', sessions.length)}</span>
        <ChevronUp size={12} className={open ? '' : 'rotate-180'} />
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-20 mb-1.5 w-[260px] overflow-hidden rounded-xl border border-line-strong bg-card shadow-xl">
          <div className="max-h-[260px] overflow-y-auto p-1">
            {sessions.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  setOpen(false)
                  onOpen(w.id)
                }}
                className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-line/40"
              >
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink-strong">
                  <span
                    className={
                      'h-1.5 w-1.5 shrink-0 rounded-full ' +
                      (w.status === 'running'
                        ? 'animate-pulse bg-seal'
                        : w.status === 'error'
                          ? 'bg-rose-500'
                          : 'bg-line-strong')
                    }
                  />
                  <span className="truncate">{w.name}</span>
                </span>
                <span className="truncate text-[10.5px] text-ink-faint">
                  {t('{0} 次任务', w.runs)}
                  {w.lastDelivery ? ' · ' + w.lastDelivery.slice(0, 80) : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
