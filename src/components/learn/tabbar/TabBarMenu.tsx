/*
 * 这个文件负责：文档区页签栏的**两张右键菜单**——
 * TabMenu：右键点在某**一枚页签**上（收藏 / 固定 / 各式关闭，含按知识图谱关系关）；
 * BarMenu：右键点在**栏上空白处**（开新网页页签 / 全部关闭）。
 *
 * 两张菜单都与侧栏、agent 栏的右键菜单共用同一副骨架（见下面 ROW / ICON 两个常量）
 * 与同一套收起手法（lib/useDismiss）。菜单本体不认 store 以外的东西：
 * 能关哪些、关掉几项，都由门面按此刻的页签算好再递进来。
 */

import { useMemo, useRef } from 'react'
import { CornerDownRight, CornerLeftUp, FileX, FoldHorizontal, Globe, OctagonX, Pin, PinOff, Star, Unlink, X } from 'lucide-react'
import type { LearnStore, LearnTab } from '../../../learn/types'
import { TAB_CLOSE_LABEL, isDocumentTab, isTabPinned, tabNodeId, type TabCloseMode } from '../../../learn/tabs'
import { useClampToViewport, useDismissOn } from '../../../lib/useDismiss'
import { t } from '../../../i18n'
import { buildDirectedDistanceMaps, computeTabRelationWithMaps } from './tabRelation'

