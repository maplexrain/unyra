/**
 * 试卷自动打卡（打卡的第二种通道）的接线用例。
 *
 * 需求钉死的三条：完成的是**该目标下**的试卷、这次考试必须是**这份卷子的第一次**、
 * 成绩达到**及格线**（卷面 ≥ 60%）。三条都由 applyGradeResult（Agent 判分的落库点）复核，
 * 这里一条条钉住——以及「掌握判定（Agent 给的 passed）与及格是两条线」：
 * 分数够及格但 Agent 判未掌握，打卡照样成立。
 */
import { describe, expect, it } from 'vitest'

import { applyGradeResult } from '../src/learn/graph'
import { applyCheckinAttempt, emptyCheckin, withGoalCheckin } from '../src/learn/checkin'
import type { Exam } from '../src/learn/exam'
import { emptyDocs } from '../src/learn/groups'
import { emptyPomodoro } from '../src/learn/pomodoro'
import { studyDayOf } from '../src/learn/reading'
import type { LearnStore } from '../src/learn/types'

const now = Date.now()
const day = studyDayOf(now)

/** 两道单选题、各 2 分；答对就是 4/4 = 100%，答错 0/4 = 0% */
function examWith(attempts: Exam['attempts']): Exam {
  return {
    id: 'e1',
    nodeId: 'n1',
    goalId: 'g1',
    title: '导数第一次测验',
    kind: 'quiz',
    level: 'easy',
    minutes: 0,
    createdAt: now,
    questions: [
      {
        id: 'q1',
        type: 'single',
        stem: '导数的几何意义是什么？',
        options: [
          { id: 'optA', text: '切线斜率' },
          { id: 'optB', text: '割线斜率' },
        ],
        answer: ['optA'],
        points: 2,
      },
      {
        id: 'q2',
        type: 'single',
        stem: '常数函数的导数是？',
        options: [
          { id: 'optA', text: '0' },
          { id: 'optB', text: '1' },
        ],
        answer: ['optB'],
        points: 2,
      },
    ],
    attempts,
  }
}

const submit = (id: string, correct: boolean): Exam['attempts'][number] => ({
  id,
  startedAt: now - 10 * 60_000,
  endedAt: now,
  status: 'submitted',
  answers: [
    { questionId: 'q1', value: [correct ? 'optA' : 'optB'] },
    { questionId: 'q2', value: [correct ? 'optB' : 'optA'] },
  ],
  inputs: [],
  dwell: {},
  blurs: [],
  forceSubmit: false,
})

function storeWith(exam: Exam, checkin?: LearnStore['checkin']): LearnStore {
  return {
    version: 2,
    nodes: [
      {
        id: 'n1',
        title: '导数',
        key: '导数',
        description: '',
        docs: { teaching: '# 导数' },
        notes: [],
        annotations: [],
        status: 'learning',
        origin: 'ai',
        goalId: 'g1',
        createdAt: now,
        updatedAt: now,
      },
    ],
    edges: [],
    goals: [{ id: 'g1', rootNodeId: 'n1', question: '我想学导数', createdAt: now, updatedAt: now }],
    conversations: [],
    exams: [exam],
    tmp: {},
    resources: {},
    activeGoalId: 'g1',
    activeNodeId: 'n1',
    activeConversationId: '',
    docArea: emptyDocs(),
    drafts: {},
    docScroll: {},
    localFiles: [],
    ...(checkin ? { checkin } : {}),
    pomodoro: emptyPomodoro(),
  }
}

describe('试卷首次考试及格 → 自动打卡', () => {
  it('第一次考试就及格：当天账上多一条 exam 记录（Agent 判未掌握也不影响及格）', () => {
    const out = applyGradeResult(storeWith(examWith([submit('a1', true)])), 'e1', 'a1', {
      passed: false,
      summary: '还有薄弱项',
      results: [],
    })
    expect(out.ok).toBe(true)
    const rec = out.store.checkin?.byGoal['g1']?.days[day]
    expect(rec?.passed).toBe(true)
    expect(rec?.exam).toMatchObject({ title: '导数第一次测验', score: 4, total: 4 })
    // 及格是及格、掌握是掌握：Agent 说未掌握，节点不该被改成已掌握
    expect(out.store.nodes[0].status).toBe('learning')
  })

  it('重考及格不算：第一次考砸了，第二次满分也不自动打卡', () => {
    const first = submit('a0', false)
    const exam = examWith([{ ...first, status: 'graded', passed: false }, submit('a1', true)])
    const out = applyGradeResult(storeWith(exam), 'e1', 'a1', { passed: true, summary: '补考通过了', results: [] })
    expect(out.store.checkin?.byGoal['g1']?.days[day]).toBeUndefined()
  })

  it('第一次考试但没到及格线：不记账', () => {
    const out = applyGradeResult(storeWith(examWith([submit('a1', false)])), 'e1', 'a1', {
      passed: false,
      summary: '这次不理想',
      results: [],
    })
    expect(out.store.checkin?.byGoal['g1']?.days[day]).toBeUndefined()
  })

  it('今天已经打过卡：账原样不动（不覆盖、不重复记）', () => {
    // 预置：今天已经通过导师出题打过卡了
    const preset = withGoalCheckin(
      undefined,
      'g1',
      applyCheckinAttempt(emptyCheckin(), { day, correct: 4, total: 4, threshold: 3, passed: true }, now - 60_000).store,
    )
    const out = applyGradeResult(storeWith(examWith([submit('a1', true)]), preset), 'e1', 'a1', {
      passed: false,
      summary: '',
      results: [],
    })
    expect(out.ok).toBe(true)
    const rec = out.store.checkin?.byGoal['g1']?.days[day]
    expect(rec?.passed).toBe(true)
    // 打卡的时刻还是原来那次出题的时刻：试卷通道没有插进来
    expect(rec?.at).toBe(now - 60_000)
    expect(rec?.exam).toBeUndefined()
  })

  it('重复判分不会记两笔：第二次进来时这次考试已经是 graded', () => {
    const store = storeWith(examWith([submit('a1', true)]))
    const first = applyGradeResult(store, 'e1', 'a1', { passed: false, summary: '', results: [] })
    const again = applyGradeResult(first.store, 'e1', 'a1', { passed: false, summary: '', results: [] })
    expect(again.store.checkin?.byGoal['g1']?.days[day]?.exam?.at).toBe(
      first.store.checkin?.byGoal['g1']?.days[day]?.exam?.at,
    )
  })
})
