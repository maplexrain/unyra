/**
 * 资源管理器页签定位的单元用例（explorer/reveal 的纯算部分）。
 *
 * 钉的是「页签 → 目标行 + 沿路展开」的换算：树里的文档 / 笔记 / 试卷副本带着整条
 * 祖先链与要打开的目录；网页认收藏（分组一并给出）；本地文件先认工作区（反查属主
 * 节点）、再认收藏、最后认本地文件列表——都认不上就不定位。定位签名单独一组用例：
 * 网页页签导航换 url 不换 key，签名不能跟着导航跑。
 */
import { describe, expect, it } from 'vitest'

import type { DependencyEdge, FavoriteItem, KnowledgeNode, LearningGoal, LearnStore, LocalFile } from '../src/learn/types'
import { emptyLearnStore } from '../src/learn/store/empty'
import { revealOfTab, revealSigOf } from '../src/components/learn/explorer/reveal'
import { wsRevealOfAbs } from '../src/learn/workspace'

const at = 1700000000000

const node = (id: string, extra: Partial<KnowledgeNode> = {}): KnowledgeNode =>
  ({
    id,
    goalId: 'g1',
    title: '节点' + id,
    createdAt: at,
    updatedAt: at,
    ...extra,
  }) as KnowledgeNode

/** 根 n1 ← 子 n2（n2 依赖 n1：from 是父、to 是子） */
function storeWith(favorites: FavoriteItem[] = [], localFiles: LocalFile[] = []): LearnStore {
  const root = node('n1')
  const child = node('n2')
  return {
    ...emptyLearnStore(),
    nodes: [root, child],
    edges: [{ from: 'n1', to: 'n2', createdAt: at }] as DependencyEdge[],
    goals: [{ id: 'g1', rootNodeId: 'n1', question: '微积分？', createdAt: at, updatedAt: at }] as LearningGoal[],
    favorites,
    localFiles,
  }
}

describe('页签 → 定位请求', () => {
  it('树里的文档带整条祖先链；笔记还要展开「文档」目录', () => {
    const store = storeWith()
    const teach = revealOfTab({ kind: 'teach', nodeId: 'n2' }, store, null)
    expect(teach).not.toBeNull()
    expect(teach!.keys).toEqual(['row:doc:teach:n2'])
    expect(teach!.nodes).toEqual(['n1', 'n2'])
    expect(teach!.docs).toEqual([])
    expect(teach!.section).toBe('nodes')

    const note = revealOfTab({ kind: 'note', nodeId: 'n2', note: '错题本' }, store, null)
    expect(note!.keys).toEqual(['row:doc:note:n2:错题本'])
    expect(note!.docs).toEqual(['n2'])
    expect(note!.nodes).toEqual(['n1', 'n2'])
  })

  it('试卷副本给出要展开的那份试卷', () => {
    const req = revealOfTab({ kind: 'exam', nodeId: 'n2', examId: 'e1', attemptId: 'a1' }, storeWith(), null)
    expect(req!.keys).toEqual(['row:doc:attempt:n2:e1:a1'])
    expect(req!.exams).toEqual([{ nodeId: 'n2', examId: 'e1' }])
    expect(req!.docs).toEqual(['n2'])
  })

  it('网页认收藏：分组一并给出；没收藏过 / 起始页不定位', () => {
    const store = storeWith([{ kind: 'web', url: 'https://a.dev', at, group: '文档' } as FavoriteItem])
    const hit = revealOfTab({ kind: 'web', url: 'https://a.dev', key: 'k1' }, store, null)
    expect(hit!.keys).toEqual(['row:fav:u:https://a.dev'])
    expect(hit!.favGroup).toBe('文档')
    expect(hit!.section).toBe('favorites')
    expect(hit!.nodes).toEqual([])

    expect(revealOfTab({ kind: 'web', url: 'https://none.dev', key: 'k2' }, store, null)).toBeNull()
    expect(revealOfTab({ kind: 'web', url: '', key: 'k3' }, store, null)).toBeNull()
  })

  it('本地文件先认工作区（反查属主节点），再认收藏，最后认本地文件列表', () => {
    const prefix = '/data/users/u1'
    const wsAbs = prefix + '/docs/节点n1/workspace/sub/notes.md'
    const ws = revealOfTab({ kind: 'local', path: wsAbs }, storeWith(), prefix)
    expect(ws!.keys).toEqual(['row:ws:docs/节点n1/workspace/sub/notes.md'])
    // 工作区文件活在节点底下：属主是 n1，链路带着根
    expect(ws!.nodes).toEqual(['n1'])
    expect(ws!.section).toBe('nodes')

    const favStore = storeWith([{ kind: 'local', path: 'C:\\下载\\x.md', at } as FavoriteItem])
    const fav = revealOfTab({ kind: 'local', path: 'C:\\下载\\x.md' }, favStore, prefix)
    expect(fav!.keys).toEqual(['row:fav:l:C:\\下载\\x.md'])
    expect(fav!.section).toBe('favorites')

    const localStore = storeWith([], [{ path: 'D:\\资料\\y.md', name: 'y.md' } as LocalFile])
    const local = revealOfTab({ kind: 'local', path: 'D:\\资料\\y.md' }, localStore, prefix)
    expect(local!.keys).toEqual(['row:local:D:\\资料\\y.md'])
    expect(local!.section).toBe('local')

    expect(revealOfTab({ kind: 'local', path: 'E:\\哪里都不在\\z.md' }, storeWith(), prefix)).toBeNull()
  })

  it('定位签名：网页导航换 url 不换 key，签名不跟着跑', () => {
    expect(revealSigOf({ kind: 'web', url: 'https://a.dev', key: 'k1' })).toBe('web:k1')
    expect(revealSigOf({ kind: 'web', url: 'https://a.dev/next', key: 'k1' })).toBe('web:k1')
    expect(revealSigOf({ kind: 'teach', nodeId: 'n1' })).toBe(JSON.stringify({ kind: 'teach', nodeId: 'n1' }))
  })
})

