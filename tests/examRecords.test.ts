/**
 * 考试过程记录的单元用例（learn/examRecords）。
 *
 * 这一层是**给 AI 看的证据**：他先答哪题、哪题改过、在哪题上耗了多久、切出去几次、
 * 哪些答案是超时答的。每个结论都错在毫秒与顺序上，肉眼审不出来——所以边界一条条钉住：
 * 5 秒合并的临界值、中途去答别的题再回来算不算「连续输入」、时限算不算进超时。
 *
 * 另一件同样重要的事：**答案与输入流水同源**。写入只有 recordInput 这一个口，
 * 两者一起维护，所以「最终答案」与「怎么走到这一步」永远不会各说各话。
 */
import { describe, expect, it } from 'vitest'

import type { Exam } from '../src/learn/exam'
import {
  INPUT_MERGE_MS,
  activeMsBetween,
  blurMsOf,
  hasOpenBlur,
  inputCountOf,
  inputTimeline,
  lastInputAt,
  newAttempt,
  recordBlurEnd,
  recordBlurStart,
  recordInput,
  settleAttempt,
} from '../src/learn/examRecords'

const T0 = 1_700_000_000_000

const paper = (patch: Partial<Exam> = {}): Exam => ({
  id: 'e1',
  nodeId: 'n1',
  goalId: 'g1',
  title: '极限小测',
  kind: 'test',
  level: 'medium',
  minutes: 10,
  questions: [
    { id: 'q1', type: 'truefalse', stem: '极限存在则唯一', points: 1, answer: ['true'] },
    { id: 'q2', type: 'truefalse', stem: '无穷小就是 0', points: 1, answer: ['false'] },
  ],
  createdAt: T0,
  attempts: [],
  ...patch,
})

describe('开考', () => {
  it('新建的考试是空的、正在考', () => {
    const a = newAttempt('a1', T0, true)
    expect(a.id).toBe('a1')
    expect(a.status).toBe('ongoing')
    expect(a.forceSubmit).toBe(true)
    expect(a.answers).toEqual([])
    expect(a.inputs).toEqual([])
    expect(a.blurs).toEqual([])
    expect(a.dwell).toEqual({})
  })
})

describe('输入顺序与最终答案', () => {
  it('同一题 5 秒内的连续输入合并成一条（一直在敲 = 一次输入）', () => {
    const exam = paper()
    let a = newAttempt('a1', T0, false)
    a = recordInput(a, exam, { questionId: 'q1', value: ['t'], at: T0 + 1000 })
    a = recordInput(a, exam, { questionId: 'q1', value: ['tr'], at: T0 + 2000 })
    a = recordInput(a, exam, { questionId: 'q1', value: ['true'], at: T0 + 6000 })
    expect(a.inputs).toHaveLength(1)
    expect(a.inputs[0].at).toBe(T0 + 1000)
    expect(a.inputs[0].updatedAt).toBe(T0 + 6000)
    expect(a.inputs[0].value).toEqual(['true'])
  })

  it('超过 5 秒再改 = 一次「更改」，追加一条（这正是要看的那个信号）', () => {
    const exam = paper()
    let a = newAttempt('a1', T0, false)
    a = recordInput(a, exam, { questionId: 'q1', value: ['true'], at: T0 + 1000 })
    a = recordInput(a, exam, { questionId: 'q1', value: ['false'], at: T0 + 1000 + INPUT_MERGE_MS + 1 })
    expect(a.inputs).toHaveLength(2)
    expect(inputCountOf(a, 'q1')).toBe(2)
    expect(a.inputs[1].value).toEqual(['false'])
    expect(a.inputs[1].updatedAt).toBeUndefined()
  })

  it('临界值就是合并窗口本身：正好 5 秒仍算连续', () => {
    const exam = paper()
    let a = newAttempt('a1', T0, false)
    a = recordInput(a, exam, { questionId: 'q1', value: ['true'], at: T0 })
    a = recordInput(a, exam, { questionId: 'q1', value: ['false'], at: T0 + INPUT_MERGE_MS })
    expect(a.inputs).toHaveLength(1)
  })

  it('中间去答了别的题再回来，不算连续输入（是两条）', () => {
    const exam = paper()
    let a = newAttempt('a1', T0, false)
    a = recordInput(a, exam, { questionId: 'q1', value: ['true'], at: T0 })
    a = recordInput(a, exam, { questionId: 'q2', value: ['false'], at: T0 + 1000 })
    a = recordInput(a, exam, { questionId: 'q1', value: ['false'], at: T0 + 2000 })
    expect(a.inputs.map((x) => x.questionId)).toEqual(['q1', 'q2', 'q1'])
  })

  it('顺序就是数组顺序，最终答案按第一次输入的顺序排（判分与展示都按它读）', () => {
    const exam = paper()
    let a = newAttempt('a1', T0, false)
    a = recordInput(a, exam, { questionId: 'q2', value: ['false'], at: T0 })
    a = recordInput(a, exam, { questionId: 'q1', value: ['true'], at: T0 + 1000 })
    expect(a.answers.map((x) => x.questionId)).toEqual(['q2', 'q1'])
    expect(a.inputs.map((x) => x.questionId)).toEqual(['q2', 'q1'])
    expect(lastInputAt(a, 'q1')).toBe(T0 + 1000)
    expect(lastInputAt(a, 'q9')).toBeNull()
  })

  it('简答题的正文跟着一起记（与选项走同一个口）', () => {
    const exam = paper()
    let a = newAttempt('a1', T0, false)
    a = recordInput(a, exam, { questionId: 'q1', value: [], text: '因为', at: T0 })
    a = recordInput(a, exam, { questionId: 'q1', value: [], text: '因为极限唯一', at: T0 + 1000 })
    expect(a.inputs).toHaveLength(1)
    expect(a.answers[0].text).toBe('因为极限唯一')
  })
})

