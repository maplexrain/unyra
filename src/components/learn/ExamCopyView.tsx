import type { CSSProperties } from 'react'
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
 * 试卷副本：**某一次考试**的只读呈现（历史记录点开就是这个页签）。
 *
 * 与考试窗口的分界写在最前面：那边是「正在发生」（输入、计时、切屏都在写入），
 * 这里是「已经发生过」——所以整份组件不接任何编辑回调，答案框连 readOnly 都带灰底，
 * 一眼能看出「这不是给你改的」。同一份卷子可以考很多次，副本永远只讲**那一次**，
 * 题目从 exam 上读、作答与记录从 attempt 上读，两者不混。
 *
 * 内容的顺序是**讲评的顺序**，不是数据的顺序：先把 Agent 的错题讲解摆在最前面
 * （点进历史的人想知道的就是「我错在哪」），然后逐题回看，最后才把这一场的过程记录
 * （输入顺序、单题耗时、改过哪几题、切屏）收进折叠区——那是给学生与 AI 复盘用的，
 * 不该在打开的第一屏就铺满。
 */

/* ---------- 小工具（只服务这一屏的排版，不导出） ---------- */

/**
 * 「8 月 12 日 15:30」——历史记录里「3 小时前」对不上号，要能直接认出是哪一场。
 * 跨年的那几场补上年份：只说「1 月 3 日」的话，隔了一年再看就分不清是哪一年考的了。
 */
function stamp(ts: number): string {
  const d = new Date(ts)
  const year = d.getFullYear() === new Date().getFullYear() ? '' : t('{0} 年 ', d.getFullYear())
  return t('{0}{1} 月 {2} 日 {3}:{4}', year, d.getMonth() + 1, d.getDate(), pad2(d.getHours()), pad2(d.getMinutes()))
}

/** 「15:04:11」——记录区里同一场考试内部只用时刻，日期在标题上已经说过了 */
function clockOf(ts: number): string {
  const d = new Date(ts)
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
}

/** 「x 分 y 秒」；不足一分钟只写秒（「0 分 12 秒」读起来像在凑格式） */
function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m ? t('{0} 分 {1} 秒', m, s) : t('{0} 秒', s)
}

/**
 * 单题耗时按**秒**写，不写「x 分 y 秒」。
 * 这一列是拿来横向比的（哪题耗时明显高），同一个单位才比得出来；
 * 分母都是整数秒，一分多钟也不会写成 1.35 分。
 */
function seconds(ms: number): string {
  return t('{0} 秒', Math.round(Math.max(0, ms) / 1000))
}

