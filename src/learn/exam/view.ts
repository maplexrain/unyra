/** 本文件负责：试卷的展示口径与读盘负载——标签、时限、阶段、历次成绩摘要，以及 api.exam.read 回给模型的那份 JSON。 */

import type {
  AttemptStatus,
  Exam,
  ExamAttempt,
  ExamKind,
  ExamLevel,
  ExamQuestion,
  ExamQuestionType,
} from './types'
import { examTotalPoints, hasAnswerValue, isAutoGradable } from './grade'
import { t } from '../../i18n'

/** 时限下限：每题至少 2 分钟（仅下限，Agent 该按题量与难度往上给） */
export const EXAM_MINUTES_PER_QUESTION = 2

export function examMinutesFloor(questionCount: number): number {
  return Math.max(0, Math.round(questionCount)) * EXAM_MINUTES_PER_QUESTION
}

/**
 * 校验 Agent 给的时限。小测恒为 0（不限时）；其余必须 ≥ 下限。
 * 失败时那句 message 原样回给模型——它看不到自己的入参，只有这句话能帮它改。
 */
export function resolveExamMinutes(
  raw: unknown,
  kind: ExamKind,
  questionCount: number,
): { ok: true; minutes: number } | { ok: false; message: string } {
  if (kind === 'quiz') return { ok: true, minutes: 0 }
  const floor = examMinutesFloor(questionCount)
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    return {
      ok: false,
      message:
        '这份试卷要有时限：minutes 写整数分钟。下限是**题目数 × ' + EXAM_MINUTES_PER_QUESTION + '** = ' +
        floor + ' 分钟（' + questionCount + ' 题）——那只是地板，请按题量与难度认真估一个' +
        '（要写过程、要计算的题都要多留时间）。随堂小测（kind: "quiz"）不用给：它不限时。',
    }
  }
  const minutes = Math.round(n)
  if (minutes < floor) {
    return {
      ok: false,
      message:
        'minutes ' + minutes + ' 太短：' + questionCount + ' 题的下限是 ' + floor + ' 分钟（每题至少 ' +
        EXAM_MINUTES_PER_QUESTION + ' 分钟）。重新估一个，例如 ' + Math.ceil(floor * 1.3) + ' 分钟。',
    }
  }
  return { ok: true, minutes }
}

/** 读盘 / 迁移用的兜底时限：老卷子没有 minutes，按 1.5 倍下限补一个 */
export function fallbackMinutes(kind: ExamKind, questionCount: number): number {
  if (kind === 'quiz') return 0
  return Math.max(EXAM_MINUTES_PER_QUESTION, Math.ceil(examMinutesFloor(questionCount) * 1.5))
}

export const EXAM_KINDS: ExamKind[] = ['quiz', 'test', 'exam']
export const EXAM_LEVELS: ExamLevel[] = ['easy', 'medium', 'hard', 'extreme']

export const EXAM_KIND_LABEL: Record<ExamKind, string> = {
  quiz: '随堂小测',
  test: '小考',
  exam: '大考',
}

/** 各类型的题量规模（写进提示词，由 Agent 把握） */
export const EXAM_KIND_SIZE: Record<ExamKind, string> = {
  quiz: '10 题左右',
  test: '20~30 题',
  exam: '40 题以上',
}

export const EXAM_LEVEL_LABEL: Record<ExamLevel, string> = {
  easy: '简易',
  medium: '中等',
  hard: '难',
  extreme: '极难',
}

/** 试卷在列表里那一行：类型 · 难度 · 时限（列表、副本页签、状态条都用它，口径只此一处） */
export function examMetaLine(exam: Exam): string {
  const limit = exam.minutes > 0 ? t('{0} 分钟', exam.minutes) : t('不限时')
  return t(EXAM_KIND_LABEL[exam.kind]) + ' · ' + t(EXAM_LEVEL_LABEL[exam.level]) + ' · ' + limit
}