export function BarMenu({
  menu,
  canCloseAll,
  count,
  onOpenWebTab,
  onCloseAll,
  onClose,
}: {
  menu: { x: number; y: number }
  canCloseAll: boolean
  count: number
  onOpenWebTab: () => void
  onCloseAll: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useDismissOn({ onClose })
  useClampToViewport(ref, menu)
  return (
    <div
      ref={ref}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      className="moji-in-soft fixed z-[90] min-w-[196px] max-w-[240px] rounded-lg border border-line-strong bg-card p-1 shadow-[0_12px_36px_rgba(31,27,23,0.24)]"
    >
      <button type="button" role="menuitem" onClick={onOpenWebTab} className={ROW}>
        <span className={ICON}>
          <Globe size={13} className="text-ink-soft" />
        </span>
        {t('打开新浏览器标签页')}
      </button>
      <span aria-hidden="true" className="my-1 block h-px bg-line" />
      <button
        type="button"
        role="menuitem"
        disabled={!canCloseAll}
        onClick={onCloseAll}
        className={ROW + ' text-seal-deep hover:bg-seal/10'}
      >
        <span className={ICON}>
          <OctagonX size={13} />
        </span>
        {t(TAB_CLOSE_LABEL.all)}
        <span className={COUNT}>{count}</span>
      </button>
    </div>
  )
}

/** 菜单里整行的一项 */
const ROW =
  'flex w-full items-center gap-2.5 rounded-md py-1.5 pl-2 pr-2.5 text-left text-[12px] text-ink transition hover:bg-line/60 disabled:opacity-40 disabled:hover:bg-transparent'
/** 图标那一格：固定宽，于是所有标签的左边缘对齐——**菜单的骨架就是这一列** */
const ICON = 'flex w-[14px] shrink-0 items-center justify-center'
/** 右侧那枚淡数：这一下会关掉几项 */
const COUNT = 'ml-auto pl-3 text-[11px] tabular-nums text-ink-faint'

/**
 * 页签右键菜单：收藏（或取消收藏）/ 关闭 / 关闭其他 / 关闭无关联 / 关闭子级 / 关闭父级 / 关闭非文档 / 全部关闭。
 *
 * 排版规矩：一枚图标 + 一个左对齐的标签，图标对齐在同一列上。
 * 右侧那枚淡淡的数字是会关掉几项。
 * 没有可关的那些项置灰。
 */
export function TabMenu({
  menu,
  label,
  tabs,
  paneTotal: _paneTotal,
  favorited,
  onToggleFavorite,
  onTogglePin,
  onClose,
  onPick,
  store,
}: {
  menu: { x: number; y: number; id: string }
  /** 这一项的名字（抬头那一行）：右键菜单先说清「是对着哪一个」 */
  label: string
  tabs: LearnTab[]
  /** 这一格的物理页签总数（「全部关闭」按整格算，见 TabBar 的 Props.paneTotal） */
  paneTotal?: number
  /** 这一项收藏了没有（决定星标是实是虚、文案是「收藏」还是「取消收藏」） */
  favorited: boolean
  onToggleFavorite: () => void
  onTogglePin?: (tab: LearnTab) => void
  onClose: () => void
  onPick: (mode: TabCloseMode, closingIds?: string[]) => void
  store?: LearnStore
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const targetTab = useMemo(() => tabs.find((t) => t.id === menu.id) ?? null, [tabs, menu.id])
  const targetIsPinned = targetTab ? isTabPinned(targetTab) : false
  const otherCount = tabs.filter((x) => x.id !== menu.id && !isTabPinned(x)).length
  const targetBaseNodeId = targetTab ? tabNodeId(targetTab.ref) : null

  const { ancestorDistMap, descendantDistMap } = useMemo(() => {
    return buildDirectedDistanceMaps(store?.edges, targetBaseNodeId)
  }, [store?.edges, targetBaseNodeId])

  // 1. 关闭无关联：与 targetTab 无拓扑/同节点关联的其它页签（不含大纲）
  const unrelatedIds = useMemo(() => {
    if (!targetTab) return []
    return tabs
      .filter((t) => {
        if (t.id === targetTab.id || isTabPinned(t)) return false
        const rel = computeTabRelationWithMaps(t, targetTab, ancestorDistMap, descendantDistMap)
        return rel.kind === 'none'
      })
      .map((t) => t.id)
  }, [tabs, targetTab, ancestorDistMap, descendantDistMap])

  // 2. 关闭子级：拓扑上的下位知识点页签（不含大纲）
  const childrenIds = useMemo(() => {
    if (!targetTab) return []
    return tabs
      .filter((t) => {
        if (isTabPinned(t)) return false
        const rel = computeTabRelationWithMaps(t, targetTab, ancestorDistMap, descendantDistMap)
        return rel.kind === 'child'
      })
      .map((t) => t.id)
  }, [tabs, targetTab, ancestorDistMap, descendantDistMap])

  // 3. 关闭父级：拓扑上的上位知识点页签（不含大纲）
  const parentsIds = useMemo(() => {
    if (!targetTab) return []
    return tabs
      .filter((t) => {
        if (isTabPinned(t)) return false
        const rel = computeTabRelationWithMaps(t, targetTab, ancestorDistMap, descendantDistMap)
        return rel.kind === 'parent'
      })
      .map((t) => t.id)
  }, [tabs, targetTab, ancestorDistMap, descendantDistMap])

  // 4. 关闭非文档：不是 teach/note/super/local 的非纯文档类页签（web、系统设置等，不含大纲）
  const nonDocIds = useMemo(() => {
    const nonDocs = tabs.filter((t) => !isDocumentTab(t.ref) && !isTabPinned(t))
    if (nonDocs.length <= 1 && nonDocs.some((t) => t.id === targetTab?.id)) return []
    return nonDocs.map((t) => t.id)
  }, [tabs, targetTab])

  const hasRelationClose =
    unrelatedIds.length > 0 ||
    childrenIds.length > 0 ||
    parentsIds.length > 0 ||
    nonDocIds.length > 0

  /*
   * 点别处 / 滚动 / Esc / 改窗口大小都收起，并把菜单夹进视口：这两条与资源管理器
   * 右键菜单共用一份实现（为什么要收在 mousedown 上、8px 余量怎么算，见 lib/useDismiss）。
   */
  useDismissOn({ onClose })
  useClampToViewport(ref, menu)

  return (
    <div
      ref={ref}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      className="moji-in-soft fixed z-[90] min-w-[196px] max-w-[240px] rounded-lg border border-line-strong bg-card p-1 shadow-[0_12px_36px_rgba(31,27,23,0.24)]"
    >
      {/*
        抬头：这一下是对着哪一份文档。与节点、笔记那两张菜单同一条规矩——
        右键菜单是「此刻对着这一项」的东西，先说清是哪一个，再看能做什么。
      */}
      <div className="truncate px-2.5 py-1 text-[10.5px] text-ink-faint" title={label}>
        {label}
      </div>

      {/*
        收藏：菜单的第一项（星标实 = 已收藏，再点就取消）。它与「关闭」是两类事，
        中间隔一道线；收藏是留下轨迹的温和动作，排在最前面。
      */}
      <button type="button" role="menuitem" onClick={onToggleFavorite} className={ROW}>
        <span className={ICON}>
          <Star
            size={13}
            className={favorited ? 'text-seal' : 'text-ink-soft'}
            fill={favorited ? 'currentColor' : 'none'}
          />
        </span>
        {favorited ? t('取消收藏') : t('收藏')}
      </button>

      {onTogglePin && targetTab && targetTab.ref.kind !== 'outline' && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onTogglePin(targetTab)
            onClose()
          }}
          className={ROW}
        >
          <span className={ICON}>
            {targetIsPinned ? (
              <PinOff size={13} className="text-seal" />
            ) : (
              <Pin size={13} className="text-ink-soft" />
            )}
          </span>
          {targetIsPinned ? t('取消固定标签页') : t('固定标签页')}
        </button>
      )}

      <span aria-hidden="true" className="my-1 block h-px bg-line" />

      {/* 关闭这一项：一枚普通的叉，中性色 */}
      <button type="button" role="menuitem" onClick={() => onPick('self')} className={ROW}>
        <span className={ICON}>
          <X size={13} className="text-ink-soft" />
        </span>
        {t(TAB_CLOSE_LABEL.self)}
      </button>

      {/* 关闭其他：有其他页签时才显示（排除大纲）。 */}
      {otherCount > 0 && (
        <button
          type="button"
          role="menuitem"
          onClick={() => onPick('others', tabs.filter((x) => x.id !== menu.id && !isTabPinned(x)).map((x) => x.id))}
          className={ROW}
        >
          <span className={ICON}>
            <FoldHorizontal size={13} className="text-seal" />
          </span>
          {t(TAB_CLOSE_LABEL.others)}
          <span className={COUNT}>{otherCount}</span>
        </button>
      )}

      {/* 关联与类型关闭操作组：存在实际可关目标时才渲染 */}
      {hasRelationClose && (
        <>
          <span aria-hidden="true" className="my-1 block h-px bg-line" />
          {unrelatedIds.length > 0 && (
            <button
              type="button"
              role="menuitem"
              onClick={() => onPick('unrelated', unrelatedIds)}
              className={ROW}
            >
              <span className={ICON}>
                <Unlink size={13} className="text-seal" />
              </span>
              {t(TAB_CLOSE_LABEL.unrelated)}
              <span className={COUNT}>{unrelatedIds.length}</span>
            </button>
          )}
          {childrenIds.length > 0 && (
            <button
              type="button"
              role="menuitem"
              onClick={() => onPick('children', childrenIds)}
              className={ROW}
            >
              <span className={ICON}>
                <CornerDownRight size={13} className="text-seal" />
              </span>
              {t(TAB_CLOSE_LABEL.children)}
              <span className={COUNT}>{childrenIds.length}</span>
            </button>
          )}
          {parentsIds.length > 0 && (
            <button
              type="button"
              role="menuitem"
              onClick={() => onPick('parents', parentsIds)}
              className={ROW}
            >
              <span className={ICON}>
                <CornerLeftUp size={13} className="text-seal" />
              </span>
              {t(TAB_CLOSE_LABEL.parents)}
              <span className={COUNT}>{parentsIds.length}</span>
            </button>
          )}
          {nonDocIds.length > 0 && (
            <button
              type="button"
              role="menuitem"
              onClick={() => onPick('nonDocs', nonDocIds)}
              className={ROW}
            >
              <span className={ICON}>
                <FileX size={13} className="text-seal" />
              </span>
              {t(TAB_CLOSE_LABEL.nonDocs)}
              <span className={COUNT}>{nonDocIds.length}</span>
            </button>
          )}
        </>
      )}

      {/* 全部关闭：只在存在可关项时渲染（排除大纲）。 */}
      {tabs.filter((t) => !isTabPinned(t)).length > (targetIsPinned ? 0 : 1) && (
        <>
          <span aria-hidden="true" className="my-1 block h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            title={t('这一格里的页签全部关掉（不影响固定标签页）')}
            onClick={() => onPick('all')}
            className={ROW + ' text-seal-deep hover:bg-seal/10'}
          >
            <span className={ICON}>
              <OctagonX size={13} />
            </span>
            {t(TAB_CLOSE_LABEL.all)}
            <span className={COUNT}>{tabs.filter((t) => !isTabPinned(t)).length}</span>
          </button>
        </>
      )}
    </div>
  )
}
