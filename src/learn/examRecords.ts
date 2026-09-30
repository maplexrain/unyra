/**
 * 考试过程的记录逻辑：输入流水、单题耗时、切屏、超时结算。
 *
 * **单题耗时按「答案顺序」推**：每题的时间 = 这次落定答案的时间戳 − 上一次落定答案的时间戳
 * （第一次则从开考算起），中间切出去的时长扣掉。原先靠屏幕上一条「计时区」滚动定位，
 * 那套既要用户配合、又只在他把题滚进区里时才走表；按答案顺序推则完全不需要界面配合，
 * 而且与「他在哪一题上耗了多久」这个真正要问的问题更贴。
 *
 * 全是纯函数（不碰 store、也不读时钟——时间都从参数进来），因为这一层是**给 AI 看的证据**：
 * 「他先答哪题、哪题改过、在哪题上耗了多久、切出去几次、哪些答案是超时答的」。
 * 这些结论全错在毫秒与顺序上，肉眼审不出来，只能靠单测一条条钉住（tests/examRecords.test.ts）。
 *
 * 两条设计约束：
 * 1. **只有一条记录通道**。作答本身既是「答案」也是「输入顺序」——写一次同时维护
 *    answers 与 inputs，两者不会走散（曾经考虑过另存一份「答案变动记录」，
 *    它和输入流水说的是同一件事，两份数据迟早对不上）。
 * 2. **合并发生在写入时**。同一题 5 秒内的连续输入合并成一条（一直在敲就是一次输入），
 *    超过 5 秒算一次「更改」，追加一条。这样流水既短，又保住了「哪题改过」。
 */
import type { Exam, ExamAnswer, ExamAttempt, ExamInput } from './exam'
import { attemptOvertimeMs } from './exam'

/** 同一题的连续输入在这个窗口内合并成一条；超过它就算一次「更改」，追加一条 */
export const INPUT_MERGE_MS = 5000

/** 开考：新建一次考试的空记录 */
export function newAttempt(id: string, startedAt: number, forceSubmit: boolean): ExamAttempt {
  return {
    id,
    startedAt,
    status: 'ongoing',
    answers: [],
    inputs: [],
    dwell: {},
    blurs: [],
    forceSubmit,
  }
}

/** 界面送上来的一个答案（考试窗口里每次落定都会送一次） */
export interface InputEvent {
  questionId: string
  /** 选项 id 列表；填空 / 简答也允许顺手带一份 */
  value: string[]
  /** 填空 / 简答的文本 */
  text?: string
  /** 发生的时刻（毫秒）；由调用方注入，保持这里是纯函数 */
  at: number
}

/** 一次考试里，某题当前的答案 */
export function answerOf(attempt: ExamAttempt, questionId: string): ExamAnswer | undefined {
  return attempt.answers.find((a) => a.questionId === questionId)
}

function overtimeAt(exam: Exam, attempt: ExamAttempt, at: number): boolean {
  if (exam.minutes <= 0) return false
  return at > attempt.startedAt + exam.minutes * 60_000
}

/**
 * 记一次输入。
 *
 * 合并判据有两半，缺一不可：**同一题**、且那一条正好是流水**最后一条**、
 * 距它最后一次更新不超过 INPUT_MERGE_MS。
 * 「中间去答了别的题再回来改」不算连续输入，所以是两条——那正是我们要看到的「更改」。
 *
 * 超时标记在写入时定：时限之后落的每一笔都带上 overtime，
 * 「哪些答案是超时作答的」于是不必等交卷再回头推断。
 */
export function recordInput(attempt: ExamAttempt, exam: Exam, ev: InputEvent): ExamAttempt {
  const value = Array.isArray(ev.value) ? ev.value.filter((x): x is string => typeof x === 'string') : []
  const text = typeof ev.text === 'string' ? ev.text : undefined
  const overtime = overtimeAt(exam, attempt, ev.at)

  const inputs = attempt.inputs.slice()
  const tail = inputs[inputs.length - 1]
  const merge = !!tail && tail.questionId === ev.questionId && ev.at - (tail.updatedAt ?? tail.at) <= INPUT_MERGE_MS

  /*
   * 单题耗时：这次落定距**上一次落定**有多久（第一次从开考算）。
   * 合并的那条（同一题 5 秒内接着敲）不参与——那不是「换了一题」，也没必要把时间切碎。
   */
  const previousAt = tail ? (tail.updatedAt ?? tail.at) : attempt.startedAt
  const dwell =
    merge || ev.at <= previousAt ? attempt.dwell : addDwell(attempt, ev.questionId, activeMsBetween(attempt, previousAt, ev.at))

  if (merge) {
    inputs[inputs.length - 1] = {
      ...tail,
      value,
      ...(text === undefined ? {} : { text }),
      updatedAt: ev.at,
      ...(overtime ? { overtime: true } : {}),
    }
  } else {
    inputs.push({ questionId: ev.questionId, value, ...(text === undefined ? {} : { text }), at: ev.at, ...(overtime ? { overtime: true } : {}) })
  }

  // answers 与 inputs 同源：题目的先后也照第一次输入的顺序排，判分与展示都按它读
  const answers = attempt.answers.slice()
  const idx = answers.findIndex((a) => a.questionId === ev.questionId)
  const next: ExamAnswer = { questionId: ev.questionId, value, ...(text === undefined ? {} : { text }) }
  if (idx < 0) answers.push(next)
  else answers[idx] = next

  return { ...attempt, inputs, answers, dwell }
}

