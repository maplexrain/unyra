import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlarmClock, Check, ChevronDown, Flag, Play, X } from 'lucide-react'
import { native } from '../../lib/native'
import { renderInline } from '../../lib/markdown'
import Switch from '../Switch'
import type { ExamQuestion } from '../../learn/exam'
import { EXAM_KIND_LABEL, EXAM_LEVEL_LABEL, QUESTION_TYPE_LABEL, formatDuration } from '../../learn/exam'
import type { ExamWindowState } from '../../learn/useExamBridge'
import { t } from '../../i18n'

/**
 * 考试窗口：一个独立的 Electron 窗口（见 electron/main.ts 的「考试窗口」一节），
 * 加载同一份渲染产物、走 `?examWindow=1` 分支（见 main.tsx）。
 *
 * 三条规矩，都是这次重构定下来的：
 * 1. **它一笔数据都不写**：作答、切屏、交卷全部 emit 回主窗口，由主窗口落盘
 *    （见 learn/useExamBridge）。这里没有 store，也没有任何存储调用——考试窗口崩了，
 *    已经记下的东西也一条不丢。
 * 2. **开始之前什么都不会发生**：intro 阶段退出 = 直接关窗，主窗口那边一条记录都不会有。
 *    一旦开始，就只有「交卷」与「放弃」两条路（关窗也算放弃，由主进程拦下来先问一次）。
 * 3. **计时不靠界面配合**：单题耗时由主窗口按「这一次落定答案 − 上一次落定答案」推出来
 *    （见 learn/examRecords）。所以这里没有计时区、也没有「把题滚进某个带子里」那种要求——
 *    用户怎么翻、怎么跳、怎么改答案都不影响记账。
 *
 * 版面是**动态分列**：一列放不下就加一列，最多三列，三列还放不下就翻页（见 learn/examLayout）。
 * 题目本身不画卡片（没有边框与底色），靠分栏与留白分开——一屏能多看点。
 */

/** 卷面四周的留白：底部那一块是留给题号条的 */
const PAD_X = 40
const PAD_TOP = 32
const PAD_BOTTOM = 120
/**
 * 卷面宽度：**单栏、768px**。
 *
 * 试过动态分列（一列放不下加一列、最多三列、溢出翻页），实际读起来不如窄栏舒服：
 * 一行太长眼睛要横扫，而试卷的题干本来就短。768 是这里独立定下的数，不跟着文档区
 * 的正文列走（那一列现在是 850，见 index.css 的 .doc-measure）。
 */
const PAPER_MAX_W = 768

/** 还没拿到状态时的空题目表：常量身份，好让它进 useCallback 的依赖 */
const EMPTY_QUESTIONS: ExamQuestion[] = []

interface Draft {
  value: string[]
  text: string
}

const emptyDraft: Draft = { value: [], text: '' }