describe('超时作答', () => {
  it('时限之后落的每一笔都带 overtime 标记（合并进来的后续输入也保持这个标记）', () => {
    const exam = paper({ minutes: 1 }) // 1 分钟
    let a = newAttempt('a1', T0, false)
    a = recordInput(a, exam, { questionId: 'q1', value: ['true'], at: T0 + 30_000 })
    expect(a.inputs[0].overtime).toBeUndefined()
    // 超时之后才答的这一题：5 秒之后落的，所以是新的一条，带标记
    a = recordInput(a, exam, { questionId: 'q1', value: ['f'], at: T0 + 90_000 })
    expect(a.inputs).toHaveLength(2)
    expect(a.inputs[1].overtime).toBe(true)
    // 紧接着（5 秒内）的连续输入合并进那一条：标记不能被抹掉
    a = recordInput(a, exam, { questionId: 'q1', value: ['false'], at: T0 + 92_000 })
    expect(a.inputs).toHaveLength(2)
    expect(a.inputs[1].overtime).toBe(true)
    expect(a.inputs[1].value).toEqual(['false'])
  })

  it('不限时的卷子（minutes = 0）永远不算超时', () => {
    const exam = paper({ minutes: 0, kind: 'quiz' })
    const a = recordInput(newAttempt('a1', T0, false), exam, { questionId: 'q1', value: ['true'], at: T0 + 9_999_999 })
    expect(a.inputs[0].overtime).toBeUndefined()
  })
})

describe('单题耗时（按答案顺序推）', () => {
  it('每题的时间 = 这次落定的时间戳 − 上一次落定的时间戳；第一次从开考算', () => {
    const exam = paper()
    let a = newAttempt('a1', T0, false)
    a = recordInput(a, exam, { questionId: 'q1', value: ['true'], at: T0 + 20_000 })
    a = recordInput(a, exam, { questionId: 'q2', value: ['false'], at: T0 + 50_000 })
    a = recordInput(a, exam, { questionId: 'q1', value: ['false'], at: T0 + 65_000 })
    expect(a.dwell.q1).toBe(20_000 + 15_000)
    expect(a.dwell.q2).toBe(30_000)
  })

  it('同一题 5 秒内的连续输入合并：那一段不重复计入（时间是「上一次落定」到「这一次落定」）', () => {
    const exam = paper()
    let a = newAttempt('a1', T0, false)
    a = recordInput(a, exam, { questionId: 'q1', value: ['t'], at: T0 + 10_000 })
    expect(a.dwell.q1).toBe(10_000)
    // 连续敲（合并）不改耗时；改到 5 秒之后才算「又落定了一次」
    a = recordInput(a, exam, { questionId: 'q1', value: ['true'], at: T0 + 13_000 })
    expect(a.dwell.q1).toBe(10_000)
    a = recordInput(a, exam, { questionId: 'q1', value: ['false'], at: T0 + 40_000 })
    // 间隔从**上一次落定的时间**算起：那一条的最后一次敲击在 13 秒（updatedAt），
    // 所以这一段是 27 秒；10 秒之前那一段已经记过了，不重复计入
    expect(a.dwell.q1).toBe(10_000 + 27_000)
  })

  it('切出去的那一段不算进单题耗时（否则「查了五分钟资料」会变成「想了五分钟」）', () => {
    const exam = paper()
    let a = newAttempt('a1', T0, false)
    a = recordInput(a, exam, { questionId: 'q1', value: ['true'], at: T0 + 10_000 })
    a = recordBlurStart(a, T0 + 12_000)
    a = recordBlurEnd(a, T0 + 72_000)
    a = recordInput(a, exam, { questionId: 'q2', value: ['false'], at: T0 + 82_000 })
    // q2 名义上隔了 72 秒，扣掉切出去的 60 秒只剩 12 秒
    expect(a.dwell.q2).toBe(12_000)
    expect(activeMsBetween(a, T0 + 10_000, T0 + 82_000)).toBe(12_000)
  })

  it('没闭合的切屏按「一直到此刻」扣（人还没回来）', () => {
    let a = newAttempt('a1', T0, false)
    a = recordBlurStart(a, T0 + 5_000)
    expect(activeMsBetween(a, T0, T0 + 20_000)).toBe(5_000)
  })
})

