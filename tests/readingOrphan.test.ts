/**
 * 删节点之后，它的有效阅读记录必须一起消失（**空索引**）。
 *
 * 症状不是「少记了一点」，而是界面上的一行坏数据：记录全按 nodeId 索引，节点一删，
 * 今日阅读面板就会列出一行标题是 uuid、点不动的条目（见 LearnWorkspace 的 ReadingDock），
 * agent 的 reading.list 也照报。规矩因此定成「检测到空索引，就连带那条记录一起删」。
 *
 * 三条路都要管：
 * 1. 删除的那一刻（learn/graph）——这条是根治；
 * 2. 读盘的那一刻（learn/store）——旧数据里已经躺着的空索引，靠它清干净；
 * 3. 删完那一刻采集器的最后一次结算（LearnWorkspace 的 onReading 守卫）——
 *    那一条在组件里，node 环境测不到，见那边的注释。
 */
import { describe, expect, it } from 'vitest'

import { deleteGoal, deleteNode, deleteNote, renameNoteFile } from '../src/learn/graph'
import { removeSuperDoc } from '../src/learn/superdocs'
import { emptyDocs } from '../src/learn/groups'
import { parseLearnStore } from '../src/learn/store'
import {
  applyReadingDelta,
  emptyReading,
  normalizeReadingBook,
  pruneReading,
  type ReadingDelta,
  type ReadingStore,
} from '../src/learn/reading'
import type { KnowledgeNode, LearnStore, NoteFile } from '../src/learn/types'

const DAY = '2026-09-20'
const at = new Date(2026, 8, 20, 10, 0).getTime()

function delta(over: Partial<ReadingDelta> = {}): ReadingDelta {
  return {
    sessionId: 's1',
    nodeId: 'n1',
    doc: 'teaching',
    day: DAY,
    at,
    activeMs: 60_000,
    minuteIndex: 0,
    minutes: [{ ms: 60_000, chars: 400, marks: 0, gaps: 0 }],
    breaks: [],
    sections: [],
    ...over,
  }
}

/** 每个 id 各记一场一分钟的阅读 */
function readingWith(ids: string[]): ReadingStore {
  let out = emptyReading()
  for (const id of ids) out = applyReadingDelta(out, delta({ nodeId: id, sessionId: 's-' + id }))
  return out
}

/** 同一个节点下，每份文档各记一场一分钟的阅读 */
function readingDocs(nodeId: string, docs: string[]): ReadingStore {
  let out = emptyReading()
  for (const doc of docs) out = applyReadingDelta(out, delta({ nodeId, doc, sessionId: 's-' + doc }))
  return out
}

const note = (name: string): NoteFile => ({ name, content: '', createdAt: at, updatedAt: at })

function node(id: string, goalId = 'g1'): KnowledgeNode {
  return {
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
    learning: { lastStudiedAt: at, visits: 1 },
  }
}

function storeWith(ids: string[], reading?: ReadingStore): LearnStore {
  return {
    version: 2,
    nodes: ids.map((id) => node(id)),
    // 根是最上面那个，其余都挂在它下面（deleteGoal 就是沿这条链收回整棵树）
    edges: ids.slice(1).map((id) => ({ from: ids[0], to: id, createdAt: 0 })),
    goals: [{ id: 'g1', rootNodeId: ids[0], question: '微积分', createdAt: 0, updatedAt: 0 }],
    conversations: [],
    exams: [],
    tmp: {},
    resources: {},
    activeGoalId: 'g1',
    activeNodeId: ids[0],
    activeConversationId: null,
    // 文档区：一组、没有页签（分割与分组见 learn/groups）
    docArea: emptyDocs(),
    drafts: {},
    docScroll: {},
    localFiles: [],
    ...(reading ? { reading: { byGoal: { g1: reading } } } : {}),
  }
}

