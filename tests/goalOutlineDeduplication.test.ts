import { describe, expect, it } from 'vitest'
import {
  allTabs,
  emptyDocs,
  openAnchorOutline,
  openGroupedDoc,
  syncGoalOutlineTabs,
} from '../src/learn/groups'
import { normalizeLearnStore } from '../src/learn/store/normalize'
import { makeGoal } from '../src/learn/store/factories'

describe('目标结构（大纲）页签唯一性与去重', () => {
  it('当目标未设根文档时，创建大纲页签；随后设置根节点，syncGoalOutlineTabs 能无缝对齐页签 ID', () => {
    const goalId = 'goal-test-1'
    let docs = emptyDocs()

    // 初始以 goalId 为锚打开大纲
    docs = openAnchorOutline(
      docs,
      docs.focus,
      { kind: 'outline', nodeId: goalId, goalId },
      () => goalId,
      Date.now(),
    )

    let tabs = allTabs(docs)
    expect(tabs.length).toBe(1)
    expect(tabs[0].id).toBe('o:' + goalId)
    expect(tabs[0].ref).toEqual({ kind: 'outline', nodeId: goalId, goalId })

    // 随后该目标有了根文档 root-doc-1
    const goals = [{ id: goalId, rootNodeId: 'root-doc-1' }]
    docs = syncGoalOutlineTabs(docs, goals)

    tabs = allTabs(docs)
    expect(tabs.length).toBe(1)
    expect(tabs[0].id).toBe('o:root-doc-1')
    expect(tabs[0].ref.kind).toBe('outline')
    if (tabs[0].ref.kind === 'outline') {
      expect(tabs[0].ref.nodeId).toBe('root-doc-1')
      expect(tabs[0].ref.goalId).toBe(goalId)
    }
  })

  it('在根节点已设定的情况下，openGroupedDoc 不会开出第二枚大纲页签', () => {
    const goalId = 'goal-test-2'
    const rootNodeId = 'root-doc-2'
    let docs = emptyDocs()

    // 目标先以 goalId 开了大纲（模拟刚创建目标时的状态）
    docs = openAnchorOutline(
      docs,
      docs.focus,
      { kind: 'outline', nodeId: goalId, goalId },
      () => goalId,
      Date.now(),
    )

    // 现在打开该目标的关联教学文档
    const goalOfNode = (id: string) => (id === 'teach-1' || id === rootNodeId ? goalId : null)
    docs = openGroupedDoc(
      docs,
      { kind: 'teach', nodeId: 'teach-1' },
      rootNodeId,
      goalOfNode,
      Date.now(),
    )

    const tabs = allTabs(docs)
    const outlineTabs = tabs.filter((t) => t.ref.kind === 'outline')
    // 必须有且仅有 1 枚结构页签！
    expect(outlineTabs.length).toBe(1)
    expect(outlineTabs[0].id).toBe('o:' + rootNodeId)

    // 教学文档也正常打开
    const teachTab = tabs.find((t) => t.ref.kind === 'teach')
    expect(teachTab).toBeDefined()
    expect(teachTab?.id).toBe('t:teach-1')
  })

  it('如果存在历史遗留的重复结构页签，syncGoalOutlineTabs 会自动清理重复项并只保留一枚', () => {
    const goalId = 'goal-test-3'
    const rootNodeId = 'root-doc-3'
    let docs = emptyDocs()

    // 人工构造出两枚大纲页签（模拟修复前的事故现场：两枚 [结构] 页签）
    const group = docs.groups[0]
    const tab1 = { id: 'o:' + goalId, ref: { kind: 'outline' as const, nodeId: goalId, goalId }, createdAt: 100 }
    const tab2 = { id: 'o:' + rootNodeId, ref: { kind: 'outline' as const, nodeId: rootNodeId, goalId }, createdAt: 200 }
    const teachTab = { id: 't:' + rootNodeId, ref: { kind: 'teach' as const, nodeId: rootNodeId }, createdAt: 300 }

    docs = {
      ...docs,
      groups: [
        {
          ...group,
          tabs: [tab1, tab2, teachTab],
          active: tab1.id,
        },
      ],
      tabOwners: {
        [goalId]: [tab1.id, tab2.id, teachTab.id],
      },
    }

    expect(allTabs(docs).filter((t) => t.ref.kind === 'outline').length).toBe(2)

    // 执行同步与去重
    const synced = syncGoalOutlineTabs(docs, [{ id: goalId, rootNodeId }])

    const syncedOutlineTabs = allTabs(synced).filter((t) => t.ref.kind === 'outline')
    expect(syncedOutlineTabs.length).toBe(1)
    expect(syncedOutlineTabs[0].id).toBe('o:' + rootNodeId)
    // 激活项应当对齐到保留的有效大纲页签
    expect(synced.groups[0].active).toBe('o:' + rootNodeId)
    // tabOwners 也完成了去重与对齐
    expect(synced.tabOwners?.[goalId]).toEqual(['o:' + rootNodeId, 't:' + rootNodeId])
  })

  it('normalizeLearnStore 在反序列化持久化数据时自动消除重复结构页签', () => {
    const goalId = 'goal-test-4'
    const rootNodeId = 'root-doc-4'

    const goal = makeGoal(rootNodeId, '测试目标', goalId)
    const rootNode = {
      id: rootNodeId,
      goalId,
      title: '机器学习',
      kind: 'doc' as const,
      depth: 0,
      createdAt: 100,
      updatedAt: 100,
    }

    const legacyRaw = {
      goals: [goal],
      nodes: [rootNode],
      conversations: [],
      docArea: {
        layout: { kind: 'group', group: 'g1' },
        focus: 'g1',
        groups: [
          {
            id: 'g1',
            tabs: [
              { id: 'o:' + goalId, ref: { kind: 'outline', nodeId: goalId, goalId }, createdAt: 100 },
              { id: 'o:' + rootNodeId, ref: { kind: 'outline', nodeId: rootNodeId, goalId }, createdAt: 200 },
              { id: 't:' + rootNodeId, ref: { kind: 'teach', nodeId: rootNodeId }, createdAt: 300 },
            ],
            active: 'o:' + goalId,
          },
        ],
        tabOwners: {
          [goalId]: ['o:' + goalId, 'o:' + rootNodeId, 't:' + rootNodeId],
        },
      },
    }

    const normalized = normalizeLearnStore(legacyRaw)
    expect(normalized).not.toBeNull()
    if (!normalized) return

    const outlineTabs = allTabs(normalized.docArea).filter((t) => t.ref.kind === 'outline')
    expect(outlineTabs.length).toBe(1)
    expect(outlineTabs[0].id).toBe('o:' + rootNodeId)
  })
})
