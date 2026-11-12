/*
 * 这个文件负责：页签条的**渲染**——两条页签区（固定区 + 横向滚动区）与其中的一枚页签（TabItem）。
 *
 * 纯展示组件：自己什么都不持有。拖拽会话（useTabBarDnd）、
 * 右键菜单（TabBarMenu）都在门面（TabBar）那里，要什么回调就递什么回调。
 * 落位与让位按「栏上此刻画着的这一份」算（含退场中的页签，见 lib/tabPresence）。
 */

import { BookOpen, Pin, Plus, X } from 'lucide-react'
import type { RefObject } from 'react'
import type { TabPresence } from '../../../lib/tabPresence'
import type { ChipPayload } from '../../../lib/docChip'
import { CHIP_MIME, parseChipJson } from '../../../lib/chipSyntax'
import type { LearnTab, TabRef, WebTabMeta } from '../../../learn/types'
import { isBlankTab, type TabCloseMode } from '../../../learn/tabs'
import { t } from '../../../i18n'
import { tabShift, type DragState } from './barGeometry'
import { isTeachDocTab, type TabRelation } from './tabRelation'
import { StackedChevron } from './StackedChevron'
import { TabTypeIcon, VideoAudioButton } from './TabIcons'
import { spawnInkRipple } from '../../../lib/motion'

