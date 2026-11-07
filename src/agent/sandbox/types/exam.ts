/**
 * 这个文件负责什么：沙箱类型契约的**考试（exam）**组——出题载荷、考试工具依赖、
 * 阶段动作与阶段表 EXAM_ACTIONS（全目录唯一的运行时值）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

/** 出题请求：字段一律 unknown，校验交给 learn/exam 的 normalize* */
export interface CreateExamPayload {
  title?: unknown
  kind?: unknown
  level?: unknown
  /**
   * 时限（分钟）。随堂小测不用给（不限时）；其余必给，且不得低于题目数 × 2——
   * 下限由 learn/exam 的 resolveExamMinutes 强制，不是提示词里的君子协定。
   */
  minutes?: unknown
  questions: unknown
}

/** 考试工具依赖：由学习工作区注入，沙箱本身不直接碰 store 结构 */
export interface ExamToolDeps {
  stage: () => 'idle' | 'grading'
  createExam: (payload: CreateExamPayload) => { ok: boolean; message: string }
  /** 读卷；给 attemptId 就读那一次考试（判分与讲解时要看某一次的历史记录） */
  readExam: (attemptId?: string) => string
  gradeExam: (payload: unknown) => { ok: boolean; message: string }
  /** 顺时针旋转整张手写答卷 */
  rotateSheet?: (payload: unknown) => Promise<unknown>
  /** 裁切手写答案定位红框预检 */
  previewCrop?: (payload: unknown) => Promise<unknown>
  /** 裁切手写答案图片并贴在对应题目上 */
  cropAnswer?: (payload: unknown) => Promise<{ ok: boolean; message: string; croppedPath?: string }>
  /** 写错题讲解：判分之后的第二步，落在同一次考试上（显示在试卷副本页签里） */
  explainExam: (payload: unknown) => { ok: boolean; message: string }
  /** 删一份试卷；只认「一次都没考过」的，考过的要用户在界面上删，见 learn/exam 的 examDeleteBlock */
  deleteExam: (examId?: string) => { ok: boolean; message: string }
}

export type ExamAction = 'create' | 'grade' | 'cropAnswer' | 'previewCrop' | 'rotateSheet' | 'explain' | 'delete'

/**
 * 阶段只约束**写**（出题 / 判分 / 作废）：有卷待阅时不能再出卷，反之亦然，
 * 模型因此不会在作答途中又出一份新卷，也不会重复阅卷。
 *
 * **读（exam.read）不在这张表里**，任何时候都开放。它原先只在「待阅卷」时可用，
 * 于是刚出完题想核对一下题目、或看看有没有卷子，得到的都是一句「当前没有待阅卷的试卷」
 * ——而这句「没有」还被算成一次调用失败。一次真实运行里模型因此连烧两轮才确认卷子建没建成
 * （见 failureHeader 与 learn/useAgent 里 read 那一段的注释）。
 */
export const EXAM_ACTIONS: Record<'idle' | 'grading', ExamAction[]> = {
  idle: ['create', 'delete'],
  // 判分与讲解是一套工作流的两步，必须同一阶段都放行；第二步在第一次调用之后仍是 grading
  // 判分、手写答卷旋转、红框预检、裁切贴题与讲解是一套工作流的环节，同一阶段都放行
  grading: ['grade', 'rotateSheet', 'previewCrop', 'cropAnswer', 'explain'],
}

