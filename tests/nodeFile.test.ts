import { describe, expect, it } from 'vitest'
import { buildDocs, parseDocs, parseDocsV2, parseDocsV3 } from '../src/learn/files'
import { migrateNodeFiles } from '../src/lib/migration/v3Nodes'
import type { MigrationContext } from '../src/lib/migration/types'

const UID = 'u1'
const ROOT = `users/${UID}`
const GOAL = `${ROOT}/docs/高数`

function meta(id: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    id,
    title: id,
    key: id,
    description: '',
    status: 'learning',
    origin: 'user',
    createdAt: 1,
    updatedAt: 1,
    annotations: [],
    dependencies: [],
    ...extra,
  })
}

/**
 * 一棵最小的**旧布局**树：根节点带正文 + 笔记 + 超级文档 + 试卷 + 目标信息，
 * 子节点只有空正文。迁移与往返都从它出发。
 */
function legacyTree(): Record<string, string> {
  return {
    [`${GOAL}/高数.meta.json`]: meta('n1', {
      title: '高数',
      key: '高数',
      description: '整门课',
      dependencies: [{ to: 'n2', createdAt: 1, portKey: 'daoshu' }],
      notes: [{ name: '错题', createdAt: 2, updatedAt: 3 }],
      superdocs: [{ id: crypto.randomUUID(), name: '讲义', html: '<html>讲义</html>', createdAt: 4, updatedAt: 5 }],
      exams: [
        {
          id: 'e1',
          nodeId: 'n1',
          goalId: 'g1',
          title: '小考',
          kind: 'quiz',
          level: 'easy',
          minutes: 0,
          questions: [{ id: 'q1', type: 'single', stem: '1+1=?', options: [{ id: 'a', text: '2' }, { id: 'b', text: '3' }], answer: ['a'], points: 10 }],
          createdAt: 6,
          attempts: [],
        },
      ],
      goal: { id: 'g1', question: '学会高数', createdAt: 1, updatedAt: 1 },
    }),
    [`${GOAL}/高数.md`]: '# 高数正文',
    [`${GOAL}/高数.notes/错题.md`]: '错题正文',
    [`${GOAL}/高数.outline.json`]: JSON.stringify({
      intro: '导语',
      children: [{ key: '导数', title: '导数', summary: '先学' }],
      updatedAt: 1,
    }),
    [`${GOAL}/chat.json`]: JSON.stringify({ version: 1, conversations: [] }),
    [`${GOAL}/导数/导数.meta.json`]: meta('n2', { title: '导数', key: '导数' }),
    [`${GOAL}/导数/导数.md`]: '导数正文',
    // 二进制通道里的东西：迁移不该碰它
    [`${GOAL}/static/a.png`]: 'binary-not-read',
  }
}

function fakeCtx(seed: Record<string, string>): { ctx: MigrationContext; files: Map<string, string> } {
  const files = new Map(Object.entries(seed))
  const listDir = (rel: string) => {
    const prefix = `${rel}/`
    const names = new Map<string, boolean>()
    for (const key of files.keys()) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash === -1) names.set(rest, false)
      else names.set(rest.slice(0, slash), true)
    }
    return Promise.resolve([...names].map(([name, dir]) => ({ name, dir })))
  }
  const ctx: MigrationContext = {
    uid: UID,
    userDir: ROOT,
    storage: {
      readJson: <T,>(rel: string) => {
        const text = files.get(rel)
        return Promise.resolve(text ? (JSON.parse(text) as T) : null)
      },
      writeJson: (rel: string, data: unknown) => {
        files.set(rel, JSON.stringify(data))
        return Promise.resolve(true)
      },
      readYaml: () => Promise.resolve(null),
      writeYaml: () => Promise.resolve(true),
      readText: (rel: string) => Promise.resolve(files.get(rel) ?? null),
      writeText: (rel: string, content: string) => {
        files.set(rel, content)
        return Promise.resolve(true)
      },
      listDir,
      removePath: (rel: string) => {
        for (const key of [...files.keys()]) if (key === rel || key.startsWith(`${rel}/`)) files.delete(key)
        return Promise.resolve(true)
      },
      mkdir: () => Promise.resolve(true),
    },
    log: () => {},
  }
  return { ctx, files }
}

