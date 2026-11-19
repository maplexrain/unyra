/**
 * 单个专业 Agent 工作区 (TeamAgentWorkspace)
 *
 * 核心设计：
 * 1. 顶栏极简纯粹：专家名 + 一句话定位 + 右侧极简「工单 (N)」、「黑板」、「清空」；
 * 2. 对话流永不淹没：
 *    - 用户气泡：回执头折叠为单行小灰字，纯净呈现用户真实意图；
 *    - Host 回复：简练答复 + 1 行紧凑 InlineWorkerCard + 1 行极简委派条；
 * 3. 无缝协同：点击工单直接向右侧平滑拉出 DeliverableDrawer 交付面板，绝不跳出对话上下文！
 */

import { memo, useState, useRef, useEffect } from 'react'
import {
  Bot,
  LayoutGrid,
  Loader2,
  Send,
  StopCircle,
  Trash2,
  Zap,
  ArrowRight,
} from 'lucide-react'
import type { TeamAgentProfile } from '../../../agent/team/types'
import type { AgentViewSnapshot } from '../../../learn/superAgent/useAgentTeam'
import type { AgentPart } from '../../../agent/types'
import { splitHostUserDisplay } from '../../../agent/super/projection'
import { deriveAgentStatus } from './agentStatusMeta'
import { InlineWorkerCard } from './InlineWorkerCard'
import MarkdownView from '../../MarkdownView'
import { renderNote } from '../../../lib/markdown'
import { t } from '../../../i18n'

export interface TeamAgentWorkspaceProps {
  profile: TeamAgentProfile
  agent: AgentViewSnapshot
  onSendMessage: (text: string) => void
  onSendToWorker: (workerId: string, text: string) => void
  onCancelWorker: (workerId: string) => void
  onSelectAgent: (agentId: string) => void
  onOpenWorkerDrawer: (workerId: string) => void
  onOpenBlackboardDrawer: () => void
  onResetAgent: () => void
  onStopAgent: () => void
}

