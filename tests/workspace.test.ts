/**
 * 工作区目录的纯路径函数（learn/workspace）。
 *
 * 钉住三件事：
 * 1. 节点 → `docs/<目标>/<节点>/workspace` 的映射与 docs 树同源（nodeLayout），
 *    目标根节点的工作区就是 `docs/<目标>/workspace`；
 * 2. 子路径拼接把越界段说成「不合法」，不靠主进程的 resolveInside 兜底；
 * 3. 新建命名的合法性判断与避撞名（序号插在后缀前）。
 *
 * 改名随目录搬家这件事不再有自己的纯函数：workspace 在 ASSET_DIRS 里，
 * 与 static/images 同一套 assetMoves / assetMoveItems（tests/persistCommit.test.ts 钉着）。
 */
import { describe, expect, it } from 'vitest'
import { emptyDocs } from '../src/learn/groups'
import { wsChipUserRel } from '../src/learn/chipRef'
import { wsAllocateName, wsJoin, wsNameOk, wsRelOf } from '../src/learn/workspace'
import type { KnowledgeNode, LearnStore } from '../src/learn/types'

const makeNode = (id: string, patch: Partial<KnowledgeNode> = {}): KnowledgeNode => ({
  id,
  title: id,
  key: id,
  description: '',
  docs: { teaching: id + ' 的正文' },
  notes: [],
  annotations: [],
  status: 'learning',
  origin: 'user',
  goalId: 'g1',
  createdAt: 0,
  updatedAt: 0,
  ...patch,
})

const makeStore = (nodes: KnowledgeNode[], edges: LearnStore['edges'] = []): LearnStore => ({
  version: 2,
  nodes,
  edges,
  goals: [{ id: 'g1', rootNodeId: nodes[0].id, question: 'q', createdAt: 0, updatedAt: 0 }],
  conversations: [],
  exams: [],
  tmp: {},
  resources: {},
  docArea: emptyDocs(),
  drafts: {},
  docScroll: {},
  localFiles: [],
  activeGoalId: 'g1',
  activeNodeId: nodes[0].id,
  activeConversationId: '',
})

const NOW = 1_750_000_000_000

describe('工作区目录的映射', () => {
  it('节点的工作区在它自己的目录里；游离节点回 null', () => {
    const root = makeNode('n1', { title: '微积分' })
    const child = makeNode('n2', { title: '极限' })
    const s = makeStore([root, child], [{ from: 'n1', to: 'n2', createdAt: NOW }])
    // 目标根节点的工作区就是 docs/<目标>/workspace/
    expect(wsRelOf(s, 'n1')).toBe('docs/微积分/workspace')
    expect(wsRelOf(s, 'n2')).toBe('docs/微积分/极限/workspace')
    expect(wsRelOf(s, 'ghost')).toBeNull()
  })

  it('wsJoin 挡掉空段、点、两点与斜杠', () => {
    expect(wsJoin('docs/微积分/workspace', ['数据', '实验.csv'])).toBe('docs/微积分/workspace/数据/实验.csv')
    expect(wsJoin('docs/微积分/workspace', ['..'])).toBeNull()
    expect(wsJoin('docs/微积分/workspace', ['.'])).toBeNull()
    expect(wsJoin('docs/微积分/workspace', [''])).toBeNull()
    expect(wsJoin('docs/微积分/workspace', ['a/b'])).toBeNull()
    expect(wsJoin('docs/微积分/workspace', ['a\\b'])).toBeNull()
  })

  it('wsNameOk 挡掉空名、点、两点与斜杠；普通名字放行', () => {
    expect(wsNameOk('新建目录')).toBe(true)
    expect(wsNameOk('要点.md')).toBe(true)
    expect(wsNameOk('')).toBe(false)
    expect(wsNameOk('  ')).toBe(false)
    expect(wsNameOk('.')).toBe(false)
    expect(wsNameOk('..')).toBe(false)
    expect(wsNameOk('a/b')).toBe(false)
    expect(wsNameOk('a\\b')).toBe(false)
  })

  it('wsAllocateName 避开撞名：序号插在后缀前，无后缀直接加', () => {
    expect(wsAllocateName('新建目录', new Set())).toBe('新建目录')
    expect(wsAllocateName('新建文件.md', new Set(['新建文件.md']))).toBe('新建文件 2.md')
    expect(wsAllocateName('新建文件.md', new Set(['新建文件.md', '新建文件 2.md']))).toBe('新建文件 3.md')
    expect(wsAllocateName('新建目录', new Set(['新建目录', '新建目录 2']))).toBe('新建目录 3')
  })
})

describe('ws chip 的定位（learn/chipRef 的两种写法）', () => {
  /** 真实 store 里 key 是标题的归一化（graph 的 normalizeKey），夹具对齐这一点 */
  const root = makeNode('n1', { title: '微积分', key: '微积分' })
  const child = makeNode('n2', { title: '极限', key: '极限' })
  const s = makeStore([root, child], [{ from: 'n1', to: 'n2', createdAt: NOW }])

  it('宿主拖出来的磁盘路径（docs/ 开头）原样通过', () => {
    expect(wsChipUserRel(s, 'docs/微积分/极限/workspace/报告.md')).toBe('docs/微积分/极限/workspace/报告.md')
    expect(wsChipUserRel(s, '.\\docs/微积分/极限/workspace/报告.md')).toBe('docs/微积分/极限/workspace/报告.md')
  })

  it('导师写的「节点路径 + 文件段」现查数据树（workspace api 回执的口径）', () => {
    expect(wsChipUserRel(s, '极限/报告.md')).toBe('docs/微积分/极限/workspace/报告.md')
    // 目标根标题的前缀、#id 的写法，殊途同归
    expect(wsChipUserRel(s, '微积分/极限/报告.md')).toBe('docs/微积分/极限/workspace/报告.md')
    expect(wsChipUserRel(s, '#n2/报告.md')).toBe('docs/微积分/极限/workspace/报告.md')
    // 文件段里可以有真实子目录；目录本身（不带文件段）也定位得到
    expect(wsChipUserRel(s, '极限/数据/实验.csv')).toBe('docs/微积分/极限/workspace/数据/实验.csv')
    expect(wsChipUserRel(s, '极限')).toBe('docs/微积分/极限/workspace')
  })

  it('「节点/workspace/文件」把工作区目录写全的格式也认：workspace 段与目录本身重复，只吃一段', () => {
    expect(wsChipUserRel(s, '极限/workspace/报告.md')).toBe('docs/微积分/极限/workspace/报告.md')
    expect(wsChipUserRel(s, '微积分/workspace/数据/实验.csv')).toBe('docs/微积分/workspace/数据/实验.csv')
    expect(wsChipUserRel(s, '#n2/workspace/报告.md')).toBe('docs/微积分/极限/workspace/报告.md')
    // 真在 workspace 里又套了一层 workspace 的：写两层照样到
    expect(wsChipUserRel(s, '极限/workspace/workspace/x.md')).toBe('docs/微积分/极限/workspace/workspace/x.md')
  })

  it('第一段对不上任何节点 → null：没有「当前节点」可锚，chip 必须自包含', () => {
    expect(wsChipUserRel(s, '报告.md')).toBeNull()
    expect(wsChipUserRel(s, '#nope/报告.md')).toBeNull()
    expect(wsChipUserRel(s, '')).toBeNull()
  })
})