export function TabItem({
  p,
  index,
  isPinned,
  activeId,
  activeTab,
  activeTabTitle,
  drag,
  settle,
  unsaved,
  relationMap,
  titleOf,
  trailOf,
  webMetaOf,
  justDragged,
  onActivate,
  onClose,
  onMenuOpen,
  onTabDown,
  onTabMove,
  onEndDrag,
}: {
  /** 栏上这一枚的进出场状态（含页签本身）：栏上画的是这一份，不是 props 的列表 */
  p: TabPresence<LearnTab>
  /** 它在这条区段（固定区 / 滚动区）里的下标：拖拽落位与让位位移都按它算 */
  index: number
  isPinned: boolean
  activeId: string | null
  /** 当前页签那枚页签本身：页签间的关系说明只在真有「当前页签」时才报（见 relationTooltip） */
  activeTab: LearnTab | null
  /** 当前页签的标题：页签间的关系说明要报「属于哪一份」 */
  activeTabTitle: string
  drag: DragState | null
  settle: { id: string; offset: number } | null
  /** 有未保存改动的页签 id：关闭键画成一颗圆点 */
  unsaved: ReadonlySet<string>
  /** 页签 id → 与当前页签的知识图谱关系（见 tabRelation） */
  relationMap: Map<string, TabRelation>
  titleOf: (ref: TabRef) => string
  trailOf?: (ref: TabRef) => string
  webMetaOf?: (tab: LearnTab) => WebTabMeta | undefined
  /** 刚刚拖完的那一下不算点击（见 useTabBarDnd 的 justDragged） */
  justDragged: RefObject<boolean>
  onActivate: (id: string) => void
  onClose: (id: string, mode: TabCloseMode, opts?: { closingIds?: string[] }) => void
  /** 右键某一枚页签：交给门面开它的菜单 */
  onMenuOpen: (id: string, x: number, y: number) => void
  onTabDown: (e: React.PointerEvent<HTMLDivElement>, id: string, from: number, isPinned: boolean) => void
  onTabMove: (e: React.PointerEvent<HTMLDivElement>, id: string) => void
  onEndDrag: (commit: boolean, x?: number, y?: number) => void
}) {
  const { item: tab, leaving, exiting, entering } = p
  const on = tab.id === activeId
  const wmeta = webMetaOf?.(tab)
  const struct = tab.ref.kind === 'outline'
  const realTitle = titleOf(tab.ref)
  const title = struct ? t('结构') : ((tab.ref.kind === 'web' ? wmeta?.title : undefined) ?? realTitle)
  const trail = struct ? '' : (trailOf?.(tab.ref) ?? '')
  const dragging = drag?.id === tab.id
  const settling = settle?.id === tab.id
  const dirty = unsaved.has(tab.id)
  const lifted = dragging && !!drag?.lifted
  const blank = isBlankTab(tab)
  const idleBlank = blank && !on && !dragging && !settling && !exiting
  const shift = tabShift(drag, index, isPinned)
  const offset = dragging && !lifted ? drag.dx : settling ? settle.offset : shift

  const relation = relationMap.get(tab.id) ?? { kind: 'none', depth: 0 }
  const relationCls =
    relation.kind === 'same-node'
      ? 'border-transparent bg-sky-500/[0.04] hover:bg-sky-500/[0.08] dark:bg-sky-400/[0.03] dark:hover:bg-sky-400/[0.06] text-ink-soft hover:text-ink '
      : relation.kind === 'parent'
        ? 'border-transparent bg-amber-500/[0.04] hover:bg-amber-500/[0.08] dark:bg-amber-400/[0.03] dark:hover:bg-amber-400/[0.06] text-ink-soft hover:text-ink '
        : relation.kind === 'child'
          ? 'border-transparent bg-emerald-500/[0.04] hover:bg-emerald-500/[0.08] dark:bg-emerald-400/[0.03] dark:hover:bg-emerald-400/[0.06] text-ink-soft hover:text-ink '
          : ''

  const relationTooltip =
    activeTab && relation.kind === 'parent'
      ? relation.depth === 1
        ? t('（父节点文档，属于「{0}」）', activeTabTitle)
        : relation.depth === 2
          ? t('（祖父节点文档，属于「{0}」）', activeTabTitle)
          : relation.depth === 3
            ? t('（曾祖节点文档，属于「{0}」）', activeTabTitle)
            : t('（上位第 {0} 级节点文档，属于「{1}」）', relation.depth, activeTabTitle)
      : activeTab && relation.kind === 'child'
        ? relation.depth === 1
          ? t('（子节点文档，属于「{0}」）', activeTabTitle)
          : relation.depth === 2
            ? t('（孙节点文档，属于「{0}」）', activeTabTitle)
            : relation.depth === 3
              ? t('（曾孙节点文档，属于「{0}」）', activeTabTitle)
              : t('（下位第 {0} 级节点文档，属于「{1}」）', relation.depth, activeTabTitle)
        : activeTab && relation.kind === 'same-node'
          ? t('（同属节点「{0}」）', activeTabTitle)
          : ''

  const cls =
    'moji-tab group relative flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-[12px] moji-press ' +
    (struct ? 'min-w-0 ' : isPinned ? 'min-w-0 max-w-[180px] ' : 'min-w-[120px] max-w-[220px] ') +
    (on ? 'moji-tab-flare z-10 font-medium ' : '') +
    (dragging || settling
      ? 'z-10 cursor-grabbing border-line-strong bg-card text-ink-strong shadow-md'
      : struct
        ? on
          ? 'border-line-strong bg-card moji-tab-struct'
          : 'border-transparent moji-tab-struct hover:bg-line/50'
        : (relationCls ||
            (on
              ? 'border-line-strong bg-card text-ink-strong'
              : 'border-transparent text-ink-soft hover:bg-line/50 hover:text-ink'))) +
    (lifted ? ' opacity-40' : '') +
    (entering ? ' moji-tab-in' : '') +
    (exiting ? ' moji-tab-out' : '') +
    (idleBlank ? ' moji-tab-attn' : '')

  return (
    <div
      data-tab={tab.id}
      role="tab"
      aria-selected={on}
      {...(leaving ? { inert: true } : { tabIndex: 0 })}
      title={
        (struct ? realTitle : trail ? trail + ' · ' + title : title) +
        (isPinned ? t('（已固定）') : '') +
        relationTooltip +
        (blank ? t('（空白页签：还没有打开任何文档）') : '') +
        (dirty ? t('（有未保存的改动，Ctrl+S 保存）') : '')
      }
      onClick={(e) => {
        if (justDragged.current) return
        spawnInkRipple(e)
        onActivate(tab.id)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onActivate(tab.id)
      }}
      onPointerDown={(e) => onTabDown(e, tab.id, index, isPinned)}
      onPointerMove={(e) => onTabMove(e, tab.id)}
      onPointerUp={(e) => onEndDrag(true, e.clientX, e.clientY)}
      onPointerCancel={() => onEndDrag(false)}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenuOpen(tab.id, e.clientX, e.clientY)
      }}
      style={{ transform: offset ? 'translateX(' + offset + 'px)' : undefined }}
      className={cls}
    >
      {isTeachDocTab(tab.ref) && relation.kind === 'parent' ? (
        <div
          className="flex h-4 w-4 shrink-0 items-center justify-center text-amber-500/80 dark:text-amber-400/80"
          title={
            relation.depth === 1
              ? t('父级知识点文档')
              : relation.depth === 2
                ? t('祖父级知识点文档')
                : relation.depth === 3
                  ? t('曾祖级知识点文档')
                  : t('上位第 {0} 级祖先文档', relation.depth)
          }
        >
          <StackedChevron
            direction="up"
            count={relation.depth}
            className="h-3.5 w-3.5 shrink-0"
          />
        </div>
      ) : isTeachDocTab(tab.ref) && relation.kind === 'child' ? (
        <div
          className="flex h-4 w-4 shrink-0 items-center justify-center text-emerald-500/80 dark:text-emerald-400/80"
          title={
            relation.depth === 1
              ? t('下级子知识点文档')
              : relation.depth === 2
                ? t('孙级知识点文档')
                : relation.depth === 3
                  ? t('曾孙级知识点文档')
                  : t('下位第 {0} 级子孙文档', relation.depth)
          }
        >
          <StackedChevron
            direction="down"
            count={relation.depth}
            className="h-3.5 w-3.5 shrink-0"
          />
        </div>
      ) : (
        <TabTypeIcon
          tab={tab.ref}
          favicon={tab.ref.kind === 'web' ? wmeta?.favicon : undefined}
          loading={wmeta?.loading}
        />
      )}
      <span className="flex min-w-0 flex-1 justify-center">
        {trail && <span className="min-w-0 truncate text-ink-faint">{trail} · </span>}
        <span className="min-w-0 truncate">{title}</span>
      </span>
      {tab.ref.kind === 'video' && <VideoAudioButton tabId={tab.id} />}
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        {isPinned && !dirty && (
          <span
            aria-hidden="true"
            title={t('已固定')}
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-seal/80 transition-opacity group-hover:opacity-0"
          >
            <Pin size={11} className="rotate-45" />
          </span>
        )}
        <button
          type="button"
          title={t('关闭')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onClose(tab.id, 'self')
          }}
          className={'flex h-4 w-4 items-center justify-center rounded opacity-0 transition moji-press focus-visible:opacity-100 group-hover:opacity-70 hover:bg-line-strong/60'}
        >
          <X size={11} />
        </button>
        {dirty && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-seal/80 transition-opacity group-hover:opacity-0"
          />
        )}
      </span>
    </div>
  )
}

