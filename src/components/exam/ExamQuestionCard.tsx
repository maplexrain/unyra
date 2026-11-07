/*
 * 本文件负责：考试窗口的**题目卡片**（QuestionBlock）——单道题的排版与作答控件
 * （填空 / 简答 / 判断 / 单选 / 多选）。纯展示组件：逐项 props + 内联回调，
 * 自己不持有作答状态，答案的变化通过 onChange 抛给宿主（ExamWindow.tsx 门面）。
 *
 * 原样搬自 ExamWindow.tsx（注释一并带走）。别处引用这里的渲染口径时注意：
 * 选项渲染与 agent 面板的 AskFormCard 是同一套（见那边注释）。
 */
import { useMemo } from 'react'
import { Check, X } from 'lucide-react'
import type { ExamQuestion } from '../../learn/exam'
import { QUESTION_TYPE_LABEL } from '../../learn/exam'
import { renderInline } from '../../lib/markdown'
import { t } from '../../i18n'
import { isBlank } from './examDraft'
import type { Draft } from './examDraft'

const TYPE_THEMES: Record<string, { cls: string }> = {
  single: { cls: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300' },
  multiple: { cls: 'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300' },
  truefalse: { cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  fill: { cls: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  short: { cls: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300' },
}

/** 紧凑题目卡片：排版舒适，杜绝臃肿卡牌 */
export function QuestionBlock({
  index,
  question,
  draft,
  current,
  onChange,
  register,
}: {
  index: number
  question: ExamQuestion
  draft: Draft
  current: boolean
  onChange: (next: Draft, advance?: boolean) => void
  register: (el: HTMLDivElement | null) => void
}) {
  const stemHtml = useMemo(() => renderInline(question.stem), [question.stem])
  const isJudgement = question.type === 'truefalse'
  const options = isJudgement
    ? [
        { id: 'true', text: t('对') },
        { id: 'false', text: t('错') },
      ]
    : (question.options ?? [])

  const toggle = (id: string): void => {
    if (question.type === 'single' || question.type === 'truefalse') {
      onChange({ ...draft, value: [id], text: '' }, true)
      return
    }
    const has = draft.value.includes(id)
    onChange({ ...draft, value: has ? draft.value.filter((x) => x !== id) : [...draft.value, id], text: '' }, false)
  }

  const isDone = !isBlank(question, draft)
  const typeTheme = TYPE_THEMES[question.type] ?? {
    cls: 'border-line bg-line/50 text-ink-soft',
  }

  return (
    <div
      ref={register}
      className={
        'relative rounded-lg border transition-colors duration-150 p-4 ' +
        (current
          ? 'border-seal/60 bg-card shadow-2xs ring-1 ring-seal/25'
          : 'border-line/70 bg-card/90 hover:border-line-strong')
      }
    >
      {/* 题头栏：题号、题型、分值、作答状态 */}
      <div className="flex items-center justify-between gap-2 border-b border-line/40 pb-2">
        <div className="flex items-center gap-1.5">
          <span
            className={
              'flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold tabular-nums transition-colors ' +
              (isDone
                ? 'bg-seal/15 text-seal-deep border border-seal/30'
                : 'bg-line/60 text-ink-soft')
            }
          >
            {index}
          </span>
          <span className={'rounded px-1.5 py-px text-[10.5px] font-medium border ' + typeTheme.cls}>
            {t(QUESTION_TYPE_LABEL[question.type])}
          </span>
          <span className="text-[10.5px] tabular-nums text-ink-faint">
            {t('（{0} 分）', question.points)}
          </span>
        </div>
        <div>
          {isDone ? (
            <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-400">
              <Check size={10} strokeWidth={2.5} />
              {t('已作答')}
            </span>
          ) : (
            <span className="rounded bg-line/40 px-2 py-0.5 text-[10.5px] text-ink-faint">
              {t('待作答')}
            </span>
          )}
        </div>
      </div>

      {/* 题干 */}
      <div className="mt-2.5 text-[13px] leading-[1.75] text-ink-strong" dangerouslySetInnerHTML={{ __html: stemHtml }} />

      {question.image && (
        <div className="my-2.5 flex justify-center rounded border border-line/60 bg-paper/30 p-2.5 moji-exam-figure" dangerouslySetInnerHTML={{ __html: question.image }} />
      )}

      {/* 作答区 */}
      {question.type === 'fill' ? (
        <div className="mt-3">
          <input
            value={draft.text}
            onChange={(e) => onChange({ ...draft, value: [], text: e.target.value })}
            placeholder={t('在这里填写答案（手写在答卷上的可在顶部统一拍照上传）')}
            spellCheck={false}
            className="w-full rounded border border-line bg-paper/40 px-3 py-1.5 text-[13px] text-ink outline-none transition placeholder:text-ink-faint focus:border-seal/60 focus:bg-card focus:ring-1 focus:ring-seal/15"
          />
        </div>
      ) : question.type === 'short' ? (
        <div className="mt-3">
          <textarea
            value={draft.text}
            onChange={(e) => onChange({ ...draft, value: [], text: e.target.value })}
            rows={3}
            placeholder={t('在这里作答（手写在答卷上的可在顶部统一拍照上传）')}
            spellCheck={false}
            className="w-full resize-y rounded border border-line bg-paper/40 px-3 py-1.5 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-seal/60 focus:bg-card focus:ring-1 focus:ring-seal/15"
          />
        </div>
      ) : isJudgement ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {options.map((o) => {
            const on = draft.value.includes(o.id)
            const isTrue = o.id === 'true'
            return (
              <label
                key={o.id}
                className={
                  'flex cursor-pointer items-center justify-center gap-2 rounded border py-1.5 px-3 transition-colors select-none text-[13px] ' +
                  (on
                    ? (isTrue
                        ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 font-semibold'
                        : 'border-rose-500/60 bg-rose-500/10 text-rose-800 dark:text-rose-300 font-semibold')
                    : 'border-line/70 bg-paper/30 text-ink hover:border-line-strong hover:bg-paper/70')
                }
              >
                <input
                  type="radio"
                  name={'exam-q-' + question.id}
                  checked={on}
                  onChange={() => toggle(o.id)}
                  className="sr-only"
                />
                {isTrue ? <Check size={14} strokeWidth={2.5} /> : <X size={14} strokeWidth={2.5} />}
                <span>{o.text}</span>
              </label>
            )
          })}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5">
          {options.map((o) => {
            const on = draft.value.includes(o.id)
            return (
              <label
                key={o.id}
                className={
                  'group flex items-start gap-2.5 rounded px-2.5 py-1.5 cursor-pointer transition-colors select-none text-[13px] border ' +
                  (on
                    ? 'border-seal/40 bg-seal/[0.08] text-ink-strong font-medium'
                    : 'border-transparent text-ink hover:bg-paper/60')
                }
              >
                <span
                  className={
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold transition-colors ' +
                    (on ? 'bg-seal text-paper' : 'bg-line/60 text-ink-soft group-hover:bg-line')
                  }
                >
                  {o.id}
                </span>
                <div
                  className="min-w-0 flex-1 leading-snug"
                  dangerouslySetInnerHTML={{ __html: renderInline(o.text) }}
                />
                <input
                  type={question.type === 'multiple' ? 'checkbox' : 'radio'}
                  name={'exam-q-' + question.id}
                  checked={on}
                  onChange={() => toggle(o.id)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-seal"
                />
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
