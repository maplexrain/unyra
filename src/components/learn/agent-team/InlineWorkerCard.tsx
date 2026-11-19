/**
 * 紧凑单行工单任务条 (InlineWorkerCard)
 *
 * 铁律：
 * 1. 绝对禁止在对话流中直接内嵌长篇 Markdown 正文或工具卡片，消息流永远清爽不淹没；
 * 2. 正常状态纯粹为 1 行紧凑条：状态点 + 工单标题 + 单行摘要 (line-clamp-1) + [中止] + [查看正文 →]；
 * 3. 仅在 waiting_input 挂起时，紧贴下方展开单行提问与快捷唤醒输入框。
 */

import { memo, useState } from 'react'
import { ArrowRight, Clock, StopCircle } from 'lucide-react'
import type { WorkerSession } from '../../../agent/super/types'
import type { WorkerStreamSlot } from '../../../learn/superAgent/useAgentTeam'
import { t } from '../../../i18n'

export interface InlineWorkerCardProps {
  worker: WorkerSession
  streamSlot?: WorkerStreamSlot
  onSendToWorker: (workerId: string, text: string) => void
  onCancelWorker: (workerId: string) => void
  onOpenWorkerPane: (workerId: string) => void
}

export const InlineWorkerCard = memo(function InlineWorkerCard({
  worker,
  streamSlot,
  onSendToWorker,
  onCancelWorker,
  onOpenWorkerPane,
}: InlineWorkerCardProps) {
  const [quickInput, setQuickInput] = useState('')

  const isRunning = worker.status === 'running'
  const isWaitingInput = worker.status === 'waiting_input'
  const isDone = worker.status === 'done'
  const isFailed = worker.status === 'failed'

  // 单行摘要
  const summary =
    streamSlot?.chat?.slice(0, 80) ||
    worker.chatText?.slice(0, 80) ||
    worker.goal ||
    ''

  const handleSendQuickInput = () => {
    const text = quickInput.trim()
    if (!text) return
    onSendToWorker(worker.id, text)
    setQuickInput('')
  }

  return (
    <div className="rounded-xl border border-line/80 bg-card/90 shadow-2xs overflow-hidden my-2 transition-all text-[12px]">
      {/* 单行紧凑主体 */}
      <div className="px-3 py-2 flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* 状态指示点 */}
          {isRunning ? (
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          ) : isWaitingInput ? (
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping shrink-0" />
          ) : isDone ? (
            <span className="w-2 h-2 rounded-full bg-emerald-500/80 shrink-0" />
          ) : isFailed ? (
            <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-ink-faint/40 shrink-0" />
          )}

          <span className="font-semibold text-ink-strong truncate shrink-0 max-w-[140px]">
            {worker.title}
          </span>
          <span className="text-ink-faint text-[11px] truncate flex-1 hidden sm:inline">
            · {summary}
          </span>
        </div>

        {/* 右侧动作 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {(isRunning || isWaitingInput) && (
            <button
              type="button"
              onClick={() => onCancelWorker(worker.id)}
              className="p-1 rounded-md text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
              title={t('中止此工单')}
            >
              <StopCircle size={13} />
            </button>
          )}

          <button
            type="button"
            onClick={() => onOpenWorkerPane(worker.id)}
            className="flex items-center gap-1 px-2 py-0.8 rounded-lg text-[11px] font-semibold text-seal hover:bg-seal/10 transition cursor-pointer"
          >
            <span>{t('查看正文')}</span>
            <ArrowRight size={11} />
          </button>
        </div>
      </div>

      {/* 唯一内联展开：等待输入时的提问与单行回复 */}
      {isWaitingInput && (
        <div className="px-3 py-2 bg-amber-500/8 border-t border-amber-500/20 space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300 font-medium">
            <Clock size={12} className="shrink-0" />
            <span className="truncate">{worker.waitingPrompt || t('工单正在等待你的指示...')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={quickInput}
              onChange={(e) => setQuickInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendQuickInput()}
              placeholder={t('直接输入回复唤醒工单... (Enter 发送)')}
              className="flex-1 px-2.5 py-1 rounded-lg text-[11.5px] bg-paper border border-amber-500/30 text-ink placeholder:text-ink-faint focus:outline-none focus:border-amber-500"
            />
            <button
              type="button"
              onClick={handleSendQuickInput}
              disabled={!quickInput.trim()}
              className="px-2.5 py-1 rounded-lg bg-amber-500 text-white text-[11px] font-semibold hover:bg-amber-600 disabled:opacity-40 transition cursor-pointer shrink-0"
            >
              {t('回复')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
})
