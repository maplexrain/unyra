/**
 * 试卷读盘的**迁移**用例（learn/store 的 normalizeExam）。
 *
 * 这次重构把「一份试卷 = 一次考试」拆成了「试卷 + 历次考试」。用户磁盘上躺着的是旧格式，
 * 而这条路径平时跑不到——只有读到老数据时才会走。迁移错了的后果是**历史卷子直接消失**
 * 或状态变成别的意思（比如把没交卷的草稿认成「正在考」，打开应用就会盖着黑遮罩出不来）。
 */
import { describe, expect, it } from 'vitest'

import { normalizeExam } from '../src/learn/store'

const NODES = new Set(['n1'])
const AT = 1_700_000_000_000

const questions = [
  { id: 'q1', type: 'truefalse', stem: '极限存在则唯一', answer: ['true'], points: 2 },
  { id: 'q2', type: 'truefalse', stem: '无穷小就是 0', answer: ['false'], points: 2 },
]

const legacy = (patch: Record<string, unknown> = {}) => ({
  id: 'e1',
  nodeId: 'n1',
  goalId: 'g1',
  title: '极限小测',
  kind: 'test',
  level: 'hard',
  questions,
  answers: [],
  status: 'draft',
  createdAt: AT,
  ...patch,
})

describe('旧格式迁移', () => {
  it('已判分的卷子 → 一条 graded 的考试记录，分数与结论都留着', () => {
    const exam = normalizeExam(
      legacy({
        status: 'graded',
        answers: [{ questionId: 'q1', value: ['true'] }, { questionId: 'q2', value: ['true'] }],
        results: [{ questionId: 'q1', correct: true, score: 2, maxScore: 2, by: 'system', comment: '对' }],
        summary: '第二题错了',
        passed: false,
        submittedAt: AT + 1000,
        gradedAt: AT + 2000,
      }),
      NODES,
    )!
    expect(exam).toBeTruthy()
    expect(exam.title).toBe('极限小测')
    expect(exam.attempts).toHaveLength(1)
    const a = exam.attempts[0]
    expect(a.status).toBe('graded')
    expect(a.answers).toHaveLength(2)
    expect(Array.isArray(a.results) && a.results[0].comment).toBe('对')
    expect(a.summary).toBe('第二题错了')
    expect(a.passed).toBe(false)
    expect(a.startedAt).toBe(AT)
    expect(a.endedAt).toBe(AT + 2000)
  })

  it('交过卷还没判的 → submitted；答案留着（那是要用来的判分的）', () => {
    const exam = normalizeExam(
      legacy({ status: 'submitted', answers: [{ questionId: 'q1', value: ['true'] }], submittedAt: AT + 500 }),
      NODES,
    )!
    expect(exam.attempts).toHaveLength(1)
    expect(exam.attempts[0].status).toBe('submitted')
    expect(exam.attempts[0].answers).toHaveLength(1)
  })

  it('在应用内答过、但从没交卷的老草稿 → abandoned（判 0 分），**绝不能是 ongoing**', () => {
    const exam = normalizeExam(
      legacy({ status: 'draft', answers: [{ questionId: 'q1', value: ['true'] }] }),
      NODES,
    )!
    expect(exam.attempts).toHaveLength(1)
    // 认成 ongoing 的话，启动时 ongoingAttempt() 会以为有一场在考，主窗口就盖着黑遮罩出不来了
    expect(exam.attempts[0].status).toBe('abandoned')
  })

  it('一道没答的老草稿 → 就是没考过（不凭空造一条记录）', () => {
    const exam = normalizeExam(legacy(), NODES)!
    expect(exam.attempts).toEqual([])
  })

  it('老卷子没有时限：按题量与类型补一个（小测不限时）', () => {
    const test = normalizeExam(legacy(), NODES)!
    expect(test.minutes).toBeGreaterThanOrEqual(questions.length * 2)
    const quiz = normalizeExam(legacy({ kind: 'quiz' }), NODES)!
    expect(quiz.minutes).toBe(0)
  })

  it('新格式照原样读回（含各种记录），并且按开始时间排序', () => {
    const exam = normalizeExam(
      {
        ...legacy({ limits: undefined }),
        minutes: 40,
        attempts: [
          {
            id: 'a2',
            startedAt: AT + 10_000,
            status: 'graded',
            answers: [{ questionId: 'q1', value: ['true'] }],
            inputs: [{ questionId: 'q1', value: ['true'], at: AT + 11_000, updatedAt: AT + 12_000, overtime: true }],
            dwell: { q1: 4200, q2: -5 },
            blurs: [{ start: AT + 13_000, ms: 3000 }],
            forceSubmit: true,
            overtimeMs: 60_000,
            explanation: '错在把无穷小当成 0。',
          },
          { id: 'a1', startedAt: AT + 1000, status: 'abandoned', answers: [], inputs: [], dwell: {}, blurs: [], forceSubmit: false },
        ],
      },
      NODES,
    )!
    expect(exam.minutes).toBe(40)
    expect(exam.attempts.map((a) => a.id)).toEqual(['a1', 'a2'])
    const a2 = exam.attempts[1]
    expect(a2.inputs[0].overtime).toBe(true)
    expect(a2.inputs[0].updatedAt).toBe(AT + 12_000)
    expect(a2.dwell).toEqual({ q1: 4200 })
    expect(a2.blurs).toEqual([{ start: AT + 13_000, ms: 3000 }])
    expect(a2.overtimeMs).toBe(60_000)
    expect(a2.explanation).toBe('错在把无穷小当成 0。')
  })

  it('节点没了的卷子直接丢掉（不留孤儿）', () => {
    expect(normalizeExam(legacy({ nodeId: 'gone' }), NODES)).toBeNull()
    expect(normalizeExam({ hello: 'world' }, NODES)).toBeNull()
  })
})
