/**
 * 考试窗口与主窗口之间的桥（**主窗口这一侧**）。
 *
 * 分工写在最前面，因为它是这一块唯一的架构决定：
 * - **主窗口是数据拥有者**：开考、作答、单题耗时、切屏、交卷、放弃，全都回这里落盘
 *   （它才持有 store，落盘是它的事）；
 * - **考试窗口只发事件、收状态**：它连 store 都读不到，全屏、倒计时、计时区都在它自己那边，
 *   但一笔数据都不写。
 *
 * 两个后果值得说明：
 * 1. 考试窗口崩了/被强杀，主窗口这边还留着一次 ongoing 的考试——所以有 onClosed 兜底
 *    与启动时的清理（见 reapStale），否则主窗口会一直盖着黑遮罩出不来；
 *    （单题耗时也在这边算：考试窗口只报「哪一题落定了什么」，时间由 learn/examRecords 按
 *    相邻两次落定的时间戳推——界面那侧因此不需要任何计时配合。）
 * 2. 交卷之后由**这里**触发判分+讲解那套工作流：判分要读刚交上来的卷子，
 *    而「什么时候算交卷」只有这里知道。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { native } from '../lib/native'
import type { Exam, ExamAnswer, ExamAttempt, ExamKind, ExamLevel, ExamQuestion } from './exam'
import { examTotalPoints } from './exam'
import { newAttempt, recordBlurEnd, recordBlurStart, recordInput } from './examRecords'
import { abandonAttempt, findAttempt, ongoingAttempt, submitAttempt, upsertAttempt } from './graph'
import type { LearnStore } from './types'
import { t } from '../i18n'

/** 推给考试窗口的状态。主进程只转发，形状由两侧自己约定 */
export interface ExamWindowState {
  /** intro：还没开考（开始 / 退出）；running：正在考；settled：已收尾（交卷或放弃） */
  phase: 'intro' | 'running' | 'settled'
  examId: string
  nodeId: string
  title: string
  kind: ExamKind
  level: ExamLevel
  /** 0 = 不限时 */
  minutes: number
  totalPoints: number
  questions: ExamQuestion[]
  /** running 时有；考试窗口据此恢复作答（重开窗口也不丢） */
  attempt?: { id: string; startedAt: number; forceSubmit: boolean; answers: ExamAnswer[] }
  /** settled 时那句提示 */
  notice?: string
}

/** 考试窗口发来的事件 */
export type ExamWindowEvent =
  /** 界面挂好了：请把当前状态推过来（open 的载荷不保证送达，见 lib/native 的说明） */
  | { type: 'ready' }
  | { type: 'start'; at: number; forceSubmit: boolean }
  | { type: 'input'; questionId: string; value: string[]; text?: string; at: number }
  | { type: 'blurStart'; at: number }
  | { type: 'blurEnd'; at: number }
  /** 交卷（含「到点强制交卷」那一次） */
  | { type: 'submit'; at: number }
  /** 放弃：判 0 分，不判分、不讲解 */
  | { type: 'abandon'; at: number }

export interface ExamLive {
  examId: string
  attemptId: string
  nodeId: string
}

/** 正在考的那一次（有它就盖黑遮罩）；列表里据此禁用「考试」按钮 */
export interface ExamBridgeApi {
  /** 打开考试窗口（没开考的那一份给 intro）；live 非空时改为聚焦已有窗口 */
  openExam: (examId: string) => void
  /** 把考试窗口叫回前台（黑遮罩上那颗按钮） */
  reveal: () => void
  /** 正在考的这一次；null = 没在考 */
  live: ExamLive | null
}

/** 启动时清理上一次留下的「正在考」——应用被强杀时它就是脏数据 */
let reaped = false

function shapeState(exam: Exam, attempt: ExamAttempt | undefined, notice?: string): ExamWindowState {
  return {
    phase: attempt ? 'running' : notice ? 'settled' : 'intro',
    examId: exam.id,
    nodeId: exam.nodeId,
    title: exam.title,
    kind: exam.kind,
    level: exam.level,
    minutes: exam.minutes,
    totalPoints: examTotalPoints(exam),
    questions: exam.questions,
    ...(attempt
      ? {
          attempt: {
            id: attempt.id,
            startedAt: attempt.startedAt,
            forceSubmit: attempt.forceSubmit,
            answers: attempt.answers,
          },
        }
      : {}),
    ...(notice ? { notice } : {}),
  }
}

