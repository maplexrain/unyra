import type { LearnStore, LearnTab, TabRef } from '../../../learn/types'
import { isTabRefPreviewable, tabKey } from '../../../learn/tabs'
import { groupOf, openInGroup } from '../../../learn/groups'
import { claimTab, refOwner, withOwners } from '../../../learn/groups/goals'

/**
 * 计算对偶页面页签（编辑页面 <-> 浏览页面）
 */
export function sisterTabRef(ref: TabRef, targetView: 'source' | 'preview'): TabRef | null {
  if (
    ref.kind !== 'local' &&
    ref.kind !== 'ws' &&
    ref.kind !== 'note' &&
    ref.kind !== 'teach' &&
    ref.kind !== 'super'
  ) {
    return null
  }
  // 无法预览的文件不生成浏览视图
  if (targetView === 'preview' && !isTabRefPreviewable(ref)) {
    return null
  }
  return { ...ref, view: targetView }
}

/**
 * 打开对偶文档页面（编辑页面 <-> 浏览页面）：
 * 严格在当前 tab 组打开并跳转激活，彻底杜绝自动新建分屏。
 */
export function openSisterDocView(
  store: LearnStore,
  currentTab: LearnTab,
  targetView: 'source' | 'preview',
  currentGroupId: string,
  setStore: (s: LearnStore) => void,
): void {
  const sisterRef = sisterTabRef(currentTab.ref, targetView)
  if (!sisterRef) return

  const sisterId = tabKey(sisterRef)
  const docs = store.docArea
  const currentGroup = groupOf(docs, currentGroupId)
  if (!currentGroup) return

  // 1. 若当前组内已存在对偶页签，直接在当前组激活选中并跳转
  const tabInCurrentGroup = currentGroup.tabs.some((t) => t.id === sisterId)
  if (tabInCurrentGroup) {
    const updatedDocs = {
      ...docs,
      groups: docs.groups.map((group) =>
        group.id === currentGroupId ? { ...group, active: sisterId } : group,
      ),
      focus: currentGroupId,
    }
    setStore({ ...store, docArea: updatedDocs })
    return
  }

  // 2. 当前组内没有：在当前 tab 组直接开辟对偶页签并跳转，绝不开设新分屏
  const goalOfNode = (nodeId: string) => store.goals.some((g) => g.id === nodeId) ? nodeId : null
  const opened = openInGroup(docs, currentGroupId, sisterRef, Date.now(), targetView, goalOfNode)
  const owner = refOwner(sisterRef, goalOfNode)

  setStore({
    ...store,
    docArea: withOwners(opened, claimTab(opened.tabOwners, owner, sisterId)),
  })
}