/** 时长那一行：12 分 30 秒；不足一分钟只写秒 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const min = Math.floor(total / 60)
  const sec = total % 60
  return min > 0 ? t('{0} 分 {1} 秒', min, sec) : t('{0} 秒', sec)
}

/** 一份试卷在界面上呈现为什么（由**最新那一次考试**决定） */
export type ExamPhase = 'unattempted' | 'ongoing' | 'submitted' | 'graded' | 'abandoned'

export function examPhase(exam: Exam): ExamPhase {
  const last = exam.attempts[exam.attempts.length - 1]
  return last ? last.status : 'unattempted'
}

export const EXAM_PHASE_LABEL: Record<ExamPhase, string> = {
  unattempted: '未考',
  ongoing: '正在考',
  submitted: '待判分',
  graded: '已判分',
  abandoned: '已放弃',
}

/** 考过没有——决定删除时的确认档位（考过的要列清连带删掉什么） */
export function examAttempted(exam: Exam): boolean {
  return exam.attempts.length > 0
}

/**
 * 这份试卷能不能被 **Agent** 删掉（api.exam.delete 走这条路）。
 * 能删回 null，不能删回「为什么不能」——这句话要原样回给模型，所以是人话。
 *
 * 判据放在这里而不是工作区里：这是「不许删用户的东西」那条规矩，
 * 值得被 Node 探针一条条钉住（见 scripts/agent-ops.test.ts 的出题一节）。
 *
 * **考过的卷子 Agent 删不掉**：那是学习记录（作答、单题耗时、切屏、判分、错题讲解），
 * 该不该连坐由用户决定——他在悬浮组的试卷列表里能看到「会连带删掉什么」并二次确认。
 * 没考过的空卷子（含出错了的废稿）照旧由 Agent 随手清理，不必麻烦用户。
 */
export function examDeleteBlock(exam: Exam): string | null {
  if (!exam.attempts.length) return null
  if (exam.attempts.some((a) => a.status === 'ongoing')) return '这一次考试正在考'
  return (
    '这份卷子已经有 ' + exam.attempts.length + ' 次考试记录（作答、判分与错题讲解都在里面）。' +
    '要删就让用户在试卷列表里删——那里会列清楚连带删掉什么，并让他二次确认'
  )
}


/**
 * api.exam.read() 回给模型的那份负载（字符串化后的 JSON）。
 *
 * 抽成纯函数有两个理由：分支不少（没有卷 / 草稿 / 待阅卷 / 已判分各一套话），
 * 而它是模型判断「现在能做什么」的唯一依据；再就是「没有卷子也是一种答案」这条口径
 * 得能被 Node 探针钉住——它原先正是那个被判成「调用失败」的分支。
 *
 * 形状上有一处刻意：题目全文给的是**最新那一份**（字段 `questions`），
 * 另用 `history` 列出这个知识点的全部试卷与它们的 id、状态——
 * api.exam.delete({ id }) 要按 id 指名，只给最新一份的话旧废稿就没法清理了。
 */
/** 交卷 / 放弃时结算超时：时限内结束是 0；不限时的卷子恒为 0 */
export function attemptOvertimeMs(exam: Exam, attempt: ExamAttempt, endedAt: number): number {
  if (exam.minutes <= 0) return 0
  return Math.max(0, endedAt - (attempt.startedAt + exam.minutes * 60_000))
}

/** 时限的绝对时刻；不限时回 null（考试窗口据此决定要不要倒计时） */
export function attemptDeadline(exam: Exam, attempt: ExamAttempt): number | null {
  return exam.minutes > 0 ? attempt.startedAt + exam.minutes * 60_000 : null
}

/** 用时（毫秒）；还在考时算到 now */
export function attemptDurationMs(attempt: ExamAttempt, now = Date.now()): number {
  return Math.max(0, (attempt.endedAt ?? now) - attempt.startedAt)
}

/**
 * 及格线：卷面 60%。打卡的「考试通道」按它判（见 learn/checkin 的 applyExamCheckin）——
 * 这与 Agent 判分写的 attempt.passed（=完全掌握）是两条不同的线：及格是卷面分数的事，
 * 不必等 Agent 回来裁决。
 */
