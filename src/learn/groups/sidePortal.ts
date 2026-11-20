/**
 * 页签内内置双栏传送通道（Vim :side）的纯状态读写辅助函数：
 * - 更新 / 清除某枚页签上的传送目标与分栏比例；
 * - 双击分割线对调左右位置并镜像比例；
 * - 清理指向已关闭页签的过期传送配置。
 */

import type { FixSideState, LearnTab, TabSidePortal } from '../types'
import { settle } from './core'
import { findTab } from './focus'
import { allStoredTabs } from './tabs'
import type { DocWorkspace } from './types'

export const DEFAULT_SIDE_RATIO = 0.5
export const MIN_SIDE_RATIO = 0.2
export const MAX_SIDE_RATIO = 0.8

export const DEFAULT_FIX_SIDE_WIDTH = 540
export const MIN_FIX_SIDE_WIDTH = 300
export const MAX_FIX_SIDE_WIDTH = 960

export function clampFixSideWidth(width: number | undefined): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) return DEFAULT_FIX_SIDE_WIDTH
  return Math.max(MIN_FIX_SIDE_WIDTH, Math.min(MAX_FIX_SIDE_WIDTH, Math.round(width)))
}

/** 校验并归一 `:fixside` 固定外侧栏持久化状态；目标页签已不在工作区中则返回 undefined */
export function normalizeFixSideState(raw: unknown, docs: DocWorkspace): FixSideState | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const targetTabId = typeof r.targetTabId === 'string' ? r.targetTabId.trim() : ''
  if (!targetTabId) return undefined
  if (!allStoredTabs(docs).some((t) => t.id === targetTabId)) return undefined
  const width = typeof r.width === 'number' && Number.isFinite(r.width) ? clampFixSideWidth(r.width) : undefined
  const left = r.left === true ? true : undefined
  const collapsed = r.collapsed === true ? true : undefined
  return {
    targetTabId,
    ...(width !== undefined ? { width } : {}),
    ...(left !== undefined ? { left } : {}),
    ...(collapsed !== undefined ? { collapsed } : {}),
  }
}

/** 查找 `:fixside` 指向的页签实体（支持活动组与停靠场中存在的已打开页签） */
export function findFixSideTargetTab(
  docs: DocWorkspace,
  fixSide?: FixSideState | null,
): LearnTab | null {
  const targetId = fixSide?.targetTabId
  if (!targetId) return null
  return allStoredTabs(docs).find((t) => t.id === targetId) ?? null
}

export function clampSideRatio(ratio: number | undefined): number {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return DEFAULT_SIDE_RATIO
  return Math.max(MIN_SIDE_RATIO, Math.min(MAX_SIDE_RATIO, Math.round(ratio * 1000) / 1000))
}

function mapAllTabs(
  docs: DocWorkspace,
  mapper: (tab: LearnTab) => LearnTab,
): DocWorkspace {
  let changed = false
  const groups = docs.groups.map((g) => {
    let gChanged = false
    const tabs = g.tabs.map((t) => {
      const next = mapper(t)
      if (next !== t) gChanged = true
      return next
    })
    if (!gChanged) return g
    changed = true
    return { ...g, tabs }
  })
  let parkedTabs = docs.parkedTabs
  if (parkedTabs) {
    let pChanged = false
    const nextParked: Record<string, LearnTab[]> = {}
    for (const [gid, tabs] of Object.entries(parkedTabs)) {
      const nextList = tabs.map((t) => {
        const next = mapper(t)
        if (next !== t) pChanged = true
        return next
      })
      nextParked[gid] = nextList
    }
    if (pChanged) {
      changed = true
      parkedTabs = nextParked
    }
  }
  return changed ? settle({ ...docs, groups, ...(parkedTabs ? { parkedTabs } : {}) }) : docs
}

/** 为指定页签开启、更新或关闭 `:side` 传送通道 */
export function withTabSidePortal(
  docs: DocWorkspace,
  sourceTabId: string,
  nextSide: TabSidePortal | null,
): DocWorkspace {
  if (nextSide && (!nextSide.targetTabId || nextSide.targetTabId === sourceTabId)) {
    return docs
  }
  const normalized: TabSidePortal | undefined = nextSide
    ? {
        targetTabId: nextSide.targetTabId,
        ratio: clampSideRatio(nextSide.ratio),
        ...(nextSide.swapped ? { swapped: true } : {}),
      }
    : undefined

  return mapAllTabs(docs, (t) => {
    if (t.id !== sourceTabId) return t
    if (!normalized) {
      if (!t.side) return t
      const { side: _removed, ...rest } = t
      return rest
    }
    return { ...t, side: normalized }
  })
}

/** 对调某页签的 `:side` 左右分栏位置并同步镜像分割比例 */
export function toggleSwapTabSidePortal(
  docs: DocWorkspace,
  sourceTabId: string,
): DocWorkspace {
  const tab = findTab(docs, sourceTabId)
  if (!tab?.side) return docs
  const curRatio = clampSideRatio(tab.side.ratio)
  return withTabSidePortal(docs, sourceTabId, {
    targetTabId: tab.side.targetTabId,
    ratio: clampSideRatio(1 - curRatio),
    swapped: !tab.side.swapped,
  })
}

/** 更新某页签 `:side` 的分割占比 */
export function setTabSidePortalRatio(
  docs: DocWorkspace,
  sourceTabId: string,
  ratio: number,
): DocWorkspace {
  const tab = findTab(docs, sourceTabId)
  if (!tab?.side) return docs
  return withTabSidePortal(docs, sourceTabId, {
    ...tab.side,
    ratio: clampSideRatio(ratio),
  })
}

/** 清掉指向已不存在（已被关闭）目标页签的 `:side` 传送配置 */
export function pruneStaleSidePortals(docs: DocWorkspace): DocWorkspace {
  const validIds = new Set(allStoredTabs(docs).map((t) => t.id))
  return mapAllTabs(docs, (t) => {
    if (!t.side) return t
    if (t.side.targetTabId === t.id || !validIds.has(t.side.targetTabId)) {
      const { side: _removed, ...rest } = t
      return rest
    }
    return t
  })
}

/** 查找当前页签 `:side` 指向的目标页签实体；目标不可用或指向自身时返回 null */
export function findSideTargetTab(
  docs: DocWorkspace,
  sourceTab: LearnTab | null,
): LearnTab | null {
  const targetId = sourceTab?.side?.targetTabId
  if (!sourceTab || !targetId || targetId === sourceTab.id) return null
  return allStoredTabs(docs).find((t) => t.id === targetId) ?? null
}
