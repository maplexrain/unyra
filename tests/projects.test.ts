/**
 * 项目节点的单元用例：声明表怎么建改删、读盘归一丢什么、路径怎么解析成授权根。
 *
 * 这里的错都不好在界面上发现：删除不摘边会留下「指向空气」的挂载线（画布上凭空一条线，
 * 还会让自动铺排认一个不存在的父级）；路径解析放跑「..」越出用户目录，等于把声明边界
 * 变成摆设——授权跟着实体走的前提是「解析」本身诚实。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

// 数据根走 native 桥异步拉取（lib/storage 的 cachedRoot）；测试里给个固定的假桥
vi.mock('../src/lib/native', () => ({
  native: () => ({ storage: { info: async () => ({ root: 'C:/DataRoot' }) } }),
}))

import type { KnowledgeNode, LearnStore, ProjectNodeEntity } from '../src/learn/types'
import { emptyLearnStore } from '../src/learn/store/empty'
import { NodeService } from '../src/learn/nodeKinds'
import { deriveCanvas } from '../src/components/learn/structure/structureView'
import {
  createProjectNode,
  deleteProjectNode,
  goalDirSeg,
  normalizeProjects,
  projectRootsOf,
  resolveProjectRoot,
  updateProjectNode,
} from '../src/learn/projects'
import { refreshStorageRoot, setUserScope } from '../src/lib/storage'

const AT = 1700000000000

const node = (id: string, title: string): KnowledgeNode => ({
  id,
  title,
  key: title,
  description: '',
  docs: { teaching: '' },
  notes: [],
  annotations: [],
  status: 'learning',
  origin: 'user',
  goalId: 'g1',
  createdAt: AT,
  updatedAt: AT,
})

const storeOf = (projects: ProjectNodeEntity[]): LearnStore => ({
  ...emptyLearnStore(),
  nodes: [node('root1', '微积分')],
  goals: [{ id: 'g1', title: '', rootNodeId: 'root1', question: '学微积分', createdAt: AT, updatedAt: AT }],
  projects,
})

const entity = (over: Partial<ProjectNodeEntity> = {}): ProjectNodeEntity => ({
  id: 'p1',
  goalId: 'g1',
  title: '练习项目',
  path: 'code-practice',
  pathKind: 'relative',
  createdAt: AT,
  updatedAt: AT,
  ...over,
})

beforeEach(async () => {
  setUserScope('u1')
  await refreshStorageRoot()
})

describe('建 / 改 / 删', () => {
  it('建节点落默认值：标题空给「项目」，pathKind 默认 relative', () => {
    const r = createProjectNode(storeOf([]), 'g1', {}, AT)
    expect(r.entity.title).toBe('项目')
    expect(r.entity.path).toBe('')
    expect(r.entity.pathKind).toBe('relative')
    expect(r.store.projects).toHaveLength(1)
  })

  it('改节点只动给了的字段；不在了回 null', () => {
    const s0 = storeOf([entity()])
    const r = updateProjectNode(s0, 'p1', { path: '../shared' }, AT + 1)
    expect(r && 'entity' in r && r.entity.path).toBe('../shared')
    expect(r && 'entity' in r && r.entity.title).toBe('练习项目')
    expect(updateProjectNode(s0, 'nope', { path: 'x' }, AT)).toBeNull()
  })

  it('删除顺手摘掉两端的挂载边（指向空气的线是最难看的残留）', () => {
    const s0 = { ...storeOf([entity()]), edges: [
      { from: 'root1', to: 'p1', createdAt: AT },
      { from: 'p1', to: 'root1', createdAt: AT },
      { from: 'root1', to: 'other', createdAt: AT },
    ] }
    const next = deleteProjectNode(s0, 'p1')
    expect(next).not.toBeNull()
    expect(next!.edges.map((e) => e.from + '>' + e.to)).toEqual(['root1>other'])
    expect(next!.projects).toHaveLength(0)
    expect(deleteProjectNode(s0, 'nope')).toBeNull()
  })
})

describe('挂到文档之下（统一通道；addEdge 的树成员校验必须认项目 id）', () => {
  it('create({ kind: "project", under: 文档uuid }) 创建即挂：树边落在文档与项目之间', () => {
    let s = storeOf([])
    const svc = new NodeService({ getLatest: () => s, set: (n) => { s = n }, goalId: () => 'g1' })
    const r = svc.create({ kind: 'project', title: '练习项目', path: 'code-practice', under: 'root1' })
    if ('error' in r) throw new Error(r.error)
    expect(s.edges.some((e) => e.from === 'root1' && e.to === r.uuid)).toBe(true)
    // 再建一枚不带 under 的：游离，无边
    const r2 = svc.create({ kind: 'project', title: '独立项目', path: 'D:/work/demo' })
    if ('error' in r2) throw new Error(r2.error)
    expect(s.edges.some((e) => e.to === r2.uuid)).toBe(false)
    // 拼法由路径推断：盘符开头 = 绝对
    const entity2 = s.projects?.find((p) => p.id === r2.uuid)
    expect(entity2?.pathKind).toBe('absolute')
    // 删除节点顺手摘掉那条挂载边
    const d = svc.delete(r.uuid)
    if (d && 'error' in d) throw new Error(d.error)
    expect(s.edges.some((e) => e.to === r.uuid)).toBe(false)
  })

  it('拖线 connect 也走同一条协商：从项目侧 connect(文档, "up") 落同一条边', () => {
    let s = storeOf([])
    const svc = new NodeService({ getLatest: () => s, set: (n) => { s = n }, goalId: () => 'g1' })
    const r = svc.create({ kind: 'project', title: '练习项目', path: 'code-practice' })
    if ('error' in r) throw new Error(r.error)
    const project = svc.get(r.uuid)
    const doc = svc.get('root1')
    if (!project || !doc) throw new Error('节点没取到')
    const c = project.connect(doc, 'up')
    if ('error' in c) throw new Error(c.error)
    expect(s.edges.some((e) => e.from === 'root1' && e.to === r.uuid)).toBe(true)
  })

  it('从文档侧 connect(项目, "down") 也能成功落边（画布上从文档拉线到项目）', () => {
    let s = storeOf([])
    const svc = new NodeService({ getLatest: () => s, set: (n) => { s = n }, goalId: () => 'g1' })
    const r = svc.create({ kind: 'project', title: '练习项目', path: 'code-practice' })
    if ('error' in r) throw new Error(r.error)
    const project = svc.get(r.uuid)
    const doc = svc.get('root1')
    if (!project || !doc) throw new Error('节点没取到')
    const c = doc.connect(project, 'down')
    if ('error' in c) throw new Error(c.error)
    expect(s.edges.some((e) => e.from === 'root1' && e.to === r.uuid)).toBe(true)

    // 断开连接也能摘
    const dc = doc.disconnect(project)
    if ('error' in dc) throw new Error(dc.error)
    expect(s.edges.some((e) => e.from === 'root1' && e.to === r.uuid)).toBe(false)
  })

  it('文档拥有大纲时：deriveCanvas 派生出的挂载边始终落在文档卡，不经大纲卡 hub 翻译', () => {
    const s = {
      ...storeOf([entity({ id: 'p1', goalId: 'g1' })]),
      nodes: [
        {
          ...node('root1', '微积分'),
          outline: { intro: '', children: [{ key: 'c1', title: '极限', summary: '' }], updatedAt: AT },
        },
      ],
      edges: [{ from: 'root1', to: 'p1', createdAt: AT }],
    }
    const canvas = deriveCanvas(s, 'g1', undefined)
    const projEdge = canvas.edges.find((e) => e.to === 'p1')
    expect(projEdge).toBeDefined()
    expect(projEdge?.from).toBe('root1')
    const projCard = canvas.cards.find((c) => c.uuid === 'p1')
    expect(projCard).toBeDefined()
  })
})

describe('读盘归一', () => {
  it('坏行丢掉：id 空的、goalId 不认的、重复的；pathKind 收敛到两值', () => {
    const out = normalizeProjects(
      [
        { id: 'a', goalId: 'g1', title: 'A', path: 'x', pathKind: 'weird' },
        { id: 'a', goalId: 'g1', title: 'A 副本', path: 'y' },
        { id: '', goalId: 'g1', title: 'B', path: '' },
        { id: 'c', goalId: 'gone', title: 'C', path: '' },
        { id: 'd', goalId: 'g1', path: 'no-title' },
        'not-an-object',
      ],
      new Set(['g1']),
    )
    expect(out.map((p) => p.id)).toEqual(['a', 'd'])
    expect(out[0].pathKind).toBe('relative')
    expect(out[1].title).toBe('项目')
  })
})

describe('路径解析（授权根的来源，必须诚实）', () => {
  it('相对路径拼在目标目录之下：docs/{根文档标题}/{path}', () => {
    const s = storeOf([entity()])
    expect(resolveProjectRoot(s, s.projects![0])).toBe('C:/DataRoot/users/u1/docs/微积分/code-practice')
  })

  it('goalDirSeg 与写盘同一套口径：根文档标题优先，退回 question', () => {
    expect(goalDirSeg(storeOf([]), 'g1')).toBe('微积分')
    const noRoot = { ...storeOf([]), nodes: [], goals: [{ id: 'g1', rootNodeId: '', question: '线性代数', createdAt: AT, updatedAt: AT }] }
    expect(goalDirSeg(noRoot, 'g1')).toBe('线性代数')
    expect(goalDirSeg(noRoot, 'gone')).toBeNull()
  })

  it('「..」允许弹过目标段落到兄弟目录，但不许弹出用户目录', () => {
    const s = storeOf([entity({ path: '../shared-materials' })])
    expect(resolveProjectRoot(s, s.projects![0])).toBe('C:/DataRoot/users/u1/docs/shared-materials')
    const escape = storeOf([entity({ path: '../../../../outside' })])
    expect(resolveProjectRoot(escape, escape.projects![0])).toBeNull()
  })

  it('绝对路径原样作为授权根（归一由主进程做）', () => {
    const s = storeOf([entity({ path: 'D:/work/demo', pathKind: 'absolute' })])
    expect(resolveProjectRoot(s, s.projects![0])).toBe('D:/work/demo')
  })

  it('空路径、目标不在：都解析不出（null），绝不能给半个根', () => {
    expect(resolveProjectRoot(storeOf([entity({ path: '' })]), entity({ path: '' }))).toBeNull()
    const wrongGoal = storeOf([entity({ goalId: 'gone' })])
    expect(resolveProjectRoot(wrongGoal, wrongGoal.projects![0])).toBeNull()
  })

  it('projectRootsOf 只收解析成功的；失败的整条跳过', () => {
    const s = storeOf([
      entity({ id: 'ok1', path: 'a' }),
      entity({ id: 'bad', path: '../../../../nope' }),
      entity({ id: 'ok2', path: 'D:/work/b', pathKind: 'absolute' }),
    ])
    const roots = projectRootsOf(s, 'g1')
    expect(roots.map((r) => r.id)).toEqual(['ok1', 'ok2'])
  })
})
