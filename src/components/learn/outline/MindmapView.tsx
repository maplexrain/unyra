import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderMinus,
  FolderPlus,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import type { KnowledgeNode, LearnStore, OutlineEntry } from '../../../learn/types'
import { MASTERY_LABEL } from '../../../learn/types'
import { outlineChildNodeOf } from '../../../learn/outline'
import { t } from '../../../i18n'

export interface MindmapViewProps {
  store: LearnStore
  /** 这一页大纲属于哪个目标（思维导图的根节点） */
  node: KnowledgeNode
  /** 打开某个子目标的教学文档 */
  onOpenNode: (nodeId: string) => void
  /** 把大纲里还没创建的子目标真的建出来（交给导师开讲） */
  onCreateChild: (parentNode: KnowledgeNode, entry: OutlineEntry) => void
  /** 请导师规划 / 重排某个节点的大纲 */
  onGenerate: (node: KnowledgeNode) => void
}

/**
 * 雅致矿物色彩体系（区分不同一级分支与对应子树）
 */
export interface BranchTheme {
  name: string
  color: string
  border: string
  bgPill: string
  textPill: string
  glow: string
  gradStart: string
  gradEnd: string
}

export const BRANCH_PALETTES: BranchTheme[] = [
  {
    name: '竹青',
    color: '#059669',
    border: '#10b981',
    bgPill: 'rgba(16, 185, 129, 0.12)',
    textPill: '#047857',
    glow: 'rgba(16, 185, 129, 0.28)',
    gradStart: 'rgba(16, 185, 129, 0.85)',
    gradEnd: 'rgba(5, 150, 105, 0.45)',
  },
  {
    name: '黛蓝',
    color: '#2563eb',
    border: '#3b82f6',
    bgPill: 'rgba(59, 130, 246, 0.12)',
    textPill: '#1d4ed8',
    glow: 'rgba(59, 130, 246, 0.28)',
    gradStart: 'rgba(59, 130, 246, 0.85)',
    gradEnd: 'rgba(37, 99, 235, 0.45)',
  },
  {
    name: '琥珀',
    color: '#d97706',
    border: '#f59e0b',
    bgPill: 'rgba(245, 158, 11, 0.12)',
    textPill: '#b45309',
    glow: 'rgba(245, 158, 11, 0.28)',
    gradStart: 'rgba(245, 158, 11, 0.85)',
    gradEnd: 'rgba(217, 119, 6, 0.45)',
  },
  {
    name: '紫棠',
    color: '#9333ea',
    border: '#a855f7',
    bgPill: 'rgba(168, 85, 247, 0.12)',
    textPill: '#7e22ce',
    glow: 'rgba(168, 85, 247, 0.28)',
    gradStart: 'rgba(168, 85, 247, 0.85)',
    gradEnd: 'rgba(147, 51, 234, 0.45)',
  },
  {
    name: '丹砂',
    color: '#e11d48',
    border: '#f43f5e',
    bgPill: 'rgba(244, 63, 94, 0.12)',
    textPill: '#be123c',
    glow: 'rgba(244, 63, 94, 0.28)',
    gradStart: 'rgba(244, 63, 94, 0.85)',
    gradEnd: 'rgba(225, 29, 72, 0.45)',
  },
  {
    name: '松石',
    color: '#0d9488',
    border: '#14b8a6',
    bgPill: 'rgba(20, 184, 166, 0.12)',
    textPill: '#0f766e',
    glow: 'rgba(20, 184, 166, 0.28)',
    gradStart: 'rgba(20, 184, 166, 0.85)',
    gradEnd: 'rgba(13, 148, 136, 0.45)',
  },
]

export interface MindmapNodeData {
  id: string
  key: string
  title: string
  summary: string
  status: 'uncreated' | 'active' | 'review' | 'mastered'
  mastery?: number
  isRoot: boolean
  depth: number
  branchIndex: number
  realNode: KnowledgeNode | null
  parentEntry?: OutlineEntry
  parentNode?: KnowledgeNode
  children: MindmapNodeData[]
  // 几何坐标与尺寸
  x: number
  y: number
  width: number
  height: number
  subtreeHeight: number
}

interface MindmapEdge {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  status: 'uncreated' | 'active' | 'review' | 'mastered'
  branchIndex: number
}

const GAP_X = 88
const GAP_Y = 22
const PADDING = 56

/**
 * 递归构建以 node 为根的思维导图节点树。
 * 遵循严格规矩：思维导图仅包括 node 本身和其子孙节点，绝不渲染父级节点。
 */
