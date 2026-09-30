/**
 * 大纲（outline）与撤回（undo）这两块新机制的测试。
 *
 * - moveNode：换父线的语义与四条硬边界（根 / 跨目标 / 自环 / 已在那儿）；
 * - 大纲的写入校验、与真实节点的对上号（key）、以及 `{节点}.outline.json` 的落盘往返
 *   （落盘往返纪律：新增 store 字段必须 build → parse 一个来回验一遍）；
 * - 撤回：捕获与恢复要和 deleteNode / deleteGoal / deleteNote / removeExam /
 *   removeLocalFile 的级联逐项互逆——少一夹就会在用户手里丢数据。
 */
import { describe, expect, it } from 'vitest'
import type { KnowledgeNode, LearnStore, OutlineEntry } from '../src/learn/types'
import { emptyOutline } from '../src/learn/types'
import { createNodeUnder, deleteNode, deleteNote, moveNode, removeExam, upsertExam } from '../src/learn/graph'
import { normalizeOutline, outlineChildNodeOf, writeOutline } from '../src/learn/outline'
import { buildDocs, nodeDocPath, parseDocs } from '../src/learn/files'
import {
  applyUndo,
  captureExamDelete,
  captureLocalRemove,
  captureNodeDelete,
  captureNoteDelete,
} from '../src/learn/undo'
import { withGoalReading } from '../src/learn/reading'
import { emptyDocs } from '../src/learn/groups'
import { removeLocalFile } from '../src/learn/localfiles'
import { tabKey, tabTitle } from '../src/learn/tabs'

const NOW = 1700000000000

function makeNode(partial: Partial<KnowledgeNode> & { id: string; title: string }): KnowledgeNode {
  return {
    key: partial.title,
    description: '',
    docs: { teaching: partial.title + ' 的正文' },
    notes: [],
    annotations: [],
    status: 'learning',
    origin: 'user',
    goalId: 'g1',
    outline: { ...emptyOutline(), updatedAt: NOW },
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  }
}

/** 一棵三层的目标树 + 全套周边数据（笔记 / 超级文档 / 试卷 / 临时变量 / 两本账），撤回用例的地基 */
function fixture(): LearnStore {
  const readingBook = {
    version: 1,
    sessions: [
      { id: 's1', nodeId: 'n2', doc: 'teaching', day: '2026-01-01', from: NOW, to: NOW + 60_000, activeMs: 60_000, minutes: [], breaks: [], sections: [] },
      { id: 's2', nodeId: 'n3', doc: 'teaching', day: '2026-01-01', from: NOW, to: NOW + 30_000, activeMs: 30_000, minutes: [], breaks: [], sections: [] },
    ],
    nodes: {
      n2: { docs: { teaching: { sections: [], activeMs: 60_000 } }, activeMs: 60_000, firstAt: NOW, lastAt: NOW, opens: 1 },
      n3: { docs: {}, activeMs: 30_000, firstAt: NOW, lastAt: NOW, opens: 1 },
    },
    days: { '2026-01-01': { day: '2026-01-01', activeMs: 90_000, nodes: ['n2', 'n3'], marks: 0 } },
  }
  return {
    version: 2,
    nodes: [
      makeNode({ id: 'n1', title: '微积分', outline: undefined }),
      makeNode({ id: 'n2', title: '极限', notes: [{ name: '笔记', content: '我记的笔记', createdAt: NOW, updatedAt: NOW }] }),
      makeNode({ id: 'n3', title: '夹逼定理' }),
    ],
    edges: [
      { from: 'n1', to: 'n2', createdAt: NOW },
      { from: 'n2', to: 'n3', createdAt: NOW },
    ],
    goals: [{ id: 'g1', rootNodeId: 'n1', question: '弄懂微积分', createdAt: NOW, updatedAt: NOW }],
    conversations: [{ id: 'c1', goalId: 'g1', messages: [], createdAt: NOW, updatedAt: NOW }],
    exams: [],
    tmp: { n3: { k: { value: '中间数据', expiresAt: 0, createdAt: NOW } } },
    resources: {},
    activeGoalId: 'g1',
    activeNodeId: 'n3',
    activeConversationId: 'c1',
    docArea: emptyDocs(),
    drafts: {},
    docScroll: {},
    localFiles: [{ path: 'C:/外部/速查.md', name: '速查.md', openedAt: NOW }],
    reading: { byGoal: { g1: readingBook } },
    checkin: { byGoal: { g1: { version: 1, days: {}, best: 0 } } },
  }
}

