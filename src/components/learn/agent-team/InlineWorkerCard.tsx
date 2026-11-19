/**
 * 内嵌工单卡片 (InlineWorkerCard)
 *
 * 核心设计：
 * 1. 零跳转就地查看：内嵌在 Frontline Host 对话流中，实时呈现 Worker 的执行进度与 Chat 正文直出；
 * 2. 状态驱动控制：运行中可就地中止，waiting_input 挂起时就地提供输入框直连唤醒；
 * 3. Mind / Chat 双层分流：思考与工具调用默认折叠，面向人类的正文直接呈现；
 * 4. 深度衔接：随时可点击右上角「展开详情 ↗」进入全屏 SuperWorkerPane。
 */

import { memo, useMemo, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  StopCircle,
  Wrench,
  XCircle,
  Zap,
} from 'lucide-react'
import type { WorkerSession, WorkerStatus } from '../../../agent/super/types'
import type { WorkerStreamSlot } from '../../../learn/superAgent/useAgentTeam'
import { extractMindParts } from '../../../agent/super/projection'
import MarkdownView from '../../MarkdownView'
import { renderNote } from '../../../lib/markdown'
import { ToolCard } from '../../agent/panel/ToolCard'
import { t } from '../../../i18n'

export interface InlineWorkerCardProps {
  worker: WorkerSession
  streamSlot?: WorkerStreamSlot
  onSendToWorker: (workerId: string, text: string) => void
  onCancelWorker: (workerId: string) => void
  onOpenWorkerPane: (workerId: string) => void
}

function StatusIndicator({ status }: { status: WorkerStatus }) {
  switch (status) {
    case 'running':
      return (
        <span className="flex items-center gap-1 text-amber-500 font-semibold text-[11px]">
          <Loader2 size={12} className="animate-spin" />
          <span>{t('运行中')}</span>
        </span>
      )
    case 'waiting_input':
      return (
        <span className="flex items-center gap-1 text-sky-500 font-semibold text-[11px]">
          <Clock size={12} />
          <span>{t('等待回复')}</span>
        </span>
      )
    case 'done':
      return (
        <span className="flex items-center gap-1 text-emerald-500 font-semibold text-[11px]">
          <CheckCircle2 size={12} />
          <span>{t('已交付')}</span>
        </span>
      )
    case 'failed':
      return (
        <span className="flex items-center gap-1 text-rose-500 font-semibold text-[11px]">
          <XCircle size={12} />
          <span>{t('失败')}</span>
        </span>
      )
    case 'cancelled':
      return (
        <span className="flex items-center gap-1 text-ink-faint text-[11px]">
          <StopCircle size={12} />
          <span>{t('已中止')}</span>
        </span>
      )
    default:
      return null
  }
}

