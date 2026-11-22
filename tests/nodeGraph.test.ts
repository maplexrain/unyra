import { describe, expect, it } from 'vitest'
import { emptyLearnStore } from '../src/learn/store/empty'
import type { Exam } from '../src/learn/exam'
import type { KnowledgeNode, LearnStore, NoteFile, SuperDocFile } from '../src/learn/types'
import {
  NodeService,
  docIdOfEntryUuid,
  docIdOfOutlineUuid,
  entryUuid,
  locateUuid,
  outlineUuid,
  type NodeCtx,
} from '../src/learn/nodeKinds'

/* ---------- 夹具：一个目标（根 r + 子 a + 挂件） ---------- */

function makeNode(id: string, title: string, goalId = 'g1'): KnowledgeNode {
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
    goalId,
    createdAt: 1,
    updatedAt: 1,
  }
}

function fixture(): LearnStore {
  const base = emptyLearnStore()
  const root = { ...makeNode('r', '微积分'), outline: { intro: '路线', children: [{ key: 'jixian', title: '极限', summary: '' }], updatedAt: 1 } }
  const a = { ...makeNode('a', '极限'), docs: { teaching: '# 极限' } }
  const note: NoteFile = { id: 'note1', name: '错题本', content: '旧内容', createdAt: 1, updatedAt: 1 }
  const sdoc: SuperDocFile = { id: 'sdoc1', name: '实验', html: '<p>hi</p>', createdAt: 1, updatedAt: 1 }
  const exam: Exam = {
    id: 'exam1',
    nodeId: 'a',
    goalId: 'g1',
    title: '极限卷',
    kind: 'quiz',
    level: 'easy',
    minutes: 0,
    questions: [],
    attempts: [],
    createdAt: 1,
  }
  return {
    ...base,
    goals: [{ id: 'g1', rootNodeId: 'r', question: '学微积分', createdAt: 1, updatedAt: 1 }],
    nodes: [
      { ...root, notes: [note], superdocs: [sdoc] },
      a,
    ],
    edges: [
      { from: 'r', to: 'a', createdAt: 1 },
    ],
    exams: [exam],
  }
}

/** 可变 ctx：commit 直接换掉闭包里的 store，让后续断言看到最新值 */
function harness() {
  let store = fixture()
  const deps = {
    getLatest: () => store,
    set: (s: LearnStore) => {
      store = s
    },
    goalId: () => 'g1',
  }
  // objectOf 走真实解析：一个常驻服务按 uuid 还原节点对象（与线上 NodeService 同一套）
  const resolver = new NodeService(deps)
  const ctx: NodeCtx = {
    store: () => store,
    commit: (next) => {
      store = next
    },
    goalId: () => 'g1',
    objectOf: (uuid) => resolver.get(uuid),
  }
  return {
    get store() {
      return store
    },
    ctx,
    service: () => new NodeService(deps),
  }
}

describe('uuid 派发：locateUuid 是「谁在哪」的唯一出口', () => {
  const h = harness()
  const s = h.store

  it('六种 uuid 都认得，且落点类型对得上', () => {
    expect(locateUuid(s, 'a')).toEqual({ kind: 'doc', docId: 'a' })
    expect(locateUuid(s, outlineUuid('a'))).toEqual({ kind: 'outline', docId: 'a' })
    expect(locateUuid(s, entryUuid('r'))).toEqual({ kind: 'entry', docId: 'r' })
    expect(locateUuid(s, 'note1')).toEqual({ kind: 'note', docId: 'r', noteId: 'note1' })
    expect(locateUuid(s, 'sdoc1')).toEqual({ kind: 'superdoc', docId: 'r', sdocId: 'sdoc1' })
    expect(locateUuid(s, 'exam1')).toEqual({ kind: 'exam', docId: 'a', examId: 'exam1' })
  })

  it('不存在的 uuid / 悬空的大纲与入口回 null', () => {
    expect(locateUuid(s, 'nope')).toBeNull()
    // 大纲挂在文档上：文档不在，大纲就不在
    expect(locateUuid(s, outlineUuid('nope'))).toBeNull()
    // 入口挂在目标根上：r 不是任何目标的根时它就不是入口
    expect(locateUuid(s, entryUuid('a'))).toBeNull()
  })

  it('前缀互逆', () => {
    expect(docIdOfOutlineUuid(outlineUuid('x'))).toBe('x')
    expect(docIdOfEntryUuid(entryUuid('x'))).toBe('x')
    expect(docIdOfOutlineUuid('x')).toBeNull()
  })
})

