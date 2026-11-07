/*
 * 本文件负责：思维导图里的**预览子节点卡片**（PreviewNodeCard）——只读预览教学文档、
 * 笔记、试卷/考试记录、超级文档，尺寸 500×700，挂在父节点旁边当子节点。
 * 原样搬自 MindmapView.tsx，注释一并带走。
 */
import { useEffect, useMemo, useRef } from 'react'
import { FileText, FlaskConical, X } from 'lucide-react'
import type { LearnStore } from '../../../learn/types'
import { notesOf } from '../../../learn/types'
import { findNote } from '../../../learn/notes'
import { readSuperDoc } from '../../../learn/superdocs'
import type { ExamActions, NodeDocActions } from '../explorer/types'
import { t } from '../../../i18n'
import MarkdownView from '../../MarkdownView'
import { renderInline, renderNote } from '../../../lib/markdown'
import {
  attemptScore,
  examTotalPoints,
  QUESTION_TYPE_LABEL,
} from '../../../learn/exam'
import type { ActivePreviewInfo, MindmapNodeData } from './mindmapTypes'
import { PREVIEW_TYPE_THEME } from './mindmapTypes'

/**
 * 预览子节点卡片：
 * 尺寸 400 * 600，只读预览教学文档、笔记、试卷/考试记录、超级文档。
 * 顶部带有类型徽章、标题、在页签栏打开的按钮（指向右上箭头）、关闭按钮。
 * 当相机选中该卡片时自动调整缩放和居中。
 */
