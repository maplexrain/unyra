import { describe, expect, it } from 'vitest'
import {
  FIRST_GROUP,
  closeIds,
  closeIn,
  emptyDocs,
  openInGroup,
} from '../src/learn/groups'
import { makeBlankTab, newBlankKey, tabKey, tabNodeId, tabTitle, tabTrail } from '../src/learn/tabs'
import type { TabRef } from '../src/learn/types'

describe('空白页签（Blank Tab）与保底机制', () => {
  it('makeBlankTab 生成合法的空白页签，身份以 b: 开头', () => {
    const tab1 = makeBlankTab()
    const tab2 = makeBlankTab()
    expect(tab1.ref.kind).toBe('blank')
    expect(tab1.id.startsWith('b:')).toBe(true)
    expect(tab1.id).not.toBe(tab2.id)
    expect(tabTitle(tab1.ref, () => undefined)).toBe('新页签')
    expect(tabNodeId(tab1.ref)).toBeNull()
    expect(tabTrail(tab1.ref, () => '')).toBe('')
  })

  it('emptyDocs 返回的工作区保底包含一枚空白页签，不再有无页签状态', () => {
    const docs = emptyDocs()
    expect(docs.groups).toHaveLength(1)
    expect(docs.groups[0].tabs).toHaveLength(1)
    expect(docs.groups[0].tabs[0].ref.kind).toBe('blank')
    expect(docs.groups[0].active).toBe(docs.groups[0].tabs[0].id)
  })

  it('当仅剩一枚页签被关闭时，settle 自动创建一枚空白页签作为保底', () => {
    let docs = emptyDocs()
    const teachRef: TabRef = { kind: 'teach', nodeId: 'n1' }
    // 打开普通文档，就地替换单张空白页签
    docs = openInGroup(docs, FIRST_GROUP, teachRef, Date.now())
    expect(docs.groups[0].tabs).toHaveLength(1)
    expect(docs.groups[0].tabs[0].ref.kind).toBe('teach')

    // 关闭这枚唯一的普通页签
    docs = closeIn(docs, FIRST_GROUP, docs.groups[0].tabs[0].id, 'self')
    expect(docs.groups[0].tabs).toHaveLength(1)
    expect(docs.groups[0].tabs[0].ref.kind).toBe('blank')
    expect(docs.groups[0].active).toBe(docs.groups[0].tabs[0].id)
  })

  it('关闭空白页签自身且只有这一枚时，自动重置生成保底空白页签', () => {
    let docs = emptyDocs()
    const blankId = docs.groups[0].tabs[0].id
    docs = closeIn(docs, FIRST_GROUP, blankId, 'self')
    expect(docs.groups[0].tabs).toHaveLength(1)
    expect(docs.groups[0].tabs[0].ref.kind).toBe('blank')
    // 新生成的空白页签拥有新的 id
    expect(docs.groups[0].tabs[0].id).not.toBe(blankId)
  })

  it('在仅有一枚空白页签的组中打开非空白页签，自动就地替换', () => {
    let docs = emptyDocs()
    const blankId = docs.groups[0].tabs[0].id
    const noteRef: TabRef = { kind: 'note', nodeId: 'n1', note: '我的笔记' }
    docs = openInGroup(docs, FIRST_GROUP, noteRef, Date.now())
    expect(docs.groups[0].tabs).toHaveLength(1)
    expect(docs.groups[0].tabs[0].ref.kind).toBe('note')
    expect(docs.groups[0].tabs[0].id).toBe('n:n1:我的笔记')
    expect(docs.groups[0].tabs[0].id).not.toBe(blankId)
  })

  it('在已有其它页签的情况下打开空白页签，作为新页签追加', () => {
    let docs = emptyDocs()
    const teachRef: TabRef = { kind: 'teach', nodeId: 'n1' }
    docs = openInGroup(docs, FIRST_GROUP, teachRef, Date.now())
    const blankRef: TabRef = { kind: 'blank', key: newBlankKey() }
    docs = openInGroup(docs, FIRST_GROUP, blankRef, Date.now())
    expect(docs.groups[0].tabs).toHaveLength(2)
    expect(docs.groups[0].tabs[0].ref.kind).toBe('teach')
    expect(docs.groups[0].tabs[1].ref.kind).toBe('blank')
    expect(docs.groups[0].active).toBe(tabKey(blankRef))
  })

  it('closeIds 批量关闭所有页签后，自动生成保底空白页签', () => {
    let docs = emptyDocs()
    const t1: TabRef = { kind: 'teach', nodeId: 'n1' }
    const t2: TabRef = { kind: 'teach', nodeId: 'n2' }
    docs = openInGroup(docs, FIRST_GROUP, t1, Date.now())
    docs = openInGroup(docs, FIRST_GROUP, t2, Date.now())
    expect(docs.groups[0].tabs).toHaveLength(2)

    docs = closeIds(docs, [tabKey(t1), tabKey(t2)])
    expect(docs.groups[0].tabs).toHaveLength(1)
    expect(docs.groups[0].tabs[0].ref.kind).toBe('blank')
  })
})
