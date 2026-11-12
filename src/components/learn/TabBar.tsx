import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LearnStore, LearnTab, TabRef, WebTabMeta } from '../../learn/types'
import { isBlankTab, isTabPinned, tabNodeId, type TabCloseMode } from '../../learn/tabs'
import type { ChipPayload } from '../../lib/docChip'
import { TAB_EXIT_MS, useTabPresence } from '../../lib/tabPresence'
import { useHorizontalScrollEdges, horizontalFadeMask } from '../../lib/scrollFade'
import { buildDirectedDistanceMaps, computeTabRelationWithMaps, type TabRelation } from './tabbar/tabRelation'
import { tabIdOf } from './tabbar/barGeometry'
import { TabStrip } from './tabbar/TabStrip'
import { BarMenu, TabMenu } from './tabbar/TabBarMenu'
import { useTabBarDnd } from './tabbar/useTabBarDnd'

/*
 * 门面（facade）：本文件只留 Props 与 TabBar 本体的组装，成块机制拆在 ./tabbar/ 下——
 * tabRelation（知识图谱关系）/ StackedChevron（折角图标）/ TabIcons（页签小图标）/
 * barGeometry（常量与拖拽几何）/ useTabBarDnd（栏内拖拽排序）/
 * TabStrip（页签条渲染）/ TabBarMenu（两张右键菜单）。
 * 对外导出一律从这里原路径转发——tests 与上层（GroupBody 等）怎么引用都不用改。
 */
export { directedDistance, isTeachDocTab, buildDirectedDistanceMaps, computeTabRelationWithMaps, computeTabRelation } from './tabbar/tabRelation'
export type { TabRelationKind, TabRelation } from './tabbar/tabRelation'
export { StackedChevron } from './tabbar/StackedChevron'

/**
 * 文档区的页签栏：像 vscode 那样自由开关文件。**一格一条**（分割出来的每一格都有自己的）。
 *
 * 各种页签平级地排在同一条栏上（节点的教学文档 / 某一份笔记 / 本地文件 / 试卷副本），
 * 所以这里只认 TabRef，不认「它是从哪来的」——再加一种来源也只需补下面那两张小表的取值。
 *
 * 栏上**只有页签**：原先右侧那一组「源码 / 预览 / 导出」搬进了文档区右上角的悬浮组
 * （见 components/learn/DocFloat）——它们是「对这份文档做的事」，与「开着哪些文档」不是一类；
 * 挤在页签栏里既占地方，又让一条本该只回答「有哪些文档」的栏变得要读两遍。
 *
 * 拖动除了栏内排序，还有**跨格**：拖到别格的边上就是分割（见 onDrop）。
 * 页签还能被**真正拖出来**：出了这条栏，一枚一模一样的影子跟着指针满窗口走，
 * 落在对话输入框上就变成一枚文档引用（见 lib/docChip），落在文档区之外则取消回原位。
 */