export function PreviewNodeCard({
  item,
  activePreview,
  store,
  docs,
  exams,
  onOpenNode,
  onClose,
  onSelect,
  selected,
  isClosing,
}: {
  item: MindmapNodeData
  activePreview: ActivePreviewInfo
  store: LearnStore
  docs: NodeDocActions
  exams: ExamActions
  onOpenNode: (nodeId: string) => void
  onClose: () => void
  onSelect: () => void
  selected: boolean
  isClosing?: boolean
}) {
  const theme = PREVIEW_TYPE_THEME[activePreview.kind]
  const parentNode = store.nodes.find((n) => n.id === activePreview.parentNodeId)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // 保证卡片内滚动不被外层画布的 wheel 监听器拦截或触发画布平移
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // 未按住 Ctrl/Cmd 键时，阻止事件冒泡到画布容器，允许容器原生滚动浏览
      if (!e.ctrlKey && !e.metaKey) {
        e.stopPropagation()
      }
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const handleOpenInTab = (e: React.MouseEvent) => {
    e.stopPropagation()
    switch (activePreview.kind) {
      case 'doc':
        onOpenNode(activePreview.parentNodeId)
        break
      case 'note':
        if (activePreview.noteName) {
          docs.onOpenNote(activePreview.parentNodeId, activePreview.noteName)
        }
        break
      case 'super':
        if (activePreview.superName) {
          docs.onOpenSuperDoc(activePreview.parentNodeId, activePreview.superName)
        }
        break
      case 'exam':
        if (activePreview.attemptId && activePreview.examId) {
          docs.onOpenAttempt(activePreview.parentNodeId, activePreview.examId, activePreview.attemptId)
        } else if (activePreview.examId) {
          exams.onStart(activePreview.parentNodeId, activePreview.examId)
        }
        break
    }
  }

  // 根据不同类型获取内容
  const docMarkdown = useMemo(() => {
    if (activePreview.kind === 'doc') {
      return parentNode?.docs?.teaching ?? ''
    }
    if (activePreview.kind === 'note' && parentNode && activePreview.noteName) {
      const n = findNote(notesOf(parentNode), activePreview.noteName)
      return n?.content ?? ''
    }
    return ''
  }, [activePreview, parentNode])

  const docHtml = useMemo(() => {
    if (activePreview.kind === 'doc' || activePreview.kind === 'note') {
      return renderNote(docMarkdown)
    }
    return ''
  }, [activePreview.kind, docMarkdown])

  const superDoc = useMemo(() => {
    if (activePreview.kind !== 'super' || !activePreview.superName) return null
    return readSuperDoc(store, activePreview.parentNodeId, activePreview.superName)
  }, [activePreview, store])

  const exam = useMemo(() => {
    if (activePreview.kind !== 'exam' || !activePreview.examId) return null
    return store.exams.find((e) => e.id === activePreview.examId)
  }, [activePreview, store.exams])

  const attempt = useMemo(() => {
    if (!exam || !activePreview.attemptId) return null
    return exam.attempts.find((a) => a.id === activePreview.attemptId)
  }, [exam, activePreview.attemptId])

  const attemptScoreVal = attempt ? attemptScore(attempt) : null
  const totalPoints = exam ? examTotalPoints(exam) : 0

  return (
    <div
      role="region"
      tabIndex={0}
      data-mm-card=""
      data-preview-card=""
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      onMouseDown={(e) => {
        // 阻止 mousedown 冒泡到画布容器，防止拖动滚动条或选中文本时意外触发画布平移
        e.stopPropagation()
      }}
      style={{
        left: item.x,
        top: item.y,
        width: item.width,
        height: item.height,
        borderColor: theme.border,
        boxShadow: selected
          ? `0 0 0 2px ${theme.border}, 0 16px 36px -8px rgba(0,0,0,0.22)`
          : '0 8px 24px -6px rgba(0,0,0,0.12)',
      }}
      className={`absolute flex flex-col rounded-2xl border-2 bg-paper text-ink dark:bg-card z-20 select-none overflow-hidden transition-[left,top,box-shadow,border-color] duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${
        isClosing ? 'moji-preview-collapse' : 'moji-preview-sprout'
      }`}
    >
      {/* 顶部标题栏 */}
      <div
        className="flex h-11 shrink-0 items-center justify-between border-b px-3 gap-2"
        style={{
          borderColor: `${theme.border}40`,
          backgroundColor: `${theme.border}12`,
        }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold text-white shadow-2xs"
            style={{ backgroundColor: theme.color }}
          >
            {theme.label}
          </span>
          <button
            type="button"
            onClick={handleOpenInTab}
            title={t('在页签栏打开《{0}》', activePreview.title)}
            className="truncate text-left text-[12px] font-bold text-seal underline decoration-seal/40 decoration-1 underline-offset-[3px] transition hover:text-seal-deep hover:decoration-seal cursor-pointer"
          >
            {activePreview.title}
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            title={t('关闭预览')}
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-ink-soft transition hover:bg-black/10 dark:hover:bg-white/10 hover:text-ink cursor-pointer"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* 正文区域（只读） */}
      <div
        ref={scrollRef}
        data-preview-scroll=""
        className="flex-1 min-h-0 overflow-y-auto p-4 select-text"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {(activePreview.kind === 'doc' || activePreview.kind === 'note') && (
          docMarkdown.trim() ? (
            <MarkdownView html={docHtml} className="text-[12px] leading-relaxed" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-ink-faint text-[12px]">
              <FileText size={28} className="mb-2 opacity-30" />
              <span>{activePreview.kind === 'doc' ? t('还没有教学文档内容') : t('笔记内容为空')}</span>
            </div>
          )
        )}

        {activePreview.kind === 'super' && (
          superDoc?.html ? (
            <iframe
              srcDoc={superDoc.html}
              sandbox="allow-scripts"
              className="h-full w-full border-0 rounded-lg bg-card"
              title={activePreview.title}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-ink-faint text-[12px]">
              <FlaskConical size={28} className="mb-2 opacity-30" />
              <span>{t('超级文档内容为空')}</span>
            </div>
          )
        )}

        {activePreview.kind === 'exam' && exam && (
          <div className="flex flex-col gap-3 text-[12px]">
            {attempt ? (
              <>
                <div className="flex items-center justify-between rounded-xl border border-line bg-line/20 p-2.5">
                  <div>
                    <span className="text-[11px] text-ink-faint">{t('得分')}</span>
                    <div className="text-[16px] font-bold text-ink">
                      {attemptScoreVal != null ? `${attemptScoreVal} / ${totalPoints} 分` : t('未判分')}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      attempt.passed ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {attempt.passed ? t('已通过') : t('未通过')}
                  </span>
                </div>

                {attempt.explanation && (
                  <div className="rounded-xl border border-line bg-card/60 p-3">
                    <div className="text-[11px] font-semibold text-ink-soft mb-1.5">{t('错题讲解 / 解析')}</div>
                    <MarkdownView html={renderNote(attempt.explanation)} className="text-[11.5px] leading-relaxed" />
                  </div>
                )}

                <div className="space-y-2 mt-1">
                  <div className="text-[11px] font-semibold text-ink-soft">{t('作答详情 ({0} 题)', exam.questions.length)}</div>
                  {exam.questions.map((q, idx) => {
                    const ans = attempt.answers.find((a) => a.questionId === q.id)
                    const res = attempt.results?.find((r) => r.questionId === q.id)
                    return (
                      <div key={q.id} className="rounded-lg border border-line/60 bg-card/40 p-2.5">
                        <div className="flex items-center justify-between mb-1.5 text-[11px] font-medium text-ink">
                          <div className="flex items-center gap-1.5">
                            <span className="text-ink-faint">#{idx + 1}</span>
                            <span className="rounded bg-line/60 px-1 py-0.5 text-[10px] text-ink-soft">
                              {QUESTION_TYPE_LABEL[q.type] || q.type}
                            </span>
                            <span className="text-[10px] text-ink-faint tabular-nums">
                              {t('（{0} 分）', q.points)}
                            </span>
                          </div>
                          {res?.correct != null && (
                            <span className={`text-[10px] font-semibold ${res.correct ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                              {res.correct ? t('正确') : t('错误')}
                              {res.score != null ? ` (${res.score}分)` : ''}
                            </span>
                          )}
                        </div>

                        {/* 题干 Markdown 渲染 */}
                        <div className="text-[11.5px] leading-relaxed text-ink mb-1.5">
                          <MarkdownView html={renderNote(q.stem)} className="text-[11.5px]" />
                        </div>

                        {/* 配图 */}
                        {q.image && (
                          <div className="my-1.5 flex justify-center rounded border border-line/60 bg-paper/30 p-2 moji-exam-figure" dangerouslySetInnerHTML={{ __html: q.image }} />
                        )}

                        {/* 选项作答 */}
                        {q.options && (
                          <div className="pl-2 space-y-1 text-[11px] text-ink-soft">
                            {q.options.map((opt) => {
                              const isChosen = ans?.value?.includes(opt.id)
                              return (
                                <div key={opt.id} className={`flex items-start gap-1.5 ${isChosen ? 'font-semibold text-seal' : ''}`}>
                                  <span className="shrink-0">{opt.id}.</span>
                                  <span className="flex-1 min-w-0" dangerouslySetInnerHTML={{ __html: renderInline(opt.text) }} />
                                  {isChosen && (
                                    <span className="shrink-0 rounded bg-seal/15 px-1 py-0.2 text-[9.5px] text-seal-deep">
                                      {t('你的选择')}
                                    </span>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {/* 非选择题的作答 */}
                        {(q.type === 'fill' || q.type === 'short') && ans?.text && (
                          <div className="mt-1.5 rounded border border-line/60 bg-paper/40 p-2 text-[11px] text-ink-soft">
                            <span className="text-[10px] font-semibold text-ink-faint block mb-0.5">{t('你的作答：')}</span>
                            <div className="text-[11px] leading-relaxed text-ink">
                              <MarkdownView html={renderNote(ans.text)} className="text-[11px]" />
                            </div>
                          </div>
                        )}

                        {/* 评语 Markdown 渲染 */}
                        {res?.comment && (
                          <div className="mt-2 rounded bg-amber-500/10 border border-amber-500/20 p-2 text-[11px] text-amber-700 dark:text-amber-300">
                            <div className="font-semibold mb-0.5 text-[10px]">{t('评语')}</div>
                            <div className="text-[11px] leading-relaxed">
                              <MarkdownView html={renderNote(res.comment)} className="text-[11px]" />
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center text-ink-faint">
                <p className="text-[12px]">{t('试卷本身不支持预览，请在考试记录中查看作答副本')}</p>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => exams.onStart(activePreview.parentNodeId, exam.id)}
                    className="rounded-xl bg-seal px-3.5 py-1.5 text-center text-[12px] font-semibold text-white shadow-2xs hover:bg-seal-deep transition cursor-pointer"
                  >
                    {t('在页签栏开考')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
