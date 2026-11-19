/**
 * 单个专业 Agent 工作区 (TeamAgentWorkspace)
 *
 * 核心设计：
 * 1. 顶栏：专家画像、角色专长标签、后台工单数与黑板索引按钮；
 * 2. 主视口支持 3 种内部子视图切换（严格收归当前专家内部，不污染全局）：
 *    - 默认：Host 对话流（内嵌 InlineWorkerCard 实时工单、内嵌跨专家委派卡片）；
 *    - 内部工单全屏面板 (SuperWorkerPane)；
 *    - 内部黑板视口 (SuperBlackboardPane)；
 * 3. 抽屉式工单快速切换栏：点击顶栏「后台工单」可随时滑出工单清单。
 */

import { memo, useMemo, useState, useRef, useEffect } from 'react'
import {
  Bot,
  ExternalLink,
  LayoutGrid,
  Loader2,
  Send,
  StopCircle,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import type { TeamAgentProfile } from '../../../agent/team/types'
import type { AgentViewSnapshot } from '../../../learn/superAgent/useAgentTeam'
import type { AgentPart } from '../../../agent/types'
import { splitHostUserDisplay } from '../../../agent/super/projection'
import { SuperWorkerPane } from './SuperWorkerPane'
import { SuperBlackboardPane } from './SuperBlackboardPane'
import { InlineWorkerCard } from './InlineWorkerCard'
import MarkdownView from '../../MarkdownView'
import { renderNote } from '../../../lib/markdown'
import { t } from '../../../i18n'

export type WorkspaceSubView =
  | { kind: 'chat' }
  | { kind: 'worker'; workerId: string }
  | { kind: 'blackboard' }

export interface TeamAgentWorkspaceProps {
  profile: TeamAgentProfile
  agent: AgentViewSnapshot
  onSendMessage: (text: string) => void
  onSendToWorker: (workerId: string, text: string) => void
  onCancelWorker: (workerId: string) => void
  onSelectAgent: (agentId: string) => void
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
  onResetAgent,
  onStopAgent,
}: TeamAgentWorkspaceProps) {
  const [subView, setSubView] = useState<WorkspaceSubView>({ kind: 'chat' })
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [inputText, setInputText] = useState('')
  const streamBottomRef = useRef<HTMLDivElement>(null)

  // 当切换到新专家时，重置子视图为默认 chat
  useEffect(() => {
    setSubView({ kind: 'chat' })
    setIsDrawerOpen(false)
  }, [profile.id])

  useEffect(() => {
    if (subView.kind === 'chat') {
      streamBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [agent.hostMessages, agent.hostStreaming, subView])

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

  // 选中的独立工单
  const selectedWorker = useMemo(() => {
    if (subView.kind !== 'worker') return null
    return agent.workers.find((w) => w.id === subView.workerId) || null
  }, [subView, agent.workers])

  // --- 渲染子视图 1: 内部工单全屏面板 ---
  if (subView.kind === 'worker' && selectedWorker) {
    return (
      <SuperWorkerPane
        worker={selectedWorker}
        streamSlot={agent.workerStreams[selectedWorker.id]}
        onBackToHost={() => setSubView({ kind: 'chat' })}
        onSendToWorker={(wid, text) => onSendToWorker(wid, text)}
        onCancelWorker={(wid) => onCancelWorker(wid)}
      />
    )
  }

  // --- 渲染子视图 2: 内部黑板视口 ---
  if (subView.kind === 'blackboard') {
    return (
      <SuperBlackboardPane
        blackboard={agent.blackboard}
        onBackToHost={() => setSubView({ kind: 'chat' })}
        onSelectWorker={(wid) => setSubView({ kind: 'worker', workerId: wid })}
      />
    )
  }

  // --- 渲染子视图 3 (默认): Host 对话流 ---
  return (
    <div className="flex flex-col h-full w-full bg-paper select-text overflow-hidden relative">
      {/* 顶栏 */}
      <div className="px-4 py-2.5 border-b border-line/60 bg-paper/85 backdrop-blur-md flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-seal/15 text-seal flex items-center justify-center shrink-0 border border-seal/30 font-bold text-[13px]">
            {profile.name.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-[13.5px] font-bold text-ink-strong leading-tight truncate">
                {profile.name}
              </h3>
              <span className="text-[11px] text-ink-faint truncate">
                ({profile.role})
              </span>
              {agent.hostRunning && (
                <span className="flex items-center gap-1 text-[10px] text-amber-500 font-semibold px-1.5 py-0.2 rounded-full bg-amber-500/10 border border-amber-500/20">
                  <Loader2 size={10} className="animate-spin" />
                  <span>{t('思考中')}</span>
                </span>
              )}
            </div>
            {/* 能力标签 */}
            <div className="flex items-center gap-1 overflow-x-auto text-[9.5px] text-ink-faint mt-0.5">
              {profile.capabilities.slice(0, 4).map((c) => (
                <span key={c} className="px-1.5 py-0.2 rounded bg-line/60 shrink-0">
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* 右侧控制入口 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* 后台工单入口 */}
          <button
            type="button"
            onClick={() => setIsDrawerOpen((prev) => !prev)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition cursor-pointer ${
              agent.runningWorkersCount > 0
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                : 'bg-card border-line hover:border-line-strong text-ink-subtle'
            }`}
            title={t('查看当前专家的内部工单')}
          >
            <Zap size={12} className={agent.runningWorkersCount > 0 ? 'text-amber-500 animate-pulse' : ''} />
            <span>
              {t('后台工单')} ({agent.runningWorkersCount}/{agent.workers.length})
            </span>
          </button>

          {/* 黑板入口 */}
          <button
            type="button"
            onClick={() => setSubView({ kind: 'blackboard' })}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-card border border-line hover:border-line-strong text-ink-subtle transition cursor-pointer"
            title={t('查看专家专属黑板')}
          >
            <LayoutGrid size={12} />
            <span>
              {t('黑板')} ({agent.blackboard.length})
            </span>
          </button>

          {/* 停止与清空 */}
          {agent.hostRunning && (
            <button
              type="button"
              onClick={onStopAgent}
              className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
              title={t('停止当前专家思考')}
            >
              <StopCircle size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onResetAgent}
            className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-line/40 transition cursor-pointer"
            title={t('清空当前对话与工单')}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* 工单滑出抽屉 */}
      {isDrawerOpen && (
        <div className="absolute top-[52px] right-3 w-80 max-h-[70%] z-20 rounded-2xl bg-card border border-line/90 shadow-xl p-3 flex flex-col space-y-2 backdrop-blur-lg">
          <div className="flex items-center justify-between border-b border-line/60 pb-2">
            <span className="text-[12px] font-bold text-ink-strong">
              {t('内部工单列表 ({0})', agent.workers.length)}
            </span>
            <button
              type="button"
              onClick={() => setIsDrawerOpen(false)}
              className="p-1 rounded-md text-ink-faint hover:text-ink cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1.5 max-h-64">
            {agent.workers.length === 0 ? (
              <div className="text-[11px] text-ink-faint text-center py-4">
                {t('当前专家尚未派生任何工单')}
              </div>
            ) : (
              agent.workers.map((w) => (
                <div
                  key={w.id}
                  onClick={() => {
                    setSubView({ kind: 'worker', workerId: w.id })
                    setIsDrawerOpen(false)
                  }}
                  className="p-2 rounded-xl bg-paper border border-line/80 hover:border-seal/40 cursor-pointer transition text-[11.5px] space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink-strong truncate max-w-[170px]">
                      {w.title}
                    </span>
                    <span className="text-[10px] text-ink-faint font-medium">
                      {w.status}
                    </span>
                  </div>
                  <div className="text-[10px] text-ink-faint truncate">{w.goal}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 主对话流 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {agent.hostMessages.length === 0 && !agent.hostStreaming ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-ink-faint py-16 space-y-2.5">
            <div className="w-12 h-12 rounded-2xl bg-paper-deep border border-line flex items-center justify-center text-ink-faint">
              <Bot size={22} />
            </div>
            <div className="text-[13px] font-bold text-ink-strong">
              {t('向「{0}」发起任务', profile.name)}
            </div>
            <p className="text-[11.5px] text-ink-faint max-w-sm leading-relaxed">
              {profile.description}
            </p>
          </div>
        ) : (
          agent.hostMessages.map((msg) => {
            const isUser = msg.role === 'user'

            if (isUser) {
              const rawText = msg.parts.map((p: AgentPart) => ('text' in p ? p.text : '')).join('')
              const { userText } = splitHostUserDisplay(rawText)
              return (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[78%] rounded-2xl rounded-tr-xs bg-seal/12 text-ink-strong border border-seal/20 px-3.5 py-2.5 shadow-2xs text-[13px]">
                    <div className="whitespace-pre-wrap leading-relaxed">{userText}</div>
                  </div>
                </div>
              )
            }

            // Assistant 消息（可能内嵌 Worker 卡片或委派卡片）
            return (
              <div key={msg.id} className="flex justify-start gap-2.5 items-start">
                <div className="w-7 h-7 rounded-lg bg-paper-deep border border-line text-ink flex items-center justify-center shrink-0 text-[12px] mt-0.5">
                  <Bot size={14} />
                </div>
                <div className="max-w-[85%] space-y-2">
                  <div className="rounded-2xl rounded-tl-xs bg-card border border-line/80 p-3.5 shadow-2xs text-[12.5px] text-ink leading-relaxed space-y-2">
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
                        // 1. spawn_worker -> 内嵌实时 Worker 卡片
                        if (part.name === 'spawn_worker') {
                          let goal = ''
                          try {
                            const parsed = JSON.parse(part.args || '{}')
                            goal = parsed.goal || ''
                          } catch {}
                          const matchedWorker =
                            agent.workers.find((w) => goal && w.goal.includes(goal)) ||
                            agent.workers[0]

                          if (matchedWorker) {
                            return (
                              <InlineWorkerCard
                                key={idx}
                                worker={matchedWorker}
                                streamSlot={agent.workerStreams[matchedWorker.id]}
                                onSendToWorker={onSendToWorker}
                                onCancelWorker={onCancelWorker}
                                onOpenWorkerPane={(wid) =>
                                  setSubView({ kind: 'worker', workerId: wid })
                                }
                              />
                            )
                          }
                        }

                        // 2. delegate_to_agent -> 跨专家委派卡片
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
                              className="p-3 rounded-xl bg-indigo-500/8 border border-indigo-500/20 text-[12px] space-y-1.5"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-indigo-600 dark:text-indigo-400">
                                  📢 {t('已派发跨专家协作工单')}
                                </span>
                                {targetId && (
                                  <button
                                    type="button"
                                    onClick={() => onSelectAgent(targetId)}
                                    className="text-[10.5px] font-semibold text-seal hover:underline flex items-center gap-0.5 cursor-pointer"
                                  >
                                    <span>{t('前往专家视口')}</span>
                                    <ExternalLink size={10} />
                                  </button>
                                )}
                              </div>
                              <div className="text-ink-subtle">{task}</div>
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

        {/* 正在流式生成的思考与文本 */}
        {agent.hostStreaming && (
          <div className="flex justify-start gap-2.5 items-start">
            <div className="w-7 h-7 rounded-lg bg-paper-deep border border-line text-ink flex items-center justify-center shrink-0 text-[12px] mt-0.5">
              <Bot size={14} />
            </div>
            <div className="max-w-[85%] rounded-2xl rounded-tl-xs bg-card border border-line/80 p-3.5 shadow-2xs space-y-2 text-[12.5px]">
              {agent.hostStreaming.thinking && (
                <div className="p-2.5 rounded-xl bg-paper-deep/60 border border-line text-ink-subtle text-[11px] italic leading-relaxed">
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
                <div className="flex items-center gap-2 text-ink-faint text-[12px] py-1">
                  <Loader2 size={12} className="animate-spin text-amber-500" />
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
            className="w-full p-2.5 pr-12 text-[12.5px] bg-transparent resize-none focus:outline-none placeholder:text-ink-faint text-ink leading-relaxed"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="absolute right-2 bottom-2 p-1.5 rounded-lg bg-seal text-white hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
            title={t('发送指令 (⌘+Enter)')}
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  )
})