interface Props {
  tabs: LearnTab[]
  /**
   * 这一格的**物理**页签总数（含被目标过滤藏起来的，见 groups/goals 的 visibleTabs）。
   * 「全部关闭」的口径是整格，计数与提示要按它说——只按栏上画的数，菜单会一边报 3、
   * 一边把别的目标藏着的页签一起关掉。不给就按 tabs.length 算（不分目标的场景两者相等）。
   */
  paneTotal?: number
  activeId: string | null
  /** 页签标题：教学文档显示节点名（不再是「教学文档」四个字，见 learn/tabs 的 tabTitle） */
  titleOf: (ref: TabRef) => string
  /**
   * 同名页签的路径后缀（只在真有重名时给，见 LearnWorkspace 的 tabTrails）。
   * 没有它就是普通的页签：标题居中，不带前缀。
   */
  trailOf?: (ref: TabRef) => string
  onActivate: (id: string) => void
  onClose: (id: string, mode: TabCloseMode, opts?: { closingIds?: string[] }) => void
  /** 拖动结束后给出的新顺序（页签 id 列表，只在栏内排序时用得上） */
  onReorder: (ids: string[]) => void
  /** 有未保存改动的页签 id（暂存区里有它的正文，见 learn/drafts）：关闭键画成一颗圆点 */
  unsaved: ReadonlySet<string>
  /**
   * 拖动中的位置（每次指针移动一次）。上层据此判断「落点在哪一格的哪一条边上」，
   * 并在那一格上画一块落点高亮——栏内排序不需要它，跨格移动与分割全靠它。
   */
  onDragMove: (tabId: string, x: number, y: number) => void
  /**
   * 把页签条那个元素交给上层。
   *
   * 上层要靠它的实测矩形认「指针是不是落在这一格的页签栏上」——落在别格的页签栏上是
   * **加入那一格**（按位置插进去），而不是在它的上边或下边拆一格，两件事差得很远。
   */
  onStripHost?: (el: HTMLDivElement | null) => void
  /**
   * 松手。返回 true = **上层接手了这一下**（拖到别格 / 拖到某格边上分割），
   * 本栏于是不做栏内重排，也不播归位动画。
   * commit 为 false（拖动被取消）时也要走一趟：把上层那块高亮收掉。
   */
  onDrop: (tabId: string, ids: string[], x: number, y: number, commit: boolean) => boolean
  /**
   * 页签拖进对话输入框时交给它的那份信息（显示名 + 路径信息，见 lib/docChip）。
   * 在上层算——它认得 store 与考试名；不给这条，页签就拖不进输入框。
   */
  docPayloadOf?: (ref: TabRef) => ChipPayload | null
  /**
   * 资源管理器 / 外部拖进来的引用落在这一格的页签栏上：还原成页签开在这一格里。
   * 上层解析不出 TabRef（比如试卷原件）就忽略——那不是一份能开页签的文档。
   */
  onDropChip?: (p: ChipPayload) => void
  /**
   * web 页签的活信息（真标题 / 站点图标 / 加载态，见 WebTabMeta）：有就盖过 titleOf——
   * 页面的真标题要等加载完才有，tabTitle 只能兜底出域名（见 learn/tabs）。
   */
  webMetaOf?: (tab: LearnTab) => WebTabMeta | undefined
  /**
   * 这一格是不是焦点格。
   *
   * 棱形只在焦点格的栏上跟着右键走（见 lib/tabMark）：分割成好几格之后，每格都有自己的
   * 栏，让「最后挂上的那条」说了算是不行的。
   */
  focused?: boolean
  /**
   * 这一格的页签右键菜单要的收藏两件事：它收藏了没有（决定显示「收藏」还是「取消收藏」）、
   * 以及切换它——传**整枚页签**：网页收藏要顺手记下这一页的活标题与站点图标（见 learn/favorites），
   * 只给 ref 就查不到它们。不给这两条，菜单里就没有收藏这一项。
   */
  favoriteOf?: (ref: TabRef) => boolean
  onToggleFavorite?: (tab: LearnTab) => void
  /** 固定/取消固定页签 */
  onTogglePin?: (tab: LearnTab) => void
  /**
   * 右键点在**栏上空白处**（不是任何一枚页签）时的菜单要的两件事：
   * 开一个新的浏览器页签，以及把这一格的页签全部关掉。不给就没有这张菜单。
   */
  onOpenWebTab?: () => void
  /**
   * 「新页签」那颗按钮（排在最后一枚页签后面）。
   *
   * 原先它长在顶栏右侧，与「保存状态 / 账号 / 窗口控制」挤在一起——可它做的事是
   * **这一格文档区的事**，跟顶栏那些全局入口不是一类。搬到这里之后，
   * 加一个页签的位置正好是「页签会长出来的地方」，找它不用再往右上角跑。
   * 不给这条就不画那颗按钮（比如某些只读场景）。
   */
  onNewTab?: () => void
  /** 全局 store：用于计算标签页之间的父级/子级/同概念关联 */
  store?: LearnStore
}

