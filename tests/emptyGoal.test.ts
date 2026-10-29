import { describe, expect, it } from 'vitest'
import { buildDocs, parseDocsV3 } from '../src/learn/files'
import {
  FIRST_GROUP,
  allTabs,
  closeIn,
  emptyDocs,
  goalTabsOf,
  isAnchorOutline,
  openAnchorOutline,
  unloadAnchoredGroups,
} from '../src/learn/groups'
import { tabKey } from '../src/learn/tabs'
import { deriveCanvas } from '../src/components/learn/structure/structureView'
import { learnSandboxOps, type AgentRunTarget } from '../src/learn/agent/sandboxOps'
import type { LearnStore, TabRef } from '../src/learn/types'

describe('空学习目标持久化与画布派生', () => {
  it('新建无根节点的空目标可完整落盘并解析读回', () => {
    const goalId = 'goal-empty-1'
    const now = 1700000000000
    const store: LearnStore = {
      version: 2,
      nodes: [],
      edges: [],
      goals: [
        {
          id: goalId,
          title: '深入理解计算机系统',
          question: '深入理解计算机系统',
          rootNodeId: '',
          createdAt: now,
          updatedAt: now,
        },
      ],
      conversations: [
        {
          id: 'conv-empty-1',
          goalId,
          messages: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
      exams: [],
      tmp: {},
      resources: {},
      activeGoalId: goalId,
      activeNodeId: null,
      activeConversationId: 'conv-empty-1',
      docArea: emptyDocs(),
      drafts: {},
      docScroll: {},
      localFiles: [],
    }

    const files = buildDocs(store)
    expect(files.has('docs/深入理解计算机系统/goal.json')).toBe(true)
    expect(files.has('docs/深入理解计算机系统/chat.json')).toBe(true)

    const goalJson = JSON.parse(files.get('docs/深入理解计算机系统/goal.json') as string)
    expect(goalJson.id).toBe(goalId)
    expect(goalJson.title).toBe('深入理解计算机系统')
    expect(goalJson.rootNodeId).toBe('')

    // 读回校验
    const restored = parseDocsV3(files, {})
    expect(restored).not.toBeNull()
    expect(restored!.goals.length).toBe(1)
    expect(restored!.goals[0].id).toBe(goalId)
    expect(restored!.goals[0].title).toBe('深入理解计算机系统')
    expect(restored!.goals[0].rootNodeId).toBe('')
    expect(restored!.conversations.length).toBe(1)
    expect(restored!.conversations[0].goalId).toBe(goalId)
  })

  it('空目标在没有文档节点时，deriveCanvas 能正常返回空图而不会报错', () => {
    const goalId = 'goal-empty-1'
    const store: LearnStore = {
      version: 2,
      nodes: [],
      edges: [],
      goals: [
        {
          id: goalId,
          title: '空目标',
          question: '空目标',
          rootNodeId: '',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      conversations: [],
      exams: [],
      tmp: {},
      resources: {},
      activeGoalId: goalId,
      activeNodeId: null,
      activeConversationId: null,
      docArea: emptyDocs(),
      drafts: {},
      docScroll: {},
      localFiles: [],
    }
    const canvas = deriveCanvas(store, goalId, undefined)
    expect(canvas.cards).toEqual([])
    expect(canvas.edges).toEqual([])
  })

  it('空目标的结构Tab关闭后进入停靠场，再次打开能正确恢复', () => {
    const goalId = 'goal-empty-x'
    const goalOfNode = (id: string) => (id === goalId ? goalId : null)
    const rootOf = (gid: string) => (gid === goalId ? '' : null)

    const outlineRef: TabRef & { kind: 'outline' } = { kind: 'outline', nodeId: goalId, goalId }
    expect(isAnchorOutline(outlineRef, goalOfNode, rootOf)).toBe(true)

    // 1. 打开结构Tab
    let docs = openAnchorOutline(emptyDocs(), FIRST_GROUP, outlineRef, goalOfNode, 1)
    expect(allTabs(docs).some((t) => t.id === tabKey(outlineRef))).toBe(true)

    // 2. 关闭结构Tab
    const before = allTabs(docs)
    const closed = closeIn(docs, FIRST_GROUP, tabKey(outlineRef), 'self')
    const settled = unloadAnchoredGroups(closed, before, goalOfNode, rootOf)

    // 结构Tab已被关闭移出
    expect(allTabs(settled).some((t) => t.id === tabKey(outlineRef))).toBe(false)
    // 停靠场中应该保留占位
    expect(settled.parkedTabs?.[goalId]).toBeDefined()

    // 3. 再次重新打开结构Tab（如在资源管理器中点击目标）
    const restored = openAnchorOutline(settled, FIRST_GROUP, outlineRef, goalOfNode, 2)
    expect(allTabs(restored).some((t) => t.id === tabKey(outlineRef))).toBe(true)
    expect(restored.parkedTabs?.[goalId]).toBeUndefined()
  })

  it('空目标仅打开结构页签时，能被 goalTabsOf 正确归属于该目标', () => {
    const goalId = 'goal-empty-topbar'
    const outlineRef: TabRef & { kind: 'outline' } = { kind: 'outline', nodeId: goalId, goalId }
    const goalOfNode = (id: string) => (id === goalId ? goalId : null)

    const docs = openAnchorOutline(emptyDocs(), FIRST_GROUP, outlineRef, goalOfNode, 1)
    const tabs = allTabs(docs)
    const matched = goalTabsOf(docs.tabOwners, tabs, goalOfNode, goalId)
    expect(matched.length).toBe(1)
    expect(matched[0].id).toBe(tabKey(outlineRef))
  })

  it('无根节点的空目标可构建合法的目标级 AgentRunTarget 且沙箱能力正常运作', () => {
    const goalId = 'goal-empty-agent'
    const convId = 'conv-empty-agent'
    const target: AgentRunTarget = {
      goalId,
      nodeId: null,
      conversationId: convId,
    }
    expect(target.goalId).toBe(goalId)
    expect(target.nodeId).toBeNull()
    expect(target.conversationId).toBe(convId)

    const store: LearnStore = {
      version: 2,
      nodes: [],
      edges: [],
      goals: [
        {
          id: goalId,
          title: '空目标',
          question: '空目标',
          rootNodeId: '',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      conversations: [
        {
          id: convId,
          goalId,
          messages: [],
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      exams: [],
      tmp: {},
      resources: {},
      activeGoalId: goalId,
      activeNodeId: null,
      activeConversationId: convId,
      docArea: emptyDocs(),
      drafts: {},
      docScroll: {},
      localFiles: [],
    }

    const ops = learnSandboxOps({
      getLatest: () => store,
      set: () => {},
      nodeId: () => target.nodeId,
      goalId: () => target.goalId,
    })

    expect(ops.nodeId()).toBeNull()
    const listRes = ops.nodes.service().list()
    expect(listRes.ok).toBe(true)
    expect((listRes as Record<string, unknown>).nodes).toEqual([])
  })
})
