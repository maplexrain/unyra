/** 本文件负责：考试领域的数据形状（试卷、一次考试、题目、作答与判分结果）——纯类型定义，不含逻辑。 */

/**
 * 节点考试：数据模型、记录与判分。
 *
 * **两层**（这次重构的核心）：一份 `Exam` 是**试卷**（题目、类型、难度、时限），
 * 一次 `ExamAttempt` 是**一次考试**（什么时候开的、答成什么样、用掉多少时间、切出去过几次）。
 * 同一份卷子可以反复考，历次成绩天然是一组，重考不必复制题目，
 * 每次考试的记录也不会互相覆盖。
 *
 * 考试由 Agent 生成（用户主动要求时才出题），交卷后交给 Agent 审阅。
 * 判分分两层：
 * - 客观题（单选 / 多选 / 对错）与「已设答案的填空题」由本地严格判分；
 * - 未设答案的填空题与简答题由 Agent 判分。
 * Agent 汇总主客观结果给出最终结论，决定节点是否改为「已掌握」，并写一份错题讲解
 * （见 ExamAttempt.explanation）。
 *
 * 记录是给 AI 看的（它据此判断薄弱项与犹豫点），全在 ExamAttempt 上：
 * 输入顺序、单题耗时、切屏记录、超时。写入逻辑在 learn/examRecords（纯函数，有单测）。
 */

export type ExamQuestionType = 'single' | 'multiple' | 'truefalse' | 'fill' | 'short'

export interface ExamOption {
  id: string
  text: string
}

export interface ExamQuestion {
  id: string
  type: ExamQuestionType
  /** 题干：Markdown + LaTeX */
  stem: string
  /** 单选 / 多选 / 对错 的选项；对错题为 true/false 两项 */
  options?: ExamOption[]
  /**
   * 参考答案。
   * - single：单个选项 id
   * - multiple：选项 id 列表
   * - truefalse：'true' 或 'false'
   * - fill：填空答案（可选；设了则严格判分，未设则交给 Agent）
   * - short：通常留空，交 Agent 判分
   */
  answer?: string[]
  /** 给 Agent 的评分要点 / 参考答案说明 */
  rubric?: string
  /**
   * 题目配图：**完整的 SVG 源码**（以 <svg 开头）。
   * 入库前过一遍 sanitizeExamSvg（见 exam/svg）——配图是「画出来的题面」，不是可信
   * HTML，script / 事件属性 / foreignObject 这些口子在入库前剥干净。
   * canvas 没法持久保存（存下的是代码不是图），绘图一律以 SVG 表达。
   */
  image?: string
  points: number
}

export interface ExamAnswer {
  questionId: string
  /** 选项 id 列表 / 填空或简答的文本（单项） */
  value: string[]
  /** 作答文本（填空、简答） */
  text?: string
}

export interface ExamResultItem {
  questionId: string
  /** 客观题为主观题都可能；null 表示尚未判分 */
  correct: boolean | null
  score: number
  maxScore: number
  /** 错题讲解 / 评语 */
  comment?: string
  /** 判分来源 */
  by: 'system' | 'agent'
}

/** 一次考试的状态 */
export type AttemptStatus =
  /** 正在考（进了考试窗口、按了开始） */
  | 'ongoing'
  /** 已交卷，等判分 */
  | 'submitted'
  /** 已判分 */
  | 'graded'
  /** 放弃了：判 0 分，不判分、也不做错题讲解 */
  | 'abandoned'

/**
 * 输入流水的一条：**数组顺序就是输入顺序**。
 *
 * 同一题的连续输入在写入时按 5 秒合并（见 learn/examRecords 的 recordInput）：
 * 「一直在敲」只留一条（at 是第一次、updatedAt 是最后一次），
 * 「停下来想了想又改」是两条——于是「先答哪题、哪题改过」都看得出来，
 * 不必再另存一份「答案变动记录」。
 */
export interface ExamInput {
  questionId: string
  /** 选项 id 列表 / 填空简答的文本（与 ExamAnswer 同义） */
  value: string[]
  text?: string
  at: number
  /** 最后一次被合并进来的时刻；从没合并过就没有它 */
  updatedAt?: number
  /** 这次输入发生在时限之后（用户选了「到点不强制交卷」才会有） */
  overtime?: boolean
}

/** 一次切屏：离开考试窗口的时刻，以及离开了多久 */
export interface ExamBlur {
  start: number
  ms: number
}

/**
 * 一次考试。
 *
 * 与试卷分开是这次重构的核心：同一份卷子可以反复考，历次成绩天然是一组，
 * 「重考」不必复制题目；每次考试各自的作答、耗时与切屏记录也不会互相覆盖。
 */
export interface ExamAttempt {
  id: string
  /** 开考时刻（用户按下「开始考试」的那一下） */
  startedAt: number
  /** 交卷 / 放弃的时刻；正在考时没有 */
  endedAt?: number
  status: AttemptStatus
  /**
   * 最终答案。**与 inputs 由同一次写入一起维护**，两者不会走散：
   * 判分读的是它，inputs 记的是「怎么走到这一步」。
   */
  answers: ExamAnswer[]
  inputs: ExamInput[]
  /** 单题耗时（毫秒）：题目 id → 在计时区里累计的时长 */
  dwell: Record<string, number>
  blurs: ExamBlur[]
  /** 用户选的「到点强制交卷」；false = 到点继续答，超时照记 */
  forceSubmit: boolean
  /** 超时多久（交卷 / 放弃时结算） */
  overtimeMs?: number
  results?: ExamResultItem[]
  summary?: string
  passed?: boolean
  /** Agent 写的错题讲解（Markdown）：只读的试卷副本页签里显示它 */
  explanation?: string
}

/**
 * 一份试卷：题目 + 类型 + 难度 + 时限。
 *
 * 时限是这次新增的：**0 = 不限时**（随堂小测），其余由 Agent 依题量与难度自定，
 * 且不得低于 examMinutesFloor（题目数 × 2）——下限由代码强制，不是提示词里的君子协定。
 */
export interface Exam {
  id: string
  nodeId: string
  goalId: string
  /** 试卷标题，由 Agent 拟定 */
  title: string
  kind: ExamKind
  level: ExamLevel
  /** 时限（分钟）；0 = 不限时 */
  minutes: number
  questions: ExamQuestion[]
  createdAt: number
  /** 历次考试，按 startedAt 升序；空数组 = 出好了还没考过 */
  attempts: ExamAttempt[]
}

/** 试卷类型：决定题量规模 */
export type ExamKind = 'quiz' | 'test' | 'exam'
/** 试卷等级：难度 */
export type ExamLevel = 'easy' | 'medium' | 'hard' | 'extreme'
