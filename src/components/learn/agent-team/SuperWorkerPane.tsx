/**
 * 隔离工单详情视口 (SuperWorkerPane)
 *
 * 核心设计：
 * 1. Mind / Chat 双层结构：
 *    - Mind 过程区（思考链 + 工具调用）：按需折叠，避免技术噪音干扰；
 *    - Chat 正文交付区：零拷贝直出至前端，大面积素面呈现最终成果与 Artifacts；
 * 2. 直连快通道：
 *    - 底部输入框通过 sendToWorker 直接向该 Worker 跳边界插队，完全绕过 Host；
 * 3. 悬停状态与一键中止控制。
 */

import { memo, useMemo, useState, useRef, useEffect } from 'react'
import {
  ArrowLeft,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  FileText,
  Loader2,
  Send,
  StopCircle,
  Wrench,
  XCircle,
  Zap,
} from 'lucide-react'
import type { WorkerSession, WorkerStatus } from '../../../agent/super/types'
import type { WorkerStreamSlot } from '../../../learn/superAgent/useAgentTeam'
import { extractChatText, extractMindParts } from '../../../agent/super/projection'
import MarkdownView from '../../MarkdownView'
import { renderNote } from '../../../lib/markdown'
import { t } from '../../../i18n'

export interface SuperWorkerPaneProps {
  worker: WorkerSession
  streamSlot?: WorkerStreamSlot
  onBackToHost: () => void
  onSendToWorker: (workerId: string, text: string) => void
  onCancelWorker: (workerId: string) => void
}

function StatusBadge({ status }: { status: WorkerStatus }) {
  switch (status) {
    case 'running':
      return (
        <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[11px] font-semibold">
          <Loader2 size={11} className="animate-spin" />
          <span>{t('运行中')}</span>
        </span>
      )
    case 'waiting_input':
      return (
        <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-400 text-[11px] font-semibold">
          <Clock size={11} />
          <span>{t('等待插队/输入')}</span>
        </span>
      )
    case 'done':
      return (
        <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold">
          <CheckCircle2 size={11} />
          <span>{t('已完成交付')}</span>
        </span>
      )
    case 'failed':
      return (
        <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[11px] font-semibold">
          <XCircle size={11} />
          <span>{t('执行失败')}</span>
        </span>
      )
    case 'cancelled':
      return (
        <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-line text-ink-faint text-[11px] font-semibold">
          <StopCircle size={11} />
          <span>{t('已中止')}</span>
        </span>
      )
    default:
      return null
  }
}