describe('派生关系：树边 + 归属 + 目标绑定，一张图没有第二份真相', () => {
  it('根文档的上游是入口；子文档的上游是父的大纲；挂件与大纲都在下游', () => {
    const h = harness()
    const svc = h.service()
    const root = svc.get('r')!
    const a = svc.get('a')!
    const outline = svc.get(outlineUuid('r'))!
    const note = svc.get('note1')!

    expect(root.relations).toEqual([
      { id: entryUuid('r'), type: 'up' },
      { id: 'a', type: 'down' },
      { id: outlineUuid('r'), type: 'down' },
      { id: 'note1', type: 'down' },
      { id: 'sdoc1', type: 'down' },
    ])
    expect(a.relations).toEqual([{ id: outlineUuid('r'), type: 'up' }, { id: 'exam1', type: 'down' }])
    expect(outline.relations).toEqual([
      { id: 'r', type: 'up' },
      { id: 'a', type: 'down' },
    ])
    expect(note.relations).toEqual([{ id: 'r', type: 'up' }])
  })
})

describe('连接协议：双边协商，唯一的可手工组合是「大纲 → 文档」', () => {
  it('大纲.connect(文档, "down") 落成一条树边；disconnect 摘掉', () => {
    const h = harness()
    const svc = h.service()
    // 先摘掉 r → a，再连回去
    const outline = svc.get(outlineUuid('r'))!
    const a = svc.get('a')!
    expect(outline.disconnect(a)).toMatchObject({ ok: true })
    expect(h.store.edges).toEqual([])
    const r2 = outline.connect(a, 'down')
    expect(r2).toMatchObject({ ok: true })
    expect(h.store.edges).toEqual([{ from: 'r', to: 'a', createdAt: expect.any(Number) }])
  })

  it('文档.connect(大纲, "up") 是同一条边的另一种发起方向', () => {
    const h = harness()
    const svc = h.service()
    const a = svc.get('a')!
    h.store.edges.length = 0
    expect(a.connect(svc.get(outlineUuid('r'))!, 'up')).toMatchObject({ ok: true })
    expect(h.store.edges.map((e) => [e.from, e.to])).toEqual([['r', 'a']])
  })

  it('拒绝都带人话：非节点参数、自连、重复、非法组合', () => {
    const h = harness()
    const svc = h.service()
    const outline = svc.get(outlineUuid('r'))!
    const a = svc.get('a')!
    const note = svc.get('note1')!

    expect(outline.connect('r', 'down')).toMatchObject({ error: expect.stringContaining('节点对象') })
    expect(outline.connect(outline, 'down')).toMatchObject({ error: expect.stringContaining('自己') })
    expect(outline.connect(a, 'down')).toMatchObject({ error: expect.stringContaining('已经连着') })
    // 协议先问接入方（笔记）的上游过滤：拒绝话术来自笔记那一侧
    const r2 = outline.connect(note, 'down')
    expect(r2).toMatchObject({ error: expect.stringContaining('笔记') })
    const r3 = a.connect(svc.get(entryUuid('r'))!, 'up')
    expect(r3).toMatchObject({ error: expect.stringContaining('入口') })
    // 挂件绑定现在是合法连接：文档 ↔ 挂件拖线 = 绑定 / 换绑（内容不动）
    const r4 = a.connect(note, 'down')
    expect(r4).toMatchObject({ ok: true })
    expect(h.store.nodes[0].notes).toEqual([])
    expect(h.store.nodes[1].notes.map((n) => n.name)).toEqual(['错题本'])
    // 已经在这份文档名下的再连一次 = 拒绝（重复连接）
    const r5 = a.connect(svc.get('note1')!, 'down')
    expect(r5).toMatchObject({ error: expect.stringContaining('已经连着') })
  })

  it('成环的挂法被拒（孙辈不能反过来当父辈）', () => {
    const h = harness()
    const svc = h.service()
    const aOutline = svc.get(outlineUuid('a'))!
    const root = svc.get('r')!
    // a 的大纲想把 r 挂到下面：r → a 已存在，这条边会成环
    const r2 = aOutline.connect(root, 'down')
    expect(r2).toMatchObject({ error: expect.stringContaining('环') })
    expect(h.store.edges).toEqual([{ from: 'r', to: 'a', createdAt: 1 }])
  })
})