export default function ExamWindow() {
  const guest = useMemo(() => {
    try {
      return native().examGuest
    } catch {
      return null
    }
  }, [])

  const [state, setState] = useState<ExamWindowState | null>(null)
  const [answers, setAnswers] = useState<Record<string, Draft>>({})
  const [now, setNow] = useState(() => Date.now())
  const [forceSubmit, setForceSubmit] = useState(true)
  const [confirm, setConfirm] = useState<null | 'submit' | 'abandon'>(null)
  const [localStart, setLocalStart] = useState<number | null>(null)
  /** 题号条收起 / 展开 */
  const [stripOpen, setStripOpen] = useState(true)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef(new Map<string, HTMLDivElement>())
  const focusedRef = useRef(true)
  const submittedRef = useRef(false)

  const phase = state?.phase ?? 'intro'
  const running = phase === 'running'
  const questions = useMemo(() => state?.questions ?? EMPTY_QUESTIONS, [state])
  const during = state?.attempt
  const startedAt = during?.startedAt ?? localStart
  const deadline = state && startedAt && state.minutes > 0 ? startedAt + state.minutes * 60_000 : null
  const overtimeMs = deadline ? Math.max(0, now - deadline) : 0
  const remainingMs = deadline ? deadline - now : 0
  const past = !!deadline && remainingMs <= 0

  /* ---------- 与主窗口的通道 ---------- */

  useEffect(() => {
    if (!guest) return
    const off = guest.onState((raw) => {
      const next = raw as ExamWindowState
      if (!next || typeof next !== 'object') return
      setState(next)
      if (next.phase === 'running' && next.attempt) {
        // 以主窗口那份为准初始化作答（重开窗口也能接着答）
        setAnswers((prev) => {
          if (Object.keys(prev).length) return prev
          const out: Record<string, Draft> = {}
          for (const a of next.attempt!.answers) out[a.questionId] = { value: a.value ?? [], text: a.text ?? '' }
          return out
        })
      }
    })
    // 「我准备好了」：open 的那份载荷不保证送达（见 lib/native），状态一律走这条握手
    guest.emit({ type: 'ready' })
    return off
  }, [guest])

  useEffect(() => {
    if (!guest) return
    // 依赖里带上 running：退出是否等于「放弃」取决于此刻开考没有
    return guest.onConfirmClose(() => {
      if (running) {
        setConfirm('abandon')
        return
      }
      guest.allowClose()
      window.close()
    })
  }, [guest, running])

  /* ---------- 时间：秒针、到点 ---------- */

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (!running || !past || !forceSubmit || submittedRef.current) return
    // 用户选了「到点强制交卷」：到点就替他把卷子交了（超时标记由时间戳自己说话）
    submittedRef.current = true
    guest?.emit({ type: 'submit', at: Date.now() })
  }, [running, past, forceSubmit, guest])

  /* ---------- 切屏记录 ---------- */

  useEffect(() => {
    const onBlur = (): void => {
      focusedRef.current = false
      if (running) guest?.emit({ type: 'blurStart', at: Date.now() })
    }
    const onFocus = (): void => {
      focusedRef.current = true
      if (running) guest?.emit({ type: 'blurEnd', at: Date.now() })
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [guest, running])

  /* ---------- 作答 ---------- */

  const scrollToQuestion = useCallback(
    (questionId: string, smooth = true) => {
      const el = itemRefs.current.get(questionId)
      if (!el) return
      el.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' })
    },
    [],
  )

  const gotoQuestion = useCallback(
    (questionId: string) => {
      scrollToQuestion(questionId)
    },
    [scrollToQuestion],
  )

  const setAnswer = useCallback(
    (q: ExamQuestion, next: Draft, advance = false) => {
      setAnswers((prev) => ({ ...prev, [q.id]: next }))
      /*
       * 只发答案：单题耗时由主窗口按「这次落定的时间戳 − 上一次落定的时间戳」推出来
       * （见 learn/examRecords 的 recordInput），这里不报任何时间。
       */
      guest?.emit({
        type: 'input',
        questionId: q.id,
        value: next.value,
        ...(next.text ? { text: next.text } : {}),
        at: Date.now(),
      })
      if (!advance) return
      // 往后找第一道还没答的题（当前这道已排除在候选之外，先答后跳不会原地打转）
      const idx = questions.findIndex((x) => x.id === q.id)
      const rest = questions.slice(idx + 1).concat(questions.slice(0, idx))
      const target = rest.find((x) => isBlank(x, answers[x.id])) ?? rest[0]
      if (target) window.setTimeout(() => gotoQuestion(target.id), 260)
    },
    [answers, guest, questions, gotoQuestion],
  )

  const submit = useCallback(
    (kind: 'submit' | 'abandon') => {
      if (submittedRef.current) return
      submittedRef.current = true
      guest?.emit(kind === 'submit' ? { type: 'submit', at: Date.now() } : { type: 'abandon', at: Date.now() })
      setConfirm(null)
      setState((s) =>
        s ? { ...s, phase: 'settled', notice: kind === 'submit' ? t('已交卷，导师正在判分与讲解…') : t('已放弃这次考试（记 0 分）。') } : s,
      )
    },
    [guest],
  )

  const answeredCount = questions.filter((q) => !isBlank(q, answers[q.id])).length
  const lastAnswered = (() => {
    for (let i = questions.length - 1; i >= 0; i--) if (!isBlank(questions[i], answers[questions[i].id])) return questions[i].id
    return ''
  })()

  const start = (): void => {
    const at = Date.now()
    setLocalStart(at)
    guest?.emit({ type: 'start', at, forceSubmit })
    guest?.setFullscreen(true)
    setState((s) => (s ? { ...s, phase: 'running' } : s))
  }

  const quitWithoutStart = (): void => {
    guest?.allowClose()
    window.close()
  }

  /* ---------- 渲染 ---------- */

  if (!state) {
    return (
      <div className="flex h-screen items-center justify-center bg-paper text-[13px] text-ink-faint">{t('正在打开试卷…')}</div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-paper text-ink">
      <header className="app-drag flex shrink-0 items-center gap-3 border-b border-line bg-card/60 px-5 py-3">
        <AlarmClock size={15} className="shrink-0 text-seal" />
        <span className="min-w-0 truncate text-[13.5px] font-medium text-ink-strong">{state.title}</span>
        <span className="shrink-0 text-[11px] text-ink-faint">
          {t(EXAM_KIND_LABEL[state.kind])} · {t(EXAM_LEVEL_LABEL[state.level])} · {t('{0} 题 · 满分 {1}', questions.length, state.totalPoints)}
        </span>
        <span className="min-w-0 flex-1" />
        {running && (
          <>
            <span className="shrink-0 text-[11.5px] tabular-nums text-ink-soft">
              {t('已答 {0}/{1}', answeredCount, questions.length)}
            </span>
            <span
              className={
                'shrink-0 rounded-md px-2 py-1 text-[12.5px] tabular-nums ' +
                (past ? 'bg-amber-500/15 text-amber-700' : 'bg-line/60 text-ink-strong')
              }
              title={deadline ? t('到点后是否强制交卷由你在开考前选') : t('这份卷子不限时')}
            >
              {deadline
                ? past
                  ? t('超时 {0}', formatDuration(overtimeMs))
                  : t('剩余 {0}', formatDuration(remainingMs))
                : t('计时 {0}', formatDuration(now - (startedAt ?? now)))}
            </span>
            <button
              type="button"
              onClick={() => setConfirm('abandon')}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11.5px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
            >
              {t('放弃考试')}
            </button>
            <button
              type="button"
              onClick={() => setConfirm('submit')}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-[11.5px] font-medium text-paper transition hover:bg-ink-strong"
            >
              <Flag size={12} />
              {t('交卷')}
            </button>
          </>
        )}
      </header>

      {phase === 'intro' && (
        <IntroScreen
          state={state}
          forceSubmit={forceSubmit}
          onForceSubmit={setForceSubmit}
          onStart={start}
          onQuit={quitWithoutStart}
        />
      )}

      {phase === 'settled' && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
          <Check size={22} className="text-seal" />
          <p className="text-[13px] text-ink-strong">{state.notice}</p>
          <p className="text-[11.5px] text-ink-faint">{t('这个窗口马上会关掉；试卷列表里能看到这一次的记录。')}</p>
        </div>
      )}

      {running && (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto"
            style={{ padding: PAD_TOP + 'px ' + PAD_X + 'px ' + PAD_BOTTOM + 'px' }}
          >
            {/* 单栏 768px：不分栏、不翻页，一路往下读 */}
            <div className="mx-auto flex w-full flex-col gap-7" style={{ maxWidth: PAPER_MAX_W }}>
              {questions.map((q, i) => (
                <QuestionBlock
                  key={q.id}
                  index={i + 1}
                  question={q}
                  draft={answers[q.id] ?? emptyDraft}
                  current={q.id === lastAnswered}
                  register={(el) => {
                    if (el) itemRefs.current.set(q.id, el)
                    else itemRefs.current.delete(q.id)
                  }}
                  onChange={(next, advance) => setAnswer(q, next, advance)}
                />
              ))}
            </div>
          </div>

          {/*
            题号条：**水平、固定在底部、不占版面**（absolute，浮在卷面之上），可以收起展开。
            每个号码上带一道状态：答过的实心、没答的空心——一眼看得出还差哪几题。
          */}
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
            <div className="pointer-events-auto flex max-w-[min(94vw,1000px)] flex-col items-center gap-2">
              {stripOpen && (
                <div className="moji-in-soft flex flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-line-strong bg-card/95 px-3 py-2 shadow-[0_12px_36px_rgba(31,27,23,0.22)] backdrop-blur">
                  {questions.map((q, i) => {
                    const done = !isBlank(q, answers[q.id])
                    const current = q.id === lastAnswered
                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => gotoQuestion(q.id)}
                        title={
                          t('{0} · {1} 分 · {2}', t(QUESTION_TYPE_LABEL[q.type]), q.points,
                            (done ? t('已作答') : t('还没答')) + (current ? ' · ' + t('刚答过这题') : ''))
                        }
                        className={
                          'flex h-7 min-w-7 items-center justify-center rounded-lg border px-1.5 text-[11.5px] tabular-nums transition ' +
                          (done
                            ? 'border-seal/50 bg-seal/15 font-medium text-seal-deep'
                            : 'border-dashed border-line-strong bg-transparent text-ink-faint hover:text-ink') +
                          (current ? ' ring-2 ring-seal/30' : '')
                        }
                      >
                        {i + 1}
                      </button>
                    )
                  })}
                </div>
              )}
              <button
                type="button"
                onClick={() => setStripOpen((v) => !v)}
                title={stripOpen ? t('收起题号条') : t('展开题号条')}
                className="flex items-center gap-1.5 rounded-full border border-line-strong bg-card/95 px-3 py-1.5 text-[11.5px] text-ink-soft shadow-sm backdrop-blur transition hover:text-ink"
              >
                {t('已答 {0}/{1}', answeredCount, questions.length)}
                <ChevronDown
                  size={12}
                  className={'transition-transform duration-200 ' + (stripOpen ? '' : 'rotate-180')}
                />
              </button>
            </div>
          </div>

        </div>
      )}

      {confirm && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 backdrop-blur-[1px]">
          <div className="moji-dialog-in w-[380px] rounded-xl border border-line-strong bg-paper p-4 shadow-[0_24px_64px_rgba(0,0,0,0.4)]">
            <h3 className="text-[14px] font-semibold text-ink-strong">
              {confirm === 'submit' ? t('现在交卷？') : t('放弃这次考试？')}
            </h3>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
              {confirm === 'submit'
                ? t('交卷后导师会判分并写错题讲解。') +
                  (answeredCount < questions.length
                    ? t('还有 {0} 题没作答，它们会记 0 分。', questions.length - answeredCount)
                    : '')
                : t('放弃会**直接记 0 分**，导师不会判分、也不会写错题讲解。这份卷子以后还能重考。')}
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="rounded-lg px-3 py-1.5 text-[12px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
              >
                {t('继续作答')}
              </button>
              <button
                type="button"
                onClick={() => submit(confirm)}
                className={
                  'rounded-lg px-3 py-1.5 text-[12px] font-medium text-paper transition ' +
                  (confirm === 'submit' ? 'bg-ink hover:bg-ink-strong' : 'bg-seal-deep hover:bg-seal')
                }
              >
                {confirm === 'submit' ? t('交卷') : t('放弃并记 0 分')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 这道题答没答（空串与空数组都算没答） */
function isBlank(q: ExamQuestion, draft: Draft | undefined): boolean {
  if (!draft) return true
  if (q.type === 'fill' || q.type === 'short') return !draft.text.trim()
  return draft.value.length === 0
}

/** 开考前那一屏：把这场考试的规矩一次说清，然后才是「开始」 */
function IntroScreen({
  state,
  forceSubmit,
  onForceSubmit,
  onStart,
  onQuit,
}: {
  state: ExamWindowState
  forceSubmit: boolean
  onForceSubmit: (v: boolean) => void
  onStart: () => void
  onQuit: () => void
}) {
  const limit = state.minutes > 0 ? t('{0} 分钟', state.minutes) : t('不限时')
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-8">
      <div className="w-[520px] rounded-2xl border border-line bg-card p-6 shadow-sm">
        <h1 className="text-[17px] font-semibold text-ink-strong">{state.title}</h1>
        <p className="mt-1.5 text-[12px] text-ink-faint">
          {t(EXAM_KIND_LABEL[state.kind])} · {t(EXAM_LEVEL_LABEL[state.level])} ·{' '}
          {t('{0} 题 · 满分 {1} · 时限 {2}', state.questions.length, state.totalPoints, limit)}
        </p>

        <ul className="mt-4 flex flex-col gap-1.5 text-[12px] leading-relaxed text-ink-soft">
          <li>· {t('开始后窗口会全屏，归一主窗口会盖上一层黑遮罩，避免一边答题一边翻文档。')}</li>
          <li>· {t('一旦开始，只有**交卷**与**放弃**两条路；放弃直接记 0 分，不判分也不写错题讲解。')}</li>
          <li>· {t('卷面是单栏 768px，一路往下读；底部那条题号条可以跳题、也能收起。')}</li>
          <li>· {t('每题用时按你**落定答案的先后**推算（这一笔减上一笔），不用你配合任何计时动作。')}</li>
          <li>· {t('作答与切屏次数都会被记下来，导师据此判断你的薄弱项。')}</li>
        </ul>

        {state.minutes > 0 && (
          <div className="mt-4 rounded-lg border border-line bg-paper/60 px-3 py-2.5">
            <Switch
              on={forceSubmit}
              onChange={onForceSubmit}
              label={t('到点强制交卷')}
              hint={t('关掉它可以继续作答：超时多久、哪几笔是超时答的都会被记下来，不会因此判你作弊')}
            />
          </div>
        )}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onStart}
            className="flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-[12.5px] font-medium text-paper transition hover:bg-ink-strong"
          >
            <Play size={13} />
            {t('开始考试')}
          </button>
          <button
            type="button"
            onClick={onQuit}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
          >
            <X size={13} />
            {t('退出（什么都不发生）')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 一道题。
 *
 * **不是卡片**：没有边框、没有底色、没有圆角——一屏要放三列，卡片会把可用宽度吃掉一圈。
 * 分隔靠的是与下一题之间的留白（列内 gap）与标题行的字号。
 */
function QuestionBlock({
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
  /** 刚答过的那一题：给一道细边提示「你在这儿」 */
  current: boolean
  onChange: (next: Draft, advance?: boolean) => void
  register: (el: HTMLDivElement | null) => void
}) {
  const stemHtml = useMemo(() => renderInline(question.stem), [question.stem])
  /*
   * 对错题**不显示序号**：它的 id 是 true / false，摆在选项前面只会让人读成英文单词。
   * 两个选项本身也写成「对 / 错」——最短的说法，一行并排还占不到一半宽度。
   */
  const isJudgement = question.type === 'truefalse'
  const options = isJudgement
    ? [
        { id: 'true', text: t('对') },
        { id: 'false', text: t('错') },
      ]
    : (question.options ?? [])

  const toggle = (id: string): void => {
    if (question.type === 'single' || question.type === 'truefalse') {
      onChange({ value: [id], text: '' }, true)
      return
    }
    const has = draft.value.includes(id)
    onChange({ value: has ? draft.value.filter((x) => x !== id) : [...draft.value, id], text: '' }, false)
  }

  return (
    <div
      ref={register}
      className={'scroll-mt-6 ' + (current ? 'border-l-2 border-seal/40 pl-3' : 'pl-3.5')}
    >
      {/*
        题干与序号**同一行**：「1. （单选题）题干……（2分）」。
        一行里把「第几题、什么题型、多少分」都交代掉，比原来三行抬头省下两行——
        一屏能多读一道题，翻卷时也更容易扫。
        题干走 renderInline（行内渲染）：它把单个段落的外壳去掉，才能接在序号后面；
        多段题干会自然落到下面几行，仍然读得通。
      */}
      <div className="text-[13px] leading-[1.85] text-ink">
        <span className="mr-1 font-medium text-ink-strong tabular-nums">{index}.</span>
        <span className="text-ink-faint">{t('（{0}）', t(QUESTION_TYPE_LABEL[question.type]))}</span>{' '}
        <span dangerouslySetInnerHTML={{ __html: stemHtml }} />
        <span className="ml-1 text-[11.5px] text-ink-faint tabular-nums">{t('（{0} 分）', question.points)}</span>
      </div>

      {question.image && (
        /* 配图：题干的一部分，摆题干下、作答区上。SVG 源码在入库前已消毒（见 learn/exam/svg） */
        <div className="moji-exam-figure" dangerouslySetInnerHTML={{ __html: question.image }} />
      )}

      {question.type === 'fill' ? (
        <input
          value={draft.text}
          onChange={(e) => onChange({ value: [], text: e.target.value })}
          placeholder={t('在这里填写答案')}
          spellCheck={false}
          className="mt-2.5 w-full rounded-lg border border-line bg-paper/60 px-3 py-2 text-[13px] text-ink outline-none transition placeholder:text-ink-faint focus:border-seal/50"
        />
      ) : question.type === 'short' ? (
        <textarea
          value={draft.text}
          onChange={(e) => onChange({ value: [], text: e.target.value })}
          rows={3}
          placeholder={t('在这里作答（可写推导过程）')}
          spellCheck={false}
          className="mt-2.5 w-full resize-y rounded-lg border border-line bg-paper/60 px-3 py-2 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-seal/50"
        />
      ) : (
        /*
          选项走**弹性布局 + 自动换行**：短的选项一行并排好几个（「对 / 错」这种一眼看完），
          长的（带公式的那种）自己占满一行再换行——不必每个选项都独占一行，白省半屏。
          **没有边框、没有底色**：一张卷子几十个选项，框子一多整页都是线，反而看不清题干；
          选中与否靠序号与文字的颜色（被选中的序号变强调色加粗、文字变深）——那才是真正要看的差别。
        */
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
          {options.map((o) => {
            const on = draft.value.includes(o.id)
            return (
              /*
               * 一行选项 = 「序号 · 表单控件 · 内容」。
               *
               * 用 <label> 包一个真的 <input>（单选 type=radio / 多选 type=checkbox），
               * 不是自己画的按钮：点了就中的是原生控件，键盘（Tab / 空格 / 方向键）、
               * 读屏、以及「这个控件叫什么」全都白拿；自己用 div 画一个假的，
               * 这些都得一样样补回来。同题的 radio 用同一个 name，浏览器自己保证互斥。
               */
              <label
                key={o.id}
                className={
                  'flex max-w-full cursor-pointer items-start gap-1.5 text-left text-[13px] leading-[1.9] transition ' +
                  (on ? 'font-medium text-ink-strong' : 'text-ink hover:text-ink-strong')
                }
              >
                {!isJudgement && (
                  // 序号比正文大一档（15px）且无边框：它是「我要选这一个」的落点，得先被看见
                  <span
                    className={
                      'shrink-0 text-[15px] leading-[1.65] tabular-nums transition ' +
                      (on ? 'font-semibold text-seal-deep' : 'text-ink-faint')
                    }
                  >
                    {o.id}
                  </span>
                )}
                <input
                  type={question.type === 'multiple' ? 'checkbox' : 'radio'}
                  // 同题的选项共享一个 name：单选的互斥交给浏览器（我们这边也拦一道）
                  name={'exam-q-' + question.id}
                  checked={on}
                  onChange={() => toggle(o.id)}
                  className="mt-[6px] h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--color-seal)]"
                />
                {/*
                  选项文字走 Markdown 行内渲染：理科题的选项里全是公式（$x^2$、\lim），
                  按纯文本显示会把美元符号原样摆出来（见 lib/markdown 的 renderInline）。
                  用 div 而不是 span：行内渲染偶尔会产出块级元素，span 里嵌块级是非法 HTML。
                */}
                <div className="min-w-0" dangerouslySetInnerHTML={{ __html: renderInline(o.text) }} />
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