export const SuperWorkerPane = memo(function SuperWorkerPane({
  worker,
  streamSlot,
  onBackToHost,
  onSendToWorker,
  onCancelWorker,
}: SuperWorkerPaneProps) {
  const [inputText, setInputText] = useState('')
  const [isMindOpen, setIsMindOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const isRunning = worker.status === 'running'

  // 展平所有历史消息中的 parts
  const allParts = useMemo(
    () => (worker.messages || []).flatMap((m) => m.parts || []),
    [worker.messages],
  )

  // 合并静态 parts 与实时流式 mind
  const mindParts = useMemo(() => {
    const staticMind = extractMindParts(allParts)
    if (streamSlot?.mind && streamSlot.mind.length > 0) {
      return [...staticMind, ...streamSlot.mind]
    }
    return staticMind
  }, [allParts, streamSlot?.mind])

  // 合并交付正文与实时流式正文
  const fullChatText = useMemo(() => {
    const staticChat = worker.chatText || extractChatText(allParts)
    if (streamSlot?.chat) {
      return staticChat ? `${staticChat}\n\n${streamSlot.chat}` : streamSlot.chat
    }
    return staticChat
  }, [worker.chatText, allParts, streamSlot?.chat])

  // 消息更新滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [fullChatText, streamSlot])

  const handleSend = () => {
    const trimmed = inputText.trim()
    if (!trimmed) return
    onSendToWorker(worker.id, trimmed)
    setInputText('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  return (
    <div className="flex flex-col h-full w-full bg-paper select-text overflow-hidden">
      {/* 顶栏 */}
      <div className="px-5 py-3 border-b border-line/60 bg-paper/80 backdrop-blur-xs flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackToHost}
            className="p-1.5 -ml-1 text-ink-faint hover:text-seal rounded-lg hover:bg-line/40 transition cursor-pointer"
            title={t('返回前台主控')}
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold text-ink-strong truncate">
                {worker.title}
              </span>
              <StatusBadge status={worker.status} />
            </div>
            <div className="text-[11.5px] text-ink-faint truncate" title={worker.goal}>
              {worker.goal}
            </div>
          </div>
        </div>

        {isRunning && (
          <button
            type="button"
            onClick={() => onCancelWorker(worker.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 text-[12px] font-semibold transition cursor-pointer shrink-0"
          >
            <StopCircle size={13} />
            <span>{t('中止工单')}</span>
          </button>
        )}
      </div>

      {/* 主展示区 */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {/* waiting_input 挂起提示横幅 */}
        {worker.status === 'waiting_input' && (
          <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-start gap-3 shadow-xs">
            <Clock size={18} className="text-sky-600 dark:text-sky-400 shrink-0 mt-0.5 animate-pulse" />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-bold text-sky-700 dark:text-sky-300">
                {t('工单已挂起，等待您的指示/回答')}
              </div>
              <div className="text-[13px] text-ink-strong mt-1 font-medium leading-relaxed">
                {worker.waitingPrompt || t('Worker 请求补充关键信息')}
              </div>
              <div className="text-[11.5px] text-ink-faint mt-1">
                {t('请直接在下方输入框回复，工单将自动恢复执行（不唤醒前台主控）')}
              </div>
            </div>
          </div>
        )}

        {/* Mind 过程折叠区 */}
        {mindParts.length > 0 && (
          <div className="rounded-2xl border border-line/60 bg-card/40 overflow-hidden shadow-2xs">
            <button
              type="button"
              onClick={() => setIsMindOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left bg-card hover:bg-line/20 transition cursor-pointer"
            >
              <div className="flex items-center gap-2 text-[12px] font-semibold text-ink-soft">
                <Brain size={14} className="text-seal" />
                <span>{t('执行过程 (Mind)')}</span>
                <span className="text-[10.5px] bg-line/60 text-ink-faint px-1.5 py-0.2 rounded-full font-normal">
                  {mindParts.length} {t('项动作')}
                </span>
                {isRunning && (
                  <span className="flex items-center gap-1 text-[11px] text-amber-500 font-normal">
                    <Loader2 size={10} className="animate-spin" />
                    <span>{t('实时推演中...')}</span>
                  </span>
                )}
              </div>
              {isMindOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>

            {isMindOpen && (
              <div className="p-4 space-y-3 border-t border-line/40 max-h-80 overflow-y-auto font-mono text-[11.5px]">
                {mindParts.map((p, idx) => {
                  if (p.type === 'thinking') {
                    return (
                      <div key={idx} className="bg-paper p-2.5 rounded-xl border border-line/40 text-ink-faint leading-relaxed whitespace-pre-wrap">
                        {p.text}
                      </div>
                    )
                  }
                  if (p.type === 'tool') {
                    return (
                      <div key={idx} className="bg-paper p-2.5 rounded-xl border border-line/40 space-y-1">
                        <div className="flex items-center justify-between text-ink-strong font-medium">
                          <span className="flex items-center gap-1.5 text-seal">
                            <Wrench size={12} />
                            <span>{p.name}</span>
                          </span>
                          <span className="text-[10px] text-ink-faint">
                            {p.status === 'running' ? t('执行中') : p.ok ? t('成功') : t('异常')}
                          </span>
                        </div>
                        {p.result && (
                          <div className="text-ink-faint text-[11px] truncate">{p.result}</div>
                        )}
                      </div>
                    )
                  }
                  return null
                })}
              </div>
            )}
          </div>
        )}

        {/* Chat 交付正文区 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-line/40 pb-2">
            <span className="text-[12px] font-bold text-ink-faint uppercase tracking-wider">
              {t('交付成果 (Delivery)')}
            </span>
            {fullChatText && (
              <button
                type="button"
                onClick={() => handleCopy(fullChatText, 'chat-text')}
                className="inline-flex items-center gap-1 text-[11px] text-ink-faint hover:text-seal transition cursor-pointer"
              >
                <Copy size={11} />
                <span>{copiedId === 'chat-text' ? t('已复制') : t('复制正文')}</span>
              </button>
            )}
          </div>

          {fullChatText ? (
            <div className="text-[14px] text-ink leading-relaxed">
              <MarkdownView html={renderNote(fullChatText)} />
            </div>
          ) : (
            <div className="p-8 text-center text-ink-faint text-[13px] leading-relaxed">
              {isRunning ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 size={20} className="animate-spin text-amber-500" />
                  <span>{t('工单正在全力执行，正文将零拷贝流式呈现在此...')}</span>
                </div>
              ) : (
                <span>{t('此工单暂无交付正文')}</span>
              )}
            </div>
          )}
        </div>

        {/* Artifacts 产物展示区 */}
        {worker.artifacts && worker.artifacts.length > 0 && (
          <div className="space-y-3 pt-4 border-t border-line/40">
            <div className="text-[12px] font-bold text-ink-faint uppercase tracking-wider">
              {t('沉淀产物 (Artifacts)')}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {worker.artifacts.map((art) => (
                <div
                  key={art.id}
                  className="flex items-start justify-between gap-3 p-3 rounded-xl bg-card border border-line/60 shadow-2xs hover:border-seal/40 transition"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <FileText size={13} className="text-seal shrink-0" />
                      <span className="text-[12.5px] font-semibold text-ink-strong truncate">
                        {art.title}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-line/60 text-ink-faint uppercase font-mono">
                        {art.kind}
                      </span>
                    </div>
                    {art.content && (
                      <p className="text-[11.5px] text-ink-faint mt-1 line-clamp-2 font-mono">
                        {art.content}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      {/* 底部：直连快通道 */}
      <div className="p-3 border-t border-line/60 bg-paper/80 backdrop-blur-xs shrink-0">
        <div
          className={`relative flex flex-col rounded-2xl bg-card border transition shadow-xs ${
            worker.status === 'waiting_input'
              ? 'border-sky-500/60 ring-1 ring-sky-500/30'
              : 'border-line focus-within:border-seal/60 focus-within:ring-1 focus-within:ring-seal/30'
          }`}
        >
          <div className="px-3 pt-2 flex items-center gap-1.5 text-[11px] font-semibold text-sky-600 dark:text-sky-400">
            <Zap size={11} />
            <span>{t('直连快通道（直接插队投递，不唤醒前台主控）')}</span>
          </div>

          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              worker.status === 'waiting_input'
                ? t('输入您的回答，按 Enter 唤醒 Worker 继续执行...')
                : t('向该 Worker 补充要求、纠正方向或直接追问...')
            }
            rows={2}
            className="w-full resize-none p-3 pb-8 text-[13px] bg-transparent outline-none text-ink placeholder:text-ink-faint leading-relaxed"
          />

          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleSend}
              disabled={!inputText.trim()}
              title={t('直接投递给 Worker')}
              className={`p-1.5 rounded-xl transition cursor-pointer ${
                inputText.trim()
                  ? 'bg-seal text-white hover:bg-seal-deep shadow-xs'
                  : 'bg-line/60 text-ink-faint cursor-not-allowed'
              }`}
            >
              <Send size={14} />
            </button>
          </div>
        </div>

        <div className="mt-1.5 px-1 flex items-center justify-between text-[11px] text-ink-faint">
          <span>{t('Enter 投递 · Shift+Enter 换行')}</span>
          <span>{t('跳边界安全注入 · 100% 遵守缓存门禁')}</span>
        </div>
      </div>
    </div>
  )
})
