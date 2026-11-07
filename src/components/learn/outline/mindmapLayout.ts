/*
 * 本文件负责：思维导图的**纯布局算法**——把某个目标的路线（节点 + 大纲条目）
 * 建成一棵带几何坐标的树，再算出每个节点的 (x, y) 与连线端点。
 *
 * 全文件不碰 React、不碰 DOM：吃的是 store 与折叠集合，吐的是 MindmapNodeData 树。
 * 每一块都原样搬自 MindmapView.tsx，注释一并带走。
 */
import type { KnowledgeNode, LearnStore, OutlineEntry } from '../../../learn/types'
import { outlineChildNodeOf, outlineEntryKey } from '../../../learn/outline'
import type { ActivePreviewInfo, MindmapEdge, MindmapNodeData } from './mindmapTypes'
import { BRANCH_PALETTES, CARD_H, CARD_W, GAP_X, GAP_Y, PADDING, PREVIEW_CARD_H, PREVIEW_CARD_W } from './mindmapTypes'

/**
 * 递归构建以 node 为根的思维导图节点树。
 * 遵循严格规矩：思维导图仅包括 node 本身和其子孙节点，绝不渲染父级节点。
 */
export function buildMindmapTree(
  store: LearnStore,
  rootNode: KnowledgeNode,
  activePreview?: ActivePreviewInfo | null,
): MindmapNodeData {
  const visited = new Set<string>()

  function buildNode(
    curNode: KnowledgeNode,
    entry: OutlineEntry | null,
    parent: KnowledgeNode | null,
    depth: number,
    branchIndex: number,
  ): MindmapNodeData {
    visited.add(curNode.id)
    const outline = curNode.outline
    const children: MindmapNodeData[] = []

    // 若当前节点挂载了活动的文档/笔记/试卷/超级文档预览子节点，将其作为子节点插入
    if (activePreview && curNode.id === activePreview.parentNodeId) {
      children.push({
        id: `preview:${curNode.id}`,
        key: `preview:${curNode.id}`,
        title: activePreview.title,
        summary: '',
        status: 'learning',
        isRoot: false,
        depth: depth + 1,
        branchIndex,
        realNode: null,
        children: [],
        x: 0,
        y: 0,
        width: PREVIEW_CARD_W,
        height: PREVIEW_CARD_H,
        subtreeHeight: 0,
        isPreview: true,
        previewInfo: activePreview,
        previewParentNode: curNode,
      })
    }

    if (outline?.children?.length) {
      for (let i = 0; i < outline.children.length; i++) {
        const rawEntry = outline.children[i]
        /*
         * 条目自带的 key 可能根本就没有（外部写的大纲文件只保证 { title, summary }）：
         * 这里按标题补一次。store 里那一 objects 不能就地改（它是别人也在看的共享数据），
         * 所以另做一份带 key 的浅拷贝往下传——id、建节点按钮拿到的就是同一个口径。
         */
        const childEntry: OutlineEntry = rawEntry.key
          ? rawEntry
          : { ...rawEntry, key: outlineEntryKey(rawEntry) }
        const assignedBranch = depth === 0 ? i % BRANCH_PALETTES.length : branchIndex
        const claimEdge = store.edges.find(
          (e) => (e.from === curNode.id || e.from === 'o:' + curNode.id) && e.portKey === childEntry.key,
        )
        const claimedNode = claimEdge
          ? store.nodes.find((n) => n.id === (claimEdge.to.startsWith('o:') ? claimEdge.to.slice(2) : claimEdge.to))
          : null
        const childNode = claimedNode || outlineChildNodeOf(store, curNode, childEntry)
        if (childNode && !visited.has(childNode.id)) {
          children.push(buildNode(childNode, childEntry, curNode, depth + 1, assignedBranch))
        } else {
          /*
           * 未创建的目标项（或防止闭环）。
           *
           * id 里带上**同级序号 i**：同层两条计划撞了（标题重了、或者都缺 key，
           * 拼出来都是同一个 key），两条线的 id 就会塌成一个，React 直接报 duplicate key。
           * 「父 id + 序号」在同一棵子树里必然唯一，渲染层的这份唯一性不该指望上游数据干净。
           */
          children.push({
            id: `${curNode.id}:uncreated:${i}:${childEntry.key}`,
            key: childEntry.key,
            title: childEntry.title,
            summary: childEntry.summary ?? '',
            status: 'uncreated',
            isRoot: false,
            depth: depth + 1,
            branchIndex: assignedBranch,
            realNode: null,
            parentEntry: childEntry,
            parentNode: curNode,
            children: [],
            x: 0,
            y: 0,
            width: CARD_W,
            height: CARD_H,
            subtreeHeight: 0,
          })
        }
      }
    }

    // 检查 store.edges 中从当前节点引出的其他下游节点（未通过大纲条目包含的）
    const downstreamEdges = store.edges.filter((e) => {
      const fromId = e.from.startsWith('o:') ? e.from.slice(2) : e.from
      return fromId === curNode.id
    })
    for (const edge of downstreamEdges) {
      const targetId = edge.to.startsWith('o:') ? edge.to.slice(2) : edge.to
      if (visited.has(targetId)) continue
      if (children.some((c) => c.realNode?.id === targetId || c.id === targetId)) continue
      const targetNode = store.nodes.find((n) => n.id === targetId)
      if (targetNode) {
        const assignedBranch = depth === 0 ? children.length % BRANCH_PALETTES.length : branchIndex
        children.push(buildNode(targetNode, null, curNode, depth + 1, assignedBranch))
      }
    }

    return {
      id: curNode.id,
      key: curNode.key,
      title: curNode.title,
      summary: entry ? entry.summary : curNode.description || outline?.intro || '',
      status: curNode.status,
      isRoot: depth === 0,
      depth,
      branchIndex,
      realNode: curNode,
      parentEntry: entry ?? undefined,
      parentNode: parent ?? undefined,
      children,
      x: 0,
      y: 0,
      width: CARD_W,
      height: CARD_H,
      subtreeHeight: 0,
    }
  }

  return buildNode(rootNode, null, null, 0, -1)
}

