/**
 * 交付正文二级页面 (DeliverableSubpage)
 *
 * 架构规范：
 * 1. 聊天区二级页面形态：不再作为右侧抽屉挤占工作区宽度，而在聊天视口内平滑推入；
 * 2. 顶栏提供明确的面包屑导航与「← 返回」按钮（支持返回频道或返回专家）；
 * 3. 布局与 Agent 对话流严格一致：自然时间流、折叠思考与工具过程件、零拷贝交付正文；
 * 4. 气泡与主体容器严格限制最大宽度 800px 居中排布，阅读体验极佳；
 * 5. 彻底无底部输入框与多余 Tab 页，纯粹沉浸式查验交付成果。
 */

import { memo, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  LayoutGrid,
  Loader2,
  StopCircle,
  Wrench,
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

export type SubpageMode =
  | { kind: 'worker'; workerId: string }
  | { kind: 'blackboard' }
  | { kind: 'worker_list' }

export interface DeliverableSubpageProps {
  mode: SubpageMode
  agentName: string
  workers: WorkerSession[]
  workerStreams: Record<string, WorkerStreamSlot>
  blackboard: BlackboardEntry[]
  backLabel?: string
  onSelectWorker: (workerId: string) => void
  onCancelWorker: (workerId: string) => void
  onBack: () => void
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

export const DeliverableSubpage = memo(function DeliverableSubpage({
  mode,
  agentName,
  workers,
  workerStreams,
  blackboard,
  backLabel,
  onSelectWorker,
  onCancelWorker,
  onBack,
}: DeliverableSubpageProps) {
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
    <div className="flex flex-col h-full w-full bg-paper overflow-hidden select-text">
      {/* 顶栏：面包屑导航 + 返回按钮 + 状态标 */}
      <div className="px-4 py-2.5 border-b border-line/60 flex items-center justify-between gap-3 shrink-0 bg-paper-deep/30">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-semibold text-ink-subtle hover:text-ink hover:bg-line/40 transition cursor-pointer shrink-0"
            title={t('返回上一级')}
          >
            <ArrowLeft size={13} className="text-seal" />
            <span>{backLabel || t('返回')}</span>
          </button>

          <div className="h-3.5 w-[1px] bg-line shrink-0" />

          <div className="flex items-center gap-2 min-w-0">
            <div className="w-5 h-5 rounded-md bg-seal/15 text-seal flex items-center justify-center shrink-0">
              {mode.kind === 'blackboard' ? <LayoutGrid size={12} /> : <Zap size={12} />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-[12.5px] font-bold text-ink-strong truncate">
                  {mode.kind === 'blackboard'
                    ? t('「{0}」共享黑板', agentName)
                    : currentWorker?.title || t('工单正文')}
                </h3>
                {mode.kind === 'worker' && currentWorker && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[9px] font-semibold ${
                      currentWorker.status === 'done'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : currentWorker.status === 'running'
                          ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                          : 'bg-line/80 text-ink-faint'
                    }`}
                  >
                    {currentWorker.status === 'done'
                      ? t('已完成')
                      : currentWorker.status === 'running'
                        ? t('执行中')
                        : currentWorker.status === 'waiting_input'
                          ? t('等待输入')
                          : currentWorker.status === 'failed'
                            ? t('失败')
                            : t('已取消')}
                  </span>
                )}
              </div>
              {mode.kind === 'worker' && currentWorker && (
                <p className="text-[10px] text-ink-faint truncate max-w-lg">
                  {currentWorker.goal}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 右侧动作 */}
        <div className="flex items-center gap-2 shrink-0">
          {mode.kind === 'worker' && currentWorker && (
            <>
              {currentWorker.status === 'running' && (
                <button
                  type="button"
                  onClick={() => onCancelWorker(currentWorker.id)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-rose-500 hover:bg-rose-500/10 cursor-pointer transition font-medium"
                  title={t('中止工单运行')}
                >
                  <StopCircle size={12} />
                  <span>{t('中止')}</span>
                </button>
              )}
              {workers.length > 1 && (
                <div className="flex items-center gap-1 text-[11px] text-ink-faint">
                  <span>{t('工单:')}</span>
                  <select
                    value={currentWorker.id}
                    onChange={(e) => onSelectWorker(e.target.value)}
                    className="px-2 py-1 rounded-lg text-[11px] bg-paper border border-line text-ink cursor-pointer focus:outline-none max-w-[160px] truncate"
                  >
                    {workers.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 主体视口：800px 居中排布 */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-[800px] mx-auto w-full space-y-3">
          {mode.kind === 'blackboard' ? (
            /* 黑板视图 */
            blackboard.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-ink-faint text-[12px] space-y-2">
                <LayoutGrid size={28} className="opacity-40" />
                <span>{t('当前黑板尚未沉淀任何条目')}</span>
              </div>
            ) : (
              blackboard.map((entry) => (
                <div
                  key={entry.workerId}
                  onClick={() => {
                    if (entry.workerId) onSelectWorker(entry.workerId)
                  }}
                  className="p-3.5 rounded-xl bg-card border border-line/80 hover:border-seal/40 transition cursor-pointer space-y-1.5 shadow-2xs"
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
            )
          ) : !currentWorker ? (
            <div className="flex flex-col items-center justify-center py-20 text-ink-faint text-[12px]">
              <span>{t('暂无选中的工单')}</span>
            </div>
          ) : (
            <>
              {/* 工单完整会话历史 */}
              {currentWorker.messages.map((m: ConversationMessage) => {
                const isUser = m.role === 'user'

                if (isUser) {
                  const text = m.parts
                    .filter((p) => p.type === 'text')
                    .map((p) => ('text' in p ? p.text : ''))
                    .join('\n\n')

                  return (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[800px] w-fit rounded-2xl rounded-tr-xs bg-seal/12 text-ink-strong border border-seal/20 px-3.5 py-2 shadow-2xs text-[12.5px] leading-relaxed">
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
                <div className="flex flex-col items-center justify-center py-20 text-ink-faint text-[12px] space-y-2">
                  <Zap size={24} className="opacity-40" />
                  <span>{t('工单已就绪，等待执行。')}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
})