describe('editContent：整份替换，各类型自己校验', () => {
  it('文档：缺字段被拦（等于清空的写法不许），改名撞重名被拦，正常写回带人话回执', () => {
    const h = harness()
    const svc = h.service()
    const a = svc.get('a')!

    expect(a.editContent({ title: '极限' })).toMatchObject({ error: expect.stringContaining('description') })
    // teaching 给空串是合法的（清空正文）；「缺字段」才被拦
    expect(a.editContent({ title: '极限', description: '', teaching: '' })).toMatchObject({ ok: true })
    expect(a.editContent({ title: '微积分', description: 'd', teaching: '' })).toMatchObject({ error: expect.stringContaining('微积分') })
    expect(
      a.editContent({ title: '极限', description: '数列与函数极限', teaching: '# 极限\n\n正文', status: 'learning' }),
    ).toMatchObject({ ok: true })
    const node = h.store.nodes.find((n) => n.id === 'a')!
    expect(node.docs.teaching).toBe('# 极限\n\n正文')
    expect(node.description).toBe('数列与函数极限')
  })

  it('笔记：text 必给；带 title 走改名级联（页签键跟着换）', () => {
    const h = harness()
    const svc = h.service()
    const note = svc.get('note1')!
    expect(note.editContent({ title: '错题本' })).toMatchObject({ error: expect.stringContaining('text') })
    expect(note.editContent({ text: '新内容' })).toMatchObject({ ok: true })
    expect(h.store.nodes[0].notes[0].content).toBe('新内容')
    expect(note.editContent({ title: '整理本', text: '新内容' })).toMatchObject({ ok: true })
    expect(h.store.nodes[0].notes[0].name).toBe('整理本')
    // uuid 不随改名变：身份稳住，坐标 / 页签 / agent 句柄都不用动
    expect(h.store.nodes[0].notes[0].id).toBe('note1')
  })

  it('大纲：走 writeOutline 的校验（一层、最多 24 条、key 自动）', () => {
    const h = harness()
    const svc = h.service()
    const outline = svc.get(outlineUuid('r'))!
    expect(outline.editContent({ intro: '', children: [] })).toMatchObject({ error: expect.stringContaining('都是空') })
    expect(outline.editContent('不是 json 的字符串{')).toMatchObject({ error: expect.stringContaining('JSON') })
    expect(outline.editContent({ intro: '先补前置', children: [{ title: '夹逼', summary: '两边界' }] })).toMatchObject({ ok: true })
    // 整份覆盖：children 就是新写的那份
    expect(h.store.nodes[0].outline?.children).toEqual([{ key: '夹逼', title: '夹逼', summary: '两边界' }])
  })

  it('试卷：题目格式由 parseQuestions 校验，attempts 原样保留', () => {
    const h = harness()
    const svc = h.service()
    const exam = svc.get('exam1')!
    expect(exam.editContent({ questions: '不是数组' })).toMatchObject({ error: expect.stringContaining('题') })
    const r2 = exam.editContent({
      title: '极限 · 小测',
      kind: 'quiz',
      level: 'easy',
      minutes: 0,
      questions: [
        {
          type: 'single',
          stem: '夹逼定理需要几个边界函数？',
          options: [
            { id: 'A', text: '1 个' },
            { id: 'B', text: '2 个' },
          ],
          answer: ['B'],
          points: 1,
        },
      ],
    })
    expect(r2).toMatchObject({ ok: true })
    expect(h.store.exams[0].questions).toHaveLength(1)
    expect(h.store.exams[0].title).toBe('极限 · 小测')
  })

  it('超级文档：空 html 与超长被拦；改名被拒（名字是身份的一半）', () => {
    const h = harness()
    const svc = h.service()
    const sdoc = svc.get('sdoc1')!
    expect(sdoc.editContent({ html: '   ' })).toMatchObject({ error: expect.stringContaining('为空') })
    expect(sdoc.editContent({ html: 'x'.repeat(200_000) })).toMatchObject({ error: expect.stringContaining('最长') })
    expect(sdoc.editContent({ title: '新名字', html: '<p/>' })).toMatchObject({ error: expect.stringContaining('只读') })
    // 保留原名（或省略 title）不受影响：只读的是『改名』这件事
    expect(sdoc.editContent({ title: '实验', html: '<p/>' })).toMatchObject({ ok: true })
    expect(sdoc.editContent({ html: '<p>新的</p>' })).toMatchObject({ ok: true })
    expect(h.store.nodes[0].superdocs?.[0].html).toBe('<p>新的</p>')
  })

  it('入口：没有内容，editContent 直接拒', () => {
    const h = harness()
    const entry = h.service().get(entryUuid('r'))!
    expect(entry.editContent({})).toMatchObject({ error: expect.stringContaining('入口') })
  })
})

