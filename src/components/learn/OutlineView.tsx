/*
 * 这个文件负责：大纲页（页签 kind 'outline'）——一个目标的路线图。
 *
 * 它不是源码/预览那种文档视图：大纲是结构化的计划（导语 + 直接子目标清单，
 * 见 learn/types 的 OutlineDoc），打开就是交互页——每个条目带着那个子目标
 * 此刻的学习情况（自评、掌握度、检验、错误记忆、最近学习），可以展开；
 * 展开读到的就是那个子目标自己的大纲（数据都在本 store 里，展开是即时的——
 * 「提前获取」在这里天生成立），逐层下去直到叶子。
 *
 * 深度规矩是数据形状保证的（OutlineEntry 没有可以再嵌套的地方）：这一页只列
 * 直接子层级，「爷爷知道儿子的存在，但不知道孙子的存在」。
 */

import { useState } from 'react'
import type { KnowledgeNode, LearnStore, OutlineEntry } from '../../learn/types'
import { CHECK_KIND_LABEL, MASTERY_LABEL, SELF_REPORT_LABEL } from '../../learn/types'
import { outlineChildNodeOf } from '../../learn/outline'
import { dueStageOf, pendingStageOf, REVIEW_STAGE_LABEL } from '../../learn/review'
import MarkdownView from '../MarkdownView'
import { renderInline, renderNote } from '../../lib/markdown'
import { t } from '../../i18n'

/** 「上次学习 9 月 20 日」这类短日期：大纲页里的时间都只到天 */
function dayLabel(at: number): string {
  const d = new Date(at)
  return t('{0} 月 {1} 日', d.getMonth() + 1, d.getDate())
}

/**
 * 一个节点此刻的学习情况，折成几枚短签（条目右侧那一排）。
 * 只报事实：自评是谁给的、掌握度怎么来的，点开教学文档与状态面板都有；这里不重复那些解释。
 */
function learningChips(store: LearnStore, node: KnowledgeNode): string[] {
  const l = node.learning
  const chips: string[] = [t(MASTERY_LABEL[node.status])]
  if (typeof l?.mastery === 'number') chips.push(t('掌握度 {0}', l.mastery))
  if (l?.self) chips.push(t('自评「{0}」', t(SELF_REPORT_LABEL[l.self])))
  if (l?.mistakes?.length) chips.push(t('错误记忆 {0}', l.mistakes.length))
  const checks = l?.checks ?? []
  if (checks.length) {
    const last = checks[checks.length - 1]
    chips.push(
      typeof last.score === 'number'
        ? t('最近{0} {1} 分', t(CHECK_KIND_LABEL[last.kind]), last.score)
        : t('最近{0}', t(CHECK_KIND_LABEL[last.kind])),
    )
  }
  if (l?.lastStudiedAt) chips.push(t('上次学习 {0}', dayLabel(l.lastStudiedAt)))
  const exams = store.exams.filter((e) => e.nodeId === node.id).length
  if (exams) chips.push(t('考过 {0} 场', exams))
  // 复习计划一眼可见：到期了亮出来（含逾期天数），没到期就说下次是哪天哪一档
  const review = node.review
  if (review) {
    const now = Date.now()
    const due = dueStageOf(review, now)
    if (due) {
      chips.push(
        t('待复习 · {0}{1}', t(REVIEW_STAGE_LABEL[due.stage]), due.overdueDays > 0 ? t('（逾期 {0} 天）', due.overdueDays) : ''),
      )
    } else {
      const pending = pendingStageOf(review)
      if (pending) {
        chips.push(t('下次复习 {0} · {1}', dayLabel(pending.dueAt), t(REVIEW_STAGE_LABEL[pending.stage])))
      }
    }
  }
  return chips
}

export interface OutlineViewProps {
  store: LearnStore
  /** 这一页大纲属于哪个目标 */
  node: KnowledgeNode
  /** 嵌套深度：0 是页签根（带页头），子目标展开后从 1 起（只渲染那一层） */
  depth?: number
  /** 打开某个子目标的教学文档 */
  onOpenNode: (nodeId: string) => void
  /** 把大纲里还没创建的子目标真的建出来（交给导师开讲） */
  onCreateChild: (parentNode: KnowledgeNode, entry: OutlineEntry) => void
  /** 请导师规划 / 重排某个节点的大纲 */
  onGenerate: (node: KnowledgeNode) => void
}

