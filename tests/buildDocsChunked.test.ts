/**
 * 摊平的分片版（buildDocsChunked）：守两条规矩。
 *
 * 1. **与同步版逐字节一致**。分片只是把同一段计算切成几片，不能改变它算出来的东西——
 *    它写的是用户的学习数据，差一个字符就是一次白写盘或者一次丢数据。
 *    为了确保比的是「算出来的内容」而不是「缓存命中的结果」，两个 store 用**不同的对象**：
 *    这样 meta 文本缓存对两边都是冷的。
 * 2. **该让出的时候真的让出**。分片的意义就在于此；同时小 store 不该为「没什么可摊」
 *    白付一次让出的开销（每次让出都是一次宏任务，代价不为零）。
 *
 * 做法：把 lib/yieldToMain 换成一个计数桩。真的走 MessageChannel 会让时序变得不确定
 * （和 setTimeout 谁先到不保证），而这里要断言的是「让了几次」，不是「调度顺序」。
 */
import { describe, expect, it, vi } from 'vitest'

const spy = vi.hoisted(() => ({ yields: 0 }))
vi.mock('../src/lib/yieldToMain', () => ({
  yieldToMain: () => {
    spy.yields += 1
    return Promise.resolve()
  },
}))

import { buildDocs, buildDocsChunked } from '../src/learn/files'
import { emptyDocs } from '../src/learn/groups'
import type { DependencyEdge, KnowledgeNode, LearnStore } from '../src/learn/types'

/**
 * 造一份和真实数据同量级的 store：每个节点都带 meta 的全部字段
 * （注解、依赖、笔记、大纲），因为「摊平贵在逐节点 JSON.stringify(…, null, 2)」，
 * 而它的大小由这些字段决定。
 */
function makeStore(count: number): LearnStore {
  const nodes: KnowledgeNode[] = []
  const edges: DependencyEdge[] = []
  const body = 'x'.repeat(2048)
  for (let i = 0; i < count; i++) {
    nodes.push({
      id: `n${i}`,
      title: `节点${i}`,
      key: `k${i}`,
      description: `描述${i}`.repeat(20),
      docs: { teaching: body },
      notes: [{ id: `note-${i}`, name: `笔记${i}`, content: body.slice(0, 400), createdAt: 1, updatedAt: 2 }],
      annotations: [],
      outline: { intro: `导语${i}`, children: [], updatedAt: 1 },
      lastStudiedAt: 1,
      status: 'learning',
      origin: 'ai',
      goalId: 'g1',
      createdAt: 1,
      updatedAt: 2,
    })
    if (i > 0) edges.push({ from: `n${i}`, to: `n${i - 1}`, createdAt: 1 })
  }
  return {
    version: 2,
    nodes,
    edges,
    goals: [{ id: 'g1', rootNodeId: 'n0', question: '这门课', createdAt: 1, updatedAt: 1 }],
    conversations: [],
    exams: [],
    tmp: {},
    resources: {},
    activeGoalId: 'g1',
    activeNodeId: 'n0',
    activeConversationId: null,
    docArea: emptyDocs(),
    drafts: {},
    docScroll: {},
    localFiles: [],
  }
}

describe('摊平的分片版', () => {
  it('与同步版逐字节一致（两个不同的 store 对象，meta 缓存两边都是冷的）', async () => {
    const sync = buildDocs(makeStore(120))
    const chunked = await buildDocsChunked(makeStore(120), 1)
    expect([...chunked].sort()).toEqual([...sync].sort())
    expect(chunked.size, '文件数也要一样').toBe(sync.size)
  })

  it('小 store 一片跑完，不为让出白付一次宏任务', async () => {
    spy.yields = 0
    const files = await buildDocsChunked(makeStore(3), 6)
    expect(files.size).toBeGreaterThan(0)
    expect(spy.yields, '三个节点用不着分片').toBe(0)
  })

  it('大 store 会分片让出主线程', async () => {
    spy.yields = 0
    const files = await buildDocsChunked(makeStore(400), 1)
    expect(files.size).toBeGreaterThan(0)
    expect(spy.yields, '400 个节点的摊平必须被切成多片').toBeGreaterThan(0)
  })
})
