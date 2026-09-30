/** 试卷的反序列化：磁盘上（或导入文件里）的一份试卷 → Exam，含旧格式到 attempts 的迁移。 */

import type { Exam, ExamAnswer, ExamAttempt, ExamBlur, ExamInput, ExamResultItem } from '../../exam'
import { EXAM_KIND_LABEL, fallbackMinutes, normalizeKind, normalizeLevel, normalizeQuestions } from '../../exam'
import { ATTEMPT_STATUSES } from '../factories'

/** 读一份答卷/答案数组（新旧格式共用） */
function normalizeAnswers(raw: unknown): ExamAnswer[] {
  const out: ExamAnswer[] = []
  if (!Array.isArray(raw)) return out
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue
    const ar = a as Record<string, unknown>
    const qid = typeof ar.questionId === 'string' ? ar.questionId : ''
    if (!qid) continue
    out.push({
      questionId: qid,
      value: Array.isArray(ar.value) ? ar.value.filter((x): x is string => typeof x === 'string') : [],
      text: typeof ar.text === 'string' ? ar.text : undefined,
    })
  }
  return out
}

function normalizeResults(raw: unknown): ExamResultItem[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const results: ExamResultItem[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const xr = x as Record<string, unknown>
    const qid = typeof xr.questionId === 'string' ? xr.questionId : ''
    if (!qid) continue
    results.push({
      questionId: qid,
      correct: typeof xr.correct === 'boolean' ? xr.correct : null,
      score: typeof xr.score === 'number' ? xr.score : 0,
      maxScore: typeof xr.maxScore === 'number' ? xr.maxScore : 0,
      comment: typeof xr.comment === 'string' ? xr.comment : undefined,
      by: xr.by === 'agent' ? 'agent' : 'system',
    })
  }
  return results
}

function normalizeAttempt(raw: unknown, fallbackStartedAt: number): ExamAttempt | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const status = ATTEMPT_STATUSES.includes(r.status as string) ? (r.status as ExamAttempt['status']) : null
  if (!status) return null
  const dwell: Record<string, number> = {}
  if (r.dwell && typeof r.dwell === 'object') {
    for (const [k, v] of Object.entries(r.dwell as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) dwell[k] = Math.round(v)
    }
  }
  const blurs: ExamBlur[] = []
  if (Array.isArray(r.blurs)) {
    for (const b of r.blurs) {
      if (!b || typeof b !== 'object') continue
      const br = b as Record<string, unknown>
      if (typeof br.start !== 'number') continue
      blurs.push({ start: br.start, ms: typeof br.ms === 'number' && br.ms > 0 ? br.ms : 0 })
    }
  }
  const inputs: ExamInput[] = []
  if (Array.isArray(r.inputs)) {
    for (const x of r.inputs) {
      if (!x || typeof x !== 'object') continue
      const xr = x as Record<string, unknown>
      const qid = typeof xr.questionId === 'string' ? xr.questionId : ''
      if (!qid || typeof xr.at !== 'number') continue
      inputs.push({
        questionId: qid,
        value: Array.isArray(xr.value) ? xr.value.filter((v): v is string => typeof v === 'string') : [],
        text: typeof xr.text === 'string' ? xr.text : undefined,
        at: xr.at,
        ...(typeof xr.updatedAt === 'number' ? { updatedAt: xr.updatedAt } : {}),
        ...(xr.overtime === true ? { overtime: true } : {}),
      })
    }
  }
  return {
    id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
    startedAt: typeof r.startedAt === 'number' ? r.startedAt : fallbackStartedAt,
    ...(typeof r.endedAt === 'number' ? { endedAt: r.endedAt } : {}),
    status,
    answers: normalizeAnswers(r.answers),
    inputs,
    dwell,
    blurs,
    forceSubmit: r.forceSubmit === true,
    ...(typeof r.overtimeMs === 'number' ? { overtimeMs: r.overtimeMs } : {}),
    ...(normalizeResults(r.results) ? { results: normalizeResults(r.results) } : {}),
    ...(typeof r.summary === 'string' ? { summary: r.summary } : {}),
    ...(typeof r.passed === 'boolean' ? { passed: r.passed } : {}),
    ...(typeof r.explanation === 'string' ? { explanation: r.explanation } : {}),
  }
}

/**
 * 读一份试卷，并把**旧格式迁移过来**（导出给单测：迁移错了就是用户的历史卷子消失，
 * 而这条路径平时跑不到——只有读到老数据时才会走）。
 *
 *
 * 旧格式是「一份试卷 = 一次考试」（status / answers / results / submittedAt / gradedAt
 * 都长在试卷上）。新格式把它们拆成 attempts 里的一条——迁移规则：
 * - 老 graded / submitted → 一条同状态的考试记录；
 * - 老 draft **且答过题** → 一条 abandoned：那次是在应用内作答、从没交卷，
 *   不判分是对的（也绝不能标成 ongoing——启动时会把「正在考」认成真，主窗口就黑了）；
 * - 老 draft 且一道没答 → 就是没考过，不生成记录。
 *
 * 时限是这次新加的：老卷子没有 minutes，按题量补一个（见 fallbackMinutes）。
 */
export function normalizeExam(raw: unknown, validNodeIds: Set<string>): Exam | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const nodeId = typeof r.nodeId === 'string' ? r.nodeId : ''
  if (!nodeId || !validNodeIds.has(nodeId)) return null
  const questions = normalizeQuestions(r.questions)
  if (!questions) return null
  const now = Date.now()

  const kind = normalizeKind(r.kind)
  const level = normalizeLevel(r.level)
  const title = typeof r.title === 'string' && r.title.trim() ? r.title.trim() : EXAM_KIND_LABEL[kind]
  const createdAt = typeof r.createdAt === 'number' ? r.createdAt : now
  const minutes = typeof r.minutes === 'number' && r.minutes >= 0 ? Math.round(r.minutes) : fallbackMinutes(kind, questions.length)

  let attempts: ExamAttempt[] = []
  if (Array.isArray(r.attempts)) {
    attempts = r.attempts
      .map((a) => normalizeAttempt(a, createdAt))
      .filter((a): a is ExamAttempt => !!a)
      .sort((a, b) => a.startedAt - b.startedAt)
  } else {
    const answers = normalizeAnswers(r.answers)
    const legacy = r.status === 'graded' ? 'graded' : r.status === 'submitted' ? 'submitted' : answers.length ? 'abandoned' : null
    if (legacy) {
      const endedAt =
        typeof r.gradedAt === 'number' ? r.gradedAt : typeof r.submittedAt === 'number' ? r.submittedAt : undefined
      attempts = [
        {
          id: crypto.randomUUID(),
          startedAt: createdAt,
          ...(endedAt ? { endedAt } : {}),
          status: legacy,
          answers,
          inputs: [],
          dwell: {},
          blurs: [],
          forceSubmit: false,
          ...(normalizeResults(r.results) ? { results: normalizeResults(r.results) } : {}),
          ...(typeof r.summary === 'string' ? { summary: r.summary } : {}),
          ...(typeof r.passed === 'boolean' ? { passed: r.passed } : {}),
        },
      ]
    }
  }

  return {
    id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
    nodeId,
    goalId: typeof r.goalId === 'string' ? r.goalId : '',
    title,
    kind,
    level,
    minutes,
    questions,
    createdAt,
    attempts,
  }
}
