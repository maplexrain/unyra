/**
 * 引用 chip 的生成与校验（见 src/learn/ops/chip）。
 *
 * 钉的是这条保证的两面：**build 生成的 chip 一定定位得到**（payload 永远带 nodeId、
 * 生成前先对 store 解析，定位不到就拒绝生成并说明原因），以及 **check 能把草稿里的
 * 坏 chip 逐颗点出来**（含「长得像 chip 但解析不开」的那类）。
 * 这一组存在的原因：模型手写 chip 的 path 全靠拼，【目标】/教学 这类拼法定位不到，
 * 学习者点开是一片空——把拼路径从模型手里拿走。
 */
import { describe, expect, it } from 'vitest'

import type { KnowledgeNode, LearnStore } from '../src/learn/types'
import { createChipOps } from '../src/learn/ops/chip'
import { wsRelOf } from '../src/learn/workspace'
import { nodeDocPath } from '../src/learn/files/build'
import { parseChipToken } from '../src/lib/chipSyntax'
import { tabRefFromChip } from '../src/learn/chipRef'

const NOW = 1700000000000

function makeNode(partial: Partial<KnowledgeNode> & { id: string; title: string }): KnowledgeNode {
  return {
    key: partial.title,
    description: '',
    docs: { teaching: partial.title + ' 的正文' },
    notes: [],
    annotations: [],
    status: 'learning',
    origin: 'user',
    goalId: 'g1',
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  }
}

function fixture(): LearnStore {
  return {
    version: 2,
    nodes: [
      makeNode({ id: 'r1', title: '微积分' }),
      makeNode({
        id: 'c1',
        title: '极限',
        notes: [
          { name: '错题本', content: '错题', createdAt: NOW, updatedAt: NOW },
          { name: '摘录', content: '摘录', createdAt: NOW, updatedAt: NOW },
        ],
        superdocs: [{ name: '句号计数器', html: '<p>x</p>', createdAt: NOW, updatedAt: NOW }] as KnowledgeNode['superdocs'],
      }),
    ],
    edges: [{ from: 'r1', to: 'c1', createdAt: NOW }],
    goals: [{ id: 'g1', rootNodeId: 'r1', question: '弄懂微积分', createdAt: NOW, updatedAt: NOW }],
    conversations: [],
    exams: [
      {
        id: 'ex1',
        nodeId: 'c1',
        goalId: 'g1',
        title: '极限小测',
        kind: 'quiz',
        level: 'easy',
        minutes: 0,
        questions: [],
        createdAt: NOW,
        attempts: [{ id: 'at1' } as never],
      },
    ],
    tmp: {},
    resources: {},
    activeGoalId: 'g1',
    activeNodeId: 'c1',
  } as unknown as LearnStore
}

function chipWith(store = fixture()) {
  const deps = { getLatest: () => store, set: () => {}, nodeId: () => 'c1', goalId: () => 'g1' }
  return createChipOps(deps as Parameters<typeof createChipOps>[0])
}

