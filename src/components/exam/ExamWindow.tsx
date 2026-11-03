import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Award,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flag,
  Play,
  ShieldCheck,
  Timer,
  X,
} from 'lucide-react'
import LanButton from '../lan/LanButton'
import LanConnectDialog from '../lan/LanConnectDialog'
import { subscribeLanQrModal, openLanQrModal } from '../../lib/lanSync'
import ImageLightboxModal from './ImageLightboxModal'
import UnifiedHandwrittenSheetsCard from './UnifiedHandwrittenSheetsCard'
import { native } from '../../lib/native'
import { renderInline } from '../../lib/markdown'
import Switch from '../Switch'
import type { ExamQuestion } from '../../learn/exam'
import {
  EXAM_KIND_LABEL,
  EXAM_LEVEL_LABEL,
  EXAM_PASS_RATIO,
  QUESTION_TYPE_LABEL,
  formatDuration,
} from '../../learn/exam'
import type { ExamWindowState } from '../../learn/useExamBridge'
import { isElectron, isMac } from '../../lib/native'
import { t } from '../../i18n'
import { nearestScrollTop } from './scroll'

/**
 * 考试窗口：一个独立的 Electron 窗口。
 *
 * 设计规矩：
 * 1. 数据完全由主窗口管理：作答、切屏、交卷全部 emit 回主窗口落盘。
 * 2. 高密度纸墨排版：严禁滥用大圆角卡牌，空间利用率优先，一屏可阅读多道题目。
 * 3. 单题耗时按落定答案次序自动推算，无需任何界面配合打点。
 */

const PAD_X = 20
const PAD_TOP = 16
const PAD_BOTTOM = 24
const PAPER_MAX_W = 768
/** 滚到某一题时上下各留一点呼吸位（跟卡片边框的圆角对齐，不贴边） */
const QUESTION_SCROLL_GAP = 12

const EMPTY_QUESTIONS: ExamQuestion[] = []

interface Draft {
  value: string[]
  text: string
  image?: string
  rawImage?: string
}

const emptyDraft: Draft = { value: [], text: '', image: undefined, rawImage: undefined }

