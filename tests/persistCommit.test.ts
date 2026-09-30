/**
 * 学习数据的落盘提交：saveLearnStore 那两条路径要守的规矩（见 learn/store/persist）。
 *
 * 为什么值得单独立一个用例：整份学习数据走的是「先摊平 → 与上一次快照比对 → 只写变了的
 * 文件、删掉作废的目录」，而摊平发生在**防抖回调里**（排队那一刻不算）。这条链上破了规矩
 * 不会报错，只会静默丢数据或白写盘，因此这里逐条钉住：
 *
 *   1. 排队那一刻不落盘：摊平与写盘都发生在防抖提交真正执行的那一刻；
 *   2. 异步提交写下的内容 = 当前 store 摊平出来的那一份，且只写这些（state.json 一起写）；
 *   3. 关窗前的同步提交给出的是**同一套**清单；清单里同时有 move 与 remove 时，
 *      move 必须排在 remove 之前——删除是递归的，顺序错了会把 static/images 里的
 *      二进制跟着旧目录一起带走（见 files 的 assetMoves 与 lib/storage 的 FlushItem）。
 *
 * 做法：把原生桥换成记录器，走真正的 flushLearnStore / flushCommitsSync。
 * 每个用例先 hydrate 一次空用户：上一次的快照因此是 null，差异是确定的。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { buildDocs, buildState } from '../src/learn/files'
import { emptyDocs } from '../src/learn/groups'
import { flushCommitsSync } from '../src/lib/storage'
import { flushLearnStore, hydrateLearnStore, saveLearnStore } from '../src/learn/store'
import type { FlushItem } from '../src/lib/native'
import type { DependencyEdge, KnowledgeNode, LearnStore, LearningGoal } from '../src/learn/types'

const UID = 'u1'
const PREFIX = 'users/' + UID + '/'
/** 相对数据根的路径：writeText / writeJson 收到的就是这个形状 */
const abs = (rel: string): string => PREFIX + rel

interface Recorded {
  /** 异步路径真的写下去的文件 */
  writes: Map<string, string>
  /** 同步路径的落盘清单（主进程照着它写 / 删 / 搬） */
  flushed: FlushItem[]
}

const rec: Recorded = { writes: new Map(), flushed: [] }

/** 只实现这条链真正会用到的那几项，其余给个中性返回 */
function installBridge(): void {
  const ok = async (): Promise<{ ok: true }> => ({ ok: true })
  const bridge = {
    storage: {
      // hydrate 会读一次 state.json / journal.json：content 为 null 就是新用户
      read: async () => ({ ok: true, content: null }),
      readYaml: async () => ({ ok: true, data: null }),
      readImage: async () => ({ ok: true, dataUrl: null }),
      readBinary: async () => ({ ok: true, dataUrl: null }),
      list: async () => ({ ok: true, entries: [] }),
      write: async (rel: string, content: string) => {
        rec.writes.set(rel, content)
        return { ok: true }
      },
      writeYaml: ok,
      writeImage: ok,
      writeBinary: ok,
      remove: ok,
      move: ok,
      reveal: ok,
      info: async () => ({ root: '', defaultRoot: '', isDefault: true }),
      flush: (items: FlushItem[]) => {
        rec.flushed.push(...items)
        return { ok: true }
      },
    },
  }
  ;(globalThis as unknown as { window: unknown }).window = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    mojiNative: bridge,
  }
}

/** state.json 的文本：与 lib/storage 的 writeJson 同一种写法 */
const stateText = (store: LearnStore): string => JSON.stringify(buildState(store), null, 2) + '\n'

/** 一个目标：根节点（目标自己那份文档）+ 一个子节点。目录两层的用意是资源目录也分两层 */
interface GoalSpec {
  id: string
  root: string
  child: string
}

const rootId = (g: GoalSpec): string => g.id + '-root'
const childId = (g: GoalSpec): string => g.id + '-child'

const ONE: GoalSpec[] = [{ id: 'g1', root: '微积分', child: '导数' }]

