/**
 * 前台主控视图 (SuperHostPane)
 *
 * 核心交互：
 * 1. 顶栏：总调度状态、活跃工单横条与清空会话；
 * 2. 对话流：
 *    - 用户气泡：调用 splitHostUserDisplay 隐藏协议头，保持气泡纯净，折叠展示回执摘要；
 *    - 主控回复：Brain 思考折叠、控制面工具调用卡片（支持一键跳转工单）、Markdown 正文；
 *    - 实时流式槽位（Streaming Slot）渲染；
 * 3. 底部快捷输入：Enter 发送，Shift+Enter 换行，支持调度中中止。
 */

import { memo, useEffect, useRef, useState } from 'react'
import {
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Inbox,
  Loader2,
  RotateCcw,
  Send,
  Square,
  Wrench,
} from 'lucide-react'
import type { ConversationMessage } from '../../../agent/types'
import type { HostStreamingSlot } from '../../../learn/superAgent/useSuperAgent'
import type { WorkerSession } from '../../../agent/super/types'
import { splitHostUserDisplay } from '../../../agent/super/projection'
import MarkdownView from '../../MarkdownView'
import { renderNote } from '../../../lib/markdown'
import { t } from '../../../i18n'

export interface SuperHostPaneProps {
  messages: ConversationMessage[]
  streaming: HostStreamingSlot | null
  isRunning: boolean
  mailboxCount: number
  activeWorkers: WorkerSession[]
  onSendMessage: (text: string) => void
  onStopHost: () => void
  onReset: () => void
  onSelectWorker: (workerId: string) => void
  goalTitle?: string
}

function extractMessageText(m: ConversationMessage): string {
  if (!m.parts || m.parts.length === 0) return ''
  return m.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
}