describe('空索引：节点没了，它的阅读记录也一起删', () => {
  it('三个索引一起清：节点汇总、明细会话、学习日里的节点清单', () => {
    const before = readingWith(['n1', 'gone'])
    const after = pruneReading(before, new Set(['n1']))
    expect(Object.keys(after.nodes)).toEqual(['n1'])
    expect(after.sessions.map((s) => s.nodeId)).toEqual(['n1'])
    expect(after.days[DAY].nodes).toEqual(['n1'])
    // 学习日的总时长与印记是「今天读了多久」的账，不因为删了个节点而缩水
    expect(after.days[DAY].activeMs).toBe(before.days[DAY].activeMs)
  })

  it('没有空索引时原样返回：调用方靠对象身份就能知道这次什么都没清', () => {
    const before = readingWith(['n1'])
    expect(pruneReading(before, new Set(['n1']))).toBe(before)
  })

  it('删节点：连它的阅读记录一起删，别的节点不受影响', () => {
    const store = storeWith(['n1', 'n2'], readingWith(['n1', 'n2']))
    const after = deleteNode(store, 'n2')
    expect(after.nodes.map((n) => n.id)).toEqual(['n1'])
    expect(Object.keys(after.reading?.byGoal.g1?.nodes ?? {})).toEqual(['n1'])
    expect(after.reading?.byGoal.g1?.days[DAY].nodes).toEqual(['n1'])
  })

  it('删目标：整棵子树的记录一起删', () => {
    const store = storeWith(['n1', 'n2', 'n3'], readingWith(['n1', 'n2', 'n3']))
    const after = deleteGoal(store, 'g1')
    expect(after.nodes).toEqual([])
    // 目标没了，它那一整本账跟着没了（见 learn/reading 的 ReadingBook）
    expect(after.reading?.byGoal.g1).toBeUndefined()
  })

  it('本来就没有阅读记录时不凭空造一个空壳', () => {
    const after = deleteNode(storeWith(['n1', 'n2']), 'n2')
    expect('reading' in after).toBe(false)
  })

  it('删笔记：那一份文档的记录清掉，节点自己的时长留着', () => {
    const base = storeWith(['n1'], readingDocs('n1', ['teaching', 'note:笔记']))
    const store: LearnStore = { ...base, nodes: [{ ...base.nodes[0], notes: [note('笔记')] }] }
    const after = deleteNote(store, 'n1', '笔记')
    expect(Object.keys(after.reading?.byGoal.g1?.nodes.n1.docs ?? {})).toEqual(['teaching'])
    // 节点那条记录不动：那两分钟是这个节点上的真实经历，不因为删了一份笔记就不算数
    expect(after.reading?.byGoal.g1?.nodes.n1.activeMs).toBe(120_000)
  })

  it('笔记改名：记录跟着搬到新名字下（搬，不是删）', () => {
    const base = storeWith(['n1'], readingDocs('n1', ['teaching', 'note:笔记']))
    const store: LearnStore = { ...base, nodes: [{ ...base.nodes[0], notes: [note('笔记')] }] }
    const r = renameNoteFile(store, 'n1', '笔记', '笔记二')
    expect(r.name).toBe('笔记二')
    expect(Object.keys(r.store.reading?.byGoal.g1?.nodes.n1.docs ?? {}).sort()).toEqual(['note:笔记二', 'teaching'])
    // 记的是同一份文档：时长跟着走（这份夹具里没有分节，时长就是全部）
    expect(r.store.reading?.byGoal.g1?.nodes.n1.docs['note:笔记二'].activeMs).toBe(60_000)
    // 旧名字下不再留东西
    expect(r.store.reading?.byGoal.g1?.nodes.n1.docs['note:笔记']).toBeUndefined()
  })

  it('删超级文档：sdoc:名字 那一份记录清掉', () => {
    const base = storeWith(['n1'], readingDocs('n1', ['teaching', 'sdoc:交互文档']))
    const store: LearnStore = {
      ...base,
      nodes: [{ ...base.nodes[0], superdocs: [{ name: '交互文档', html: '<p>x</p>', createdAt: at, updatedAt: at }] }],
    }
    const after = removeSuperDoc(store, 'n1', '交互文档')
    expect(Object.keys(after.reading?.byGoal.g1?.nodes.n1.docs ?? {})).toEqual(['teaching'])
  })

  it('读回账本时：目标没了的整本丢掉，节点没了的记录清掉（空索引不留）', () => {
    // 真实的那份文件就是这样来的：目标被删了、节点被删了，账本里那条记录却还留着
    const book = normalizeReadingBook(
      { byGoal: { g1: readingWith(['n1', 'gone']), g2: readingWith(['x']) } },
      new Set(['n1']),
      new Set(['g1']),
    )
    expect(Object.keys(book.byGoal)).toEqual(['g1'])
    expect(Object.keys(book.byGoal.g1.nodes)).toEqual(['n1'])
    expect(book.byGoal.g1.sessions.map((s) => s.nodeId)).toEqual(['n1'])
    expect(book.byGoal.g1.days[DAY].nodes).toEqual(['n1'])
  })

  it('旧 state.json 里那份用户级阅读记录**不再被读**（改口径不迁移，见 files 的说明）', () => {
    const back = parseLearnStore(
      JSON.stringify({
        version: 2,
        nodes: [node('n1')],
        edges: [],
        goals: [{ id: 'g1', rootNodeId: 'n1', question: '微积分', createdAt: 0, updatedAt: 0 }],
        conversations: [],
        // 从前它是存在这儿的：现在按目标存在 {目标}/reading.json 里，这一份直接丢掉
        reading: readingWith(['n1']),
      }),
    )
    expect(back).not.toBeNull()
    expect(back?.reading?.byGoal).toEqual({})
  })
})
