/**
 * 群消息调度失败兜底：幕后分类器三次重试仍失败时，不静默丢消息，也不伪造 agent
 * 回复，而是让用户在这里显式指定接手人。候选列表就是当前群里的成员。
 */
import { createPortal } from 'react-dom'
import { AlertCircle, X } from 'lucide-react'
import { t } from '../../../i18n'
import type { AgentTeamMode } from '../../learn/agent-team/conversationList'
import type { GroupChatAgent } from './GroupChatPanel'

export function GroupTriageFallbackDialog({
  message,
  agents,
  onPick,
  onClose,
}: {
  /** 失败那条群消息的原文，只用于确认是哪一句 */
  message: string
  agents: GroupChatAgent[]
  onPick: (agentId: AgentTeamMode) => void
  onClose: () => void
}) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      data-group-triage-fallback
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/30 px-4 pt-[16vh] backdrop-blur-[2px]"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-triage-fallback-title"
        className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-line/80 bg-paper shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2 border-b border-line/60 px-4 py-3">
          <AlertCircle size={17} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <h2 id="group-triage-fallback-title" className="text-[14px] font-semibold text-ink-strong">
              {t('群消息调度失败，请手动指定接手人')}
            </h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-soft">
              {t('系统已自动重试三次仍未成功。这条消息还在群里，选一位 agent 接手即可继续；也可以稍后补 @ 重发。')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('关闭')}
            className="rounded-md p-1 text-ink-faint transition-colors hover:bg-line/30 hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-4 py-3">
          <p className="mb-2 line-clamp-2 rounded-lg bg-paper-deep px-2.5 py-2 text-[12px] leading-relaxed text-ink-soft">
            {message}
          </p>
          <p className="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-ink-faint">
            {t('选择接手人')}
          </p>
          <div className="max-h-[min(46vh,360px)] overflow-y-auto">
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                data-triage-agent={agent.id}
                onClick={() => onPick(agent.id)}
                className="flex w-full items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-line/70 hover:bg-paper-deep"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink-strong">
                    {agent.name}
                  </span>
                  {agent.duty?.trim() ? (
                    <span className="mt-0.5 block truncate text-[10.5px] text-ink-faint">
                      {agent.duty}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[10px] text-ink-faint">{agent.id}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
