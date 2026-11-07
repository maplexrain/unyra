/**
 * 随笔 Tab 的**一级页面：随笔列表**（搬自 EssayDock，纯搬运）。
 *
 * 摆三样：操作栏（新建一条 / 提交全部 / 提交记录入口）、随笔列表项、空态引导。
 * 只做展示：数据与回调逐项从宿主（EssayDock）传进来，流转（去抖落库、收尾、
 * 落盘）都在 useEssayEditor。
 */
import { GitCommitHorizontal, History, PenLine, Plus, Trash2 } from 'lucide-react'
import type { EssayEntry } from '../../../learn/types'
import { essayPreview } from '../../../learn/essays'
import { t } from '../../../i18n'
import { timeLabel, titleOf } from './essayLabels'

interface Props {
  /** 这个目标的随笔（新的在前） */
  essays: EssayEntry[]
  /** 提交记录条数（历史入口右上角的小圆点；提交记录是目标级的） */
  commitCount: number
  /** 这次有没有东西可提交（与上次提交相比有变化，或编辑器里有没落库的字） */
  commitVisible: boolean
  /** 新建一条空白随笔 */
  onStartBlank: () => void
  /** 打开提交整理页（宿主会先把去抖中的正文落库） */
  onOpenCommitPanel: () => void
  /** 打开提交记录（timeline） */
  onOpenHistory: () => void
  /** 打开指定随笔编辑（二级页面） */
  onOpenEssay: (essay: EssayEntry) => void
  /** 删除这条随笔 */
  onRemoveEssay: (id: string) => void
}

export function EssayList({
  essays,
  commitCount,
  commitVisible,
  onStartBlank,
  onOpenCommitPanel,
  onOpenHistory,
  onOpenEssay,
  onRemoveEssay,
}: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-card">
      {/* 操作栏 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line/80 px-3 py-2 bg-paper/40">
        <span className="text-[11.5px] font-medium text-ink-strong">
          {t('随笔列表')}
          <span className="ml-1 text-[10.5px] font-normal text-ink-faint">({essays.length})</span>
        </span>
        <span className="min-w-0 flex-1" aria-hidden="true" />
        <button
          type="button"
          onClick={onStartBlank}
          title={t('新建一条随笔')}
          className="flex h-6 shrink-0 items-center gap-1 rounded-none bg-seal px-2 text-[10.5px] font-medium text-white shadow-xs transition hover:bg-seal-deep"
        >
          <Plus size={12} />
          {t('新建随笔')}
        </button>
        <button
          type="button"
          onClick={onOpenCommitPanel}
          disabled={!commitVisible}
          title={
            commitVisible
              ? t('提交全部随笔：带上全部内容，AI 按与上次的差异统一整理')
              : t('和上次提交相比没有变化')
          }
          className="flex h-6 shrink-0 items-center gap-1 rounded-none bg-seal/10 px-1.5 text-[10.5px] font-medium text-seal-deep transition hover:bg-seal/15 disabled:cursor-default disabled:opacity-40"
        >
          <GitCommitHorizontal size={12} />
          {t('提交全部…')}
        </button>
        <button
          type="button"
          onClick={onOpenHistory}
          title={t('提交记录')}
          aria-label={t('提交记录')}
          className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-none text-ink-faint transition hover:bg-line/60 hover:text-ink"
        >
          <History size={13} />
          {commitCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-3 min-w-3 items-center justify-center rounded-none bg-seal px-0.5 text-[8px] leading-none text-white">
              {commitCount > 9 ? '9+' : commitCount}
            </span>
          )}
        </button>
      </div>

      {/* 随笔列表项 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {essays.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-12 text-center text-ink-faint">
            <PenLine size={28} className="text-line-strong/60 mb-2" />
            <p className="text-[12px]">{t('还没有随笔')}</p>
            <p className="text-[10.5px] text-ink-faint mt-1 max-w-[260px]">
              {t('随笔是目标级的灵感记录，随时记下你的思考与疑问，并可一键提交给 AI 整理。')}
            </p>
            <button
              type="button"
              onClick={onStartBlank}
              className="mt-3 inline-flex items-center gap-1 rounded-none bg-seal/10 px-2.5 py-1 text-[11px] font-medium text-seal transition hover:bg-seal/20"
            >
              <Plus size={12} />
              {t('记一条随笔')}
            </button>
          </div>
        ) : (
          essays.map((essay) => (
            <div
              key={essay.id}
              onClick={() => onOpenEssay(essay)}
              className="group relative cursor-pointer rounded-none border border-line bg-paper/60 p-2.5 transition hover:border-seal/45 hover:bg-paper hover:shadow-xs"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[12px] font-medium text-ink-strong">
                  {titleOf(essay)}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
                  {timeLabel(essay.updatedAt)}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-soft">
                {essayPreview(essay.text, 140) || t('（空随笔）')}
              </p>
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-ink-faint">
                <span>{t('{0} 字', essay.text.length)}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemoveEssay(essay.id)
                  }}
                  title={t('删除这条随笔')}
                  aria-label={t('删除')}
                  className="opacity-0 group-hover:opacity-100 flex h-5 w-5 items-center justify-center rounded-none text-ink-faint transition hover:bg-line/60 hover:text-seal-deep"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
