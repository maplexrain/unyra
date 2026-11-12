import type { LearnStore, LearnTab, TabRef } from '../../../learn/types'
import type { DocWorkspace } from '../../../learn/groups/types'
import { isTabRefPreviewable, makeTab, tabKey } from '../../../learn/tabs'
import { groupIdOfTab, groupOf, openInGroup, settle } from '../../../learn/groups'
import { insertBeside, newId } from '../../../learn/groups/layout'
import { claimTab, refOwner, withOwners } from '../../../learn/groups/goals'

/**
 * 计算对偶视图页签（源码 <-> 预览）
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
  // 无法预览的文件不生成预览视图
  if (targetView === 'preview' && !isTabRefPreviewable(ref)) {
    return null
  }
  return { ...ref, view: targetView }
}

/**
 * 打开对偶视图（剥离独立的源码与预览页面，支持分屏浏览）：
 * 1. 如果对偶页签已在工作区的某格开着，直接切换至该格并激活；
 * 2. 如果当前已有多个分割格（已分屏），将对偶页签在相邻的另一格中打开；
 * 3. 如果当前只有单格，自动向右水平分屏（dir: row, side: after），在右侧新建格并打开对偶页签。
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

  // 1. 若对偶页签已在某个格中存在，直接切换至该格并激活
  const existingGroupId = groupIdOfTab(docs, sisterId)
  if (existingGroupId) {
    const g = groupOf(docs, existingGroupId)
    if (!g) return
    const updatedDocs = {
      ...docs,
      groups: docs.groups.map((group) =>
        group.id === existingGroupId ? { ...group, active: sisterId } : group,
      ),
      focus: existingGroupId,
    }
    setStore({ ...store, docArea: updatedDocs })
    return
  }

  // 2. 若已有其它分割格（如已分两栏），优先在相邻格中打开
  if (docs.groups.length > 1) {
    const targetGroup = docs.groups.find((g) => g.id !== currentGroupId) ?? docs.groups[0]
    const goalOfNode = (nodeId: string) => store.goals.some((g) => g.id === nodeId) ? nodeId : null
    const opened = openInGroup(docs, targetGroup.id, sisterRef, Date.now(), targetView, goalOfNode)
    const owner = refOwner(sisterRef, goalOfNode)
    setStore({
      ...store,
      docArea: withOwners(opened, claimTab(opened.tabOwners, owner, sisterId)),
    })
    return
  }

  // 3. 当前只有单格：向右分屏并在右侧打开对偶视图
  const newGroupId = newId('g')
  const newSplitId = newId('s')
  const sisterTab = makeTab(sisterRef, Date.now(), targetView)

  const newLayout = insertBeside(
    docs.layout,
    currentGroupId,
    'after',
    { kind: 'group', group: newGroupId },
    newSplitId,
    'row',
  )
  const goalOfNode = (nodeId: string) => store.goals.some((g) => g.id === nodeId) ? nodeId : null
  const owner = refOwner(sisterRef, goalOfNode)

  const nextDocs: DocWorkspace = settle({
    ...docs,
    layout: newLayout,
    groups: [...docs.groups, { id: newGroupId, tabs: [sisterTab], active: sisterTab.id }],
    focus: newGroupId,
  })

  setStore({
    ...store,
    docArea: withOwners(nextDocs, claimTab(nextDocs.tabOwners, owner, sisterId)),
  })
}
