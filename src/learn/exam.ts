/**
 * 学习考试的对外入口（barrel）：实现按职责拆在 learn/exam/ 下，
 * 这里只把原来的导出原样转出去，调用方的 import 一行都不用改。
 *
 * 领域说明（两层：一份 Exam 是试卷、一次 ExamAttempt 是一次考试；判分分本地与 Agent 两层）
 * 在 exam/types.ts 顶部，原样搬过去。
 *
 * - exam/types.ts  数据形状：试卷 / 一次考试 / 题目 / 作答 / 判分结果
 * - exam/parse.ts  出题入参的容错解析（模型输出 → 题目）
 * - exam/grade.ts  客观题判分与卷面合计
 * - exam/view.ts   标签、时限、阶段、历次成绩摘要，以及 api.exam.read 的负载
 */

export type {
  ExamQuestionType,
  ExamOption,
  ExamQuestion,
  ExamAnswer,
  ExamResultItem,
  AttemptStatus,
  ExamInput,
  ExamBlur,
  ExamAttempt,
  Exam,
  ExamKind,
  ExamLevel,
} from './exam/types'

export type { QuestionsParse } from './exam/parse'
export { EXAM_SHAPE_HINT, normalizeQuestions, parseQuestions } from './exam/parse'
export { sanitizeExamSvg } from './exam/svg'

export {
  examTotalPoints,
  gradeObjective,
  gradeObjectiveAll,
  hasAnswerValue,
  isAutoGradable,
  objectiveSummary,
  unansweredCount,
} from './exam/grade'

export type { AttemptBrief, ExamPhase } from './exam/view'
export {
  EXAM_KIND_LABEL,
  EXAM_KIND_SIZE,
  EXAM_KINDS,
  EXAM_LEVEL_LABEL,
  EXAM_LEVELS,
  EXAM_MINUTES_PER_QUESTION,
  EXAM_PASS_RATIO,
  EXAM_PHASE_LABEL,
  QUESTION_TYPE_LABEL,
  attemptBrief,
  attemptDeadline,
  attemptDurationMs,
  attemptHistory,
  attemptOvertimeMs,
  attemptScore,
  examAttempted,
  examDeleteBlock,
  examMetaLine,
  examMinutesFloor,
  examPhase,
  examReadPayload,
  fallbackMinutes,
  formatDuration,
  normalizeKind,
  normalizeLevel,
  questionsMix,
  resolveExamMinutes,
  wrongQuestions,
} from './exam/view'