export function buildMindmapTree(store: LearnStore, rootNode: KnowledgeNode): MindmapNodeData {
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

    if (outline?.children?.length) {
      for (let i = 0; i < outline.children.length; i++) {
        const childEntry = outline.children[i]
        const assignedBranch = depth === 0 ? i % BRANCH_PALETTES.length : branchIndex
        const childNode = outlineChildNodeOf(store, curNode, childEntry)
        if (childNode && !visited.has(childNode.id)) {
          children.push(buildNode(childNode, childEntry, curNode, depth + 1, assignedBranch))
        } else {
          // 未创建的目标项（或防止闭环）
          const hasSummary = !!childEntry.summary?.trim()
          children.push({
            id: `${curNode.id}:uncreated:${childEntry.key}`,
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
            width: 200,
            height: hasSummary ? 76 : 56,
            subtreeHeight: 0,
          })
        }
      }
    }

    const hasSummary = !entry ? !!(curNode.description || outline?.intro) : !!entry.summary?.trim()
    const isRoot = depth === 0
    const width = isRoot ? 230 : depth === 1 ? 210 : 190
    const height = isRoot ? (hasSummary ? 88 : 68) : hasSummary ? 76 : 56

    return {
      id: curNode.id,
      key: curNode.key,
      title: curNode.title,
      summary: entry ? entry.summary : curNode.description || outline?.intro || '',
      status: curNode.status,
      mastery: curNode.learning?.mastery,
      isRoot,
      depth,
      branchIndex,
      realNode: curNode,
      parentEntry: entry ?? undefined,
      parentNode: parent ?? undefined,
      children,
      x: 0,
      y: 0,
      width,
      height,
      subtreeHeight: 0,
    }
  }

  return buildNode(rootNode, null, null, 0, -1)
}

/**
 * 自底向上计算每个子树的总高度（受折叠集合影响）
 */
