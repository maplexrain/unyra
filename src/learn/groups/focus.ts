/** 这个文件负责：焦点格与「这一格在看哪一份」——focusedGroup / focusedTab / setFocus，以及按页签反查它在哪一格 */

import type { LearnTab } from '../types'
import { groupOf, settle, withDocs } from './core'
import { FIRST_GROUP } from './layout'
import type { DocGroup, DocWorkspace } from './types'

/* ---------- 读 ---------- */

/** 焦点组；焦点指着一个已经不存在的组时退回第一组（state.json 被手改过时也站得住） */
export function focusedGroup(docs: DocWorkspace): DocGroup {
  return groupOf(docs, docs.focus) ?? docs.groups[0] ?? { id: FIRST_GROUP, tabs: [], active: null }
}

/** 焦点组里激活的那个页签；没有就是 null（「当前在看哪份文档」的唯一出处） */
export function focusedTab(docs: DocWorkspace): LearnTab | null {
  const g = focusedGroup(docs)
  return g.tabs.find((t) => t.id === g.active) ?? null
}

/** 某个页签在哪个组里；不在任何组里（刚被关掉）时 null */
export function groupIdOfTab(docs: DocWorkspace, tabId: string): string | null {
  for (const g of docs.groups) if (g.tabs.some((t) => t.id === tabId)) return g.id
  return null
}

export function findTab(docs: DocWorkspace, tabId: string): LearnTab | undefined {
  for (const g of docs.groups) {
    const t = g.tabs.find((x) => x.id === tabId)
    if (t) return t
  }
  return undefined
}

/** 设焦点（点某一格、往某一格开页签都走它） */
export function setFocus(docs: DocWorkspace, groupId: string): DocWorkspace {
  return groupOf(docs, groupId) ? settle(withDocs(docs, { focus: groupId })) : docs
}
