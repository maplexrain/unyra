import { describe, expect, it } from 'vitest'
import { gradeObjective, normalizeOptionToken } from '../src/learn/exam/grade'
import { applyGradeResult, upsertAttempt } from '../src/learn/graph/exams'
import type { Exam, ExamAttempt, ExamQuestion } from '../src/learn/exam/types'
import type { LearnStore } from '../src/learn/types'

const T0 = 1_700_000_000_000

describe('客观题判分容错与归一化 (normalizeOptionToken & gradeObjective)', () => {
  const singleQ: ExamQuestion = {
    id: 'q1',
    type: 'single',
    stem: 'It took me from you. 中 from 是什么词性？',
    points: 1,
    answer: ['A'],
    options: [
      { id: 'A', text: '介词' },
      { id: 'B', text: '连词' },
      { id: 'C', text: '副词' },
      { id: 'D', text: '限定词' },
    ],
  }

  it('normalizeOptionToken 支持标准 id、带点/顿号/冒号前缀与文本全文', () => {
    expect(normalizeOptionToken('A', singleQ)).toBe('A')
    expect(normalizeOptionToken('a', singleQ)).toBe('A')
    expect(normalizeOptionToken('A. 介词', singleQ)).toBe('A')
    expect(normalizeOptionToken('A、介词', singleQ)).toBe('A')
    expect(normalizeOptionToken('A: 介词', singleQ)).toBe('A')
    expect(normalizeOptionToken('A 介词', singleQ)).toBe('A')
    expect(normalizeOptionToken('介词', singleQ)).toBe('A')
    expect(normalizeOptionToken('连词', singleQ)).toBe('B')
  })

  it('单选题支持容错匹配', () => {
    // 标准作答
    expect(gradeObjective(singleQ, { questionId: 'q1', value: ['A'] })).toBe(true)
    expect(gradeObjective(singleQ, { questionId: 'q1', value: ['B'] })).toBe(false)
    // 带有选项内容或前缀的作答
    expect(gradeObjective(singleQ, { questionId: 'q1', value: ['A. 介词'] })).toBe(true)
    expect(gradeObjective(singleQ, { questionId: 'q1', value: ['B. 连词'] })).toBe(false)
    expect(gradeObjective(singleQ, { questionId: 'q1', value: ['介词'] })).toBe(true)
  })

  it('多选题支持容错匹配与乱序匹配', () => {
    const multiQ: ExamQuestion = {
      id: 'qm',
      type: 'multiple',
      stem: '下列哪些是实词？',
      points: 2,
      answer: ['A', 'B'],
      options: [
        { id: 'A', text: '名词' },
        { id: 'B', text: '动词' },
        { id: 'C', text: '冠词' },
      ],
    }
    expect(gradeObjective(multiQ, { questionId: 'qm', value: ['A', 'B'] })).toBe(true)
    expect(gradeObjective(multiQ, { questionId: 'qm', value: ['B', 'A'] })).toBe(true)
    expect(gradeObjective(multiQ, { questionId: 'qm', value: ['A. 名词', 'B. 动词'] })).toBe(true)
    expect(gradeObjective(multiQ, { questionId: 'qm', value: ['A', 'C'] })).toBe(false)
  })

  it('对错题支持常见表达容错', () => {
    const tfQ: ExamQuestion = {
      id: 'qtf',
      type: 'truefalse',
      stem: '词性属于位置',
      points: 1,
      answer: ['true'],
    }
    expect(gradeObjective(tfQ, { questionId: 'qtf', value: ['true'] })).toBe(true)
    expect(gradeObjective(tfQ, { questionId: 'qtf', value: ['对'] })).toBe(true)
    expect(gradeObjective(tfQ, { questionId: 'qtf', value: ['正确'] })).toBe(true)
    expect(gradeObjective(tfQ, { questionId: 'qtf', value: ['false'] })).toBe(false)
    expect(gradeObjective(tfQ, { questionId: 'qtf', value: ['错'] })).toBe(false)
  })
})

