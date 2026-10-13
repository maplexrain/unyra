import { describe, expect, it } from 'vitest'
import type { KnowledgeNode, LearnStore } from '../src/learn/types'
import { emptyOutline, type OutlineEntry } from '../src/learn/types'
import { emptyLearnStore } from '../src/learn/store/empty'
import { buildMindmapTree } from '../src/components/learn/outline/MindmapView'
import { SELECT_ZOOM, centerPanFor, edgeOtherEnd } from '../src/components/learn/outline/mindmapNav'

const NOW = 1700000000000

function makeNode(partial: Partial<KnowledgeNode> & { id: string; title: string }): KnowledgeNode {
  return {
    key: partial.title,
    description: '',
    docs: { teaching: '' },
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

describe('大纲思维导图构建 (Mindmap Tree)', () => {
  it('思维导图以当前节点为根，且仅包含本身和子孙节点，绝不渲染父节点', () => {
    // 构造一棵三层结构：祖父节点 (parent) -> 当前节点 (current) -> 子节点 (child) -> 孙节点 (grandchild)
    const parent = makeNode({
      id: 'n_parent',
      title: '高数总览',
      outline: {
        intro: '',
        children: [{ key: '导数与微分', title: '导数与微分', summary: '' }],
        updatedAt: NOW,
      },
    })

    const child = makeNode({
      id: 'n_child',
      title: '导数的几何意义',
      status: 'mastered',
      outline: {
        intro: '',
        children: [
          { key: '切线方程', title: '切线方程', summary: '求切线与法线' },
        ],
        updatedAt: NOW,
      },
    })

    const grandchild = makeNode({
      id: 'n_grandchild',
      title: '切线方程',
      status: 'learning',
      outline: {
        intro: '',
        children: [],
        updatedAt: NOW,
      },
    })

    const current = makeNode({
      id: 'n_current',
      title: '导数与微分',
      description: '微积分的基础核心',
      outline: {
        intro: '掌握导数的本质与计算',
        children: [
          { key: '导数的几何意义', title: '导数的几何意义', summary: '斜率与变化率' },
          { key: '复合函数求导', title: '复合函数求导', summary: '链式法则' }, // 这个子节点未创建
        ],
        updatedAt: NOW,
      },
    })

    const store: LearnStore = {
      ...emptyLearnStore(),
      goals: [{ id: 'g1', rootNodeId: 'n_parent', question: '高数', createdAt: NOW, updatedAt: NOW }],
      activeNodeId: 'n_current',
      activeGoalId: 'g1',
      nodes: [parent, current, child, grandchild],
      edges: [
        { from: 'n_parent', to: 'n_current', createdAt: NOW },
        { from: 'n_current', to: 'n_child', createdAt: NOW },
        { from: 'n_child', to: 'n_grandchild', createdAt: NOW },
      ],
    }

    // 以 current 节点构建思维导图
    const tree = buildMindmapTree(store, current)

    // 1. 验证根节点是 current 本身，绝不是 parent
    expect(tree.id).toBe('n_current')
    expect(tree.title).toBe('导数与微分')
    expect(tree.isRoot).toBe(true)
    expect(tree.depth).toBe(0)

    // 遍历整个树，断言绝不包含 parent 节点
    const allTitles: string[] = []
    function collect(n: typeof tree) {
      allTitles.push(n.title)
      n.children.forEach(collect)
    }
    collect(tree)
    expect(allTitles).not.toContain('高数总览')

    // 2. 验证第一层子节点
    expect(tree.children.length).toBe(2)
    const child1 = tree.children.find((c) => c.title === '导数的几何意义')
    const child2 = tree.children.find((c) => c.title === '复合函数求导')
    expect(child1).toBeDefined()
    expect(child2).toBeDefined()

    // 已创建的真实节点
    expect(child1?.realNode?.id).toBe('n_child')
    expect(child1?.status).toBe('mastered')

    // 未创建的虚拟节点
    expect(child2?.realNode).toBeNull()
    expect(child2?.status).toBe('uncreated')

    expect(child1?.branchIndex).toBe(0)
    expect(child2?.branchIndex).toBe(1)

    // 3. 验证完全展开至孙节点（切线方程），并继承对应分支色彩索引
    expect(child1?.children.length).toBe(1)
    const grand = child1?.children[0]
    expect(grand?.title).toBe('切线方程')
    expect(grand?.realNode?.id).toBe('n_grandchild')
    expect(grand?.status).toBe('learning')
    expect(grand?.depth).toBe(2)
    expect(grand?.branchIndex).toBe(0)
  })
})

/**
 * 外部写的大纲文件（Agent 用 files.write 落的 `{节点}.outline.json`）只有
 * { title, summary }——key 由标题生成，模型不自己编。这类数据进了 store
 * 之后，导图上同一层的占位节点必须各自有各自的 id：
 * 早先它们会因为 key 是 undefined 而塌成同一个，React 报 duplicate key。
 */
describe('缺 key 的大纲条目在导图上的样子', () => {
  /** 把整棵树的节点 id 与连线 id 都收出来（连线 id 与 flattenTree 同一条式子） */
  function collectIds(tree: ReturnType<typeof buildMindmapTree>) {
    const nodeIds: string[] = []
    const edgeIds: string[] = []
    const walk = (n: ReturnType<typeof buildMindmapTree>) => {
      nodeIds.push(n.id)
      for (const c of n.children) {
        edgeIds.push(`${n.id}->${c.id}`)
        walk(c)
      }
    }
    walk(tree)
    return { nodeIds, edgeIds }
  }

  const childless = (id: string, title: string) => makeNode({ id, title })

  it('同一层多条没有 key 的条目（连标题重名也算）：各自一个占位节点，id 不重复', () => {
    const root = makeNode({
      id: 'n_root',
      title: '导数',
      outline: {
        intro: '',
        children: [
          { title: '导数的定义', summary: '' },
          { title: '四则运算法则', summary: '' },
          { title: '导数的定义', summary: '' }, // 标题重了：两条计划也不能塌成一个
        ] as unknown as OutlineEntry[],
        updatedAt: NOW,
      },
    })

    const tree = buildMindmapTree({ ...emptyLearnStore(), nodes: [root] }, root)
    const { nodeIds, edgeIds } = collectIds(tree)

    expect(tree.children).toHaveLength(3)
    expect(tree.children.map((c) => c.title)).toEqual([
      '导数的定义',
      '四则运算法则',
      '导数的定义',
    ])
    expect(tree.children.every((c) => c.status === 'uncreated')).toBe(true)

    // 节点 id 与连线 id 都不许重复——这两条正是 React key 唯一性要的东西
    expect(new Set(nodeIds).size).toBe(nodeIds.length)
    expect(new Set(edgeIds).size).toBe(edgeIds.length)
    // 拼进去的那段 key 不能是 undefined
    expect(nodeIds.some((id) => id.includes('undefined'))).toBe(false)
    // 补出来的 key 按标题现算（normalizeKey 口径），「这里显示」与「建节点」才对得上
    expect(tree.children[0].key).toBe('导数的定义')
  })

  it('缺 key 但已经建出来的子目标：照样认出真实节点，不会被当成未创建', () => {
    const root = makeNode({
      id: 'n_root',
      title: '导数',
      outline: {
        intro: '',
        children: [
          { title: '导数的定义', summary: '' },
          { title: '链式法则', summary: '' },
        ] as unknown as OutlineEntry[],
        updatedAt: NOW,
      },
    })
    const real = childless('n_defined', '导数的定义')
    const store: LearnStore = {
      ...emptyLearnStore(),
      activeNodeId: 'n_root',
      nodes: [root, real],
      edges: [{ from: 'n_root', to: 'n_defined', createdAt: NOW }],
    }

    const tree = buildMindmapTree(store, root)
    expect(tree.children[0].realNode?.id).toBe('n_defined')
    expect(tree.children[0].status).toBe('learning')
    expect(tree.children[1].realNode).toBeNull()
    expect(tree.children[1].status).toBe('uncreated')
    // 顺带钉住一件事：store 里那份条目没有被就地改写（补 key 只产出一份浅拷贝）
    const rawEntry = root.outline!.children[0] as OutlineEntry
    expect(Object.keys(rawEntry)).not.toContain('key')
    expect(rawEntry.title).toBe('导数的定义')
  })
})

describe('选中节点的镜头 (centerPanFor)', () => {
  /**
   * 一个节点在屏幕上落在哪儿：世界坐标先乘缩放，再加平移（与 MindmapView 的
   * `translate(...) scale(...)` 同一个顺序）。测试里把这个式子写全，
   * 是为了让「忘了乘缩放」这种错在 z=1 之外的档位上一定会露出来。
   */
  const onScreen = (v: number, pan: number, zoom: number) => v * zoom + pan

  it('选中档就是需求要的 120%', () => {
    expect(SELECT_ZOOM).toBe(1.2)
  })

  it('把节点摆到画面正中（在选中档 120% 下）', () => {
    const view = { width: 1000, height: 600 }
    const box = { x: 400, y: 300, width: 224, height: 98 }
    const pan = centerPanFor(box, view, SELECT_ZOOM)

    // 缩放之后再平移，这个节点的中心应当正好落在视口中心
    expect(onScreen(box.x + box.width / 2, pan.x, SELECT_ZOOM)).toBe(view.width / 2)
    expect(onScreen(box.y + box.height / 2, pan.y, SELECT_ZOOM)).toBe(view.height / 2)
  })

  it('100% 时也居中（默认档，两条式子在这里重合）', () => {
    const view = { width: 1000, height: 600 }
    const box = { x: 400, y: 300, width: 224, height: 98 }
    const pan = centerPanFor(box, view, 1)
    expect(onScreen(box.x + box.width / 2, pan.x, 1)).toBe(view.width / 2)
    expect(onScreen(box.y + box.height / 2, pan.y, 1)).toBe(view.height / 2)
  })

  it('放大档与 100% 档算出来的平移**不一样**（漏乘缩放就会被这条抓住）', () => {
    const view = { width: 1000, height: 600 }
    // 挑一个不在原点的节点：在原点时两种算法都会得到「视口中心」，区分不出来
    const box = { x: 400, y: 300, width: 224, height: 98 }
    expect(centerPanFor(box, view, SELECT_ZOOM)).not.toEqual(centerPanFor(box, view, 1))
  })

  it('水平与垂直同时居中（不是只居一边）', () => {
    const view = { width: 800, height: 500 }
    // 故意挑一个贴边的位置：两个方向都得被拉回来
    const box = { x: 0, y: 0, width: 200, height: 90 }
    const pan = centerPanFor(box, view, 1)
    expect(pan.x).toBe(800 / 2 - 100)
    expect(pan.y).toBe(500 / 2 - 45)
    expect(pan.x).toBe(300)
    expect(pan.y).toBe(205)
  })

  it('已经在正中的节点：平移量为 0（不会自己漂走）', () => {
    const view = { width: 1000, height: 600 }
    const box = { x: 1000 / 2 - 112, y: 600 / 2 - 49, width: 224, height: 98 }
    const pan = centerPanFor(box, view, 1)
    expect(pan.x).toBe(0)
    expect(pan.y).toBe(0)
  })
})

describe('点连线跳到另一端 (edgeOtherEnd)', () => {
  const edge = { from: 'parent', to: 'child' }

  it('选中父节点时点线 → 去子节点（顺着路线往下走）', () => {
    expect(edgeOtherEnd(edge, 'parent')).toBe('child')
  })

  it('选中子节点时点线 → 回父节点（往上退一层）', () => {
    expect(edgeOtherEnd(edge, 'child')).toBe('parent')
  })

  it('没有选中节点 → 往下游走', () => {
    expect(edgeOtherEnd(edge, null)).toBe('child')
  })

  it('选中跟这条线不相干的节点 → 往下游走（总得有个去处）', () => {
    expect(edgeOtherEnd(edge, '别的节点')).toBe('child')
  })
})