describe('help()：动态自述（随状态与上游变化）', () => {
  it('空卷讲出题、有题讲改卷；三段齐全', () => {
    const h = harness()
    const svc = h.service()
    const emptyExam = svc.get('exam1')!
    const before = emptyExam.help()
    expect(before).toHaveProperty('description')
    expect(before.edit).toContain('空卷')
    expect(before.edit).toContain('questions')

    emptyExam.editContent({
      title: '极限卷',
      kind: 'quiz',
      level: 'easy',
      minutes: 0,
      questions: [
        { type: 'truefalse', stem: '1+1=2', options: [{ id: 'true', text: '对' }, { id: 'false', text: '错' }], answer: ['true'], points: 1 },
      ],
    })
    const after = (h.service().get('exam1') as { help(): { edit: string } }).help()
    expect(after.edit).toContain('历次作答')
  })

  it('空文档与有正文的文档说的不是同一句话', () => {
    const h = harness()
    const svc = h.service()
    const a = svc.get('a')! as unknown as { help(): { description: string } }
    expect(a.help().description).toContain('正文')
    const root = svc.get('r') as unknown as { help(): { description: string } }
    expect(root.help().description).toContain('根文档')
  })
})

describe('NodeService：create / get / list / delete（画布与 agent 同一条通道）', () => {
  it('建文档挂在大纲之下（under 认大纲 uuid 与文档 uuid 两种写法）；同名复用不另建', () => {
    const h = harness()
    const svc = h.service()
    const r1 = svc.create({ kind: 'doc', title: '导数', under: outlineUuid('r') })
    expect(r1).toMatchObject({ ok: true, created: true })
    if (!('uuid' in r1)) throw new Error('unreachable')
    expect(h.store.edges.some((e) => e.from === 'r' && e.to === r1.uuid)).toBe(true)

    const r2 = svc.create({ kind: 'doc', title: '导数', under: 'r' })
    expect(r2).toMatchObject({ ok: true, created: false })
    expect(h.store.nodes.filter((n) => n.title === '导数')).toHaveLength(1)
  })

  it('挂件建在文档之下；试卷遇到空壳原位复用', () => {
    const h = harness()
    const svc = h.service()
    const note = svc.create({ kind: 'note', title: '灵感', under: 'a' })
    expect(note).toMatchObject({ ok: true })
    if ('uuid' in note) expect(locateUuid(h.store, note.uuid)).toMatchObject({ kind: 'note', docId: 'a' })

    // exam1 是 0 题 0 考的壳：create 复用它而不是再建一份
    const exam = svc.create({ kind: 'exam', under: 'a' })
    expect(exam).toMatchObject({ ok: true, created: false })
    if ('uuid' in exam) expect(exam.uuid).toBe('exam1')
    expect(h.store.exams).toHaveLength(1)
  })

  it('大纲与入口不能 create（一个随文档存在、一个随目标绑定）', () => {
    const h = harness()
    const svc = h.service()
    expect(svc.create({ kind: 'outline', under: 'r' })).toMatchObject({ error: expect.stringContaining('已经有一份大纲') })
    expect(svc.create({ kind: 'entry', under: 'r' })).toMatchObject({ error: expect.stringContaining('目标') })
  })

  it('list() 给出全图清单：uuid、path、上游、挂件都在', () => {
    const h = harness()
    const list = h.service().list() as Record<string, unknown>
    const nodes = list.nodes as Array<Record<string, unknown>>
    expect(list.goal).toMatchObject({ entry: entryUuid('r'), root: 'r' })
    const aRow = nodes.find((n) => n.uuid === 'a')
    expect(aRow).toMatchObject({ title: '极限', path: '微积分/极限' })
    expect(aRow?.upstreams).toEqual([outlineUuid('r')])
    const rRow = nodes.find((n) => n.uuid === 'r')
    expect(rRow?.notes).toEqual([{ uuid: 'note1', title: '错题本', chars: 3 }])
    expect(aRow?.exams).toEqual([{ uuid: 'exam1', title: '极限卷', questions: 0, attempts: 0 }])
  })

  it('delete：删谁只删谁——挂件只删自己；文档只删自己；大纲删除=清空计划；试卷指去 exam.delete；入口拒删', () => {
    const h = harness()
    const svc = h.service()
    expect(svc.delete('note1')).toMatchObject({ ok: true })
    expect(h.store.nodes[0].notes).toEqual([])
    expect(h.store.nodes.some((n) => n.id === 'a')).toBe(true)

    expect(svc.delete('exam1')).toMatchObject({ error: expect.stringContaining('exam.delete') })
    expect(svc.delete(entryUuid('r'))).toMatchObject({ error: expect.stringContaining('目标') })

    // 删大纲 = 清空计划：宿主文档、树边、下级文档都原样保留（先给 a 写一份大纲）
    expect(svc.get(outlineUuid('a'))!.editContent({ intro: '', children: [{ title: '洛必达', summary: '' }] })).toMatchObject({ ok: true })
    expect(svc.delete(outlineUuid('a'))).toMatchObject({ ok: true })
    expect(h.store.nodes[1].outline).toBeUndefined()
    expect(h.store.nodes[0].outline).toBeTruthy()
    expect(h.store.nodes.some((n) => n.id === 'a')).toBe(true)
    expect(h.store.edges.some((e) => e.from === 'r' && e.to === 'a')).toBe(true)

    // 给 a 挂一份笔记，然后删 a：试卷原地悬空（宿主 id 指向已删的 a，绑定解除）、
    // 笔记进游离池——都是独立实体，等用户拖线再绑或单独删
    expect(svc.create({ kind: 'note', under: 'a', title: '随手记' })).toMatchObject({ ok: true })
    const r2 = svc.delete('a')
    expect(r2).toMatchObject({ ok: true })
    expect(h.store.nodes.some((n) => n.id === 'a')).toBe(false)
    expect(h.store.exams.map((e) => e.id)).toEqual(['exam1'])
    expect(h.store.exams[0].nodeId).toBe('a')
    expect(h.store.detached?.g1?.notes.map((n) => n.name) ?? []).toEqual(['随手记'])
    expect(h.store.nodes[0].superdocs).toHaveLength(1)
  })

  it('delete：文档删除不再连坐下游——下游断线成游离（用户定的：节点独立、关系可解除）', () => {
    const h = harness()
    const b = { ...makeNode('b', '洛必达'), docs: { teaching: '' } }
    h.ctx.commit({
      ...h.store,
      nodes: [...h.store.nodes, b],
      edges: [...h.store.edges, { from: 'a', to: 'b', createdAt: 1 }],
    })
    const r = h.service().delete('a')
    expect(r).toMatchObject({ ok: true })
    // a 没了，b 还在——只是那条父子线摘掉了
    expect(h.store.nodes.some((n) => n.id === 'a')).toBe(false)
    expect(h.store.nodes.some((n) => n.id === 'b')).toBe(true)
    expect(h.store.edges.some((e) => e.to === 'b')).toBe(false)
  })

  it('disconnect：文档 ↔ 它自己的大纲摘线 = 删除大纲；大纲 → 子文档摘线 = 拆那条树边（都不删节点）', () => {
    const h = harness()
    const b = { ...makeNode('b', '洛必达'), docs: { teaching: '' } }
    h.ctx.commit({
      ...h.store,
      nodes: [...h.store.nodes, b],
      edges: [...h.store.edges, { from: 'a', to: 'b', createdAt: 1 }],
    })
    const svc = h.service()
    const doc = svc.get('a')
    const outline = svc.get(outlineUuid('a'))
    expect(doc && outline).toBeTruthy()
    // a 还没写过大纲：先写一份（大纲节点的 editContent）
    expect(outline!.editContent({ intro: '', children: [{ title: '洛必达', summary: '' }] })).toMatchObject({ ok: true })
    expect(h.store.nodes[1].outline).toBeTruthy()

    // 大纲侧摘：大纲.disconnect(宿主文档) → 计划清空，文档与树边不动
    expect(outline!.disconnect(doc)).toMatchObject({ ok: true })
    expect(h.store.nodes[1].outline).toBeUndefined()
    expect(h.store.edges.some((e) => e.from === 'r' && e.to === 'a')).toBe(true)

    // 文档侧摘：doc.disconnect(大纲对象) → 同一个语义
    expect(outline!.editContent({ intro: '', children: [{ title: '洛必达', summary: '' }] })).toMatchObject({ ok: true })
    expect(doc!.disconnect(outline)).toMatchObject({ ok: true })
    expect(h.store.nodes[1].outline).toBeUndefined()

    // 大纲 → 子文档：拆一条树边，子文档成游离（不删除）
    expect(outline!.disconnect(svc.get('b'))).toMatchObject({ ok: true })
    expect(h.store.edges.some((e) => e.from === 'a' && e.to === 'b')).toBe(false)
    expect(h.store.nodes.some((n) => n.id === 'b')).toBe(true)
  })
})

