import { useState } from 'react'
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Plus,
  Sparkles,
} from 'lucide-react'
import type { KnowledgeNode, LearnStore, OutlineEntry } from '../../../learn/types'
import { CHECK_KIND_LABEL, MASTERY_LABEL, SELF_REPORT_LABEL } from '../../../learn/types'
import { outlineChildNodeOf } from '../../../learn/outline'
import { dueStageOf, pendingStageOf, REVIEW_STAGE_LABEL } from '../../../learn/review'
import { renderInline } from '../../../lib/markdown'
import { t } from '../../../i18n'

/** 「上次学习 9 月 20 日」这类短日期：大纲页里的时间都只到天 */
function dayLabel(at: number): string {
  const d = new Date(at)
  return t('{0} 月 {1} 日', d.getMonth() + 1, d.getDate())
}

/**
 * 一个节点此刻的学习情况，折成几枚精致短签（条目右侧那一排）。
 */
function learningChips(store: LearnStore, node: KnowledgeNode): Array<{ text: string; kind?: 'ok' | 'seal' | 'default' }> {
  const l = node.learning
  const chips: Array<{ text: string; kind?: 'ok' | 'seal' | 'default' }> = []

  if (typeof l?.mastery === 'number') {
    chips.push({
      text: t('掌握度 {0}分', l.mastery),
      kind: l.mastery >= 80 ? 'ok' : 'seal',
    })
  }
  if (l?.self) {
    chips.push({ text: t('自评「{0}」', t(SELF_REPORT_LABEL[l.self])) })
  }
  if (l?.mistakes?.length) {
    chips.push({ text: t('错题记忆 {0}', l.mistakes.length) })
  }
  const checks = l?.checks ?? []
  if (checks.length) {
    const last = checks[checks.length - 1]
    chips.push({
      text:
        typeof last.score === 'number'
          ? t('最近{0} {1} 分', t(CHECK_KIND_LABEL[last.kind]), last.score)
          : t('最近{0}', t(CHECK_KIND_LABEL[last.kind])),
    })
  }
  if (l?.lastStudiedAt) {
    chips.push({ text: t('上次学习 {0}', dayLabel(l.lastStudiedAt)) })
  }
  const exams = store.exams.filter((e) => e.nodeId === node.id).length
  if (exams) {
    chips.push({ text: t('考过 {0} 场', exams) })
  }

  // 复习计划一眼可见：到期了亮出来（含逾期天数），没到期就说下次是哪天哪一档
  const review = node.review
  if (review) {
    const now = Date.now()
    const due = dueStageOf(review, now)
    if (due) {
      chips.push({
        text: t('待复习 · {0}{1}', t(REVIEW_STAGE_LABEL[due.stage]), due.overdueDays > 0 ? t('（逾期 {0} 天）', due.overdueDays) : ''),
        kind: 'seal',
      })
    } else {
      const pending = pendingStageOf(review)
      if (pending) {
        chips.push({
          text: t('下次复习 {0} · {1}', dayLabel(pending.dueAt), t(REVIEW_STAGE_LABEL[pending.stage])),
        })
      }
    }
  }
  return chips
}

export interface LinearOutlineViewProps {
  store: LearnStore
  node: KnowledgeNode
  depth?: number
  onOpenNode: (nodeId: string) => void
  onCreateChild: (parentNode: KnowledgeNode, entry: OutlineEntry) => void
  onGenerate: (node: KnowledgeNode) => void
}