export const InlineWorkerCard = memo(function InlineWorkerCard({
  worker,
  streamSlot,
  onSendToWorker,
  onCancelWorker,
  onOpenWorkerPane,
}: InlineWorkerCardProps) {
  const [mindExpanded, setMindExpanded] = useState(false)
  const [quickInput, setQuickInput] = useState('')

  // 聚合历史与当前流式的 mind 片段
  const mindParts = useMemo(() => {
    const historicalParts = worker.messages.flatMap((m) => m.parts)
    const baseMind = extractMindParts(historicalParts)
    if (streamSlot?.mind.length) {
      return [...baseMind, ...streamSlot.mind]
    }
    return baseMind
  }, [worker.messages, streamSlot?.mind])

  // 当前实时正文
  const currentChat = streamSlot?.chat || worker.chatText || ''

  const isRunning = worker.status === 'running'
  const isWaitingInput = worker.status === 'waiting_input'

  const handleSendQuickInput = () => {
    const text = quickInput.trim()
    if (!text) return
    onSendToWorker(worker.id, text)
    setQuickInput('')
  }

  return (
    <div className="rounded-2xl border border-line/80 bg-card/95 shadow-xs overflow-hidden my-2.5 transition-all">
      {/* 卡片顶栏 */}
      <div className="px-3.5 py-2.5 bg-paper-deep/50 border-b border-line/60 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-paper border border-line flex items-center justify-center shrink-0 text-ink-subtle">
            <Zap size={12} className={isRunning ? 'text-amber-500 animate-pulse' : ''} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] font-bold text-ink-strong truncate">
                {worker.title}
              </span>
              <StatusIndicator status={worker.status} />
            </div>
            <span className="text-[10px] text-ink-faint truncate block max-w-md">
              {t('工单目标: {0}', worker.goal)}
            </span>
          </div>
        </div>

        {/* 右侧动作 */}
        <div className="flex items-center gap-1 shrink-0">
          {(isRunning || isWaitingInput) && (
            <button
              type="button"
              onClick={() => onCancelWorker(worker.id)}
              className="px-2 py-0.5 rounded-lg text-[10.5px] font-medium text-rose-600 hover:bg-rose-500/10 transition cursor-pointer"
              title={t('中止此工单')}
            >
              {t('中止')}
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenWorkerPane(worker.id)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-seal hover:bg-seal/10 transition cursor-pointer"
            title={t('展开工单全屏面板')}
          >
            <span>{t('展开详情')}</span>
            <ExternalLink size={10} />
          </button>
        </div>
      </div>

      {/* waiting_input 挂起提示与快速回复框 */}
      {isWaitingInput && (
        <div className="p-3 bg-sky-500/8 border-b border-sky-500/20 space-y-2">
          <div className="flex items-start gap-1.5 text-[11.5px] text-sky-700 dark:text-sky-300">
            <Clock size={13} className="shrink-0 mt-0.5" />
            <div className="font-medium leading-relaxed">
              {worker.waitingPrompt || t('工单正在等待你的指示或补充信息...')}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={quickInput}
              onChange={(e) => setQuickInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendQuickInput()}
              placeholder={t('直接在此输入回复以唤醒工单继续运行...')}
              className="flex-1 px-3 py-1.5 rounded-xl text-[12px] bg-paper border border-sky-500/30 text-ink placeholder:text-ink-faint focus:outline-none focus:border-sky-500"
            />
            <button
              type="button"
              onClick={handleSendQuickInput}
              disabled={!quickInput.trim()}
              className="px-3 py-1.5 rounded-xl bg-sky-500 text-white text-[11.5px] font-semibold hover:bg-sky-600 disabled:opacity-40 transition cursor-pointer shrink-0"
            >
              {t('回复')}
            </button>
          </div>
        </div>
      )}

      {/* Mind 过程折叠区 */}
      {mindParts.length > 0 && (
        <div className="border-b border-line/40">
          <button
            type="button"
            onClick={() => setMindExpanded((prev) => !prev)}
            className="w-full px-3.5 py-1.5 flex items-center justify-between text-[11px] text-ink-faint hover:text-ink hover:bg-line/20 transition cursor-pointer"
          >
            <span className="flex items-center gap-1.5 font-medium">
              <Wrench size={11} className="text-amber-500/80" />
              <span>{t('思考与工具执行过程 ({0})', mindParts.length)}</span>
            </span>
            {mindExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>

          {mindExpanded && (
            <div className="p-3 bg-paper-deep/30 space-y-2 max-h-48 overflow-y-auto border-t border-line/30 text-[11.5px]">
              {mindParts.map((part, idx) => {
                if (part.type === 'thinking') {
                  return (
                    <div
                      key={idx}
                      className="p-2 rounded-lg bg-paper/80 border border-line text-ink-subtle italic text-[11px] leading-relaxed"
                    >
                      {part.text}
                    </div>
                  )
                }
                if (part.type === 'tool') {
                  return <ToolCard key={idx} part={part} />
                }
                return null
              })}
            </div>
          )}
        </div>
      )}

      {/* Chat 面向人类的正文直出区 */}
      <div className="p-3.5">
        {currentChat.trim() ? (
          <div className="max-h-56 overflow-y-auto text-[12.5px] leading-relaxed text-ink prose-sm">
            <MarkdownView html={renderNote(currentChat)} className="moji-agent-md" />
          </div>
        ) : isRunning ? (
          <div className="flex items-center gap-2 py-4 text-ink-faint text-[12px] italic">
            <Loader2 size={13} className="animate-spin text-amber-500" />
            <span>{t('正在后台工坊探索与撰写成果...')}</span>
          </div>
        ) : (
          <div className="text-[12px] text-ink-faint italic py-2">
            {t('工单已结束，未产出独立正文。')}
          </div>
        )}

        {/* 产物徽标 */}
        {worker.artifacts.length > 0 && (
          <div className="mt-2.5 pt-2 border-t border-line/40 flex items-center gap-2 overflow-x-auto text-[10.5px]">
            <span className="text-ink-faint shrink-0 flex items-center gap-1">
              <FileText size={11} className="text-seal" />
              <span>{t('产物 ({0}):', worker.artifacts.length)}</span>
            </span>
            {worker.artifacts.map((art) => (
              <span
                key={art.id}
                className="px-2 py-0.5 rounded-md bg-seal/10 text-seal font-medium border border-seal/20 shrink-0"
              >
                {art.title}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