describe('moveNode：迁移节点到另一个节点之下', () => {
  it('换父线：旧父边摘掉、新父边挂上', () => {
    const r = moveNode(fixture(), 'n3', 'n1')
    expect(r.moved).toBe(true)
    expect(r.store.edges.some((e) => e.from === 'n1' && e.to === 'n3')).toBe(true)
    expect(r.store.edges.some((e) => e.from === 'n2' && e.to === 'n3')).toBe(false)
  })

  it('目标的根不能移动', () => {
    const r = moveNode(fixture(), 'n1', 'n2')
    expect(r.moved).toBe(false)
    expect(r.message).toContain('总目标')
  })

  it('不能挂到自己的下级之下（成环被拒）', () => {
    const r = moveNode(fixture(), 'n2', 'n3')
    expect(r.moved).toBe(false)
    expect(r.message).toContain('环')
  })

  it('已经在那个父节点之下时不重复动', () => {
    const r = moveNode(fixture(), 'n3', 'n2')
    expect(r.moved).toBe(false)
    expect(r.message).toContain('已经在')
  })

  it('跨目标迁移被拒', () => {
    const s = fixture()
    s.nodes.push(makeNode({ id: 'n4', title: '线性代数', goalId: 'g2' }))
    s.goals.push({ id: 'g2', rootNodeId: 'n4', question: '线性代数', createdAt: NOW, updatedAt: NOW })
    const r = moveNode(s, 'n3', 'n4')
    expect(r.moved).toBe(false)
    expect(r.message).toContain('跨目标')
  })
})

