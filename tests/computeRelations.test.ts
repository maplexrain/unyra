import { describe, expect, it } from 'vitest'
import { computeRelations } from '../src/components/learn/docRelations/computeRelations'
import type { LearnStore, KnowledgeNode } from '../src/learn/types'

function makeTestStore(): LearnStore {
  const nodeA: KnowledgeNode = {
    id: 'node-a',
    title: '文档 A (父级)',
    key: 'doc_a',
    description: '',
    docs: { teaching: 'A content' },
    notes: [],
    annotations: [],
    status: 'mastered',
    origin: 'user',
    goalId: 'goal-1',
    createdAt: 1,
    updatedAt: 1,
    outline: {
      intro: '',
      children: [{ key: 'sub-b', title: '子目标 B', summary: '' }],
      updatedAt: 1,
    },
  }

  const nodeB: KnowledgeNode = {
    id: 'node-b',
    title: '文档 B (当前)',
    key: 'doc_b',
    description: '',
    docs: { teaching: 'B content' },
    notes: [
      { id: 'note-b1', name: 'B的笔记1', content: 'note text', createdAt: 1, updatedAt: 1 },
      { id: 'note-b2', name: 'B的笔记2', content: 'note text 2', createdAt: 1, updatedAt: 1 },
    ],
    superdocs: [
      { id: 'super-b1', name: 'B的超级文档', html: '<p>super</p>', createdAt: 1, updatedAt: 1 },
    ],
    annotations: [],
    status: 'learning',
    origin: 'user',
    goalId: 'goal-1',
    createdAt: 2,
    updatedAt: 2,
  }

  const nodeC: KnowledgeNode = {
    id: 'node-c',
    title: '文档 C (兄弟)',
    key: 'doc_c',
    description: '',
    docs: { teaching: 'C content' },
    notes: [],
    annotations: [],
    status: 'learning',
    origin: 'user',
    goalId: 'goal-1',
    createdAt: 3,
    updatedAt: 3,
  }

  const nodeD: KnowledgeNode = {
    id: 'node-d',
    title: '文档 D (子级)',
    key: 'doc_d',
    description: '',
    docs: { teaching: 'D content' },
    notes: [],
    annotations: [],
    status: 'learning',
    origin: 'user',
    goalId: 'goal-1',
    createdAt: 4,
    updatedAt: 4,
  }

  return {
    nodes: [nodeA, nodeB, nodeC, nodeD],
    goals: [
      { id: 'goal-1', title: '目标 1', rootNodeId: 'node-a', status: 'in_progress', createdAt: 1, updatedAt: 1 },
    ],
    // 边连接：
    // nodeA 通过附身大纲 o:node-a 连接到 nodeB 和 nodeC (nodeA -> o:node-a -> nodeB / nodeC)
    // 边里表达为 from: 'node-a', to: 'node-b' 与 from: 'o:node-a', to: 'node-c'
    // nodeB 通过游离大纲 free-outline-1 连接到 nodeD (nodeB -> o:free-1 -> nodeD)
    edges: [
      { from: 'node-a', to: 'node-b', portKey: 'sub-b' },
      { from: 'o:node-a', to: 'node-c', portKey: 'sub-c' },
      { from: 'node-b', to: 'o:free-1' },
      { from: 'o:free-1', to: 'node-d' },
    ],
    outlines: [
      { id: 'free-1', goalId: 'goal-1', title: '游离分类大纲', intro: '', children: [], updatedAt: 1 },
    ],
    exams: [
      {
        id: 'exam-b1',
        goalId: 'goal-1',
        nodeId: 'node-b',
        title: 'B的单元测试',
        questions: [],
        attempts: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    docArea: { focus: 'main', groups: [], tabOwners: {} },
    docScroll: {},
    drafts: {},
    favorites: [],
    recents: [],
    history: [],
    tmp: {},
  } as unknown as LearnStore
}

describe('computeRelations', () => {
  it('正确抹平大纲层并分类当前文档的关联项（教学文档视角）', () => {
    const store = makeTestStore()
    const rels = computeRelations(store, 'node-b', { kind: 'teach', nodeId: 'node-b' })

    // 上级：应该直接跨过 o:node-a 找到 node-a (文档)
    expect(rels.parents.map((p) => ({ id: p.id, kind: p.kind, badge: p.badgeLabel }))).toEqual([
      { id: 'node-a', kind: 'doc', badge: '文档' },
    ])

    // 下级：应该跨过游离大纲 o:free-1 找到 node-d (文档)，以及 node-b 的笔记、超级文档、试卷
    expect(rels.children.map((c) => ({ id: c.id, kind: c.kind, badge: c.badgeLabel }))).toEqual([
      { id: 'node-d', kind: 'doc', badge: '文档' },
      { id: 'note-b1', kind: 'note', badge: '笔记' },
      { id: 'note-b2', kind: 'note', badge: '笔记' },
      { id: 'super-b1', kind: 'super', badge: '超级文档' },
      { id: 'exam-b1', kind: 'exam', badge: '试卷' },
    ])

    // 同级：应该找到共享 node-a 父级的 node-c (文档)
    expect(rels.siblings.map((s) => ({ id: s.id, kind: s.kind, badge: s.badgeLabel }))).toEqual([
      { id: 'node-c', kind: 'doc', badge: '文档' },
    ])

    expect(rels.totalCount).toBe(7)
  })

  it('处于笔记视角时，宿主教学文档提升为上级，其他挂件归入同级', () => {
    const store = makeTestStore()
    const rels = computeRelations(store, 'node-b', { kind: 'note', nodeId: 'node-b', note: 'B的笔记1' })

    // 上级：包含宿主文档 node-b，以及爷爷文档 node-a
    expect(rels.parents.map((p) => p.id)).toEqual(['node-b', 'node-a'])

    // 同级：包含另一份笔记 note-b2、超级文档 super-b1、试卷 exam-b1、兄弟文档 node-c
    expect(rels.siblings.map((s) => s.id)).toEqual(['note-b2', 'super-b1', 'exam-b1', 'node-c'])

    // 下级：依然包含 node-d
    expect(rels.children.map((c) => c.id)).toEqual(['node-d'])
  })
})
