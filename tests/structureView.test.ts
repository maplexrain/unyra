import { describe, expect, it } from 'vitest'
import { emptyLearnStore } from '../src/learn/store/empty'
import type { LearnStore, NoteFile, SuperDocFile } from '../src/learn/types'
import type { Exam } from '../src/learn/exam'
import { entryUuid, outlineUuid } from '../src/learn/nodeKinds'
import { CARD_H, CARD_W, COL_GAP, emptyStructure, type StructureMap } from '../src/learn/structure'
import { deriveCanvas, edgeElbow, edgePathD } from '../src/components/learn/structure/structureView'
import { getTourMockCanvas, getTourCamera } from '../src/components/learn/structure/tourMockData'

/* ---------- 夹具：一个目标（根 + 子文档 + 挂件） ---------- */

function makeStore(): LearnStore {
  const base = emptyLearnStore()
  const note: NoteFile = { id: 'note1', name: '错题本', content: '第一题', createdAt: 1, updatedAt: 1 }
  const sdoc: SuperDocFile = { id: 'sdoc1', name: '实验', html: '', createdAt: 1, updatedAt: 1 }
  const exam: Exam = {
    id: 'exam1', nodeId: 'a', goalId: 'g1', title: '小测', kind: 'quiz', level: 'easy', minutes: 0,
    questions: [], attempts: [], createdAt: 1,
  }
  return {
    ...base,
    goals: [{ id: 'g1', rootNodeId: 'r', question: '学微积分', createdAt: 1, updatedAt: 1 }],
    nodes: [
      {
        id: 'r',
        title: '微积分',
        key: 'weijifen',
        description: '',
        docs: { teaching: '# 微积分' },
        notes: [note],
        superdocs: [sdoc],
        outline: { intro: '', children: [{ key: 'jixian', title: '极限', summary: '' }], updatedAt: 1 },
        annotations: [],
        status: 'learning',
        origin: 'user',
        goalId: 'g1',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'a',
        title: '极限',
        key: 'jixian',
        description: '',
        docs: { teaching: '' },
        notes: [],
        annotations: [],
        status: 'learning',
        origin: 'user',
        goalId: 'g1',
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    edges: [{ from: 'r', to: 'a', createdAt: 1 }],
    exams: [exam],
  }
}

describe('deriveCanvas：卡片就是节点、连线全部派生', () => {
  it('每份实体一张卡：入口不再是独立的卡——根文档带 entry 徽章；uuid 直接对上实体', () => {
    const view = deriveCanvas(makeStore(), 'g1', undefined)
    const kinds = Object.fromEntries(view.cards.map((c) => [c.uuid, c.kind]))
    expect(kinds[entryUuid('r')]).toBeUndefined()
    expect(kinds['r']).toBe('doc')
    expect(kinds[outlineUuid('r')]).toBe('outline')
    // 子文档 a 没有大纲实体：它的大纲卡不上画布
    expect(kinds[outlineUuid('a')]).toBeUndefined()
    expect(kinds['note1']).toBe('note')
    expect(kinds['sdoc1']).toBe('superdoc')
    expect(kinds['exam1']).toBe('exam')
    // 根 + 根的大纲 + 子文档 + 笔记 + 超级文档 + 试卷 = 6
    expect(view.cards).toHaveLength(6)
    // 入口徽章挂在根文档身上，一张图有且只有一个
    const byUuid = Object.fromEntries(view.cards.map((c) => [c.uuid, c]))
    expect(byUuid['r'].entry).toBe(true)
    expect(view.cards.filter((c) => c.entry).length).toBe(1)
  })

  it('连线全派生：大纲→子文档（树边）、文档→大纲与挂件（归属）；入口不再是线的一端', () => {
    const view = deriveCanvas(makeStore(), 'g1', undefined)
    const keys = view.edges.map((e) => `${e.from}>${e.to}`)
    expect(keys).not.toContain(`${entryUuid('r')}>r`)
    expect(keys).toContain(`${outlineUuid('r')}>a`)
    expect(keys).toContain(`r>${outlineUuid('r')}`)
    expect(keys).toContain('r>note1')
    expect(keys).toContain('r>sdoc1')
    expect(keys).toContain('a>exam1')
  })

  it('子文档的目标项点亮：childId 按 key 对上号', () => {
    const view = deriveCanvas(makeStore(), 'g1', undefined)
    const outline = view.cards.find((c) => c.uuid === outlineUuid('r'))!
    expect(outline.slots).toEqual([{ key: 'jixian', title: '极限', index: 0, childId: 'a' }])
  })

  it('空文档卡给「生成」按钮（blank），空试卷 / 空超级文档同款；有正文的给摘要', () => {
    const view = deriveCanvas(makeStore(), 'g1', undefined)
    const byUuid = Object.fromEntries(view.cards.map((c) => [c.uuid, c]))
    expect(byUuid['a'].blank).toBe(true)
    expect(byUuid['a'].excerpt).toBeUndefined()
    expect(byUuid['exam1'].blank).toBe(true)
    expect(byUuid['sdoc1'].blank).toBe(true)
    expect(byUuid['r'].blank).toBeUndefined()
    // 摘要是洗过 Markdown 记号的一段纯文字
    expect(byUuid['r'].excerpt).toBe('微积分')
  })

  it('没有目标 / 没有节点：空图', () => {
    expect(deriveCanvas(emptyLearnStore(), 'g1', undefined).cards).toEqual([])
    const s = makeStore()
    const noGoal = { ...s, goals: [] }
    expect(deriveCanvas(noGoal, 'g1', undefined).cards).toEqual([])
  })
})

describe('deriveCanvas：坐标以存过的为准，没存的自动铺排（确定性）', () => {
  it('存过的坐标与便条被尊重', () => {
    const saved: StructureMap = {
      version: 2,
      positions: {
        r: { x: 1000, y: 500, note: '根的便条' },
        note1: { x: 42, y: 24 },
      },
    }
    const view = deriveCanvas(makeStore(), 'g1', saved)
    const r = view.cards.find((c) => c.uuid === 'r')!
    const note = view.cards.find((c) => c.uuid === 'note1')!
    expect(r).toMatchObject({ x: 1000, y: 500, note: '根的便条' })
    expect(note).toMatchObject({ x: 42, y: 24 })
  })

  it('没存过的卡自动铺排：根在最左列、挂件在其右；同一份输入派生两次结果一致', () => {
    const store = makeStore()
    const first = deriveCanvas(store, 'g1', undefined)
    const second = deriveCanvas(store, 'g1', undefined)
    expect(first.cards).toEqual(second.cards)

    const byUuid = Object.fromEntries(first.cards.map((c) => [c.uuid, c]))
    const root = byUuid['r']
    const note = byUuid['note1']
    expect(root.x).toBeLessThan(note.x)
    // 自动铺排的卡都拿到有限坐标
    for (const c of first.cards) {
      expect(Number.isFinite(c.x)).toBe(true)
      expect(Number.isFinite(c.y)).toBe(true)
    }
  })

  it('自动铺排不重叠：任意两张卡不交叠', () => {
    const view = deriveCanvas(makeStore(), 'g1', undefined)
    for (const a of view.cards) {
      for (const b of view.cards) {
        if (a === b) continue
        const overlap =
          a.x < b.x + CARD_W && b.x < a.x + CARD_W && a.y < b.y + view.heightOf(b) && b.y < a.y + view.heightOf(a)
        expect(overlap).toBe(false)
      }
    }
  })

  it('根文档存过坐标就用存的（入口徽章跟着它走，不再有独立的入口卡）', () => {
    const saved: StructureMap = { version: 2, positions: { r: { x: 900, y: 100 } } }
    const view = deriveCanvas(makeStore(), 'g1', saved)
    const root = view.cards.find((c) => c.uuid === 'r')!
    expect(root.x).toBe(900)
    expect(root.entry).toBe(true)
  })

  it('游离文档（摘了线）也在画布上：按深度补铺，不凭空消失', () => {
    const store = makeStore()
    const detached = { ...store, edges: [] }
    const view = deriveCanvas(detached, 'g1', undefined)
    const ids = view.cards.map((c) => c.uuid)
    expect(ids).toContain('a')
    // 树边没了：大纲→子文档那条连线也就没了（连线永远跟着事实走）
    expect(view.edges.some((e) => e.to === 'a')).toBe(false)
  })

  it('自动排列按目标项顺序：认领了接口的子级按行号排（与边的先后无关）', () => {
    const base = makeStore()
    const mk = (id: string, key: string) => ({
      id,
      title: key,
      key,
      description: '',
      docs: { teaching: '' },
      notes: [],
      annotations: [],
      status: 'learning' as const,
      origin: 'user' as const,
      goalId: 'g1',
      createdAt: 1,
      updatedAt: 1,
    })
    const store: LearnStore = {
      ...base,
      nodes: [
        {
          ...base.nodes[0],
          outline: {
            intro: '',
            children: [
              { key: 'yi', title: '第一条', summary: '' },
              { key: 'er', title: '第二条', summary: '' },
              { key: 'san', title: '第三条', summary: '' },
            ],
            updatedAt: 1,
          },
        },
        mk('d1', 'k1'),
        mk('d2', 'k2'),
        mk('d3', 'k3'),
      ],
      // 边的先后故意倒着建（第三条最先）：铺排顺序仍要按目标项行号走
      edges: [
        { from: 'r', to: 'd3', createdAt: 1, portKey: 'san' },
        { from: 'r', to: 'd2', createdAt: 1, portKey: 'er' },
        { from: 'r', to: 'd1', createdAt: 1, portKey: 'yi' },
      ],
      exams: [],
    }
    const view = deriveCanvas(store, 'g1', undefined)
    const y = (id: string) => view.cards.find((c) => c.uuid === id)!.y
    expect(y('d1')).toBeLessThan(y('d2'))
    expect(y('d2')).toBeLessThan(y('d3'))
  })

  it('空表兜底：saved 为空对象等价于没存过', () => {
    const store = makeStore()
    expect(deriveCanvas(store, 'g1', emptyStructure()).cards).toEqual(deriveCanvas(store, 'g1', undefined).cards)
  })

  it('游离挂件（池子里的笔记/超级文档、宿主悬空的试卷）也在画布上，没有连线', () => {
    const store = makeStore()
    const note = { id: 'free-note', name: '散记', content: '独立内容', createdAt: 1, updatedAt: 1 }
    const sdoc = { id: 'free-sdoc', name: '独立件', html: '', createdAt: 1, updatedAt: 1 }
    const danglingExam = { id: 'free-exam', nodeId: 'gone', goalId: 'g1', title: '孤卷', kind: 'quiz' as const, level: 'easy' as const, minutes: 0, questions: [], attempts: [], createdAt: 1 }
    const withPool = {
      ...store,
      detached: { g1: { notes: [note], superdocs: [sdoc] } },
      exams: [...store.exams, danglingExam],
    }
    const view = deriveCanvas(withPool, 'g1', undefined)
    const kinds = new Map(view.cards.map((c) => [c.uuid, c.kind]))
    expect(kinds.get('free-note')).toBe('note')
    expect(kinds.get('free-sdoc')).toBe('superdoc')
    expect(kinds.get('free-exam')).toBe('exam')
    expect(view.edges.some((e) => e.to === 'free-note' || e.to === 'free-sdoc' || e.to === 'free-exam')).toBe(false)
  })

  it('大纲卡只跟大纲实体走：空大纲也算在（画布上新建的那份），删了大纲卡就没了', () => {
    const store = makeStore()
    const emptyOutline = { ...store, nodes: store.nodes.map((n) => (n.id === 'a' ? { ...n, outline: { intro: '', children: [], updatedAt: 1 } } : n)) }
    expect(deriveCanvas(emptyOutline, 'g1', undefined).cards.some((c) => c.uuid === outlineUuid('a'))).toBe(true)
    const cleared = { ...emptyOutline, nodes: emptyOutline.nodes.map((n) => (n.id === 'a' ? { ...n, outline: undefined } : n)) }
    expect(deriveCanvas(cleared, 'g1', undefined).cards.some((c) => c.uuid === outlineUuid('a'))).toBe(false)
    // a 没有大纲卡了：以 a 为父的树边直接画在 a 与子文档之间（连线跟着事实走）
    const b = { ...store.nodes[1], id: 'b', title: '洛必达', key: 'luobida' }
    const chained = { ...cleared, nodes: [...cleared.nodes, b], edges: [...cleared.edges, { from: 'a', to: 'b', createdAt: 1 }] }
    expect(deriveCanvas(chained, 'g1', undefined).edges.some((e) => e.from === 'a' && e.to === 'b')).toBe(true)
  })
})

describe('连线几何（与画布共用一份口径）', () => {
  it('同高度的直线不绕弯：两点直接连', () => {
    const points = edgeElbow({ x: 0, y: 0 }, { x: 100, y: 0 })
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ])
  })

  it('折线的 path 按点列拼，曲线按贝塞尔拼', () => {
    expect(edgePathD([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe('M0 0 L10 10')
    expect(
      edgePathD(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 0, y: 10 },
          { x: 10, y: 10 },
        ],
        'curved',
      ),
    ).toBe('M0 0 C10 0, 0 10, 10 10')
  })

  it('列距常量还在（自动铺排的列宽 = 卡片宽 + 连线留白）', () => {
    expect(COL_GAP).toBe(CARD_W + 112)
    expect(CARD_H).toBeGreaterThan(0)
  })
})

describe('认领接口的文档卡：没有正经标题就显示接口的 label', () => {
  it('占位名「新文档」+ 认领 → 卡片标题 = 目标项标题；断线（无认领）回落占位名', () => {
    const base = makeStore()
    const r = base.nodes.find((n) => n.id === 'r')!
    const store: LearnStore = {
      ...base,
      nodes: [
        { ...r, outline: { intro: '', children: [{ key: 'jixian', title: '极限', summary: '' }], updatedAt: 1 } },
        {
          id: 'free1',
          title: '新文档',
          key: '新文档',
          description: '',
          docs: { teaching: '' },
          notes: [],
          annotations: [],
          status: 'learning',
          origin: 'user',
          goalId: 'g1',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      edges: [...base.edges, { from: 'r', to: 'free1', createdAt: 1, portKey: 'jixian' }],
    }
    const view = deriveCanvas(store, 'g1', undefined)
    expect(view.cards.find((c) => c.uuid === 'free1')?.title).toBe('极限')
    // 断线：认领消失，回落占位名
    const severed: LearnStore = { ...store, edges: store.edges.filter((e) => e.to !== 'free1') }
    expect(deriveCanvas(severed, 'g1', undefined).cards.find((c) => c.uuid === 'free1')?.title).toBe('新文档')
    // 有正经标题的文档不回落（标题是自己的）
    const named: LearnStore = {
      ...store,
      nodes: store.nodes.map((n) => (n.id === 'free1' ? { ...n, title: '我的笔记页' } : n)),
    }
    expect(deriveCanvas(named, 'g1', undefined).cards.find((c) => c.uuid === 'free1')?.title).toBe('我的笔记页')
  })

  it('行与文档的对应：认领（portKey）优先，key 对号只兜旧数据的底', () => {
    const base = makeStore()
    const r = base.nodes.find((n) => n.id === 'r')!
    const mk = (id: string, title: string, key: string) => ({
      id,
      title,
      key,
      description: '',
      docs: { teaching: '' },
      notes: [],
      annotations: [],
      status: 'learning' as const,
      origin: 'user' as const,
      goalId: 'g1',
      createdAt: 1,
      updatedAt: 1,
    })
    // claimed：文档标题与目标项毫无关系，但边上有 portKey
    // legacy：边没有 portKey，文档 key 与目标项 key 对上号（旧数据）
    const store: LearnStore = {
      ...base,
      nodes: [
        { ...r, outline: { intro: '', children: [{ key: 'jixian', title: '极限', summary: '' }, { key: 'lianjie', title: '衔接', summary: '' }], updatedAt: 1 } },
        mk('claimed1', '新文档', '新文档'),
        mk('legacy1', 'jixian', 'jixian'),
      ],
      edges: [
        ...base.edges,
        { from: 'r', to: 'claimed1', createdAt: 1, portKey: 'lianjie' },
        { from: 'r', to: 'legacy1', createdAt: 1 },
      ],
    }
    const slots = deriveCanvas(store, 'g1', undefined).cards.find((c) => c.uuid === outlineUuid('r'))?.slots ?? []
    expect(slots.find((s) => s.key === 'lianjie')?.childId).toBe('claimed1')
    expect(slots.find((s) => s.key === 'jixian')?.childId).toBe('legacy1')
  })

  it('重复树边去重：即使 store.edges 包含多条相同边，派生的 edges 键绝对唯一', () => {
    const base = makeStore()
    const store: LearnStore = {
      ...base,
      edges: [
        { from: 'r', to: 'a', createdAt: 1 },
        { from: 'r', to: 'a', createdAt: 2 },
        { from: 'o:r', to: 'a', createdAt: 3 },
      ],
    }
    const { edges } = deriveCanvas(store, 'g1', undefined)
    const edgeKeys = edges.map((e) => `${e.from}>${e.to}`)
    const uniqueKeys = new Set(edgeKeys)
    expect(edgeKeys.length).toBe(uniqueKeys.size)
  })
  it('教学假数据包含完备节点模型与连接，退出后不留痕迹', () => {
    const mock = getTourMockCanvas()
    expect(mock.cards.length).toBe(7)
    expect(mock.edges.length).toBe(6)

    // 包含各类典型节点（含超级文档、便签、测验、大纲等）
    const kinds = mock.cards.map((c) => c.kind)
    expect(kinds).toContain('doc')
    expect(kinds).toContain('outline')
    expect(kinds).toContain('video')
    expect(kinds).toContain('exam')
    expect(kinds).toContain('note')
    expect(kinds).toContain('superdoc')

    // 入口节点
    const entryCard = mock.cards.find((c) => c.entry)
    expect(entryCard?.title).toBe('计算机网络核心导学')

    // 大纲节点包含 slots
    const outlineCard = mock.cards.find((c) => c.kind === 'outline')
    expect(outlineCard?.slots?.length).toBe(3)

    // 超级文档与试卷节点
    const sdocCard = mock.cards.find((c) => c.kind === 'superdoc')
    expect(sdocCard?.title).toBe('TCP 握手时序交互仿真')
    const examCard = mock.cards.find((c) => c.kind === 'exam')
    expect(examCard?.attempts?.length).toBe(1)

    // 相机视口计算
    const cam = getTourCamera(1200, 700)
    expect(cam.zoom).toBeGreaterThan(0.55)
    expect(cam.x).toBeDefined()
    expect(cam.y).toBeDefined()
  })

  it('多层深度递增：深度为 5 的子文档与深度为 6 的挂件排在正确列，父子连线绝无从右向左反折', () => {
    const base = emptyLearnStore()
    const noteFunc: NoteFile = { id: 'note_func', name: '笔记', content: '函数笔记', createdAt: 1, updatedAt: 1 }
    const sdocFunc: SuperDocFile = { id: 'sdoc_func', name: '交互文档', html: '<p>func</p>', createdAt: 1, updatedAt: 1 }
    const examFunc: Exam = {
      id: 'exam_func', nodeId: 'd_func', goalId: 'g_nested', title: '随堂测验', kind: 'quiz', level: 'easy',
      minutes: 0, questions: [], attempts: [], createdAt: 1,
    }

    const mk = (id: string, title: string, key: string, outlineChildren?: { key: string; title: string }[]) => ({
      id,
      title,
      key,
      description: '',
      docs: { teaching: `# ${title}` },
      notes: id === 'd_func' ? [noteFunc] : [],
      superdocs: id === 'd_func' ? [sdocFunc] : [],
      outline: outlineChildren ? { intro: '', children: outlineChildren.map((c) => ({ ...c, summary: '' })), updatedAt: 1 } : undefined,
      annotations: [],
      status: 'learning' as const,
      origin: 'user' as const,
      goalId: 'g_nested',
      createdAt: 1,
      updatedAt: 1,
    })

    const store: LearnStore = {
      ...base,
      goals: [{ id: 'g_nested', rootNodeId: 'r', question: '高数学习', createdAt: 1, updatedAt: 1 }],
      nodes: [
        mk('r', '高等数学·全景路线图', 'math', [
          { key: 'station0', title: '第0站·工具箱重启' },
          { key: 'station1', title: '第1站·极限与连续' },
        ]),
        mk('d0', '第0站·工具箱重启', 'station0', [
          { key: 'func_domain', title: '函数与定义域' },
        ]),
        mk('d_func', '函数与定义域', 'func_domain'),
        mk('d1', '第1站·极限与连续', 'station1', [
          { key: 'clamp', title: '夹逼准则' },
        ]),
        mk('d_clamp', '夹逼准则', 'clamp'),
      ],
      // 树边顺序故意乱序排列，验证全局拓扑松弛不受边定义先后影响
      edges: [
        { from: 'd0', to: 'd_func', portKey: 'func_domain', createdAt: 2 },
        { from: 'd1', to: 'd_clamp', portKey: 'clamp', createdAt: 3 },
        { from: 'r', to: 'd1', portKey: 'station1', createdAt: 4 },
        { from: 'r', to: 'd0', portKey: 'station0', createdAt: 1 },
      ],
      exams: [examFunc],
    }

    const view = deriveCanvas(store, 'g_nested', undefined)
    const byUuid = Object.fromEntries(view.cards.map((c) => [c.uuid, c]))

    // 1. 各节点横坐标必须按拓扑深度对齐
    expect(byUuid['r'].x).toBe(1 * COL_GAP)
    expect(byUuid[outlineUuid('r')].x).toBe(2 * COL_GAP)
    expect(byUuid['d0'].x).toBe(3 * COL_GAP)
    expect(byUuid[outlineUuid('d0')].x).toBe(4 * COL_GAP)
    // 关键断言：深度 5 的节点必须在第 5 列（5 * COL_GAP），不得回退到深度 3！
    expect(byUuid['d_func'].x).toBe(5 * COL_GAP)
    // 关键断言：深度 6 的挂件必须在第 6 列（6 * COL_GAP），不得挤压在深度 4！
    expect(byUuid['note_func'].x).toBe(6 * COL_GAP)
    expect(byUuid['exam_func'].x).toBe(6 * COL_GAP)
    expect(byUuid['sdoc_func'].x).toBe(6 * COL_GAP)

    // 分支 1：第 1 站分支验证
    expect(byUuid['d1'].x).toBe(3 * COL_GAP)
    expect(byUuid[outlineUuid('d1')].x).toBe(4 * COL_GAP)
    expect(byUuid['d_clamp'].x).toBe(5 * COL_GAP)

    // 2. 检查父子链条在几何上的单调递增性
    expect(byUuid['r'].x).toBeLessThan(byUuid[outlineUuid('r')].x)
    expect(byUuid[outlineUuid('r')].x).toBeLessThan(byUuid['d0'].x)
    expect(byUuid['d0'].x).toBeLessThan(byUuid[outlineUuid('d0')].x)
    expect(byUuid[outlineUuid('d0')].x).toBeLessThan(byUuid['d_func'].x)
    expect(byUuid['d_func'].x).toBeLessThan(byUuid['note_func'].x)

    // 3. 检查所有连线：from 的 x 必须严格小于等于 to 的 x（绝无右向左反向折线）
    for (const e of view.edges) {
      const fromCard = byUuid[e.from]
      const toCard = byUuid[e.to]
      if (fromCard && toCard) {
        expect(fromCard.x).toBeLessThanOrEqual(toCard.x)
      }
    }
  })
})