/** 文件表里相对用户目录的那一半（parseDocs 认这个口径） */
function relOf(files: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>()
  for (const [rel, text] of files) {
    if (!rel.startsWith(`${ROOT}/`)) continue
    out.set(rel.slice(ROOT.length + 1), text)
  }
  return out
}

describe('节点文件：一个节点一个 .node.json', () => {
  it('旧布局能读出来，摊成新布局之后读回去逐项一致', () => {
    const before = parseDocsV2(relOf(new Map(Object.entries(legacyTree()))), {})
    expect(before).not.toBeNull()
    expect(before!.nodes.length).toBe(2)

    const files = buildDocs(before!)
    // 一个节点一个文件，旧的七种落点一个都不该再出现
    expect([...files.keys()].filter((k) => k.endsWith('.node.json')).sort()).toEqual([
      'docs/高数/导数/导数.node.json',
      'docs/高数/高数.node.json',
    ])
    expect([...files.keys()].some((k) => k.endsWith('.meta.json'))).toBe(false)
    expect([...files.keys()].some((k) => k.endsWith('.outline.json'))).toBe(false)
    expect([...files.keys()].some((k) => k.includes('.notes/'))).toBe(false)
    expect([...files.keys()].some((k) => k.includes('superdocs/'))).toBe(false)
    expect([...files.keys()].some((k) => k.includes('exams/'))).toBe(false)

    const after = parseDocs(files, {})
    expect(after).not.toBeNull()

    const n1 = after!.nodes.find((n) => n.id === 'n1')!
    const n2 = after!.nodes.find((n) => n.id === 'n2')!
    expect(n1.title).toBe('高数')
    expect(n1.docs.teaching).toBe('# 高数正文')
    expect(n1.notes).toEqual([expect.objectContaining({ name: '错题', content: '错题正文', createdAt: 2, updatedAt: 3 })])
    expect(n1.superdocs?.[0]).toMatchObject({ name: '讲义', html: '<html>讲义</html>' })
    expect(n1.outline?.intro).toBe('导语')
    expect(n1.outline?.children[0].key).toBe('导数')
    expect(n2.docs.teaching).toBe('导数正文')

    // 试卷只存在一份（旧布局是 exams/*.json + meta.exams 双写）
    expect(after!.exams.map((e) => e.id)).toEqual(['e1'])
    expect(after!.exams[0].nodeId).toBe('n1')

    // 依赖边、目标、归属都还在
    expect(after!.edges).toEqual([{ from: 'n1', to: 'n2', createdAt: 1, portKey: 'daoshu' }])
    expect(after!.goals.map((g) => g.id)).toEqual(['g1'])
    expect(after!.goals[0].rootNodeId).toBe('n1')
    expect(after!.nodes.every((n) => n.goalId === 'g1')).toBe(true)
  })

  it('空笔记也留得住名字（旧布局靠 meta 的名字清单，新布局靠 parts 里的顺序）', () => {
    const before = parseDocsV2(relOf(new Map(Object.entries(legacyTree()))), {})!
    const withEmpty = {
      ...before,
      nodes: before.nodes.map((n) =>
        n.id === 'n2' ? { ...n, notes: [{ id: crypto.randomUUID(), name: '还没写', content: '', createdAt: 9, updatedAt: 9 }] } : n,
      ),
    }
    const after = parseDocs(buildDocs(withEmpty), {})!
    expect(after.nodes.find((n) => n.id === 'n2')!.notes.map((x) => x.name)).toEqual(['还没写'])
  })

  it('新布局优先：同时存在 .node.json 与旧文件时读新布局', () => {
    const files = relOf(new Map(Object.entries(legacyTree())))
    const store = parseDocsV2(files, {})!
    for (const [rel, text] of buildDocs(store)) files.set(rel, text)

    // 再塞一份"旧文件"，内容不同——它应该被无视
    files.set('docs/高数/高数.md', '旧文件里的正文')
    const parsed = parseDocs(files, {})!
    expect(parsed.nodes.find((n) => n.id === 'n1')!.docs.teaching).toBe('# 高数正文')
    expect(parseDocsV3(files, {})).not.toBeNull()
  })
})