/** 参考答案 / 用户选项的展示文本：选项 id 折成「B. 选项文字」，其余按行内 Markdown 渲染 */
function formatAnswer(q: ExamQuestion, answer: string[]): string {
  // 与卷面一致：对错题就用「对 / 错」，别在这里又变成「正确 / 错误」
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

/**
 * 对错用**固定色**，不跟主题走。
 *
 * 主题里的 seal 是「强调色」——樱花粉主题下它是粉的、静谧蓝下是蓝的。用它表示「错了」
 * 会随主题漂移：粉主题上错题是粉的，看着像表扬。对错是**语义**，不是品牌色，
 * 只有红绿两色在每一套主题里都读得出同一个意思，所以这里写死（内联样式，不走 Tailwind 类）。
 */
const WRONG_FG = '#c0392b'
const WRONG_BG = 'rgba(192, 57, 43, 0.12)'
const RIGHT_FG = '#2f7d4f'
const RIGHT_BG = 'rgba(47, 125, 79, 0.14)'

/** 满分与得分都从 results 里读：判分做完了才有这一层，没判过的题不显示分数 */
function resultChip(
  result: ExamResultItem | undefined,
): { text: string; tone: string; style: Record<string, string>; title: string } | null {
  if (!result) return null
  const style: Record<string, string> =
    result.correct === true
      ? { color: RIGHT_FG, background: RIGHT_BG }
      : result.correct === false
        ? { color: WRONG_FG, background: WRONG_BG }
        : {}
  const tone = result.correct === null ? 'bg-line/70 text-ink-soft' : ''
  const text = t(
    '{0} {1}/{2}',
    result.correct === true ? t('正确') : result.correct === false ? t('错误') : t('待判'),
    result.score,
    result.maxScore,
  )
  return { text, tone, style, title: result.by === 'system' ? t('系统判分（客观题）') : t('AI 判分') }
}

/* ---------- 主组件 ---------- */

interface Props {
  exam: Exam
  /** 要呈现的那一次考试；属于这份试卷的历次之一 */
  attempt: ExamAttempt
}

export default function ExamCopyView({ exam, attempt }: Props) {
  const brief = attemptBrief(exam, attempt)
  const inputs = attempt.inputs ?? []
  const answers = attempt.answers ?? []
  const blurs = attempt.blurs ?? []
  const dwell = attempt.dwell ?? {}

  /**
   * 题号标签：记录区里的「第 N 题」与逐题区的序号必须是**同一个 N**，
   * 否则「他改了第 3 题」在正文里找不到对应——两处都从 exam.questions 的次序算。
   */
  const labelOf = (questionId: string): string => {
    const i = exam.questions.findIndex((q) => q.id === questionId)
    return i < 0 ? t('已不在卷子里的题目') : t('第 {0} 题', i + 1)
  }
  const timeline = inputTimeline({ ...attempt, inputs }, labelOf)
  const dwellRows = Object.entries(dwell)
    .filter(([, ms]) => ms > 0)
    .sort((a, b) => b[1] - a[1])
  const edited = exam.questions.filter((q) => inputCountOf({ ...attempt, inputs }, q.id) > 1)

  const abandoned = attempt.status === 'abandoned'
  const scoreText = abandoned
    ? t('已放弃（记 0 分）')
    : attempt.status === 'ongoing'
      ? t('还在考')
      : brief.score === null
        ? t('未判分')
        : t('{0} / {1}', brief.score, brief.total)

  return (
    /* 只读栏：整屏滚动交给这一层，里面的内容列与文档区的正文列同一列（见 index.css 的 .doc-measure） */
    <div className="h-full overflow-y-auto bg-card">
      <div className="doc-measure px-7 py-6">
        {/* --- 抬头：这是哪一份卷子、哪一次考试 --- */}
        <header className="rounded-lg border border-line bg-paper-deep/30 px-3.5 py-3">
          <h1 className="text-[15px] font-semibold leading-snug text-ink-strong">{exam.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px]">
            <span className="rounded bg-line/60 px-1.5 py-px text-ink-soft">{t(EXAM_KIND_LABEL[exam.kind])}</span>
            <span className="rounded bg-line/60 px-1.5 py-px text-ink-soft">{t(EXAM_LEVEL_LABEL[exam.level])}</span>
            <span className="rounded bg-line/60 px-1.5 py-px text-ink-soft">
              {exam.minutes === 0 ? t('不限时') : t('{0} 分钟', exam.minutes)}
            </span>
            <span className="rounded bg-seal/10 px-1.5 py-px text-seal-deep">{t(EXAM_PHASE_LABEL[attempt.status])}</span>
            <span className="text-ink-faint">{t('共 {0} 题', exam.questions.length)}</span>
          </div>

          {/*
            两列的信息栅格：左边是「这一场什么时候发生、用了多久」，右边是「答成什么样」。
            分两列而不是一行行排，是因为读副本的人先看左边认场次、再看右边看结果，
            两件事各自成列才不必来回扫。
          */}
          <div className="mt-2.5 grid grid-cols-1 gap-x-6 gap-y-1 text-[11.5px] sm:grid-cols-2">
            <div className="flex items-baseline gap-1.5">
              <span className="shrink-0 text-ink-faint">{t('开考')}</span>
              <span className="text-ink-soft">{stamp(attempt.startedAt)}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="shrink-0 text-ink-faint">{t('得分')}</span>
              <span
                className={
                  'font-medium ' +
                  (abandoned ? 'text-ink-soft' : brief.score === null ? 'text-ink-soft' : attempt.passed ? 'text-ok-deep' : 'text-seal-deep')
                }
              >
                {scoreText}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="shrink-0 text-ink-faint">{t('交卷')}</span>
              <span className="text-ink-soft">{attempt.endedAt ? stamp(attempt.endedAt) : t('还没结束')}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="shrink-0 text-ink-faint">{t('作答')}</span>
              <span className="text-ink-soft">
                {t('{0} / {1} 题', brief.answered, brief.questionCount)}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="shrink-0 text-ink-faint">{t('用时')}</span>
              <span className="text-ink-soft">{duration(brief.durationMs)}</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="shrink-0 text-ink-faint">{t('切屏')}</span>
              <span className={blurs.length ? 'text-warn-deep' : 'text-ink-soft'}>
                {t('{0} 次', brief.blurCount)}
                {brief.blurCount > 0 && t(' / 共 {0}', duration(brief.blurMs))}
              </span>
            </div>
            {brief.overtimeMs > 0 && (
              <div className="flex items-baseline gap-1.5 sm:col-span-2">
                <span className="shrink-0 text-ink-faint">{t('超时')}</span>
                <span className="text-warn-deep">
                  {duration(brief.overtimeMs)}
                  {/* 一笔都没超时答的（比如到点才发现、停在那儿）就不说「其中 0 笔」，那是废话 */}
                  {brief.overtimeInputs > 0 && t('，其中 {0} 笔是超时作答', brief.overtimeInputs)}
                </span>
              </div>
            )}
          </div>
        </header>

        {/*
          错题讲解：整份副本里最该看的东西，但它是**一大段** —— 默认折叠，
          标题行说清「这是什么、有多长」，想看再点开。摊开的话，下面的逐题回看全被推到屏幕外。
        */}
        {attempt.explanation ? (
          <details className="mt-4 rounded-lg border px-3.5 py-3" style={{ borderColor: WRONG_BG, background: 'rgba(192, 57, 43, 0.04)' }}>
            <summary className="cursor-pointer text-[12px] font-medium" style={{ color: WRONG_FG }}>
              {t('错题讲解（{0} 字 · 点开看）', attempt.explanation.length)}
            </summary>
            <div className="mt-2">
              <MarkdownView html={renderNote(attempt.explanation)} className="moji-agent-md" />
            </div>
          </details>
        ) : (
          <p className="mt-4 rounded-lg border border-line bg-paper-deep/30 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-ink-faint">
            {abandoned
              ? t('这一次是放弃的：按 0 分记，导师不会判分，也不会写错题讲解（放弃的考试没有「错在哪」可讲）。')
              : t('这一次还没有错题讲解。') + (attempt.status === 'submitted' ? t('（阅卷还没跑完）') : '')}
          </p>
        )}

        {/* --- 逐题回看 --- */}
        <section className="mt-6">
          {exam.questions.map((q, i) => (
            <QuestionReview
              key={q.id}
              question={q}
              index={i}
              answer={answers.find((a) => a.questionId === q.id)}
              result={attempt.results?.find((r) => r.questionId === q.id)}
            />
          ))}
        </section>

        {/*
          记录区默认收起：它是这一场的「过程证据」（输入顺序、单题耗时、改过哪几题、切屏），
          复盘时才翻。摆在最后而不是最前，也是同一个理由——先看卷子，再看过程。
        */}
        <details className="mt-6 rounded-lg border border-line bg-paper-deep/30 px-3.5 py-2.5">
          <summary className="cursor-pointer text-[12px] font-medium text-ink-soft">{t('这场考试的记录')}</summary>
          <div className="mt-2.5 flex flex-col gap-3.5 text-[11px] leading-relaxed">
            <div>
              <div className="text-ink-faint">{t('输入顺序（共 {0} 笔）', inputs.length)}</div>
              {timeline.length ? (
                <ol className="mt-1 flex flex-col gap-0.5 text-ink-soft">
                  {timeline.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
              ) : (
                <p className="mt-1 text-ink-faint">{t('没有留下任何输入记录。')}</p>
              )}
            </div>

            <div>
              <div className="text-ink-faint">{t('单题耗时（按耗时倒序）')}</div>
              {dwellRows.length ? (
                <ul className="mt-1 flex flex-col gap-0.5 text-ink-soft">
                  {dwellRows.map(([questionId, ms]) => (
                    <li key={questionId}>
                      {labelOf(questionId)} · {seconds(ms)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-ink-faint">{t('没有单题耗时（这一场可能很早就结束了）。')}</p>
              )}
            </div>

            <div>
              <div className="text-ink-faint">{t('改过的题')}</div>
              {edited.length ? (
                <ul className="mt-1 flex flex-col gap-0.5 text-ink-soft">
                  {edited.map((q) => (
                    <li key={q.id}>
                      {labelOf(q.id)} · {t('{0} 笔', inputCountOf({ ...attempt, inputs }, q.id))}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-ink-faint">{t('没有改过的题（每题都是一次输入落定）。')}</p>
              )}
            </div>

            <div>
              <div className="text-ink-faint">{t('切屏（每一次都留了起始时刻与时长）')}</div>
              {blurs.length ? (
                <ul className="mt-1 flex flex-col gap-0.5 text-ink-soft">
                  {blurs.map((b, i) => (
                    <li key={b.start + '-' + i}>
                      {t('{0} 离开 · {1}', clockOf(b.start), duration(b.ms))}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-ink-faint">{t('整场没有离开过考试窗口。')}</p>
              )}
            </div>
          </div>
        </details>
      </div>
    </div>
  )
}

/* ---------- 一道题的回看 ---------- */

/**
 * 一道题的只读呈现：题干（Markdown + LaTeX）、用户的选择与正确答案、判分与讲解、评分解析。
 *
 * 选项上同时表达三件事，靠的是**两个维度**而不是一句话：谁被选中（标记）、哪个是对的
 * （颜色 + 正确答案徽标）。所以「选了错的」和「没选对的」在同一行里就能分辨，
 * 不必读文字说明——错题回看最烦的就是「哦这题我错了」却看不出错在哪一步。
 */
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
  const chip = resultChip(result)
  const wrong = result?.correct === false
  // 「留空」与「答了但答错」是两回事（见 exam.ts 的 hasAnswerValue）：判分上都是 0 分，
  // 但对复盘的人来说一个是不会、一个是没来得及——所以单独标一枚徽标，别让他去猜
  const answered = hasAnswerValue(answer)

  return (
    <div className="mb-5 border-b border-line/50 pb-4 last:mb-0 last:border-b-0 last:pb-0">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="shrink-0 text-[11px]" style={wrong ? { color: WRONG_FG } : undefined}>
          {t('{0}. {1} · {2} 分', index + 1, t(QUESTION_TYPE_LABEL[q.type]), q.points)}
        </span>
        {!answered && (
          <span className="shrink-0 rounded bg-line/70 px-1.5 py-px text-[10.5px] text-ink-soft">{t('未作答')}</span>
        )}
        {chip && (
          <span title={chip.title} style={chip.style} className={'shrink-0 rounded px-1.5 py-px text-[10.5px] ' + chip.tone}>
            {chip.text}
          </span>
        )}
      </div>

      {/* 题干必须走 Markdown 渲染：出题时公式与代码块都写在 stem 里 */}
      <MarkdownView html={renderNote(q.stem)} className="moji-agent-md mb-2" />

      {q.image && (
        /* 配图：题干的一部分。SVG 源码在入库前已消毒（见 learn/exam/svg），这里直接渲染 */
        <div className="moji-exam-figure mb-2" dangerouslySetInnerHTML={{ __html: q.image }} />
      )}

      {q.type === 'single' || q.type === 'multiple' || q.type === 'truefalse' ? (
        <div className="flex flex-col gap-1">
          {(q.options ?? []).map((o) => {
            const chosen = picked.includes(o.id)
            const isKey = hasKey && key.includes(o.id)
            // 选对＝绿、选错＝红、正确答案＝绿：这三件事必须一眼分得清，所以用固定色
            const cls = !hasKey
              ? chosen
                ? 'font-medium text-ink-strong'
                : 'text-ink-soft'
              : isKey
                ? ''
                : chosen
                  ? 'font-medium'
                  : 'text-ink-soft'
            const style = !hasKey ? undefined : isKey ? { color: RIGHT_FG } : chosen ? { color: WRONG_FG } : undefined
            return (
              /*
               * 一行选项的顺序与卷面一致：**序号 · 表单控件 · 内容**。
               * 控件是禁用的真 <input>（不是画出来的圆点）：它自带「选中了 / 没选中」的语义，
               * 截图与读屏都读得出来，视觉上也与考试窗口那一版长得一样。
               */
              <div key={o.id} style={style} className={'flex items-start gap-1.5 px-1 py-1 text-[12.5px] leading-[1.9] ' + cls}>
                {/*
                  对错题不给序号：它的 id 是 true / false，摆出来只会让人读成英文单词；
                  文案也按卷面写成「对 / 错」——副本要**看着和当时那张卷子一样**。
                */}
                {q.type !== 'truefalse' && <span className="shrink-0 text-ink-faint">{o.id}</span>}
                <input
                  type={q.type === 'multiple' ? 'checkbox' : 'radio'}
                  checked={chosen}
                  disabled
                  readOnly
                  className="mt-[5px] h-3.5 w-3.5 shrink-0 accent-seal"
                />
                <span
                  className="min-w-0 flex-1"
                  dangerouslySetInnerHTML={{
                    __html: renderInline(q.type === 'truefalse' ? (o.id === 'true' ? t('对') : t('错')) : o.text),
                  }}
                />
                {isKey && chosen && (
                  <span style={{ color: RIGHT_FG, background: RIGHT_BG }} className="shrink-0 rounded px-1.5 py-px text-[10px]">{t('你选的 · 正确')}</span>
                )}
                {isKey && !chosen && (
                  <span style={{ color: RIGHT_FG, background: RIGHT_BG }} className="shrink-0 rounded px-1.5 py-px text-[10px]">{t('正确答案')}</span>
                )}
                {chosen && !isKey && hasKey && (
                  <span style={{ color: WRONG_FG, background: WRONG_BG }} className="shrink-0 rounded px-1.5 py-px text-[10px]">{t('你选的')}</span>
                )}
                {chosen && !hasKey && (
                  <span className="shrink-0 rounded bg-line/70 px-1.5 py-px text-[10px] text-ink-soft">{t('你选的')}</span>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {/* 填空 / 简答：用户的原文整块给出，空白也算一种作答（留空 ≠ 答错，得看得出来） */}
          <div className="whitespace-pre-wrap rounded-md border border-line bg-paper-deep/40 px-2.5 py-1.5 text-[12.5px] leading-relaxed">
            {answer?.text?.trim() ? (
              <span className="text-ink">{answer.text}</span>
            ) : (
              <span className="text-ink-faint">{t('（没有作答）')}</span>
            )}
          </div>
          {hasKey && (
            <div className="text-[11.5px] leading-relaxed text-ink-soft">
              <span className="text-ink-faint">{t('参考答案：')}</span>
              <span dangerouslySetInnerHTML={{ __html: formatAnswer(q, key) }} />
            </div>
          )}
        </div>
      )}

      {/*
        判分之后才有这一段：AI 对**这一题**说的话（comment）排在最前，
        评分要点（rubric）收进折叠——它是出题时写的，不是针对这次作答的，
        打开就铺开会把真正的讲解淹掉。
      */}
      {result?.comment && (
        <div style={wrong ? { color: WRONG_FG } : undefined}>
          <MarkdownView html={renderNote(result.comment)} className="moji-agent-md mt-2" />
        </div>
      )}
      {!result?.comment && wrong && (
        <div className="mt-2 text-[11.5px]" style={{ color: WRONG_FG }}>
          {t('（AI 未给出这一题的讲解）')}
        </div>
      )}

      {q.rubric && (
        /*
          md-fold 的样式挂在 .note-preview 下（见 index.css），所以这里套一层 note-preview；
          再把 --doc-scale 压到 0.8（15.5px → 12.4px），让它和副本里其余 11~13px 的字同级，
          不至于一折叠块突然放大成正文尺寸。
        */
        <div className="mt-1.5" style={{ '--doc-scale': 0.8 } as CSSProperties}>
          <div className="note-preview">
            <details className="md-fold">
              <summary>{t('评分解析')}</summary>
              <MarkdownView html={renderNote(q.rubric)} />
            </details>
          </div>
        </div>
      )}
    </div>
  )
}
