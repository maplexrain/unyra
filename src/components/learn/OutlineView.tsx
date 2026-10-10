/*
 * 这个文件负责：大纲页（页签 kind 'outline'）——一个目标的路线图。
 *
 * 它支持两种视图无缝切换：
 * 1. 线性大纲列表：分层条目卡片、学习情况标签与下级折叠展开；
 * 2. 完全展开的思维导图：以当前节点为根，完全展开其下级子孙节点（不包含父级节点）。
 */

import { useState } from 'react'
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  GitFork,
  ListTree,
  Sparkles,
} from 'lucide-react'
import type { KnowledgeNode, LearnStore, OutlineEntry } from '../../learn/types'
import { MASTERY_LABEL } from '../../learn/types'
import MarkdownView from '../MarkdownView'
import { renderNote } from '../../lib/markdown'
import { t } from '../../i18n'
import LinearOutlineView from './outline/LinearOutlineView'
import MindmapView from './outline/MindmapView'

export interface OutlineViewProps {
  store: LearnStore
  /** 这一页大纲属于哪个目标 */
  node: KnowledgeNode
  /** 嵌套深度：0 是页签根（带页头） */
  depth?: number
  /** 打开某个子目标的教学文档 */
  onOpenNode: (nodeId: string) => void
  /** 把大纲里还没创建的子目标真的建出来（交给导师开讲） */
  onCreateChild: (parentNode: KnowledgeNode, entry: OutlineEntry) => void
  /** 请导师规划 / 重排某个节点的大纲 */
  onGenerate: (node: KnowledgeNode) => void
}

export type OutlineViewMode = 'linear' | 'mindmap'

const STORAGE_KEY = 'moji_outline_view_mode_v2'

export default function OutlineView({
  store,
  node,
  depth = 0,
  onOpenNode,
  onCreateChild,
  onGenerate,
}: OutlineViewProps) {
  const outline = node.outline ?? null
  const descHtml = node.description ? renderNote(node.description) : ''
  const introHtml = outline?.intro ? renderNote(outline.intro) : ''

  const [viewMode, setViewMode] = useState<OutlineViewMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === 'linear' || saved === 'mindmap') return saved
    } catch {
      // ignore
    }
    return 'mindmap'
  })

  const [detailsOpen, setDetailsOpen] = useState(false)

  const switchMode = (mode: OutlineViewMode) => {
    setViewMode(mode)
    try {
      localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      // ignore
    }
  }

  const isRootGoal = store.goals.some((g) => g.rootNodeId === node.id)
  const goalBadge = isRootGoal ? t('总目标') : t('阶段目标')
  const hasNotesOrIntro = !!(node.description || outline?.intro)

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-paper dark:bg-card/30">
      {/* 顶部大纲工具栏与视图切换器 */}
      <header className="shrink-0 border-b border-line/50 bg-paper/95 px-6 py-4 shadow-2xs backdrop-blur-md dark:bg-card/90">
        <div className="mx-auto flex max-w-[960px] flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          {/* 左侧：目标标题与身份徽标 */}
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="shrink-0 rounded-full border border-seal/30 bg-seal/10 px-2 py-0.5 text-[11px] font-semibold text-seal">
              {goalBadge}
            </span>
            <h2 className="truncate text-[16px] font-bold text-ink" title={node.title}>
              {node.title}
            </h2>
            <span className="shrink-0 rounded-md bg-paper-deep px-1.5 py-0.5 text-[11px] font-medium text-ink-soft dark:bg-card">
              {t(MASTERY_LABEL[node.status])}
            </span>

            {hasNotesOrIntro && (
              <button
                type="button"
                onClick={() => setDetailsOpen((v) => !v)}
                className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11.5px] text-ink-faint transition hover:bg-paper-deep hover:text-ink"
              >
                <span>{detailsOpen ? t('收起导语') : t('查看导语')}</span>
                {detailsOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
            )}
          </div>

          {/* 右侧：视图切换 Tab 与动作按钮 */}
          <div className="flex items-center gap-2.5">
            {/* 视图切换器 Tab（线性大纲 / 思维导图） */}
            <div className="flex items-center rounded-xl border border-line/60 bg-paper-deep/70 p-0.5 dark:bg-card">
              <button
                type="button"
                onClick={() => switchMode('linear')}
                className={
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-all ' +
                  (viewMode === 'linear'
                    ? 'bg-paper text-ink shadow-xs dark:bg-card dark:text-ink-strong'
                    : 'text-ink-soft hover:text-ink')
                }
              >
                <ListTree size={13} className={viewMode === 'linear' ? 'text-seal' : ''} />
                <span>{t('线性大纲')}</span>
              </button>

              <button
                type="button"
                onClick={() => switchMode('mindmap')}
                className={
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-all ' +
                  (viewMode === 'mindmap'
                    ? 'bg-paper text-ink shadow-xs dark:bg-card dark:text-ink-strong'
                    : 'text-ink-soft hover:text-ink')
                }
              >
                <GitFork size={13} className={viewMode === 'mindmap' ? 'text-seal' : ''} />
                <span>{t('思维导图')}</span>
              </button>
            </div>

            <div className="h-4 w-px bg-line/50" />

            {/* 导师大纲操作 */}
            <button
              type="button"
              onClick={() => onGenerate(node)}
              className="flex items-center gap-1.5 rounded-xl border border-line px-2.5 py-1 text-[12px] text-ink-soft transition hover:border-seal/60 hover:text-seal"
            >
              <Sparkles size={12} />
              <span>{outline ? t('重排大纲') : t('请导师生成大纲')}</span>
            </button>

            {/* 打开当前目标教学文档 */}
            <button
              type="button"
              onClick={() => onOpenNode(node.id)}
              title={t('打开当前目标的教学文档')}
              className="flex items-center gap-1 rounded-xl border border-line px-2 py-1 text-[12px] text-ink-soft transition hover:border-line-strong hover:text-ink"
            >
              <BookOpen size={12} />
              <span>{t('教学文档')}</span>
            </button>
          </div>
        </div>

        {/* 展开的导语与说明 */}
        {detailsOpen && hasNotesOrIntro && (
          <div className="mx-auto mt-3 max-w-[960px] rounded-xl border border-line/50 bg-paper-deep/40 p-3.5 dark:bg-card/40">
            {node.description && (
              <MarkdownView html={descHtml} className="moji-agent-md moji-outline-desc text-[12.5px]" />
            )}
            {outline?.intro && (
              <MarkdownView
                html={introHtml}
                className="moji-agent-md moji-outline-intro mt-2 border-l-2 border-seal/40 pl-3 text-[12.5px]"
              />
            )}
          </div>
        )}
      </header>

      {/* 视图内容区 */}
      <div className="relative min-h-0 flex-1">
        {viewMode === 'mindmap' ? (
          <MindmapView
            store={store}
            node={node}
            onOpenNode={onOpenNode}
            onCreateChild={onCreateChild}
            onGenerate={onGenerate}
          />
        ) : (
          <div className="h-full overflow-y-auto px-6 py-6">
            <div className="mx-auto w-full max-w-[840px]">
              <LinearOutlineView
                store={store}
                node={node}
                depth={depth}
                onOpenNode={onOpenNode}
                onCreateChild={onCreateChild}
                onGenerate={onGenerate}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
