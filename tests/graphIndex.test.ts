import { describe, expect, it } from 'vitest'
import { emptyLearnStore } from '../src/learn/store/empty'
import { nodeById } from '../src/learn/graph/lookup'
import { parentIds, prereqIds } from '../src/learn/graph/edges'
import { shellExamOf } from '../src/learn/graph/exams'
import type { Exam } from '../src/learn/exam'
import type { KnowledgeNode, LearnStore } from '../src/learn/types'
import { GRAPH_KINDS, GRAPH_KIND_LABEL, KIND_RANK, isGraphKind } from '../src/learn/nodeKinds'

function makeNode(id: string, title = id): KnowledgeNode {
  return {
    id,
    title,
    key: title.trim().toLowerCase(),
    description: '',
    docs: { teaching: '' },
    notes: [],
    annotations: [],
    status: 'learning',
    origin: 'user',
    goalId: 'g1',
    createdAt: 1,
    updatedAt: 1,
  }
}

function storeWith(ids: string[], edges: Array<[string, string]> = []): LearnStore {
  const base = emptyLearnStore()
  return {
    ...base,
    nodes: ids.map((id) => makeNode(id)),
    edges: edges.map(([from, to]) => ({ from, to, createdAt: 1 })),
  }
}

/**
 * P0 的两个索引（按 id 取节点、按边取邻接）都挂在**数组引用**上做缓存。
 * 这里钉住的是三件事：结果与原来的线性查找逐项一致、重复 id 仍取第一个、
 * 数组换了之后索引跟着换（不能拿旧缓存骗人）。
 */
describe('P0：图索引', () => {
  describe('nodeById', () => {
    it('结果与线性查找一致', () => {
      const store = storeWith(['a', 'b', 'c'])
      for (const id of ['a', 'b', 'c']) {
        expect(nodeById(store, id)?.id).toBe(store.nodes.find((n) => n.id === id)?.id)
      }
      expect(nodeById(store, 'nope')).toBeUndefined()
    })

    it('重复 id 保留第一个（与原 find 语义一致）', () => {
      const base = emptyLearnStore()
      const first = makeNode('dup', '第一个')
      const second = makeNode('dup', '第二个')
      const store: LearnStore = { ...base, nodes: [first, second] }
      expect(nodeById(store, 'dup')?.title).toBe('第一个')
    })

    it('节点数组换了之后索引跟着换（不会命中旧缓存）', () => {
      const before = storeWith(['a', 'b'])
      expect(nodeById(before, 'b')?.id).toBe('b')

      // store 是不可变的：删节点 = 换一个新数组
      const after: LearnStore = { ...before, nodes: before.nodes.filter((n) => n.id !== 'b') }
      expect(nodeById(after, 'b')).toBeUndefined()
      expect(nodeById(after, 'a')?.id).toBe('a')
      // 旧 store 仍然自洽
      expect(nodeById(before, 'b')?.id).toBe('b')
    })
  })

  describe('prereqIds / parentIds', () => {
    it('两个方向的结果与原来的 filter 逐项一致（含顺序）', () => {
      const store = storeWith(
        ['root', 'a', 'b', 'c'],
        [
          ['root', 'a'],
          ['root', 'b'],
          ['a', 'c'],
        ],
      )
      for (const id of ['root', 'a', 'b', 'c', 'nope']) {
        expect(prereqIds(store, id)).toEqual(
          store.edges.filter((e) => e.from === id).map((e) => e.to),
        )
        expect(parentIds(store, id)).toEqual(store.edges.filter((e) => e.to === id).map((e) => e.from))
      }
    })

    it('边数组换了之后邻接索引跟着换', () => {
      const before = storeWith(['a', 'b'], [['a', 'b']])
      expect(prereqIds(before, 'a')).toEqual(['b'])

      // 直接换一个边数组（绕开 addEdge 的环检测：这里测的是索引，不是规则）
      const after: LearnStore = { ...before, edges: [...before.edges, { from: 'b', to: 'a', createdAt: 2 }] }
      expect(prereqIds(after, 'a')).toEqual(['b'])
      expect(prereqIds(after, 'b')).toEqual(['a'])
      expect(parentIds(after, 'a')).toEqual(['b'])
      // 旧 store 的索引没被污染
      expect(prereqIds(before, 'b')).toEqual([])
    })

    it('返回的是只读缓存：调用方 copy 之后可以随便改，不影响下一次查询', () => {
      const store = storeWith(['a', 'b', 'c'], [
        ['a', 'b'],
        ['a', 'c'],
      ])
      const first = [...prereqIds(store, 'a')].sort().reverse()
      expect(first).toEqual(['c', 'b'])
      expect(prereqIds(store, 'a')).toEqual(['b', 'c'])
    })
  })
})

