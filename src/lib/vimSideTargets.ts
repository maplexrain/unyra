/**
 * Vim :side / :sd 命令候选提供者：
 * 枚举工作区中除当前聚焦激活页签以外的其他已打开页签，支持拼音首字母、全拼与关键字过滤，
 * 并内置快捷关闭 / 对调动作。选定后在当前页签内开启双栏传送对照（原页签完全不受影响）。
 */

import PinyinModule from 'pinyin-match'
import type { LearnStore, TabRef } from '../learn/types'
import { focusedGroup, focusedTab, visibleTabs } from '../learn/groups'
import { isBlankTab, tabTitle, tabTrail } from '../learn/tabs'
import { nodeById } from '../learn/graph'
import { t } from '../i18n'

const PinyinMatch: { match: (input: string, keys: string) => [number, number] | false } =
  (PinyinModule as { default?: typeof PinyinModule })?.default ?? (PinyinModule as unknown as { match: (input: string, keys: string) => [number, number] | false })

export interface VimSideTarget {
  id: string
  tabId: string
  ref?: TabRef
  title: string
  subtitle?: string
  badge: string
  kind: TabRef['kind'] | 'action'
  actionType: 'open' | 'swap' | 'close'
  action: () => void
}

function sideKindBadge(ref: TabRef): string {
  switch (ref.kind) {
    case 'teach':
      return t('教学文档')
    case 'note':
      return t('笔记')
    case 'outline':
      return t('结构')
    case 'guide':
      return t('大纲导读')
    case 'agentTeam':
      return t('智能体团队')
    case 'local':
      return t('本地文件')
    case 'ws':
      return t('项目文件')
    case 'super':
      return t('超级文档')
    case 'exam':
      return t('试卷副本')
    case 'web':
      return t('网页')
    case 'video':
      return t('视频')
    case 'terminal':
      return t('终端')
    case 'settings':
      return t('设置')
    case 'agentSettings':
      return t('导师设置')
    case 'mind':
      return t('记忆')
    case 'usage':
      return t('用量')
    case 'schedule':
      return t('日程')
    case 'vim':
      return t('Vim 速查')
    case 'user':
      return t('用户中心')
    case 'classroom':
      return t('互动课堂')
    case 'classroomShowcase':
      return t('组件库')
    case 'pluginDoc':
      return t('插件文档')
    case 'sponsors':
      return t('赞助鸣谢')
    case 'draft':
      return t('新建草稿')
    default:
      return t('页签')
  }
}

export interface BuildSideTargetsParams {
  store: LearnStore
  openSidePortal: (targetTabId: string) => void
  closeSidePortal: () => void
  swapSidePortal: () => void
  examTitle?: (examId: string, attemptId: string) => string | undefined
}

/** 从 LearnStore 中构建 `:side` 候选列表（排除当前活动页签，保留其他所有已打开页签） */
export function buildSideTargets(params: BuildSideTargetsParams): VimSideTarget[] {
  const { store, openSidePortal, closeSidePortal, swapSidePortal, examTitle } = params
  const activeTab = focusedTab(store.docArea)
  if (!activeTab) return []

  const curGroup = focusedGroup(store.docArea)
  const curVisibleIds = new Set(
    visibleTabs(curGroup.tabs, store.docArea.tabOwners, store.activeGoalId).map((t) => t.id),
  )

  const goalTitleMap = new Map<string, string>()
  for (const g of store.goals) {
    const label = nodeById(store, g.rootNodeId)?.title || g.title || g.question || ''
    if (label) goalTitleMap.set(g.id, label)
  }

  const seen = new Set<string>([activeTab.id])
  const visibleCandidates: VimSideTarget[] = []
  const otherCandidates: VimSideTarget[] = []

  const nodeLabelOf = (id: string) => nodeById(store, id)?.title ?? ''
  const titleOfNode = (id: string) => nodeById(store, id)?.title
  const goalLabelOf = (gid: string) => goalTitleMap.get(gid) ?? ''
  const videoTitleOf = (vid: string) =>
    store.videoNodes?.find((vn) => vn.id === vid)?.title ?? store.videos?.find((v) => v.id === vid)?.title

  for (const group of store.docArea.groups) {
    for (const tab of group.tabs) {
      if (seen.has(tab.id) || isBlankTab(tab)) continue
      seen.add(tab.id)

      const title =
        tabTitle(tab.ref, titleOfNode, examTitle, videoTitleOf) || tab.id
      const trail = tabTrail(tab.ref, nodeLabelOf, goalLabelOf)
      const isCurrentSide = activeTab.side?.targetTabId === tab.id
      const subtitleParts = [
        trail,
        isCurrentSide ? t('当前正在并排对照') : group.id !== curGroup.id ? t('其他分屏组') : '',
      ].filter(Boolean)

      const item: VimSideTarget = {
        id: tab.id,
        tabId: tab.id,
        ref: tab.ref,
        title,
        subtitle: subtitleParts.join(' · ') || undefined,
        badge: sideKindBadge(tab.ref),
        kind: tab.ref.kind,
        actionType: 'open',
        action: () => openSidePortal(tab.id),
      }

      if (curVisibleIds.has(tab.id)) {
        visibleCandidates.push(item)
      } else {
        otherCandidates.push(item)
      }
    }
  }

  const out: VimSideTarget[] = [...visibleCandidates, ...otherCandidates]

  if (activeTab.side) {
    out.push({
      id: '__side_swap__',
      tabId: activeTab.side.targetTabId,
      title: t('对调左右分栏位置'),
      subtitle: t('等价于双击中间分割线，左右互换并记住比例'),
      badge: 'swap',
      kind: 'action',
      actionType: 'swap',
      action: () => swapSidePortal(),
    })
    out.push({
      id: '__side_close__',
      tabId: activeTab.side.targetTabId,
      title: t('关闭并排对照'),
      subtitle: t('收起传送通道，仅保留原页签全屏显示'),
      badge: 'off',
      kind: 'action',
      actionType: 'close',
      action: () => closeSidePortal(),
    })
  }

  return out
}

