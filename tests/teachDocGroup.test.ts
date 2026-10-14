import { describe, expect, it } from 'vitest'
import {
  FIRST_GROUP,
  claimTab,
  emptyDocs,
  groupIdOfTab,
  openInGroup,
  openGroupedDoc,
  splitWith,
  withOwners,
  withParked,
} from '../src/learn/groups'
import { makeTab, tabKey } from '../src/learn/tabs'
import type { TabRef } from '../src/learn/types'

/**
 * 教学文档打开的**组联动**（需求原文：「如果教学文档不是从大纲打开的，那么打开时需要
 * 查看缓存中的 tab 组是否存在该教学文档对应的大纲：存在就把该 tab 组打开，
 * 不存在就先打开一个大纲创建 tab 组，然后再打开文档」）。
 *
 * 「对应的大纲」= 目标根节点那一份；「缓存中的 tab 组」= 停靠场和栏上开着的那一份
 * （见 groups/tabs 的 openGroupedDoc 文档串）。纯函数层可以钉住的就这四组情形。
 */
const goalOf = (id: string): string | null => {
  if (id === 'rootA') return 'gA'
  if (id === 'rootB') return 'gB'
  if (id.startsWith('a')) return 'gA'
  if (id.startsWith('b')) return 'gB'
  return null
}

const teach = (nodeId: string): TabRef & { kind: 'teach' } => ({ kind: 'teach', nodeId })
const outline = (nodeId: string): TabRef & { kind: 'outline' } => ({ kind: 'outline', nodeId })

describe('教学文档打开的组联动（openGroupedDoc）', () => {
  it('组里没有对应大纲：先开大纲把组建起来（归属当场登记），再开文档（文档置前）', () => {
    const docs = openGroupedDoc(emptyDocs(), teach('a1'), 'rootA', goalOf, 1)
    expect(docs.groups[0].tabs.map((t) => t.ref.kind)).toEqual(['outline', 'teach'])
    expect(docs.groups[0].active).toBe(tabKey(teach('a1')))
    // 自动开的锚要当场登记归属：漏登记的话它在归属表里查无此人，切目标时到处飘
    expect(docs.tabOwners?.gA).toContain(tabKey(outline('rootA')))
  })

  it('大纲已经开着：文档落进大纲所在的那一格并置前，不重开第二枚大纲', () => {
    let docs = openGroupedDoc(emptyDocs(), teach('a1'), 'rootA', goalOf, 1)
    docs = openGroupedDoc(docs, teach('a2'), 'rootA', goalOf, 2)
    expect(docs.groups[0].tabs.map((t) => t.ref.kind)).toEqual(['outline', 'teach', 'teach'])
    expect(docs.groups[0].active).toBe(tabKey(teach('a2')))
  })

  it('大纲开在另一格（分屏）：教学文档也要落进大纲那一格，焦点跟着过去', () => {
    let docs = openGroupedDoc(emptyDocs(), teach('a1'), 'rootA', goalOf, 1)
    // 把教学文档拖到右边拆出一格：焦点现在落在新格上
    docs = splitWith(docs, FIRST_GROUP, 'row', 'after', tabKey(teach('a1')))
    expect(docs.focus).not.toBe(FIRST_GROUP)
    docs = openGroupedDoc(docs, teach('a2'), 'rootA', goalOf, 2)
    const home = groupIdOfTab(docs, tabKey(outline('rootA')))
    expect(groupIdOfTab(docs, tabKey(teach('a2')))).toBe(home)
    expect(docs.focus).toBe(home)
  })

  it('组停靠在缓存里（关过大纲）：先开大纲时整组归队，再开文档', () => {
    // 上一次在这个目标里开着的一份笔记，随大纲一起停靠着
    const parked = [makeTab({ kind: 'note', nodeId: 'a1', note: '我的笔记' }, 0)]
    let docs = withParked(emptyDocs(), { gA: parked })
    docs = openGroupedDoc(docs, teach('a2'), 'rootA', goalOf, 3)
    const kinds = docs.groups[0].tabs.map((t) => t.ref.kind)
    expect(kinds).toContain('outline')
    expect(kinds).toContain('note')
    expect(kinds).toContain('teach')
    // 最终激活的是新开的教学文档；停靠场已清空
    expect(docs.groups[0].active).toBe(tabKey(teach('a2')))
    expect(docs.parkedTabs?.gA).toBeUndefined()
  })

  it('拿不到根节点时不扣下文档：退回普通开法', () => {
    const docs = openGroupedDoc(emptyDocs(), teach('a1'), null, goalOf, 1)
    expect(docs.groups[0].tabs.map((t) => t.ref.kind)).toEqual(['teach'])
  })

  it('栏上只剩空白占位（切到另一个目标后的日常）：打开教学文档时占位消失', () => {
    // A 目标：大纲 + 教学文档都开着、登记在 gA 名下
    let docs = openGroupedDoc(emptyDocs(), teach('a1'), 'rootA', goalOf, 1)
    let owners = claimTab(docs.tabOwners, 'gA', tabKey(outline('rootA')))
    owners = claimTab(owners, 'gA', tabKey(teach('a1')))
    docs = withOwners(docs, owners)
    // 用户又开了一枚空白占位（此刻 A 的东西还看得见，不顶替）
    const blankRef: TabRef = { kind: 'blank', key: 'bk' }
    docs = openInGroup(docs, FIRST_GROUP, blankRef, 2, undefined, goalOf)
    docs = withOwners(docs, claimTab(docs.tabOwners, '', tabKey(blankRef)))
    // 打开 B 目标的教学文档：先开 B 的大纲——这一步里空白占位就该让位——再开文档
    docs = openGroupedDoc(docs, teach('b1'), 'rootB', goalOf, 3)
    const kinds = docs.groups[0].tabs.map((t) => t.ref.kind)
    expect(kinds).not.toContain('blank')
    expect(kinds.filter((k) => k === 'outline')).toHaveLength(2) // A 大纲还躺在格子里（切回 A 照旧）
    expect(docs.groups[0].active).toBe(tabKey(teach('b1')))
  })
})
