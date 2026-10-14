import { describe, expect, it } from 'vitest'
import type { KnowledgeNode, LearnStore, TabRef } from '../src/learn/types'
import {
  allTabs,
  emptyDocs,
  openGroupedDoc,
  refOwner,
} from '../src/learn/groups'
import { isDocumentTab, tabIdNodeId, tabKey, tabNodeId, tabTitle, tabTrail, viewOf, makeTab } from '../src/learn/tabs'
import { normalizeTab } from '../src/learn/store'
import { wsRefOfRel, wsRelOfTab } from '../src/learn/workspace'
import { diskPathKey } from '../src/lib/storage'
import { favoriteKeyOfTab, favoriteRefOfTab } from '../src/learn/favorites'

/**
 * 工作区**内部文件页签**（{kind:'ws'}，见 LearnStore 的 TabRef）：项目里的任何文件都是
 * 内部文件——挂在它的节点上（归属进目标的组）、身份按「节点 + 相对工作区的路径段」算、
 * 打开时先过目标的组（见 groups/tabs 的 openGroupedDoc）、不进收藏那套「外部东西」的账。
 */
const ws = (nodeId: string, seg: string): TabRef & { kind: 'ws' } => ({ kind: 'ws', nodeId, seg })

/** 最小数据树：goalA（rootA -> childA）、goalB（rootB）——够 nodeLayout 推出目录 */
function fixtureStore(): LearnStore {
  const node = (id: string, title: string, goalId: string): KnowledgeNode =>
    ({ id, title, key: title, goalId } as unknown as KnowledgeNode)
  return {
    nodes: [node('rootA', '微积分', 'gA'), node('childA', '极限', 'gA'), node('rootB', '物理', 'gB')],
    edges: [{ from: 'rootA', to: 'childA', createdAt: 0 }],
    goals: [
      { id: 'gA', rootNodeId: 'rootA', question: '微积分', createdAt: 0, updatedAt: 0 },
      { id: 'gB', rootNodeId: 'rootB', question: '物理', createdAt: 0, updatedAt: 0 },
    ],
  } as unknown as LearnStore
}

const goalOfNode = (nodeId: string): string | null => {
  if (nodeId === 'rootA' || nodeId === 'childA') return 'gA'
  if (nodeId === 'rootB') return 'gB'
  return null
}

describe('ws 页签的身份与展示（learn/tabs）', () => {
  it('身份 = ws:节点:相对段；改目录名（换 nodeId 之外的层）不动它', () => {
    expect(tabKey(ws('childA', '项目A/src/读我.md'))).toBe('ws:childA:项目A/src/读我.md')
    expect(tabIdNodeId('ws:childA:项目A/src/读我.md')).toBe('childA')
  })

  it('挂在它的节点上（tabNodeId 返回 nodeId），因此会跟着切目标收起 / 归队', () => {
    expect(tabNodeId(ws('childA', 'a.md'))).toBe('childA')
    expect(tabNodeId({ kind: 'local', path: 'C:/x.md' })).toBeNull()
  })

  it('标题是文件名；后缀是它的项目目录（两个项目各一个 README 时分得清）', () => {
    expect(tabTitle(ws('childA', '项目A/src/读我.md'), () => '极限')).toBe('读我.md')
    expect(tabTrail(ws('childA', '项目A/src/读我.md'), () => '极限/childA')).toBe('项目A/src')
    expect(tabTrail(ws('childA', '根文件.md'), () => '极限/childA')).toBe('')
  })

  it('默认视图与本地文件同一套：md 预览、媒体媒体、其余源码', () => {
    expect(viewOf(makeTab(ws('childA', '项目A/x.md'), 0))).toBe('preview')
    expect(viewOf(makeTab(ws('childA', '项目A/x.png'), 0))).toBe('media')
    expect(viewOf(makeTab(ws('childA', '项目A/x.py'), 0))).toBe('source')
  })

  it('是「文档页签」（关闭非文档时不动它）', () => {
    expect(isDocumentTab(ws('childA', 'a.md'))).toBe(true)
  })
})

describe('ws 页签的归属与收藏（groups/goals、learn/favorites）', () => {
  it('归属跟着工作区所属节点的目标走（内部文件不是公共页签）', () => {
    expect(refOwner(ws('childA', 'a.md'), goalOfNode)).toBe('gA')
    expect(refOwner(ws('rootB', 'a.md'), goalOfNode)).toBe('gB')
    // 节点没了（查不到目标）时归公共：总比凭空丢一枚页签好
    expect(refOwner(ws('ghost', 'a.md'), goalOfNode)).toBe('')
  })

  it('不进收藏：收藏那套是「外部的东西」的身份体系（不能当外部文件看）', () => {
    expect(favoriteKeyOfTab(ws('childA', 'a.md'))).toBeNull()
    expect(favoriteRefOfTab(ws('childA', 'a.md'))).toBeNull()
  })
})