/**
 * 类型登记表：一种类型一个类文件，`nodeKinds/index.ts` 汇总。
 * 连线规则不再是中央矩阵——能不能连由各类型的 onUpstream / onDownstream 双边协商
 *（见 tests/nodeGraph 的「连接协议」），这里只钉清单与展示表。
 */
describe('P0：类型登记表', () => {
  it('GRAPH_KINDS 就是全部节点类型（全图化重构后的宇宙；视频与项目节点入列）', () => {
    expect(GRAPH_KINDS).toEqual(['entry', 'outline', 'doc', 'note', 'exam', 'superdoc', 'video', 'project'])
  })

  it('同列次序：入口最左、大纲在上、文档居中、叶子在下', () => {
    expect(KIND_RANK.entry).toBeLessThan(KIND_RANK.outline)
    expect(KIND_RANK.outline).toBeLessThan(KIND_RANK.doc)
    expect(KIND_RANK.doc).toBeLessThan(KIND_RANK.note)
    expect(KIND_RANK.note).toBe(KIND_RANK.exam)
    expect(KIND_RANK.exam).toBe(KIND_RANK.superdoc)
    expect(KIND_RANK.superdoc).toBe(KIND_RANK.video)
    expect(KIND_RANK.video).toBe(KIND_RANK.project)
  })

  it('显示名表齐八种（卡片徽标与设置目录共用这一份）', () => {
    expect(Object.keys(GRAPH_KIND_LABEL)).toEqual([...GRAPH_KINDS])
    expect(GRAPH_KIND_LABEL.doc).toBe('文档')
  })

  it('isGraphKind 只认登记过的类型（没登记的读盘时被丢掉）', () => {
    for (const kind of GRAPH_KINDS) expect(isGraphKind(kind)).toBe(true)
    expect(isGraphKind('goal')).toBe(false)
    expect(isGraphKind('flashcard')).toBe(false)
    expect(isGraphKind('')).toBe(false)
    expect(isGraphKind(null)).toBe(false)
  })
})

describe('空壳试卷判定（实体先行的吸收落点）', () => {
  const exam = (id: string, nodeId: string, questions: Exam['questions'], attempts: Exam['attempts'], createdAt = 1): Exam => ({
    id, nodeId, goalId: 'g1', title: id, kind: 'quiz', level: 'easy', minutes: 0,
    questions, attempts, createdAt,
  })

  it('0 题 0 考才算壳；有多份壳时取最新；没壳回 undefined', () => {
    const store = emptyLearnStore()
    const withExams: LearnStore = {
      ...store,
      exams: [
        exam('old-shell', 'n1', [], [], 1),
        exam('real', 'n1', [{ id: 'q', type: 'single', stem: 's', options: [], answer: ['a'], points: 1 }], [], 2),
        exam('new-shell', 'n1', [], [], 3),
        exam('other-node', 'n2', [], [], 4),
      ],
    }
    expect(shellExamOf(withExams, 'n1')?.id).toBe('new-shell')
    expect(shellExamOf(withExams, 'n2')?.id).toBe('other-node')
    expect(shellExamOf(withExams, 'n3')).toBeUndefined()
    // 出过题（有题）或考过（有 attempt）的都不是壳——吸收绝不能覆盖真实数据
    const afterAbsorb: LearnStore = {
      ...store,
      exams: [exam('filled', 'n1', [{ id: 'q', type: 'single', stem: 's', options: [], answer: ['a'], points: 1 }], [], 1)],
    }
    expect(shellExamOf(afterAbsorb, 'n1')).toBeUndefined()
  })
})