export function matchSideTargets(targets: VimSideTarget[], query: string): VimSideTarget[] {
  const q = query.trim()
  if (!q) return targets
  const lowerQ = q.toLowerCase()

  const scored: Array<{ target: VimSideTarget; score: number }> = []
  for (const item of targets) {
    try {
      const mTitle = PinyinMatch.match(item.title, q)
      if (mTitle !== false) {
        scored.push({ target: item, score: 100 - (Array.isArray(mTitle) ? mTitle[0] : 0) })
        continue
      }
    } catch {
      // ignore pinyin match edge cases
    }

    try {
      const mBadge = PinyinMatch.match(item.badge, q)
      if (mBadge !== false) {
        scored.push({ target: item, score: 75 - (Array.isArray(mBadge) ? mBadge[0] : 0) })
        continue
      }
    } catch {
      // ignore
    }

    if (item.subtitle) {
      try {
        const mSub = PinyinMatch.match(item.subtitle, q)
        if (mSub !== false) {
          scored.push({ target: item, score: 55 - (Array.isArray(mSub) ? mSub[0] : 0) })
          continue
        }
      } catch {
        // ignore
      }
    }

    if (item.title.toLowerCase().includes(lowerQ)) {
      scored.push({ target: item, score: 50 })
    } else if (item.badge.toLowerCase().includes(lowerQ)) {
      scored.push({ target: item, score: 35 })
    } else if (item.subtitle?.toLowerCase().includes(lowerQ)) {
      scored.push({ target: item, score: 25 })
    }
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.target)
}

type SideTargetsProvider = () => VimSideTarget[]
let sideTargetsProvider: SideTargetsProvider | null = null

export function setSideTargetsProvider(provider: SideTargetsProvider | null): void {
  sideTargetsProvider = provider
}

export function getSideTargets(query?: string): VimSideTarget[] {
  const all = sideTargetsProvider?.() ?? []
  if (!query) return all
  return matchSideTargets(all, query)
}

export function executeSideCommand(arg: string): { success: boolean; message?: string } {
  const cleanQ = arg.trim()
  const list = getSideTargets(cleanQ)
  if (list.length === 0) {
    return {
      success: false,
      message: cleanQ ? `[未找到匹配页签: ${cleanQ}]` : '[当前没有其他可并排对照的页签]',
    }
  }
  const picked = list[0]
  picked.action()
  return {
    success: true,
    message:
      picked.actionType === 'close'
        ? '[已关闭并排对照]'
        : picked.actionType === 'swap'
          ? '[已对调左右分栏位置]'
          : `[已开启传送对照: ${picked.title.slice(0, 18)}]`,
  }
}

export interface BuildFixSideTargetsParams {
  store: LearnStore
  openFixSidePortal: (targetTabId: string) => void
  closeFixSidePortal: () => void
  swapFixSidePortal: () => void
  toggleFixSideCollapse: () => void
  examTitle?: (examId: string, attemptId: string) => string | undefined
}

/**
 * 构建 `:fixside` 固定外侧对照栏候选列表（枚举全部已打开非空白页签，
 * 因为它独立于页签栏之外，不排除当前激活页签；并附加对调/收起/关闭动作）。
 */
