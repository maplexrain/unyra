/*
 * 本文件负责：考试窗口的**答题会话状态**——与主窗口的桥（收状态 / 发作答事件 /
 * ready 重试 / 确认关窗）、作答复本、手写答卷照片、切屏守卫挂载、每秒计时与
 * 到点判定（含到点自动交卷）、交卷与放弃、确认弹窗状态，以及渲染要用的派生量
 * （phase / startedAt / deadline / 剩余超时时长等）。
 *
 * 原样搬自 ExamWindow.tsx 主组件的状态、通信与回调区块（注释一并带走），按本仓库
 * 惯例收成 XxxDeps 单对象的逻辑 hook。翻题滚动（gotoQuestion）由宿主先声明好传入，
 * hook 不关心滚动怎么实现（只滚题目流自己的说明见 ExamWindow.tsx 顶部与 ./scroll）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { native } from '../../lib/native'
import type { ExamQuestion } from '../../learn/exam'
import type { ExamWindowState } from '../../learn/useExamBridge'
import { t } from '../../i18n'
import { isBlank } from './examDraft'
import type { Draft } from './examDraft'
import { useExamGuard } from './examGuard'

const EMPTY_QUESTIONS: ExamQuestion[] = []

/** 会话需要宿主提供的最小输入（都在宿主里先声明好，不存在晚绑定） */
export interface ExamSessionDeps {
  /** 开考前选的「到点强制交卷」开关：start 要把它发给主窗口，到点自动交卷也要读它 */
  forceSubmit: boolean
  /** 落定答案后自动跳到下一题用的翻题动作（宿主的 scrollToQuestion，身份稳定） */
  gotoQuestion: (questionId: string) => void
}

/**
 * 考试会话。返回桥（guest）、会话状态、全部会话动作与渲染要用的派生量；
 * 与主窗口的通信、计时、切屏守卫、自动交卷都关在本 hook 里。
 */
export function useExamSession({ forceSubmit, gotoQuestion }: ExamSessionDeps) {
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
  const [confirm, setConfirm] = useState<null | 'submit' | 'abandon'>(null)
  const [localStart, setLocalStart] = useState<number | null>(null)
  const [handwrittenImages, setHandwrittenImages] = useState<string[]>([])
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

  useExamGuard({ guest, running })

  /* ---------- 作答与翻题 ---------- */

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

  return {
    /** 考试窗口那一侧的桥（加载失败重试也要发 ready） */
    guest,
    /** 主窗口推来的整份考试状态（null = 还没拿到） */
    state,
    phase,
    running,
    questions,
    startedAt,
    deadline,
    overtimeMs,
    remainingMs,
    past,
    now,
    answers,
    handwrittenImages,
    /** 交卷 / 放弃的确认弹窗状态；header 的「放弃考试」与弹窗本身都要读写 */
    confirm,
    setConfirm,
    setAnswer,
    addHandwrittenImage,
    removeHandwrittenImage,
    updateHandwrittenImage,
    handleRequestSubmit,
    submit,
    start,
    quitWithoutStart,
  }
}
