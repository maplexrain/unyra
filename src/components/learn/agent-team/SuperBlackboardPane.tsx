/**
 * 外置共享黑板视口 (SuperBlackboardPane)
 *
 * 核心功能：
 * 1. 顶栏实时搜索：调用 searchBlackboard 纯函数实现加权关键字过滤；
 * 2. 结构化卡片：展示工单状态、目标、成果摘要、标签与产物计数；
 * 3. 零跳转通道：点击卡片一键跳转到对应 Worker 视口。
 */

import { memo, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  LayoutGrid,
  Search,
  Tag,
  X,
} from 'lucide-react'
import type { BlackboardEntry, WorkerStatus } from '../../../agent/super/types'
import { searchBlackboard } from '../../../agent/super/blackboard'
import { t } from '../../../i18n'

export interface SuperBlackboardPaneProps {
  blackboard: BlackboardEntry[]
  onSelectWorker: (workerId: string) => void
  onBackToHost?: () => void
}

function StatusPill({ status }: { status: WorkerStatus }) {
  const map: Record<WorkerStatus, { label: string; cls: string }> = {
    running: { label: t('运行中'), cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
    waiting_input: { label: t('等待输入'), cls: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
    done: { label: t('已交付'), cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
    failed: { label: t('失败'), cls: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' },
    cancelled: { label: t('已中止'), cls: 'bg-line text-ink-faint' },
    idle: { label: t('排队中'), cls: 'bg-line text-ink-faint' },
  }
  const item = map[status] ?? { label: status, cls: 'bg-line text-ink-faint' }
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${item.cls}`}>
      {item.label}
    </span>
  )
}

export const SuperBlackboardPane = memo(function SuperBlackboardPane({
  blackboard,
  onSelectWorker,
  onBackToHost,
}: SuperBlackboardPaneProps) {
  const [query, setQuery] = useState('')

  const filteredEntries = useMemo(() => {
    return searchBlackboard(blackboard, query)
  }, [blackboard, query])

  return (
    <div className="flex flex-col h-full w-full bg-paper select-text overflow-hidden">
      {/* 顶栏 */}
      <div className="px-5 py-3 border-b border-line/60 bg-paper/80 backdrop-blur-xs flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {onBackToHost && (
            <button
              type="button"
              onClick={onBackToHost}
              className="p-1.5 -ml-1 text-ink-faint hover:text-seal rounded-lg hover:bg-line/40 transition cursor-pointer"
              title={t('返回前台主控')}
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <div className="w-8 h-8 rounded-xl bg-indigo-500/15 text-indigo-500 flex items-center justify-center shrink-0">
            <LayoutGrid size={17} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold text-ink-strong truncate">
                {t('外置共享黑板 (Blackboard)')}
              </span>
              <span className="px-2 py-0.2 rounded-full bg-line text-ink-faint text-[11px] font-medium">
                {blackboard.length} {t('条工单')}
              </span>
            </div>
            <div className="text-[11.5px] text-ink-faint truncate">
              {t('结构化元数据索引 · 跨任务检索 · 零拷贝资产')}
            </div>
          </div>
        </div>

        {/* 关键字搜索输入框 */}
        <div className="relative w-64">
          <Search size={13} className="absolute left-2.5 top-2.5 text-ink-faint" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('搜索工单、目标或标签...')}
            className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-card border border-line text-[12px] text-ink placeholder:text-ink-faint outline-none focus:border-seal/60 focus:ring-1 focus:ring-seal/30 transition"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-2 text-ink-faint hover:text-ink cursor-pointer"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* 黑板卡片列表 */}
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {filteredEntries.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 select-none text-ink-faint">
            <LayoutGrid size={32} className="mb-2 opacity-30" />
            <p className="text-[13px]">{query ? t('未找到匹配的工单') : t('黑板暂无记录')}</p>
          </div>
        ) : (
          filteredEntries.map((entry) => (
            <div
              key={entry.workerId}
              onClick={() => onSelectWorker(entry.workerId)}
              className="group p-4 rounded-2xl bg-card border border-line/60 hover:border-seal/40 transition shadow-2xs hover:shadow-xs cursor-pointer space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[13.5px] font-bold text-ink-strong truncate group-hover:text-seal transition">
                    {entry.title}
                  </span>
                  <StatusPill status={entry.status} />
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectWorker(entry.workerId)
                  }}
                  className="flex items-center gap-1 text-[11px] font-semibold text-seal opacity-80 group-hover:opacity-100 transition"
                >
                  <span>{t('进入工单')}</span>
                  <ExternalLink size={11} />
                </button>
              </div>

              <div className="text-[12px] text-ink-faint line-clamp-1">{entry.goal}</div>

              {entry.summary && (
                <div className="p-2.5 rounded-xl bg-paper/60 border border-line/40 text-[12px] text-ink-soft leading-relaxed line-clamp-3">
                  {entry.summary}
                </div>
              )}

              <div className="flex items-center justify-between pt-1 text-[11px] text-ink-faint">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {entry.tags.map((tg) => (
                    <span
                      key={tg}
                      className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-line/60 text-ink-soft text-[10.5px]"
                    >
                      <Tag size={9} />
                      <span>{tg}</span>
                    </span>
                  ))}
                  {entry.artifactIds && entry.artifactIds.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-seal font-medium text-[10.5px]">
                      <FileText size={11} />
                      <span>{entry.artifactIds.length} {t('项产物')}</span>
                    </span>
                  )}
                </div>
                <span>{new Date(entry.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
})
