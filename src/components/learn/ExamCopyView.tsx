import { useState, type CSSProperties } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  History,
  ListChecks,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Timer,
  X,
} from 'lucide-react'
import type { Exam, ExamAnswer, ExamAttempt, ExamQuestion, ExamResultItem } from '../../learn/exam'
import {
  EXAM_KIND_LABEL,
  EXAM_LEVEL_LABEL,
  EXAM_PHASE_LABEL,
  QUESTION_TYPE_LABEL,
  attemptBrief,
  hasAnswerValue,
} from '../../learn/exam'
import { inputCountOf, inputTimeline } from '../../learn/examRecords'
import { renderInline, renderNote } from '../../lib/markdown'
import { pad2 } from '../../lib/time'
import MarkdownView from '../MarkdownView'
import { t } from '../../i18n'

/**
 * 试卷副本：某一次考试的只读报告呈现。
 *
 * 设计准则：
 * 1. 高信息密度与空间利用率：杜绝大半径臃肿卡牌与无谓留白，首屏高效呈现成绩与核心诊断。
 * 2. 纸墨美学与层级克制：圆角一律采用小半径（rounded-lg / rounded-md），选项使用轻量化行内对比条。
 * 3. 严格语义色：绿=对，红=错，不随外观主题漂移。
 */

function stamp(ts: number): string {
  const d = new Date(ts)
  const year = d.getFullYear() === new Date().getFullYear() ? '' : t('{0} 年 ', d.getFullYear())
  return t('{0}{1} 月 {2} 日 {3}:{4}', year, d.getMonth() + 1, d.getDate(), pad2(d.getHours()), pad2(d.getMinutes()))
}

function clockOf(ts: number): string {
  const d = new Date(ts)
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
}

function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m ? t('{0} 分 {1} 秒', m, s) : t('{0} 秒', s)
}

function seconds(ms: number): string {
  return t('{0} 秒', Math.round(Math.max(0, ms) / 1000))
}

function formatAnswer(q: ExamQuestion, answer: string[]): string {
  if (q.type === 'truefalse') return answer[0] === 'true' ? t('对') : t('错')
  if (q.type === 'single' || q.type === 'multiple') {
    return answer
      .map((id) => {
        const o = q.options?.find((x) => x.id === id)
        return o ? id + '. ' + renderInline(o.text) : id
      })
      .join('；')
  }
  return answer.map((x) => renderInline(x)).join('；')
}

const WRONG_FG = '#c0392b'
const WRONG_BG = 'rgba(192, 57, 43, 0.12)'
const RIGHT_FG = '#2f7d4f'
const RIGHT_BG = 'rgba(47, 125, 79, 0.14)'

interface Props {
  exam: Exam
  attempt: ExamAttempt
}