describe('大纲：写入、对上号与落盘往返', () => {
  it('createNodeUnder 建出的节点自带一份空大纲（创建时两份文件同时成形）', () => {
    const r = createNodeUnder(fixture(), 'n2', { title: '洛必达法则' })
    const created = r.store.nodes.find((n) => n.title === '洛必达法则')
    expect(created?.outline).toBeDefined()
    expect(created?.outline?.children).toEqual([])
  })

  it('writeOutline 整份写入，key 由标题生成；同 key 条目只留一份', () => {
    const r = writeOutline(fixture(), 'n2', { intro: '路线', children: [{ title: '子目标甲', summary: '先学' }, { title: '子目标甲', summary: '重复' }] }, NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const node = r.store.nodes.find((n) => n.id === 'n2')
    expect(node?.outline?.children.length).toBe(1)
    expect(node?.outline?.children[0].key).toBe('子目标甲')
  })

  it('导语与子目标全空被拒；children 超过上限被拒', () => {
    expect(writeOutline(fixture(), 'n2', { intro: '', children: [] }, NOW).ok).toBe(false)
    const many = Array.from({ length: 25 }, (_, i) => ({ title: '子目标' + i, summary: '' }))
    expect(writeOutline(fixture(), 'n2', { intro: 'x', children: many }, NOW).ok).toBe(false)
  })

  it('大纲条目与真实节点靠 key 对上号（标题一致即命中）', () => {
    let s = fixture()
    const r = writeOutline(s, 'n2', { intro: '', children: [{ title: '洛必达法则', summary: '先学' }] }, NOW)
    if (!r.ok) throw new Error('writeOutline 应当成功')
    s = r.store
    const entry: OutlineEntry = s.nodes.find((n) => n.id === 'n2')!.outline!.children[0]
    expect(outlineChildNodeOf(s, s.nodes.find((n) => n.id === 'n2')!, entry)).toBeNull()
    s = createNodeUnder(s, 'n2', { title: '洛必达法则' }).store
    const child = outlineChildNodeOf(s, s.nodes.find((n) => n.id === 'n2')!, entry)
    expect(child?.title).toBe('洛必达法则')
  })

  it('落盘往返：{节点}.outline.json 写得出、读得回；老节点没有大纲也不凭空造文件', () => {
    let s = fixture()
    const r = writeOutline(s, 'n2', { intro: '这一层的路线', children: [{ title: '洛必达法则', summary: '先学' }] }, NOW)
    if (!r.ok) throw new Error('writeOutline 应当成功')
    s = r.store
    const files = buildDocs(s)
    expect(files.has('docs/微积分/极限/极限.outline.json')).toBe(true)
    // n1 的 outline 是 undefined（老数据的形状）：不写文件
    expect(files.has('docs/微积分/微积分.outline.json')).toBe(false)

    const back = parseDocs(files, { activeGoalId: 'g1', activeNodeId: 'n1', activeConversationId: 'c1' })
    expect(back).not.toBeNull()
    const n2 = back!.nodes.find((n) => n.id === 'n2')
    expect(n2?.outline?.intro).toBe('这一层的路线')
    expect(n2?.outline?.children[0]).toEqual({ key: '洛必达法则', title: '洛必达法则', summary: '先学' })
    const n1 = back!.nodes.find((n) => n.id === 'n1')
    expect(n1?.outline).toBeUndefined()
  })

  it('normalizeOutline：形状不对的丢掉、key 按标题重算', () => {
    const out = normalizeOutline({
      intro: '导语',
      children: [
        { title: ' 甲 ', summary: '有空格' },
        { title: '', summary: '没有标题' },
        '不是对象',
        { title: '甲', summary: '重复的' },
      ],
    })
    expect(out?.children.length).toBe(1)
    expect(out?.children[0]).toEqual({ key: '甲', title: '甲', summary: '有空格' })
    expect(normalizeOutline({ intro: '' })).toBeNull()
  })

  it('大纲页签的身份：o: 前缀、标题带「· 大纲」', () => {
    const ref = { kind: 'outline', nodeId: 'n2' } as const
    expect(tabKey(ref)).toBe('o:n2')
    expect(tabTitle(ref, (id) => (id === 'n2' ? '极限' : undefined))).toBe('极限 · 大纲')
  })

  it('nodeDocPath 能指到大纲文件（资源管理器里定位用，与教学文档同一套口径）', () => {
    expect(nodeDocPath(fixture(), 'n2', { kind: 'outline' })).toBe('docs/微积分/极限/极限.outline.json')
    expect(nodeDocPath(fixture(), 'n1', { kind: 'outline' })).toBe('docs/微积分/微积分.outline.json')
  })
})

describe('撤回：捕获与恢复和删除级联互逆', () => {
  it('删单个节点：节点、边、试卷、临时变量、阅读账那一片都回来', () => {
    let s = fixture()
    const exam = { id: 'e1', nodeId: 'n3', goalId: 'g1', title: '极限小考', kind: 'quiz' as const, level: 'easy' as const, minutes: 0, questions: [], createdAt: NOW, attempts: [] }
    s = upsertExam(s, exam)
    const entry = captureNodeDelete(s, 'n3')
    expect(entry).not.toBeNull()
    if (!entry) return
    s = deleteNode(s, 'n3')
    expect(s.nodes.some((n) => n.id === 'n3')).toBe(false)
    const r = applyUndo(s, entry)
    expect(r.ok).toBe(true)
    s = r.store
    expect(s.nodes.some((n) => n.id === 'n3')).toBe(true)
    expect(s.edges.some((e) => e.from === 'n2' && e.to === 'n3')).toBe(true)
    expect(s.exams.some((e) => e.id === 'e1')).toBe(true)
    expect(s.tmp.n3?.k.value).toBe('中间数据')
    const book = s.reading!.byGoal.g1
    expect(book.nodes.n3).toBeDefined()
    expect(book.sessions.some((x) => x.id === 's2')).toBe(true)
    expect(book.days['2026-01-01'].nodes).toContain('n3')
  })

  it('撤回不抹掉删除之后别人的新阅读：同一目标其他节点的记录还在', () => {
    let s = fixture()
    const entry = captureNodeDelete(s, 'n3')
    if (!entry) throw new Error('captureNodeDelete 应当成功')
    s = deleteNode(s, 'n3')
    // 删除之后 n2 又读了 5 秒（模拟同一目标里别的节点继续学习）
    s = { ...s, reading: withGoalReading(s.reading, 'g1', { ...s.reading!.byGoal.g1, nodes: { ...s.reading!.byGoal.g1.nodes, n2: { ...s.reading!.byGoal.g1.nodes.n2, activeMs: 65_000 } } }) }
    const r = applyUndo(s, entry)
    const book = r.store.reading!.byGoal.g1
    expect(book.nodes.n2.activeMs).toBe(65_000)
    expect(book.nodes.n3).toBeDefined()
  })

  it('删目标是根：整棵子树、目标、会话、两本账都回来（账是同一份引用）', () => {
    let s = fixture()
    const bookBefore = s.reading!.byGoal.g1
    const entry = captureNodeDelete(s, 'n1')
    if (!entry) throw new Error('captureNodeDelete 应当成功')
    s = deleteNode(s, 'n1')
    expect(s.goals.some((g) => g.id === 'g1')).toBe(false)
    expect(s.conversations.some((c) => c.id === 'c1')).toBe(false)
    const r = applyUndo(s, entry)
    expect(r.ok).toBe(true)
    s = r.store
    expect(s.goals.some((g) => g.id === 'g1')).toBe(true)
    expect(s.nodes.filter((n) => n.goalId === 'g1').length).toBe(3)
    expect(s.conversations.some((c) => c.id === 'c1')).toBe(true)
    expect(s.reading!.byGoal.g1).toBe(bookBefore)
    expect(s.checkin!.byGoal.g1).toBeDefined()
  })

  it('删笔记：正文与那一片阅读记录回来', () => {
    let s = fixture()
    s = { ...s, reading: withGoalReading(s.reading, 'g1', { ...s.reading!.byGoal.g1, nodes: { ...s.reading!.byGoal.g1.nodes, n2: { docs: { 'note:笔记': { sections: [], activeMs: 5_000 } }, activeMs: 60_000, firstAt: NOW, lastAt: NOW, opens: 1 } } }) }
    const entry = captureNoteDelete(s, 'n2', '笔记')
    expect(entry).not.toBeNull()
    if (!entry) return
    s = deleteNote(s, 'n2', '笔记')
    expect(s.nodes.find((n) => n.id === 'n2')?.notes.length).toBe(0)
    const r = applyUndo(s, entry)
    expect(r.ok).toBe(true)
    const node = r.store.nodes.find((n) => n.id === 'n2')
    expect(node?.notes[0]?.content).toBe('我记的笔记')
    expect(r.store.reading!.byGoal.g1.nodes.n2.docs['note:笔记']).toBeDefined()
  })

  it('删试卷与移除本地文件：单条数据原样回来', () => {
    let s = fixture()
    s = upsertExam(s, { id: 'e1', nodeId: 'n3', goalId: 'g1', title: '小考', kind: 'quiz', level: 'easy', minutes: 0, questions: [], createdAt: NOW, attempts: [] })
    const examEntry = captureExamDelete(s, 'e1')
    if (!examEntry) throw new Error('captureExamDelete 应当成功')
    s = removeExam(s, 'e1')
    expect(applyUndo(s, examEntry).store.exams.some((e) => e.id === 'e1')).toBe(true)

    const localEntry = captureLocalRemove(s, 'C:/外部/速查.md')
    if (!localEntry) throw new Error('captureLocalRemove 应当成功')
    s = { ...s, localFiles: removeLocalFile(s.localFiles, 'C:/外部/速查.md') }
    const r = applyUndo(s, localEntry)
    expect(r.store.localFiles.some((f) => f.path === 'C:/外部/速查.md')).toBe(true)
  })

  it('重复撤回有兜底：数据已经在了就明确拒绝，不长出双份', () => {
    const s = fixture()
    const entry = captureNodeDelete(s, 'n3')
    if (!entry) throw new Error('captureNodeDelete 应当成功')
    const r = applyUndo(s, entry)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('已经存在')
  })
})