const TYPE_THEMES: Record<string, { cls: string }> = {
  single: { cls: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300' },
  multiple: { cls: 'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300' },
  truefalse: { cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  fill: { cls: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  short: { cls: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300' },
}

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
  const [stripOpen, setStripOpen] = useState(false)
  const [lanOpen, setLanOpen] = useState(false)

  // 监听局域网互联弹窗（API 意图自动弹出或顶栏按钮）
  useEffect(() => {
    return subscribeLanQrModal((open) => {
      setLanOpen(open)
    })
  }, [])

  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [handwrittenImages, setHandwrittenImages] = useState<string[]>([])
  const sheetsRef = useRef<HTMLDivElement | null>(null)

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

  /* ---------- 与主窗口的通信 ---------- */

  useEffect(() => {
    if (!guest) return
    if (guest.getInitialState) {
      guest.getInitialState().then((init) => {
        const next = init as ExamWindowState
        if (next && typeof next === 'object' && next.phase && Array.isArray(next.questions)) {
          setState((prev) => prev ?? next)
          if (next.phase === 'running' && next.attempt) {
            if (Array.isArray(next.attempt.handwrittenImages)) {
              setHandwrittenImages(next.attempt.handwrittenImages)
            }
            setAnswers((prev) => {
              if (Object.keys(prev).length) return prev
              const out: Record<string, Draft> = {}
              for (const a of next.attempt!.answers) {
                out[a.questionId] = { value: a.value ?? [], text: a.text ?? '', image: a.image, rawImage: a.rawImage }
              }
              return out
            })
          }
        }
      }).catch(() => {})
    }

    const off = guest.onState((raw) => {
      const next = raw as ExamWindowState
      if (!next || typeof next !== 'object' || !next.phase || !Array.isArray(next.questions)) return
      setState(next)
      if (next.phase === 'running' && next.attempt) {
        if (Array.isArray(next.attempt.handwrittenImages)) {
          setHandwrittenImages(next.attempt.handwrittenImages)
        }
        setAnswers((prev) => {
          if (Object.keys(prev).length) return prev
          const out: Record<string, Draft> = {}
          for (const a of next.attempt!.answers) out[a.questionId] = { value: a.value ?? [], text: a.text ?? '', image: a.image, rawImage: a.rawImage }
          return out
        })
      }
    })
    guest.emit({ type: 'ready' })
    return off
  }, [guest])

  useEffect(() => {
    if (!guest) return
    return guest.onConfirmClose(() => {
      if (running) {
        setConfirm('abandon')
        return
      }
      guest.allowClose()
      window.close()
    })
  }, [guest, running])

  // 若窗口挂载后尚未获取到试卷状态，定时重新 emit ready 信号，彻底杜绝单次 IPC 丢包导致的卡死
  useEffect(() => {
    if (state || !guest) return
    const timer = setInterval(() => {
      guest.emit({ type: 'ready' })
    }, 1000)
    return () => clearInterval(timer)
  }, [state, guest])

  /* ---------- 时间与到点判定 ---------- */

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (!running || !past || !forceSubmit || submittedRef.current) return
    submittedRef.current = true
    guest?.emit({ type: 'submit', at: Date.now() })
  }, [running, past, forceSubmit, guest])

  /* ---------- 切屏监听 ---------- */

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

  /* ---------- 作答与翻题 ---------- */

  const scrollToQuestion = useCallback(
    (questionId: string, smooth = true) => {
      const el = itemRefs.current.get(questionId)
      const box = scrollRef.current
      if (!el || !box) return
      /*
        只滚题目流自己，不用 el.scrollIntoView：那会连 html/body 一起滚，
        答到最后几题时整页被顶上去，底下留一片空白（见本文件顶部与 ./scroll 的说明）。
        先换算成「滚动内容坐标系」，再交给纯函数算目标位置。
      */
      const boxRect = box.getBoundingClientRect()
      const rect = el.getBoundingClientRect()
      const top = nearestScrollTop(
        { scrollTop: box.scrollTop, clientHeight: box.clientHeight, scrollHeight: box.scrollHeight },
        { contentTop: rect.top - boxRect.top + box.scrollTop, height: rect.height },
        QUESTION_SCROLL_GAP,
      )
      if (top === box.scrollTop) return
      box.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
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
      guest?.emit({
        type: 'input',
        questionId: q.id,
        value: next.value,
        ...(next.text ? { text: next.text } : {}),
        ...(next.image ? { image: next.image } : {}),
        ...(next.rawImage ? { rawImage: next.rawImage } : {}),
        at: Date.now(),
      })
      if (!advance) return
      const idx = questions.findIndex((x) => x.id === q.id)
      const rest = questions.slice(idx + 1).concat(questions.slice(0, idx))
      const target = rest.find((x) => isBlank(x, answers[x.id])) ?? rest[0]
      if (target) window.setTimeout(() => gotoQuestion(target.id), 260)
    },
    [answers, guest, questions, gotoQuestion],
  )

  const addHandwrittenImage = useCallback((img: string) => {
    setHandwrittenImages((prev) => {
      if (prev.includes(img)) return prev
      const next = [...prev, img]
      guest?.emit({ type: 'setHandwritten', images: next })
      return next
    })
  }, [guest])

  const removeHandwrittenImage = useCallback((indexToRemove: number) => {
    setHandwrittenImages((prev) => {
      const next = prev.filter((_, i) => i !== indexToRemove)
      guest?.emit({ type: 'setHandwritten', images: next })
      return next
    })
  }, [guest])

  const updateHandwrittenImage = useCallback((indexToUpdate: number, newImg: string) => {
    setHandwrittenImages((prev) => {
      const next = prev.map((img, i) => (i === indexToUpdate ? newImg : img))
      guest?.emit({ type: 'setHandwritten', images: next })
      return next
    })
  }, [guest])

  const handleRequestSubmit = useCallback(() => {
    if (submittedRef.current) return
    setConfirm('submit')
  }, [])

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
  const totalCount = questions.length || 1
  const answeredPercent = Math.round((answeredCount / totalCount) * 100)

  const lastAnswered = (() => {
    for (let i = questions.length - 1; i >= 0; i--) if (!isBlank(questions[i], answers[questions[i].id])) return questions[i].id
    return ''
  })()

  const currentIdx = questions.findIndex((q) => q.id === lastAnswered)
  const activeIdx = currentIdx >= 0 ? currentIdx : 0

  const gotoPrev = () => {
    if (activeIdx > 0) {
      const target = questions[activeIdx - 1]
      if (target) gotoQuestion(target.id)
    }
  }

  const gotoNext = () => {
    if (activeIdx < questions.length - 1) {
      const target = questions[activeIdx + 1]
      if (target) gotoQuestion(target.id)
    }
  }

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
      <div className="flex h-screen items-center justify-center bg-paper text-[13px] text-ink-faint">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
          <Clock size={15} className="animate-spin text-seal" />
          <span>{t('正在打开试卷…')}</span>
          </div>
          <button
            onClick={() => guest?.emit({ type: 'ready' })}
            className="rounded border border-line bg-card px-2.5 py-1 text-[11px] text-ink-soft hover:bg-paper hover:text-ink transition-colors cursor-pointer"
          >
            {t('若长时间未加载，点击重试')}
          </button>
        </div>
      </div>
    )
  }

  return (
    /*
      整页固定为窗口高度并且裁掉溢出：考试窗口是独立窗口，页面本身永远不该滚动。
      曾经这里是 `h-full min-h-screen`——一旦有东西把根滚动元素撑高（例如 scrollIntoView
      顺手滚了 html），整页会被顶上去，底下空一大块。见 ./scroll 的说明。
    */
    <div className="flex h-screen flex-col overflow-hidden bg-paper text-ink select-none">
      {/* 紧凑顶栏 HUD */}
      <header
        className={
          'app-drag relative flex shrink-0 items-center justify-between border-b border-line bg-card/90 px-4 h-12 ' +
          (isElectron() && isMac() ? 'pl-[76px]' : '')
        }
      >
        {/* 左侧：标题与卷面属性 */}
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-seal/10 text-seal">
            <Timer size={13} />
          </div>
          <span className="truncate text-[13px] font-semibold text-ink-strong max-w-[220px] sm:max-w-[320px]" title={state.title}>
            {state.title}
          </span>
          <div className="hidden sm:flex items-center gap-1 text-[10.5px]">
            <span className="rounded bg-line/60 px-1.5 py-px text-ink-soft">{t(EXAM_KIND_LABEL[state.kind])}</span>
            <span className="rounded bg-line/60 px-1.5 py-px text-ink-soft">{t(EXAM_LEVEL_LABEL[state.level])}</span>
            <span className="text-ink-faint tabular-nums ml-0.5">
              {t('{0} 题 · 满分 {1}', questions.length, state.totalPoints)}
            </span>
          </div>
        </div>

        {/* 中间：紧凑计时器 */}
        {running && (
          <div className="flex shrink-0 items-center justify-center">
            {deadline ? (
              past ? (
                <div
                  className="flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-0.5 text-[11.5px] font-semibold tabular-nums text-red-600 dark:text-red-400 animate-pulse"
                  title={t('到点后是否强制交卷由你在开考前选')}
                >
                  <Clock size={12} />
                  <span>{t('超时 {0}', formatDuration(overtimeMs))}</span>
                </div>
              ) : remainingMs < 300_000 ? (
                <div
                  className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11.5px] font-semibold tabular-nums text-amber-700 dark:text-amber-400"
                  title={t('到点后是否强制交卷由你在开考前选')}
                >
                  <Clock size={12} />
                  <span>{t('剩余 {0}', formatDuration(remainingMs))}</span>
                </div>
              ) : (
                <div
                  className="flex items-center gap-1.5 rounded-md border border-line bg-paper/70 px-2.5 py-0.5 text-[11.5px] font-medium tabular-nums text-ink-strong"
                  title={t('到点后是否强制交卷由你在开考前选')}
                >
                  <Clock size={12} className="text-seal" />
                  <span>{t('剩余 {0}', formatDuration(remainingMs))}</span>
                </div>
              )
            ) : (
              <div
                className="flex items-center gap-1.5 rounded-md border border-line bg-paper/70 px-2.5 py-0.5 text-[11.5px] font-medium tabular-nums text-ink-strong"
                title={t('这份卷子不限时')}
              >
                <Clock size={12} className="text-seal" />
                <span>{t('计时 {0}', formatDuration(now - (startedAt ?? now)))}</span>
              </div>
            )}
          </div>
        )}

        {/* 右侧：作答进度与交卷操作 */}
        <div className="flex shrink-0 items-center gap-1.5">
          {running && (
            <>
              <button
                type="button"
                onClick={() => sheetsRef.current?.scrollIntoView({ behavior: 'smooth' })}
                className={
                  'flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] transition cursor-pointer ' +
                  (handwrittenImages.length > 0
                    ? 'border-seal/40 bg-seal/10 text-seal-deep font-semibold'
                    : 'border-dashed border-line text-ink-soft hover:border-line-strong hover:text-ink')
                }
                title={t('统一上传手写答卷照片')}
              >
                <Camera size={12} className={handwrittenImages.length > 0 ? 'text-seal' : ''} />
                <span>{t('手写答卷')}</span>
                {handwrittenImages.length > 0 && (
                  <span className="rounded-full bg-seal px-1.5 py-px text-[10px] text-white font-bold tabular-nums">
                    {handwrittenImages.length}
                  </span>
                )}
              </button>
              <LanButton onOpen={() => openLanQrModal()} />
              <div className="flex items-center gap-1 rounded border border-line bg-paper/60 px-2 py-0.5 text-[11px] tabular-nums text-ink-soft">
                <span>{t('已答 {0}/{1}', answeredCount, questions.length)}</span>
                <span className="text-[10px] text-ink-faint">({answeredPercent}%)</span>
              </div>
              <button
                type="button"
                onClick={() => setConfirm('abandon')}
                className="rounded px-2 py-1 text-[11px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
              >
                {t('放弃考试')}
              </button>
              <button
                type="button"
                onClick={handleRequestSubmit}
                className="flex items-center gap-1 rounded bg-seal px-3 py-1 text-[11.5px] font-semibold text-paper shadow-2xs hover:bg-seal-deep transition active:scale-[0.98] cursor-pointer"
              >
                <Flag size={11} />
                <span>{t('交卷')}</span>
              </button>
            </>
          )}
        </div>

        {/* 顶部平滑微进度线 */}
        {running && (
          <div className="absolute inset-x-0 bottom-0 h-[1.5px] bg-line/40 overflow-hidden">
            <div
              className="h-full bg-seal transition-all duration-300 ease-out"
              style={{ width: `${answeredPercent}%` }}
            />
          </div>
        )}
      </header>

      {/* 开考指引台 */}
      {phase === 'intro' && (
        <IntroScreen
          state={state}
          forceSubmit={forceSubmit}
          onForceSubmit={setForceSubmit}
          onStart={start}
          onQuit={quitWithoutStart}
        />
      )}

      {/* 结算提示页 */}
      {phase === 'settled' && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-seal/10 text-seal">
            <Check size={22} strokeWidth={2.5} />
          </div>
          <p className="text-[14px] font-semibold text-ink-strong">{state.notice}</p>
          <p className="text-[11.5px] text-ink-faint">{t('这个窗口马上会关掉；试卷列表里能看到这一次的记录。')}</p>
        </div>
      )}

      {/* 考中单栏题目流与悬浮答题坞 */}
      {running && (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            style={{ padding: `${PAD_TOP}px ${PAD_X}px ${PAD_BOTTOM}px` }}
          >
            <div className="mx-auto flex w-full flex-col gap-4" style={{ maxWidth: PAPER_MAX_W }}>
              <UnifiedHandwrittenSheetsCard
                ref={sheetsRef}
                images={handwrittenImages}
                onAddImage={addHandwrittenImage}
                onUpdateImage={updateHandwrittenImage}
                onRemoveImage={removeHandwrittenImage}
                onPreviewImage={setPreviewImage}
                onOpenLan={() => openLanQrModal()}
              />
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

          {/* 底部固定答题坞 */}
          <footer className="shrink-0 border-t border-line bg-card/95 backdrop-blur z-20">
            {stripOpen && (
              <div className="border-b border-line/50 p-2.5 max-h-[140px] overflow-y-auto">
                <div className="mx-auto flex max-w-[min(94vw,900px)] flex-wrap items-center justify-center gap-1.5">
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
                          'flex h-6 min-w-6 items-center justify-center rounded border px-1 text-[11px] tabular-nums transition cursor-pointer ' +
                          (done
                            ? 'border-seal/50 bg-seal/15 font-semibold text-seal-deep'
                            : 'border-dashed border-line-strong bg-paper/30 text-ink-faint hover:border-line hover:text-ink') +
                          (current ? ' ring-1.5 ring-seal/50 font-bold' : '')
                        }
                      >
                        {i + 1}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="mx-auto flex h-11 max-w-[min(96vw,900px)] items-center justify-between px-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={gotoPrev}
                  disabled={activeIdx <= 0}
                  title={t('上一题')}
                  className="flex items-center gap-1 rounded border border-line bg-paper/60 px-2 py-1 text-[11.5px] font-medium text-ink-soft transition hover:bg-line/50 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
                >
                  <ChevronLeft size={12} />
                  <span>{t('上一题')}</span>
                </button>
                <button
                  type="button"
                  onClick={gotoNext}
                  disabled={activeIdx >= questions.length - 1}
                  title={t('下一题')}
                  className="flex items-center gap-1 rounded border border-line bg-paper/60 px-2 py-1 text-[11.5px] font-medium text-ink-soft transition hover:bg-line/50 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
                >
                  <span>{t('下一题')}</span>
                  <ChevronRight size={12} />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setStripOpen((v) => !v)}
                title={stripOpen ? t('收起题号条') : t('展开题号条')}
                className="flex items-center gap-1.5 rounded-full border border-line-strong/80 bg-paper/70 px-3 py-1 text-[11.5px] font-medium text-ink-strong shadow-2xs backdrop-blur transition hover:bg-paper hover:border-line cursor-pointer"
              >
                <span>{t('答题卡')}</span>
                <span className="text-[11px] text-ink-faint tabular-nums">({answeredCount}/{questions.length})</span>
                <ChevronDown
                  size={11}
                  className={'transition-transform duration-200 ' + (stripOpen ? 'rotate-180' : '')}
                />
              </button>

              <div className="text-[11px] tabular-nums text-ink-faint">
                <span>{t('已完成 {0}%', answeredPercent)}</span>
              </div>
            </div>
          </footer>
        </div>
      )}

      {/* 确认弹窗 */}

      {/* 局域网扫码直连弹窗 */}
      {lanOpen && <LanConnectDialog open={lanOpen} onClose={() => setLanOpen(false)} />}

      <ImageLightboxModal
        src={previewImage}
        title={t('手写答卷原图预览')}
        onClose={() => setPreviewImage(null)}
      />

      {confirm && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 backdrop-blur-[2px]">
          <div className="moji-dialog-in w-[380px] rounded-xl border border-line-strong bg-card p-4 shadow-xl">
            <div className="flex items-center gap-2">
              <div
                className={
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded ' +
                  (confirm === 'submit' ? 'bg-seal/10 text-seal' : 'bg-red-500/10 text-red-600')
                }
              >
                {confirm === 'submit' ? <Flag size={14} /> : <AlertTriangle size={14} />}
              </div>
              <h3 className="text-[14px] font-bold text-ink-strong">
                {confirm === 'submit' ? t('现在交卷？') : t('放弃这次考试？')}
              </h3>
            </div>

            <div className="mt-2.5 text-[12px] leading-relaxed text-ink-soft">
              {confirm === 'submit' ? (
                <>
                  <p>{t('交卷后导师会判分并写错题讲解。')}</p>
                  {handwrittenImages.length > 0 ? (
                    <div className="mt-2 flex items-start gap-1.5 rounded border border-seal/30 bg-seal/10 p-2 text-seal-deep text-[11.5px]">
                      <Camera size={13} className="mt-0.5 shrink-0 text-seal" />
                      <span>
                        {t(
                          '已上传 {0} 份手写答卷照片。导师将根据手写内容审阅判分并裁切贴题，请自行检查确认作答完整。',
                          handwrittenImages.length,
                        )}
                      </span>
                    </div>
                  ) : answeredCount < questions.length ? (
                    <div className="mt-2 flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-amber-800 dark:text-amber-300 text-[11.5px]">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                      <span>{t('还有 {0} 题没作答，它们会记 0 分。', questions.length - answeredCount)}</span>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-emerald-800 dark:text-emerald-300 text-[11.5px]">
                      <Check size={13} className="shrink-0" />
                      <span>{t('所有题目均已完成作答。')}</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded border border-red-500/30 bg-red-500/10 p-2.5 text-red-800 dark:text-red-300 text-[11.5px]">
                  <p>{t('放弃会**直接记 0 分**，导师不会判分、也不会写错题讲解。这份卷子以后还能重考。')}</p>
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="rounded border border-line bg-paper/60 px-3 py-1.5 text-[11.5px] font-medium text-ink-soft transition hover:bg-line/60 hover:text-ink"
              >
                {t('继续作答')}
              </button>
              <button
                type="button"
                onClick={() => submit(confirm)}
                className={
                  'rounded px-3.5 py-1.5 text-[11.5px] font-semibold text-paper shadow-2xs transition ' +
                  (confirm === 'submit' ? 'bg-seal hover:bg-seal-deep' : 'bg-red-600 hover:bg-red-700')
                }
              >
                {confirm === 'submit' ? t('确认交卷') : t('放弃并记 0 分')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function isBlank(q: ExamQuestion, draft: Draft | undefined): boolean {
  if (!draft) return true
  if (draft.image) return false
  if (q.type === 'fill' || q.type === 'short') return !draft.text.trim()
  return draft.value.length === 0
}

/** 紧凑开考指引台 */
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
  const passScore = Math.round(state.totalPoints * EXAM_PASS_RATIO)

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-[480px] rounded-xl border border-line-strong bg-card p-5 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-seal/10 text-seal">
            <Award size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-line/60 px-1.5 py-px text-[10.5px] font-medium text-ink-soft">
                {t(EXAM_KIND_LABEL[state.kind])}
              </span>
              <span className="rounded bg-line/60 px-1.5 py-px text-[10.5px] font-medium text-ink-soft">
                {t(EXAM_LEVEL_LABEL[state.level])}
              </span>
              <span className="rounded bg-seal/10 px-1.5 py-px text-[10.5px] font-medium text-seal-deep">
                {limit}
              </span>
            </div>
            <h1 className="mt-1 truncate text-[16px] font-bold text-ink-strong">{state.title}</h1>
          </div>
        </div>

        {/* 紧凑 4 项指标条 */}
        <div className="mt-4 grid grid-cols-4 gap-2">
          <div className="rounded border border-line/70 bg-paper/40 p-2 text-center">
            <div className="text-[10px] text-ink-faint">{t('题量')}</div>
            <div className="mt-0.5 text-[14px] font-bold text-ink-strong tabular-nums">
              {state.questions.length} <span className="text-[10px] font-normal text-ink-faint">{t('题')}</span>
            </div>
          </div>
          <div className="rounded border border-line/70 bg-paper/40 p-2 text-center">
            <div className="text-[10px] text-ink-faint">{t('满分')}</div>
            <div className="mt-0.5 text-[14px] font-bold text-ink-strong tabular-nums">
              {state.totalPoints} <span className="text-[10px] font-normal text-ink-faint">{t('分')}</span>
            </div>
          </div>
          <div className="rounded border border-line/70 bg-paper/40 p-2 text-center">
            <div className="text-[10px] text-ink-faint">{t('时限')}</div>
            <div className="mt-0.5 text-[13px] font-bold text-ink-strong">{limit}</div>
          </div>
          <div className="rounded border border-line/70 bg-paper/40 p-2 text-center">
            <div className="text-[10px] text-ink-faint">{t('及格标准')}</div>
            <div className="mt-0.5 text-[14px] font-bold text-ok-deep tabular-nums">
              {passScore} <span className="text-[10px] font-normal text-ink-faint">{t('分')}</span>
            </div>
          </div>
        </div>

        {/* 守则提示 */}
        <div className="mt-3.5 rounded-lg border border-line bg-paper/30 p-3">
          <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-strong">
            <ShieldCheck size={13} className="text-seal" />
            <span>{t('考试须知与考场守则')}</span>
          </div>
          <ul className="mt-1.5 flex flex-col gap-1 text-[11px] leading-relaxed text-ink-soft">
            <li>· {t('开始后窗口会全屏，归一主窗口会盖上一层黑遮罩，避免一边答题一边翻文档。')}</li>
            <li>· {t('一旦开始，只有**交卷**与**放弃**两条路；放弃直接记 0 分，不判分也不写错题讲解。')}</li>
            <li>· {t('每题用时按你**落定答案的先后**推算（这一笔减上一笔），不用你配合任何计时动作。')}</li>
            <li>· {t('作答与切屏次数都会被记下来，导师据此判断你的薄弱项。')}</li>
          </ul>
        </div>

        {state.minutes > 0 && (
          <div className="mt-3 rounded-lg border border-line bg-paper/50 px-3 py-2 text-[11.5px]">
            <Switch
              on={forceSubmit}
              onChange={onForceSubmit}
              label={t('到点强制交卷')}
              hint={t('关掉它可以继续作答：超时多久、哪几笔是超时答的都会被记下来，不会因此判你作弊')}
            />
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onStart}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-seal px-4 py-2 text-[12px] font-semibold text-paper shadow-2xs transition hover:bg-seal-deep active:scale-[0.99]"
          >
            <Play size={13} fill="currentColor" />
            {t('开始考试')}
          </button>
          <button
            type="button"
            onClick={onQuit}
            className="flex items-center justify-center gap-1 rounded-lg border border-line bg-paper/60 px-3.5 py-2 text-[12px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
          >
            <X size={13} />
            {t('退出（什么都不发生）')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 紧凑题目卡片：排版舒适，杜绝臃肿卡牌 */
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