function computeSubtreeHeights(node: MindmapNodeData, collapsed: ReadonlySet<string>): number {
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
function assignCoordinates(
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
function flattenTree(
  root: MindmapNodeData,
  collapsed: ReadonlySet<string>,
): { nodes: MindmapNodeData[]; edges: MindmapEdge[] } {
  const nodes: MindmapNodeData[] = []
  const edges: MindmapEdge[] = []

  function walk(node: MindmapNodeData) {
    nodes.push(node)
    if (collapsed.has(node.id)) return
    for (const child of node.children) {
      edges.push({
        id: `${node.id}->${child.id}`,
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

export default function MindmapView({
  store,
  node,
  onOpenNode,
  onCreateChild,
  onGenerate,
}: MindmapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  const [pan, setPan] = useState({ x: PADDING, y: PADDING })
  const [zoom, setZoom] = useState(1)
  const panRef = useRef(pan)
  const zoomRef = useRef(zoom)
  panRef.current = pan
  zoomRef.current = zoom

  // 是否处于平滑过渡动画中（自适应画布、归位、按钮缩放时启用，鼠标拖拽与滚轮缩放保持 0 延迟即时追踪）
  const [isTransitioning, setIsTransitioning] = useState(false)
  const transitionTimerRef = useRef<number | null>(null)

  const triggerTransition = useCallback(() => {
    setIsTransitioning(true)
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current)
    }
    transitionTimerRef.current = window.setTimeout(() => {
      setIsTransitioning(false)
    }, 240)
  }, [])

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) {
        window.clearTimeout(transitionTimerRef.current)
      }
    }
  }, [])

  /** 折叠的节点 ID 集合（默认全展开） */
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set())

  // 构建思维导图并计算几何布局
  const { nodes, edges, totalWidth, totalHeight, rawTree } = useMemo(() => {
    const tree = buildMindmapTree(store, node)
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
  }, [store, node, collapsedIds])

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

  const lastMiddleClickRef = useRef(0)

  // 调节相机缩放和坐标，直到窗口能够完整显示思维导图
  const fitView = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const padX = 72
    const padY = 72
    const scaleX = (rect.width - padX) / totalWidth
    const scaleY = (rect.height - padY) / totalHeight
    const newZoom = Math.min(1.2, Math.max(0.25, Math.min(scaleX, scaleY)))
    const roundedZoom = Math.round(newZoom * 100) / 100
    const nextPan = {
      x: (rect.width - totalWidth * roundedZoom) / 2,
      y: (rect.height - totalHeight * roundedZoom) / 2,
    }
    triggerTransition()
    panRef.current = nextPan
    zoomRef.current = roundedZoom
    setZoom(roundedZoom)
    setPan(nextPan)
  }, [totalWidth, totalHeight, triggerTransition])

  // 鼠标拖拽平移画布（支持左键空白处与中键滚轮拖动）
  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button, a, input')) return

      // 双击滚轮（中键）检测：双击滚轮自动缩放并居中完整显示思维导图
      if (e.button === 1) {
        e.preventDefault()
        const now = Date.now()
        if (now - lastMiddleClickRef.current < 380) {
          fitView()
          lastMiddleClickRef.current = 0
          return
        }
        lastMiddleClickRef.current = now
        isDraggingRef.current = true
        dragStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: panRef.current.x,
          panY: panRef.current.y,
        }
        return
      }

      if (e.button !== 0) return
      isDraggingRef.current = true
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: panRef.current.x,
        panY: panRef.current.y,
      }
    },
    [fitView],
  )

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    const nextPan = {
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    }
    panRef.current = nextPan
    setPan(nextPan)
  }, [])

  const onMouseUp = useCallback(() => {
    isDraggingRef.current = false
  }, [])

  // 监听容器原生 wheel 事件并关闭 passive，以便 preventDefault 生效并消除浏览器警告；
  // 同时以鼠标所在位置为锚点进行缩放，使镜头向鼠标所指的目标精准推进或拉远
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (Math.abs(e.deltaY) < 0.1) return

      const rect = el.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const cursorY = e.clientY - rect.top

      // 缩放比率：支持平滑触控板与传统滚轮步进，向上滚放大，向下滚缩小
      const factor = Math.min(1.25, Math.max(0.8, Math.exp(-e.deltaY * 0.0018)))
      const curZoom = zoomRef.current
      const curPan = panRef.current

      const rawNextZoom = curZoom * factor
      const nextZoom = Math.min(2.5, Math.max(0.25, Math.round(rawNextZoom * 1000) / 1000))
      if (Math.abs(nextZoom - curZoom) < 0.0001) return

      // 以鼠标光标所在点为锚点：缩放前后鼠标指针下的画布世界坐标保持不动，镜头随鼠标朝向推进或拉远
      const nextPanX = cursorX - ((cursorX - curPan.x) / curZoom) * nextZoom
      const nextPanY = cursorY - ((cursorY - curPan.y) / curZoom) * nextZoom
      const nextPan = { x: nextPanX, y: nextPanY }

      panRef.current = nextPan
      zoomRef.current = nextZoom
      setPan(nextPan)
      setZoom(nextZoom)
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', handleWheel)
    }
  }, [])

  const zoomIn = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const curZoom = zoomRef.current
    const curPan = panRef.current
    const nextZoom = Math.min(2.5, Math.round((curZoom + 0.15) * 100) / 100)
    if (nextZoom === curZoom) return
    const nextPan = {
      x: cx - ((cx - curPan.x) / curZoom) * nextZoom,
      y: cy - ((cy - curPan.y) / curZoom) * nextZoom,
    }
    triggerTransition()
    panRef.current = nextPan
    zoomRef.current = nextZoom
    setPan(nextPan)
    setZoom(nextZoom)
  }, [triggerTransition])

  const zoomOut = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const curZoom = zoomRef.current
    const curPan = panRef.current
    const nextZoom = Math.max(0.25, Math.round((curZoom - 0.15) * 100) / 100)
    if (nextZoom === curZoom) return
    const nextPan = {
      x: cx - ((cx - curPan.x) / curZoom) * nextZoom,
      y: cy - ((cy - curPan.y) / curZoom) * nextZoom,
    }
    triggerTransition()
    panRef.current = nextPan
    zoomRef.current = nextZoom
    setPan(nextPan)
    setZoom(nextZoom)
  }, [triggerTransition])

  const resetZoom = useCallback(() => {
    triggerTransition()
    const nextPan = { x: PADDING, y: PADDING }
    panRef.current = nextPan
    zoomRef.current = 1
    setZoom(1)
    setPan(nextPan)
  }, [triggerTransition])

  const onDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input')) return
    fitView()
  }, [fitView])

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
      className="relative h-full w-full select-none overflow-hidden bg-dot-grid"
      style={{
        cursor: isDraggingRef.current ? 'grabbing' : 'grab',
      }}
    >
      {/* 缩放/平移的思维导图主画布 */}
      <div
        className={`absolute top-0 left-0 origin-top-left ${isTransitioning ? 'transition-transform duration-200 ease-out' : ''}`}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          width: totalWidth,
          height: totalHeight,
        }}
      >
        {/* SVG 连接曲线层 */}
        <svg
          width={totalWidth}
          height={totalHeight}
          className="pointer-events-none absolute inset-0 overflow-visible"
        >
          <defs>
            {BRANCH_PALETTES.map((pal, idx) => (
              <linearGradient key={idx} id={`edge-grad-${idx}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={pal.gradStart} />
                <stop offset="100%" stopColor={pal.gradEnd} />
              </linearGradient>
            ))}
            <linearGradient id="edge-grad-mastered" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--color-seal)" stopOpacity="0.75" />
              <stop offset="100%" stopColor="var(--color-ok)" stopOpacity="0.85" />
            </linearGradient>
            <linearGradient id="edge-grad-line" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--color-line-strong)" stopOpacity="0.65" />
              <stop offset="100%" stopColor="var(--color-line)" stopOpacity="0.4" />
            </linearGradient>
          </defs>

          {edges.map((edge) => {
            const dx = Math.max(32, (edge.x2 - edge.x1) * 0.5)
            const pathData = `M ${edge.x1} ${edge.y1} C ${edge.x1 + dx} ${edge.y1}, ${edge.x2 - dx} ${edge.y2}, ${edge.x2} ${edge.y2}`
            const pal =
              edge.branchIndex >= 0
                ? BRANCH_PALETTES[edge.branchIndex % BRANCH_PALETTES.length]
                : null

            const strokeColor =
              edge.status === 'mastered'
                ? 'url(#edge-grad-mastered)'
                : edge.status === 'uncreated'
                  ? 'url(#edge-grad-line)'
                  : pal
                    ? `url(#edge-grad-${edge.branchIndex % BRANCH_PALETTES.length})`
                    : 'var(--color-seal)'

            const glowColor =
              edge.status === 'mastered'
                ? 'var(--color-ok)'
                : pal
                  ? pal.color
                  : 'var(--color-seal)'

            const strokeDash = edge.status === 'uncreated' ? '4 3' : 'none'
            return (
              <g key={edge.id}>
                {/* 粗柔发光底衬 */}
                <path
                  d={pathData}
                  fill="none"
                  stroke={glowColor}
                  strokeWidth={5}
                  strokeOpacity={0.12}
                />
                {/* 主分支曲线 */}
                <path
                  d={pathData}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={edge.status === 'uncreated' ? 1.75 : 2.25}
                  strokeDasharray={strokeDash}
                  strokeLinecap="round"
                />
                {/* 起始连接珠 */}
                <circle cx={edge.x1} cy={edge.y1} r={3} fill={glowColor} opacity={0.7} />
                {/* 终点连接珠 */}
                <circle
                  cx={edge.x2}
                  cy={edge.y2}
                  r={3}
                  fill={edge.status === 'mastered' ? 'var(--color-ok)' : edge.status === 'uncreated' ? 'var(--color-ink-faint)' : glowColor}
                  opacity={0.85}
                />
              </g>
            )
          })}
        </svg>

        {/* HTML 节点卡片层 */}
        {nodes.map((item) => {
          const isCollapsed = collapsedIds.has(item.id)
          const hasChildren = item.children.length > 0
          const pal =
            item.branchIndex >= 0
              ? BRANCH_PALETTES[item.branchIndex % BRANCH_PALETTES.length]
              : null

          if (item.isRoot) {
            // 根节点（当前目标本身）
            return (
              <div
                key={item.id}
                style={{
                  left: item.x,
                  top: item.y,
                  width: item.width,
                  height: item.height,
                }}
                className="group absolute flex flex-col justify-between overflow-visible rounded-2xl border-2 border-seal/60 bg-paper/95 p-3.5 shadow-md backdrop-blur-md transition-all hover:border-seal hover:shadow-xl dark:bg-card/95"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="shrink-0 rounded-full bg-seal/15 px-2.5 py-0.5 text-[10.5px] font-bold text-seal">
                    {goalBadge}
                  </span>
                  <span className="text-[11px] font-medium text-ink-soft">
                    {t(MASTERY_LABEL[item.status])}
                  </span>
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-[15px] font-bold text-ink" title={item.title}>
                    {item.title}
                  </h3>
                  {item.summary && (
                    <p className="mt-0.5 truncate text-[11px] text-ink-faint" title={item.summary}>
                      {item.summary}
                    </p>
                  )}
                </div>

                {/* 根节点的折叠/展开指示器 */}
                {hasChildren && (
                  <button
                    type="button"
                    onClick={(e) => toggleCollapse(item.id, e)}
                    title={isCollapsed ? t('展开全部下级') : t('收起全部下级')}
                    className="absolute -right-3.5 top-1/2 z-20 flex h-6 -translate-y-1/2 items-center gap-0.5 rounded-full border border-seal/50 bg-paper px-1.5 font-mono text-[10.5px] font-semibold text-seal shadow-xs transition hover:scale-108 hover:bg-seal hover:text-white dark:bg-card"
                  >
                    {isCollapsed ? (
                      <>
                        <Plus size={10} />
                        <span>{item.children.length}</span>
                      </>
                    ) : (
                      <Minus size={11} />
                    )}
                  </button>
                )}
              </div>
            )
          }

          // 子节点与孙子节点
          const isMastered = item.status === 'mastered'
          const isUncreated = item.status === 'uncreated'

          // 依据分支调色板计算卡片高质感样式
          const branchBorderColor = pal ? pal.border : 'var(--color-line-strong)'
          const branchColor = pal ? pal.color : 'var(--color-seal)'

          return (
            <div
              key={item.id}
              style={{
                left: item.x,
                top: item.y,
                width: item.width,
                height: item.height,
              }}
              className={
                'group absolute flex flex-col justify-between overflow-visible rounded-xl border p-2.5 shadow-2xs backdrop-blur-md transition-all ' +
                (isMastered
                  ? 'border-ok/40 bg-paper/95 hover:border-ok hover:shadow-xs dark:bg-card/90'
                  : isUncreated
                    ? 'border-dashed border-line-strong/60 bg-paper/60 opacity-85 hover:border-seal/60 hover:opacity-100 dark:bg-card/50'
                    : 'border-line/70 bg-paper/95 hover:shadow-xs dark:bg-card/90')
              }
            >
              {/* 一级分支左侧微彩条装饰 */}
              {item.depth === 1 && pal && (
                <span
                  className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full"
                  style={{ backgroundColor: pal.color }}
                />
              )}

              <div className="flex items-center justify-between gap-1.5 pl-0.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: isMastered
                        ? 'var(--color-ok)'
                        : isUncreated
                          ? 'transparent'
                          : branchColor,
                      border: isUncreated ? '1px dashed var(--color-ink-faint)' : 'none',
                      boxShadow: isMastered
                        ? '0 0 6px rgba(16, 185, 129, 0.4)'
                        : !isUncreated
                          ? `0 0 6px ${pal?.glow ?? 'rgba(168, 67, 47, 0.4)'}`
                          : 'none',
                    }}
                  />
                  {item.realNode ? (
                    <button
                      type="button"
                      onClick={() => onOpenNode(item.realNode!.id)}
                      title={t('点击打开「{0}」的教学文档', item.title)}
                      className="truncate text-left text-[13px] font-medium text-ink transition hover:text-seal"
                    >
                      {item.title}
                    </button>
                  ) : (
                    <span className="truncate text-[13px] font-medium text-ink-faint" title={item.title}>
                      {item.title}
                    </span>
                  )}
                </div>

                {isUncreated && (
                  <span className="shrink-0 rounded bg-line/60 px-1 py-0.5 text-[9.5px] text-ink-faint">
                    {t('未创建')}
                  </span>
                )}
                {isMastered && (
                  <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-semibold text-ok">
                    <CheckCircle2 size={10} />
                    {typeof item.mastery === 'number' && <span>{item.mastery}分</span>}
                  </span>
                )}
                {!isMastered && typeof item.mastery === 'number' && (
                  <span className="shrink-0 font-mono text-[10px] text-ink-soft">
                    {item.mastery}分
                  </span>
                )}
              </div>

              {item.summary && (
                <p className="line-clamp-1 pl-0.5 text-[10.5px] leading-tight text-ink-faint" title={item.summary}>
                  {item.summary}
                </p>
              )}

              {/* 节点底栏快捷操作 */}
              <div className="flex items-center justify-between gap-1 pl-0.5 pt-0.5">
                {isUncreated && item.parentNode && item.parentEntry && (
                  <button
                    type="button"
                    onClick={() => onCreateChild(item.parentNode!, item.parentEntry!)}
                    className="flex items-center gap-1 rounded bg-seal/10 px-1.5 py-0.5 text-[10px] font-medium text-seal transition hover:bg-seal/20"
                  >
                    <Plus size={10} />
                    <span>{t('创建并开讲')}</span>
                  </button>
                )}

                {item.realNode && (
                  <button
                    type="button"
                    onClick={() => onOpenNode(item.realNode!.id)}
                    className="flex items-center gap-1 text-[10px] text-ink-soft transition hover:text-seal"
                  >
                    <BookOpen size={10} />
                    <span>{t('教学文档')}</span>
                  </button>
                )}

                {item.realNode && !item.realNode.outline && (
                  <button
                    type="button"
                    onClick={() => onGenerate(item.realNode!)}
                    className="flex items-center gap-1 text-[10px] text-ink-faint transition hover:text-seal"
                  >
                    <Sparkles size={10} />
                    <span>{t('生成大纲')}</span>
                  </button>
                )}
              </div>

              {/* 折叠/展开控制挂载点 */}
              {hasChildren && (
                <button
                  type="button"
                  onClick={(e) => toggleCollapse(item.id, e)}
                  title={isCollapsed ? t('展开子分支（{0} 个下级）', item.children.length) : t('折叠子分支')}
                  className={
                    'absolute -right-3.5 top-1/2 z-20 flex -translate-y-1/2 items-center justify-center transition hover:scale-110 ' +
                    (isCollapsed
                      ? 'h-5 rounded-full px-1.5 font-mono text-[9.5px] font-bold text-white shadow-xs'
                      : 'h-4 w-4 rounded-full border border-line-strong bg-paper text-ink-faint shadow-2xs hover:border-seal hover:text-seal dark:bg-card')
                  }
                  style={isCollapsed ? { backgroundColor: branchColor } : undefined}
                >
                  {isCollapsed ? (
                    <div className="flex items-center gap-0.5">
                      <Plus size={9} />
                      <span>{item.children.length}</span>
                    </div>
                  ) : (
                    <Minus size={9} />
                  )}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* 悬浮工具栏：缩放、展开/折叠与自适应 */}
      <div className="absolute right-4 bottom-4 flex items-center gap-1.5 rounded-xl border border-line/60 bg-paper/85 p-1 shadow-md backdrop-blur-md dark:bg-card/85">
        <button
          type="button"
          onClick={expandAll}
          title={t('全部展开')}
          className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-ink-soft transition hover:bg-paper-deep hover:text-ink"
        >
          <FolderPlus size={12} />
          <span>{t('全展')}</span>
        </button>
        <button
          type="button"
          onClick={collapseAllBranches}
          title={t('折叠到一级分支')}
          className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-ink-soft transition hover:bg-paper-deep hover:text-ink"
        >
          <FolderMinus size={12} />
          <span>{t('折叠')}</span>
        </button>
        <div className="mx-0.5 h-3.5 w-px bg-line/60" />
        <button
          type="button"
          onClick={zoomOut}
          title={t('缩小 (滚轮下)')}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft transition hover:bg-paper-deep hover:text-ink"
        >
          <Minus size={13} />
        </button>
        <button
          type="button"
          onClick={resetZoom}
          title={t('重置为 100%')}
          className="px-1.5 font-mono text-[11px] font-medium text-ink-soft transition hover:text-ink"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={zoomIn}
          title={t('放大 (滚轮上)')}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft transition hover:bg-paper-deep hover:text-ink"
        >
          <Plus size={13} />
        </button>
        <div className="mx-0.5 h-3.5 w-px bg-line/60" />
        <button
          type="button"
          onClick={fitView}
          title={t('自适应画布')}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft transition hover:bg-paper-deep hover:text-ink"
        >
          <Maximize2 size={13} />
        </button>
        <button
          type="button"
          onClick={resetZoom}
          title={t('归位')}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft transition hover:bg-paper-deep hover:text-ink"
        >
          <RotateCcw size={13} />
        </button>
      </div>

      {/* 左下角分支与状态图例 */}
      <div className="absolute bottom-4 left-4 flex flex-wrap items-center gap-3 rounded-lg border border-line/50 bg-paper/85 px-3 py-1.5 text-[11px] text-ink-faint backdrop-blur-xs dark:bg-card/85">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-ok shadow-2xs shadow-ok/50" />
          <span>{t('已掌握')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full border border-dashed border-ink-faint" />
          <span>{t('未创建')}</span>
        </div>
        <div className="mx-1 h-3 w-px bg-line/60" />
        <div className="flex items-center gap-1.5 text-[10.5px]">
          {BRANCH_PALETTES.slice(0, 4).map((p) => (
            <span key={p.name} className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
              <span>{p.name}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
