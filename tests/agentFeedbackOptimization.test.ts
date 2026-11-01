import { describe, expect, it } from 'vitest'
import { createAgentOps } from '../src/learn/agentOps'
import { NodeService } from '../src/learn/nodeKinds'
import { emptyLearnStore } from '../src/learn/store/empty'
import { buildApi } from '../src/agent/sandbox/api'
import { resolveDoc } from '../src/learn/paths'
import type { KnowledgeNode, LearnStore } from '../src/learn/types'
import type { SandboxOptions } from '../src/agent/sandbox/types'

function makeGoal(store: LearnStore, id: string, title: string, rootNodeId = ''): LearnStore {
  return {
    ...store,
    activeGoalId: id,
    goals: [...store.goals, { id, title, question: title, rootNodeId, createdAt: 1, updatedAt: 1 }],
  }
}

function makeNode(id: string, title: string, goalId: string): KnowledgeNode {
  return {
    id,
    title,
    key: title.trim().toLowerCase(),
    description: '',
    docs: { teaching: '# ' + title },
    notes: [],
    annotations: [],
    status: 'learning',
    origin: 'user',
    goalId,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('Agent 反馈优化与摩擦点消除测试', () => {
  it('1. 目标无根节点时，node.list() 的 entry 与 root 为 null，创建首个 doc 自动成根', () => {
    let store = makeGoal(emptyLearnStore(), 'g1', '新课题目标')
    const goalId = 'g1'

    const svc = new NodeService({
      getLatest: () => store,
      set: (next) => {
        store = next
      },
      goalId: () => goalId,
    })

    // 初始状态：无根节点
    const listBefore = svc.list() as { goal: { root: string | null; entry: string | null; rootNote?: string }; nodes: unknown[] }
    expect(listBefore.goal.root).toBeNull()
    expect(listBefore.goal.entry).toBeNull()
    expect(listBefore.goal.rootNote).toContain('当前目标尚未指定根文档节点')

    // 创建首个文档节点，自动成为目标的根文档
    const createRes = svc.create({ kind: 'doc', title: '主讲义' }) as { ok: boolean; uuid: string; isRoot?: boolean }
    expect(createRes.ok).toBe(true)
    expect(createRes.isRoot).toBe(true)

    const listAfter = svc.list() as { goal: { root: string | null; entry: string | null } }
    expect(listAfter.goal.root).toBe(createRes.uuid)
    expect(listAfter.goal.entry).toBe('entry:' + createRes.uuid)
  })

  it('2. api.node.setRoot 可以显式指定根文档', () => {
    let store = makeGoal(emptyLearnStore(), 'g2', '数学')
    const goalId = 'g2'

    const svc = new NodeService({
      getLatest: () => store,
      set: (next) => {
        store = next
      },
      goalId: () => goalId,
    })

    svc.create({ kind: 'doc', title: '文档1' })
    const doc2 = svc.create({ kind: 'doc', title: '文档2' }) as { ok: boolean; uuid: string }

    const setRes = svc.setRoot(doc2.uuid) as { ok: boolean; root: string }
    expect(setRes.ok).toBe(true)
    expect(setRes.root).toBe(doc2.uuid)

    const list = svc.list() as { goal: { root: string | null } }
    expect(list.goal.root).toBe(doc2.uuid)
  })

  it('3. node.get 遇到不存在节点时返回安全错误门面，.help() 与 .content 不会抛 TypeError', async () => {
    let store = makeGoal(emptyLearnStore(), 'g3', '测试目标')

    const svc = new NodeService({
      getLatest: () => store,
      set: (next) => {
        store = next
      },
      goalId: () => 'g3',
    })

    const opts: Partial<SandboxOptions> = {
      nodes: { service: () => svc },
      docOps: { read: () => '', write: () => ({ ok: true, content: '' }) },
      resolveDoc: (p) => ({ ok: true as const, ref: { id: p || 'x', kind: 'teaching' as const, label: 'x', docLabel: 'x', title: 'x' } }),
      resolveNode: (p) => ({ ok: true as const, ref: { id: p || 'x', label: 'x', title: 'x' } }),
    }
    const { api } = buildApi(opts as SandboxOptions, [], { nodeFacade: true })

    const nodeApi = api.node as { get: (id: string) => Promise<any> }
    const res = await nodeApi.get('entry:')
    expect(res).toBeTruthy()
    expect(res.ok).toBe(false)
    expect(res.error).toContain('没有 uuid 为「entry:」的节点')

    // 关键点：调用 .help() 不再抛 TypeError: e.help is not a function
    const helpRes = await res.help()
    expect(helpRes.ok).toBe(false)
    expect(helpRes.error).toContain('没有 uuid 为「entry:」的节点')

    // await .content 不抛异常
    const contentRes = await res.content
    expect(contentRes.ok).toBe(false)
  })

  it('4. ui.point 接收字符串参数（UUID、标题）时不丢失路径', async () => {
    const doc = makeNode('doc-1', '勾股定理', 'g4')
    let store = {
      ...makeGoal(emptyLearnStore(), 'g4', '几何', 'doc-1'),
      nodes: [doc],
    }
    const goalId = 'g4'
    const docId = 'doc-1'

    const ops = createAgentOps({
      getLatest: () => store,
      set: (n) => {
        store = n
      },
      goalId: () => goalId,
      nodeId: () => docId,
      workspaceIo: { list: async () => ({ ok: true, entries: [] }), read: async () => ({ ok: true, content: '' }), write: async () => ({ ok: true }) },
      projectIo: { send: async () => ({ ok: true, op: 'list', path: '', entries: [] } as any) },
      resourceIo: {} as any,
    })

    let pointedTarget: any = null
    const sandboxOpts: Partial<SandboxOptions> = {
      ...ops,
      ui: {
        point: async (t) => {
          pointedTarget = t
          return { located: true }
        },
      },
    }
    const { api } = buildApi(sandboxOpts as SandboxOptions, [])

    const ui = api.ui as { point: (...args: any[]) => Promise<any> }

    // 直接传 raw UUID
    const res1 = await ui.point(docId)
    expect(res1.ok).toBe(true)
    expect(pointedTarget?.nodeId).toBe(docId)

    // 传带选项的字符串
    const res2 = await ui.point(docId, { line: 2 })
    expect(res2.ok).toBe(true)
    expect(pointedTarget?.nodeId).toBe(docId)

    // 传对象写法
    const res3 = await ui.point({ path: docId, line: 1 })
    expect(res3.ok).toBe(true)
    expect(pointedTarget?.nodeId).toBe(docId)
  })

  it('5. resolveDoc 与 chip.build 支持处理形如 "文档/笔记" 的寻址路径，且返回 deliveryPath 与 nodeId', () => {
    const node = {
      ...makeNode('doc-2', '力学基础', 'g5'),
      notes: [{ id: 'n-1', name: '牛顿三定律笔记', content: '加速度与力成正比', createdAt: 1, updatedAt: 1 }],
    }
    const store = {
      ...makeGoal(emptyLearnStore(), 'g5', '物理', 'doc-2'),
      nodes: [node],
    }
    const goalId = 'g5'

    const r = resolveDoc(store, { goalId, currentNodeId: node.id }, '力学基础/笔记/牛顿三定律笔记')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.node.title).toBe('力学基础')
      expect(r.value.kind).toBe('note')
      expect(r.value.note).toBe('牛顿三定律笔记')
    }

    // chip.build 测试
    const ops = createAgentOps({
      getLatest: () => store,
      set: () => {},
      goalId: () => goalId,
      nodeId: () => node.id,
      workspaceIo: { list: async () => ({ ok: true, entries: [] }), read: async () => ({ ok: true, content: '' }), write: async () => ({ ok: true }) },
      projectIo: { send: async () => ({ ok: true, op: 'list', path: '', entries: [] } as any) },
      resourceIo: {} as any,
    })

    const builtNote = ops.chip!.build({
      type: 'note',
      path: '力学基础/笔记/牛顿三定律笔记',
    }) as { ok: boolean; nodeId?: string; deliveryPath?: string }
    expect(builtNote.ok).toBe(true)
    expect(builtNote.nodeId).toBe(node.id)
    expect(builtNote.deliveryPath).toBeTruthy()

    // 优先认 direct nodeId
    const builtDoc = ops.chip!.build({
      type: 'doc',
      nodeId: node.id,
    }) as { ok: boolean; nodeId?: string; deliveryPath?: string }
    expect(builtDoc.ok).toBe(true)
    expect(builtDoc.nodeId).toBe(node.id)
  })
})
