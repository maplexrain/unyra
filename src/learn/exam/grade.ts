/** 本文件负责：客观题判分与卷面合计——哪些题本地能判、判成什么、卷面满分多少（主观题一律留给 Agent）。 */

import type { Exam, ExamAnswer, ExamAttempt, ExamQuestion, ExamResultItem } from './types'

/** 某题答没答（留空与「答了但答错」是两回事） */
export function hasAnswerValue(answer: ExamAnswer | undefined): boolean {
  if (!answer) return false
  return (answer.text ?? '').trim() !== '' || answer.value.length > 0
}

export function unansweredCount(exam: Exam, attempt: ExamAttempt): number {
  return exam.questions.filter((q) => !hasAnswerValue(attempt.answers.find((x) => x.questionId === q.id))).length
}

/** 除简答/无答案填空外，客观题是否全部答对——用于给 Agent 的客观分参考 */
export function objectiveSummary(results: ExamResultItem[] | undefined): { correct: number; total: number } {
  const items = (results ?? []).filter((r) => r.by === 'system')
  return { correct: items.filter((r) => r.correct === true).length, total: items.length }
}

/** 该题是否能由系统严格判分 */
export function isAutoGradable(q: ExamQuestion): boolean {
  if (q.type === 'single' || q.type === 'multiple' || q.type === 'truefalse') return true
  if (q.type === 'fill') return Array.isArray(q.answer) && q.answer.length > 0
  return false
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/** 单题客观判分；不可自动判分时返回 null */
export function gradeObjective(q: ExamQuestion, a: ExamAnswer | undefined): boolean | null {
  if (!isAutoGradable(q)) return null
  const given = a?.value ?? []
  const expect = q.answer ?? []
  switch (q.type) {
    case 'single':
    case 'truefalse':
      return given.length === 1 && expect.length === 1 && given[0] === expect[0]
    case 'multiple':
      return (
        given.length === expect.length &&
        [...given].sort().join('\u0001') === [...expect].sort().join('\u0001')
      )
    case 'fill': {
      const text = a?.text ?? given[0] ?? ''
      return norm(text) === norm(expect[0] ?? '')
    }
    default:
      return null
  }
}

/** 对一次考试的客观题判分，主观题留待 Agent（correct: null, score: 0） */
export function gradeObjectiveAll(exam: Exam, answers: ExamAnswer[]): ExamResultItem[] {
  return exam.questions.map((q) => {
    const a = answers.find((x) => x.questionId === q.id)
    const correct = gradeObjective(q, a)
    return {
      questionId: q.id,
      correct,
      score: correct === true ? q.points : 0,
      maxScore: q.points,
      by: 'system' as const,
    }
  })
}

/** 卷面满分（题目在卷子上，历次考试共用） */
export function examTotalPoints(exam: Exam): number {
  return exam.questions.reduce((s, q) => s + q.points, 0)
}