export default function OutlineView({
  store,
  node,
  depth = 0,
  onOpenNode,
  onCreateChild,
  onGenerate,
}: OutlineViewProps) {
  const outline = node.outline ?? null
  /*
   * 大纲页上的文字都是导师写的，话里就可能带 markdown（加粗、清单、公式）：走与对话
   * 正文同一套管线渲染。renderNote 自带净化与内容级缓存，这里不手动 useMemo——
   * 依赖是嵌套属性，手写依赖反而和 React Compiler 的推断对不上，会让它放弃优化整个组件。
   */
  const descHtml = node.description ? renderNote(node.description) : ''
  const introHtml = outline?.intro ? renderNote(outline.intro) : ''
  /** 展开的是哪些子条目（按条目的 key）；每一层自己记自己的，收起不影响别层 */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const isRoot = depth === 0
  /** 目标分级：目标的根是总目标，其余都是阶段目标 */
  const goalBadge = store.goals.some((g) => g.rootNodeId === node.id) ? t('总目标') : t('阶段目标')

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className={isRoot ? 'mx-auto w-full max-w-[780px] px-8 py-7' : 'pb-2 pl-5 pr-2'}>
        {isRoot && (
          <header className="mb-5">
            <div className="flex items-baseline gap-2.5">
              <span className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-soft">
                {goalBadge}
              </span>
              <h2 className="text-[17px] font-semibold text-ink">{node.title}</h2>
              <span className="text-[12px] text-ink-faint">{t(MASTERY_LABEL[node.status])}</span>
            </div>
            {node.description && (
              <MarkdownView html={descHtml} className="moji-agent-md moji-outline-desc mt-1.5" />
            )}
            {outline?.intro && (
              <MarkdownView
                html={introHtml}
                className="moji-agent-md moji-outline-intro mt-3 border-l-2 border-line pl-3"
              />
            )}
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => onGenerate(node)}
                className="rounded border border-line px-2.5 py-1 text-[12px] text-ink-soft transition hover:border-seal/60 hover:text-seal"
              >
                {outline ? t('重排大纲') : t('请导师生成大纲')}
              </button>
              <span className="text-[11.5px] text-ink-faint">
                {t('大纲只列直接子层级；展开一个子目标，看到的是它自己的大纲')}
              </span>
            </div>
          </header>
        )}
        {!isRoot && (
          <div className="flex items-baseline gap-2 pt-1.5">
            <h3 className="text-[14px] font-medium text-ink">{node.title}</h3>
            <span className="text-[11.5px] text-ink-faint">{t('的大纲')}</span>
          </div>
        )}

        {!outline ? (
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-faint">
            {t('这个目标还没有大纲（较早创建的节点不会自动补）。点上面那颗按钮，请导师把这一层的计划立起来。')}
          </p>
        ) : outline.children.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-ink-faint">{t('这一层还没有规划子目标。')}</p>
        ) : (
          <ol className="mt-1">
            {outline.children.map((entry) => {
              const child = outlineChildNodeOf(store, node, entry)
              const open = expanded.has(entry.key)
              const expandable = !!child?.outline && !!(child.outline.children.length || child.outline.intro)
              return (
                <li key={entry.key} className="border-l border-line pl-4">
                  <div className="flex items-start gap-2.5 py-2.5">
                    {/* 状态点：灰 = 还没创建，红点 = 学习中，绿 = 已掌握 */}
                    <span
                      aria-hidden="true"
                      className={
                        'mt-[7px] h-2 w-2 shrink-0 rounded-full ' +
                        (child ? (child.status === 'mastered' ? 'bg-ok' : 'bg-seal') : 'bg-line')
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {child ? (
                          <button
                            type="button"
                            onClick={() => onOpenNode(child.id)}
                            title={t('打开这个目标的教学文档')}
                            className="text-[13.5px] font-medium text-ink transition hover:text-seal"
                          >
                            {entry.title}
                          </button>
                        ) : (
                          <span className="text-[13.5px] font-medium text-ink-faint">{entry.title}</span>
                        )}
                        {!child && (
                          <button
                            type="button"
                            onClick={() => onCreateChild(node, entry)}
                            className="rounded bg-seal/10 px-2 py-0.5 text-[11.5px] text-seal transition hover:bg-seal/20"
                          >
                            {t('创建并开讲')}
                          </button>
                        )}
                        {child && !child.outline && (
                          <button
                            type="button"
                            onClick={() => onGenerate(child)}
                            className="text-[11.5px] text-ink-faint transition hover:text-seal"
                          >
                            {t('生成它的大纲')}
                          </button>
                        )}
                        {expandable && (
                          <button
                            type="button"
                            onClick={() => toggle(entry.key)}
                            className="text-[11.5px] text-ink-faint transition hover:text-seal"
                          >
                            {open ? t('收起') : t('展开')}
                          </button>
                        )}
                      </div>
                      {/* 摘要是行内短句：renderInline 去掉 <p> 壳（内容已过 DOMPurify，见 lib/markdown），
                          与 DocOutline 条目的做法一致——不为此多挂一层 MarkdownView 的链接/插件接管 */}
                      {entry.summary && (
                        <div
                          className="moji-agent-md moji-outline-summary mt-0.5"
                          dangerouslySetInnerHTML={{ __html: renderInline(entry.summary) }}
                        />
                      )}
                      {child && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {learningChips(store, child).map((chip) => (
                            <span key={chip} className="rounded bg-paper px-1.5 py-0.5 text-[11px] text-ink-faint">
                              {chip}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {expandable && open && child && (
                    <div className="pb-2">
                      <OutlineView
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
        )}
      </div>
    </div>
  )
}