export const TeamAgentWorkspace = memo(function TeamAgentWorkspace({
  profile,
  agent,
  onSendMessage,
  onSendToWorker,
  onCancelWorker,
  onSelectAgent,
  onOpenWorkerDrawer,
  onOpenBlackboardDrawer,
  onResetAgent,
  onStopAgent,
}: TeamAgentWorkspaceProps) {
  const [inputText, setInputText] = useState('')
  const streamBottomRef = useRef<HTMLDivElement>(null)

  const meta = deriveAgentStatus(agent)

  useEffect(() => {
    streamBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [agent.hostMessages.length, agent.hostStreaming?.text])

  const handleSend = () => {
    const text = inputText.trim()
    if (!text || agent.hostRunning) return
    onSendMessage(text)
    setInputText('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full w-full bg-paper overflow-hidden select-text">
      {/* 顶栏：极其清爽，拒绝堆砌 */}
      <div className="px-4 py-2.5 border-b border-line/60 bg-paper-deep/30 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dotClass}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="text-[13px] font-bold text-ink-strong truncate">{profile.name}</h2>
              <span className="text-[10.5px] text-ink-faint truncate">· {profile.role}</span>
              {agent.hostRunning && (
                <span className="flex items-center gap-1 text-[9.5px] text-sky-500 font-semibold px-1.5 py-0.2 rounded-full bg-sky-500/10">
                  <Loader2 size={10} className="animate-spin" />
                  <span>{t('回复中')}</span>
                </span>
              )}
            </div>
            <p className="text-[10px] text-ink-faint truncate max-w-md">{profile.description}</p>
          </div>
        </div>

        {/* 右侧动作 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* 工单面板触发按钮 */}
          <button
            type="button"
            onClick={() => {
              if (agent.workers.length > 0) {
                onOpenWorkerDrawer(agent.workers[0].id)
              }
            }}
            disabled={agent.workers.length === 0}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-card border border-line hover:border-line-strong disabled:opacity-40 disabled:cursor-not-allowed text-ink-subtle transition cursor-pointer"
            title={t('查看内部工单交付')}
          >
            <Zap size={12} className={agent.runningWorkersCount > 0 ? 'text-emerald-500 animate-pulse' : ''} />
            <span>
              {t('工单')} ({agent.workers.length})
            </span>
          </button>

          {/* 黑板面板触发按钮 */}
          <button
            type="button"
            onClick={onOpenBlackboardDrawer}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-card border border-line hover:border-line-strong text-ink-subtle transition cursor-pointer"
            title={t('查看专家共享黑板')}
          >
            <LayoutGrid size={12} />
            <span>{t('黑板')}</span>
          </button>

          {/* 停止与清空 */}
          {agent.hostRunning && (
            <button
              type="button"
              onClick={onStopAgent}
              className="p-1 rounded-md text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
              title={t('停止思考')}
            >
              <StopCircle size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={onResetAgent}
            className="p-1 rounded-md text-ink-faint hover:text-ink hover:bg-line/40 transition cursor-pointer"
            title={t('清空对话')}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* 对话流主区 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {agent.hostMessages.length === 0 && !agent.hostStreaming ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-ink-faint py-16 space-y-2">
            <div className="w-10 h-10 rounded-2xl bg-paper-deep border border-line flex items-center justify-center text-ink-faint">
              <Bot size={20} />
            </div>
            <div className="text-[12.5px] font-bold text-ink-strong">
              {t('向「{0}」发起任务', profile.name)}
            </div>
            <p className="text-[11px] text-ink-faint max-w-sm leading-relaxed">
              {profile.description}
            </p>
          </div>
        ) : (
          agent.hostMessages.map((msg) => {
            const isUser = msg.role === 'user'

            if (isUser) {
              const rawText = msg.parts.map((p: AgentPart) => ('text' in p ? p.text : '')).join('')
              const { userText, mailboxCount } = splitHostUserDisplay(rawText)
              return (
                <div key={msg.id} className="flex justify-end space-y-1">
                  <div className="max-w-[78%]">
                    {mailboxCount > 0 && (
                      <div className="text-right text-[9.5px] text-ink-faint mb-1">
                        {t('【已自动带入 {0} 项后台回执】', mailboxCount)}
                      </div>
                    )}
                    <div className="rounded-2xl rounded-tr-xs bg-seal/12 text-ink-strong border border-seal/20 px-3.5 py-2 shadow-2xs text-[12.5px]">
                      <div className="whitespace-pre-wrap leading-relaxed">{userText}</div>
                    </div>
                  </div>
                </div>
              )
            }

            // Assistant 消息
            return (
              <div key={msg.id} className="flex justify-start gap-2 items-start">
                <div className="w-6 h-6 rounded-lg bg-paper-deep border border-line text-ink flex items-center justify-center shrink-0 text-[11px] mt-0.5">
                  <Bot size={13} />
                </div>
                <div className="max-w-[85%] space-y-1.5">
                  <div className="rounded-2xl rounded-tl-xs bg-card border border-line/80 p-3 shadow-2xs text-[12.5px] text-ink leading-relaxed space-y-2">
                    {msg.parts.map((part: AgentPart, idx: number) => {
                      if (part.type === 'text') {
                        return (
                          <MarkdownView
                            key={idx}
                            html={renderNote(part.text)}
                            className="moji-agent-md"
                          />
                        )
                      }

                      // 工具调用
                      if (part.type === 'tool') {
                        // 1. spawn_worker -> 1 行紧凑工单任务条
                        if (part.name === 'spawn_worker') {
                          let goal = ''
                          try {
                            const parsed = JSON.parse(part.args || '{}')
                            goal = parsed.goal || ''
                          } catch {}

                          let targetWorkerId: string | undefined
                          if (part.result) {
                            try {
                              const res = JSON.parse(part.result)
                              if (res.workerId) targetWorkerId = res.workerId
                            } catch {}
                          }

                          const matchedWorker = targetWorkerId
                            ? agent.workers.find((w) => w.id === targetWorkerId)
                            : agent.workers.find((w) => goal && (w.goal === goal || w.goal.includes(goal))) || agent.workers[0]

                          if (matchedWorker) {
                            return (
                              <InlineWorkerCard
                                key={idx}
                                worker={matchedWorker}
                                streamSlot={agent.workerStreams[matchedWorker.id]}
                                onSendToWorker={onSendToWorker}
                                onCancelWorker={onCancelWorker}
                                onOpenWorkerPane={onOpenWorkerDrawer}
                              />
                            )
                          }
                        }

                        // 2. delegate_to_agent -> 1 行紧凑跨专家委派条
                        if (part.name === 'delegate_to_agent') {
                          let targetId = ''
                          let task = ''
                          try {
                            const parsed = JSON.parse(part.args || '{}')
                            targetId = parsed.targetAgentId || ''
                            task = parsed.task || ''
                          } catch {}

                          return (
                            <div
                              key={idx}
                              className="px-3 py-1.5 rounded-xl bg-indigo-500/8 border border-indigo-500/20 text-[11.5px] flex items-center justify-between gap-2"
                            >
                              <div className="flex items-center gap-1.5 truncate">
                                <span className="font-semibold text-indigo-600 dark:text-indigo-400 shrink-0">
                                  📢 {t('跨专家协作工单:')}
                                </span>
                                <span className="text-ink-subtle truncate">{task}</span>
                              </div>
                              {targetId && (
                                <button
                                  type="button"
                                  onClick={() => onSelectAgent(targetId)}
                                  className="flex items-center gap-0.5 text-[11px] font-semibold text-seal hover:underline shrink-0 cursor-pointer"
                                >
                                  <span>{t('前往视口')}</span>
                                  <ArrowRight size={10} />
                                </button>
                              )}
                            </div>
                          )
                        }
                      }
                      return null
                    })}
                  </div>
                </div>
              </div>
            )
          })
        )}

        {/* 流式生成中 */}
        {agent.hostStreaming && (
          <div className="flex justify-start gap-2 items-start">
            <div className="w-6 h-6 rounded-lg bg-paper-deep border border-line text-ink flex items-center justify-center shrink-0 text-[11px] mt-0.5">
              <Bot size={13} />
            </div>
            <div className="max-w-[85%] rounded-2xl rounded-tl-xs bg-card border border-line/80 p-3 shadow-2xs space-y-1.5 text-[12.5px]">
              {agent.hostStreaming.thinking && (
                <div className="p-2 rounded-xl bg-paper-deep/60 border border-line text-ink-subtle text-[11px] italic leading-relaxed">
                  {agent.hostStreaming.thinking}
                </div>
              )}
              {agent.hostStreaming.text ? (
                <div className="text-ink leading-relaxed">
                  <MarkdownView
                    html={renderNote(agent.hostStreaming.text)}
                    className="moji-agent-md"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2 text-ink-faint text-[11.5px] py-1">
                  <Loader2 size={12} className="animate-spin text-sky-500" />
                  <span>{t('正在规划调度...')}</span>
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={streamBottomRef} />
      </div>

      {/* 底部输入框 */}
      <div className="p-3 border-t border-line/60 bg-paper/90 backdrop-blur-md shrink-0">
        <div className="relative rounded-xl border border-line/80 bg-paper-deep/60 focus-within:border-seal/60 focus-within:ring-1 focus-within:ring-seal/20 transition">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder={t('向「{0}」下达指令或提问... (⌘+Enter 发送)', profile.name)}
            className="w-full p-2.5 pr-10 text-[12px] bg-transparent resize-none focus:outline-none placeholder:text-ink-faint text-ink leading-relaxed"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputText.trim() || agent.hostRunning}
            className="absolute right-2 bottom-2 p-1.5 rounded-lg bg-seal text-white hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
            title={t('发送 (⌘+Enter)')}
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  )
})