describe('chip.build：生成的 chip 一定定位得到', () => {
  it('doc：省略 path 落当前节点，payload 带 nodeId、磁盘路径与标题', () => {
    const store = fixture()
    const r = chipWith(store).build({ type: 'doc' }) as { ok: boolean; chip: string; title: string }
    expect(r.ok).toBe(true)
    expect(r.chip.startsWith('#[{')).toBe(true)
    expect(r.chip).toContain('"nodeId":"c1"')
    // path 是渲染端（tabRefFromChip）认的磁盘路径，不是「目标/节点」寻址标签
    expect(r.chip).toContain(nodeDocPath(store, 'c1', { kind: 'teaching' })!)
    expect(r.title).toBe('极限')
    expect(parseChipToken(r.chip)?.nodeId).toBe('c1')
  })

  it('doc：写标题也指得明白（与 doc.* 同一套寻址）', () => {
    const store = fixture()
    const r = chipWith(store).build({ type: 'doc', path: '微积分' }) as { ok: boolean; chip: string }
    expect(r.ok).toBe(true)
    expect(r.chip).toContain('"nodeId":"r1"')
    expect(r.chip).toContain(nodeDocPath(store, 'r1', { kind: 'teaching' })!)
  })

  it('可救的别名拼法（极限/教学）被规范化成磁盘路径；彻底编造的（【极限】/教学）拒绝生成并带候选', () => {
    const store = fixture()
    const ops = chipWith(store)
    const aliased = ops.build({ type: 'doc', path: '极限/教学' }) as { ok: boolean; chip: string }
    expect(aliased.ok).toBe(true)
    expect(aliased.chip).toContain('"nodeId":"c1"')
    expect(aliased.chip).toContain(nodeDocPath(store, 'c1', { kind: 'teaching' })!)
    const fabricated = ops.build({ type: 'doc', path: '【极限】/教学' }) as { ok: boolean; problem: string }
    expect(fabricated.ok).toBe(false)
    expect(fabricated.problem).toContain('没有')
  })

  it('note：两份笔记必须指名；指了不存在的也拒绝', () => {
    const ops = chipWith()
    const ambiguous = ops.build({ type: 'note' }) as { ok: boolean; problem: string }
    expect(ambiguous.ok).toBe(false)
    expect(ambiguous.problem).toContain('错题本')
    const good = ops.build({ type: 'note', note: '摘录' }) as { ok: boolean; chip: string }
    expect(good.ok).toBe(true)
    expect(good.chip).toContain('"note":"摘录"')
    const bad = ops.build({ type: 'note', note: '不存在' }) as { ok: boolean; problem: string }
    expect(bad.ok).toBe(false)
  })

  it('super：名字要真实存在', () => {
    const ops = chipWith()
    const good = ops.build({ type: 'super', name: '句号计数器' }) as { ok: boolean; chip: string }
    expect(good.ok).toBe(true)
    expect(good.chip).toContain('"name":"句号计数器"')
    const bad = ops.build({ type: 'super', name: '没有的' }) as { ok: boolean; problem: string }
    expect(bad.ok).toBe(false)
  })

  it('exam / attempt：examId 缺省取当前节点最新一份；attemptId 要真实存在', () => {
    const ops = chipWith()
    const exam = ops.build({ type: 'exam' }) as { ok: boolean; chip: string }
    expect(exam.ok).toBe(true)
    expect(exam.chip).toContain('"examId":"ex1"')
    const attempt = ops.build({ type: 'attempt', attemptId: 'at1' }) as { ok: boolean; chip: string }
    expect(attempt.ok).toBe(true)
    const badAttempt = ops.build({ type: 'attempt', attemptId: 'nope' }) as { ok: boolean; problem: string }
    expect(badAttempt.ok).toBe(false)
  })

  it('ws：path 用 workspace 回执的 rel（落在节点基目录下），彻底乱拼的拒绝', () => {
    const store = fixture()
    const ops = chipWith(store)
    const base = wsRelOf(store, 'c1')!
    const good = ops.build({ type: 'ws', path: base + '/报告.md' }) as { ok: boolean; chip: string }
    expect(good.ok).toBe(true)
    expect(good.chip).toContain('"nodeId":"c1"')
    const bad = ops.build({ type: 'ws', path: '乱写的目录/报告.md' }) as { ok: boolean; problem: string }
    expect(bad.ok).toBe(false)
  })

  it('web / local：url 要解析得开且只认 http(s)；local 只要带绝对路径', () => {
    const ops = chipWith()
    const web = ops.build({ type: 'web', url: 'https://example.com/a' }) as { ok: boolean; chip: string }
    expect(web.ok).toBe(true)
    const badUrl = ops.build({ type: 'web', url: '不是网址' }) as { ok: boolean }
    expect(badUrl.ok).toBe(false)
    const local = ops.build({ type: 'local', path: 'C:\\Users\\me\\资料.csv' }) as { ok: boolean; chip: string }
    expect(local.ok).toBe(true)
  })

  it('认不出的 type 拒绝并把可用的列出来', () => {
    const r = chipWith().build({ type: 'chip' }) as { ok: boolean; problem: string }
    expect(r.ok).toBe(false)
    expect(r.problem).toContain('doc')
  })
})

describe('chip.check：交付前自查', () => {
  it('好坏混合：valid / invalid / problems 各归各位', () => {
    const ops = chipWith()
    const good = (ops.build({ type: 'doc' }) as { ok: boolean; chip: string }).chip
    const r = ops.check('看这两份：' + good + ' 和 #[{type:"doc", path:"不存在"}]') as {
      total: number
      valid: number
      invalid: number
      problems: Array<{ chip: string; problem: string }>
    }
    expect(r.total).toBe(2)
    expect(r.valid).toBe(1)
    expect(r.invalid).toBe(1)
    expect(r.problems[0].problem).toContain('定位不到')
  })

  it('长得像 chip 但解析不开的单独计数（type 认不出也算）', () => {
    const r = chipWith().check('x #[{type:"nope"}] y') as { total: number; unparsed?: number }
    expect(r.total).toBe(0)
    expect(r.unparsed).toBe(1)
  })

  it('全好的草稿给一句可以交付', () => {
    const ops = chipWith()
    const good = (ops.build({ type: 'doc', path: '微积分' }) as { ok: boolean; chip: string }).chip
    const r = ops.check('交付：' + good) as { valid: number; invalid: number; note: string }
    expect(r.valid).toBe(1)
    expect(r.invalid).toBe(0)
    expect(r.note).toContain('可以交付')
  })
})

describe('chip 点击打开：attempt 型还原成考试副本页签', () => {
  it('attempt 与带 attemptId 的 exam 都开出 {kind:exam}；attempt 不存在则打不开', () => {
    const store = fixture()
    expect(tabRefFromChip(store, { type: 'attempt', nodeId: 'c1', examId: 'ex1', attemptId: 'at1' })).toEqual({
      kind: 'exam',
      nodeId: 'c1',
      examId: 'ex1',
      attemptId: 'at1',
    })
    expect(
      tabRefFromChip(store, { type: 'exam', nodeId: 'c1', examId: 'ex1', attemptId: 'at1' }),
    ).toMatchObject({ kind: 'exam', attemptId: 'at1' })
    // attemptId 不在 history 里：宁可打不开，也不开一张「试卷已被删」的空页签
    expect(tabRefFromChip(store, { type: 'exam', examId: 'ex1', attemptId: 'nope' })).toBeNull()
    // 试卷原件（不带 attemptId）没有页签形态：opener 对它走考试窗口
    expect(tabRefFromChip(store, { type: 'exam', examId: 'ex1' })).toBeNull()
  })
})
