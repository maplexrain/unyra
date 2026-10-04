/**
 * 本文件负责：试卷与考试记录——读卷、开考、交卷、放弃，以及 Agent 判分 / 错题讲解的落库。
 */
import type { Exam, ExamAttempt } from '../exam'
import type { LearnStore } from '../types'
import { attemptScore, examTotalPoints, EXAM_PASS_RATIO, gradeObjectiveAll, isAutoGradable } from '../exam'
import { newAttempt, settleAttempt } from '../examRecords'
import { applyExamCheckin, checkinDay, checkinOfGoal, emptyCheckin, withGoalCheckin } from '../checkin'
import { studyDayOf } from '../reading'
import { addCheck, setNodeStatus } from './state'

/* ---------- 考试 ---------- */

/** 某节点的试卷，按创建时间升序（最新一份在末尾） */
export function examsOfNode(store: LearnStore, nodeId: string): Exam[] {
  return store.exams.filter((e) => e.nodeId === nodeId).sort((a, b) => a.createdAt - b.createdAt)
}

/**
 * 正在考的那一次（跨全部节点找）。
 *
 * 考试窗口是单例、同一时刻只可能有一次在考，所以这里不按节点过滤：
 * 主窗口要用它决定「要不要盖上黑遮罩」「关窗时该结算哪一次」。
 */
export function ongoingAttempt(store: LearnStore): { exam: Exam; attempt: ExamAttempt } | undefined {
  for (const exam of store.exams) {
    const attempt = exam.attempts.find((a) => a.status === 'ongoing')
    if (attempt) return { exam, attempt }
  }
  return undefined
}

/** 最新一份试卷（「读卷」与列表的默认落点） */
export function latestExam(store: LearnStore, nodeId: string): Exam | undefined {
  const list = examsOfNode(store, nodeId)
  return list.length ? list[list.length - 1] : undefined
}

export function upsertExam(store: LearnStore, exam: Exam): LearnStore {
  const exists = store.exams.some((e) => e.id === exam.id)
  return {
    ...store,
    exams: exists ? store.exams.map((e) => (e.id === exam.id ? exam : e)) : [...store.exams, exam],
  }
}

export function removeExam(store: LearnStore, examId: string): LearnStore {
  return { ...store, exams: store.exams.filter((e) => e.id !== examId) }
}

/**
 * 把插图自检的修复结果写回某份试卷（questionId → 修好的 SVG）。
 * 自检跑在出卷之后（见 workspace/examImageCheck），试卷已经落库，这里按 id 就地替换；
 * 试卷或题目已不存在的（比如用户中途删了卷）就当没发生。
 */
export function replaceQuestionImages(store: LearnStore, examId: string, images: Record<string, string>): LearnStore {
  const ids = Object.keys(images)
  if (!ids.length) return store
  return {
    ...store,
    exams: store.exams.map((e) =>
      e.id !== examId
        ? e
        : {
            ...e,
            questions: e.questions.map((q) => (images[q.id] !== undefined ? { ...q, image: images[q.id] } : q)),
          },
    ),
  }
}

/** 写入一次考试（新建或整条替换）——考试记录挂在试卷下面，所以落盘时动的是试卷 */
export function upsertAttempt(store: LearnStore, examId: string, attempt: ExamAttempt): LearnStore {
  const exam = store.exams.find((e) => e.id === examId)
  if (!exam) return store
  const exists = exam.attempts.some((a) => a.id === attempt.id)
  const attempts = exists
    ? exam.attempts.map((a) => (a.id === attempt.id ? attempt : a))
    : [...exam.attempts, attempt]
  return upsertExam(store, { ...exam, attempts })
}

/** 找出某一份试卷里的某一次考试 */
export function findAttempt(store: LearnStore, examId: string, attemptId: string): ExamAttempt | undefined {
  return store.exams.find((e) => e.id === examId)?.attempts.find((a) => a.id === attemptId)
}

/**
 * 开考：新建一次 ongoing 的考试记录（id 与时间由调用方给，保持纯函数）。
 * 同一份卷子同时只允许一次在考——已经有在考的直接原样返回，界面那侧也不该给出入口。
 */