describe('第 3 次迁移：七份文件合并成一份', () => {
  it('写新文件、删旧文件，二进制原地不动', async () => {
    const { ctx, files } = fakeCtx(legacyTree())
    const res = await migrateNodeFiles(ctx)
    expect(res.ok).toBe(true)
    expect(res.step).toBe(3)

    expect(files.has(`${GOAL}/高数.node.json`)).toBe(true)
    expect(files.has(`${GOAL}/导数/导数.node.json`)).toBe(true)
    for (const gone of [
      `${GOAL}/高数.meta.json`,
      `${GOAL}/高数.md`,
      `${GOAL}/高数.notes/错题.md`,
      `${GOAL}/高数.outline.json`,
      `${GOAL}/导数/导数.meta.json`,
      `${GOAL}/导数/导数.md`,
    ]) {
      expect(files.has(gone), `${gone} 应该被删掉`).toBe(false)
    }
    // 二进制不在文本通道里，不该被碰
    expect(files.get(`${GOAL}/static/a.png`)).toBe('binary-not-read')

    // 读回来逐项对账
    const after = parseDocs(relOf(files), {})!
    expect(after.nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2'])
    expect(after.nodes.find((n) => n.id === 'n1')!.docs.teaching).toBe('# 高数正文')
    expect(after.nodes.find((n) => n.id === 'n1')!.notes[0].content).toBe('错题正文')
    expect(after.exams.map((e) => e.id)).toEqual(['e1'])
  })

  it('幂等：迁移过的数据再跑一次直接跳过', async () => {
    const { ctx, files } = fakeCtx(legacyTree())
    expect((await migrateNodeFiles(ctx)).ok).toBe(true)
    const snapshot = [...files.keys()].sort()

    const second = await migrateNodeFiles(ctx)
    expect(second.ok).toBe(true)
    expect(second.details).toBe('没有旧布局的节点（已迁移过）')
    expect([...files.keys()].sort()).toEqual(snapshot)
  })

  it('空目录：没有数据时直接返回，不报错', async () => {
    const { ctx } = fakeCtx({})
    const res = await migrateNodeFiles(ctx)
    expect(res.ok).toBe(true)
    expect(res.details).toBe('没有可迁移的数据')
  })

  it('随文便签（notepads）能够完整通过 buildDocs 落盘并经由 parseDocs 还原', () => {
    const { files } = fakeCtx(legacyTree())
    // 先完成迁移
    const store = parseDocs(relOf(files), {})!
    expect(store).not.toBeNull()

    // 给 n1 节点添加随文便签
    const n1 = store.nodes.find((n) => n.id === 'n1')!
    n1.notepads = [
      { id: 'np1', content: '第一条随文随笔', blockIndex: 0, createdAt: 100, updatedAt: 100 },
      { id: 'np2', content: '插入在第2块后的思考', blockIndex: 2, createdAt: 110, updatedAt: 120 },
    ]

    // 重新落盘
    const built = buildDocs(store)
    const nodeJsonStr = built.get('docs/高数/高数.node.json')
    expect(nodeJsonStr).toBeDefined()
    const nodeObj = JSON.parse(nodeJsonStr!)
    expect(nodeObj.notepads).toHaveLength(2)
    expect(nodeObj.notepads[0].id).toBe('np1')
    expect(nodeObj.notepads[0].content).toBe('第一条随文随笔')
    expect(nodeObj.notepads[0].blockIndex).toBe(0)

    // 从 buildDocs 产出的文件重新解析
    const restored = parseDocs(built, {})!
    expect(restored).not.toBeNull()
    const restoredN1 = restored.nodes.find((n) => n.id === 'n1')!
    expect(restoredN1.notepads).toBeDefined()
    expect(restoredN1.notepads).toHaveLength(2)
    expect(restoredN1.notepads![0]).toEqual({
      id: 'np1',
      content: '第一条随文随笔',
      blockIndex: 0,
      createdAt: 100,
      updatedAt: 100,
    })
    expect(restoredN1.notepads![1]).toEqual({
      id: 'np2',
      content: '插入在第2块后的思考',
      blockIndex: 2,
      createdAt: 110,
      updatedAt: 120,
    })
  })
})
