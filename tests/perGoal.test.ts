/**
 * 有效阅读与打卡**按学习目标分开**（见 learn/reading 的 ReadingBook、learn/checkin 的 CheckinBook）。
 *
 * 这一条是口径变更：从前它们记在**用户**头上，一个人学两门课时，两门课的时长混在一条曲线里，
 * 「今天读了多久」「连续几天打卡」都不再是任何一门课的事实。改成按目标之后有三件事必须成立：
 * 1. 两本账互不串门（写一本不动另一本）；
 * 2. 门槛与连续天数各算各的（这是「分开」的全部意义）；
 * 3. 各自落在自己的目标目录里（删目标即随之消失）。
 */
import { describe, expect, it } from 'vitest'

import { applyReadingDelta, emptyReading, readingDay, readingOfGoal, withGoalReading } from '../src/learn/reading'
import {
  applyCheckinAttempt,
  checkinEligible,
  checkinOfGoal,
  emptyCheckin,
  normalizeCheckinBook,
  streakOf,
  withGoalCheckin,
} from '../src/learn/checkin'
import { emptyDocs } from '../src/learn/groups'
import { buildDocs } from '../src/learn/files'
import type { LearnStore } from '../src/learn/types'
import type { KnowledgeNode } from '../src/learn/types'

const now = new Date(2026, 8, 20, 20, 0).getTime()
const MIN = 60_000

/** 记一笔「今天读了 ms 毫秒、读透两节」的账（记进哪本账由调用方决定） */
function readIn(nodeId: string, activeMs: number, day: string) {
  return applyReadingDelta(emptyReading(), {
    sessionId: 's-' + nodeId,
    nodeId,
    doc: 'teaching',
    day,
    at: now,
    activeMs,
    minuteIndex: 0,
    minutes: [{ ms: activeMs, chars: 3000, marks: 1, gaps: 0 }],
    breaks: [],
    sections: [
      { key: 'a', text: '极限的直觉', index: 0, level: 2, ms: activeMs / 2, reach: 0.9, marks: ['details'], firstAt: now, lastAt: now },
      { key: 'b', text: '三次方根', index: 1, level: 2, ms: activeMs / 2, reach: 0.9, marks: [], firstAt: now, lastAt: now },
    ],
  })
}

const day = '2026-09-20'

describe('两本账互不串门', () => {
  it('写一本不动另一本（withGoalReading）', () => {
    const a = readIn('n1', 30 * MIN, day)
    const book = withGoalReading(undefined, 'g1', a)
    expect(readingOfGoal(book, 'g1')).toBe(a)
    expect(readingOfGoal(book, 'g2')).toBeUndefined()
    const b = readIn('n2', 5 * MIN, day)
    const both = withGoalReading(book, 'g2', b)
    expect(readingOfGoal(both, 'g1')).toBe(a)
    expect(readingDay(readingOfGoal(both, 'g1'), day)?.activeMs).toBe(30 * MIN)
    expect(readingDay(readingOfGoal(both, 'g2'), day)?.activeMs).toBe(5 * MIN)
  })

  it('打卡账同理（withGoalCheckin）', () => {
    const one = applyCheckinAttempt(emptyCheckin(), { day, correct: 3, total: 4, threshold: 3, passed: true }, now).store
    const book = withGoalCheckin(undefined, 'g1', one)
    expect(checkinOfGoal(book, 'g1')?.days[day]?.passed).toBe(true)
    expect(checkinOfGoal(book, 'g2')).toBeUndefined()
  })
})

describe('门槛与连续天数各算各的', () => {
  it('一个目标读够了、另一个没读够：前者的资格不代表后者', () => {
    const enough = readIn('n1', 20 * MIN, day)
    const little = readIn('n2', 5 * MIN, day)
    const e1 = checkinEligible(enough, undefined, { now, titleOf: () => '极限' })
    const e2 = checkinEligible(little, undefined, { now, titleOf: () => '极限' })
    expect(e1.ok).toBe(true)
    expect(e2.ok).toBe(false)
    expect(e2.reason).toContain('还差 10 分钟')
  })

  it('连续天数各数各的：A 连了两天，B 只有今天', () => {
    const yesterday = '2026-09-19'
    let a = emptyCheckin()
    a = applyCheckinAttempt(a, { day: yesterday, correct: 3, total: 4, threshold: 3, passed: true }, now).store
    a = applyCheckinAttempt(a, { day, correct: 3, total: 4, threshold: 3, passed: true }, now).store
    const b = applyCheckinAttempt(emptyCheckin(), { day, correct: 3, total: 4, threshold: 3, passed: true }, now).store
    expect(streakOf(a, now).current).toBe(2)
    expect(streakOf(b, now).current).toBe(1)
  })
})

describe('读回与落盘', () => {
  it('目标没了的整本丢掉（normalizeCheckinBook）', () => {
    const one = applyCheckinAttempt(emptyCheckin(), { day, correct: 3, total: 4, threshold: 3, passed: true }, now).store
    const book = normalizeCheckinBook({ byGoal: { g1: one, gone: one } }, new Set(['g1']))
    expect(Object.keys(book.byGoal)).toEqual(['g1'])
  })

  it('落盘落在**各自的目标目录**里（reading.json / checkin.json）', () => {
    const node = (id: string, goalId: string): KnowledgeNode => ({
      id,
      title: '节点 ' + id,
      key: id,
      description: '',
      docs: { teaching: '' },
      notes: [],
      annotations: [],
      status: 'learning',
      origin: 'user',
      goalId,
      createdAt: 0,
      updatedAt: 0,
      learning: { lastStudiedAt: now, visits: 1 },
    })
    const store: LearnStore = {
      version: 2,
      nodes: [node('n1', 'g1'), node('n2', 'g2')],
      edges: [],
      goals: [
        { id: 'g1', rootNodeId: 'n1', question: '微积分', createdAt: 0, updatedAt: 0 },
        { id: 'g2', rootNodeId: 'n2', question: '线性代数', createdAt: 0, updatedAt: 0 },
      ],
      conversations: [],
      exams: [],
      tmp: {},
      resources: {},
      activeGoalId: 'g1',
      activeNodeId: 'n1',
      activeConversationId: null,
      // 文档区：一组、没有页签（分割与分组见 learn/groups）
      docArea: emptyDocs(),
      drafts: {},
      docScroll: {},
      localFiles: [],
      reading: { byGoal: { g1: readIn('n1', 20 * MIN, day), g2: readIn('n2', 5 * MIN, day) } },
    }
    const files = buildDocs(store)
    const paths = [...files.keys()].filter((p) => p.endsWith('/reading.json')).sort()
    expect(paths.length).toBe(2)
    // 两个目标各写各的，文件里就是那一本的账
    for (const p of paths) {
      const rec = JSON.parse(files.get(p) as string) as { days: Record<string, { activeMs: number }> }
      expect(rec.days[day].activeMs).toBeGreaterThan(0)
    }
    // 打卡没记录就不写文件（与 mind.json / method.json 同一条纪律）
    expect([...files.keys()].some((p) => p.endsWith('/checkin.json'))).toBe(false)
  })
})
