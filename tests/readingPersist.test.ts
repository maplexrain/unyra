/**
 * 阅读记录（以及打卡、番茄钟）的**落盘往返**。
 *
 * 为什么值得单独一个文件：这三块整份存在 state.json 里，没有各自的磁盘镜像。
 * 于是「写」和「读」是两段分开的代码，任何一段漏掉一个字段，症状都一样——
 * 用着好好的，重启之后记录全空。这正是真出过一次的事故：buildState 写了，
 * parseDocs 没接，于是每次启动都把记录读成空的（连坏数据都算不上，是静默清空）。
 */
import { describe, expect, it } from 'vitest'

import { emptyDocs } from '../src/learn/groups'
import { buildDocs, buildState, parseDocs } from '../src/learn/files'
import { applyReadingDelta, emptyReading, studyDayOf } from '../src/learn/reading'
import { applyCheckinAttempt, checkinDay, emptyCheckin } from '../src/learn/checkin'
import { emptyPomodoro, startPomodoro, tickPomodoro } from '../src/learn/pomodoro'
import type { LearnStore } from '../src/learn/types'

const now = new Date(2026, 8, 23, 21, 0).getTime()
const day = studyDayOf(now)

/** 一份「什么都有一点」的学习数据 */
function fullStore(): LearnStore {
  const reading = applyReadingDelta(emptyReading(), {
    sessionId: 's1',
    nodeId: 'n1',
    doc: 'teaching',
    day,
    at: now,
    activeMs: 120_000,
    minuteIndex: 0,
    minutes: [
      { ms: 60_000, chars: 400, marks: 1, gaps: 0 },
      { ms: 60_000, chars: 380, marks: 0, gaps: 1 },
    ],
    breaks: [{ at: now - 60_000, ms: 5_000, kind: 'blur' }],
    // 采集器在第一笔里带 opens: 1（「打开过」与「读到了」是两件事，见 learn/reading）
    opens: 1,
    sections: [
      { key: '极限', text: '极限', index: 0, level: 2, ms: 120_000, reach: 1, marks: ['details'], firstAt: now, lastAt: now },
      { key: '三次方根', text: '三次方根', index: 1, level: 2, ms: 0, reach: 0.2, marks: [], firstAt: 0, lastAt: now },
    ],
  })
  const checkin = applyCheckinAttempt(emptyCheckin(), { day, correct: 3, total: 4, threshold: 3, passed: true }, now).store
  // 一段跑完的专注（在 log 里）+ 正在跑的休息（在 current 里）：两半都有东西可校验
  const pomodoro = tickPomodoro(startPomodoro(emptyPomodoro(), { focusMinutes: 25, groups: 3 }, now - 25 * 60_000).store, now).store
  return {
    version: 2,
    nodes: [
      {
        id: 'n1',
        title: '极限的直觉',
        key: '极限的直觉',
        description: '一句话',
        docs: { teaching: '# 极限\n\n正文' },
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
    goals: [{ id: 'g1', rootNodeId: 'n1', question: '微积分', createdAt: now, updatedAt: now }],
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
    reading: { byGoal: { g1: reading } },
    checkin: { byGoal: { g1: checkin } },
    pomodoro,
  }
}

describe('写盘 → 读回', () => {
  it('阅读记录整块活着回来：会话、节锚、时长、分钟桶、中断', () => {
    const store = fullStore()
    const back = parseDocs(buildDocs(store), buildState(store))
    expect(back).not.toBeNull()
    const rec = back?.reading?.byGoal.g1?.nodes.n1
    expect(rec?.activeMs).toBe(120_000)
    expect(rec?.opens).toBe(1)
    expect(rec?.docs.teaching.sections.map((s) => s.key)).toEqual(['极限', '三次方根'])
    expect(rec?.docs.teaching.sections[0].marks).toEqual(['details'])
    const session = back?.reading?.byGoal.g1?.sessions[0]
    expect(session?.activeMs).toBe(120_000)
    expect(session?.minutes.map((m) => m.ms)).toEqual([60_000, 60_000])
    expect(session?.breaks[0]).toMatchObject({ kind: 'blur', ms: 5_000 })
  })

  it('学习日索引与打卡账本一起回来（打卡的连续天数靠它）', () => {
    const back = parseDocs(buildDocs(fullStore()), buildState(fullStore()))
    expect(back?.reading?.byGoal.g1?.days[day]?.activeMs).toBe(120_000)
    expect(back?.reading?.byGoal.g1?.days[day]?.nodes).toEqual(['n1'])
    expect(checkinDay(back?.checkin?.byGoal.g1, day)?.passed).toBe(true)
    expect(checkinDay(back?.checkin?.byGoal.g1, day)?.attempts[0]).toMatchObject({ correct: 3, total: 4, threshold: 3 })
  })

  it('番茄钟那一段与记录也回来（关掉应用再打开，计时接着走）', () => {
    const back = parseDocs(buildDocs(fullStore()), buildState(fullStore()))
    expect(back?.pomodoro?.current).toMatchObject({ phase: 'rest', index: 1, groups: 3, focusMinutes: 25 })
    expect(back?.pomodoro?.log[0]).toMatchObject({ minutes: 25, index: 1, groups: 3 })
  })

  it('番茄钟仍旧整份存在 state.json 里：那个字段没了就读成空', () => {
    const store = fullStore()
    const state = buildState(store) as Record<string, unknown>
    delete state.pomodoro
    const back = parseDocs(buildDocs(store), state)
    expect(back).not.toBeNull()
    expect(back?.pomodoro?.current).toBeNull()
  })

  it('阅读与打卡改存目标目录：那两份文件不在时视为空（跟 state.json 里有没有无关）', () => {
    const store = fullStore()
    const files = buildDocs(store)
    // 只摘掉这两份：别的文件（文档、meta、chat）一概不动
    for (const rel of [...files.keys()]) {
      if (rel.endsWith('/reading.json') || rel.endsWith('/checkin.json')) files.delete(rel)
    }
    const back = parseDocs(files, buildState(store))
    expect(back).not.toBeNull()
    expect(back?.reading?.byGoal).toEqual({})
    expect(back?.checkin?.byGoal).toEqual({})
  })

  it('空记录不写进 state.json：省得每次保存都多写几百字节的空壳', () => {
    const state = buildState({ ...fullStore(), reading: { byGoal: {} }, checkin: { byGoal: {} }, pomodoro: emptyPomodoro() })
    expect('reading' in state).toBe(false)
    expect('checkin' in state).toBe(false)
    expect('pomodoro' in state).toBe(false)
  })
})
