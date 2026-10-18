/**
 * 随笔提交的单元用例：快照边界、二次提交只带新改动、整理前后笔记差异、读回归一化。
 *
 * 这一层的错误形态都很安静：快照漏了一条、改过的随笔没被再提交、整理动过的笔记记错，
 * 界面上都看不出来——只有对着这些纯函数才能钉住。
 */
import { describe, expect, it } from 'vitest'

import {
  changesSummary,
  commitFeed,
  commitsOf,
  createEssayCommit,
  diffNoteChanges,
  lastCommitAt,
  noteFingerprint,
  normalizeEssayCommits,
  pendingEssays,
  updateEssayCommit,
} from '../src/learn/essayCommits'
import type { EssayEntry, KnowledgeNode, LearnStore, NoteFile } from '../src/learn/types'

const AT = 1_700_000_000_000

const essay = (id: string, updatedAt: number, text = '内容' + id): EssayEntry => ({
  id,
  text,
  createdAt: AT - 1000,
  updatedAt,
})

const note = (name: string, content: string): NoteFile => ({
  name,
  content,
  createdAt: AT,
  updatedAt: AT,
})

const node = (id: string, title: string, notes: NoteFile[] = []): KnowledgeNode =>
  ({ id, goalId: 'g1', title, notes }) as KnowledgeNode

/** 只造这些用例用得到的字段：提交逻辑只碰 nodes / essays / essayCommits */
const store = (essays: EssayEntry[], nodes: KnowledgeNode[] = []): LearnStore =>
  ({ version: 2, nodes, essays: { g1: essays } }) as unknown as LearnStore

describe('随笔提交的快照边界', () => {
  it('第一次提交：所有随笔都进快照，正文原样留下', () => {
    const s = store([essay('a', AT - 10), essay('b', AT - 20)])
    const created = createEssayCommit(s, 'g1', '  第一次整理  ', AT)
    expect(created).not.toBeNull()
    const commit = created!.commit
    expect(commit.message).toBe('第一次整理')
    expect(commit.status).toBe('running')
    expect(commit.snapshot.map((x) => x.id)).toEqual(['a', 'b'])
    expect(commit.snapshot[0].text).toBe('内容a')
    expect(commitsOf(created!.store, 'g1')).toHaveLength(1)
    expect(lastCommitAt(created!.store, 'g1')).toBe(AT)
  })

  it('第二次提交只带「上次之后写过 / 改过的」', () => {
    const first = createEssayCommit(store([essay('a', AT - 10)]), 'g1', '一', AT)!
    // 没动过 → 没得提交
    expect(createEssayCommit(first.store, 'g1', '二', AT + 1000)).toBeNull()
    // 改写 a（updatedAt 变新）+ 新写 b → 两条都进第二次快照
    const edited: LearnStore = {
      ...first.store,
      essays: { g1: [essay('b', AT + 1500), essay('a', AT + 1200, '改过的 a')] },
    }
    expect(pendingEssays(edited, 'g1').map((e) => e.id)).toEqual(['b', 'a'])
    const second = createEssayCommit(edited, 'g1', '二', AT + 2000)!
    expect(second.commit.snapshot.map((x) => x.text)).toEqual(['内容b', '改过的 a'])
    expect(commitsOf(second.store, 'g1').map((c) => c.message)).toEqual(['二', '一'])
  })

  it('空文本不能提交；增量材料带日期，模型读得懂', () => {
    expect(createEssayCommit(store([]), 'g1', '空', AT)).toBeNull()
    const created = createEssayCommit(store([essay('a', AT - 10, '今天想到一件事')]), 'g1', '', AT)!
    const feed = commitFeed(commitsOf(created.store, 'g1'), created.commit)
    expect(feed).toContain('今天想到一件事')
    expect(feed).toMatch(/【\d{4}-\d{2}-\d{2}】/)
  })
})