describe('非手写机考时 applyGradeResult 防污染与判分一致性', () => {
  const onlineExam: Exam = {
    id: 'e_online',
    nodeId: 'node_test',
    goalId: 'goal_test',
    title: '词性随堂小测',
    kind: 'quiz',
    level: 'easy',
    minutes: 0,
    createdAt: T0,
    attempts: [],
    questions: [
      {
        id: 'q1',
        type: 'single',
        stem: '题1',
        answer: ['A'],
        options: [{ id: 'A', text: '介词' }, { id: 'B', text: '连词' }],
        points: 1,
      },
      {
        id: 'q2',
        type: 'single',
        stem: '题2',
        answer: ['C'],
        options: [{ id: 'A', text: 'old' }, { id: 'C', text: 'opened' }],
        points: 1,
      },
    ],
  }

  function makeStore(): LearnStore {
    const node = {
      id: 'node_test',
      goalId: 'goal_test',
      title: '语法',
      key: '语法',
      description: '',
      docs: { teaching: '' },
      notes: [],
      annotations: [],
      status: 'learning' as const,
      createdAt: T0,
      updatedAt: T0,
    }
    return {
      version: 1,
      goals: [{ id: 'goal_test', title: '英语', createdAt: T0, active: true }],
      activeGoalId: 'goal_test',
      nodes: [node],
      activeNodeId: 'node_test',
      exams: [onlineExam],
      conversations: {},
      readingRecaps: {},
      nodeRelations: [],
      tags: [],
      resources: [],
      favorites: [],
      favGroups: [],
      localFiles: [],
      recentFiles: [],
      openTabs: [],
      activeTabId: null,
      workspaceSplit: 0.5,
      docScroll: {},
      drafts: {},
      readingTicks: {},
      readingTickMeta: {},
      structure: {},
      schedule: { events: [], recurrence: [] },
      tmp: {},
      agentTabs: {},
      agentActiveTab: {},
      workflows: {},
    } as unknown as LearnStore
  }

  it('普通机考中，Agent 即使返回带文字的 userAnswer，也不得篡改原始 answers，且系统判分保持正确', () => {
    let store = makeStore()
    const attempt: ExamAttempt = {
      id: 'att_online_1',
      startedAt: T0,
      endedAt: T0 + 60_000,
      status: 'submitted',
      answers: [
        { questionId: 'q1', value: ['A'] },
        { questionId: 'q2', value: ['C'] },
      ],
      inputs: [
        { questionId: 'q1', value: ['A'], at: T0 + 10_000 },
        { questionId: 'q2', value: ['C'], at: T0 + 20_000 },
      ],
      dwell: {},
      blurs: [],
      forceSubmit: false,
    }
    store = upsertAttempt(store, onlineExam.id, attempt)

    // Agent 判分时，携带了自然语言描述的 userAnswer
    const res = applyGradeResult(store, onlineExam.id, 'att_online_1', {
      passed: true,
      summary: '全部正确',
      results: [
        { questionId: 'q1', correct: true, score: 1, userAnswer: 'A. 介词', comment: '答得好' },
        { questionId: 'q2', correct: true, score: 1, userAnswer: 'C. opened', comment: '时态谓语' },
      ],
    })

    expect(res.ok).toBe(true)
    const graded = res.store.exams[0].attempts[0]
    expect(graded.status).toBe('graded')

    // 核心断言 1：用户的原始作答未被污染覆写
    expect(graded.answers[0].value).toEqual(['A'])
    expect(graded.answers[1].value).toEqual(['C'])

    // 核心断言 2：客观题判分正确命中，得分为满分 2 分
    expect(graded.results?.[0].correct).toBe(true)
    expect(graded.results?.[0].score).toBe(1)
    expect(graded.results?.[1].correct).toBe(true)
    expect(graded.results?.[1].score).toBe(1)
  })
})
