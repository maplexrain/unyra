/**
 * 协作频道视口 (TeamChannelPane)
 *
 * 核心设计：
 * 1. 顶部极简进度：仅在有活跃委派时显示 1 行紧凑进度胶囊条；
 * 2. 消息流清爽纯净：
 *    - 用户消息与专家直答回复清爽呈现；
 *    - 协作工单结算仅显示 <=120 字精炼摘要 + [查看正文 →] 按钮，绝不铺陈长文！
 * 3. 点击 [查看正文 →] 直接拉出右侧 DeliverableDrawer 全幅检视，上下文永不中断。
 */

import { memo, useMemo, useState, useRef, useEffect } from 'react'
import {
  Sparkles,
  Send,
  Trash2,
  StopCircle,
  ArrowRight,
  Bot,
  Clock,
  CheckCircle2,
} from 'lucide-react'
import type {
  ChannelMessage,
  DelegationRecord,
  TeamAgentProfile,
} from '../../../agent/team/types'
import MarkdownView from '../../MarkdownView'
import { renderNote } from '../../../lib/markdown'
import { t } from '../../../i18n'

export interface TeamChannelPaneProps {
  messages: ChannelMessage[]
  delegations: Record<string, DelegationRecord>
  profiles: TeamAgentProfile[]
  onSendMessage: (text: string) => void
  onSelectAgent: (agentId: string) => void
  onViewWorker?: (agentId: string, workerId: string) => void
  onResetChannel: () => void
  onStopAll: () => void
}