describe('ws 身份与磁盘路径的互推（learn/workspace）', () => {
  const store = fixtureStore()

  it('wsRelOfTab：相对段拼上节点的工作区目录（docs/目标/…/workspace）', () => {
    expect(wsRelOfTab(store, ws('rootA', '项目A/a.md'))).toBe('docs/微积分/workspace/项目A/a.md')
    expect(wsRelOfTab(store, ws('childA', 'b.md'))).toBe('docs/微积分/极限/workspace/b.md')
  })

  it('wsRefOfRel：反查到节点与相对段；不在任何工作区里返回 null', () => {
    expect(wsRefOfRel(store, 'docs/微积分/workspace/项目A/a.md')).toEqual(ws('rootA', '项目A/a.md'))
    expect(wsRefOfRel(store, 'docs/微积分/极限/workspace/b.md')).toEqual(ws('childA', 'b.md'))
    expect(wsRefOfRel(store, 'docs/微积分/教学文档.md')).toBeNull()
    expect(wsRefOfRel(store, 'random/outside.md')).toBeNull()
  })

  it('往返一致：wsRelOfTab ∘ wsRefOfRel 是恒等（相对段口径自洽）', () => {
    const ref = ws('childA', '项目A/src/读我.md')
    const rel = wsRelOfTab(store, ref)
    expect(rel).not.toBeNull()
    expect(wsRefOfRel(store, rel as string)).toEqual(ref)
  })
})

describe('ws 页签的读盘归一（normalizeTab）', () => {
  const byId = new Map([['childA', { id: 'childA', notes: [], superdocs: [] } as unknown as KnowledgeNode]])

  it('节点在、seg 形状对：收下（文件在不在磁盘不查——与本地文件同一条纪律）', () => {
    const t = normalizeTab({ ref: { kind: 'ws', nodeId: 'childA', seg: '项目A/a.md' }, createdAt: 1 }, byId)
    expect(t?.id).toBe('ws:childA:项目A/a.md')
  })

  it('节点已被删、seg 为空或试图越界（.. / 绝对路径）：丢掉', () => {
    expect(normalizeTab({ ref: { kind: 'ws', nodeId: 'ghost', seg: 'a.md' }, createdAt: 1 }, byId)).toBeNull()
    expect(normalizeTab({ ref: { kind: 'ws', nodeId: 'childA', seg: '' }, createdAt: 1 }, byId)).toBeNull()
    expect(normalizeTab({ ref: { kind: 'ws', nodeId: 'childA', seg: '../x.md' }, createdAt: 1 }, byId)).toBeNull()
    expect(normalizeTab({ ref: { kind: 'ws', nodeId: 'childA', seg: '/x.md' }, createdAt: 1 }, byId)).toBeNull()
  })
})

describe('磁盘路径比较键（diskPathKey）：外部变化的路径要能对上页签的路径', () => {
  it('混血形（反斜杠的根 + 斜杠的后半段）与原生形归一到同一条', () => {
    /*
     * 工作区文件的绝对路径是 userAbsPath 拼的混血形，而主进程 watcher 报回来的是
     * path.join 的原生形（Windows 全反斜杠）——同一份文件的两种写法，直接相等永远对不上。
     * 少这一步，就是「外部删掉 / 改了文件，页签没反应」（见 useDocSaveFlow 的 handleLocalChange）。
     */
    expect(diskPathKey('C:\\root/users/1/docs/微积分/workspace/项目A/a.md')).toBe(
      'C:/root/users/1/docs/微积分/workspace/项目A/a.md',
    )
    expect(diskPathKey('C:\\root\\users\\1\\docs\\微积分\\workspace\\项目A\\a.md')).toBe(
      'C:/root/users/1/docs/微积分/workspace/项目A/a.md',
    )
  })
})

describe('打开内部文件 = 打开关联的 tab 组（openGroupedDoc 接 ws 身份）', () => {
  it('组里没有对应大纲：先开大纲把组建起来，文件进门并置前', () => {
    const docs = openGroupedDoc(emptyDocs(), ws('childA', '项目A/a.md'), 'rootA', goalOfNode, 1)
    expect(allTabs(docs).map((t) => t.ref.kind)).toEqual(['outline', 'ws'])
    expect(docs.groups[0].active).toBe('ws:childA:项目A/a.md')
  })

  it('大纲已经开着：文件落进大纲所在的那一格，不重开第二枚大纲', () => {
    let docs = openGroupedDoc(emptyDocs(), ws('childA', '项目A/a.md'), 'rootA', goalOfNode, 1)
    docs = openGroupedDoc(docs, ws('childA', '项目A/b.md'), 'rootA', goalOfNode, 2)
    expect(allTabs(docs).map((t) => t.ref.kind)).toEqual(['outline', 'ws', 'ws'])
    expect(docs.groups[0].active).toBe('ws:childA:项目A/b.md')
  })
})
