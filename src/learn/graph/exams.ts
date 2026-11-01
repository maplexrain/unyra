/**
 * 本文件负责：试卷与考试记录——读卷、开考、交卷、放弃，以及 Agent 判分 / 错题讲解的落库。
 */
import type { Exam, ExamAnswer, ExamAttempt } from '../exam'
import type { LearnStore } from '../types'
import { gradeObjectiveAll, isAutoGradable } from '../exam'
import { newAttempt, settleAttempt } from '../examRecords'
import { setNodeStatus } from './state'

/* ---------- 考试 ---------- */

/** 某节点的试卷，按创建时间升序（最新一份在末尾） */
export function examsOfNode(store: LearnStore, nodeId: string): Exam[] {
  return store.exams.filter((e) => e.nodeId === nodeId).sort((a, b) => a.createdAt - b.createdAt)
}

/**
 * 这个节点的**空壳试卷**（拖到画布上占位的那种：0 题、没考过），最新的那份。
 *
 * 实体先行模型（2026-10-24）：空试卷卡就是一份真实实体，出题时**吸收**它——
 * 新卷沿用壳的 id 与创建时间落库，画布上那张卡原位变实，不需要任何对账。
 * 没有壳（或壳已被吸收）时回 undefined，出题照常新建。
 */
export function shellExamOf(store: LearnStore, nodeId: string): Exam | undefined {
  const list = examsOfNode(store, nodeId)
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]
    if (e.questions.length === 0 && e.attempts.length === 0) return e
  }
  return undefined
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
  const hasImages = (settled.handwrittenImages && settled.handwrittenImages.length > 0) ||
    settled.answers.some((a) => a.image)
  // 若有手写答卷图片，所有题目（包括客观题）均在手写纸上作答，绝不进行机械式客观题判分，一律交给 Agent 亲自审卷判分
  return upsertAttempt(store, examId, {
    ...settled,
    results: hasImages ? undefined : gradeObjectiveAll(exam, settled.answers),
  })
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
  results?: Array<{
    questionId?: string
    correct?: boolean
    score?: number
    comment?: string
    croppedAnswerImage?: string
    userAnswer?: string | string[]
  }>
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

  const hasImages = (attempt.handwrittenImages && attempt.handwrittenImages.length > 0) ||
    attempt.answers.some((a) => a.image)

  const answers = attempt.answers.slice()
  // 若 Agent 在审阅手写答卷时提取出了学习者的实际作答，更新进 answers
  for (const item of payload.results ?? []) {
    if (!item.questionId || item.userAnswer === undefined) continue
    const idx = answers.findIndex((a) => a.questionId === item.questionId)
    const val = Array.isArray(item.userAnswer)
      ? item.userAnswer.map(String)
      : typeof item.userAnswer === 'string'
        ? [item.userAnswer]
        : []
    const textVal = typeof item.userAnswer === 'string' ? item.userAnswer : undefined
    const existing = answers[idx]
    const updatedAns: ExamAnswer = {
      questionId: item.questionId,
      value: val,
      ...(textVal ? { text: textVal } : {}),
      ...(existing?.image ? { image: existing.image } : {}),
      ...(existing?.rawImage ? { rawImage: existing.rawImage } : {}),
    }
    if (idx >= 0) answers[idx] = updatedAns
    else answers.push(updatedAns)
  }

  // 如果有手写答卷图片，所有题目（包括客观题与主观题）必须由 Agent 亲自审阅判分，绝不进行机械判断
  const results = hasImages
    ? exam.questions.map((q) => {
        const item = (payload.results ?? []).find((x) => x.questionId === q.id)
        const existingAns = answers.find((a) => a.questionId === q.id)
        const existingResult = attempt.results?.find((r) => r.questionId === q.id)
        const comment = typeof item?.comment === 'string' ? unescapeNewlines(item.comment) : undefined
        const croppedAnswerImage = typeof item?.croppedAnswerImage === 'string'
          ? item.croppedAnswerImage
          : existingResult?.croppedAnswerImage || existingAns?.image
        if (!item) {
          return {
            questionId: q.id,
            correct: null,
            score: 0,
            maxScore: q.points,
            by: 'agent' as const,
            ...(croppedAnswerImage ? { croppedAnswerImage } : {}),
          }
        }
        const score = typeof item.score === 'number'
          ? Math.max(0, Math.min(q.points, item.score))
          : item.correct
            ? q.points
            : 0
        return {
          questionId: q.id,
          correct: typeof item.correct === 'boolean' ? item.correct : score === q.points,
          score,
          maxScore: q.points,
          comment,
          by: 'agent' as const,
          ...(croppedAnswerImage ? { croppedAnswerImage } : {}),
        }
      })
    : gradeObjectiveAll(exam, answers)

  if (!hasImages) {
    for (const item of payload.results ?? []) {
      if (!item.questionId) continue
      const idx = results.findIndex((x) => x.questionId === item.questionId)
      if (idx < 0) continue
      const q = exam.questions[idx]
      const existingAns = answers.find((a) => a.questionId === q.id)
      const existingResult = attempt.results?.find((r) => r.questionId === q.id)
      const comment = typeof item.comment === 'string' ? unescapeNewlines(item.comment) : undefined
      const croppedAnswerImage = typeof item.croppedAnswerImage === 'string'
        ? item.croppedAnswerImage
        : existingResult?.croppedAnswerImage || existingAns?.image
      if (isAutoGradable(q)) {
        if (comment || croppedAnswerImage) {
          results[idx] = {
            ...results[idx],
            ...(comment ? { comment } : {}),
            ...(croppedAnswerImage ? { croppedAnswerImage } : {}),
          }
        }
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
        ...(croppedAnswerImage ? { croppedAnswerImage } : {}),
      }
    }
  }

  const graded: ExamAttempt = {
    ...attempt,
    status: 'graded',
    answers,
    results,
    summary: unescapeNewlines(payload.summary),
    passed: payload.passed,
  }

  let next = upsertAttempt(store, examId, graded)
  if (payload.passed) next = setNodeStatus(next, exam.nodeId, 'mastered')
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