/**
 * 自底向上计算每个子树的总高度（受折叠集合影响）
 */
export function computeSubtreeHeights(node: MindmapNodeData, collapsed: ReadonlySet<string>): number {
  if (node.children.length === 0 || collapsed.has(node.id)) {
    node.subtreeHeight = node.height
    return node.height
  }
  let sum = 0
  for (let i = 0; i < node.children.length; i++) {
    sum += computeSubtreeHeights(node.children[i], collapsed)
    if (i > 0) sum += GAP_Y
  }
  node.subtreeHeight = Math.max(node.height, sum)
  return node.subtreeHeight
}

/**
 * 自顶向下分配节点 (x, y) 坐标，使子节点垂直居中对齐父节点（受折叠集合影响）
 */
export function assignCoordinates(
  node: MindmapNodeData,
  x: number,
  y: number,
  collapsed: ReadonlySet<string>,
): void {
  node.x = x
  node.y = y

  if (node.children.length === 0 || collapsed.has(node.id)) return

  const nextX = x + node.width + GAP_X
  const parentCenterY = y + node.height / 2
  let curChildTopY = parentCenterY - node.subtreeHeight / 2

  for (const child of node.children) {
    const childCenterY = curChildTopY + child.subtreeHeight / 2
    const childY = childCenterY - child.height / 2
    assignCoordinates(child, nextX, childY, collapsed)
    curChildTopY += child.subtreeHeight + GAP_Y
  }
}

/**
 * 展平树以供渲染（跳过已折叠子孙）
 */
export function flattenTree(
  root: MindmapNodeData,
  collapsed: ReadonlySet<string>,
): { nodes: MindmapNodeData[]; edges: MindmapEdge[] } {
  const nodes: MindmapNodeData[] = []
  const edges: MindmapEdge[] = []

  function walk(node: MindmapNodeData) {
    nodes.push(node)
    if (collapsed.has(node.id)) return
    /*
     * 边的 id 用「两端 + 这一格的地址」：node.id 在全树唯一（每个真实节点靠 visited
     * 只进去一次，占位节点 id 里带着父 id 与同级序号），所以 from->to 在同一层、
     * 跨层都不会撞——合成边 id 的这条不变量就落在上面的占位 id 上。
     */
    for (const child of node.children) {
      edges.push({
        id: `${node.id}->${child.id}`,
        from: node.id,
        to: child.id,
        x1: node.x + node.width,
        y1: node.y + node.height / 2,
        x2: child.x,
        y2: child.y + child.height / 2,
        status: child.status,
        branchIndex: child.branchIndex,
      })
      walk(child)
    }
  }

  walk(root)
  return { nodes, edges }
}

/** 一次布局的产物：展平的节点/连线、画布总尺寸，以及未展平的原始树（折叠按钮要用） */
export interface MindmapLayoutResult {
  nodes: MindmapNodeData[]
  edges: MindmapEdge[]
  totalWidth: number
  totalHeight: number
  rawTree: MindmapNodeData
}

/**
 * 建树 + 计算几何布局 + 包围盒偏移归一化 + 展平，一口气做完（原 MindmapView 的
 * useMemo 函数体，原样搬来；memo 的依赖口径仍由调用方决定）。
 */
export function layoutMindmap(
  store: LearnStore,
  rootNode: KnowledgeNode,
  activePreview: ActivePreviewInfo | null,
  collapsedIds: ReadonlySet<string>,
): MindmapLayoutResult {
  const tree = buildMindmapTree(store, rootNode, activePreview)
  computeSubtreeHeights(tree, collapsedIds)
  assignCoordinates(tree, 0, 0, collapsedIds)

  // 计算整体包围盒并进行偏移归一化
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  function findBounds(n: MindmapNodeData) {
    if (n.x < minX) minX = n.x
    if (n.y < minY) minY = n.y
    if (n.x + n.width > maxX) maxX = n.x + n.width
    if (n.y + n.height > maxY) maxY = n.y + n.height
    if (!collapsedIds.has(n.id)) {
      for (const c of n.children) findBounds(c)
    }
  }
  findBounds(tree)

  const offsetX = PADDING - (Number.isFinite(minX) ? minX : 0)
  const offsetY = PADDING - (Number.isFinite(minY) ? minY : 0)

  function shift(n: MindmapNodeData) {
    n.x += offsetX
    n.y += offsetY
    if (!collapsedIds.has(n.id)) {
      for (const c of n.children) shift(c)
    }
  }
  shift(tree)

  const { nodes: flatNodes, edges: flatEdges } = flattenTree(tree, collapsedIds)
  const w = (Number.isFinite(maxX) ? maxX : 200) - (Number.isFinite(minX) ? minX : 0) + PADDING * 2
  const h = (Number.isFinite(maxY) ? maxY : 100) - (Number.isFinite(minY) ? minY : 0) + PADDING * 2

  return {
    nodes: flatNodes,
    edges: flatEdges,
    totalWidth: Math.max(650, w),
    totalHeight: Math.max(450, h),
    rawTree: tree,
  }
}
