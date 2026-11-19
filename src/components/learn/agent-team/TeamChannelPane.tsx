/**
 * 协作频道视口 (TeamChannelPane)
 *
 * 核心功能：
 * 1. 顶栏委派进度胶囊条：实时展示进行中的跨专家工单，一键跳转到对应专家视口；
 * 2. 协作广播流：区分用户发言、专家全局公告与协作派单/交付动态卡片；
 * 3. 底部输入框：自带 @专家 快捷胶囊，默认路由总导师，指定 @ 路由对应专家。
 */

import { memo, useMemo, useState, useRef, useEffect } from 'react'
import {
  Sparkles,
  Send,
  Trash2,
  StopCircle,
  ExternalLink,
  CheckCircle2,
  ArrowRight,
  Bot,
  Clock,
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
  onResetChannel: () => void
  onStopAll: () => void
}

export const TeamChannelPane = memo(function TeamChannelPane({
  messages,
  delegations,
  profiles,
  onSendMessage,
  onSelectAgent,
  onResetChannel,
  onStopAll,
}: TeamChannelPaneProps) {
  const [inputText, setInputText] = useState('')
  const streamBottomRef = useRef<HTMLDivElement>(null)

  // 活跃委派列表
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
    setInputText((prev) => {
      const mention = `@${profile.name} `
      if (prev.includes(mention)) return prev
      return prev ? `${prev} ${mention}` : mention
    })
  }

  return (
    <div className="flex flex-col h-full w-full bg-paper select-text overflow-hidden">
      {/* 顶栏 */}
      <div className="px-4 py-2.5 border-b border-line/60 bg-paper/85 backdrop-blur-md flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
            <Sparkles size={14} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-[13px] font-bold text-ink-strong leading-tight">
                {t('协作频道')}
              </h3>
              <span className="text-[10px] text-ink-faint">
                {t('共 {0} 席专业专家', profiles.length)}
              </span>
            </div>
            <p className="text-[10.5px] text-ink-faint truncate">
              {t('多智能体协同广播 · 阶段交付与进度总览')}
            </p>
          </div>
        </div>

        {/* 右侧动作 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onStopAll}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
            title={t('中止所有正在运行的任务')}
          >
            <StopCircle size={12} />
            <span>{t('停止')}</span>
          </button>
          <button
            type="button"
            onClick={onResetChannel}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-ink-faint hover:text-ink hover:bg-line/40 transition cursor-pointer"
            title={t('清空频道消息')}
          >
            <Trash2 size={12} />
            <span>{t('清空')}</span>
          </button>
        </div>
      </div>

      {/* 委派进度胶囊条（若有活跃工单则展示） */}
      {activeDelegations.length > 0 && (
        <div className="px-4 py-1.5 bg-indigo-500/8 border-b border-indigo-500/15 flex items-center gap-2 overflow-x-auto text-[11px] shrink-0">
          <span className="text-[10.5px] font-semibold text-indigo-500 shrink-0 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            {t('执行中委派:')}
          </span>
          {activeDelegations.map((del) => (
            <button
              key={del.id}
              type="button"
              onClick={() => onSelectAgent(del.targetAgentId)}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-card border border-indigo-500/25 hover:border-indigo-500/50 text-[10.5px] text-ink hover:text-indigo-600 transition cursor-pointer shrink-0 shadow-2xs"
              title={t('点击跳转至 {0} 视口', del.targetAgentName)}
            >
              <span className="font-medium">{del.fromAgentName}</span>
              <ArrowRight size={10} className="text-ink-faint" />
              <span className="font-semibold text-indigo-500">{del.targetAgentName}</span>
              <ExternalLink size={9} className="text-ink-faint ml-0.5" />
            </button>
          ))}
        </div>
      )}

      {/* 消息流主体 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-ink-faint py-16 space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-paper-deep flex items-center justify-center border border-line text-ink-faint">
              <Sparkles size={22} />
            </div>
            <div className="text-[13px] font-semibold text-ink-strong">
              {t('协作频道暂无消息')}
            </div>
            <p className="text-[11.5px] text-ink-faint max-w-sm">
              {t('在下方输入框发言，默认将由「总导师」协调团队各专家为您分工攻克目标；也可以通过 @ 专家直接派单。')}
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.senderId === 'user'
            const isDelCard = msg.delegationId !== undefined

            if (isUser) {
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[78%] rounded-2xl rounded-tr-xs bg-seal/12 text-ink-strong border border-seal/20 px-3.5 py-2.5 shadow-2xs text-[13px]">
                    <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                  </div>
                </div>
              )
            }

            // 跨专家委派与阶段动态卡片
            if (isDelCard) {
              const isDone = msg.content.includes('完成交付')
              return (
                <div key={msg.id} className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl bg-card border border-line/80 p-3.5 shadow-2xs space-y-2">
                    <div className="flex items-center justify-between gap-2 border-b border-line/50 pb-2">
                      <div className="flex items-center gap-1.5">
                        {isDone ? (
                          <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                        ) : (
                          <Clock size={13} className="text-amber-500 shrink-0" />
                        )}
                        <span className="text-[12px] font-bold text-ink-strong">
                          {isDone ? t('协作工单交付') : t('跨专家委派派发')}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectAgent(msg.senderId)}
                        className="flex items-center gap-1 text-[10.5px] font-medium text-seal hover:underline cursor-pointer"
                      >
                        <span>{t('查看 {0} ↗', msg.senderName)}</span>
                      </button>
                    </div>
                    <div className="text-[12px] leading-relaxed text-ink prose-sm">
                      <MarkdownView html={renderNote(msg.content)} className="moji-agent-md" />
                    </div>
                  </div>
                </div>
              )
            }

            // 专家公告与发言
            return (
              <div key={msg.id} className="flex justify-start gap-2.5 items-start">
                <div className="w-7 h-7 rounded-lg bg-paper-deep border border-line text-ink flex items-center justify-center shrink-0 text-[12px] mt-0.5">
                  <Bot size={14} />
                </div>
                <div className="max-w-[85%] space-y-1">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="font-semibold text-ink-strong">{msg.senderName}</span>
                    {msg.isAnnouncement && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-line/80 text-ink-faint border border-line">
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

      {/* 底部输入区 */}
      <div className="p-3 border-t border-line/60 bg-paper/90 backdrop-blur-md space-y-2 shrink-0">
        {/* @ 专家快捷胶囊 */}
        <div className="flex items-center gap-1.5 overflow-x-auto text-[10.5px] pb-0.5">
          <span className="text-ink-faint shrink-0 flex items-center gap-1">
            <span className="text-[11px] font-bold text-indigo-500">@</span>
            <span>{t('指定专家:')}</span>
          </span>
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleInsertMention(p)}
              className="px-2 py-0.5 rounded-full bg-paper-deep/80 hover:bg-seal/10 border border-line hover:border-seal/30 text-ink-subtle hover:text-seal transition cursor-pointer shrink-0"
            >
              @{p.name}
            </button>
          ))}
        </div>

        {/* 输入框与发送按钮 */}
        <div className="relative rounded-xl border border-line/80 bg-paper-deep/60 focus-within:border-seal/60 focus-within:ring-1 focus-within:ring-seal/20 transition">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder={t('直接发言默认由总导师协调，输入 @ 可指定专家处理... (⌘+Enter 发送)')}
            className="w-full p-2.5 pr-12 text-[12.5px] bg-transparent resize-none focus:outline-none placeholder:text-ink-faint text-ink leading-relaxed"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="absolute right-2 bottom-2 p-1.5 rounded-lg bg-seal text-white hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
            title={t('发送消息 (⌘+Enter)')}
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  )
})
