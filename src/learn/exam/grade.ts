/** 本文件负责：客观题判分与卷面合计——哪些题本地能判、判成什么、卷面满分多少（主观题一律留给 Agent）。 */

import type { Exam, ExamAnswer, ExamAttempt, ExamQuestion, ExamResultItem } from './types'

/** 某题答没答（留空与「答了但答错」是两回事） */
export function hasAnswerValue(answer: ExamAnswer | undefined): boolean {
  if (!answer) return false
  return (
    (answer.text ?? '').trim() !== '' ||
    answer.value.length > 0 ||
    Boolean(answer.image && answer.image.trim())
  )
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

/**
 * 选项标识/内容归一化（容错）：
 * 支持标准选项 ID（如 "A"）、带选项文本的前缀（如 "A. 介词"、"A、介词"、"A: 介词"）、以及选项文本全文（如 "介词"），
 * 对错题支持布尔值或常见是非表达（"true" / "对" / "正确" 等）。
 */
export function normalizeOptionToken(token: string, q: ExamQuestion): string {
  const trimmed = token.trim()
  if (!trimmed) return ''
  if (q.type === 'truefalse') {
    const lower = trimmed.toLowerCase()
    if (['true', 't', 'yes', 'y', '1', '正确', '对', '是', '√'].includes(lower)) return 'true'
    if (['false', 'f', 'no', 'n', '0', '错误', '错', '否', '×', 'x'].includes(lower)) return 'false'
    return trimmed
  }
  const options = q.options ?? []
  // 1. 精确匹配选项 id（如 "A"）
  const byId = options.find((o) => o.id.toLowerCase() === trimmed.toLowerCase())
  if (byId) return byId.id
  // 2. 匹配带标点/空格前缀（如 "A. 介词"、"A、介词"、"A: 介词"、"A 介词"）
  const m = trimmed.match(/^\s*([A-Za-z0-9]+)\s*[.、)）:：\s]/)
  if (m) {
    const byPrefix = options.find((o) => o.id.toLowerCase() === m[1].toLowerCase())
    if (byPrefix) return byPrefix.id
  }
  // 3. 匹配选项文本全文（如 "介词"）
  const byText = options.find((o) => norm(o.text) === norm(trimmed))
  if (byText) return byText.id
  return trimmed
}

/** 单题客观判分；不可自动判分时返回 null */
export function gradeObjective(q: ExamQuestion, a: ExamAnswer | undefined): boolean | null {
  if (!isAutoGradable(q)) return null
  const given = a?.value ?? []
  const expect = q.answer ?? []
  switch (q.type) {
    case 'single':
    case 'truefalse': {
      if (given.length !== 1 || expect.length !== 1) return false
      const g = normalizeOptionToken(given[0], q)
      const e = normalizeOptionToken(expect[0], q)
      return g.toLowerCase() === e.toLowerCase()
    }
    case 'multiple': {
      if (given.length !== expect.length) return false
      const gNorm = given.map((x) => normalizeOptionToken(x, q).toLowerCase()).sort().join('\u0001')
      const eNorm = expect.map((x) => normalizeOptionToken(x, q).toLowerCase()).sort().join('\u0001')
      return gNorm === eNorm
    }
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