describe('固定接口：ports 派生 / portKey 认领 / getPortData 拉取', () => {
  it('大纲的 ports 就是它的目标项清单（从内容派生，不落第二份状态）', () => {
    const h = harness()
    const outline = h.service().get(outlineUuid('r'))
    expect(outline!.ports).toEqual([{ key: 'jixian', label: '极限', data: { summary: '' } }])
    // 文档与挂件不声明接口
    expect(h.service().get('r')!.ports).toEqual([])
    expect(h.service().get('a')!.ports).toEqual([])
  })

  it('create 带 portKey = 创建即认领；getPortData 拉到整条（含 key / label / data）', () => {
    const h = harness()
    const r = h.service().create({ kind: 'doc', title: '极限初步', under: 'r', portKey: 'jixian' })
    expect(r).toMatchObject({ ok: true })
    const doc = h.service().get('uuid' in r ? r.uuid : '')
    expect(doc!.relations).toContainEqual({ id: outlineUuid('r'), type: 'up', portKey: 'jixian' })
    expect(doc!.getPortData()).toEqual([{ key: 'jixian', label: '极限', data: { summary: '' } }])
  })

  it('connect 第三参认领：两种发起方向都行；一个接口只认领一个下游', () => {
    const h = harness()
    const svc = h.service()
    const outline = svc.get(outlineUuid('r'))
    const d1 = svc.create({ kind: 'doc', title: '第一份' })
    const d2 = svc.create({ kind: 'doc', title: '第二份' })
    expect('uuid' in d1 && 'uuid' in d2).toBe(true)
    const doc1 = svc.get('uuid' in d1 ? d1.uuid : '')
    const doc2 = svc.get('uuid' in d2 ? d2.uuid : '')
    // 文档侧发起
    expect(doc1!.connect(outline, 'up', 'jixian')).toMatchObject({ ok: true })
    // 大纲侧发起：同一接口已被占 → 人话拒绝（点名占用的那份文档）
    const refused = doc2!.connect(outline, 'up', 'jixian')
    expect(refused).toMatchObject({ error: expect.stringContaining('一个接口只认领一个下游') })
    expect(refused).toMatchObject({ error: expect.stringContaining('第一份') })
    // 不存在的接口：报出可认领清单
    expect(doc2!.connect(outline, 'up', 'nope')).toMatchObject({
      error: expect.stringContaining('jixian（极限）'),
    })
    // 没声明接口的上游（空大纲一条目标项都没有）：portKey 无处认领
    const empty = svc.create({ kind: 'outline', title: '空层' })
    expect('uuid' in empty).toBe(true)
    expect(doc2!.connect(svc.get('uuid' in empty ? empty.uuid : ''), 'up', 'jixian')).toMatchObject({
      error: expect.stringContaining('没有声明任何接口'),
    })
  })

  it('create 的 portKey 校验：没有大纲 / key 不存在都报出可认领清单', () => {
    const h = harness()
    expect(h.service().create({ kind: 'doc', title: 'X', under: 'a', portKey: 'jixian' })).toMatchObject({
      error: expect.stringContaining('还没有大纲'),
    })
    expect(h.service().create({ kind: 'doc', title: 'X', under: 'r', portKey: 'nope' })).toMatchObject({
      error: expect.stringContaining('jixian（极限）'),
    })
  })

  it('剪线 = 认领解除：接口空出来，原文档 getPortData 归零', () => {
    const h = harness()
    const svc = h.service()
    const r = svc.create({ kind: 'doc', title: '极限初步', under: 'r', portKey: 'jixian' })
    const doc = svc.get('uuid' in r ? r.uuid : '')
    const outline = svc.get(outlineUuid('r'))
    expect(doc!.getPortData()).toHaveLength(1)
    expect(outline!.disconnect(doc)).toMatchObject({ ok: true })
    expect(doc!.getPortData()).toEqual([])
    // 剪掉的是整条边：上游关系彻底消失（下游侧的认领随边存在，也随边消失）
    expect(doc!.relations.some((r) => r.type === 'up')).toBe(false)
    // 空出来了：别的文档现在认领得到
    const d2 = svc.create({ kind: 'doc', title: '另一份' })
    expect(svc.get('uuid' in d2 ? d2.uuid : '')!.connect(outline, 'up', 'jixian')).toMatchObject({ ok: true })
  })

  it('带 portKey 重连已连着的对 = 改认领（换口）；不带 portKey 照旧拒绝', () => {
    const h = harness()
    const svc = h.service()
    const r = svc.create({ kind: 'doc', title: '第一份', under: 'r', portKey: 'jixian' })
    const doc = svc.get('uuid' in r ? r.uuid : '')
    const outline = svc.get(outlineUuid('r'))
    expect(doc && outline).toBeTruthy()
    // 重写大纲：两条目标项（key 由标题生成，中文原样保留）
    expect(outline!.editContent({ intro: '', children: [{ title: '极限', summary: '' }, { title: '连续', summary: '' }] })).toMatchObject({ ok: true })
    // 换口：从「极限」改认领「连续」
    expect(doc!.connect(outline, 'up', '连续')).toMatchObject({ ok: true, note: expect.stringContaining('改认领') })
    expect(doc!.relations).toContainEqual({ id: outlineUuid('r'), type: 'up', portKey: '连续' })
    expect(h.store.edges.find((e) => e.from === 'r' && e.to === doc!.uuid)?.portKey).toBe('连续')
    // 同口重连 = 无变化；不带 portKey 重连 = 照旧拒绝
    expect(doc!.connect(outline, 'up', '连续')).toMatchObject({ ok: true, note: expect.stringContaining('没有变化') })
    expect(doc!.connect(outline, 'up')).toMatchObject({ error: expect.stringContaining('已经连着') })
  })

  it('大纲重写后 ports 跟着变；认领的 key 没了就静默缺席（内容不因关系损坏）', () => {
    const h = harness()
    const svc = h.service()
    const r = svc.create({ kind: 'doc', title: '极限初步', under: 'r', portKey: 'jixian' })
    const doc = svc.get('uuid' in r ? r.uuid : '')
    const outline = svc.get(outlineUuid('r'))
    expect(outline!.editContent({ intro: '', children: [{ title: '连续', summary: 'ε-δ' }] })).toMatchObject({ ok: true })
    expect(outline!.ports).toEqual([{ key: '连续', label: '连续', data: { summary: 'ε-δ' } }])
    expect(doc!.getPortData()).toEqual([])
  })
})