export const EXAM_PASS_RATIO = 0.6

export function attemptScore(attempt: ExamAttempt | undefined): number {
  return (attempt?.results ?? []).reduce((s, r) => s + r.score, 0)
}


/** 一次考试的梗概：列表与历史 tip 都用它，模型也只看到这一层（题太多时不必全读） */
export interface AttemptBrief {
  id: string
  status: AttemptStatus
  startedAt: number
  endedAt?: number
  /** 用时（毫秒）；还在考时算到 now */
  durationMs: number
  /** 交卷/放弃时结算的超时；还在考时是 0 */
  overtimeMs: number
  /** 有几条输入发生在时限之后 */
  overtimeInputs: number
  /** 切屏次数与总时长 */
  blurCount: number
  blurMs: number
  /** 判分后的得分；没判分是 null */
  score: number | null
  total: number
  answered: number
  questionCount: number
  forceSubmit: boolean
  hasExplanation: boolean
}

export function attemptBrief(exam: Exam, attempt: ExamAttempt, now = Date.now()): AttemptBrief {
  const blurs = attempt.blurs ?? []
  return {
    id: attempt.id,
    status: attempt.status,
    startedAt: attempt.startedAt,
    ...(attempt.endedAt ? { endedAt: attempt.endedAt } : {}),
    durationMs: attemptDurationMs(attempt, now),
    overtimeMs: attempt.overtimeMs ?? 0,
    overtimeInputs: attempt.inputs.filter((x) => x.overtime).length,
    blurCount: blurs.length,
    blurMs: blurs.reduce((s, b) => s + b.ms, 0),
    score: attempt.results ? attemptScore(attempt) : null,
    total: examTotalPoints(exam),
    answered: exam.questions.filter((q) => hasAnswerValue(attempt.answers.find((x) => x.questionId === q.id))).length,
    questionCount: exam.questions.length,
    forceSubmit: attempt.forceSubmit,
    hasExplanation: !!attempt.explanation,
  }
}

/** 这一次考错了哪些题（判分之后才有意义）——错题讲解与薄弱项判断的原料 */
export function wrongQuestions(
  exam: Exam,
  attempt: ExamAttempt,
): Array<{ questionId: string; stem: string; type: ExamQuestionType; comment?: string }> {
  const out: Array<{ questionId: string; stem: string; type: ExamQuestionType; comment?: string }> = []
  for (const q of exam.questions) {
    const r = attempt.results?.find((x) => x.questionId === q.id)
    if (!r || r.correct === true) continue
    out.push({ questionId: q.id, stem: q.stem, type: q.type, ...(r.comment ? { comment: r.comment } : {}) })
  }
  return out
}

/** 历次考试（新到老），带上那次考错的题——「他反复错在哪」才是薄弱项 */
export function attemptHistory(
  exams: Exam[],
  limit = 20,
): Array<{ exam: Exam; attempt: ExamAttempt; weak: Array<{ questionId: string; stem: string }> }> {
  return exams
    .flatMap((exam) => exam.attempts.map((attempt) => ({ exam, attempt, weak: wrongQuestions(exam, attempt) })))
    .sort((a, b) => b.attempt.startedAt - a.attempt.startedAt)
    .slice(0, Math.max(0, limit))
}

const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/**
 * api.exam.read() 回给模型的那份负载（字符串化后的 JSON）。
 *
 * 抽成纯函数有两个理由：分支不少（没有卷 / 出好了没考 / 正在考 / 待判分 / 已判分 / 已放弃
 * 各一套话），而它是模型判断「现在能做什么」的唯一依据；再就是「没有卷子也是一种答案」
 * 这条口径得能被 Node 探针钉住——它原先正是那个被判成「调用失败」的分支。
 *
 * 形状上有一处刻意：题目全文只给**要看的那一次考试**（字段 `questions`），
 * 另用 `history` 列出这个知识点的历次考试——判分与错题讲解都要看历史：
 * 「他这次错在哪」和「他反复错在哪」是两句不同的话，后者才是薄弱项。
 * history 每条带 `weak`（那次考错的题），模型据此找模式，不必把每份卷子都读一遍。
 */