export function buildFixSideTargets(params: BuildFixSideTargetsParams): VimSideTarget[] {
  const { store, openFixSidePortal, closeFixSidePortal, swapFixSidePortal, toggleFixSideCollapse, examTitle } = params
  const curGroup = focusedGroup(store.docArea)
  const curVisibleIds = new Set(
    visibleTabs(curGroup.tabs, store.docArea.tabOwners, store.activeGoalId).map((t) => t.id),
  )

  const goalTitleMap = new Map<string, string>()
  for (const g of store.goals) {
    const label = nodeById(store, g.rootNodeId)?.title || g.title || g.question || ''
    if (label) goalTitleMap.set(g.id, label)
  }

  const seen = new Set<string>()
  const visibleCandidates: VimSideTarget[] = []
  const otherCandidates: VimSideTarget[] = []

  const nodeLabelOf = (id: string) => nodeById(store, id)?.title ?? ''
  const titleOfNode = (id: string) => nodeById(store, id)?.title
  const goalLabelOf = (gid: string) => goalTitleMap.get(gid) ?? ''
  const videoTitleOf = (vid: string) =>
    store.videoNodes?.find((vn) => vn.id === vid)?.title ?? store.videos?.find((v) => v.id === vid)?.title

  for (const group of store.docArea.groups) {
    for (const tab of group.tabs) {
      if (seen.has(tab.id) || isBlankTab(tab)) continue
      seen.add(tab.id)

      const title = tabTitle(tab.ref, titleOfNode, examTitle, videoTitleOf) || tab.id
      const trail = tabTrail(tab.ref, nodeLabelOf, goalLabelOf)
      const isCurrentFixed = store.fixSide?.targetTabId === tab.id
      const subtitleParts = [
        trail,
        isCurrentFixed ? t('当前已在固定外侧栏') : group.id !== curGroup.id ? t('其他分屏组') : '',
      ].filter(Boolean)

      const item: VimSideTarget = {
        id: `fix:${tab.id}`,
        tabId: tab.id,
        ref: tab.ref,
        title,
        subtitle: subtitleParts.join(' · ') || undefined,
        badge: sideKindBadge(tab.ref),
        kind: tab.ref.kind,
        actionType: 'open',
        action: () => openFixSidePortal(tab.id),
      }

      if (curVisibleIds.has(tab.id)) visibleCandidates.push(item)
      else otherCandidates.push(item)
    }
  }

  const out: VimSideTarget[] = [...visibleCandidates, ...otherCandidates]
  if (store.fixSide) {
    out.push(
      {
        id: '__fixside_swap__',
        tabId: store.fixSide.targetTabId,
        title: t('对调固定外侧栏位置'),
        subtitle: t('把固定外侧栏在左右两侧之间对调'),
        badge: 'swap',
        kind: 'action',
        actionType: 'swap',
        action: () => swapFixSidePortal(),
      },
      {
        id: '__fixside_toggle__',
        tabId: store.fixSide.targetTabId,
        title: store.fixSide.collapsed ? t('展开固定外侧栏') : t('收起固定外侧栏'),
        subtitle: t('折叠或展开固定外侧栏，保留当前传送页签'),
        badge: 'toggle',
        kind: 'action',
        actionType: 'swap',
        action: () => toggleFixSideCollapse(),
      },
      {
        id: '__fixside_close__',
        tabId: store.fixSide.targetTabId,
        title: t('关闭固定外侧栏'),
        subtitle: t('关闭页签区外侧固定对照栏'),
        badge: 'off',
        kind: 'action',
        actionType: 'close',
        action: () => closeFixSidePortal(),
      },
    )
  }

  return out
}

let fixSideTargetsProvider: SideTargetsProvider | null = null

export function setFixSideTargetsProvider(provider: SideTargetsProvider | null): void {
  fixSideTargetsProvider = provider
}

export function getFixSideTargets(query?: string): VimSideTarget[] {
  const all = fixSideTargetsProvider?.() ?? []
  if (!query) return all
  return matchSideTargets(all, query)
}

export function executeFixSideCommand(arg: string): { success: boolean; message?: string } {
  const cleanQ = arg.trim()
  const list = getFixSideTargets(cleanQ)
  if (list.length === 0) {
    return {
      success: false,
      message: cleanQ ? `[未找到匹配页签: ${cleanQ}]` : '[当前没有可放入固定外侧栏的页签]',
    }
  }
  const picked = list[0]
  picked.action()
  return {
    success: true,
    message:
      picked.actionType === 'close'
        ? '[已关闭固定外侧栏]'
        : picked.actionType === 'swap'
          ? '[已更新固定外侧栏布局]'
          : `[已打开固定外侧栏: ${picked.title.slice(0, 18)}]`,
  }
}