/** 将 Agent 裁切出的手写答案图片绑定到对应题目的结果与答案上 */
export function attachCroppedAnswerImage(
  store: LearnStore,
  examId: string,
  attemptId: string,
  questionId: string,
  croppedImagePath: string,
): LearnStore {
  const exam = store.exams.find((e) => e.id === examId)
  const attempt = exam?.attempts.find((a) => a.id === attemptId)
  if (!exam || !attempt) return store

  let results = attempt.results
  if (results) {
    const hasResult = results.some((r) => r.questionId === questionId)
    results = hasResult
      ? results.map((r) => (r.questionId === questionId ? { ...r, croppedAnswerImage: croppedImagePath } : r))
      : [
          ...results,
          {
            questionId,
            correct: null,
            score: 0,
            maxScore: exam.questions.find((q) => q.id === questionId)?.points ?? 0,
            croppedAnswerImage: croppedImagePath,
            by: 'agent' as const,
          },
        ]
  }

  const answers = attempt.answers.map((ans) =>
    ans.questionId === questionId ? { ...ans, image: croppedImagePath } : ans,
  )
  if (!answers.some((ans) => ans.questionId === questionId)) {
    answers.push({ questionId, value: [], image: croppedImagePath })
  }

  return upsertAttempt(store, examId, {
    ...attempt,
    ...(results ? { results } : {}),
    answers,
  })
}

/** 为一次考试追加手写原图 */
export function attachHandwrittenImages(
  store: LearnStore,
  examId: string,
  attemptId: string,
  imagePaths: string[],
): LearnStore {
  const exam = store.exams.find((e) => e.id === examId)
  const attempt = exam?.attempts.find((a) => a.id === attemptId)
  if (!exam || !attempt) return store

  const existing = attempt.handwrittenImages ?? []
  const handwrittenImages = Array.from(new Set([...existing, ...imagePaths]))

  return upsertAttempt(store, examId, {
    ...attempt,
    handwrittenImages,
  })
}

/** 替换或更新一次考试中特定索引处的手写答卷图片（如顺时针旋转修正后） */
export function updateHandwrittenImage(
  store: LearnStore,
  examId: string,
  attemptId: string,
  index: number,
  newImagePath: string,
): LearnStore {
  const exam = store.exams.find((e) => e.id === examId)
  const attempt = exam?.attempts.find((a) => a.id === attemptId)
  if (!exam || !attempt) return store

  const list = (attempt.handwrittenImages ?? []).slice()
  if (index < 0 || index >= list.length) {
    if (list.length === 0 && index === 0) {
      list.push(newImagePath)
    } else {
      return store
    }
  } else {
    const oldPath = list[index]
    list[index] = newImagePath
    // 若 answers 中有题目的 rawImage 指向旧图，同步更新
    const answers = attempt.answers.map((ans) => {
      if (ans.rawImage === oldPath) {
        return { ...ans, rawImage: newImagePath }
      }
      return ans
    })
    return upsertAttempt(store, examId, {
      ...attempt,
      handwrittenImages: list,
      answers,
    })
  }

  return upsertAttempt(store, examId, {
    ...attempt,
    handwrittenImages: list,
  })
}


