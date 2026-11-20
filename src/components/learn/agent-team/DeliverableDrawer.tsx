/**
 * 查看正文交付面板 (DeliverableDrawer)
 *
 * 规范（TASK #10 改造）：
 * 1. 采用与 Agent 栏消息列表一致的布局与消息组件，消息自然按时间线流转；
 * 2. 彻底取消底部输入框与「交付正文/执行过程」Tab 分页；
 * 3. 过程件（思考与工具）与正文在单条消息内折叠呈现，最大程度减少信息干扰；
 * 4. 气泡最大宽度限制为 800px。
 */

import { memo, useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  LayoutGrid,
  Loader2,
  StopCircle,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import type {
  BlackboardEntry,
  WorkerSession,
} from '../../../agent/super/types'
import type { WorkerStreamSlot } from '../../../learn/superAgent/useAgentTeam'
import type { AgentPart, ConversationMessage } from '../../../agent/types'
import { extractMindParts } from '../../../agent/super/projection'
import MarkdownView from '../../MarkdownView'
import { renderNote } from '../../../lib/markdown'
import { ToolCard } from '../../agent/panel/ToolCard'
import { t } from '../../../i18n'

export type DrawerMode =
  | { kind: 'worker'; workerId: string }
  | { kind: 'blackboard' }
  | { kind: 'worker_list' }

export interface DeliverableDrawerProps {
  mode: DrawerMode
  agentName: string
  workers: WorkerSession[]
  workerStreams: Record<string, WorkerStreamSlot>
  blackboard: BlackboardEntry[]
  onSelectWorker: (workerId: string) => void
  onCancelWorker: (workerId: string) => void
  onClose: () => void
}

/** 单条 Assistant 消息内部的思考与工具折叠组 */
function AssistantProcessGroup({
  parts,
  defaultExpanded = false,
}: {
  parts: AgentPart[]
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  if (parts.length === 0) return null

  return (
    <div className="mb-2 rounded-xl border border-line/60 bg-paper-deep/40 overflow-hidden text-[11.5px]">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full px-2.5 py-1.5 flex items-center justify-between text-ink-subtle hover:text-ink hover:bg-line/20 transition cursor-pointer select-none"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <Wrench size={11} className="text-amber-500/80" />
          <span>{t('思考与工具执行过程 ({0})', parts.length)}</span>
        </span>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>

      {expanded && (
        <div className="p-2.5 space-y-2 border-t border-line/40 bg-paper/50 max-h-60 overflow-y-auto">
          {parts.map((part, idx) => {
            if (part.type === 'thinking') {
              return (
                <div
                  key={idx}
                  className="p-2 rounded-lg bg-paper-deep/60 border border-line text-ink-subtle italic text-[11px] leading-relaxed"
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
  )
}

export const DeliverableDrawer = memo(function DeliverableDrawer({
  mode,
  agentName,
  workers,
  workerStreams,
  blackboard,
  onSelectWorker,
  onCancelWorker,
  onClose,
}: DeliverableDrawerProps) {
  // 当前选中工单
  const activeWorkerId = mode.kind === 'worker' ? mode.workerId : workers[0]?.id
  const currentWorker = useMemo(
    () => workers.find((w) => w.id === activeWorkerId),
    [workers, activeWorkerId],
  )
  const currentStream = currentWorker ? workerStreams[currentWorker.id] : undefined
  const [copiedArtifactId, setCopiedArtifactId] = useState<string | null>(null)

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedArtifactId(id)
    setTimeout(() => setCopiedArtifactId(null), 1500)
  }

  return (
    <div className="flex flex-col h-full w-full bg-card/95 backdrop-blur-md border-l border-line/80 shadow-xl select-text">
      {/* 顶栏：极简 */}
      <div className="px-3.5 py-2.5 border-b border-line/60 flex items-center justify-between gap-2 shrink-0 bg-paper-deep/30">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-seal/15 text-seal flex items-center justify-center shrink-0">
            {mode.kind === 'blackboard' ? <LayoutGrid size={13} /> : <Zap size={13} />}
          </div>
          <div className="min-w-0">
            <h3 className="text-[12.5px] font-bold text-ink-strong truncate">
              {mode.kind === 'blackboard'
                ? t('「{0}」共享黑板', agentName)
                : currentWorker?.title || t('工单正文')}
            </h3>
            {mode.kind === 'worker' && currentWorker && (
              <p className="text-[10px] text-ink-faint truncate max-w-[240px]">
                {currentWorker.goal}
              </p>
            )}
          </div>
        </div>

        {/* 右侧动作 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {mode.kind === 'worker' && currentWorker && (
            <>
              {currentWorker.status === 'running' && (
                <button
                  type="button"
                  onClick={() => onCancelWorker(currentWorker.id)}
                  className="p-1 rounded-md text-rose-500 hover:bg-rose-500/10 cursor-pointer transition"
                  title={t('中止工单')}
                >
                  <StopCircle size={13} />
                </button>
              )}
              {workers.length > 1 && (
                <select
                  value={currentWorker.id}
                  onChange={(e) => onSelectWorker(e.target.value)}
                  className="px-1.5 py-0.8 rounded-lg text-[10.5px] bg-paper border border-line text-ink cursor-pointer focus:outline-none max-w-[120px] truncate"
                >
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.title}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-ink-faint hover:text-ink hover:bg-line/40 transition cursor-pointer"
            title={t('关闭面板')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 主体视口 */}
      {mode.kind === 'blackboard' ? (
        /* 黑板视图 */
        <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
          {blackboard.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-ink-faint text-[12px] py-16">
              <LayoutGrid size={24} className="mb-2 opacity-40" />
              <span>{t('当前黑板尚未沉淀任何条目')}</span>
            </div>
          ) : (
            blackboard.map((entry) => (
              <div
                key={entry.workerId}
                onClick={() => {
                  if (entry.workerId) onSelectWorker(entry.workerId)
                }}
                className="p-3 rounded-xl bg-paper border border-line/80 hover:border-seal/40 transition cursor-pointer space-y-1.5 max-w-[800px]"
              >
                <div className="flex items-center justify-between text-[11.5px]">
                  <span className="font-semibold text-ink-strong">{entry.title}</span>
                  <span className="text-[10px] text-ink-faint">
                    {new Date(entry.updatedAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-[12px] text-ink leading-relaxed line-clamp-3">
                  {entry.summary}
                </div>
              </div>
            ))
          )}
        </div>
      ) : !currentWorker ? (
        <div className="flex-1 flex items-center justify-center text-ink-faint text-[12px]">
          {t('暂无选中的工单')}
        </div>
      ) : (
        /* Agent 栏标准消息流布局 */
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* 渲染该工单的完整会话历史 */}
          {currentWorker.messages.map((m: ConversationMessage) => {
            const isUser = m.role === 'user'

            if (isUser) {
              const text = m.parts
                .filter((p) => p.type === 'text')
                .map((p) => ('text' in p ? p.text : ''))
                .join('\n\n')

              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[800px] rounded-2xl rounded-tr-xs bg-line/60 text-ink px-3.5 py-2 shadow-2xs text-[12.5px] leading-relaxed">
                    <div className="whitespace-pre-wrap">{text}</div>
                  </div>
                </div>
              )
            }

            // Assistant 消息：过程折叠组 + 正文 Markdown + 产物胶囊
            const mindParts = extractMindParts(m.parts)
            const textParts = m.parts.filter((p) => p.type === 'text')

            return (
              <div key={m.id} className="flex justify-start">
                <div className="max-w-[800px] w-full rounded-2xl rounded-tl-xs bg-card border border-line/80 p-3.5 shadow-2xs space-y-2 text-[12.5px]">
                  {/* 折叠的过程件 */}
                  {mindParts.length > 0 && <AssistantProcessGroup parts={mindParts} />}

                  {/* 交付正文 */}
                  {textParts.map((part, idx) => (
                    <div key={idx} className="text-ink leading-relaxed prose-sm">
                      <MarkdownView
                        html={renderNote('text' in part ? part.text : '')}
                        className="moji-agent-md"
                      />
                    </div>
                  ))}

                  {/* 关联产物展示 */}
                  {currentWorker.artifacts.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-line/40 flex flex-wrap gap-1.5 text-[10.5px]">
                      {currentWorker.artifacts.map((art) => (
                        <div
                          key={art.id}
                          className="flex items-center gap-1.5 px-2 py-0.8 rounded-md bg-seal/10 text-seal border border-seal/20 font-medium"
                        >
                          <FileText size={11} />
                          <span>{art.title}</span>
                          <button
                            type="button"
                            onClick={() => handleCopy(art.content, art.id)}
                            className="ml-1 text-ink-faint hover:text-ink cursor-pointer"
                            title={t('复制产物内容')}
                          >
                            {copiedArtifactId === art.id ? (
                              <Check size={11} className="text-emerald-500" />
                            ) : (
                              <Copy size={11} />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* 若 Worker 正在执行流式推理中，实时呈现当前的流式内容 */}
          {currentStream && (
            <div className="flex justify-start">
              <div className="max-w-[800px] w-full rounded-2xl rounded-tl-xs bg-card border border-line/80 p-3.5 shadow-2xs space-y-2 text-[12.5px]">
                {currentStream.mind.length > 0 && (
                  <AssistantProcessGroup parts={currentStream.mind} defaultExpanded />
                )}
                {currentStream.chat ? (
                  <div className="text-ink leading-relaxed prose-sm">
                    <MarkdownView
                      html={renderNote(currentStream.chat)}
                      className="moji-agent-md"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-ink-faint text-[12px] py-1">
                    <Loader2 size={13} className="animate-spin text-emerald-500" />
                    <span>{t('正在后台工坊执行探索与撰写成果...')}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 若既无历史消息也无流式内容 */}
          {currentWorker.messages.length === 0 && !currentStream && (
            <div className="flex flex-col items-center justify-center py-16 text-ink-faint text-[12px] space-y-2">
              <Zap size={22} className="opacity-40" />
              <span>{t('工单已就绪，等待执行。')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
})