describe('增量材料（提交历史 + 新增全文 + 修改差异）', () => {
  it('第一次提交：没有历史，整段正文都在', () => {
    const created = createEssayCommit(store([essay('a', AT - 10, '今天想到一个点子')]), 'g1', '第一次', AT)!
    const feed = commitFeed(commitsOf(created.store, 'g1'), created.commit)
    expect(feed).toContain('第 1 次提交')
    expect(feed).not.toContain('已有整理记录')
    expect(feed).toContain('【本次新增的随笔】')
    expect(feed).toContain('今天想到一个点子')
    expect(feed).toContain('【本次没有修改随笔】')
  })

  it('第二次提交：带上次改了哪些笔记，修改只给差异', () => {
    const first = createEssayCommit(store([essay('a', AT - 10, '第一段')]), 'g1', '第一次', AT)!
    const done = updateEssayCommit(first.store, 'g1', first.commit.id, {
      status: 'done',
      changes: [{ nodeId: 'n1', nodeTitle: '极限', noteName: '随笔整理', kind: 'created' }],
    })
    const edited: LearnStore = {
      ...done,
      essays: { g1: [essay('a', AT + 100, '第一段\n后来又补了一句')] },
    }
    const second = createEssayCommit(edited, 'g1', '第二次', AT + 200)!
    const feed = commitFeed(commitsOf(second.store, 'g1'), second.commit)
    expect(feed).toContain('第 2 次提交')
    expect(feed).toContain('已有整理记录')
    // 上次整理动过的笔记要告诉模型，它才知道往哪份笔记里合并
    expect(feed).toContain('新建「极限」/ 笔记「随笔整理」')
    expect(feed).toContain('【本次没有新增随笔】')
    expect(feed).toContain('【本次修改的随笔（只给改动处）】')
    expect(feed).toContain('后来又补了一句')
    // 只给改动处：不是把整段重新贴一遍（公共前缀放在 … 上下文里）
    expect(feed).toContain('>>> 新增 / 改动：')
  })

  it('新增与修改同时出现时各归各的清单', () => {
    const first = createEssayCommit(store([essay('a', AT - 10, '旧的一段的原文')]), 'g1', '一', AT)!
    const next: LearnStore = {
      ...first.store,
      essays: { g1: [essay('b', AT + 100, '全新的想法'), essay('a', AT + 100, '旧的一段的原文，补了半句')] },
    }
    const second = createEssayCommit(next, 'g1', '二', AT + 200)!
    const feed = commitFeed(commitsOf(second.store, 'g1'), second.commit)
    expect(feed).toContain('【本次新增的随笔】')
    expect(feed).toContain('全新的想法')
    expect(feed).toContain('【本次修改的随笔（只给改动处）】')
    expect(feed).toContain('补了半句')
  })

  it('摘要按新建 / 更新分开数', () => {
    expect(changesSummary([])).toBe('没有改动任何笔记')
    expect(
      changesSummary([
        { nodeId: 'a', nodeTitle: 'A', noteName: 'n', kind: 'created' },
        { nodeId: 'b', nodeTitle: 'B', noteName: 'n', kind: 'updated' },
        { nodeId: 'c', nodeTitle: 'C', noteName: 'n', kind: 'updated' },
      ]),
    ).toBe('新建 1 份、更新 2 份笔记')
  })
})

describe('整理结果的记录', () => {
  it('只记新建 / 正文变过的笔记，没动的不出现', () => {
    const before = noteFingerprint(
      store([], [node('n1', '极限', [note('旧笔记', '原文')]), node('n2', '导数')]),
      'g1',
    )
    const after = noteFingerprint(
      store(
        [],
        [
          node('n1', '极限', [note('旧笔记', '改写后的正文'), note('随笔整理', '新内容')]),
          node('n2', '导数', [note('随笔整理', '也新建了')]),
        ],
      ),
      'g1',
    )
    const changes = diffNoteChanges(before, after)
    expect(changes).toHaveLength(3)
    expect(changes).toEqual(
      expect.arrayContaining([
        { nodeId: 'n1', nodeTitle: '极限', noteName: '随笔整理', kind: 'created' },
        { nodeId: 'n1', nodeTitle: '极限', noteName: '旧笔记', kind: 'updated' },
        { nodeId: 'n2', nodeTitle: '导数', noteName: '随笔整理', kind: 'created' },
      ]),
    )
    // 内容没变 → 一条都不记
    expect(diffNoteChanges(before, before)).toEqual([])
  })

  it('状态与改动可以回写；找不到的 id 原样返回', () => {
    const created = createEssayCommit(store([essay('a', AT - 10)]), 'g1', '一', AT)!
    const done = updateEssayCommit(created.store, 'g1', created.commit.id, {
      status: 'done',
      changes: [{ nodeId: 'n1', nodeTitle: '极限', noteName: '随笔整理', kind: 'created' }],
    })
    expect(commitsOf(done, 'g1')[0].status).toBe('done')
    expect(commitsOf(done, 'g1')[0].changes).toHaveLength(1)
    expect(updateEssayCommit(done, 'g1', '不存在', { status: 'error' })).toBe(done)
  })
})

describe('读回归一化', () => {
  it('丢掉坏快照；running 降成「未完成可重试」', () => {
    const raw = {
      g1: [
        { id: 'c1', at: AT, message: '一', status: 'running', snapshot: [{ id: 'a', createdAt: AT, text: '正文' }] },
        { id: 'c2', at: AT - 1, message: '二', status: 'done', snapshot: [{ id: 'b', createdAt: AT, text: '  ' }] },
        { id: 'c3', at: AT - 2, message: '三', status: 'weird', snapshot: {} },
      ],
      gone: [{ id: 'c4', at: AT, message: '目标没了', status: 'done', snapshot: [{ id: 'c', text: 'x' }] }],
    }
    const out = normalizeEssayCommits(raw, new Set(['g1']))
    expect(Object.keys(out)).toEqual(['g1'])
    expect(out.g1.map((c) => c.id)).toEqual(['c1'])
    expect(out.g1[0].status).toBe('error')
    expect(out.g1[0].error).toContain('没有跑完')
  })
})
