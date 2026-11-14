// @vitest-environment happy-dom
/**
 * 阅卷对象**钉住**（makeExamDeps 的 PinnedExam）的单元用例。
 *
 * 判分是一轮几十秒的对话，中间学习者完全可能开另一份卷子、作答、交卷——
 * 「最新待判分」当场换了人。钉住之前，不带 attemptId 的 api.exam.read() 回的是
 * **新卷**、api.exam.grade() 落到**新卷**的 attempt 上——判分与错题讲解全错位
 * （「判题的时候开另一个考试，判题错乱」的事故现场）。这里的用例把口径钉死：
 * 钉住的轮次，读、判、讲只认那一份卷子；不钉时保持原口径（最新待判分优先）。
 */
import { describe, expect, it } from 'vitest'
import type { Exam, ExamAttempt } from '../src/learn/exam'
import type { LearnStore } from '../src/learn/types'
import { makeExamDeps } from '../src/components/learn/workspace/examTools'

const T0 = 1_700_000_000_000

const attempt = (id: string, status: ExamAttempt['status'], startedAt: number): ExamAttempt => ({
  id,
  startedAt,
  endedAt: startedAt + 60_000,
  status,
  answers: [],
  inputs: [],
  dwell: {},
  blurs: [],
  forceSubmit: false,
})

const paper = (id: string, createdAt: number, attempts: ExamAttempt[]): Exam => ({
  id,
  nodeId: 'n1',
  goalId: 'g1',
  title: '试卷' + id,
  kind: 'test',
  level: 'medium',
  minutes: 10,
  questions: [
    { id: 'q1', type: 'truefalse', stem: '极限存在则唯一', points: 2, answer: ['true'] },
  ],
  createdAt,
  attempts,
})

/** A 卷先交（正在阅），B 卷后交（判分进行中学习者又开又交的另一场） */
function makeStore(): LearnStore {
  return {
    exams: [
      paper('eA', T0, [attempt('aA', 'submitted', T0 + 60_000)]),
      paper('eB', T0 + 1000, [attempt('aB', 'submitted', T0 + 120_000)]),
    ],
    nodes: [{ id: 'n1', goalId: 'g1', title: '极限', status: 'learning' }],
    edges: [],
  } as unknown as LearnStore
}

function makeHost(store: LearnStore) {
  const state: { store: LearnStore } = { store }
  return {
    state,
    host: {
      getLatest: () => state.store,
      set: (s: LearnStore) => {
        state.store = s
      },
      onToast: () => {},
      openTabRef: { current: () => {} },
      setCreating: () => {},
    },
  }
}

describe('阅卷对象钉住（PinnedExam）', () => {
  it('判分进行中 B 卷交了卷：钉住 A 的轮次判分仍落 A，不漂到「最新待判」的 B', () => {
    const { host, state } = makeHost(makeStore())
    const deps = makeExamDeps(host, 'n1', { examId: 'eA', attemptId: 'aA' })

    const res = deps.gradeExam({ passed: false, summary: '本次未完全掌握' })
    expect(res.ok).toBe(true)

    const eA = state.store.exams.find((e) => e.id === 'eA')!
    const eB = state.store.exams.find((e) => e.id === 'eB')!
    expect(eA.attempts[0].status).toBe('graded')
    expect(eA.attempts[0].passed).toBe(false)
    // B 卷纹丝不动：它的阅卷轮还没开始
    expect(eB.attempts[0].status).toBe('submitted')
  })

  it('不带 attemptId 的 exam.read() 缺省读钉住的那一次，而不是最新卷', () => {
    const { host } = makeHost(makeStore())
    const deps = makeExamDeps(host, 'n1', { examId: 'eA', attemptId: 'aA' })

    const payload = JSON.parse(deps.readExam()) as { paper: { id: string }; attempt: { startedAt: string } }
    expect(payload.paper.id).toBe('eA')

    // 对照：不钉住的旧口径读最新卷
    const plain = makeExamDeps(host, 'n1')
    const plainPayload = JSON.parse(plain.readExam()) as { paper: { id: string } }
    expect(plainPayload.paper.id).toBe('eB')
  })

  it('只钉 examId（手动阅卷入口）：取那份卷子里等着收尾的那一次', () => {
    const { host, state } = makeHost(makeStore())
    const deps = makeExamDeps(host, 'n1', { examId: 'eA' })

    const res = deps.gradeExam({ passed: true, summary: '完全掌握' })
    expect(res.ok).toBe(true)
    const eA = state.store.exams.find((e) => e.id === 'eA')!
    expect(eA.attempts[0].status).toBe('graded')
  })

  it('钉住的卷子找不到（被删了）：grade 空手而回，绝不漂到别的卷子上', () => {
    const { host, state } = makeHost(makeStore())
    const deps = makeExamDeps(host, 'n1', { examId: 'eGONE', attemptId: 'aGONE' })

    expect(deps.stage()).toBe('idle')
    const res = deps.gradeExam({ passed: true, summary: '不该落到任何卷子上' })
    expect(res.ok).toBe(false)

    // 两份卷子都原样
    expect(state.store.exams.find((e) => e.id === 'eA')!.attempts[0].status).toBe('submitted')
    expect(state.store.exams.find((e) => e.id === 'eB')!.attempts[0].status).toBe('submitted')
  })

  it('不钉时保持原口径：最新待判分优先（examNeedingWork）', () => {
    const { host, state } = makeHost(makeStore())
    const deps = makeExamDeps(host, 'n1')

    expect(deps.stage()).toBe('grading')
    const res = deps.gradeExam({ passed: true, summary: '旧口径：判最新' })
    expect(res.ok).toBe(true)
    const eB = state.store.exams.find((e) => e.id === 'eB')!
    expect(eB.attempts[0].status).toBe('graded')
  })
})