describe('工作区反查（wsRevealOfAbs）', () => {
  const store = storeWith()
  const prefix = '/data/users/u1'

  it('剥掉用户前缀后按 docs 布局认属主；根节点目录就是 docs/<目标>/workspace', () => {
    expect(wsRevealOfAbs(store, prefix + '/docs/节点n1/workspace/a.md', prefix)).toEqual({
      nodeId: 'n1',
      rel: 'docs/节点n1/workspace/a.md',
    })
  })

  it('不在用户目录里 / 不在任何工作区里 / 没有前缀，都回 null', () => {
    expect(wsRevealOfAbs(store, '/other/place/a.md', prefix)).toBeNull()
    expect(wsRevealOfAbs(store, prefix + '/docs/节点n1/teaching.md', prefix)).toBeNull()
    expect(wsRevealOfAbs(store, prefix + '/docs/节点n1/workspace/a.md', null)).toBeNull()
  })

  it('Windows 反斜杠路径先归一成斜杠再比', () => {
    expect(wsRevealOfAbs(store, '\\\\?\\C:' + prefix.replace(/\//g, '\\') + '\\docs\\节点n1\\workspace\\a.md', prefix)).toBeNull()
    expect(wsRevealOfAbs(store, prefix.replace(/\//g, '\\') + '\\docs\\节点n1\\workspace\\a.md', prefix)).toEqual({
      nodeId: 'n1',
      rel: 'docs/节点n1/workspace/a.md',
    })
  })

  it('真实形状：反斜杠数据根 + 斜杠拼接的后半段（userAbsPath 的混血路径），两边都归一再比', () => {
    // Windows 上 userAbsPrefix 的真实形状：cachedRoot 是反斜杠路径，join 用的是斜杠
    const winPrefix = 'C:\\Users\\me\\AppData\\Roaming\\unyra/users/u1'
    const winAbsAllBack = 'C:\\Users\\me\\AppData\\Roaming\\unyra\\users\\u1\\docs\\节点n1\\workspace\\a.md'
    expect(wsRevealOfAbs(store, winAbsAllBack, winPrefix)).toEqual({ nodeId: 'n1', rel: 'docs/节点n1/workspace/a.md' })
    // 页签里存的是 userAbsPath 的原样输出（根反斜杠、后半段斜杠）——同样要认得出
    const winAbsMixed = 'C:\\Users\\me\\AppData\\Roaming\\unyra/users/u1/docs/节点n1/workspace/a.md'
    const reveal = revealOfTab({ kind: 'local', path: winAbsMixed }, store, winPrefix)
    expect(reveal!.keys).toEqual(['row:ws:docs/节点n1/workspace/a.md'])
    expect(reveal!.nodes).toEqual(['n1'])
  })
})