/**
 * 一段时间里「人其实在考试窗口里」的毫秒数：总时长扣掉切出去的那部分。
 *
 * 切屏时长本身也是记录（见 blurs），但把它算进单题耗时会让「切出去查资料五分钟」
 * 变成「这题想了五分钟」——两个结论差得远。未闭合的切屏按「一直到 to」算。
 */
export function activeMsBetween(attempt: ExamAttempt, from: number, to: number): number {
  if (!(to > from)) return 0
  let away = 0
  for (const b of attempt.blurs) {
    const end = b.ms > 0 ? b.start + b.ms : to
    const overlap = Math.min(to, end) - Math.max(from, b.start)
    if (overlap > 0) away += overlap
  }
  return Math.max(0, to - from - Math.min(away, to - from))
}

/** 把一段时长记到某题头上（耗时按答案顺序推出来的那一份） */
function addDwell(attempt: ExamAttempt, questionId: string, ms: number): Record<string, number> {
  if (!questionId || !Number.isFinite(ms) || ms <= 0) return attempt.dwell
  return { ...attempt.dwell, [questionId]: Math.round((attempt.dwell[questionId] ?? 0) + ms) }
}

/** 离开考试窗口（切屏）：开一条记录，回来时由 recordBlurEnd 补上时长 */
export function recordBlurStart(attempt: ExamAttempt, at: number): ExamAttempt {
  const blurs = attempt.blurs.slice()
  const tail = blurs[blurs.length - 1]
  // 已经有一条没闭合的（重复触发 blur）：不再开新的，否则时长会被算两次
  if (tail && tail.ms === 0) return attempt
  blurs.push({ start: at, ms: 0 })
  return { ...attempt, blurs }
}

/** 回到考试窗口：闭合最后那条切屏记录 */
export function recordBlurEnd(attempt: ExamAttempt, at: number): ExamAttempt {
  const blurs = attempt.blurs.slice()
  const tail = blurs[blurs.length - 1]
  if (!tail || tail.ms !== 0) return attempt
  blurs[blurs.length - 1] = { start: tail.start, ms: Math.max(0, at - tail.start) }
  return { ...attempt, blurs }
}

/** 到目前为止切屏总时长（含还没闭合的那一次），列表里要显示它 */
export function blurMsOf(attempt: ExamAttempt, now: number): number {
  return attempt.blurs.reduce((s, b) => s + (b.ms > 0 ? b.ms : Math.max(0, now - b.start)), 0)
}

/** 还没闭合的切屏（交卷 / 放弃时要按结束时刻补上） */
export function hasOpenBlur(attempt: ExamAttempt): boolean {
  const tail = attempt.blurs[attempt.blurs.length - 1]
  return !!tail && tail.ms === 0
}

/**
 * 结束一次考试：交卷（submitted）或放弃（abandoned）。
 *
 * 只结算「时间」这一层：结束时刻、未闭合的切屏、超时多久。
 * 判分不在这里做（objective 判分在 store 里、主观题归 Agent）——
 * **放弃的考试根本不判分**，这是用户明确要的：判 0 分、不讲解。
 */
export function settleAttempt(
  attempt: ExamAttempt,
  exam: Exam,
  outcome: { status: 'submitted' | 'abandoned'; at: number },
): ExamAttempt {
  const closed = hasOpenBlur(attempt) ? recordBlurEnd(attempt, outcome.at) : attempt
  return {
    ...closed,
    status: outcome.status,
    endedAt: outcome.at,
    overtimeMs: attemptOvertimeMs(exam, closed, outcome.at),
  }
}

/** 输入流水里最后一次更新某题的时刻；没答过回 null */
export function lastInputAt(attempt: ExamAttempt, questionId: string): number | null {
  for (let i = attempt.inputs.length - 1; i >= 0; i--) {
    if (attempt.inputs[i].questionId === questionId) return attempt.inputs[i].updatedAt ?? attempt.inputs[i].at
  }
  return null
}

/** 某题的输入条数（> 1 就是改过）——列表与讲解里「犹豫」的信号 */
export function inputCountOf(attempt: ExamAttempt, questionId: string): number {
  return attempt.inputs.filter((x) => x.questionId === questionId).length
}

/** 输入流水摘要：给界面与模型看的一行行「第几笔、哪题、什么时候」 */
export function inputTimeline(attempt: ExamAttempt, labelOf: (questionId: string) => string): string[] {
  return attempt.inputs.map((x: ExamInput, i) => {
    const when = new Date(x.updatedAt ?? x.at)
    const clock = String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0') + ':' + String(when.getSeconds()).padStart(2, '0')
    return (
      '第 ' + (i + 1) + ' 笔 · ' + labelOf(x.questionId) + ' · ' + clock +
      (x.updatedAt ? '（连续输入，起于 ' + new Date(x.at).toTimeString().slice(0, 8) + '）' : '') +
      (x.overtime ? ' · 超时作答' : '')
    )
  })
}
