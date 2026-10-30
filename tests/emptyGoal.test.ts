import { describe, expect, it } from 'vitest'
import { buildDocs, parseDocsV3 } from '../src/learn/files'
import { deleteGoal, deleteNode } from '../src/learn/graph'
import { captureNodeDelete, applyUndo } from '../src/learn/undo'
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
    const listRes = ops.nodes!.service()!.list()
    expect(listRes.ok).toBe(true)
    expect((listRes as Record<string, unknown>).nodes).toEqual([])
  })

  it('新架构下删除空学习目标：完整清理目标、会话、大纲Tab、停靠场与AgentTab，并保底保留空白页签', () => {
    const goalId = 'goal-empty-del'
    const convId = 'conv-empty-del'
    const outlineRef: TabRef & { kind: 'outline' } = { kind: 'outline', nodeId: goalId, goalId }
    const goalOfNode = (id: string) => (id === goalId ? goalId : null)

    const initialDocs = openAnchorOutline(emptyDocs(), FIRST_GROUP, outlineRef, goalOfNode, 1)

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
      docArea: initialDocs,
      drafts: {},
      docScroll: {},
      localFiles: [],
      agentTabs: [{ kind: 'goal', goalId, conversationId: convId }],
      agentActiveTab: `ga:${goalId}:${convId}`,
    }

    const next = deleteGoal(store, goalId)
    expect(next.goals).toEqual([])
    expect(next.conversations).toEqual([])
    expect(next.activeGoalId).toBeNull()
    expect(next.activeNodeId).toBeNull()
    expect(next.activeConversationId).toBeNull()
    expect(next.agentTabs).toEqual([])
    expect(next.agentActiveTab).toBeNull()

    // 文档区大纲Tab已关闭，且保底保留空白页签
    const tabs = allTabs(next.docArea)
    expect(tabs.some((t) => t.ref.kind === 'outline')).toBe(false)
    expect(tabs.some((t) => t.ref.kind === 'blank')).toBe(true)
    expect(next.docArea.tabOwners?.[goalId]).toBeUndefined()
    expect(next.docArea.parkedTabs?.[goalId]).toBeUndefined()
  })

  it('新架构下删除目标：非根连接的自由节点与普通节点均全部级联删除', () => {
    const goalId = 'goal-free-nodes'
    const store: LearnStore = {
      version: 2,
      nodes: [
        {
          id: 'n-free-1',
          goalId,
          title: '自由节点1',
          key: 'free1',
          description: '',
          docs: { teaching: '' },
          notes: [],
          annotations: [],
          status: 'learning',
          origin: 'user',
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: 'n-free-2',
          goalId,
          title: '自由节点2',
          key: 'free2',
          description: '',
          docs: { teaching: '' },
          notes: [],
          annotations: [],
          status: 'learning',
          origin: 'user',
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: 'n-other',
          goalId: 'other-goal',
          title: '其他目标节点',
          key: 'other',
          description: '',
          docs: { teaching: '' },
          notes: [],
          annotations: [],
          status: 'learning',
          origin: 'user',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      edges: [],
      goals: [
        {
          id: goalId,
          title: '包含自由节点的目标',
          question: '包含自由节点的目标',
          rootNodeId: '',
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: 'other-goal',
          title: '保留的目标',
          question: '保留的目标',
          rootNodeId: 'n-other',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      conversations: [],
      exams: [],
      tmp: {},
      resources: {},
      activeGoalId: goalId,
      activeNodeId: 'n-free-1',
      activeConversationId: null,
      docArea: emptyDocs(),
      drafts: {},
      docScroll: {},
      localFiles: [],
    }

    const next = deleteGoal(store, goalId)
    expect(next.goals.map((g) => g.id)).toEqual(['other-goal'])
    // 目标下的自由节点全被清除，其他目标的节点保留
    expect(next.nodes.map((n) => n.id)).toEqual(['n-other'])
    expect(next.activeGoalId).toBe('other-goal')
    expect(next.activeNodeId).toBe('n-other')
  })

  it('通过 deleteNode 传入 goalId 可以正确委派给 deleteGoal', () => {
    const goalId = 'goal-delegated'
    const store: LearnStore = {
      version: 2,
      nodes: [],
      edges: [],
      goals: [
        {
          id: goalId,
          title: '委派删除目标',
          question: '委派删除目标',
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

    const next = deleteNode(store, goalId)
    expect(next.goals).toEqual([])
  })

  it('删除目标前 captureNodeDelete 能够捕获目标并支持 applyUndo 完整撤回恢复', () => {
    const goalId = 'goal-undo-test'
    const convId = 'conv-undo-test'
    const store: LearnStore = {
      version: 2,
      nodes: [
        {
          id: 'n-sub',
          goalId,
          title: '阶段节点',
          key: 'sub',
          description: '',
          docs: { teaching: '' },
          notes: [],
          annotations: [],
          status: 'learning',
          origin: 'user',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      edges: [],
      goals: [
        {
          id: goalId,
          title: '可撤回目标',
          question: '可撤回目标',
          rootNodeId: '',
          createdAt: 10,
          updatedAt: 10,
        },
      ],
      conversations: [
        {
          id: convId,
          goalId,
          messages: [],
          createdAt: 10,
          updatedAt: 10,
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

    const entry = captureNodeDelete(store, goalId)
    expect(entry).not.toBeNull()
    expect(entry!.label).toBe('删除目标「可撤回目标」')
    expect(entry?.kind).toBe('node')
    if (entry?.kind === 'node') {
      expect(entry.nodes).toHaveLength(1)
    }

    const afterDelete = deleteGoal(store, goalId)
    expect(afterDelete.goals).toEqual([])
    expect(afterDelete.nodes).toEqual([])

    const undone = applyUndo(afterDelete, entry!)
    expect(undone.ok).toBe(true)
    expect(undone.store.goals).toHaveLength(1)
    expect(undone.store.goals[0].id).toBe(goalId)
    expect(undone.store.nodes).toHaveLength(1)
    expect(undone.store.nodes[0].id).toBe('n-sub')
    expect(undone.store.conversations).toHaveLength(1)
  })
})