function node(id: string, title: string, goalId: string): KnowledgeNode {
  return {
    id,
    title,
    key: id,
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

function storeOf(specs: GoalSpec[]): LearnStore {
  const nodes: KnowledgeNode[] = []
  const edges: DependencyEdge[] = []
  const goals: LearningGoal[] = []
  for (const g of specs) {
    nodes.push(node(rootId(g), g.root, g.id), node(childId(g), g.child, g.id))
    edges.push({ from: rootId(g), to: childId(g), createdAt: 1 })
    goals.push({ id: g.id, rootNodeId: rootId(g), question: g.root + '这门课', createdAt: 1, updatedAt: 1 })
  }
  return {
    version: 2,
    nodes,
    edges,
    goals,
    conversations: [],
    exams: [],
    tmp: {},
    resources: {},
    activeGoalId: specs[0].id,
    activeNodeId: rootId(specs[0]),
    activeConversationId: null,
    docArea: emptyDocs(),
    drafts: {},
    docScroll: {},
    localFiles: [],
  }
}

beforeEach(async () => {
  installBridge()
  rec.writes.clear()
  rec.flushed.length = 0
  // 空用户：快照清成 null，所以「写什么」只由当前 store 决定，与上一个用例无关
  await hydrateLearnStore(UID)
})

describe('学习数据落盘：防抖提交的两条路径', () => {
  it('排队那一刻不落盘：摊平与写盘都发生在防抖提交真正执行时', async () => {
    saveLearnStore(storeOf(ONE))
    expect(rec.writes.size, 'saveLearnStore 只是排队，不该当场写盘').toBe(0)
    expect(rec.flushed.length, 'saveLearnStore 只是排队，不该触发同步落盘').toBe(0)

    await flushLearnStore()
    expect(rec.writes.size, '提交执行之后才写盘').toBeGreaterThan(0)
  })

  it('异步提交写下的就是当前 store 摊平出来的那一份，且只写这些（state.json 一起写）', async () => {
    const store = storeOf(ONE)
    saveLearnStore(store)
    await flushLearnStore()

    const want = buildDocs(store)
    for (const [rel, text] of want) {
      expect(rec.writes.get(abs(rel)), rel + ' 的内容应当是摊平出来的那一份').toBe(text)
    }
    expect(rec.writes.get(abs('state.json')), 'state.json 与 buildState 一致').toBe(stateText(store))
    expect([...rec.writes.keys()].sort(), '只该写摊平出来的那些文件 + state.json').toEqual(
      [...want.keys()].map(abs).concat(abs('state.json')).sort(),
    )
  })

  it('没变的文件不重写：提交拿上一次快照做差异，只写变了的那一份 + state.json', async () => {
    const store = storeOf(ONE)
    saveLearnStore(store)
    await flushLearnStore()
    rec.writes.clear()

    // 只改子节点的教学文档：其它文件（含 state.json 的内容）一个字都没变
    const edited: LearnStore = {
      ...store,
      nodes: store.nodes.map((n) =>
        n.id === childId(ONE[0]) ? { ...n, docs: { teaching: '# 导数（改过）' } } : n,
      ),
    }
    saveLearnStore(edited)
    await flushLearnStore()

    const before = buildDocs(store)
    const after = buildDocs(edited)
    const changed = [...after].filter(([rel, text]) => before.get(rel) !== text).map(([rel]) => abs(rel))
    expect(changed, '这次只该有一份正文变了').toEqual([abs('docs/微积分/导数/导数.md')])
    expect([...rec.writes.keys()].sort(), '没变的不重写').toEqual([...changed, abs('state.json')].sort())
  })

  it('关窗前的同步提交：改名后的新路径写下去、旧目录删掉，且 move 排在 remove 之前', async () => {
    // 上一次快照里两个目标都在
    saveLearnStore(storeOf([...ONE, { id: 'g2', root: '线性代数', child: '矩阵' }]))
    await flushLearnStore()
    rec.writes.clear()
    rec.flushed.length = 0

    // 这一次：g1 改名（整个目录搬走）＋ g2 整个删掉（旧目录作废）。
    // 一份清单里因此同时有 move 与 remove，两者的先后才是可观察的——
    // 只改名的话，搬家的源目录会被刻意排除在删除之外（见 persist 的 sources），
    // 那份清单里一个 remove 都不会有。
    const renamed = storeOf([{ id: 'g1', root: '高等数学', child: '导数' }])
    saveLearnStore(renamed)
    flushCommitsSync()

    const items = [...rec.flushed]
    const data = items.filter((i) => typeof i.data === 'string') as Array<{ rel: string; data: string }>
    const want = buildDocs(renamed)

    expect(
      data.map((d) => d.rel).sort(),
      '新目录下该写的都写了（sync 只给变了的：改名后每一份都是新的）',
    ).toEqual([...want.keys()].map(abs).sort())
    for (const d of data) expect(d.data, d.rel).toBe(want.get(d.rel.slice(PREFIX.length)))
    expect(data.some((d) => d.rel.startsWith(abs('docs/微积分/'))), '旧目录不该再被写').toBe(false)

    const moves = items.filter((i) => i.move) as Array<{ rel: string; to: string }>
    expect(moves.map((m) => m.rel + ' → ' + m.to).sort(), '节点目录的资源与工作区都要跟着搬').toEqual([
      abs('docs/微积分/images') + ' → ' + abs('docs/高等数学/images'),
      abs('docs/微积分/static') + ' → ' + abs('docs/高等数学/static'),
      abs('docs/微积分/workspace') + ' → ' + abs('docs/高等数学/workspace'),
      abs('docs/微积分/导数/images') + ' → ' + abs('docs/高等数学/导数/images'),
      abs('docs/微积分/导数/static') + ' → ' + abs('docs/高等数学/导数/static'),
      abs('docs/微积分/导数/workspace') + ' → ' + abs('docs/高等数学/导数/workspace'),
    ])

    const removes = items.filter((i) => i.remove).map((i) => i.rel)
    expect(removes, '删掉的目标整个目录作废').toEqual([abs('docs/线性代数')])

    // 删除是递归的（主进程照着 rel 删整棵目录），所以搬必须排在删前面
    const lastMove = items.map((i) => !!i.move).lastIndexOf(true)
    const firstRemove = items.findIndex((i) => !!i.remove)
    expect(lastMove, '这一份清单里应当有 move').toBeGreaterThanOrEqual(0)
    expect(firstRemove, '这一份清单里应当有 remove').toBeGreaterThanOrEqual(0)
    expect(lastMove, 'move 必须排在 remove 之前').toBeLessThan(firstRemove)

    const stateItem = items.find((i) => i.rel === abs('state.json'))
    expect(stateItem?.kind, 'state.json 走 kind:json，序列化由主进程做').toBe('json')
    expect(stateItem?.data).toEqual(buildState(renamed))
  })
})
