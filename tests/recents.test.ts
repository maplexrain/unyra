/**
 * 「最近打开」（左侧栏那个区）的取数与排序。
 *
 * 三件事值得钉住：
 * 1. 节点与本地文件**混排**——这个区存在的意义就是不分类型（见 learn/recents）；
 * 2. 没打开过的节点不进列表：只有导师建出来、用户从没点开过的那些不算「最近打开」；
 * 3. 「在什么里面」那一栏要能把同名条目分辨开，完整路径留给悬停。
 */
import { describe, expect, it } from 'vitest'

import { emptyDocs } from '../src/learn/groups'
import { RECENT_LIMIT, recentOpens } from '../src/learn/recents'
import type { KnowledgeNode, LearnStore } from '../src/learn/types'

const at = (min: number): number => new Date(2026, 8, 20, 10, min).getTime()

function node(id: string, title: string, lastStudiedAt?: number): KnowledgeNode {
  return {
    id,
    title,
    key: id,
    description: '',
    docs: { teaching: '' },
    notes: [],
    annotations: [],
    status: 'learning',
    origin: 'user',
    goalId: 'g1',
    createdAt: 0,
    updatedAt: 0,
    ...(lastStudiedAt ? { learning: { lastStudiedAt, visits: 1 } } : {}),
  }
}

function store(over: Partial<LearnStore> = {}): LearnStore {
  return {
    version: 2,
    nodes: [],
    edges: [],
    goals: [{ id: 'g1', rootNodeId: 'root', question: '微积分', createdAt: 0, updatedAt: 0 }],
    conversations: [],
    exams: [],
    tmp: {},
    resources: {},
    activeGoalId: 'g1',
    activeNodeId: null,
    activeConversationId: null,
    // 文档区：一组、没有页签（分割与分组见 learn/groups）
    docArea: emptyDocs(),
    drafts: {},
    docScroll: {},
    localFiles: [],
    ...over,
  }
}

describe('最近打开', () => {
  it('节点与本地文件混排，按时间倒序', () => {
    const list = recentOpens(
      store({
        nodes: [node('root', '微积分', at(0))],
        localFiles: [{ path: 'C:\\notes\\极限.md', name: '极限.md', openedAt: at(30) }],
      }),
    )
    expect(list.map((x) => x.kind)).toEqual(['local', 'node'])
    expect(list.map((x) => x.title)).toEqual(['极限.md', '微积分'])
  })

  it('从没打开过的节点不算「最近打开」', () => {
    const list = recentOpens(store({ nodes: [node('root', '微积分'), node('n2', '导数', at(10))] }))
    expect(list.map((x) => x.title)).toEqual(['导数'])
  })

  it('最多留 RECENT_LIMIT 条', () => {
    const nodes = Array.from({ length: RECENT_LIMIT + 4 }, (_, i) => node('n' + i, '节点 ' + i, at(i)))
    expect(recentOpens(store({ nodes }))).toHaveLength(RECENT_LIMIT)
    // 留的是最近的那几条（时间最大的那批）
    expect(recentOpens(store({ nodes }))[0].title).toBe('节点 ' + (RECENT_LIMIT + 3))
  })

  it('「在什么里面」与悬停说明：同名条目靠它分辨', () => {
    const list = recentOpens(
      store({
        nodes: [node('root', '微积分', at(0)), node('导数', '导数', at(5))],
        edges: [{ from: 'root', to: '导数', createdAt: 0 }],
        localFiles: [{ path: 'C:\\Users\\me\\notes\\导数.md', name: '导数.md', openedAt: at(6) }],
      }),
    )
    const byTitle = new Map(list.map((x) => [x.title, x]))
    expect(byTitle.get('导数')?.hint).toBe('微积分')
    expect(byTitle.get('导数')?.tip).toBe('微积分 / 导数')
    // 根节点没有上级：那一栏空着，悬停就只有它自己
    expect(byTitle.get('微积分')?.hint).toBe('')
    expect(byTitle.get('微积分')?.tip).toBe('微积分')
    // 本地文件：显示所在目录名，完整路径放 title
    expect(byTitle.get('导数.md')?.hint).toBe('notes')
    expect(byTitle.get('导数.md')?.tip).toBe('C:\\Users\\me\\notes\\导数.md')
  })

  it('节点带上掌握状态：列表里那枚圆点与节点树同一套写法', () => {
    const mastered = { ...node('n1', '导数', at(1)), status: 'mastered' as const }
    expect(recentOpens(store({ nodes: [mastered] }))[0].status).toBe('mastered')
  })
})