export default function LinearOutlineView({
  store,
  node,
  depth = 0,
  onOpenNode,
  onCreateChild,
  onGenerate,
}: LinearOutlineViewProps) {
  const outline = node.outline ?? null
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (!outline) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong/60 bg-paper/40 p-6 text-center">
        <p className="text-[13px] text-ink-faint">
          {t('这个目标还没有大纲（较早创建的节点不会自动补）。点击上方「生成大纲」，请导师把这一层的计划立起来。')}
        </p>
      </div>
    )
  }

  if (outline.children.length === 0) {
    return (
      <div className="rounded-xl border border-line/50 bg-paper/30 p-5 text-center">
        <p className="text-[13px] text-ink-faint">{t('这一层还没有规划子目标。')}</p>
      </div>
    )
  }

  return (
    <div className={depth > 0 ? 'mt-2 border-l-2 border-seal/30 pl-4.5' : 'space-y-3'}>
      {depth > 0 && (
        <div className="mb-2.5 flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-ink">{node.title}</span>
          <span className="text-[11.5px] text-ink-faint">{t('的下级路线')}</span>
        </div>
      )}

      <ol className="space-y-2.5">
        {outline.children.map((entry, index) => {
          const child = outlineChildNodeOf(store, node, entry)
          const open = expanded.has(entry.key)
          const expandable = !!child?.outline && !!(child.outline.children.length || child.outline.intro)
          const isMastered = child?.status === 'mastered'
          const isLearning = child && child.status !== 'mastered'
          const isUncreated = !child

          return (
            <li
              key={entry.key}
              className={
                'group relative rounded-xl border p-3.5 transition-all ' +
                (isMastered
                  ? 'border-ok/30 bg-paper/80 hover:border-ok/60 hover:bg-paper dark:bg-card/75 dark:hover:bg-card'
                  : isLearning
                    ? 'border-line/70 bg-paper/90 hover:border-seal/50 hover:bg-paper dark:bg-card/85 dark:hover:bg-card'
                    : 'border-dashed border-line-strong/60 bg-paper/40 opacity-90 hover:border-seal/60 hover:opacity-100 dark:bg-card/40')
              }
            >
              <div className="flex items-start gap-3">
                {/* 序号与状态徽标 */}
                <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-paper-deep/80 font-mono text-[11px] font-medium text-ink-faint dark:bg-card">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span
                    aria-hidden="true"
                    className={
                      'h-2 w-2 rounded-full ' +
                      (isMastered
                        ? 'bg-ok shadow-2xs shadow-ok/50'
                        : isLearning
                          ? 'bg-seal shadow-2xs shadow-seal/50'
                          : 'border border-dashed border-ink-faint bg-transparent')
                    }
                  />
                </div>

                <div className="min-w-0 flex-1">
                  {/* 标题与主要操作 */}
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {child ? (
                        <button
                          type="button"
                          onClick={() => onOpenNode(child.id)}
                          title={t('点击打开「{0}」的教学文档', entry.title)}
                          className="text-[14px] font-medium text-ink transition hover:text-seal"
                        >
                          {entry.title}
                        </button>
                      ) : (
                        <span className="text-[14px] font-medium text-ink-soft">{entry.title}</span>
                      )}

                      {isMastered && (
                        <span className="rounded bg-ok/10 px-1.5 py-0.5 text-[10.5px] font-medium text-ok">
                          {t('已掌握')}
                        </span>
                      )}
                      {isLearning && (
                        <span className="rounded bg-seal/10 px-1.5 py-0.5 text-[10.5px] font-medium text-seal">
                          {t(MASTERY_LABEL[child.status])}
                        </span>
                      )}
                      {isUncreated && (
                        <span className="rounded bg-line/60 px-1.5 py-0.5 text-[10.5px] text-ink-faint">
                          {t('未创建')}
                        </span>
                      )}
                    </div>

                    {/* 右侧动作按钮区 */}
                    <div className="flex items-center gap-2">
                      {isUncreated && (
                        <button
                          type="button"
                          onClick={() => onCreateChild(node, entry)}
                          className="flex items-center gap-1 rounded-lg bg-seal/10 px-2.5 py-1 text-[11.5px] font-medium text-seal transition hover:bg-seal/20"
                        >
                          <Plus size={11} />
                          <span>{t('创建并开讲')}</span>
                        </button>
                      )}

                      {child && (
                        <button
                          type="button"
                          onClick={() => onOpenNode(child.id)}
                          className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11.5px] text-ink-soft transition hover:bg-paper-deep hover:text-seal"
                        >
                          <BookOpen size={11} />
                          <span>{t('打开文档')}</span>
                        </button>
                      )}

                      {child && !child.outline && (
                        <button
                          type="button"
                          onClick={() => onGenerate(child)}
                          className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11.5px] text-ink-faint transition hover:bg-paper-deep hover:text-seal"
                        >
                          <Sparkles size={11} />
                          <span>{t('生成大纲')}</span>
                        </button>
                      )}

                      {expandable && (
                        <button
                          type="button"
                          onClick={() => toggle(entry.key)}
                          className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11.5px] font-medium text-ink-soft transition hover:bg-paper-deep hover:text-seal"
                        >
                          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          <span>{open ? t('收起下级') : t('展开下级')}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 摘要说明 */}
                  {entry.summary && (
                    <div
                      className="moji-agent-md moji-outline-summary mt-1.5 text-[12.5px] text-ink-soft"
                      dangerouslySetInnerHTML={{ __html: renderInline(entry.summary) }}
                    />
                  )}

                  {/* 学习情况标签组 */}
                  {child && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {learningChips(store, child).map((chip) => (
                        <span
                          key={chip.text}
                          className={
                            'rounded-md px-1.5 py-0.5 text-[11px] ' +
                            (chip.kind === 'ok'
                              ? 'bg-ok/10 text-ok font-medium'
                              : chip.kind === 'seal'
                                ? 'bg-seal/10 text-seal font-medium'
                                : 'bg-paper-deep/70 text-ink-faint dark:bg-card')
                          }
                        >
                          {chip.text}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 展开的子目标递归大纲 */}
              {expandable && open && child && (
                <div className="mt-2.5 pt-2">
                  <LinearOutlineView
                    store={store}
                    node={child}
                    depth={depth + 1}
                    onOpenNode={onOpenNode}
                    onCreateChild={onCreateChild}
                    onGenerate={onGenerate}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