export function examReadPayload(input: {
  /** 这个知识点的全部试卷，按创建时间升序（与 store 里一致）；一份都没有就传空数组 */
  exams: Exam[]
  /** 下级知识：组卷时可据此取材 */
  childNodes: Array<{ title: string; description: string }>
  /** 要看的那一次考试；省略 = 最新一份试卷的最新一次 */
  attemptId?: string
  /** 现在（毫秒）：正在考的那一次要用它算已用时；注入以便测试 */
  now?: number
}): string {
  const { exams, childNodes, attemptId } = input
  const now = input.now ?? Date.now()
  if (!exams.length) {
    return JSON.stringify({
      status: 'none',
      note:
        '这个知识点还没有任何试卷。要出题就 api.exam.create({ title, kind, level, minutes, questions })：' +
        'kind 认 quiz（随堂小测，不限时）/ test（小考）/ exam（大考）；minutes 是时限（分钟），' +
        '不得低于**题目数 × ' + EXAM_MINUTES_PER_QUESTION + '**，小测不用给。' +
        '还不知道用户想要哪种、什么难度，就先 api.ask 问一次（见系统提示词的出卷一节），别替他决定。',
    })
  }

  const withAttempt = attemptId ? exams.find((e) => e.attempts.some((a) => a.id === attemptId)) : undefined
  const paper =
    withAttempt ??
    exams.reduce((best, e) => (e.createdAt >= best.createdAt ? e : best), exams[0])
  const attempt = attemptId
    ? paper.attempts.find((a) => a.id === attemptId)
    : paper.attempts[paper.attempts.length - 1]

  const brief = attempt ? attemptBrief(paper, attempt, now) : null
  const questions = paper.questions.map((q, i) => {
    const a = attempt?.answers.find((x) => x.questionId === q.id)
    const r = attempt?.results?.find((x) => x.questionId === q.id)
    return {
      index: i + 1,
      id: q.id,
      type: q.type,
      stem: q.stem,
      options: q.options,
      referenceAnswer: q.answer,
      rubric: q.rubric,
      points: q.points,
      ...(attempt
        ? {
            userAnswer: { value: a?.value ?? [], text: a?.text ?? '' },
            systemGraded: r ? { correct: r.correct, score: r.score } : undefined,
            needYourGrading: r ? r.correct === null : isAutoGradable(q) === false,
            ...(attempt.inputs.some((x) => x.questionId === q.id && x.overtime)
              ? { answeredAfterTimeUp: true }
              : {}),
          }
        : {}),
    }
  })

  const history = attemptHistory(exams).map(({ exam, attempt: a, weak }) => {
    const b = attemptBrief(exam, a, now)
    return {
      examId: exam.id,
      attemptId: a.id,
      title: exam.title,
      kind: exam.kind,
      level: exam.level,
      at: isoDate(a.startedAt),
      status: a.status,
      minutes: Math.round(b.durationMs / 60_000),
      ...(b.score === null ? {} : { score: b.score + '/' + b.total }),
      ...(b.overtimeMs > 0 ? { overtimeMin: Math.round(b.overtimeMs / 60_000) } : {}),
      ...(b.blurCount ? { blurCount: b.blurCount, blurMin: Math.round(b.blurMs / 60_000) } : {}),
      ...(weak.length ? { weak: weak.map((w) => w.stem.replace(/\s+/g, ' ').slice(0, 40)) } : {}),
    }
  })

  const status = attempt ? attempt.status : 'unattempted'
  const got = attemptScore(attempt)
  return JSON.stringify(
    {
      status,
      paper: {
        id: paper.id,
        title: paper.title,
        kind: paper.kind,
        level: paper.level,
        minutes: paper.minutes,
        questionCount: paper.questions.length,
        totalPoints: examTotalPoints(paper),
        createdAt: isoDate(paper.createdAt),
      },
      ...(brief
        ? {
            attempt: {
              ...brief,
              startedAt: new Date(brief.startedAt).toISOString().slice(0, 16).replace('T', ' '),
              ...(brief.endedAt ? { endedAt: new Date(brief.endedAt).toISOString().slice(0, 16).replace('T', ' ') } : {}),
            },
          }
        : {}),
      totalPapers: exams.length,
      questions,
      history,
      childNodes,
      ...(status === 'unattempted'
        ? {
            note:
              '这份卷子出好了、还没考过。**你不要替学习者开考**——他在界面上点「试卷 → 考试」进考试窗口。' +
              '若这份是废稿，用 api.exam.delete({ id: "' + paper.id + '" }) 删掉。',
          }
        : {}),
      ...(status === 'ongoing'
        ? { note: '这一次考试**正在进行**（开考于上面的 attempt.startedAt）。不要判分、不要讲解，等交卷。' }
        : {}),
      ...(status === 'submitted'
        ? {
            gradingNote:
              '学习者已交卷，请**两步走完这一次**：\n' +
              '① 逐题判分：api.exam.grade({ attemptId: "' + (attempt?.id ?? '') + '", passed, summary, results: [{ questionId, correct, score, comment }] })。' +
              '每一道答错的题都要给 comment（单选/多选/对错/填空也一样，不能只讲简答题），系统已判好的客观题也请补上讲解。\n' +
              '② 写错题讲解：先看上面 history 里的 **weak**（历次考错的题）与 attempt 里的记录' +
              '（overtimeMin 超时、blurCount 切屏、dwell 单题耗时——反复改答案、在某题上耗很久、超时作答都是信号），' +
              '判断他的薄弱项，针对性讲解，然后 api.exam.explain({ content: "…markdown…", attemptId: "' + (attempt?.id ?? '') + '" }) 写上。\n' +
              '讲解要落到「他为什么错、下次怎么想」，别把参考答案抄一遍；历史里反复出现的同一个错法要正面点出来。',
          }
        : {}),
      ...(status === 'graded'
        ? {
            note: attempt?.explanation
              ? '这一次已经判过分、也写过错题讲解了。'
              : '这一次已经判过分了，但还缺错题讲解：看 history 的 weak 找反复错的点，用 api.exam.explain 补上。',
            score: got + '/' + examTotalPoints(paper),
            summary: attempt?.summary ?? '',
            passed: attempt?.passed === true,
          }
        : {}),
      ...(status === 'abandoned'
        ? {
            note:
              '这一次考试**被放弃了**（记 0 分，没有判分也没有错题讲解——这是用户的选择，不要补）。' +
              '想再考一次由用户在试卷列表里点「考试」，你不要替他开考。',
            score: '0/' + examTotalPoints(paper),
          }
        : {}),
    },
    null,
    2,
  )
}
export const QUESTION_TYPE_LABEL: Record<ExamQuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  truefalse: '对错题',
  fill: '填空题',
  short: '简答题',
}

/**
 * 题型分布，一句人话（如「单选题 6 / 多选题 2 / 对错题 2」）。
 * 出题回执里带上它：模型写了 judge，回执里会出现「对错题」——
 * 这是它确认「自己写的题型被认成了什么」的唯一机会。
 */
export function questionsMix(questions: ExamQuestion[]): string {
  const count = new Map<ExamQuestionType, number>()
  for (const q of questions) count.set(q.type, (count.get(q.type) ?? 0) + 1)
  return [...count.entries()].map(([t, n]) => QUESTION_TYPE_LABEL[t] + ' ' + n).join(' / ')
}

/** 归一化试卷类型 / 等级，非法值回落到默认 */
export function normalizeKind(raw: unknown): ExamKind {
  return EXAM_KINDS.includes(raw as ExamKind) ? (raw as ExamKind) : 'quiz'
}
export function normalizeLevel(raw: unknown): ExamLevel {
  return EXAM_LEVELS.includes(raw as ExamLevel) ? (raw as ExamLevel) : 'medium'
}
