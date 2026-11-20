/**
 * 任务派发裸数据透明化检视器 (TaskRawDataViewer)
 *
 * 核心目标：
 * 做到 100% 透明化展示系统所有跨专家委派、内部 Worker 工单与 Mailbox 静默回执的原始数据与上下文结构。
 */

import { memo, useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Search,
  X,
} from 'lucide-react'
import type { DelegationRecord, ChannelMessage } from '../../../agent/team/types'
import type { AgentViewSnapshot } from '../../../learn/superAgent/useAgentTeam'
import { t } from '../../../i18n'

export interface TaskRawDataViewerProps {
  isOpen?: boolean
  delegations: Record<string, DelegationRecord>
  agents: Record<string, AgentViewSnapshot>
  channelMessages?: ChannelMessage[]
  onClose: () => void
}

type TabKey = 'delegations' | 'workers' | 'mailbox' | 'full'

export const TaskRawDataViewer = memo(function TaskRawDataViewer({
  isOpen = true,
  delegations,
  agents,
  onClose,
}: TaskRawDataViewerProps) {
  if (!isOpen) return null

  const [activeTab, setActiveTab] = useState<TabKey>('delegations')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // 1. 汇总所有跨专家委派单
  const delegationList = useMemo(() => {
    return Object.values(delegations).sort((a, b) => b.createdAt - a.createdAt)
  }, [delegations])

  // 2. 汇总所有专家的 Worker 会话
  const allWorkers = useMemo(() => {
    const list: Array<{ agentId: string; agentName: string; worker: any }> = []
    for (const [agId, snap] of Object.entries(agents)) {
      for (const w of snap.workers) {
        list.push({ agentId: agId, agentName: snap.profile.name, worker: w })
      }
    }
    return list.sort((a, b) => b.worker.createdAt - a.worker.createdAt)
  }, [agents])

  // 3. 汇总所有 Mailbox 回执
  const allReceipts = useMemo(() => {
    const list: Array<{ agentId: string; agentName: string; receipt: any }> = []
    for (const [agId, snap] of Object.entries(agents)) {
      for (const r of snap.state.mailbox) {
        list.push({ agentId: agId, agentName: snap.profile.name, receipt: r })
      }
    }
    return list.sort((a, b) => b.receipt.ts - a.receipt.ts)
  }, [agents])

  // 4. 全量结构快照
  const fullSnapshot = useMemo(() => {
    const agentStates: Record<string, any> = {}
    for (const [id, snap] of Object.entries(agents)) {
      agentStates[id] = snap.state
    }
    return {
      timestamp: Date.now(),
      delegations,
      agentStates,
    }
  }, [delegations, agents])

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  const handleDownload = () => {
    const jsonStr = JSON.stringify(fullSnapshot, null, 2)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `task-dispatch-snapshot-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 select-text">
      <div className="w-full max-w-4xl h-[85vh] bg-card rounded-2xl border border-line shadow-2xl flex flex-col overflow-hidden">
        {/* 顶栏 */}
        <div className="px-4 py-3 border-b border-line/80 flex items-center justify-between gap-3 bg-paper-deep/50 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/15 text-indigo-500 flex items-center justify-center">
              <Code2 size={15} />
            </div>
            <div>
              <h2 className="text-[13.5px] font-bold text-ink-strong flex items-center gap-2">
                <span>{t('任务派发裸数据检视器')}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-500 font-semibold">
                  {t('透明化')}
                </span>
              </h2>
              <p className="text-[10.5px] text-ink-faint">
                {t('实时呈现所有跨专家委派、隔离工坊工单与 Mailbox 控制面原始数据')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-paper border border-line hover:border-line-strong text-ink-subtle transition cursor-pointer"
            >
              <Download size={12} />
              <span>{t('导出快照')}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-ink-faint hover:text-ink hover:bg-line/50 transition cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 控制条：Tab 切换 + 搜索过滤 */}
        <div className="px-4 py-2 border-b border-line/60 bg-paper/60 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1 text-[11.5px]">
            <button
              type="button"
              onClick={() => setActiveTab('delegations')}
              className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                activeTab === 'delegations'
                  ? 'bg-seal text-white shadow-2xs'
                  : 'text-ink-subtle hover:text-ink hover:bg-line/40'
              }`}
            >
              {t('跨专家委派单 ({0})', delegationList.length)}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('workers')}
              className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                activeTab === 'workers'
                  ? 'bg-seal text-white shadow-2xs'
                  : 'text-ink-subtle hover:text-ink hover:bg-line/40'
              }`}
            >
              {t('工坊内部工单 ({0})', allWorkers.length)}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('mailbox')}
              className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                activeTab === 'mailbox'
                  ? 'bg-seal text-white shadow-2xs'
                  : 'text-ink-subtle hover:text-ink hover:bg-line/40'
              }`}
            >
              {t('静默总线回执 ({0})', allReceipts.length)}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('full')}
              className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                activeTab === 'full'
                  ? 'bg-seal text-white shadow-2xs'
                  : 'text-ink-subtle hover:text-ink hover:bg-line/40'
              }`}
            >
              {t('全量快照 (JSON)')}
            </button>
          </div>

          {activeTab !== 'full' && (
            <div className="relative w-48">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('搜索关键字...')}
                className="w-full pl-7 pr-2.5 py-1 text-[11px] bg-paper border border-line rounded-lg text-ink focus:outline-none focus:border-seal/60"
              />
            </div>
          )}
        </div>

        {/* 内容展示区 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {/* 1. 跨专家委派单 */}
          {activeTab === 'delegations' && (
            delegationList.length === 0 ? (
              <div className="text-center text-ink-faint text-[12px] py-16">{t('暂无跨专家委派记录')}</div>
            ) : (
              delegationList
                .filter((d) => !searchQuery || JSON.stringify(d).toLowerCase().includes(searchQuery.toLowerCase()))
                .map((d) => {
                  const isExp = expandedIds.has(d.id)
                  const jsonStr = JSON.stringify(d, null, 2)

                  return (
                    <div key={d.id} className="rounded-xl border border-line/80 bg-paper/80 overflow-hidden text-[12px]">
                      <div
                        onClick={() => toggleExpand(d.id)}
                        className="p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-line/20 transition"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isExp ? <ChevronDown size={14} className="shrink-0 text-ink-faint" /> : <ChevronRight size={14} className="shrink-0 text-ink-faint" />}
                          <span className="font-bold text-ink-strong truncate">{d.task}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-500 font-semibold shrink-0">
                            {d.fromAgentName} ➔ {d.targetAgentName}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold shrink-0 ${
                            d.status === 'done' ? 'bg-emerald-500/10 text-emerald-600' : d.status === 'running' ? 'bg-amber-500/10 text-amber-600' : 'bg-line/60 text-ink-faint'
                          }`}>
                            {d.status}
                          </span>
                        </div>
                        <span className="text-[10px] text-ink-faint shrink-0">
                          {new Date(d.createdAt).toLocaleTimeString()}
                        </span>
                      </div>

                      {isExp && (
                        <div className="p-3 bg-paper-deep/60 border-t border-line/60 relative">
                          <button
                            type="button"
                            onClick={() => handleCopy(jsonStr, d.id)}
                            className="absolute right-3 top-3 flex items-center gap-1 px-2 py-1 rounded bg-card border border-line text-[10.5px] text-ink-subtle hover:text-ink cursor-pointer"
                          >
                            {copiedId === d.id ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                            <span>{copiedId === d.id ? t('已复制') : t('复制 JSON')}</span>
                          </button>
                          <pre className="font-mono text-[11px] text-ink leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-60">
                            {jsonStr}
                          </pre>
                        </div>
                      )}
                    </div>
                  )
                })
            )
          )}

          {/* 2. 工坊内部工单 */}
          {activeTab === 'workers' && (
            allWorkers.length === 0 ? (
              <div className="text-center text-ink-faint text-[12px] py-16">{t('暂无工坊工单记录')}</div>
            ) : (
              allWorkers
                .filter((w) => !searchQuery || JSON.stringify(w).toLowerCase().includes(searchQuery.toLowerCase()))
                .map((w) => {
                  const isExp = expandedIds.has(w.worker.id)
                  const jsonStr = JSON.stringify(w.worker, null, 2)

                  return (
                    <div key={w.worker.id} className="rounded-xl border border-line/80 bg-paper/80 overflow-hidden text-[12px]">
                      <div
                        onClick={() => toggleExpand(w.worker.id)}
                        className="p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-line/20 transition"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isExp ? <ChevronDown size={14} className="shrink-0 text-ink-faint" /> : <ChevronRight size={14} className="shrink-0 text-ink-faint" />}
                          <span className="font-bold text-ink-strong truncate">{w.worker.title}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-line/60 text-ink-faint shrink-0">
                            {w.agentName}
                          </span>
                          <span className="text-[10.5px] text-ink-subtle truncate max-w-xs">{w.worker.goal}</span>
                          <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold shrink-0 ${
                            w.worker.status === 'done' ? 'bg-emerald-500/10 text-emerald-600' : w.worker.status === 'running' ? 'bg-amber-500/10 text-amber-600' : 'bg-line/60 text-ink-faint'
                          }`}>
                            {w.worker.status}
                          </span>
                        </div>
                        <span className="text-[10px] text-ink-faint shrink-0">
                          {new Date(w.worker.createdAt).toLocaleTimeString()}
                        </span>
                      </div>

                      {isExp && (
                        <div className="p-3 bg-paper-deep/60 border-t border-line/60 relative">
                          <button
                            type="button"
                            onClick={() => handleCopy(jsonStr, w.worker.id)}
                            className="absolute right-3 top-3 flex items-center gap-1 px-2 py-1 rounded bg-card border border-line text-[10.5px] text-ink-subtle hover:text-ink cursor-pointer"
                          >
                            {copiedId === w.worker.id ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                            <span>{copiedId === w.worker.id ? t('已复制') : t('复制 JSON')}</span>
                          </button>
                          <pre className="font-mono text-[11px] text-ink leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-60">
                            {jsonStr}
                          </pre>
                        </div>
                      )}
                    </div>
                  )
                })
            )
          )}

          {/* 3. Mailbox 回执 */}
          {activeTab === 'mailbox' && (
            allReceipts.length === 0 ? (
              <div className="text-center text-ink-faint text-[12px] py-16">{t('暂无 Mailbox 静默回执')}</div>
            ) : (
              allReceipts
                .filter((r) => !searchQuery || JSON.stringify(r).toLowerCase().includes(searchQuery.toLowerCase()))
                .map((r) => {
                  const isExp = expandedIds.has(r.receipt.id)
                  const jsonStr = JSON.stringify(r.receipt, null, 2)

                  return (
                    <div key={r.receipt.id} className="rounded-xl border border-line/80 bg-paper/80 overflow-hidden text-[12px]">
                      <div
                        onClick={() => toggleExpand(r.receipt.id)}
                        className="p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-line/20 transition"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isExp ? <ChevronDown size={14} className="shrink-0 text-ink-faint" /> : <ChevronRight size={14} className="shrink-0 text-ink-faint" />}
                          <span className="font-bold text-ink-strong truncate">{r.receipt.title}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-500 shrink-0">
                            {r.agentName}
                          </span>
                          <span className="text-[10.5px] text-ink-subtle truncate max-w-xs">{r.receipt.summary}</span>
                        </div>
                        <span className="text-[10px] text-ink-faint shrink-0">
                          {new Date(r.receipt.ts).toLocaleTimeString()}
                        </span>
                      </div>

                      {isExp && (
                        <div className="p-3 bg-paper-deep/60 border-t border-line/60 relative">
                          <button
                            type="button"
                            onClick={() => handleCopy(jsonStr, r.receipt.id)}
                            className="absolute right-3 top-3 flex items-center gap-1 px-2 py-1 rounded bg-card border border-line text-[10.5px] text-ink-subtle hover:text-ink cursor-pointer"
                          >
                            {copiedId === r.receipt.id ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                            <span>{copiedId === r.receipt.id ? t('已复制') : t('复制 JSON')}</span>
                          </button>
                          <pre className="font-mono text-[11px] text-ink leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-60">
                            {jsonStr}
                          </pre>
                        </div>
                      )}
                    </div>
                  )
                })
            )
          )}

          {/* 4. 全量结构快照 */}
          {activeTab === 'full' && (
            <div className="relative rounded-xl border border-line bg-paper-deep/70 p-4">
              <button
                type="button"
                onClick={() => handleCopy(JSON.stringify(fullSnapshot, null, 2), 'full')}
                className="absolute right-4 top-4 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-card border border-line text-[11px] font-semibold text-ink-subtle hover:text-ink cursor-pointer"
              >
                {copiedId === 'full' ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                <span>{copiedId === 'full' ? t('已复制全部') : t('复制全部快照')}</span>
              </button>
              <pre className="font-mono text-[11px] text-ink leading-relaxed overflow-x-auto whitespace-pre max-h-[60vh]">
                {JSON.stringify(fullSnapshot, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
