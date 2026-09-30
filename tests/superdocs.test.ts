/**
 * 超级文档的单元用例：名字去重、同名覆盖、找与删。
 *
 * 它的错误形态是「Agent 写了两次同名文档，结果变成两份，调用它的函数找不到」——
 * 覆盖语义一旦被改成「撞名让路」，这类错不会报任何错，只是超级文档悄悄失灵。
 */
import { describe, expect, it } from 'vitest'

import { emptyDocs } from '../src/learn/groups'
import type { KnowledgeNode, LearnStore } from '../src/learn/types'
import {
  findSuperDoc,
  removeSuperDoc,
  removeSuperDocIn,
  SUPERDOC_DEFAULT_NAME,
  uniqueSuperDocName,
  writeSuperDoc,
  writeSuperDocIn,
} from '../src/learn/superdocs'

const AT = 1700000000000

const node = (docs: KnowledgeNode['superdocs']): KnowledgeNode => ({
  id: 'n1',
  title: '极限',
  key: '极限',
  description: '',
  docs: { teaching: '正文' },
  notes: [],
  ...(docs ? { superdocs: docs } : {}),
  annotations: [],
  status: 'learning',
  origin: 'ai',
  goalId: 'g1',
  createdAt: AT,
  updatedAt: AT,
})

const store = (nodes: KnowledgeNode[]): LearnStore => ({
  version: 2,
  nodes,
  edges: [],
  goals: [],
  conversations: [],
  exams: [],
  tmp: {},
  resources: {},
  activeGoalId: null,
  activeNodeId: null,
  activeConversationId: null,
  // 文档区：一组、没有页签（分割与分组见 learn/groups）
  docArea: emptyDocs(),
  drafts: {},
  docScroll: {},
  localFiles: [],
})

describe('超级文档的纯逻辑', () => {
  it('writeSuperDocIn 新建一份；没有名字给默认名', () => {
    const r = writeSuperDocIn(node(undefined), undefined, '<p>hi</p>', AT)
    expect(r.name).toBe(SUPERDOC_DEFAULT_NAME)
    expect(r.node.superdocs).toHaveLength(1)
    expect(r.node.superdocs?.[0].html).toBe('<p>hi</p>')
  })

  it('同名是覆盖而不是新建——写两次只有一份', () => {
    let n = node(undefined)
    n = writeSuperDocIn(n, '句号器', '<p>v1</p>', AT).node
    const again = writeSuperDocIn(n, '句号器', '<p>v2</p>', AT)
    expect(again.name).toBe('句号器')
    expect(again.node.superdocs).toHaveLength(1)
    expect(again.node.superdocs?.[0].html).toBe('<p>v2</p>')
    // 大小写不同也认同一份（调用方抄写时大小写会飘）
    const upper = writeSuperDocIn(n, '句号器'.toUpperCase(), '<p>v3</p>', AT)
    expect(upper.node.superdocs).toHaveLength(1)
  })

  it('新名字追加在列表末尾，不与现有的撞车', () => {
    let n = node(undefined)
    n = writeSuperDocIn(n, '甲', '<p>1</p>', AT).node
    n = writeSuperDocIn(n, '甲', '<p>覆盖</p>', AT).node
    const r = writeSuperDocIn(n, '甲', '<p>新的</p>', AT)
    // 同名覆盖后再来同名依旧覆盖，不会出现「甲(2)」
    expect(r.node.superdocs).toHaveLength(1)
    const fresh = writeSuperDocIn(r.node, '乙', '<p>2</p>', AT)
    expect(fresh.name).toBe('乙')
    expect(fresh.node.superdocs?.map((d) => d.name)).toEqual(['甲', '乙'])
  })

  it('uniqueSuperDocName 给撞车的名字补序号（归一化/手改数据兜底用）', () => {
    const docs = [{ name: '甲', html: '', createdAt: AT, updatedAt: AT }]
    // allocate 的格式是「名字 + 空格 + 序号」（与笔记同一条路）
    expect(uniqueSuperDocName(docs, '甲')).toBe('甲 (2)')
    expect(uniqueSuperDocName(docs, '')).toBe(SUPERDOC_DEFAULT_NAME)
  })

  it('findSuperDoc 大小写不敏感', () => {
    const docs = [{ name: '句号器', html: '', createdAt: AT, updatedAt: AT }]
    expect(findSuperDoc(docs, '句号器')).toBeDefined()
    expect(findSuperDoc(docs, '')).toBeUndefined()
  })

  it('removeSuperDocIn 只删匹配的那一份', () => {
    const docs = [
      { name: '甲', html: '', createdAt: AT, updatedAt: AT },
      { name: '乙', html: '', createdAt: AT, updatedAt: AT },
    ]
    const next = removeSuperDocIn(node(docs), '甲', AT)
    expect(next.superdocs?.map((d) => d.name)).toEqual(['乙'])
    expect(removeSuperDocIn(next, '不存在', AT)).toBe(next)
  })

  it('store 层：写入与删除都落在指定节点上，节点不在时返回 null / 原样', () => {
    const s = store([node(undefined)])
    const written = writeSuperDoc(s, 'n1', '句号器', '<p>x</p>')
    expect(written?.nodes[0].superdocs).toHaveLength(1)
    expect(writeSuperDoc(s, '没有', '句号器', '<p>x</p>')).toBeNull()
    const removed = removeSuperDoc(written!, 'n1', '句号器')
    expect(removed.nodes[0].superdocs).toHaveLength(0)
    expect(removeSuperDoc(removed, '没有', '句号器')).toBe(removed)
  })
})