export function startAttempt(
  store: LearnStore,
  examId: string,
  attemptId: string,
  at: number,
  forceSubmit: boolean,
): LearnStore {
  const exam = store.exams.find((e) => e.id === examId)
  if (!exam || exam.attempts.some((a) => a.status === 'ongoing')) return store
  return upsertAttempt(store, examId, newAttempt(attemptId, at, forceSubmit))
}

/** 交卷：状态转待判分，并**当场**把客观题判掉（主观题留给 Agent） */
export function submitAttempt(store: LearnStore, examId: string, attemptId: string, at: number): LearnStore {
  const exam = store.exams.find((e) => e.id === examId)
  const attempt = exam?.attempts.find((a) => a.id === attemptId)
  if (!exam || !attempt || attempt.status !== 'ongoing') return store
  const settled = settleAttempt(attempt, exam, { status: 'submitted', at })
  return upsertAttempt(store, examId, { ...settled, results: gradeObjectiveAll(exam, settled.answers) })
}

/**
 * 放弃考试：**判 0 分，不判分、也不做错题讲解**（用户明确要的语义）。
 * 记录本身留着——「他开考又放弃了」是学习行为的一部分，下次讲解该看得到。
 */
export function abandonAttempt(store: LearnStore, examId: string, attemptId: string, at: number): LearnStore {
  const exam = store.exams.find((e) => e.id === examId)
  const attempt = exam?.attempts.find((a) => a.id === attemptId)
  if (!exam || !attempt || attempt.status !== 'ongoing') return store
  const settled = settleAttempt(attempt, exam, { status: 'abandoned', at })
  return upsertAttempt(store, examId, { ...settled, results: undefined, passed: false })
}

/** Agent 返回的阅卷结果 */
export interface GradePayload {
  results?: Array<{ questionId?: string; correct?: boolean; score?: number; comment?: string }>
  summary?: string
  passed?: boolean
}

/**
 * 把 Agent 的判分落到**某一次考试**上，并在「完全掌握」时把节点改为已掌握。
 * 纯函数：客观题以系统判分为准（忽略 Agent 对客观题的重复提交），主观题采信 Agent。
 */