export function TabStrip({
  pinnedPresence,
  normalPresence,
  tabs,
  hasBlankTab,
  onNewTab,
  onDropChip,
  pinnedStripRef,
  registerStrip,
  tabMask,
  onBarMenu,
  activeId,
  activeTab,
  activeTabTitle,
  drag,
  settle,
  unsaved,
  relationMap,
  titleOf,
  trailOf,
  webMetaOf,
  justDragged,
  onActivate,
  onClose,
  onMenuOpen,
  onTabDown,
  onTabMove,
  onEndDrag,
}: {
  pinnedPresence: TabPresence<LearnTab>[]
  normalPresence: TabPresence<LearnTab>[]
  tabs: LearnTab[]
  /** 栏上还有没有空白页签：有就不画「新页签」按钮 */
  hasBlankTab: boolean
  onNewTab?: () => void
  /** 资源管理器 / 外部拖进来的引用落在这条栏上：还原成页签开在这一格里 */
  onDropChip?: (p: ChipPayload) => void
  pinnedStripRef: RefObject<HTMLDivElement | null>
  /** 登记滚动那条页签条的元素（写 ref + 交给上层，见 TabBar 的 registerStrip） */
  registerStrip: (el: HTMLDivElement | null) => void
  /** 两端渐隐的遮罩（见 lib/scrollFade 的 horizontalFadeMask） */
  tabMask: string | undefined
  /** 右键点在栏上空白处（不是任何一枚页签）：交给门面开 BarMenu */
  onBarMenu: (x: number, y: number) => void
  // —— 下面是 TabItem 的逐项依赖，原样透传 ——
  activeId: string | null
  activeTab: LearnTab | null
  activeTabTitle: string
  drag: DragState | null
  settle: { id: string; offset: number } | null
  unsaved: ReadonlySet<string>
  relationMap: Map<string, TabRelation>
  titleOf: (ref: TabRef) => string
  trailOf?: (ref: TabRef) => string
  webMetaOf?: (tab: LearnTab) => WebTabMeta | undefined
  justDragged: RefObject<boolean>
  onActivate: (id: string) => void
  onClose: (id: string, mode: TabCloseMode, opts?: { closingIds?: string[] }) => void
  onMenuOpen: (id: string, x: number, y: number) => void
  onTabDown: (e: React.PointerEvent<HTMLDivElement>, id: string, from: number, isPinned: boolean) => void
  onTabMove: (e: React.PointerEvent<HTMLDivElement>, id: string) => void
  onEndDrag: (commit: boolean, x?: number, y?: number) => void
}) {
  /** 两张地图共用的一套 TabItem 依赖；只有下标与「是否固定区」逐枚不同 */
  const tabItemProps = (p: TabPresence<LearnTab>, index: number, isPinned: boolean) => ({
    p,
    index,
    isPinned,
    activeId,
    activeTab,
    activeTabTitle,
    drag,
    settle,
    unsaved,
    relationMap,
    titleOf,
    trailOf,
    webMetaOf,
    justDragged,
    onActivate,
    onClose,
    onMenuOpen,
    onTabDown,
    onTabMove,
    onEndDrag,
  })

  return (
    <>
      {/* 固定页签区域：常驻在最左侧，脱离水平滚动条 */}
      {pinnedPresence.length > 0 && (
        <div
          ref={pinnedStripRef}
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest('[data-tab]')) return
            e.preventDefault()
            onBarMenu(e.clientX, e.clientY)
          }}
          className="flex shrink-0 items-end gap-[3px] pl-2"
        >
          {pinnedPresence.map((p, i) => (
            <TabItem key={p.item.id} {...tabItemProps(p, i, true)} />
          ))}
        </div>
      )}

      {/* 固定页签与普通滚动页签之间的轻质分隔线 */}
      {pinnedPresence.length > 0 && (
        <div className="flex shrink-0 items-center px-0.5 pb-1 self-stretch">
          <span aria-hidden="true" className="h-4 w-px bg-line-strong/60" />
        </div>
      )}

      {/* 普通页签条：横向滚动，滚动条藏起来 */}
      <div
        ref={registerStrip}
        onDragOver={(e) => {
          if (!onDropChip || !e.dataTransfer.types.includes(CHIP_MIME)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData(CHIP_MIME)
          if (!onDropChip || !raw) return
          e.preventDefault()
          const p = parseChipJson(raw)
          if (p) onDropChip(p)
        }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('[data-tab]')) return
          e.preventDefault()
          onBarMenu(e.clientX, e.clientY)
        }}
        style={{ maskImage: tabMask, WebkitMaskImage: tabMask }}
        className="moji-tab-strip flex min-w-0 flex-1 items-end gap-[3px] overflow-x-auto px-2"
      >
        {normalPresence.map((p, i) => (
          <TabItem key={p.item.id} {...tabItemProps(p, i, false)} />
        ))}
        {!tabs.length && (
          <div className="flex items-center gap-1.5 px-3 pb-1 text-[11.5px] text-ink-faint select-none">
            <BookOpen size={12} className="opacity-50" />
            <span>{t('暂无打开的页签')}</span>
          </div>
        )}
        {onNewTab && !hasBlankTab && (
          <button
            type="button"
            title={t('新页签')}
            onClick={onNewTab}
            className="group/newtab flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition moji-press hover:bg-line/50 hover:text-seal"
          >
            <Plus size={14} />
          </button>
        )}
      </div>
    </>
  )
}