export default function ExamCopyView({ exam, attempt }: Props) {
  const brief = attemptBrief(exam, attempt)
  const inputs = attempt.inputs ?? []
  const answers = attempt.answers ?? []
  const blurs = attempt.blurs ?? []
  const dwell = attempt.dwell ?? {}

  const [tutorOpen, setTutorOpen] = useState(true)
  const [telemetryOpen, setTelemetryOpen] = useState(false)

  const labelOf = (questionId: string): string => {
    const i = exam.questions.findIndex((q) => q.id === questionId)
    return i < 0 ? t('已不在卷子里的题目') : t('第 {0} 题', i + 1)
  }

  const timeline = inputTimeline({ ...attempt, inputs }, labelOf)
  const dwellRows = Object.entries(dwell)
    .filter(([, ms]) => ms > 0)
    .sort((a, b) => b[1] - a[1])
  const maxDwellMs = dwellRows.length > 0 ? dwellRows[0][1] : 1
  const avgDwellMs = dwellRows.length > 0 ? Math.round(Object.values(dwell).reduce((a, b) => a + b, 0) / dwellRows.length) : 0
  const completionRate = brief.questionCount > 0 ? Math.round((brief.answered / brief.questionCount) * 100) : 0

  const edited = exam.questions.filter((q) => inputCountOf({ ...attempt, inputs }, q.id) > 1)
  const abandoned = attempt.status === 'abandoned'
  const ongoing = attempt.status === 'ongoing'

  const scrollToReviewQuestion = (questionId: string) => {
    const el = document.getElementById(`exam-review-q-${questionId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="h-full overflow-y-auto bg-card select-text">
      <div className="doc-measure px-5 py-5 sm:px-6">
        {/* --- 紧凑高效成绩总览看板 --- */}
        <section className="rounded-lg border border-line bg-card p-4 shadow-2xs">
          {/* 标头行 */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/50 pb-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-[15px] font-bold text-ink-strong truncate">{exam.title}</h1>
              <div className="flex items-center gap-1 text-[10.5px]">
                <span className="rounded bg-line/60 px-1.5 py-px text-ink-soft">{t(EXAM_KIND_LABEL[exam.kind])}</span>
                <span className="rounded bg-line/60 px-1.5 py-px text-ink-soft">{t(EXAM_LEVEL_LABEL[exam.level])}</span>
                <span className="rounded bg-line/60 px-1.5 py-px text-ink-soft">
                  {exam.minutes === 0 ? t('不限时') : t('{0} 分钟', exam.minutes)}
                </span>
                <span className="rounded bg-seal/10 px-1.5 py-px text-seal-deep font-medium">
                  {t(EXAM_PHASE_LABEL[attempt.status])}
                </span>
                <span className="text-ink-faint tabular-nums ml-1">{t('共 {0} 题', exam.questions.length)}</span>
              </div>
            </div>
            <div className="text-[11px] text-ink-faint shrink-0">
              <span>{stamp(attempt.startedAt)}</span>
              {attempt.endedAt && <span className="ml-2">{t('交卷：{0}', clockOf(attempt.endedAt))}</span>}
            </div>
          </div>

          {/* 紧凑 5 栏横向 KPI 指标流 */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5 sm:divide-x sm:divide-line/50">
            {/* 得分与合格状态 */}
            <div className="pr-2">
              <div className="text-[10.5px] text-ink-faint">{t('得分')}</div>
              <div className="mt-0.5 flex items-baseline gap-1">
                <span className="text-[24px] font-black tracking-tight text-ink-strong leading-none tabular-nums">
                  {abandoned ? '0' : brief.score === null ? '—' : brief.score}
                </span>
                <span className="text-[12.5px] font-medium text-ink-faint tabular-nums">
                  / {brief.total}
                </span>
              </div>
              <div className="mt-1.5">
                {abandoned ? (
                  <span className="inline-block rounded bg-line/60 px-1.5 py-px text-[10.5px] font-medium text-ink-soft">
                    {t('已放弃 · 0 分')}
                  </span>
                ) : ongoing ? (
                  <span className="inline-block rounded bg-amber-500/10 px-1.5 py-px text-[10.5px] font-medium text-amber-700 dark:text-amber-400">
                    {t('还在考')}
                  </span>
                ) : brief.score === null ? (
                  <span className="inline-block rounded bg-line/60 px-1.5 py-px text-[10.5px] font-medium text-ink-soft">
                    {t('待判分')}
                  </span>
                ) : attempt.passed ? (
                  <span
                    style={{ color: RIGHT_FG, background: RIGHT_BG }}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-px text-[10.5px] font-bold"
                  >
                    <Check size={11} strokeWidth={3} />
                    <span>{t('合格 · PASS')}</span>
                  </span>
                ) : (
                  <span
                    style={{ color: WRONG_FG, background: WRONG_BG }}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-px text-[10.5px] font-bold"
                  >
                    <X size={11} strokeWidth={3} />
                    <span>{t('需复习 · RETAKE')}</span>
                  </span>
                )}
              </div>
            </div>

            {/* 作答完成率 */}
            <div className="sm:pl-3">
              <div className="flex items-center gap-1 text-[10.5px] text-ink-faint">
                <ListChecks size={12} className="text-seal" />
                <span>{t('作答完成率')}</span>
              </div>
              <div className="mt-1 text-[13.5px] font-bold text-ink-strong tabular-nums">
                {brief.answered} / {brief.questionCount} <span className="text-[10.5px] font-normal text-ink-faint">题</span>
              </div>
              <div className="mt-0.5 text-[10.5px] text-ink-faint">{completionRate}% {t('完成')}</div>
            </div>

            {/* 考试用时 */}
            <div className="sm:pl-3">
              <div className="flex items-center gap-1 text-[10.5px] text-ink-faint">
                <Clock size={12} className="text-seal" />
                <span>{t('考试用时')}</span>
              </div>
              <div className="mt-1 text-[13.5px] font-bold text-ink-strong tabular-nums">
                {duration(brief.durationMs)}
              </div>
              <div className="mt-0.5 text-[10.5px] text-ink-faint">
                {avgDwellMs > 0 ? t('单题均耗 {0}', seconds(avgDwellMs)) : t('正常用时')}
              </div>
            </div>

            {/* 专注防窥 */}
            <div className="sm:pl-3">
              <div className="flex items-center gap-1 text-[10.5px] text-ink-faint">
                {blurs.length === 0 ? (
                  <ShieldCheck size={12} className="text-emerald-600" />
                ) : (
                  <ShieldAlert size={12} className="text-amber-600" />
                )}
                <span>{t('专注作答')}</span>
              </div>
              <div className="mt-1 text-[13.5px] font-bold text-ink-strong tabular-nums">
                {blurs.length === 0 ? t('全神贯注') : t('{0} 次', brief.blurCount)}
              </div>
              <div className="mt-0.5 text-[10.5px] text-ink-faint">
                {blurs.length === 0 ? t('0 次离屏') : t('共 {0}', duration(brief.blurMs))}
              </div>
            </div>

            {/* 考试时限 */}
            <div className="sm:pl-3">
              <div className="flex items-center gap-1 text-[10.5px] text-ink-faint">
                {brief.overtimeMs > 0 ? (
                  <AlertTriangle size={12} className="text-amber-600" />
                ) : (
                  <Timer size={12} className="text-seal" />
                )}
                <span>{t('时限')}</span>
              </div>
              <div className="mt-1 text-[13.5px] font-bold text-ink-strong tabular-nums">
                {brief.overtimeMs > 0 ? t('超时 {0}', duration(brief.overtimeMs)) : t('时限内完成')}
              </div>
              <div className="mt-0.5 text-[10.5px] text-ink-faint">
                {brief.overtimeInputs > 0
                  ? t('{0} 笔超时作答', brief.overtimeInputs)
                  : exam.minutes > 0
                    ? t('{0} 分钟', exam.minutes)
                    : t('不限时')}
              </div>
            </div>
          </div>

          {/* 紧凑答题卡导航条 */}
          <div className="mt-3 border-t border-line/50 pt-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[11px] font-medium text-ink-soft mr-1">{t('答题卡导航')}:</span>
              {exam.questions.map((q, i) => {
                const r = attempt.results?.find((x) => x.questionId === q.id)
                const a = answers.find((x) => x.questionId === q.id)
                const answered = hasAnswerValue(a)
                const isRight = r?.correct === true
                const isWrong = r?.correct === false

                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => scrollToReviewQuestion(q.id)}
                    title={t('{0}. {1} · {2} 分', i + 1, t(QUESTION_TYPE_LABEL[q.type]), q.points)}
                    style={
                      isRight
                        ? { color: RIGHT_FG, background: RIGHT_BG, borderColor: RIGHT_FG }
                        : isWrong
                          ? { color: WRONG_FG, background: WRONG_BG, borderColor: WRONG_FG }
                          : undefined
                    }
                    className={
                      'flex h-6 min-w-6 items-center justify-center rounded border px-1 text-[11px] font-semibold tabular-nums transition hover:border-ink-strong ' +
                      (!answered || (!isRight && !isWrong)
                        ? 'border-line-strong bg-paper/40 text-ink-faint hover:text-ink'
                        : '')
                    }
                  >
                    {i + 1}
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-2.5 text-[10.5px] text-ink-faint">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: RIGHT_FG }} />
                <span>{t('正确')}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: WRONG_FG }} />
                <span>{t('错误')}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-line-strong" />
                <span>{t('未作答')}</span>
              </span>
            </div>
          </div>
        </section>

        {/* --- AI 导师错题深度诊断卡片 --- */}
        {attempt.explanation ? (
          <div className="mt-3.5 rounded-lg border border-seal/30 bg-paper/20 p-3.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-seal" />
                <h2 className="text-[13px] font-bold text-ink-strong">
                  {t('AI 导师错题深度诊断与复习建议')}
                </h2>
                <span className="text-[10.5px] text-ink-faint">
                  ({t('{0} 字', attempt.explanation.length)})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setTutorOpen((v) => !v)}
                className="flex items-center gap-1 rounded border border-line bg-card px-2 py-0.5 text-[11px] font-medium text-ink-soft transition hover:text-ink hover:bg-paper"
              >
                <span>{tutorOpen ? t('收起诊断') : t('展开诊断')}</span>
                <ChevronDown size={11} className={'transition-transform duration-200 ' + (tutorOpen ? '' : 'rotate-180')} />
              </button>
            </div>
            {tutorOpen && (
              <div className="mt-2.5 border-t border-line/60 pt-2.5 text-[12.5px] leading-relaxed">
                <MarkdownView html={renderNote(attempt.explanation)} className="moji-agent-md" />
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 rounded border border-line bg-paper/30 p-2.5 text-[11.5px] leading-relaxed text-ink-faint">
            {abandoned
              ? t('这一次是放弃的：按 0 分记，导师不会判分，也不会写错题讲解（放弃的考试没有「错在哪」可讲）。')
              : t('这一次还没有错题讲解。') + (attempt.status === 'submitted' ? t('（阅卷还没跑完）') : '')}
          </div>
        )}

        {/* --- 题目回看列表 --- */}
        <section className="mt-4">
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-ink-strong">{t('题目回看')}</h2>
            <span className="text-[11px] text-ink-faint">{t('共 {0} 题', exam.questions.length)}</span>
          </div>

          <div className="flex flex-col gap-2.5">
            {exam.questions.map((q, i) => (
              <QuestionReview
                key={q.id}
                question={q}
                index={i}
                answer={answers.find((a) => a.questionId === q.id)}
                result={attempt.results?.find((r) => r.questionId === q.id)}
              />
            ))}
          </div>
        </section>

        {/* --- 考情过程与行为审计抽屉 --- */}
        <section className="mt-4 rounded-lg border border-line bg-paper/20 p-3">
          <div
            onClick={() => setTelemetryOpen((v) => !v)}
            className="flex cursor-pointer items-center justify-between select-none"
          >
            <div className="flex items-center gap-1.5">
              <History size={14} className="text-seal" />
              <span className="text-[12.5px] font-semibold text-ink-strong">{t('考情过程与行为审计')}</span>
              <span className="text-[10.5px] text-ink-faint">({t('输入顺序、耗时排行、切屏日志')})</span>
            </div>
            <button
              type="button"
              className="flex items-center gap-1 text-[11px] font-medium text-ink-soft transition hover:text-ink"
            >
              <span>{telemetryOpen ? t('收起记录') : t('展开记录')}</span>
              <ChevronDown size={12} className={'transition-transform duration-200 ' + (telemetryOpen ? '' : 'rotate-180')} />
            </button>
          </div>

          {telemetryOpen && (
            <div className="mt-3 border-t border-line/60 pt-3 flex flex-col gap-4 text-[11px] leading-relaxed">
              {/* 输入流水 */}
              <div>
                <div className="font-medium text-ink-strong">{t('输入流水（共 {0} 笔）', inputs.length)}</div>
                {timeline.length ? (
                  <ol className="mt-1 flex flex-col gap-0.5 text-ink-soft pl-4 list-decimal">
                    {timeline.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-0.5 text-ink-faint">{t('没有留下任何输入记录。')}</p>
                )}
              </div>

              {/* 单题耗时排行 */}
              <div>
                <div className="font-medium text-ink-strong">{t('单题耗时排行（倒序）')}</div>
                {dwellRows.length ? (
                  <div className="mt-1.5 flex flex-col gap-1">
                    {dwellRows.map(([questionId, ms]) => {
                      const pct = Math.round((ms / maxDwellMs) * 100)
                      return (
                        <div key={questionId} className="flex items-center gap-2">
                          <span className="w-20 shrink-0 text-ink-soft truncate">{labelOf(questionId)}</span>
                          <div className="flex-1 h-2 rounded bg-line/60 overflow-hidden">
                            <div
                              className="h-full bg-seal/70 rounded transition-all duration-300"
                              style={{ width: `${Math.max(4, pct)}%` }}
                            />
                          </div>
                          <span className="w-14 shrink-0 text-right text-ink-faint tabular-nums">{seconds(ms)}</span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="mt-0.5 text-ink-faint">{t('没有单题耗时（这一场可能很早就结束了）。')}</p>
                )}
              </div>

              {/* 改题记录 */}
              <div>
                <div className="font-medium text-ink-strong">{t('改题记录')}</div>
                {edited.length ? (
                  <ul className="mt-1 flex flex-col gap-0.5 text-ink-soft">
                    {edited.map((q) => (
                      <li key={q.id}>
                        {labelOf(q.id)} · {t('{0} 笔', inputCountOf({ ...attempt, inputs }, q.id))}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-0.5 text-ink-faint">{t('没有改过的题（每题都是一次输入落定）。')}</p>
                )}
              </div>

              {/* 切屏记录 */}
              <div>
                <div className="font-medium text-ink-strong">{t('切屏记录')}</div>
                {blurs.length ? (
                  <ul className="mt-1 flex flex-col gap-0.5 text-ink-soft">
                    {blurs.map((b, i) => (
                      <li key={b.start + '-' + i}>
                        {t('{0} 离开 · {1}', clockOf(b.start), duration(b.ms))}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-0.5 text-ink-faint">{t('整场没有离开过考试窗口。')}</p>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/** 紧凑题目讲评卡片 */
function QuestionReview({
  question: q,
  index,
  answer,
  result,
}: {
  question: ExamQuestion
  index: number
  answer: ExamAnswer | undefined
  result: ExamResultItem | undefined
}) {
  const picked = answer?.value ?? []
  const key = q.answer ?? []
  const hasKey = key.length > 0
  const isCorrect = result?.correct === true
  const isWrong = result?.correct === false
  const answered = hasAnswerValue(answer)

  return (
    <div
      id={'exam-review-q-' + q.id}
      className={
        'rounded-lg border bg-card p-4 shadow-2xs scroll-mt-14 transition-colors ' +
        (isWrong
          ? 'border-red-500/30'
          : isCorrect
            ? 'border-emerald-500/30'
            : 'border-line/70')
      }
    >
      {/* 题头：序号、题型、分值、结果状态徽标 */}
      <div className="flex items-center justify-between gap-2 border-b border-line/40 pb-2">
        <div className="flex items-center gap-1.5">
          <span
            style={
              isCorrect
                ? { color: RIGHT_FG, background: RIGHT_BG, borderColor: RIGHT_FG }
                : isWrong
                  ? { color: WRONG_FG, background: WRONG_BG, borderColor: WRONG_FG }
                  : undefined
            }
            className={
              'flex h-5 w-5 items-center justify-center rounded border text-[11px] font-bold tabular-nums ' +
              (!isCorrect && !isWrong ? 'border-line bg-line/50 text-ink-soft' : '')
            }
          >
            {index + 1}
          </span>
          <span className="rounded bg-line/60 px-1.5 py-px text-[10.5px] font-medium text-ink-soft">
            {t(QUESTION_TYPE_LABEL[q.type])}
          </span>
          <span className="text-[10.5px] tabular-nums text-ink-faint">
            {t('（{0} 分）', q.points)}
          </span>
        </div>

        <div>
          {isCorrect ? (
            <span
              style={{ color: RIGHT_FG, background: RIGHT_BG }}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[10.5px] font-bold"
            >
              <Check size={10} strokeWidth={3} />
              <span>{t('回答正确 · 得 {0} 分', result.score)}</span>
            </span>
          ) : isWrong ? (
            <span
              style={{ color: WRONG_FG, background: WRONG_BG }}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[10.5px] font-bold"
            >
              <X size={10} strokeWidth={3} />
              <span>{t('回答错误 · 得 {0} 分', result.score)}</span>
            </span>
          ) : !answered ? (
            <span className="rounded bg-line/60 px-2 py-0.5 text-[10.5px] text-ink-faint">
              {t('未作答 · 得 0 分')}
            </span>
          ) : (
            <span className="rounded bg-line/60 px-2 py-0.5 text-[10.5px] text-ink-soft">
              {t('待判分 · 满分 {0} 分', q.points)}
            </span>
          )}
        </div>
      </div>

      {/* 题干（Markdown + LaTeX） */}
      <div className="mt-2.5 text-[13px] leading-[1.75] text-ink-strong">
        <MarkdownView html={renderNote(q.stem)} className="moji-agent-md" />
      </div>

      {/* 配图 */}
      {q.image && (
        <div className="my-2.5 flex justify-center rounded border border-line/60 bg-paper/30 p-2.5 moji-exam-figure" dangerouslySetInnerHTML={{ __html: q.image }} />
      )}

      {/* 选项作答比对：轻量条目，绝非大圆角卡牌 */}
      {q.type === 'single' || q.type === 'multiple' || q.type === 'truefalse' ? (
        <div className="mt-2.5 flex flex-col gap-1">
          {(q.options ?? []).map((o) => {
            const chosen = picked.includes(o.id)
            const isKey = hasKey && key.includes(o.id)
            const isRightChoice = isKey && chosen
            const isWrongChoice = !isKey && chosen && hasKey
            const isMissedKey = isKey && !chosen

            return (
              <div
                key={o.id}
                className={
                  'flex items-center gap-2 rounded px-2.5 py-1.5 text-[12.5px] transition-colors ' +
                  (isRightChoice
                    ? 'bg-emerald-500/10 text-emerald-900 dark:text-emerald-200 font-medium'
                    : isWrongChoice
                      ? 'bg-rose-500/10 text-rose-900 dark:text-rose-200 font-medium'
                      : isMissedKey
                        ? 'border border-dashed border-emerald-500/50 bg-emerald-500/[0.04] text-emerald-800 dark:text-emerald-300'
                        : 'text-ink-soft')
                }
              >
                {/* 序号徽章 */}
                {q.type !== 'truefalse' && (
                  <span
                    className={
                      'flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded text-[11px] font-bold ' +
                      (isRightChoice || isMissedKey
                        ? 'bg-emerald-600 text-white'
                        : isWrongChoice
                          ? 'bg-rose-600 text-white'
                          : 'bg-line/60 text-ink-soft')
                    }
                  >
                    {o.id}
                  </span>
                )}

                {/* 选项文本 */}
                <div
                  className="min-w-0 flex-1 leading-snug"
                  dangerouslySetInnerHTML={{
                    __html: renderInline(q.type === 'truefalse' ? (o.id === 'true' ? t('对') : t('错')) : o.text),
                  }}
                />

                {/* 结果标签指示 */}
                {isRightChoice && (
                  <span className="shrink-0 rounded px-1.5 py-px text-[10px] font-semibold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                    {t('你选的 · 正确')}
                  </span>
                )}
                {isMissedKey && (
                  <span className="shrink-0 rounded px-1.5 py-px text-[10px] font-semibold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                    {t('正确答案')}
                  </span>
                )}
                {isWrongChoice && (
                  <span className="shrink-0 rounded px-1.5 py-px text-[10px] font-semibold bg-rose-500/20 text-rose-700 dark:text-rose-300">
                    {t('你选的')}
                  </span>
                )}
                {chosen && !hasKey && (
                  <span className="shrink-0 rounded bg-line/80 px-1.5 py-px text-[10px] text-ink-soft">
                    {t('你选的')}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {/* 你的作答 */}
          <div className="rounded border border-line bg-paper/40 p-2.5">
            <div className="text-[10.5px] font-medium text-ink-faint">{t('你的作答')}</div>
            <div className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">
              {answer?.text?.trim() ? answer.text : <span className="text-ink-faint">{t('（没有作答）')}</span>}
            </div>
          </div>

          {/* 参考答案 */}
          {hasKey && (
            <div
              style={{ borderColor: RIGHT_FG, background: RIGHT_BG }}
              className="rounded border p-2.5"
            >
              <div style={{ color: RIGHT_FG }} className="text-[10.5px] font-semibold">
                {t('参考答案：')}
              </div>
              <div
                style={{ color: RIGHT_FG }}
                className="mt-0.5 text-[12.5px] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: formatAnswer(q, key) }}
              />
            </div>
          )}
        </div>
      )}

      {/* AI 导师逐题解析 */}
      {result?.comment && (
        <div
          style={isWrong ? { borderColor: WRONG_BG, background: 'rgba(192, 57, 43, 0.04)' } : undefined}
          className="mt-2.5 rounded border border-line/80 bg-paper/30 p-2.5"
        >
          <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-seal">
            <Sparkles size={13} />
            <span>{t('AI 导师逐题解析')}</span>
          </div>
          <div className="mt-1 text-[12px] leading-relaxed">
            <MarkdownView html={renderNote(result.comment)} className="moji-agent-md" />
          </div>
        </div>
      )}

      {/* 评分细则 */}
      {q.rubric && (
        <div className="mt-2" style={{ '--doc-scale': 0.82 } as CSSProperties}>
          <div className="note-preview">
            <details className="md-fold">
              <summary className="text-[11px] font-medium text-ink-soft cursor-pointer">
                {t('评分细则')}
              </summary>
              <div className="mt-1 text-[11.5px]">
                <MarkdownView html={renderNote(q.rubric)} />
              </div>
            </details>
          </div>
        </div>
      )}
    </div>
  )
}
