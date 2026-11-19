/**
 * 右侧按需滑出交付面板 (DeliverableDrawer)
 *
 * 核心设计：
 * 1. 默认收起，点击任意工单条、交付卡片或顶栏「工单/黑板」时平滑滑出；
 * 2. 顶部双页签彻底分离：
 *    - 「交付正文 (Chat)」：全幅零拷贝 Markdown 正文，沉浸式阅读产出与 Artifact 切换；
 *    - 「执行过程 (Mind)」：独立折叠查看思考链与工具调用卡片；
 * 3. 底部直连快通道：无需唤醒 Host，直接向当前 Worker 跳边界插队或追问。
 */

import { memo, useMemo, useState } from 'react'
import {
  Check,
  Copy,
  FileText,
  LayoutGrid,
  Loader2,
  Send,
  StopCircle,
  X,
  Zap,
} from 'lucide-react'
import type {
  BlackboardEntry,
  WorkerSession,
} from '../../../agent/super/types'
import type { WorkerStreamSlot } from '../../../learn/superAgent/useAgentTeam'
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
  onSendToWorker: (workerId: string, text: string) => void
  onCancelWorker: (workerId: string) => void
  onClose: () => void
}

export const DeliverableDrawer = memo(function DeliverableDrawer({
  mode,
  agentName,
  workers,
  workerStreams,
  blackboard,
  onSelectWorker,
  onSendToWorker,
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

  // 内部页签：'chat' (交付正文) 与 'mind' (执行过程)
  const [activeTab, setActiveTab] = useState<'chat' | 'mind'>('chat')
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [inputText, setInputText] = useState('')

  // 提取 Mind 过程
  const mindParts = useMemo(() => {
    if (!currentWorker) return []
    const historicalParts = currentWorker.messages.flatMap((m) => m.parts)
    const base = extractMindParts(historicalParts)
    if (currentStream?.mind?.length) {
      return [...base, ...currentStream.mind]
    }
    return base
  }, [currentWorker, currentStream?.mind])

  // 提取正文
  const fullChatText = currentStream?.chat || currentWorker?.chatText || ''

  // 选中的产物内容（若选中）
  const activeArtifact = useMemo(() => {
    if (!selectedArtifactId || !currentWorker) return null
    return currentWorker.artifacts.find((a) => a.id === selectedArtifactId) || null
  }, [selectedArtifactId, currentWorker])

  const displayedMarkdown = activeArtifact ? activeArtifact.content : fullChatText

  const handleCopy = () => {
    if (!displayedMarkdown) return
    navigator.clipboard.writeText(displayedMarkdown)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSend = () => {
    if (!currentWorker || !inputText.trim()) return
    onSendToWorker(currentWorker.id, inputText.trim())
    setInputText('')
  }

  return (
    <div className="flex flex-col h-full w-full bg-card/95 backdrop-blur-md border-l border-line/80 shadow-xl select-text">
      {/* 顶栏 */}
      <div className="p-3 border-b border-line/60 flex items-center justify-between gap-2 shrink-0 bg-paper-deep/40">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-seal/15 text-seal flex items-center justify-center shrink-0">
            {mode.kind === 'blackboard' ? <LayoutGrid size={13} /> : <Zap size={13} />}
          </div>
          <div className="min-w-0">
            <h3 className="text-[12.5px] font-bold text-ink-strong truncate">
              {mode.kind === 'blackboard'
                ? t('「{0}」共享黑板', agentName)
                : currentWorker?.title || t('交付成果检视')}
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
                  className="px-2 py-0.8 rounded-lg text-[10.5px] font-semibold text-rose-500 hover:bg-rose-500/10 cursor-pointer transition"
                  title={t('中止工单')}
                >
                  <StopCircle size={12} />
                </button>
              )}
              {workers.length > 1 && (
                <select
                  value={currentWorker.id}
                  onChange={(e) => onSelectWorker(e.target.value)}
                  className="px-1.5 py-0.8 rounded-lg text-[10.5px] bg-paper border border-line text-ink cursor-pointer focus:outline-none max-w-[110px] truncate"
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

      {/* 模式 A：黑板视口 */}
      {mode.kind === 'blackboard' ? (
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
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
                className="p-3 rounded-xl bg-paper border border-line/80 hover:border-seal/40 transition cursor-pointer space-y-1.5"
              >
                <div className="flex items-center justify-between text-[11px]">
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
        /* 模式 B：工单交付双页签检视 */
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* 页签切换 */}
          <div className="px-3 py-1.5 border-b border-line/60 bg-paper/60 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('chat')
                  setSelectedArtifactId(null)
                }}
                className={`px-2.5 py-1 rounded-lg text-[11.5px] font-semibold transition cursor-pointer ${
                  activeTab === 'chat' && !selectedArtifactId
                    ? 'bg-seal text-white shadow-2xs'
                    : 'text-ink-subtle hover:text-ink hover:bg-line/40'
                }`}
              >
                {t('交付正文')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('mind')
                  setSelectedArtifactId(null)
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11.5px] font-semibold transition cursor-pointer ${
                  activeTab === 'mind'
                    ? 'bg-seal text-white shadow-2xs'
                    : 'text-ink-subtle hover:text-ink hover:bg-line/40'
                }`}
              >
                <span>{t('执行过程')}</span>
                {mindParts.length > 0 && (
                  <span className="px-1 py-0.2 rounded-full text-[9px] bg-paper text-ink font-bold border border-line">
                    {mindParts.length}
                  </span>
                )}
              </button>
            </div>

            {/* 复制按钮 */}
            {displayedMarkdown && (
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-0.8 rounded-md text-[10.5px] text-ink-faint hover:text-ink transition cursor-pointer"
                title={t('复制当前正文')}
              >
                {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                <span>{copied ? t('已复制') : t('复制')}</span>
              </button>
            )}
          </div>

          {/* 产物子胶囊条（若有） */}
          {currentWorker.artifacts.length > 0 && (
            <div className="px-3 py-1.5 bg-paper-deep/30 border-b border-line/40 flex items-center gap-1.5 overflow-x-auto text-[10.5px] shrink-0">
              <span className="text-ink-faint shrink-0 flex items-center gap-1 font-medium">
                <FileText size={11} className="text-seal" />
                <span>{t('独立产物:')}</span>
              </span>
              {currentWorker.artifacts.map((art) => (
                <button
                  key={art.id}
                  type="button"
                  onClick={() => {
                    setActiveTab('chat')
                    setSelectedArtifactId(art.id)
                  }}
                  className={`px-2 py-0.5 rounded-md border shrink-0 transition cursor-pointer font-medium ${
                    selectedArtifactId === art.id
                      ? 'bg-seal/15 border-seal/40 text-seal font-semibold'
                      : 'bg-card border-line hover:border-seal/30 text-ink-subtle'
                  }`}
                >
                  {art.title}
                </button>
              ))}
            </div>
          )}

          {/* 正文或过程内容区 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {activeTab === 'chat' ? (
              displayedMarkdown ? (
                <div className="text-[12.5px] leading-relaxed text-ink prose-sm">
                  <MarkdownView html={renderNote(displayedMarkdown)} className="moji-agent-md" />
                </div>
              ) : currentWorker.status === 'running' ? (
                <div className="flex flex-col items-center justify-center h-full text-center text-ink-faint py-16 space-y-2">
                  <Loader2 size={18} className="animate-spin text-emerald-500" />
                  <span className="text-[12px]">{t('正在工坊深度探索与撰写成果...')}</span>
                </div>
              ) : (
                <div className="text-[12px] text-ink-faint italic py-8 text-center">
                  {t('该工单已结束，未产出独立交付正文。')}
                </div>
              )
            ) : (
              /* Mind 执行过程 */
              <div className="space-y-2 text-[11.5px]">
                {mindParts.length === 0 ? (
                  <div className="text-[12px] text-ink-faint italic py-8 text-center">
                    {t('暂无思考或工具调用记录')}
                  </div>
                ) : (
                  mindParts.map((part, idx) => {
                    if (part.type === 'thinking') {
                      return (
                        <div
                          key={idx}
                          className="p-2.5 rounded-xl bg-paper-deep/60 border border-line text-ink-subtle italic leading-relaxed"
                        >
                          {part.text}
                        </div>
                      )
                    }
                    if (part.type === 'tool') {
                      return <ToolCard key={idx} part={part} />
                    }
                    return null
                  })
                )}
              </div>
            )}
          </div>

          {/* 底部直连快通道 */}
          <div className="p-3 border-t border-line/60 bg-paper/90 backdrop-blur-md shrink-0">
            <div className="relative rounded-xl border border-line/80 bg-paper-deep/60 focus-within:border-seal/60 focus-within:ring-1 focus-within:ring-seal/20 transition">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder={t('向此工单插队补充要求或追问... (Enter 发送)')}
                className="w-full px-3 py-2 pr-10 text-[12px] bg-transparent focus:outline-none placeholder:text-ink-faint text-ink"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!inputText.trim()}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-seal text-white hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer"
                title={t('发送 (Enter)')}
              >
                <Send size={11} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
