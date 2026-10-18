/**
 * 有效阅读**按学习目标分开**（见 learn/reading 的 ReadingBook）。
 *
 * 这一条是口径变更：从前它记在**用户**头上，一个人学两门课时，两门课的时长混在一条曲线里，
 * 「今天读了多久」不再是任何一门课的事实。改成按目标之后有两件事必须成立：
 * 1. 两本账互不串门（写一本不动另一本）；
 * 2. 各自落在自己的目标目录里（删目标即随之消失）。
 */
import { describe, expect, it } from 'vitest'

import { applyReadingDelta, emptyReading, readingDay, readingOfGoal, withGoalReading } from '../src/learn/reading'
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
})

describe('落盘', () => {
  it('落在**各自的目标目录**里（reading.json）', () => {
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
  })
})
