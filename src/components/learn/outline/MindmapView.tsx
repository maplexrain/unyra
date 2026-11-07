/*
 * 这个文件负责：大纲页的核心——**思维导图**。把某个目标的路线（节点 + 大纲条目）
 * 画成一张可以平移缩放的图。
 *
 * 交互上的几条规矩（按用户要求定下，改动前先读这里）：
 *
 * 1. **点节点的任何部位都算选中它**——卡片正文、底栏按钮、tip 里的行、右键菜单，
 *    都会先把这一张选上。选中 = 相机以 100% 缩放把它摆到画面正中（见 centerOnNode）。
 *    只有空白处一点才是取消选中。
 * 2. **标题就是教学文档的入口**（链接样式）：不再单独摆一颗「教学文档」按钮。
 *    点标题 = 选中 + 打开教学文档。
 * 3. **连线可以点**：点一条与当前选中节点相连的线，跳到那条线的**另一端**
 *    （往前往后都行——点右边的线看下一层，点左边的线回上一层）。
 * 4. **节点底栏的文档按钮**（笔记 / 试卷 / 超级文档，图标带数量）向下展开 tip 列清单，
 *    能开、能建、能删。tip 是**跨卡片**的浮层，所以打开 tip 的那张卡片的 z 层级会顶到最高
 *    （见 CARD_Z_TIP）——不然它会被画在后面的邻居盖住。
 * 5. **各级节点长相统一**：同一套尺寸、圆角、边框、内边距，根节点只多一枚「总目标」徽章；
 *    层级靠缩进与连线区分，不靠卡片长相。画布有网格底（styles/workspace.css 的 .bg-dot-grid）。
 *
 * 另外节点可自定义颜色（右键菜单），颜色存在节点上（KnowledgeNode.tint）。
 *
 * 拆分后的分工：类型与常量在 ./mindmapTypes，纯布局算法在 ./mindmapLayout，卡片外观
 * 在 ./mindmapSkin，相机/手势在 ./useMindmapCamera；渲染件在 ./mindmapEdges（连线层）、
 * ./mindmapNodes（节点卡片）、./mindmapDocTip（文档气泡）、./mindmapTintMenu（改色菜单）、
 * ./mindmapPreviewCard（预览卡片）、./mindmapChrome（工具栏 / 图例 / 帮助）。
 * 本文件只留主组件骨架，并把对外 API 原样转发（调用方零改动）。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../../i18n'
import { edgeOtherEnd } from './mindmapNav'
import type { ActivePreviewInfo, DocKey, MindmapEdge, MindmapNodeData, MindmapViewProps } from './mindmapTypes'
import { TIP_TAIL } from './mindmapTypes'
import { layoutMindmap } from './mindmapLayout'
import { usePrefersDark } from './mindmapSkin'
import { useMindmapCamera } from './useMindmapCamera'
import { MindmapEdges } from './mindmapEdges'
import { MindmapNodeCard } from './mindmapNodes'
import { TintMenu } from './mindmapTintMenu'
import { PreviewNodeCard } from './mindmapPreviewCard'
import { MindmapLegend, MindmapToolbar } from './mindmapChrome'

// —— 对外 API 转发：类型/常量/纯算法搬去了上面的模块，从这里再导出一次，调用方零改动 ——
export type {
  ActivePreviewInfo,
  BranchTheme,
  DocKey,
  MindmapEdge,
  MindmapNodeData,
  MindmapViewProps,
  PreviewKind,
} from './mindmapTypes'
export { BRANCH_PALETTES, PREVIEW_CARD_H, PREVIEW_CARD_W, PREVIEW_TYPE_THEME } from './mindmapTypes'
export { buildMindmapTree } from './mindmapLayout'

function sameMindmapView(prev: MindmapViewProps, next: MindmapViewProps): boolean {
  if (prev.node !== next.node) return false
  if (prev.readOnly !== next.readOnly) return false
  if (prev.store.nodes !== next.store.nodes || prev.store.edges !== next.store.edges || prev.store.exams !== next.store.exams) return false
  if (prev.focusTarget !== next.focusTarget) return false
  if (prev.onToggleViewMode !== next.onToggleViewMode) return false
  return true
}

export default memo(function MindmapView({
  store,
  node,
  onOpenNode,
  onCreateChild,
  onGenerate,
  onSetTint,
  docs,
  exams,
  activeTab,
  focusTarget,
  onFocusHandled,
  readOnly = false,
  onToggleViewMode,
}: MindmapViewProps) {
  /** 折叠的节点 ID 集合（默认全展开） */
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set())

  /**
   * 当前打开着 tip 的节点 + 是哪一类文档（同时只开一个）+ 气泡尖角对着哪儿。
   *
   * `anchorX` 是点开它的那颗按钮中心在**卡片本地坐标**里的横坐标：tip 长得像一个气泡，
   * 尖角要指向点它的那颗按钮，才看得出「这个气泡是那颗按钮弹出来的」。
   */
  const [openTip, setOpenTip] = useState<{ id: string; key: DocKey; anchorX: number } | null>(null)

  /** 活动的文档/笔记/试卷/超级文档预览节点配置（500*700 只读，可活动替换与关闭） */
  const [activePreview, setActivePreview] = useState<ActivePreviewInfo | null>(null)
  const [isClosingPreview, setIsClosingPreview] = useState(false)
  const closeTimerRef = useRef<number | null>(null)

  const openPreview = useCallback((info: ActivePreviewInfo) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setIsClosingPreview(false)
    // 展开父节点
    setCollapsedIds((prev) => {
      if (prev.has(info.parentNodeId)) {
        const next = new Set(prev)
        next.delete(info.parentNodeId)
        return next
      }
      return prev
    })
    setActivePreview(info)
    setSelectedId(`preview:${info.parentNodeId}`)
  }, [])

  const pendingFocusParentIdRef = useRef<string | null>(null)

  const closePreview = useCallback(() => {
    if (!activePreview || isClosingPreview) return
    const parentId = activePreview.parentNodeId
    pendingFocusParentIdRef.current = parentId
    setIsClosingPreview(true)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => {
      setActivePreview(null)
      setIsClosingPreview(false)
      closeTimerRef.current = null
      setSelectedId(parentId)
    }, 200)
  }, [activePreview, isClosingPreview])

  const activePreviewRef = useRef(activePreview)
  activePreviewRef.current = activePreview
  const isClosingPreviewRef = useRef(isClosingPreview)
  isClosingPreviewRef.current = isClosingPreview

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  /**
   * 选中的节点 id。点节点的**任何部位**都会选中它（见各处 onClick），点空白处清空。
   *
   * 为什么要有「选中」而不是「点了就开文档」：图上一次点开的动作已经把节点带走了，
   * 而「把视线挪到某一个节点上」是另一件常用的事——选中之后相机把它摆到画面正中，
   * 用户接着就能看清它周围的上下级（也能顺手点里面的按钮）。
   */
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // 构建思维导图并计算几何布局（纯算法在 ./mindmapLayout）
  const { nodes, edges, totalWidth, totalHeight, rawTree } = useMemo(
    () => layoutMindmap(store, node, activePreview, collapsedIds),
    [store.nodes, node, collapsedIds, activePreview],
  )

  /**
   * 节点 id → 图层数据。点连线要跳到「另一端」，而线只认两端的 id
   * （见 MindmapEdge 的 from / to），要落到某个具体的卡片上得靠这张表。
   */
  const nodeIndex = useMemo(() => {
    const map = new Map<string, MindmapNodeData>()
    for (const n of nodes) map.set(n.id, n)
    return map
  }, [nodes])

  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const nodeIndexRef = useRef(nodeIndex)
  nodeIndexRef.current = nodeIndex

  // 相机（平移 / 缩放 / 手势 / 取景）住在 useMindmapCamera；deps 先备齐再调
  const clearSelection = useCallback(() => setSelectedId(null), [])
  const closeTip = useCallback(() => setOpenTip(null), [])
  const getSelectedId = useCallback(() => selectedId, [selectedId])
  const {
    containerRef,
    canvasRef,
    pan,
    zoom,
    zoomRef,
    dragMovedRef,
    isTransitioning,
    panning,
    fitView,
    centerOnNode,
    centerOnPreview,
    zoomIn,
    zoomOut,
    resetZoom,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onDoubleClick,
  } = useMindmapCamera(
    { getSelectedId, clearSelection, closeTip, selectedIdRef, nodeIndexRef },
    totalWidth,
    totalHeight,
  )

  // 折叠 / 展开单个节点
  const toggleCollapse = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // 全部展开
  const expandAll = useCallback(() => {
    setCollapsedIds(new Set())
  }, [])

  // 折叠所有一级分支
  const collapseAllBranches = useCallback(() => {
    const toCollapse = new Set<string>()
    for (const child of rawTree.children) {
      if (child.children.length > 0) {
        toCollapse.add(child.id)
      }
    }
    setCollapsedIds(toCollapse)
  }, [rawTree])

  /**
   * 选中某个节点。**点节点的任何部位都会走到这里**（卡片正文、标题、底栏按钮、
   * tip 里的行、右键菜单），这是「不管点哪儿都算选中」那一句的落点。
   *
   * **幂等**：已经选中的节点再点一下不再动镜头——用户在同一个节点上接着点第二颗按钮
   * （先看笔记、再开试卷）时，画面不该跟着跳第二次。取消选中只走空白处那一条路，
   * 所以这个函数不会把选中状态翻掉。
   */
  const selectNode = useCallback(
    (target: MindmapNodeData): void => {
      if (selectedId === target.id) return
      setSelectedId(target.id)
      if (target.isPreview) {
        centerOnPreview(target)
      } else {
        centerOnNode(target)
      }
    },
    [selectedId, centerOnNode, centerOnPreview],
  )

  // 当预览节点被创建或替换时，自动调整相机缩放与位置使其水平与垂直居中并包含文档
  useEffect(() => {
    if (!activePreview) return
    const previewId = `preview:${activePreview.parentNodeId}`
    const target = nodeIndex.get(previewId)
    if (target) {
      centerOnPreview(target)
    }
  }, [activePreview, nodeIndex, centerOnPreview])

  // 预览节点关闭后，相机自动调整缩放和位置居中聚焦其父级节点
  useEffect(() => {
    if (!pendingFocusParentIdRef.current || activePreview) return
    const parentId = pendingFocusParentIdRef.current
    const target = nodeIndex.get(parentId)
    if (target) {
      centerOnNode(target)
      pendingFocusParentIdRef.current = null
    }
  }, [nodes, nodeIndex, centerOnNode, activePreview])

  // 外部传入 focusTarget 时（如子大纲 chip 路由），展开其所有祖先节点并自动选中居中
  const lastHandledFocusNonceRef = useRef<number | null>(null)
  useEffect(() => {
    if (!focusTarget?.nodeId) return
    if (lastHandledFocusNonceRef.current === focusTarget.nonce) return

    const targetNodeId = focusTarget.nodeId
    const parentMap = new Map<string, string>()
    for (const edge of store.edges || []) {
      parentMap.set(edge.to, edge.from)
    }
    const ancestors = new Set<string>()
    let cur = targetNodeId
    while (cur && parentMap.has(cur)) {
      const p = parentMap.get(cur)!
      ancestors.add(p)
      cur = p
    }
    if (ancestors.size > 0) {
      setCollapsedIds((prev) => {
        let changed = false
        const next = new Set(prev)
        for (const a of ancestors) {
          if (next.has(a)) {
            next.delete(a)
            changed = true
          }
        }
        return changed ? next : prev
      })
    }
    const target = nodeIndex.get(targetNodeId)
    if (target) {
      lastHandledFocusNonceRef.current = focusTarget.nonce
      setSelectedId(target.id)
      requestAnimationFrame(() => {
        const latest = nodeIndexRef.current.get(targetNodeId) ?? target
        centerOnNode(latest)
      })
      onFocusHandled?.()
    }
  }, [focusTarget, nodeIndex, centerOnNode, store.edges, onFocusHandled])

  /**
   * 开/关某个节点的某一类文档 tip（同时只开一个）。
   *
   * 顺手把**尖角的位置**量出来：气泡的尖角要指向点它的那颗按钮。
   * 量到的两个矩形都是屏幕坐标（卡片整体在 scale(zoom) 里），所以要除回 zoom
   * 才是卡片的本地坐标；再减掉卡片的左边框（clientLeft），让 0 与 tip（left-0）
   * 的参照系对齐——不然放大之后尖角会一路偏出去。
   */
  const toggleTip = useCallback((item: MindmapNodeData, key: DocKey, e: React.MouseEvent) => {
    e.stopPropagation()
    const btn = e.currentTarget as HTMLElement
    const card = btn.closest('[data-mm-card]') as HTMLElement | null
    let anchorX = item.width / 2
    if (card) {
      const cr = card.getBoundingClientRect()
      const br = btn.getBoundingClientRect()
      const z = zoomRef.current || 1
      const border = card.clientLeft
      anchorX = (br.left + br.width / 2 - cr.left - border) / z
      // 夹进来：尖角贴着气泡两侧的圆角跑出去就穿帮了
      const pad = TIP_TAIL / 2 + 10
      anchorX = Math.min(Math.max(anchorX, pad), item.width - 2 * border - pad)
    }
    setOpenTip((cur) =>
      cur && cur.id === item.id && cur.key === key ? null : { id: item.id, key, anchorX },
    )
    // zoomRef 是相机 hook 返回的 ref（身份恒定），列出只为过 exhaustive-deps
  }, [zoomRef])

  /**
   * 点一条连线：跳到**与当前选中节点相对的那一端**（判断在 edgeOtherEnd 里）。
   */
  const onEdgeClick = useCallback(
    (edge: MindmapEdge): void => {
      if (dragMovedRef.current) return
      if (edge.to.startsWith('preview:')) {
        closePreview()
        return
      }
      const target = nodeIndex.get(edgeOtherEnd(edge, selectedId))
      if (!target) return
      // 走到这儿的两端必然不同（线不连自己），所以直接落位，不必再问「是不是已经选中」
      setSelectedId(target.id)
      if (target.isPreview) {
        centerOnPreview(target)
      } else {
        centerOnNode(target)
      }
    },
    // dragMovedRef 是相机 hook 返回的 ref（身份恒定），列出只为过 exhaustive-deps
    [selectedId, nodeIndex, centerOnNode, centerOnPreview, closePreview, dragMovedRef],
  )

  // ---------- 右键改色菜单 ----------

  /**
   * 菜单状态：`null` 表示没开。位置是**视口坐标**（fixed 定位），
   * 这样即使画布被缩放平移，菜单也贴着指针、不会被 scale 拉伸。
   */
  const [tintMenu, setTintMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  const openTintMenu = useCallback((id: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setTintMenu({ id, x: e.clientX, y: e.clientY })
  }, [])

  // 点哪儿都把菜单收掉（菜单自己的点击 stopPropagation）
  useEffect(() => {
    if (!tintMenu) return
    const close = () => setTintMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('wheel', close, { passive: true })
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('wheel', close)
      window.removeEventListener('resize', close)
    }
  }, [tintMenu])

  // 深色模式：色值按主题给（见 mindmapTint 的说明）。用 media query 而不是 data-theme，
  // 因为主题块有八套、其中五套是浅色——只有 dark 那一套需要换值。
  const isDark = usePrefersDark()

  const isRootGoal = store.goals.some((g) => g.rootNodeId === node.id)
  const goalBadge = isRootGoal ? t('总目标') : t('阶段目标')

  return (
    <div
      ref={containerRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onDoubleClick={onDoubleClick}
      className="bg-dot-grid relative h-full w-full select-none overflow-hidden"
    >
      {/* 缩放/平移的思维导图主画布 */}
      <div
        ref={canvasRef}
        className={`absolute top-0 left-0 origin-top-left ${isTransitioning ? 'transition-transform duration-200 ease-out' : ''}`}
        style={{
          /*
           * 这里的 transform 是**声明式的那一份**（补间动画走它：class 与 transform 在
           * 同一次提交里落到 DOM，浏览器才看得见「变了」并去补间）。
           * 手势（拖动 / 滚轮）期间由 paintCamera 直接写 DOM 抢在前面，
           * 并由那个 layout effect 在每次渲染后补回手势的值——两者不打架的原因见 panRef 那段。
           */
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          width: totalWidth,
          height: totalHeight,
        }}
      >
        {/* SVG 连接曲线层 */}
        <MindmapEdges
          totalWidth={totalWidth}
          totalHeight={totalHeight}
          edges={edges}
          nodeIndex={nodeIndex}
          selectedId={selectedId}
          isDark={isDark}
          panning={panning}
          activePreview={activePreview}
          isClosingPreview={isClosingPreview}
          onEdgeClick={onEdgeClick}
          closePreview={closePreview}
        />

        {/* HTML 节点卡片层 */}
        {nodes.map((item) => {
          if (item.isPreview && item.previewInfo) {
            return (
              <PreviewNodeCard
                key={item.id}
                item={item}
                activePreview={item.previewInfo}
                store={store}
                docs={docs}
                exams={exams}
                onOpenNode={onOpenNode}
                onClose={closePreview}
                onSelect={() => selectNode(item)}
                selected={selectedId === item.id}
                isClosing={isClosingPreview}
              />
            )
          }

          return (
            <MindmapNodeCard
              key={item.id}
              item={item}
              store={store}
              selected={selectedId === item.id}
              panning={panning}
              isDark={isDark}
              readOnly={readOnly}
              isCollapsed={collapsedIds.has(item.id)}
              goalBadge={goalBadge}
              tip={openTip && openTip.id === item.id ? openTip.key : null}
              tipAnchorX={openTip?.anchorX}
              activePreview={activePreview}
              activeTab={activeTab ?? null}
              docs={docs}
              exams={exams}
              onOpenNode={onOpenNode}
              onCreateChild={onCreateChild}
              onGenerate={onGenerate}
              selectNode={selectNode}
              openTintMenu={openTintMenu}
              toggleTip={toggleTip}
              toggleCollapse={toggleCollapse}
              openPreview={openPreview}
              onCloseTip={() => setOpenTip(null)}
            />
          )
        })}
      </div>

      {/* 右键改色菜单 */}
      {tintMenu && onSetTint && <TintMenu state={tintMenu} store={store} onSet={onSetTint} onClose={() => setTintMenu(null)} />}

      {/* 悬浮工具栏：右下胶囊——分支操作 / 缩放 / 视图归位三段，分隔线隔开 */}
      <MindmapToolbar
        expandAll={expandAll}
        collapseAllBranches={collapseAllBranches}
        zoomOut={zoomOut}
        zoom={zoom}
        resetZoom={resetZoom}
        zoomIn={zoomIn}
        fitView={fitView}
        onToggleViewMode={onToggleViewMode}
        readOnly={readOnly}
      />

      {/* 左下角图例：状态辨认 + 分支色 + 改色提示，收进一颗小胶囊 */}
      <MindmapLegend readOnly={readOnly} />
    </div>
  )
}, sameMindmapView)