describe('切屏', () => {
  it('离开记起点、回来补时长；重复触发 blur 不重复开条目', () => {
    let a = newAttempt('a1', T0, false)
    a = recordBlurStart(a, T0 + 1000)
    a = recordBlurStart(a, T0 + 2000) // 重复 blur：忽略
    expect(a.blurs).toHaveLength(1)
    expect(hasOpenBlur(a)).toBe(true)
    a = recordBlurEnd(a, T0 + 5000)
    expect(a.blurs).toEqual([{ start: T0 + 1000, ms: 4000 }])
    expect(hasOpenBlur(a)).toBe(false)
  })

  it('没开过就收到 focus：什么都不做（别凭空造一条负数时长）', () => {
    const a = recordBlurEnd(newAttempt('a1', T0, false), T0 + 1000)
    expect(a.blurs).toEqual([])
  })

  it('总时长把还没闭合的那一次也算上（列表里要显示「正在切出去多久」）', () => {
    let a = newAttempt('a1', T0, false)
    a = recordBlurStart(a, T0)
    a = recordBlurEnd(a, T0 + 3000)
    a = recordBlurStart(a, T0 + 10_000)
    expect(blurMsOf(a, T0 + 12_500)).toBe(3000 + 2500)
  })
})

describe('收尾', () => {
  it('交卷：记结束时刻、结算超时、把没闭合的切屏补上', () => {
    const exam = paper({ minutes: 1 })
    let a = newAttempt('a1', T0, false)
    a = recordBlurStart(a, T0 + 70_000)
    const settled = settleAttempt(a, exam, { status: 'submitted', at: T0 + 90_000 })
    expect(settled.status).toBe('submitted')
    expect(settled.endedAt).toBe(T0 + 90_000)
    expect(settled.overtimeMs).toBe(30_000)
    expect(settled.blurs).toEqual([{ start: T0 + 70_000, ms: 20_000 }])
  })

  it('时限内交卷：超时是 0（不是负数）', () => {
    const exam = paper({ minutes: 10 })
    const settled = settleAttempt(newAttempt('a1', T0, false), exam, { status: 'submitted', at: T0 + 60_000 })
    expect(settled.overtimeMs).toBe(0)
  })

  it('放弃：只结算时间，不碰判分（判 0 分、不讲解是用户的选择）', () => {
    const exam = paper({ minutes: 1 })
    const settled = settleAttempt(newAttempt('a1', T0, true), exam, { status: 'abandoned', at: T0 + 120_000 })
    expect(settled.status).toBe('abandoned')
    expect(settled.overtimeMs).toBe(60_000)
    expect(settled.results).toBeUndefined()
    expect(settled.explanation).toBeUndefined()
  })
})

describe('输入流水给人看的那一行', () => {
  it('逐笔列出题号与时刻，超时的标出来', () => {
    const exam = paper({ minutes: 1 })
    let a = newAttempt('a1', T0, false)
    a = recordInput(a, exam, { questionId: 'q2', value: ['false'], at: T0 })
    a = recordInput(a, exam, { questionId: 'q1', value: ['true'], at: T0 + 90_000 })
    const lines = inputTimeline(a, (id) => (id === 'q1' ? '第 1 题' : '第 2 题'))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('第 1 笔')
    expect(lines[0]).toContain('第 2 题')
    expect(lines[1]).toContain('超时作答')
  })
})