export const SuperHostPane = memo(function SuperHostPane({
  messages,
  streaming,
  isRunning,
  mailboxCount,
  activeWorkers,
  onSendMessage,
  onStopHost,
  onReset,
  onSelectWorker,
  goalTitle,
}: SuperHostPaneProps) {
  const [inputText, setInputText] = useState('')
  const [showConfirmReset, setShowConfirmReset] = useState(false)
  const [expandedMailboxes, setExpandedMailboxes] = useState<Record<string, boolean>>({})
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({})
  const [streamThinkingOpen, setStreamThinkingOpen] = useState(true)

  const scrollBottomRef = useRef<HTMLDivElement | null>(null)

  // 消息变化时自动触底滚动
  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  const handleSend = () => {
    const trimmed = inputText.trim()
    if (!trimmed || isRunning) return
    onSendMessage(trimmed)
    setInputText('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 提取工具调用中的目标 WorkerId 以供一键跳转
  const extractWorkerId = (_toolName: string, argsStr: string, resultStr: string): string | null => {
    try {
      const parsedRes = JSON.parse(resultStr)
      if (parsedRes.workerId) return String(parsedRes.workerId)
    } catch {}
    try {
      const parsedArgs = JSON.parse(argsStr)
      if (parsedArgs.workerId) return String(parsedArgs.workerId)
    } catch {}
    const match = /w-[a-z0-9]+/i.exec(resultStr)
    return match ? match[0] : null
  }

  return (
    <div className="flex flex-col h-full w-full bg-paper select-text overflow-hidden">
      {/* 顶栏：标题与活跃状态 */}
      <div className="px-5 py-3 border-b border-line/60 bg-paper/80 backdrop-blur-xs flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-seal/15 text-seal flex items-center justify-center shrink-0">
            <Bot size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold text-ink-strong truncate">
                {t('前台总调度 (Frontline Host)')}
              </span>
              <span
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                  isRunning
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {isRunning ? (
                  <>
                    <Loader2 size={10} className="animate-spin" />
                    <span>{t('调度中')}</span>
                  </>
                ) : (
                  <span>{t('就绪')}</span>
                )}
              </span>
            </div>
            <div className="text-[11.5px] text-ink-faint truncate">
              {goalTitle ? `${goalTitle} · ` : ''}
              {t('永不阻塞 · 秒级分单 · 自动聚合')}
            </div>
          </div>
        </div>

        {/* 顶部操作区 */}
        <div className="flex items-center gap-2 shrink-0">
          {showConfirmReset ? (
            <div className="flex items-center gap-1.5 bg-card px-2 py-1 rounded-xl border border-line shadow-xs">
              <span className="text-[11px] text-rose-500 font-medium">{t('确认清空？')}</span>
              <button
                type="button"
                onClick={() => {
                  onReset()
                  setShowConfirmReset(false)
                }}
                className="text-[11px] px-2 py-0.5 bg-rose-500 text-white rounded-md hover:bg-rose-600 cursor-pointer"
              >
                {t('清空')}
              </button>
              <button
                type="button"
                onClick={() => setShowConfirmReset(false)}
                className="text-[11px] px-2 py-0.5 text-ink-faint hover:text-ink cursor-pointer"
              >
                {t('取消')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowConfirmReset(true)}
              title={t('清空工作台记录与会话')}
              className="p-1.5 text-ink-faint hover:text-ink rounded-lg hover:bg-line/40 transition cursor-pointer"
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 活跃工单胶囊栏（如有正在运行的工单） */}
      {activeWorkers.length > 0 && (
        <div className="px-5 py-2 bg-amber-500/5 border-b border-amber-500/15 flex items-center gap-2 overflow-x-auto shrink-0">
          <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 shrink-0 flex items-center gap-1">
            <Loader2 size={11} className="animate-spin" />
            <span>{t('后台运行中')}:</span>
          </span>
          <div className="flex items-center gap-1.5 flex-1 overflow-x-auto no-scrollbar">
            {activeWorkers.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => onSelectWorker(w.id)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-paper border border-amber-500/20 text-[11.5px] text-ink-soft hover:text-seal hover:border-seal/30 transition shadow-2xs shrink-0 cursor-pointer"
              >
                <span className="truncate max-w-[140px] font-medium">{w.title}</span>
                <ExternalLink size={10} className="text-ink-faint" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 主对话流区域 */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {messages.length === 0 && !streaming && (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 select-none">
            <div className="w-14 h-14 rounded-2xl bg-seal/10 text-seal flex items-center justify-center mb-3">
              <Bot size={26} />
            </div>
            <h4 className="text-[15px] font-bold text-ink-strong mb-1">
              {t('前台总调度准备就绪')}
            </h4>
            <p className="max-w-md text-[12px] text-ink-faint leading-relaxed">
              {t(
                '向总调度发送复杂任务，总调度会通过控制原语秒级派发后台工单，并在工单完成时于下轮对话自动携带成果汇报。',
              )}
            </p>
          </div>
        )}

        {messages.map((m) => {
          if (m.role === 'user') {
            const rawText = extractMessageText(m)
            const parsed = splitHostUserDisplay(rawText)
            const isMailboxExpanded = expandedMailboxes[m.id] ?? false

            return (
              <div key={m.id} className="flex flex-col items-end space-y-1">
                {/* 隐藏协议头的轻量展开条 */}
                {parsed.mailboxHeader && (
                  <div className="max-w-[85%] text-[11px] mb-0.5">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedMailboxes((prev) => ({ ...prev, [m.id]: !isMailboxExpanded }))
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300 font-medium hover:bg-amber-500/20 transition cursor-pointer"
                    >
                      <Inbox size={11} />
                      <span>{t('已携带')} {parsed.mailboxCount} {t('条后台成果回执')}</span>
                      {isMailboxExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    </button>
                    {isMailboxExpanded && (
                      <div className="mt-1 p-2 bg-card rounded-lg border border-line text-[11px] text-ink-soft whitespace-pre-wrap leading-relaxed shadow-2xs font-mono">
                        {parsed.mailboxHeader}
                      </div>
                    )}
                  </div>
                )}

                {/* 纯净用户消息气泡 */}
                <div className="max-w-[80%] rounded-2xl px-4 py-2.5 bg-seal text-white text-[13.5px] leading-relaxed shadow-xs break-words">
                  {parsed.userText}
                </div>
              </div>
            )
          }

          if (m.role === 'assistant') {
            const parts = m.parts || []
            const isThinkingExpanded = expandedThinking[m.id] ?? false

            return (
              <div key={m.id} className="flex items-start gap-3 max-w-[90%]">
                <div className="w-7 h-7 rounded-lg bg-seal/15 text-seal flex items-center justify-center shrink-0 mt-0.5">
                  <Bot size={15} />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  {parts.map((p, pIdx) => {
                    if (p.type === 'thinking') {
                      return (
                        <div key={pIdx} className="border-l-2 border-line/80 pl-2.5 py-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedThinking((prev) => ({
                                ...prev,
                                [m.id]: !isThinkingExpanded,
                              }))
                            }
                            className="flex items-center gap-1.5 text-[11px] font-medium text-ink-faint hover:text-ink cursor-pointer"
                          >
                            <Brain size={12} />
                            <span>{t('深度思考')}</span>
                            {isThinkingExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                          </button>
                          {isThinkingExpanded && (
                            <div className="mt-1.5 text-[12px] text-ink-faint leading-relaxed whitespace-pre-wrap font-mono bg-card/40 p-2.5 rounded-lg border border-line/50">
                              {p.text}
                            </div>
                          )}
                        </div>
                      )
                    }

                    if (p.type === 'tool') {
                      const targetWorkerId = extractWorkerId(p.name, p.args, p.result)
                      return (
                        <div
                          key={pIdx}
                          className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-card border border-line/60 text-[12px] shadow-2xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Wrench size={13} className="text-seal shrink-0" />
                            <span className="font-semibold text-ink-strong">{p.name}</span>
                            <span className="text-ink-faint truncate max-w-[260px] text-[11.5px]">
                              {p.result || p.args}
                            </span>
                          </div>
                          {targetWorkerId && (
                            <button
                              type="button"
                              onClick={() => onSelectWorker(targetWorkerId)}
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-seal hover:underline shrink-0 cursor-pointer"
                            >
                              <span>{t('查看工单')}</span>
                              <ExternalLink size={10} />
                            </button>
                          )}
                        </div>
                      )
                    }

                    if (p.type === 'text') {
                      return (
                        <div key={pIdx} className="text-[13.5px] text-ink leading-relaxed">
                          <MarkdownView html={renderNote(p.text)} />
                        </div>
                      )
                    }

                    return null
                  })}
                </div>
              </div>
            )
          }

          return null
        })}

        {/* 实时流式响应槽位 (Streaming Slot) */}
        {streaming && (
          <div className="flex items-start gap-3 max-w-[90%]">
            <div className="w-7 h-7 rounded-lg bg-seal/15 text-seal flex items-center justify-center shrink-0 mt-0.5">
              <Bot size={15} />
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              {streaming.thinking && (
                <div className="border-l-2 border-line/80 pl-2.5 py-0.5">
                  <button
                    type="button"
                    onClick={() => setStreamThinkingOpen((v) => !v)}
                    className="flex items-center gap-1.5 text-[11px] font-medium text-amber-500 cursor-pointer"
                  >
                    <Brain size={12} className="animate-pulse" />
                    <span>{t('正在思考...')}</span>
                    {streamThinkingOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  </button>
                  {streamThinkingOpen && (
                    <div className="mt-1.5 text-[12px] text-ink-faint leading-relaxed whitespace-pre-wrap font-mono bg-card/40 p-2.5 rounded-lg border border-line/50">
                      {streaming.thinking}
                    </div>
                  )}
                </div>
              )}

              {streaming.activeTool && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11.5px] text-amber-600 dark:text-amber-400 animate-pulse">
                  <Loader2 size={12} className="animate-spin" />
                  <span>{t('执行控制原语')}: {streaming.activeTool}...</span>
                </div>
              )}

              {streaming.text && (
                <div className="text-[13.5px] text-ink leading-relaxed">
                  <MarkdownView html={renderNote(streaming.text)} />
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={scrollBottomRef} />
      </div>

      {/* 底部输入框区 */}
      <div className="p-3 border-t border-line/60 bg-paper/80 backdrop-blur-xs shrink-0">
        <div className="relative flex flex-col rounded-2xl bg-card border border-line focus-within:border-seal/60 focus-within:ring-1 focus-within:ring-seal/30 transition shadow-xs">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mailboxCount > 0
                ? `${t('发送消息（将自动携带')} ${mailboxCount} ${t('条后台工单成果回执）...')}`
                : t('向总调度派发任务、询问各工单进展，或直接对话...')
            }
            rows={2}
            className="w-full resize-none p-3 pb-8 text-[13px] bg-transparent outline-none text-ink placeholder:text-ink-faint leading-relaxed"
          />

          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
            {isRunning ? (
              <button
                type="button"
                onClick={onStopHost}
                title={t('中止当前调度')}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 hover:bg-rose-500/25 text-[12px] font-semibold transition cursor-pointer"
              >
                <Square size={12} className="fill-current" />
                <span>{t('中止')}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={!inputText.trim()}
                title={t('发送 (Enter)')}
                className={`p-1.5 rounded-xl transition cursor-pointer ${
                  inputText.trim()
                    ? 'bg-seal text-white hover:bg-seal-deep shadow-xs'
                    : 'bg-line/60 text-ink-faint cursor-not-allowed'
                }`}
              >
                <Send size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="mt-1.5 px-1 flex items-center justify-between text-[11px] text-ink-faint">
          <span>{t('Enter 发送 · Shift+Enter 换行')}</span>
          {mailboxCount > 0 && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
              <Inbox size={10} />
              <span>{mailboxCount} {t('条待合并回执')}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  )
})