export function useExamBridge(opts: {
  getLatest: () => LearnStore
  set: (next: LearnStore) => void
  /** 交卷之后跑「判分 + 讲解」那套工作流 */
  onSubmitted: (examId: string, attemptId: string) => void
}): ExamBridgeApi {
  const [live, setLive] = useState<ExamLive | null>(null)
  /**
   * live 的镜像：IPC 的事件回调是**注册一次**的，读不到最新的 state，
   * 所以每次都要有一份 ref 跟着。用 effect 同步而不是渲染期赋值——
   * 渲染期改 ref 是 React 的禁忌（编译器会跳过整个组件的优化），
   * 而回调真正被触发时它早就同步好了。
   */
  const liveRef = useRef<ExamLive | null>(null)
  useEffect(() => {
    liveRef.current = live
  })
  /** 刚点开、还没收到 ready 的那一份；ready 到达时用它决定推什么状态 */
  const pendingRef = useRef<string | null>(null)
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })

  const push = useCallback((state: ExamWindowState) => {
    try {
      native().examHost.push(state)
    } catch {
      // 没有考试窗口桥（浏览器里跑测试）：静默跳过，这条通道本来就是「尽力而为」
    }
  }, [])

  /* 启动时把上一次留下的 ongoing 清掉：应用被强杀、或考试窗口没走完退出流程 */
  useEffect(() => {
    if (reaped) return
    reaped = true
    const s = optsRef.current.getLatest()
    const orphan = ongoingAttempt(s)
    if (!orphan) return
    optsRef.current.set(abandonAttempt(s, orphan.exam.id, orphan.attempt.id, Date.now()))
  }, [])

  useEffect(() => {
    const host = (() => {
      try {
        return native().examHost
      } catch {
        return null
      }
    })()
    if (!host) return

    const handle = (raw: unknown): void => {
      const ev = raw as ExamWindowEvent
      const { getLatest, set, onSubmitted } = optsRef.current
      const examId = liveRef.current?.examId ?? pendingRef.current
      if (!ev || !examId) return
      const store = getLatest()
      const exam = store.exams.find((e) => e.id === examId)
      if (!exam) return

      switch (ev.type) {
        case 'ready': {
          const running = exam.attempts.find((a) => a.status === 'ongoing')
          if (running) {
            const next = { examId, attemptId: running.id, nodeId: exam.nodeId }
            liveRef.current = next
            setLive(next)
            push(shapeState(exam, running))
            return
          }
          push(shapeState(exam, undefined))
          return
        }

        case 'start': {
          if (exam.attempts.some((a) => a.status === 'ongoing')) return
          const attemptId = crypto.randomUUID()
          const attempt = newAttempt(attemptId, ev.at, ev.forceSubmit)
          set(upsertAttempt(store, examId, attempt))
          const next = { examId, attemptId, nodeId: exam.nodeId }
          liveRef.current = next
          setLive(next)
          push(shapeState(exam, attempt))
          return
        }

        case 'input': {
          const attemptId = liveRef.current?.attemptId
          if (!attemptId) return
          const attempt = findAttempt(store, examId, attemptId)
          if (!attempt || attempt.status !== 'ongoing') return
          set(
            upsertAttempt(
              store,
              examId,
              recordInput(attempt, exam, {
                questionId: ev.questionId,
                value: ev.value,
                text: ev.text,
                at: ev.at,
              }),
            ),
          )
          return
        }

        case 'blurStart':
        case 'blurEnd': {
          const attemptId = liveRef.current?.attemptId
          if (!attemptId) return
          const attempt = findAttempt(store, examId, attemptId)
          if (!attempt || attempt.status !== 'ongoing') return
          const next =
            ev.type === 'blurStart' ? recordBlurStart(attempt, ev.at) : recordBlurEnd(attempt, ev.at)
          set(upsertAttempt(store, examId, next))
          return
        }

        case 'submit': {
          const attemptId = liveRef.current?.attemptId
          if (!attemptId) return
          set(submitAttempt(store, examId, attemptId, ev.at))
          liveRef.current = null
          setLive(null)
          push({ ...shapeState(exam, undefined), phase: 'settled', notice: t('已交卷，导师正在判分与讲解…') })
          // 让界面先把那句话显示出来，再关窗
          window.setTimeout(() => host.close(), 900)
          onSubmitted(examId, attemptId)
          return
        }

        case 'abandon': {
          const attemptId = liveRef.current?.attemptId
          if (!attemptId) return
          set(abandonAttempt(store, examId, attemptId, ev.at))
          liveRef.current = null
          setLive(null)
          push({ ...shapeState(exam, undefined), phase: 'settled', notice: t('已放弃这次考试（记 0 分）。') })
          window.setTimeout(() => host.close(), 900)
          return
        }
      }
    }

    const offEvent = host.onEvent(handle)
    const offClosed = host.onClosed(() => {
      // 兜底：窗口关掉了但这一场还挂着（强杀、崩溃、主进程收窗口）
      const current = liveRef.current
      liveRef.current = null
      setLive(null)
      if (!current) return
      const { getLatest, set } = optsRef.current
      const store = getLatest()
      const attempt = findAttempt(store, current.examId, current.attemptId)
      if (attempt && attempt.status === 'ongoing') {
        set(abandonAttempt(store, current.examId, current.attemptId, Date.now()))
      }
    })
    return () => {
      offEvent()
      offClosed()
    }
  }, [push])

  const openExam = useCallback(
    (examId: string) => {
      const store = optsRef.current.getLatest()
      const running = ongoingAttempt(store)
      // 已经有一场在考：只把窗口叫回前台，不再开第二次（单例窗口）
      if (running) {
        pendingRef.current = running.exam.id
        liveRef.current = { examId: running.exam.id, attemptId: running.attempt.id, nodeId: running.exam.nodeId }
        setLive(liveRef.current)
        try {
          void native().examHost.open({ examId: running.exam.id, nodeId: running.exam.nodeId })
        } catch {
          // 没有桥就算了：这种情况下也不会真的有一场在考
        }
        return
      }
      const exam = store.exams.find((e) => e.id === examId)
      if (!exam) return
      pendingRef.current = examId
      try {
        void native().examHost.open({ examId, nodeId: exam.nodeId })
      } catch {
        return
      }
    },
    [],
  )

  const reveal = useCallback(() => {
    const current = liveRef.current
    try {
      native().examHost.open({ examId: current?.examId, nodeId: current?.nodeId })
    } catch {
      // 同上：没有桥时无事可做
    }
  }, [])

  return { openExam, reveal, live }
}
