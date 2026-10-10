import { describe, expect, it } from 'vitest'
import type { KnowledgeNode, LearnStore } from '../src/learn/types'
import { emptyOutline } from '../src/learn/types'
import { emptyLearnStore } from '../src/learn/store/empty'
import { buildMindmapTree } from '../src/components/learn/outline/MindmapView'

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