export const TeamChannelPane = memo(function TeamChannelPane({
  messages,
  delegations,
  profiles,
  onSendMessage,
  onSelectAgent,
  onViewWorker,
  onResetChannel,
  onStopAll,
}: TeamChannelPaneProps) {
  const [inputText, setInputText] = useState('')
  const streamBottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const activeDelegations = useMemo(() => {
    return Object.values(delegations).filter((d) => d.status === 'running')
  }, [delegations])

  useEffect(() => {
    streamBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    const text = inputText.trim()
    if (!text) return
    onSendMessage(text)
    setInputText('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInsertMention = (profile: TeamAgentProfile) => {
    const mention = `@${profile.name} `
    setInputText((prev) => (prev ? `${prev} ${mention}` : mention))
    inputRef.current?.focus()
  }

  return (
    <div className="flex flex-col h-full w-full bg-paper overflow-hidden select-text">
      {/* 顶栏 */}
      <div className="px-4 py-2.5 border-b border-line/60 bg-paper-deep/30 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-indigo-500/15 text-indigo-500 flex items-center justify-center shrink-0">
            <Sparkles size={13} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[13px] font-bold text-ink-strong truncate">
              {t('协作频道')}
            </h2>
            <span className="text-[10px] text-ink-faint">
              {t('全员广播与多专家任务分流')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onStopAll}
            className="p-1 rounded-md text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
            title={t('中止所有专家运行')}
          >
            <StopCircle size={13} />
          </button>
          <button
            type="button"
            onClick={onResetChannel}
            className="p-1 rounded-md text-ink-faint hover:text-ink hover:bg-line/40 transition cursor-pointer"
            title={t('清空频道消息')}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* 仅在有活跃委派时展示极简进度条 */}
      {activeDelegations.length > 0 && (
        <div className="px-3.5 py-1.5 bg-amber-500/8 border-b border-amber-500/20 flex items-center gap-2 overflow-x-auto text-[11px] shrink-0">
          <Clock size={12} className="text-amber-500 shrink-0" />
          <span className="font-semibold text-amber-700 dark:text-amber-300 shrink-0">
            {t('{0} 项协作进行中:', activeDelegations.length)}
          </span>
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {activeDelegations.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => onSelectAgent(d.targetAgentId)}
                className="px-2 py-0.5 rounded-md bg-paper border border-amber-500/30 text-ink-subtle hover:text-seal text-[10.5px] truncate max-w-[180px] cursor-pointer"
              >
                {d.targetAgentName}: {d.task}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 消息流 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-ink-faint py-16 space-y-2">
            <Sparkles size={22} className="text-indigo-400 opacity-60" />
            <div className="text-[12.5px] font-semibold text-ink-strong">{t('智能体团队准备就绪')}</div>
            <p className="text-[11px] text-ink-faint max-w-sm leading-relaxed">
              {t('向协作频道发指令，总导师将自动规划；输入 @ 专家可精准分发。')}
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.senderId === 'user'
            const isDelCard = msg.delegationId !== undefined

            if (isUser) {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[75%] rounded-2xl rounded-tr-xs bg-seal/12 text-ink-strong border border-seal/20 px-3.5 py-2 shadow-2xs text-[12.5px]">
                    <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                  </div>
                </div>
              )
            }

            // 协作工单通知条（极简，绝不贴满长文）
            if (isDelCard) {
              const isDone = msg.content.includes('完成交付')
              return (
                <div key={msg.id} className="flex justify-start">
                  <div className="max-w-[85%] rounded-xl bg-card border border-line/80 px-3.5 py-2.5 shadow-2xs space-y-1.5 text-[12px]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5">
                        {isDone ? (
                          <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                        ) : (
                          <Clock size={13} className="text-amber-500 shrink-0" />
                        )}
                        <span className="font-bold text-ink-strong">
                          {isDone ? t('协作工单完成交付') : t('跨专家委派派发')}
                        </span>
                        <span className="text-[10px] text-ink-faint">({msg.senderName})</span>
                      </div>

                      {/* 查看正文直通按钮 */}
                      {isDone && onViewWorker && msg.refAgentId && (
                        <button
                          type="button"
                          onClick={() => onViewWorker(msg.refAgentId!, msg.refWorkerId || msg.delegationId!)}
                          className="flex items-center gap-1 text-[11px] font-semibold text-seal hover:underline cursor-pointer"
                        >
                          <span>{t('查看正文')}</span>
                          <ArrowRight size={10} />
                        </button>
                      )}
                    </div>
                    <div className="text-[11.5px] text-ink-subtle leading-relaxed line-clamp-2">
                      {msg.briefSummary || msg.content}
                    </div>
                  </div>
                </div>
              )
            }

            // 专家直答回复
            return (
              <div key={msg.id} className="flex justify-start gap-2 items-start">
                <div className="w-6 h-6 rounded-lg bg-paper-deep border border-line text-ink flex items-center justify-center shrink-0 text-[11px] mt-0.5">
                  <Bot size={13} />
                </div>
                <div className="max-w-[80%] space-y-1">
                  <div className="flex items-center gap-1.5 text-[10.5px]">
                    <span className="font-semibold text-ink-strong">{msg.senderName}</span>
                    {msg.isAnnouncement && (
                      <span className="px-1.5 py-0.2 rounded text-[8.5px] font-bold bg-line/80 text-ink-faint">
                        {t('公告')}
                      </span>
                    )}
                  </div>
                  <div className="rounded-2xl rounded-tl-xs bg-card border border-line/80 p-3 shadow-2xs text-[12.5px] text-ink leading-relaxed">
                    <MarkdownView html={renderNote(msg.content)} className="moji-agent-md" />
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={streamBottomRef} />
      </div>

      {/* 底部输入框 */}
      <div className="p-3 border-t border-line/60 bg-paper/90 backdrop-blur-md space-y-1.5 shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto text-[10px] pb-0.5">
          <span className="text-ink-faint shrink-0 flex items-center gap-0.5">
            <span className="font-bold text-indigo-500">@</span>
            <span>{t('指定专家:')}</span>
          </span>
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleInsertMention(p)}
              className="px-2 py-0.5 rounded-full bg-paper border border-line hover:border-seal/30 text-ink-subtle hover:text-seal transition cursor-pointer shrink-0"
            >
              @{p.name}
            </button>
          ))}
        </div>

        <div className="relative rounded-xl border border-line/80 bg-paper-deep/60 focus-within:border-seal/60 focus-within:ring-1 focus-within:ring-seal/20 transition">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder={t('在此发言由总导师协调，输入 @ 可指定专家处理... (⌘+Enter 发送)')}
            className="w-full p-2.5 pr-10 text-[12px] bg-transparent resize-none focus:outline-none placeholder:text-ink-faint text-ink leading-relaxed"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="absolute right-2 bottom-2 p-1.5 rounded-lg bg-seal text-white hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
            title={t('发送消息 (⌘+Enter)')}
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  )
})
