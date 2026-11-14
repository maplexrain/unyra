import { describe, expect, it } from 'vitest'
import { NOTE_SUMMARY_MAX_CHARS, parseNoteSummary } from '../src/learn/noteSummary'
import { noteById, writeNoteSummary } from '../src/learn/notes'

const NOW = 1700000000000

function store() {
  return {
    version: 2 as const,
    nodes: [
      {
        id: 'n1',
        title: '极限',
        key: '极限',
        description: '',
        docs: { teaching: '' },
        notes: [{ id: 'note-1', name: '错题本', content: '我把错题都记在这里', createdAt: NOW, updatedAt: NOW }],
        annotations: [],
        status: 'learning' as const,
        origin: 'user' as const,
        goalId: 'g1',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    edges: [],
    goals: [{ id: 'g1', rootNodeId: 'n1', question: '微积分', createdAt: NOW, updatedAt: NOW }],
    conversations: [],
    exams: [],
    detached: {
      g1: { notes: [{ id: 'note-free', name: '游学的笔记', content: '游离的一份', createdAt: NOW, updatedAt: NOW }], superdocs: [] },
    },
    drafts: {},
  } as unknown as Parameters<typeof writeNoteSummary>[0]
}

describe('笔记总结（节点宇宙笔记卡的 ≤200 字注脚）', () => {
  it('parseNoteSummary 抓 JSON 里的 summary，剥围栏，超 200 字硬截', () => {
    expect(parseNoteSummary('{"summary": "这段讲极限的定义。"}')).toBe('这段讲极限的定义。')
    expect(parseNoteSummary('```json\n{"summary": "带围栏的总结。"}\n```')).toBe('带围栏的总结。')
    expect(parseNoteSummary('不是 JSON')).toBe('')
    expect(parseNoteSummary('{"summary": ""}')).toBe('')
    const long = '长'.repeat(300)
    expect(parseNoteSummary(`{"summary": "${long}"}`).length).toBe(NOTE_SUMMARY_MAX_CHARS)
  })

  it('writeNoteSummary 两处住处都认（宿主节点上 / 游离池），不动 updatedAt', () => {
    const next = writeNoteSummary(store(), 'note-1', '极限的错题整理。')
    expect(next).not.toBeNull()
    const hit = noteById(next!, 'note-1')
    expect(hit?.summary).toBe('极限的错题整理。')
    expect(hit?.updatedAt).toBe(NOW)

    const freeNext = writeNoteSummary(store(), 'note-free', '游离笔记的总结。')
    expect(freeNext).not.toBeNull()
    expect(noteById(freeNext!, 'note-free')?.summary).toBe('游离笔记的总结。')
  })

  it('找不到的笔记与空总结都返回 null', () => {
    expect(writeNoteSummary(store(), 'note-x', '总结')).toBeNull()
    expect(writeNoteSummary(store(), 'note-1', '   ')).toBeNull()
    expect(noteById(store(), 'note-x')).toBeNull()
    expect(noteById(store(), 'note-1')?.name).toBe('错题本')
  })
})