export default function TabBar({
  tabs,
  paneTotal,
  activeId,
  titleOf,
  trailOf,
  onActivate,
  onClose,
  onReorder,
  unsaved,
  onDragMove,
  onStripHost,
  onDrop,
  docPayloadOf,
  webMetaOf,
  onDropChip,
  favoriteOf,
  onToggleFavorite,
  onTogglePin,
  onOpenWebTab,
  onNewTab,
  focused: _focused = false,
  store,
}: Props) {
  const activeTab = useMemo(
    () => (activeId ? tabs.find((t) => t.id === activeId) ?? null : null),
    [activeId, tabs],
  )
  /**
   * 页签的进出场（见 lib/tabPresence）：关掉的那枚要**被按住一会儿**才放走，
   * 否则 React 一卸载节点，退场动画根本没机会跑。栏上画的是这一份（含正在退场的），
   * 别的逻辑（菜单、拖动落点）仍旧只认活的 `tabs`。
   */
  const presence = useTabPresence(tabs, tabIdOf, TAB_EXIT_MS)
  const pinnedPresence = useMemo(() => presence.filter((p) => isTabPinned(p.item)), [presence])
  const normalPresence = useMemo(() => presence.filter((p) => !isTabPinned(p.item)), [presence])
  const pinnedStripRef = useRef<HTMLDivElement | null>(null)
  const activeBaseNodeId = activeTab ? tabNodeId(activeTab.ref) : null
  const edges = store?.edges

  const { ancestorDistMap, descendantDistMap } = useMemo(() => {
    return buildDirectedDistanceMaps(edges, activeBaseNodeId)
  }, [edges, activeBaseNodeId])

  const tabRelationMap = useMemo(() => {
    const map = new Map<string, TabRelation>()
    if (!activeTab) return map
    for (const tab of tabs) {
      map.set(
        tab.id,
        computeTabRelationWithMaps(tab, activeTab, ancestorDistMap, descendantDistMap),
      )
    }
    return map
  }, [tabs, activeTab, ancestorDistMap, descendantDistMap])
  const activeTabTitle = activeTab ? titleOf(activeTab.ref) : ''
  const hasBlankTab = useMemo(() => tabs.some(isBlankTab), [tabs])
  const rootRef = useRef<HTMLDivElement | null>(null)
  const stripRef = useRef<HTMLDivElement | null>(null)
  /**
   * 把滚动那条页签条的元素登记进来：本栏的滚动 effect 要用，上层（onStripHost）
   * 也要靠它认「指针是不是落在这一格的页签栏上」。
   */
  const registerStrip = (el: HTMLDivElement | null) => {
    stripRef.current = el
    onStripHost?.(el)
  }
  const tabEdges = useHorizontalScrollEdges(stripRef)
  const tabMask = horizontalFadeMask(tabEdges, 28)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  /** 右键点在栏上空白处的菜单（不是某一枚页签）：开新网页页签 / 全部关闭 */
  const [barMenu, setBarMenu] = useState<{ x: number; y: number } | null>(null)
  /** 右键菜单抬头那一行要说的话：这一项叫什么（找不到就不用说了，它已经被关掉了） */
  const menuTab = menu ? tabs.find((tab) => tab.id === menu.id) : undefined
  const menuLabel = menuTab ? titleOf(menuTab.ref) : ''

  /* ---------- 拖动排序 ---------- */

  const { drag, settle, snap, justDragged, onTabDown, onTabMove, endDrag } = useTabBarDnd({
    tabs,
    presence,
    pinnedPresence,
    normalPresence,
    rootRef,
    stripRef,
    pinnedStripRef,
    onDragMove,
    onDrop,
    onReorder,
    docPayloadOf,
  })

  /**
   * 激活的页签要**尽量落在正中间**：页签多了必然横向溢出，从大纲链接跳过来、
   * 或按住右键横向拖着换页签时，新激活的那个可能只露出半个，甚至还在可视区之外。
   *
   * 没有用 scrollIntoView：它只保证「露出来」，而这里要的是「在中间」。
   * 而且它会连祖先容器一起滚——那几层本来就在该在的位置上，不该被这一下拽动。
   * 两端够不着时下面这一算自然就停在尽头（clamp 到 0 与最大滚动量）。
   */
  useEffect(() => {
    if (!activeId) return
    const strip = stripRef.current
    if (!strip) return
    /*
     * 逐个比 data-tab，而不是拼一个属性选择器：本地文件页签的 id 就是一条 Windows 路径，
     * 而反斜杠在 CSS 字符串里是**转义符**——[data-tab="l:C:\a\b.md"] 会被当成
     * 「l:C:ab.md」去找，永远选不中，从本地文件列表点开的页签于是从来不往中间滚。
     * 用 dataset 比字符串就没有这回事（拖动那一段本来也是这么找的）。
     */
    const el = [...strip.querySelectorAll<HTMLElement>('[data-tab]')].find(
      (n) => n.dataset.tab === activeId,
    )
    if (!el) return
    const max = strip.scrollWidth - strip.clientWidth
    const target = el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2
    const clampedTarget = Math.max(0, Math.min(max, target))
    if (Math.abs(strip.scrollLeft - clampedTarget) < 4) return
    /*
     * 缓动滚过去，不瞬移（与 agent 栏页签同一条口径，见 AgentTabStrip 的同名 effect）：
     * 从大纲链接跳过来、或拖动换页签时，用户看得见那枚页签是从哪一侧滑进中间的。
     * 系统开了「减弱动态效果」就退回瞬移。
     */
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    strip.scrollTo({
      left: clampedTarget,
      behavior: still ? 'auto' : 'smooth',
    })
    /*
     * presence 也在依赖里：**新开的那一枚比 props 晚一帧才进栏**（见 tabPresence 的手法）。
     * 少了这一项，「打开一份新文档 → 它的页签滚到中间」会悄悄不生效——
     * activeId 变了的那一帧，DOM 里还没有那一枚，找不着就直接返回了。
     */
  }, [activeId, presence])

  /*
   * 滚轮横滚：鼠标的纵向滚轮也滚这条栏（触摸板的横向手势本来就能滚，注释见上方
   * workspace.css 的 moji-tab-strip）。React 的 onWheel 是被动监听，preventDefault
   * 会被浏览器拒——与 agent 栏页签同一条路：原生监听、passive: false。
   */
  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const dx = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (!dx || el.scrollWidth <= el.clientWidth) return
      el.scrollLeft += dx
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div
      ref={rootRef}
      className={
        'no-print relative flex shrink-0 items-stretch gap-2 pt-1.5 pb-0 ' +
        (presence.length ? 'bg-paper/40' : '') +
        (snap ? ' moji-tab-snap' : '')
      }
    >
      {/* 固定页签区 + 轻质分隔线 + 横向滚动的页签条（见 tabbar/TabStrip） */}
      <TabStrip
        pinnedPresence={pinnedPresence}
        normalPresence={normalPresence}
        tabs={tabs}
        hasBlankTab={hasBlankTab}
        onNewTab={onNewTab}
        onDropChip={onDropChip}
        pinnedStripRef={pinnedStripRef}
        registerStrip={registerStrip}
        tabMask={tabMask}
        onBarMenu={(x, y) => setBarMenu({ x, y })}
        activeId={activeId}
        activeTab={activeTab}
        activeTabTitle={activeTabTitle}
        drag={drag}
        settle={settle}
        unsaved={unsaved}
        relationMap={tabRelationMap}
        titleOf={titleOf}
        trailOf={trailOf}
        webMetaOf={webMetaOf}
        justDragged={justDragged}
        onActivate={onActivate}
        onClose={onClose}
        onMenuOpen={(id, x, y) => setMenu({ x, y, id })}
        onTabDown={onTabDown}
        onTabMove={onTabMove}
        onEndDrag={endDrag}
      />

      {!!tabs.length && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-line-strong" />
      )}

      {barMenu && onOpenWebTab && typeof document !== 'undefined' &&
        createPortal(
          <BarMenu
            menu={barMenu}
            canCloseAll={tabs.some((t) => !isTabPinned(t))}
            count={tabs.filter((t) => !isTabPinned(t)).length}
            onOpenWebTab={() => {
              onOpenWebTab()
              setBarMenu(null)
            }}
            onCloseAll={() => {
              onClose(activeId ?? tabs[0]?.id ?? '', 'all')
              setBarMenu(null)
            }}
            onClose={() => setBarMenu(null)}
          />,
          document.body,
        )}

      {menu && typeof document !== 'undefined' &&
        createPortal(
          <TabMenu
            menu={menu}
            label={menuLabel}
            tabs={tabs}
            paneTotal={paneTotal}
            store={store}
            favorited={menuTab ? (favoriteOf?.(menuTab.ref) ?? false) : false}
            onToggleFavorite={() => {
              if (menuTab && onToggleFavorite) onToggleFavorite(menuTab)
              setMenu(null)
            }}
            onTogglePin={onTogglePin}
            onClose={() => setMenu(null)}
            onPick={(mode, closingIds) => {
              onClose(menu.id, mode, { closingIds })
              setMenu(null)
            }}
          />,
          document.body,
        )}
    </div>
  )
}