export function applyGradeResult(
  store: LearnStore,
  examId: string,
  attemptId: string,
  payload: GradePayload,
): { store: LearnStore; ok: boolean; message: string } {
  const exam = store.exams.find((e) => e.id === examId)
  const attempt = exam?.attempts.find((a) => a.id === attemptId)
  if (!exam || !attempt) return { store, ok: false, message: '找不到这一次考试' }
  if (attempt.status === 'abandoned') {
    return { store, ok: false, message: '这一次是放弃的，判 0 分、不判分（这是用户的选择）' }
  }
  if (attempt.status === 'ongoing') {
    return { store, ok: false, message: '这一次还在考，等交卷之后再判分' }
  }
  if (typeof payload.passed !== 'boolean' || typeof payload.summary !== 'string') {
    return { store, ok: false, message: '缺少 passed 或 summary' }
  }

  const results = gradeObjectiveAll(exam, attempt.answers)
  for (const item of payload.results ?? []) {
    if (!item.questionId) continue
    const idx = results.findIndex((x) => x.questionId === item.questionId)
    if (idx < 0) continue
    const q = exam.questions[idx]
    const comment = typeof item.comment === 'string' ? unescapeNewlines(item.comment) : undefined
    if (isAutoGradable(q)) {
      // 客观题的分数以系统为准（不采信 Agent 给的对错/分数），
      // 但 Agent 为错题补的讲解要收下——否则客观题将没有任何错题讲解。
      if (comment) results[idx] = { ...results[idx], comment }
      continue
    }
    const score =
      typeof item.score === 'number'
        ? Math.max(0, Math.min(q.points, item.score))
        : item.correct
          ? q.points
          : 0
    results[idx] = {
      questionId: item.questionId,
      correct: item.correct === true,
      score,
      maxScore: q.points,
      comment,
      by: 'agent',
    }
  }

  const graded: ExamAttempt = {
    ...attempt,
    status: 'graded',
    results,
    summary: unescapeNewlines(payload.summary),
    passed: payload.passed,
  }
  let next = upsertAttempt(store, examId, graded)
  if (payload.passed) next = setNodeStatus(next, exam.nodeId, 'mastered')
  /*
   * 阅卷即是一次检验：把这一次的成绩记进学习状态的时间线。
   *
   * 为什么由这里记、而不是交给 Agent 顺手调 api.state.check：成绩是系统算出来的确定值，
   * 让它经一次模型往返再写回来，只会多一个「模型忘了」的缺口。掌握度不在这里动——
   * 那要综合错题与自评，是 Agent 的判断（见提示词「学习状态」一节）。
   *
   * 只在第一次判分时记（重复调用不该在时间线上留下两条）。
   */
  if (attempt.status !== 'graded') {
    const total = examTotalPoints(exam)
    const got = attemptScore(graded)
    next = addCheck(next, exam.nodeId, {
      kind: 'exam',
      at: Date.now(),
      score: total > 0 ? Math.round((got / total) * 100) : 0,
      note: '《' + exam.title + '》' + got + '/' + total + ' 分，' + (payload.passed ? '判定已完全掌握' : '尚未完全掌握'),
    })
    /*
     * 打卡的另一种方式（需求）：这个目标的试卷**第一次考试**就达到及格线（卷面 ≥ 60%），
     * 今天自动打卡。为什么由这里落账、而不是让 Agent 顺手调 checkin.settle：
     * 成绩是系统算出来的确定值，经一次模型往返再写回来只会多一个「模型忘了」的缺口
     * （与上面 addCheck 同一条理由）。重考及格不算——奖励的是「第一次就考过」；
     * 今天已经打过卡的也不再重复记（applyExamCheckin 里还有一道同样的闸）。
     */
    if (exam.attempts[0]?.id === attemptId && total > 0 && got / total >= EXAM_PASS_RATIO) {
      const day = studyDayOf(Date.now())
      const book = checkinOfGoal(next.checkin, exam.goalId) ?? emptyCheckin()
      if (!checkinDay(book, day)?.passed) {
        const out = applyExamCheckin(book, { day, at: Date.now(), title: exam.title, score: got, total })
        if (out.ok) next = { ...next, checkin: withGoalCheckin(next.checkin, exam.goalId, out.store) }
      }
    }
  }
  return { store: next, ok: true, message: payload.passed ? '已记录：完全掌握' : '已记录：尚未完全掌握' }
}

/**
 * 把 Agent 写的**错题讲解**落到某一次考试上（显示在只读的试卷副本页签里）。
 *
 * 为什么单独一个入口、而不是塞进 applyGradeResult：
 * 判分与讲解是一套工作流里的两步（判分 → 看历史错题 → 讲解），
 * 分开之后「判过了但还没讲解」这个中间态是可表达的，界面上也能催。
 */
export function applyExplanation(
  store: LearnStore,
  examId: string,
  attemptId: string,
  content: string,
): { store: LearnStore; ok: boolean; message: string } {
  const exam = store.exams.find((e) => e.id === examId)
  const attempt = exam?.attempts.find((a) => a.id === attemptId)
  if (!exam || !attempt) return { store, ok: false, message: '找不到这一次考试' }
  const text = unescapeNewlines(content).trim()
  if (!text) return { store, ok: false, message: '错题讲解是空的' }
  if (attempt.status === 'abandoned') {
    return { store, ok: false, message: '这一次是放弃的，不做错题讲解（这是用户的选择）' }
  }
  if (attempt.status === 'ongoing') return { store, ok: false, message: '这一次还在考，别急着讲解' }
  return {
    store: upsertAttempt(store, examId, { ...attempt, explanation: text }),
    ok: true,
    message: '已写入错题讲解（' + text.length + ' 字），显示在试卷副本页签里',
  }
}

/**
 * 模型经工具参数传字符串时，换行常被二次转义成字面量 `\n`。
 * 这里只在确认没有真实换行时做一次还原，避免误伤正常文本。
 */
function unescapeNewlines(s: string): string {
  if (s.includes('\n')) return s
  return s.replace(/\\r\\n|\\n/g, '\n').replace(/\\"/g, '"')
}

