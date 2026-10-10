import { describe, expect, it } from 'vitest'
import { computeTabRelation, directedDistance } from '../src/components/learn/TabBar'
import type { LearnStore, LearnTab } from '../src/learn/types'

describe('computeTabRelation', () => {
  const mockStore = {
    nodes: [
      { id: 'node-root', title: '根概念' },
      { id: 'node-mid', title: '中间概念' },
      { id: 'node-leaf', title: '子概念' },
      { id: 'node-subleaf', title: '孙概念' },
      { id: 'node-deep', title: '玄孙概念' },
    ],
    edges: [
      { from: 'node-root', to: 'node-mid' },
      { from: 'node-mid', to: 'node-leaf' },
      { from: 'node-leaf', to: 'node-subleaf' },
      { from: 'node-subleaf', to: 'node-deep' },
    ],
  } as unknown as LearnStore

  const tabRootDoc: LearnTab = {
    id: 't-root-doc',
    ref: { kind: 'teach', nodeId: 'node-root' },
  }

  const tabMidDoc: LearnTab = {
    id: 't-mid-doc',
    ref: { kind: 'teach', nodeId: 'node-mid' },
  }

  const tabLeafDoc: LearnTab = {
    id: 't-leaf-doc',
    ref: { kind: 'teach', nodeId: 'node-leaf' },
  }

  const tabSubleafDoc: LearnTab = {
    id: 't-subleaf-doc',
    ref: { kind: 'teach', nodeId: 'node-subleaf' },
  }

  const tabDeepDoc: LearnTab = {
    id: 't-deep-doc',
    ref: { kind: 'teach', nodeId: 'node-deep' },
  }

  const tabMidNote: LearnTab = {
    id: 't-mid-note',
    ref: { kind: 'note', nodeId: 'node-mid', noteId: 'note-1' },
  }

  const tabMidOutline: LearnTab = {
    id: 't-mid-outline',
    ref: { kind: 'outline', nodeId: 'node-mid' },
  }

  const tabWeb: LearnTab = {
    id: 't-web',
    ref: { kind: 'web', tabId: 'web-1' },
  }

  it('拓扑距离计算 directedDistance 正确', () => {
    expect(directedDistance(mockStore, 'node-root', 'node-mid')).toBe(1)
    expect(directedDistance(mockStore, 'node-root', 'node-leaf')).toBe(2)
    expect(directedDistance(mockStore, 'node-root', 'node-subleaf')).toBe(3)
    expect(directedDistance(mockStore, 'node-root', 'node-deep')).toBe(4)
    expect(directedDistance(mockStore, 'node-deep', 'node-root')).toBeNull()
  })

  it('当没有激活基准 tab 或 store 时返回 none', () => {
    expect(computeTabRelation(tabRootDoc, null, mockStore)).toEqual({ kind: 'none', depth: 0 })
    expect(computeTabRelation(tabRootDoc, tabMidDoc, null)).toEqual({ kind: 'none', depth: 0 })
  })

  it('目标 tab 与激活 tab 为同一项时返回 none', () => {
    expect(computeTabRelation(tabMidDoc, tabMidDoc, mockStore)).toEqual({ kind: 'none', depth: 0 })
  })

  it('无关联节点或 web 页面返回 none', () => {
    expect(computeTabRelation(tabWeb, tabMidDoc, mockStore)).toEqual({ kind: 'none', depth: 0 })
    expect(computeTabRelation(tabMidDoc, tabWeb, mockStore)).toEqual({ kind: 'none', depth: 0 })
  })

  it('当前激活节点时，同节点的其它 tab（大纲、笔记等）判定为 same-node', () => {
    expect(computeTabRelation(tabMidNote, tabMidDoc, mockStore)).toEqual({ kind: 'same-node', depth: 0 })
    expect(computeTabRelation(tabMidOutline, tabMidDoc, mockStore)).toEqual({ kind: 'same-node', depth: 0 })
    expect(computeTabRelation(tabMidDoc, tabMidNote, mockStore)).toEqual({ kind: 'same-node', depth: 0 })
  })

  it('当前激活为子节点时，上位父级/祖父级节点判定为 parent 并给出层级深度', () => {
    // 激活子节点 leaf，查看 mid（父级，相距 1）
    expect(computeTabRelation(tabMidDoc, tabLeafDoc, mockStore)).toEqual({ kind: 'parent', depth: 1 })
    // 激活子节点 leaf，查看 root（爷级，相距 2）
    expect(computeTabRelation(tabRootDoc, tabLeafDoc, mockStore)).toEqual({ kind: 'parent', depth: 2 })
    // 激活深层节点 deep，查看 root（相距 4）
    expect(computeTabRelation(tabRootDoc, tabDeepDoc, mockStore)).toEqual({ kind: 'parent', depth: 4 })
  })

  it('当前激活为父节点时，下位子级/孙级节点判定为 child 并给出层级深度', () => {
    // 激活根节点 root，查看 mid（子级，相距 1）
    expect(computeTabRelation(tabMidDoc, tabRootDoc, mockStore)).toEqual({ kind: 'child', depth: 1 })
    // 激活根节点 root，查看 leaf（孙级，相距 2）
    expect(computeTabRelation(tabLeafDoc, tabRootDoc, mockStore)).toEqual({ kind: 'child', depth: 2 })
    // 激活根节点 root，查看 subleaf（曾孙级，相距 3）
    expect(computeTabRelation(tabSubleafDoc, tabRootDoc, mockStore)).toEqual({ kind: 'child', depth: 3 })
    // 激活根节点 root，查看 deep（相距 4，最多 4）
    expect(computeTabRelation(tabDeepDoc, tabRootDoc, mockStore)).toEqual({ kind: 'child', depth: 4 })
  })

  it('非教学文档（笔记/大纲等）不会被判定为跨节点父子级箭头', () => {
    const tabRootNote: LearnTab = {
      id: 't-root-note',
      ref: { kind: 'note', nodeId: 'node-root', noteId: 'note-root-1' },
    }
    // 激活子节点 leaf，查看根节点的笔记：不应判定为 parent，应保持原样 none
    expect(computeTabRelation(tabRootNote, tabLeafDoc, mockStore)).toEqual({ kind: 'none', depth: 0 })
  })
})
