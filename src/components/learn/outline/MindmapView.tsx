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
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ExternalLink,
  FileText,
  FlaskConical,
  FolderMinus,
  FolderPlus,
  HelpCircle,
  Maximize2,
  Minus,
  Palette,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react'
import type { KnowledgeNode, LearnStore, MasteryStatus, OutlineEntry, TabRef } from '../../../learn/types'
import { notesOf, superDocsOf } from '../../../learn/types'
import { findNote } from '../../../learn/notes'
import { readSuperDoc } from '../../../learn/superdocs'
import { outlineChildNodeOf, outlineEntryKey } from '../../../learn/outline'
import { examsOfNode } from '../../../learn/graph'
import { DocTypeIcon } from '../docTypes'
import type { ExamActions, NodeDocActions } from '../explorer/types'
import { t } from '../../../i18n'
import { TINT_PALETTE, tintColor, type TintSwatch } from './mindmapTint'
import { MINDMAP_MAX_ZOOM, MINDMAP_MIN_ZOOM, SELECT_ZOOM, centerPanFor, edgeOtherEnd } from './mindmapNav'
import MarkdownView from '../../MarkdownView'
import { renderInline, renderNote } from '../../../lib/markdown'
import {
  attemptScore,
  examTotalPoints,
  QUESTION_TYPE_LABEL,
} from '../../../learn/exam'

export type PreviewKind = 'doc' | 'note' | 'exam' | 'super'

export interface ActivePreviewInfo {
  parentNodeId: string
  kind: PreviewKind
  title: string
  noteName?: string
  superName?: string
  examId?: string
  attemptId?: string
}

export const PREVIEW_CARD_W = 500
export const PREVIEW_CARD_H = 700

export const PREVIEW_TYPE_THEME: Record<
  PreviewKind,
  {
    label: string
    color: string
    border: string
    bgMix: string
  }
> = {
  doc: {
    label: '教学文档',
    color: '#059669',
    border: '#10b981',
    bgMix: '#059669',
  },
  note: {
    label: '笔记',
    color: '#d97706',
    border: '#f59e0b',
    bgMix: '#d97706',
  },
  exam: {
    label: '考试记录',
    color: '#9333ea',
    border: '#a855f7',
    bgMix: '#9333ea',
  },
  super: {
    label: '超级文档',
    color: '#2563eb',
    border: '#3b82f6',
    bgMix: '#2563eb',
  },
}

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
  /** 改某个节点的自定义颜色；传 null = 回到「随分支」 */
  onSetTint: (nodeId: string, tint: string | null) => void
  /**
   * 节点 tip 里的文档动作。与侧栏资源管理器**同一份**（见 LearnWorkspace 的 explorerDocs）：
   * 「新建一份笔记」在侧栏和在图里必须是同一件事，各写一套迟早会分叉。
   */
  docs: NodeDocActions
  /** 考试那一侧的动作（tip 里的试卷要能开考、判分、删除） */
  exams: ExamActions
  /** 焦点格里正开着的那份文档：tip 里对应的那一行要亮 */
  activeTab: TabRef | null
  /** 外部指定的聚焦/选中节点目标（如 chip 路由） */
  focusTarget?: { nodeId: string; nonce: number } | null
  /** 外部聚焦已完成的回调 */
  onFocusHandled?: () => void
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
  status: MasteryStatus | 'uncreated'
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
  // 预览节点特性
  isPreview?: boolean
  previewInfo?: ActivePreviewInfo
  previewParentNode?: KnowledgeNode
}

interface MindmapEdge {
  id: string
  /**
   * 线段两端的节点 id。几何（x1/y1/x2/y2）只够把它画出来；
   * 「点线段跳到另一端」要的是**这两端是谁**，所以端点身份单列出来。
   * 标题不在这里重复存一份——按 id 去 nodeIndex 上取（那一份才是最新的）。
   */
  from: string
  to: string
  x1: number
  y1: number
  x2: number
  y2: number
  status: MasteryStatus | 'uncreated'
  branchIndex: number
}

const GAP_X = 100
const GAP_Y = 28
const PADDING = 56

/**
 * 卡片的**统一尺寸**。从前根节点 230×88、一级 210×76、更深 190×…——
 * 三级三种尺寸，图看着像三种东西拼的。现在全一个尺寸：层级交给缩进（GAP_X）与
 * 连线表达，卡片自己不必再长得不一样。
 */
const CARD_W = 224
const CARD_H = 98

/**
 * tip 那个气泡尖角的边长（px）。
 *
 * 尖角是一个转了 45° 的小方块，只留朝外的两条边——于是它的对角线（≈1.414×边长）
 * 正好横跨「卡片下沿」到「气泡上沿」那段空当，看起来就像气泡从按钮那儿长出来。
 * 10 这个数是照着那段空当量出来的：菱形顶端比自己的上边界还高出约 0.207×边长，
 * 10 × 0.207 ≈ 2px，加上 10px 的砖身，正好把 8px 的空当填满。
 */
const TIP_TAIL = 10

/** 卡片下沿与 tip 上沿之间的空当（即 tip 的 marginTop）：尖角要横跨这一段 */
const TIP_GAP = 8

/**
 * tip 自己的边框宽度（border-2）。
 *
 * 绝对定位的子元素，left/top 是相对**父元素的 padding box** 量的，而锚点（anchorX）
 * 与卡片下沿都是相对 border box 量的——差的就是这道边框。少了这一项，
 * 尖角会整体偏出 2px，在放大之后看得清清楚楚。
 */
const TIP_BORDER = 2

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
        const childNode = outlineChildNodeOf(store, curNode, childEntry)
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

    return {
      id: curNode.id,
      key: curNode.key,
      title: curNode.title,
      summary: entry ? entry.summary : curNode.description || outline?.intro || '',
      status: curNode.status,
      mastery: curNode.learning?.mastery,
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

/** 底栏那一排文档按钮中的一颗 */
type DocKey = 'note' | 'exam' | 'super'

/**
 * 节点卡片的统一外观常量。
 *
 * 「统一各级节点的样式」落到这里：一张卡片长什么样，全图只有这一处定义，
 * 根节点不另外写一套。
 *
 * 圆角收小到 rounded-xl（原先是 rounded-2xl）：卡片是**结构单元**，不是按钮，
 * 圆角越小越像一张「卡」而不像一颗药丸；下面那个气泡 tip 再小一档（rounded-lg），
 * 两级圆角形成一档递进，气泡看着才是从卡片里长出来的。
 *
 * 颜色不进 class，进 inline style：每张卡片的边框 / 底色 / 辉光都按**自己的
 * 分支色**现场调（color-mix），这样同一支的卡片、连线、色点共享一个色相，
 * 整张图一眼就能分出「这是几支路线」。灰卡片 + 一条细色边那套在深色底下
 * 会糊成一片，所以颜色必须铺满整张卡片。
 */
const CARD_BASE =
  'group/card absolute cursor-pointer overflow-visible rounded-xl backdrop-blur-md moji-node-sprout transition-[left,top,box-shadow,transform] duration-300 ease-[cubic-bezier(0.2,0,0,1)]'

/** 按比例把某个颜色混进透明 / 卡片底色（CSS color-mix，运行时按主题解析） */
function mix(color: string, pct: number, base = 'transparent'): string {
  return `color-mix(in srgb, ${color} ${pct}%, ${base})`
}

/** 一张卡片的着色方案：边框色 / 底色 / 辉光，全部由分支色（或状态色）推导 */
function cardSkin(opts: {
  accent: string
  isRoot: boolean
  isUncreated: boolean
  isMastered: boolean
  isDark: boolean
}): { borderColor: string; background: string; glow: string } {
  const { accent, isRoot, isUncreated, isMastered, isDark } = opts
  const surface = 'var(--color-card)'
  if (isUncreated) {
    // 还只是计划：虚线边 + 一点点分支色薄涂，存在感刻意压低
    return {
      borderColor: mix(accent, isDark ? 38 : 32),
      background: mix(accent, isDark ? 6 : 4, surface),
      glow: 'none',
    }
  }
  if (isMastered) {
    // 已掌握换状态绿，不再随分支色
    return {
      borderColor: mix('var(--color-ok)', isDark ? 55 : 48),
      background: mix('var(--color-ok)', isDark ? 10 : 6, surface),
      glow: `0 2px 14px ${mix('var(--color-ok)', isDark ? 22 : 14)}`,
    }
  }
  if (isRoot) {
    // 根节点用印记色（seal），着色最重一档：整张图的锚点
    return {
      borderColor: mix(accent, isDark ? 60 : 50),
      background: mix(accent, isDark ? 14 : 9, surface),
      glow: `0 4px 18px ${mix(accent, isDark ? 28 : 16)}`,
    }
  }
  return {
    borderColor: mix(accent, isDark ? 45 : 36),
    background: mix(accent, isDark ? 9 : 6, surface),
    glow: `0 2px 14px ${mix(accent, isDark ? 20 : 12)}`,
  }
}

function sameMindmapView(prev: MindmapViewProps, next: MindmapViewProps): boolean {
  if (prev.node !== next.node) return false
  if (prev.store.nodes !== next.store.nodes || prev.store.edges !== next.store.edges || prev.store.exams !== next.store.exams) return false
  if (prev.focusTarget !== next.focusTarget) return false
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
}: MindmapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const isDraggingRef = useRef(false)
  const isSpacePressedRef = useRef(false)
  const isMiddleDownRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  const [pan, setPan] = useState({ x: PADDING, y: PADDING })
  const [zoom, setZoom] = useState(1)

  /**
   * 相机的**真身**是这两个 ref，state 只是它的一个快照。
   *
   * 为什么不能反过来（渲染时 `panRef.current = pan`）：拖动期间 DOM 上的位置永远比
   * state 新——一次 mousemove 就走一次 setState 的话，鼠标每动 1px 都要把整棵导图
   * （每张卡片、每条曲线的四条 path）重新协调一遍，一秒钟上百次，这就是「拖起来卡卡的」
   * 的来源。所以手势期间只改 ref + 直接写 DOM，松手才把结果交回 state。
   *
   * 而 `panRef.current = pan` 那种写法在拖动中是有害的：拖动期间任何一次无关的重渲染
   * （悬停、tip、选中）都会把 ref 拽回拖动开始时的旧值，镜头当场跳回去。
   * 方向必须只有一条：ref → DOM / ref → state。
   */
  const panRef = useRef(pan)
  const zoomRef = useRef(zoom)
  useEffect(() => {
    panRef.current = pan
    zoomRef.current = zoom
  }, [pan, zoom])

  /** 被平移缩放的那一层。相机的一切都写在这一个元素的 style 上 */
  const canvasRef = useRef<HTMLDivElement | null>(null)

  /**
   * 「手势（拖动 / 滚轮）正在自己管镜头」：这段时间 DOM 上的 transform 才是真身，
   * 重渲染不许把它盖掉（见下面那个 layout effect）。
   */
  const gestureRef = useRef(false)

  /**
   * 是否正在平移。**必须有 state**（而 ref 不够）：它要改卡片与连线的类名——
   * 拖动时光标不动、画面在动，指针底下的卡片一直在换，每一张新悬停的卡片都会起一段
   * 150ms 的位移 / 辉光补间（还带着 backdrop-blur），一拖起来就是连着好几张在同时补间。
   * 拖的时候用户手里是「抓住」的，本来也不指望卡片再来给悬停反馈，索性整段关掉。
   *
   * 代价是拖动开始与结束各一次渲染——这点开销远小于沿途不停起停的那些补间。
   */
  const [panning, setPanning] = useState(false)

  /**
   * 与上面那个 state 同义，给**事件回调**读。
   *
   * 回调（onMouseUp）里读不到刚 set 进去的 state（那要等一次渲染），而它要判断的正是
   * 「这一趟到底进没进过平移态」——一次纯点击不该走提交那一步。
   * 两份值必须一起改，所以它只在 beginPan / onMouseUp 两处被写。
   */
  const panningRef = useRef(false)

  /** 把 ref 里的相机写进画布的 style——**这一帧唯一的写入口** */
  const paintCamera = useCallback(() => {
    const el = canvasRef.current
    if (!el) return
    const p = panRef.current
    // translate3d 而不是 translate：先把它推上合成层（配合 will-change），
    // 平移就只剩 GPU 上的位移，卡片那些 backdrop-blur 不会被逐帧重算一遍
    el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${zoomRef.current})`
  }, [])

  /** 一帧最多画一次：鼠标回报率可以远高于帧率（游戏鼠标 1000Hz），逐事件写是白费 */
  const paintRafRef = useRef<number | null>(null)
  const schedulePaint = useCallback(() => {
    if (paintRafRef.current !== null) return
    paintRafRef.current = requestAnimationFrame(() => {
      paintRafRef.current = null
      paintCamera()
    })
  }, [paintCamera])

  /** 手势把结果交回 state 的定时器（滚轮是连续事件，等它停下来再提交） */
  const commitTimerRef = useRef<number | null>(null)

  const cancelCommitTimer = useCallback(() => {
    if (commitTimerRef.current !== null) {
      window.clearTimeout(commitTimerRef.current)
      commitTimerRef.current = null
    }
  }, [])

  /**
   * 手势结束（或滚轮停了）：把 ref 的相机交回 state，并解掉「手势 owns 镜头」。
   *
   * 顺序要紧：先落 state 再解标记。反过来会先渲染出一帧旧的 state（镜头跳回原处），
   * 而那时标记已经解掉，layout effect 也不会再把它救回来。
   */
  const commitCamera = useCallback(() => {
    if (paintRafRef.current !== null) {
      cancelAnimationFrame(paintRafRef.current)
      paintRafRef.current = null
    }
    cancelCommitTimer()
    paintCamera()
    gestureRef.current = false
    setPan({ ...panRef.current })
    setZoom(zoomRef.current)
  }, [paintCamera, cancelCommitTimer])

  /**
   * 滚轮是连续事件：每一下都提交就没意义了（那正是卡顿的来源），
   * 等手上停下来再交回 state。期间缩放百分比那个读数会慢半拍，
   * 但那半拍里用户的眼睛在画布上，不在工具栏上。
   */
  const scheduleCommit = useCallback(() => {
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current)
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null
      commitCamera()
    }, 140)
  }, [commitCamera])

  /**
   * 拖动期间把这一层提到自己的合成层；松手后**留一小会儿**再撤。
   *
   * 提到合成层是拖动顺滑的关键：这层里每张卡片都带 `backdrop-blur`，不提升的话
   * 每移动一像素，浏览器都要把底下的背景重新模糊一遍；提升之后它是一张现成的贴图，
   * 平移只是 GPU 上的一次位移。前提是背景本身不动——这里正是如此（网格底 + 壁纸都是静的）。
   *
   * 松手后不立刻撤：连续几下小拖动是最常见的用法，每下都撤了又提会反复重建图层，
   * 而重建本身就要卡一下。
   */
  const promoteTimerRef = useRef<number | null>(null)
  const promoteCanvas = useCallback((on: boolean) => {
    const el = canvasRef.current
    if (!el) return
    if (promoteTimerRef.current !== null) {
      window.clearTimeout(promoteTimerRef.current)
      promoteTimerRef.current = null
    }
    if (on) {
      el.style.willChange = 'transform'
      return
    }
    promoteTimerRef.current = window.setTimeout(() => {
      promoteTimerRef.current = null
      el.style.willChange = ''
    }, 400)
  }, [])

  useEffect(
    () => () => {
      if (paintRafRef.current !== null) cancelAnimationFrame(paintRafRef.current)
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current)
      if (promoteTimerRef.current !== null) window.clearTimeout(promoteTimerRef.current)
    },
    [],
  )

  /**
   * 每次渲染之后，只要手势还握着镜头，就把 DOM 上的值重新写回去。
   *
   * 拖动期间的一次悬停、一次选中、一个 tip 展开都会让 React 重渲染，而 style 里的
   * transform 来自 state（旧值）——不补这一下，画面就会在拖动中途跳回起点。
   * 用 layout effect 而不是 effect：它跑在浏览器绘制之前，补得上看不见。
   */
  useLayoutEffect(() => {
    if (gestureRef.current) paintCamera()
  })

  // 是否处于平滑过渡动画中（自适应画布、归位、按钮缩放时启用，鼠标拖拽与滚轮缩放保持 0 延迟即时追踪）
  const [isTransitioning, setIsTransitioning] = useState(false)
  const transitionTimerRef = useRef<number | null>(null)

  /**
   * 起一段补间动画（自适应画布 / 归位 / 缩放按钮）。
   *
   * 它同时是「镜头交给谁」的交接点：一动补间就解掉手势对镜头的所有权，并撤掉手势
   * 还没交回的那次延迟提交——否则滚轮刚停、补间刚开始，那次迟到的提交会把镜头
   * 按到手势的终值上，补间当场被截断（看着像动画只播了一半）。
   */
  const triggerTransition = useCallback(() => {
    gestureRef.current = false
    cancelCommitTimer()
    setIsTransitioning(true)
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current)
    }
    transitionTimerRef.current = window.setTimeout(() => {
      setIsTransitioning(false)
    }, 240)
  }, [cancelCommitTimer])

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) {
        window.clearTimeout(transitionTimerRef.current)
      }
    }
  }, [])

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
  const closePreviewRef = useRef(closePreview)
  closePreviewRef.current = closePreview

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  // 构建思维导图并计算几何布局
  const { nodes, edges, totalWidth, totalHeight, rawTree } = useMemo(() => {
    const tree = buildMindmapTree(store, node, activePreview)
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
  }, [store.nodes, node, collapsedIds, activePreview])

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
    const newZoom = Math.min(MINDMAP_MAX_ZOOM, Math.max(MINDMAP_MIN_ZOOM, Math.min(scaleX, scaleY)))
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

  /**
   * 选中的节点 id。点节点的**任何部位**都会选中它（见各处 onClick），点空白处清空。
   *
   * 为什么要有「选中」而不是「点了就开文档」：图上一次点开的动作已经把节点带走了，
   * 而「把视线挪到某一个节点上」是另一件常用的事——选中之后相机把它摆到画面正中，
   * 用户接着就能看清它周围的上下级（也能顺手点里面的按钮）。
   */
  const [selectedId, setSelectedId] = useState<string | null>(null)

  /**
   * 节点 id → 图层数据。点连线要跳到「另一端」，而线只认两端的 id
   * （见 MindmapEdge 的 from / to），要落到某个具体的卡片上得靠这张表。
   */
  const nodeIndex = useMemo(() => {
    const map = new Map<string, MindmapNodeData>()
    for (const n of nodes) map.set(n.id, n)
    return map
  }, [nodes])

  /**
   * 把某个节点摆到画面正中，缩放回到**选中档**（见 SELECT_ZOOM）。
   *
   * 需求原文先说了「改为 100% 缩放，节点显示在垂直和水平居中位置」，随后又改成
   * 「选中时的相机缩放加到一百二」——所以现在是 **120%、居中**。
   *
   * 从前那条「按包围盒算一个缩放，把节点连同子级收进画面」的路子早就删掉了：
   * 那样每次选中的倍率都不一样，在节点之间跳来跳去时，眼睛要找的成了缩放比例而不是节点。
   * 现在无论从哪儿跳过来，倍率都是同一个数，镜头只负责把目标搬到正中间——
   * 要看更大的范围自己滚轮拉远，要看细节就拉近，镜头不自作主张。
   */
  const centerOnNode = useCallback(
    (target: MindmapNodeData) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const nextPan = centerPanFor(target, rect, SELECT_ZOOM)
      triggerTransition()
      panRef.current = nextPan
      zoomRef.current = SELECT_ZOOM
      setZoom(SELECT_ZOOM)
      setPan(nextPan)
    },
    [triggerTransition],
  )

  /**
   * 预览节点获得焦点时，相机缩放改为 100% (1.0)，并将文档居中
   */
  const centerOnPreview = useCallback(
    (target: MindmapNodeData) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      // 预览节点获得焦点时相机缩放固定为 100% (1.0)
      const PREVIEW_ZOOM = 1.0
      // 垂直与水平绝对居中 (verticalRatio = 0.5)
      const nextPan = centerPanFor(target, rect, PREVIEW_ZOOM, 0.5)
      triggerTransition()
      panRef.current = nextPan
      zoomRef.current = PREVIEW_ZOOM
      setZoom(PREVIEW_ZOOM)
      setPan(nextPan)
    },
    [triggerTransition],
  )

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

  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const nodeIndexRef = useRef(nodeIndex)
  nodeIndexRef.current = nodeIndex

  /**
   * 画面尺寸发生变化时自动校正相机位置：
   * 当侧栏展开/收起、分屏调整或窗口尺寸改变时，如果当前有选中的节点，自动将其重新定位到水平居中、垂直40%；
   * 若无选中节点，则按尺寸变化量等量平移，确保视觉中心点不偏移出画面，防止镜头切边或被遮挡。
   *
   * 采用与手势/滚轮一致的 ref + RAF + 防抖提交策略，避免尺寸过渡动画（如侧栏 300ms 过渡）过程中
   * 逐帧调用 setPan 触发大量 React 重渲染导致与 DOM transform 冲突发生画面抽搐。
   */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let prevWidth = el.clientWidth
    let prevHeight = el.clientHeight

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width <= 0 || height <= 0) {
        prevWidth = 0
        prevHeight = 0
        return
      }

      // 若先前处于隐藏状态（尺寸 <= 0），仅记录新尺寸，不触发平移
      if (prevWidth <= 0 || prevHeight <= 0) {
        prevWidth = width
        prevHeight = height
        return
      }

      const diffW = width - prevWidth
      const diffH = height - prevHeight
      // 忽略小于 0.5px 的亚像素微小抖动
      if (Math.abs(diffW) < 0.5 && Math.abs(diffH) < 0.5) return

      if (!isDraggingRef.current) {
        const curSelectedId = selectedIdRef.current
        const target = curSelectedId ? nodeIndexRef.current.get(curSelectedId) : null
        let nextPan: { x: number; y: number }
        if (target) {
          if (target.isPreview) {
            const fitZoomX = (width - 80) / target.width
            const fitZoomY = (height - 80) / target.height
            const desiredZoom = Math.max(MINDMAP_MIN_ZOOM, Math.min(MINDMAP_MAX_ZOOM, Math.min(fitZoomX, fitZoomY, 1.0)))
            setZoom(desiredZoom)
            zoomRef.current = desiredZoom
            nextPan = centerPanFor(target, { width, height }, desiredZoom, 0.5)
          } else {
            nextPan = centerPanFor(target, { width, height }, zoomRef.current, 0.4)
          }
        } else {
          nextPan = {
            x: panRef.current.x + diffW / 2,
            y: panRef.current.y + diffH / 2,
          }
        }
        // 尺寸变动期间关闭 CSS transition，避免动画帧与 CSS 补间冲突导致抽搐
        setIsTransitioning(false)
        gestureRef.current = true
        panRef.current = nextPan
        schedulePaint()
        scheduleCommit()
      }
      prevWidth = width
      prevHeight = height
    })

    ro.observe(el)
    return () => ro.disconnect()
  }, [schedulePaint, scheduleCommit])

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
  }, [])

  /**
   * 这一次按下之后**有没有真的拖动过**。连线上的按下会同时开启平移（见 onMouseDown），
   * 拖完松手浏览器照样会补一个 click——不靠它挡一下，「从连线上拖着画面走」会变成跳节点。
   */
  const dragMovedRef = useRef(false)

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
    [selectedId, nodeIndex, centerOnNode, centerOnPreview, closePreview],
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

  // 鼠标拖拽平移画布（支持中键滚轮拖动与按住空格键+左键拖动）
  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      dragMovedRef.current = false
      const target = e.target as HTMLElement
      if (target.closest('[data-preview-close]')) return
      const onCard = !!target.closest('[data-mm-card]')
      // 连线上的按下不算「点空白」：点线要跳到另一端，而那一头要靠当前选中是谁来判断，
      // 这里要是先把选中清掉，点线的语义就没了。
      const onEdge = !!target.closest('[data-mm-edge]')

      /**
       * 只是「按下了」：记个起点，**什么都不改**。
       *
       * 平移态（换光标 / 提图层 / 关掉悬停反馈）要等到指针真的走过阈值才进
       * （见 onMouseMove）——按下即进入的话，一次纯点击也会让底下的卡片
       * 收一下辉光再放回去，看着像闪了一下。
       */
      const armDrag = () => {
        dragStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: panRef.current.x,
          panY: panRef.current.y,
        }
      }

      // 按住空格键 + 鼠标左键按下：拖拽平移画布
      if (e.button === 0 && isSpacePressedRef.current) {
        e.preventDefault()
        isDraggingRef.current = true
        armDrag()
        return
      }

      // 中键按下：按住中键拖拽平移相机视角；双击中键恢复全图居中
      if (e.button === 1) {
        e.preventDefault()
        isMiddleDownRef.current = true
        const now = Date.now()
        if (now - lastMiddleClickRef.current < 380) {
          fitView()
          lastMiddleClickRef.current = 0
          return
        }
        lastMiddleClickRef.current = now
        isDraggingRef.current = true
        armDrag()
        return
      }

      if (selectedId !== null && !onCard && !onEdge) {
        // 空白处一点就取消选中
        setSelectedId(null)
      }
      if (target.closest('button, a, input')) return
      if (!onCard) setOpenTip(null)

      // 鼠标左键不再直接拖动相机视角，改为仅按住空格+左键或按住鼠标中键拖动；左键用于点击与选中交互
      if (e.button === 0) return
    },
    [fitView, selectedId],
  )

  /**
   * 真的开始拖了：进平移态。
   *
   * 这一刻是「镜头交给手势」的交接点，四件事一起做：
   * 掐掉上一颗按钮点出来的过渡（那 240ms 里镜头跟着过渡走，拖起来发飘）、
   * 撤掉滚轮还没交回的那次延迟提交（它到点就会把镜头所有权抢走）、
   * 把这层提到合成层（见 promoteCanvas）、换成「抓住」的光标。
   */
  const beginPan = useCallback(() => {
    setIsTransitioning(false)
    setPanning(true)
    panningRef.current = true
    cancelCommitTimer()
    gestureRef.current = true
    promoteCanvas(true)
    // 光标直接写 DOM：改 state 要等一次渲染，而「抓住」的反馈必须是当场就有的
    if (containerRef.current) containerRef.current.style.cursor = 'grabbing'
  }, [cancelCommitTimer, promoteCanvas])

  /**
   * 拖动中：只改 ref + 排一帧绘制，**不碰 state**。
   * 鼠标回报率可以远高于帧率，一个 setState 就是整棵导图重协调一遍——那是卡顿的来源。
   */
  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return
      const dx = e.clientX - dragStartRef.current.x
      const dy = e.clientY - dragStartRef.current.y
      if (!dragMovedRef.current) {
        // 几像素的抖动不算拖：手指在触控板上总会晃，那一下仍然是「点击」
        if (Math.abs(dx) + Math.abs(dy) <= 4) return
        dragMovedRef.current = true
        beginPan()
      }
      panRef.current = {
        x: dragStartRef.current.panX + dx,
        y: dragStartRef.current.panY + dy,
      }
      schedulePaint()
    },
    [beginPan, schedulePaint],
  )

  const onMouseUp = useCallback(() => {
    isMiddleDownRef.current = false
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    if (containerRef.current) {
      containerRef.current.style.cursor = isSpacePressedRef.current ? 'grab' : ''
    }
    // 没进过平移态（只是点了一下，或者滚轮手势还没结束）：没有要交回的相机
    if (!gestureRef.current || !panningRef.current) return
    panningRef.current = false
    setPanning(false)
    promoteCanvas(false)
    // 一次提交：把手势期间写在 DOM 上的结果交回 state，两边对齐
    commitCamera()
  }, [promoteCanvas, commitCamera])

  // 监听空格键按下与释放：支持按住空格键+左键拖拽平移画布，以及全局 mouseup 兜底
  useEffect(() => {
    const isInputTarget = (target: EventTarget | null) => {
      if (!target || !(target instanceof HTMLElement)) return false
      const tag = target.tagName.toLowerCase()
      return tag === 'input' || tag === 'textarea' || target.isContentEditable
    }

    const isVisible = () => {
      const el = containerRef.current
      if (!el) return false
      return el.offsetWidth > 0 && el.offsetHeight > 0
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !isInputTarget(e.target)) {
        if (!isVisible()) return
        isSpacePressedRef.current = true
        if (containerRef.current && !isDraggingRef.current) {
          containerRef.current.style.cursor = 'grab'
        }
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false
        if (containerRef.current && !isDraggingRef.current) {
          containerRef.current.style.cursor = ''
        }
      }
    }

    const handleWindowBlur = () => {
      isSpacePressedRef.current = false
      isMiddleDownRef.current = false
      if (containerRef.current && !isDraggingRef.current) {
        containerRef.current.style.cursor = ''
      }
    }

    const handleWindowMouseUp = (e: MouseEvent) => {
      if (e.button === 1 || (e.buttons & 4) === 0) {
        isMiddleDownRef.current = false
      }
      if (isDraggingRef.current) {
        onMouseUp()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleWindowBlur)
    window.addEventListener('mouseup', handleWindowMouseUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleWindowBlur)
      window.removeEventListener('mouseup', handleWindowMouseUp)
    }
  }, [onMouseUp])

  // 监听容器原生 wheel 事件并关闭 passive，以便 preventDefault 生效并消除浏览器警告；
  // 同时以鼠标所在位置为锚点进行缩放，使镜头向鼠标所指的目标精准推进或拉远
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      const targetEl = e.target as HTMLElement | null
      const isInsidePreview = Boolean(targetEl?.closest('[data-preview-card], [data-preview-scroll]'))

      // 按住鼠标滚轮（鼠标中键）时禁用滚轮滚动，防止拖动画面的过程中意外触发缩放或滚动
      if (isMiddleDownRef.current || (e.buttons & 4) !== 0) {
        e.preventDefault()
        return
      }

      // 如果滚轮事件发生在文档预览卡片内部且未按住 Ctrl/Cmd，则允许卡片正文区域正常原生滚动浏览，不拦截亦不平移画布
      if (isInsidePreview && !e.ctrlKey && !e.metaKey) {
        return
      }

      e.preventDefault()

      // 按住 Ctrl / Cmd 才能滚轮缩放
      if (e.ctrlKey || e.metaKey) {
        if (Math.abs(e.deltaY) < 0.1) return

        const rect = el.getBoundingClientRect()
        const cursorX = e.clientX - rect.left
        const cursorY = e.clientY - rect.top

        // 缩放比率：支持平滑触控板与传统滚轮步进，向上滚放大，向下滚缩小
        const factor = Math.min(1.25, Math.max(0.8, Math.exp(-e.deltaY * 0.0018)))
        const curZoom = zoomRef.current
        const curPan = panRef.current

        const rawNextZoom = curZoom * factor
        // 限制大纲视图的缩放最大尺度为 120%
        const nextZoom = Math.min(MINDMAP_MAX_ZOOM, Math.max(MINDMAP_MIN_ZOOM, Math.round(rawNextZoom * 1000) / 1000))
        if (Math.abs(nextZoom - curZoom) < 0.0001) return

        // 以鼠标光标所在点为锚点：缩放前后鼠标指针下的画布世界坐标保持不动，镜头随鼠标朝向推进或拉远
        const nextPanX = cursorX - ((cursorX - curPan.x) / curZoom) * nextZoom
        const nextPanY = cursorY - ((cursorY - curPan.y) / curZoom) * nextZoom

        setIsTransitioning(false)
        gestureRef.current = true
        panRef.current = { x: nextPanX, y: nextPanY }
        zoomRef.current = nextZoom
        if (nextZoom < 0.8 && activePreviewRef.current && !isClosingPreviewRef.current) {
          closePreviewRef.current()
        }
        schedulePaint()
        scheduleCommit()
      } else {
        // 普通滚轮：让相机朝上朝下移动；按住 Shift 朝左右移动
        // 减少鼠标滚轮位移量（系数 0.4），位移更细腻可控
        const WHEEL_PAN_SPEED = 0.4
        setIsTransitioning(false)
        gestureRef.current = true

        if (e.shiftKey) {
          // Shift + 滚轮：左右移动相机视角
          const rawDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
          const delta = rawDelta * WHEEL_PAN_SPEED
          panRef.current = {
            x: panRef.current.x - delta,
            y: panRef.current.y,
          }
        } else {
          // 垂直移动：上下移动相机视角
          panRef.current = {
            x: panRef.current.x - e.deltaX * WHEEL_PAN_SPEED,
            y: panRef.current.y - e.deltaY * WHEEL_PAN_SPEED,
          }
        }
        schedulePaint()
        scheduleCommit()
      }
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', handleWheel)
    }
  }, [schedulePaint, scheduleCommit])

  const zoomIn = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2
    const curZoom = zoomRef.current
    const curPan = panRef.current
    const nextZoom = Math.min(MINDMAP_MAX_ZOOM, Math.round((curZoom + 0.15) * 100) / 100)
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
    const nextZoom = Math.max(MINDMAP_MIN_ZOOM, Math.round((curZoom - 0.15) * 100) / 100)
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
    if (nextZoom < 0.8 && activePreview && !isClosingPreview) {
      closePreview()
    }
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
              <stop offset="0%" stopColor="var(--color-ok)" stopOpacity="0.75" />
              <stop offset="100%" stopColor="var(--color-ok-deep)" stopOpacity="0.85" />
            </linearGradient>
            <linearGradient id="edge-grad-line" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--color-line-strong)" stopOpacity="0.8" />
              <stop offset="100%" stopColor="var(--color-line-strong)" stopOpacity="0.5" />
            </linearGradient>
          </defs>

          {edges.map((edge) => {
            const dx = Math.max(32, (edge.x2 - edge.x1) * 0.5)
            const pathData = `M ${edge.x1} ${edge.y1} C ${edge.x1 + dx} ${edge.y1}, ${edge.x2 - dx} ${edge.y2}, ${edge.x2} ${edge.y2}`
            const pal =
              edge.branchIndex >= 0
                ? BRANCH_PALETTES[edge.branchIndex % BRANCH_PALETTES.length]
                : null

            const isPreviewEdge = edge.to.startsWith('preview:')
            const pTheme = isPreviewEdge && activePreview ? PREVIEW_TYPE_THEME[activePreview.kind] : null

            const strokeColor = pTheme
              ? pTheme.border
              : edge.status === 'mastered'
                ? 'url(#edge-grad-mastered)'
                : edge.status === 'uncreated'
                  ? 'url(#edge-grad-line)'
                  : pal
                    ? `url(#edge-grad-${edge.branchIndex % BRANCH_PALETTES.length})`
                    : 'var(--color-seal)'

            const glowColor = pTheme
              ? pTheme.color
              : edge.status === 'mastered'
                ? 'var(--color-ok)'
                : pal
                  ? pal.color
                  : 'var(--color-seal)'

            const strokeDash = edge.status === 'uncreated' ? '4 3' : 'none'
            /*
             * 这条线点下去会跳到哪一头：与 onEdgeClick 同一个判断（同一个函数），
             * tooltip 上先把答案说了，用户不用点一下才知道会去哪儿。
             */
            const jumpTo = nodeIndex.get(edgeOtherEnd(edge, selectedId))
            const connected = selectedId === edge.from || selectedId === edge.to
            return (
              // group/edge：鼠标落在下面那条透明热区上时，整组都算 hover，高亮那一层才亮得起来
              <g key={edge.id} className="group/edge">
                {/* 粗柔发光底衬：深底下亮一档，不然曲线在黑里显脏 */}
                <path
                  d={pathData}
                  fill="none"
                  stroke={glowColor}
                  strokeWidth={6}
                  strokeOpacity={isDark ? 0.18 : 0.12}
                  style={{
                    transition: 'd 300ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms ease',
                    opacity: isPreviewEdge && isClosingPreview ? 0 : 1,
                  }}
                />
                {/* 悬停高亮：一亮就说明「这条线点得动」。与选中节点相连的那几条平时也透着一点，
                    扫一眼就知道从这里能往哪走 */}
                <path
                  d={pathData}
                  fill="none"
                  stroke={glowColor}
                  strokeWidth={9}
                  strokeLinecap="round"
                  className={
                    'pointer-events-none ' +
                    // 平移中不起悬停补间，理由与卡片那句一样（光标不动、线在动）
                    (panning ? '' : 'transition-opacity duration-150 group-hover/edge:opacity-30 ') +
                    (connected ? 'opacity-15' : 'opacity-0')
                  }
                  style={{
                    transition: 'd 300ms cubic-bezier(0.2, 0, 0, 1)',
                  }}
                />
                {/* 主分支曲线 */}
                <path
                  d={pathData}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={isPreviewEdge ? 3 : edge.status === 'uncreated' ? 1.75 : 2.5}
                  strokeDasharray={strokeDash}
                  strokeLinecap="round"
                  style={{
                    transition: 'd 300ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms ease',
                    opacity: isPreviewEdge && isClosingPreview ? 0 : 1,
                  }}
                />
                {/* 起始连接珠 */}
                <circle
                  cx={edge.x1}
                  cy={edge.y1}
                  r={3}
                  fill={glowColor}
                  opacity={isPreviewEdge && isClosingPreview ? 0 : 0.7}
                  style={{
                    transition: 'cx 300ms cubic-bezier(0.2, 0, 0, 1), cy 300ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms ease',
                  }}
                />
                {/* 终点连接珠 */}
                <circle
                  cx={edge.x2}
                  cy={edge.y2}
                  r={3}
                  fill={
                    edge.status === 'mastered'
                      ? 'var(--color-ok)'
                      : edge.status === 'uncreated'
                        ? 'var(--color-ink-faint)'
                        : glowColor
                  }
                  opacity={isPreviewEdge && isClosingPreview ? 0 : 0.85}
                  style={{
                    transition: 'cx 300ms cubic-bezier(0.2, 0, 0, 1), cy 300ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms ease',
                  }}
                />
                {/*
                  点击热区：一条 2.5px 的曲线是点不中的，所以另铺一条 16px 的透明线来收点击。
                  它必须**排在最后**——SVG 里后画的在上面，排在珠子前面才不会被珠子挡掉几段。
                  pointer-events 单点设为 stroke：只认这条线画过的地方，围出来的空腔不吃事件，
                  否则每一条曲线都会顺手吞掉一大片空白处的拖动。
                */}
                <path
                  d={pathData}
                  data-mm-edge=""
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                  strokeLinecap="round"
                  style={{ pointerEvents: 'stroke', cursor: 'pointer', transition: 'd 300ms cubic-bezier(0.2, 0, 0, 1)' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onEdgeClick(edge)
                  }}
                >
                  <title>{t('点这条线，跳到「{0}」', jumpTo?.title ?? '')}</title>
                </path>
                {/* 预览节点连线中点的快捷关闭并返回父节点按钮 */}
                {isPreviewEdge && (
                  <g
                    data-preview-close=""
                    transform={`translate(${(edge.x1 + edge.x2) / 2}, ${(edge.y1 + edge.y2) / 2})`}
                    className="cursor-pointer group/close-edge"
                    onClick={(e) => {
                      e.stopPropagation()
                      closePreview()
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      closePreview()
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    style={{
                      pointerEvents: 'auto',
                      opacity: isClosingPreview ? 0 : 1,
                      transition: 'opacity 200ms ease, transform 300ms cubic-bezier(0.2, 0, 0, 1)',
                    }}
                  >
                    <title>{t('关闭预览并返回父节点')}</title>
                    {/* 透明扩大点击热区 */}
                    <circle r={18} fill="transparent" style={{ pointerEvents: 'all' }} />
                    <circle
                      r={11}
                      fill="var(--color-card, #ffffff)"
                      stroke={pTheme ? pTheme.border : 'var(--color-seal)'}
                      strokeWidth={1.5}
                      className="shadow-sm transition-transform duration-150 group-hover/close-edge:scale-115"
                      style={{
                        filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.15))',
                      }}
                    />
                    <path
                      d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5"
                      fill="none"
                      stroke={pTheme ? pTheme.color : 'var(--color-seal)'}
                      strokeWidth={1.75}
                      strokeLinecap="round"
                      className="transition-transform duration-150 group-hover/close-edge:scale-115"
                    />
                  </g>
                )}
              </g>
            )
          })}
        </svg>

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

          const isCollapsed = collapsedIds.has(item.id)
          const hasChildren = item.children.length > 0
          const pal = item.branchIndex >= 0 ? BRANCH_PALETTES[item.branchIndex % BRANCH_PALETTES.length] : null
          const selected = selectedId === item.id
          const isMastered = item.status === 'mastered'
          const isUncreated = item.status === 'uncreated'
          // 自定义颜色优先于分支色；已掌握统一换状态绿
          const custom = tintColor(item.realNode?.tint, isDark)
          const accent = isMastered ? 'var(--color-ok)' : (custom ?? (pal ? pal.color : 'var(--color-seal)'))
          const tip = openTip && openTip.id === item.id ? openTip.key : null
          const skin = cardSkin({ accent, isRoot: item.isRoot, isUncreated, isMastered, isDark })

          return (
            <div
              key={item.id}
              data-mm-card=""
              /*
               * 点卡片的任何地方都算选中它（需求原文：「不管点击节点哪个部位都会选中节点」）。
               * 里面各处按钮自己也调 selectNode——不是重复，是为了让「点按钮」这件事
               * 同样把节点选上（幂等，已经选中时不重复动镜头）。
               */
              onClick={() => selectNode(item)}
              onContextMenu={
                item.realNode
                  ? (e) => {
                      // 右键也先选中：改色的对象得是「当前这一张」，不然改完不知道改的是谁
                      selectNode(item)
                      openTintMenu(item.id, e)
                    }
                  : undefined
              }
              style={{
                left: item.x,
                top: item.y,
                width: item.width,
                height: item.height,
                borderWidth: 1.5,
                borderStyle: isUncreated ? 'dashed' : 'solid',
                borderColor: skin.borderColor,
                background: skin.background,
                boxShadow: selected
                  ? `0 0 0 2px ${accent}, 0 8px 24px ${mix(accent, isDark ? 30 : 18)}`
                  : skin.glow,
              }}
              className={
                CARD_BASE +
                ' flex flex-col justify-between px-3.5 pt-2.5 pb-2 ' +
                /*
                 * 层级是**会变的**：tip 从卡片下沿探出去，会盖在别的卡片上，而卡片之间
                 * 靠 DOM 顺序分前后——不把开着 tip 的这一张顶到最高，它就会被画在后面的
                 * 邻居盖住一半（需求原文：「层级一定要是会变化的，不然会被其他节点挡住」）。
                 * 选中的那一张排第二档，免得它的描边被邻居压掉。
                 */
                (tip ? 'z-40 ' : selected ? 'z-30 ' : '') +
                // 平移中不给悬停反馈（见 panning 那段说明）：那会儿底下的卡片在不停换人
                (selected || panning ? '' : 'hover:-translate-y-0.5')
              }
            >
              {/*
                顶部**只剩徽章**：状态点、掌握度、掌握状态都拿掉了（需求原文：
                「删除节点顶部学习状态的信息」）。那些信息在图上有更好的去处且不必重复：
                「已掌握」写在卡片的着色上（整张转绿）、掌握度写在卡片下沿那道细条上，
                它们都在卡片的**形状**里，而不再另占一行字。
                徽章（总目标 / 未创建）不是学习状态，是这张卡片的身份，留着；
                一个徽章都没有时整行不渲染——不留一行空白把标题往下压。
              */}
              {(item.isRoot || isUncreated) && (
                <div className="flex items-center gap-1.5">
                  {item.isRoot && (
                    <span
                      className="shrink-0 rounded-full px-2 py-px text-[10px] font-bold"
                      style={{ backgroundColor: mix(accent, 18), color: accent }}
                    >
                      {goalBadge}
                    </span>
                  )}
                  {isUncreated && (
                    <span className="shrink-0 text-[9.5px] tracking-wide text-ink-faint">
                      {t('未创建')}
                    </span>
                  )}
                </div>
              )}
              {/* 标题与摘要 */}
              <div className="min-w-0">
                {item.realNode ? (
                  /*
                   * 标题就是教学文档的入口（需求原文：「教学文档不要用独立的按钮，直接把节点
                   * 标题改为链接样式，点击打开教学文档」）。样式照抄应用里链接的那一套
                   * （见 styles/markdown.css 的 a）：印章红 + 下划线 + 悬停加深。
                   * 点它 = 选中这个节点 + 打开教学文档，两件事一起做——标题既是这一支的名字，
                   * 也是它的正文入口，没有理由要用户点两下。
                   */
                  <div className="flex items-center gap-1 min-w-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        openPreview({
                          parentNodeId: item.id,
                          kind: 'doc',
                          title: item.title,
                        })
                      }}
                      title={t('预览「{0}」的教学文档', item.title)}
                      className="truncate text-left text-[14px] leading-snug font-bold text-seal underline decoration-seal/40 decoration-1 underline-offset-[3px] transition hover:text-seal-deep hover:decoration-seal flex-1"
                    >
                      {item.title}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        selectNode(item)
                        onOpenNode(item.realNode!.id)
                      }}
                      title={t('在页签栏打开教学文档')}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-seal hover:bg-seal/10 transition"
                    >
                      <ExternalLink size={12} />
                    </button>
                  </div>
                ) : (
                  <span
                    className="block truncate text-[14px] leading-snug font-semibold text-ink-soft"
                    title={item.title}
                  >
                    {item.title}
                  </span>
                )}
                {item.summary && (
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-faint" title={item.summary}>
                    {item.summary}
                  </p>
                )}
              </div>

              {/* 底栏：文档按钮组（笔记 / 试卷 / 超级文档）+ 生成大纲。
                  教学文档不再占一颗按钮——它就是上面那个标题（链接样式） */}
              <div className="flex items-center justify-between gap-1">
                <div className="flex min-w-0 items-center gap-1">
                  {item.realNode &&
                    DOC_BUTTONS.map((key) => {
                      const count =
                        key === 'note'
                          ? notesOf(item.realNode!).length
                          : key === 'exam'
                            ? examsOfNode(store, item.realNode!.id).length
                            : superDocsOf(item.realNode!).length
                      const active = tip === key
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            // 点按钮同样是「点了节点」——选中它，再管这一栏的清单
                            selectNode(item)
                            toggleTip(item, key, e)
                          }}
                          title={t('{0}（{1}）—— 点开查看 / 新增 / 删除', DOC_LABEL[key], count)}
                          className={
                            'flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] transition ' +
                            (active
                              ? 'bg-seal/15 text-seal'
                              : 'text-ink-soft hover:bg-seal/10 hover:text-seal')
                          }
                        >
                          <DocTypeIcon kind={key} size={11} />
                          <span className="font-mono">{count}</span>
                          <ChevronDown
                            size={9}
                            className={
                              'transition-transform duration-150 ' + (active ? 'rotate-180' : '')
                            }
                          />
                        </button>
                      )
                    })}
                </div>

                {/*
                  「生成」的出场条件：这个节点底下**还没有分支**（没有大纲，或大纲里一条都没列）。
                  从前只认「没有大纲」，于是一个空白大纲（建节点时总会生成的那一份）会让
                  按钮消失——而那恰恰是最该请导师来规划的时候。底下的空态面板收起之后，
                  它就是这条路的唯一入口（见下面那块面板的说明）。
                */}
                {item.realNode && item.children.length === 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      selectNode(item)
                      onGenerate(item.realNode!)
                    }}
                    title={t('请导师给「{0}」规划大纲', item.title)}
                    className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] text-ink-faint transition hover:bg-seal/10 hover:text-seal"
                  >
                    <Sparkles size={11} />
                    <span>{t('生成')}</span>
                  </button>
                )}
              </div>

              {/* 未创建的那条计划：直接交给导师建出来（胶囊随分支色） */}
              {isUncreated && item.parentNode && item.parentEntry && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    selectNode(item)
                    onCreateChild(item.parentNode!, item.parentEntry!)
                  }}
                  className="absolute -bottom-2.5 left-3.5 flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold shadow-xs transition hover:text-white"
                  style={{
                    borderColor: mix(accent, 55),
                    color: accent,
                    background: 'var(--color-card)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = accent
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--color-card)'
                  }}
                >
                  <Plus size={10} />
                  <span>{t('创建并开讲')}</span>
                </button>
              )}

              {/*
                折叠/展开控制挂载点。**唯一不选中节点的那颗按钮**：它是「怎么看这张图」的
                开关，不是「这个节点是什么」的动作——为了收一支而让镜头跳到别处，手感是崩的。
                它本身也挂在卡片右沿之外，不算「节点的部位」。
              */}
              {hasChildren && (
                <button
                  type="button"
                  onClick={(e) => toggleCollapse(item.id, e)}
                  title={
                    isCollapsed
                      ? t('展开子分支（{0} 个下级）', item.children.length)
                      : t('折叠子分支')
                  }
                  className={
                    'absolute top-1/2 z-20 flex -translate-y-1/2 items-center justify-center transition hover:scale-110 ' +
                    (isCollapsed
                      ? '-right-3.5 h-5 rounded-full px-1.5 font-mono text-[9.5px] font-bold text-white shadow-xs'
                      : '-right-3 h-4 w-4 rounded-full border border-line-strong bg-paper text-ink-faint shadow-2xs hover:border-seal hover:text-seal dark:bg-card')
                  }
                  style={isCollapsed ? { backgroundColor: accent } : undefined}
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

              {/* 底部掌握度细条：贴在卡片下沿，不占布局空间；已掌握时 accent 已是绿，自然拉满 */}
              {item.realNode && typeof item.mastery === 'number' && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3.5 bottom-0 h-[3px] overflow-hidden rounded-t-full"
                  style={{ backgroundColor: mix(accent, isDark ? 18 : 12) }}
                >
                  <span
                    className="block h-full rounded-t-full transition-[width] duration-300"
                    style={{
                      width: `${Math.min(100, Math.max(0, item.mastery))}%`,
                      backgroundColor: accent,
                    }}
                  />
                </span>
              )}

              {/* 文档 tip：从卡片下沿向下展开的气泡（尖角对着点开它的那颗按钮） */}
              {tip && item.realNode && (
                <NodeDocTip
                  node={item.realNode}
                  kind={tip}
                  anchorX={openTip?.anchorX ?? item.width / 2}
                  store={store}
                  docs={docs}
                  exams={exams}
                  activeTab={activeTab}
                  activePreview={activePreview}
                  onClose={() => setOpenTip(null)}
                  onPreview={openPreview}
                />
              )}
            </div>
          )
        })}
      </div>

      {/*
        空态：目标还没有大纲时，别让画布只剩一张孤零零的根卡片——
        给出解释与最直接的动作（请导师生成）。
        选中了节点就收起来：卡片在选中时会顶到 z-30/z-40（见卡片那里），
        会正好压在这块面板上，把唯一的按钮埋掉——而那时卡片底栏的「生成」就是同一个动作，
        用户不会因此少一条路。
      */}
      {rawTree.children.filter((c) => !c.isPreview).length === 0 && selectedId === null && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
          <div className="pointer-events-auto flex max-w-sm flex-col items-center rounded-2xl border border-line/60 bg-paper/90 px-8 py-7 text-center shadow-lg backdrop-blur-md dark:bg-card/90">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-seal/25 bg-seal/10 text-seal">
              <Sparkles size={20} />
            </span>
            <h3 className="mt-3 text-[14px] font-semibold text-ink">{t('这个目标还没有大纲')}</h3>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">
              {t('大纲是这一层的路线图：拆成哪几个子目标、先学哪个。请导师把它立起来，这张图上就会长出分支。')}
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onGenerate(node)
              }}
              className="mt-4 flex items-center gap-1.5 rounded-xl bg-seal px-4 py-2 text-[12.5px] font-medium text-white shadow-sm transition hover:brightness-110 active:scale-[0.98]"
            >
              <Sparkles size={13} />
              <span>{t('请导师生成大纲')}</span>
            </button>
          </div>
        </div>
      )}

      {/* 右键改色菜单 */}
      {tintMenu && <TintMenu state={tintMenu} store={store} onSet={onSetTint} onClose={() => setTintMenu(null)} />}

      {/* 悬浮工具栏：右下胶囊——分支操作 / 缩放 / 视图归位三段，分隔线隔开 */}
      <div className="absolute right-4 bottom-4 flex items-center gap-0.5 rounded-full border border-line/60 bg-paper/90 p-1 shadow-lg backdrop-blur-md dark:bg-card/90">
        <ToolbarButton onClick={expandAll} title={t('全部展开')} label={t('全展')}>
          <FolderPlus size={13} />
        </ToolbarButton>
        <ToolbarButton onClick={collapseAllBranches} title={t('折叠到一级分支')} label={t('折叠')}>
          <FolderMinus size={13} />
        </ToolbarButton>
        <span className="mx-1 h-4 w-px bg-line/60" />
        <ToolbarButton onClick={zoomOut} title={t('缩小 (Ctrl+滚轮下)')} disabled={zoom <= MINDMAP_MIN_ZOOM}>
          <Minus size={13} />
        </ToolbarButton>
        <button
          type="button"
          onClick={resetZoom}
          title={t('重置为 100%')}
          className="min-w-11 rounded-full px-1.5 py-1 text-center font-mono text-[11px] font-semibold tabular-nums text-ink-soft transition hover:bg-paper-deep hover:text-ink"
        >
          {Math.round(zoom * 100)}%
        </button>
        <ToolbarButton onClick={zoomIn} title={t('放大 (Ctrl+滚轮上)')} disabled={zoom >= MINDMAP_MAX_ZOOM}>
          <Plus size={13} />
        </ToolbarButton>
        <span className="mx-1 h-4 w-px bg-line/60" />
        <ToolbarButton onClick={fitView} title={t('自适应画布（双击空白同效）')}>
          <Maximize2 size={13} />
        </ToolbarButton>
        <ToolbarButton onClick={resetZoom} title={t('归位')}>
          <RotateCcw size={13} />
        </ToolbarButton>
        <span className="mx-1 h-4 w-px bg-line/60" />
        <OutlineHelpButton />
      </div>

      {/* 左下角图例：状态辨认 + 分支色 + 改色提示，收进一颗小胶囊 */}
      <div className="absolute bottom-4 left-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-line/50 bg-paper/90 px-3.5 py-1.5 text-[11px] text-ink-faint shadow-sm backdrop-blur-md dark:bg-card/90">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-ok" />
          {t('已掌握')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full border border-dashed border-ink-faint" />
          {t('未创建')}
        </span>
        <span className="h-3 w-px bg-line/60" />
        <span className="flex items-center gap-1.5 text-[10.5px]">
          {BRANCH_PALETTES.slice(0, 4).map((p) => (
            <span key={p.name} className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
              {p.name}
            </span>
          ))}
        </span>
        <span className="h-3 w-px bg-line/60" />
        <span className="flex items-center gap-1 text-[10.5px]">
          <Palette size={11} />
          {t('右键节点可改色')}
        </span>
      </div>
    </div>
  )
}, sameMindmapView)

/**
 * 大纲页面右下角帮助按钮：鼠标经过时弹出 tip 显示操作说明
 */
function OutlineHelpButton() {
  const [showTip, setShowTip] = useState(false)

  return (
    <div
      className="relative flex items-center"
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      <button
        type="button"
        title={t('操作说明')}
        aria-label={t('操作说明')}
        className={`flex h-7 w-7 items-center justify-center rounded-full text-ink-soft transition hover:bg-paper-deep hover:text-ink ${
          showTip ? 'bg-paper-deep text-ink' : ''
        }`}
      >
        <HelpCircle size={13} />
      </button>

      {showTip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute right-0 bottom-full mb-2.5 w-72 select-none rounded-2xl border border-line-strong/80 bg-paper/95 p-3.5 shadow-2xl backdrop-blur-md dark:bg-card/95"
        >
          <div className="mb-2.5 flex items-center gap-1.5 border-b border-line/60 pb-2">
            <HelpCircle size={14} className="text-seal" />
            <span className="text-[12.5px] font-semibold text-ink">{t('思维导图操作说明')}</span>
          </div>
          <div className="space-y-2 text-[11px] leading-relaxed text-ink-soft">
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 font-medium text-ink">{t('平移画面')}</span>
              <span className="text-right text-ink-faint">{t('中键拖拽 / 空格+左键拖拽')}</span>
            </div>
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 font-medium text-ink">{t('缩放画面')}</span>
              <span className="text-right text-ink-faint">{t('Ctrl+滚轮（最大 120%）')}</span>
            </div>
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 font-medium text-ink">{t('画面滚动')}</span>
              <span className="text-right text-ink-faint">{t('滚轮上下 / Shift+滚轮左右')}</span>
            </div>
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 font-medium text-ink">{t('聚焦节点')}</span>
              <span className="text-right text-ink-faint">{t('点击节点（置于垂直 40%）')}</span>
            </div>
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 font-medium text-ink">{t('跳转对端')}</span>
              <span className="text-right text-ink-faint">{t('点击连线跳到所连节点')}</span>
            </div>
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 font-medium text-ink">{t('全图居中')}</span>
              <span className="text-right text-ink-faint">{t('双击空白处 / 中键双击')}</span>
            </div>
            <div className="flex items-start justify-between gap-2">
              <span className="shrink-0 font-medium text-ink">{t('节点改色')}</span>
              <span className="text-right text-ink-faint">{t('右键点击节点打开改色面板')}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 悬浮工具栏里的一颗按钮：图标 + 可选文字；圆形 hover 底，与胶囊外框呼应 */
function ToolbarButton({
  onClick,
  title,
  label,
  children,
  disabled = false,
}: {
  onClick: () => void
  title: string
  label?: string
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="flex h-7 items-center justify-center gap-1 rounded-full px-2 text-[11px] font-medium text-ink-soft transition hover:bg-paper-deep hover:text-ink active:scale-95 disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
      {label && <span>{label}</span>}
    </button>
  )
}

/** 三类文档按钮的名字（图标 + 数量之外，tooltip 里要用） */
const DOC_LABEL: Record<DocKey, string> = {
  note: '笔记',
  exam: '试卷',
  super: '超级文档',
}

/**
 * 底栏上那三颗文档按钮的固定顺序：笔记 → 试卷 → 超级文档。
 *
 * 写成常量而不是在三处各写一遍：顺序变了要改的是这一行，不是散在 JSX 里的三块。
 * 教学文档不在其中——它不是「清单里的一份」，而是这个节点本身的主文档（单独一颗按钮）。
 */
const DOC_BUTTONS: DocKey[] = ['note', 'exam', 'super']

/**
 * 节点卡片下沿向下展开的文档 tip。
 *
 * 做成**卡片内部绝对定位**的子元素（挂在卡片的 DOM 里），而不是浮在画布上的独立层：
 * 卡片整体在 `scale(zoom)` 的变换里，tip 跟着一起缩放——缩小时字变小是「这张图在缩小」
 * 的正常表现，而独立层会保持字号不变、从图上「浮起来」，两套坐标系会互相打架。
 *
 * 尺寸也随卡片：tip 与卡片同宽（`left-0 right-0`），列表长了在里面滚。
 */
function NodeDocTip({
  node,
  kind,
  anchorX,
  store,
  docs,
  exams,
  activeTab,
  activePreview,
  onClose,
  onPreview,
}: {
  node: KnowledgeNode
  kind: DocKey
  /** 气泡尖角对着的横坐标（卡片本地坐标，见 toggleTip） */
  anchorX: number
  store: LearnStore
  docs: NodeDocActions
  exams: ExamActions
  activeTab: TabRef | null
  activePreview?: ActivePreviewInfo | null
  onClose: () => void
  onPreview: (info: ActivePreviewInfo) => void
}) {
  const notes = notesOf(node)
  const supers = superDocsOf(node)
  const nodeExams = examsOfNode(store, node.id)

  const [expandedExamIds, setExpandedExamIds] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    if (activePreview?.kind === 'exam' && activePreview.examId) {
      initial.add(activePreview.examId)
    }
    if (activeTab?.kind === 'exam' && activeTab.examId) {
      initial.add(activeTab.examId)
    }
    return initial
  })

  const toggleExam = (examId: string) => {
    setExpandedExamIds((prev) => {
      const next = new Set(prev)
      if (next.has(examId)) {
        next.delete(examId)
      } else {
        next.add(examId)
      }
      return next
    })
  }

  const rows =
    kind === 'note' ? notes.length : kind === 'exam' ? nodeExams.length : supers.length

  return (
    <div
      // 拖动与选中都不该被 tip 内部的操作带跑（外面那层卡片的 onClick 自己会选中节点）
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      /*
       * z-30 只在卡片内部比大小（卡片因为 z-40 成了自己的层叠上下文）；
       * **真正让它压过邻居的是卡片那一层的 z-40**（见卡片上那段说明）——
       * 只在这里写多大的 z 都没用，它飞不出卡片自己的层。
       *
       * 形状上它是一个**气泡**：圆角收小一圈（rounded-lg），下沿这一侧由那颗转 45° 的
       * 小方块接住，指向点开它的那颗按钮。mt-2 的空当正好被尖角填满，
       * 于是眼睛看到的是「卡片上的按钮鼓出来一个气泡」，而不是两片分开的浮层。
       */
      className="absolute top-full left-0 right-0 z-30 cursor-default rounded-lg border-2 border-line-strong bg-paper p-2 shadow-xl dark:bg-card"
      style={{ marginTop: TIP_GAP }}
    >
      {/*
        尖角。一个转了 45° 的方块只留朝外的两条边（border-l + border-t），转过来之后
        这两条边就成了菱形的左上 / 右上两条——与气泡的上边框同色同粗，接得上。
        填充色与气泡一致，它盖住气泡上边框的那一段（子元素画在父元素的边框之上），
        于是那一段「断开」成了尖角的开口，整体是一根连续的轮廓线。
      */}
      <span
        aria-hidden="true"
        className="absolute border-l-2 border-t-2 border-line-strong bg-paper dark:bg-card"
        style={{
          left: anchorX - TIP_TAIL / 2 - TIP_BORDER,
          // 让菱形的顶端正好顶到卡片下沿：先把空当与边框补回来，再减去菱形自己高出的那一点
          top: -(TIP_GAP + TIP_BORDER - TIP_TAIL * 0.207),
          width: TIP_TAIL,
          height: TIP_TAIL,
          transform: 'rotate(45deg)',
          borderRadius: 2,
        }}
      />
      <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-soft">
          <DocTypeIcon kind={kind} size={12} />
          <span>{t(DOC_LABEL[kind])}</span>
          <span className="font-mono text-ink-faint">{rows}</span>
        </span>
        <div className="flex items-center gap-1">
          {kind === 'note' && (
            <button
              type="button"
              onClick={() => docs.onNewNote(node.id)}
              title={t('新建一份笔记')}
              className="flex h-5 items-center gap-0.5 rounded px-1.5 text-[10px] text-seal transition hover:bg-seal/10"
            >
              <Plus size={10} />
              <span>{t('新建')}</span>
            </button>
          )}
          {kind === 'exam' && (
            <button
              type="button"
              onClick={() => docs.onNewExam(node.id)}
              title={t('让导师出一份卷子')}
              className="flex h-5 items-center gap-0.5 rounded px-1.5 text-[10px] text-seal transition hover:bg-seal/10"
            >
              <Plus size={10} />
              <span>{t('出卷')}</span>
            </button>
          )}
          {kind === 'super' && (
            <button
              type="button"
              onClick={() => docs.onNewSuperDoc(node.id)}
              title={t('开一个超级实验室，让导师写一份可交互文档')}
              className="flex h-5 items-center gap-0.5 rounded px-1.5 text-[10px] text-seal transition hover:bg-seal/10"
            >
              <Plus size={10} />
              <span>{t('新建')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            title={t('收起')}
            className="flex h-5 w-5 items-center justify-center rounded text-ink-faint transition hover:bg-line/50 hover:text-ink"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      <div className="max-h-56 overflow-y-auto">
        {/* 空态：告诉用户这一栏能干什么，而不是留一片空 */}
        {rows === 0 && (
          <p className="flex items-center gap-1.5 px-1.5 py-2 text-[11px] leading-relaxed text-ink-faint">
            <FileText size={12} className="shrink-0" />
            {kind === 'note'
              ? t('还没有笔记。点右上「新建」写一份。')
              : kind === 'exam'
                ? t('还没考过。点右上「出卷」让导师出一份。')
                : t('还没有超级文档。点右上「新建」开一个。')}
          </p>
        )}

        {kind === 'note' &&
          notes.map((note) => (
            <NoteTipRow
              key={note.name}
              node={node}
              name={note.name}
              active={
                activeTab?.kind === 'note' && activeTab.nodeId === node.id && activeTab.note === note.name
              }
              docs={docs}
              onPreview={() =>
                onPreview({
                  parentNodeId: node.id,
                  kind: 'note',
                  title: note.name,
                  noteName: note.name,
                })
              }
            />
          ))}

        {kind === 'super' &&
          supers.map((sd) => (
            <TipRow
              key={sd.name}
              icon={<DocTypeIcon kind="super" size={12} />}
              label={sd.name}
              hint={t('预览《{0}》', sd.name)}
              active={
                activeTab?.kind === 'super' && activeTab.nodeId === node.id && activeTab.name === sd.name
              }
              onOpen={() =>
                onPreview({
                  parentNodeId: node.id,
                  kind: 'super',
                  title: sd.name,
                  superName: sd.name,
                })
              }
              onOpenTab={() => docs.onOpenSuperDoc(node.id, sd.name)}
              onDelete={() => docs.onDeleteSuperDoc(node.id, sd.name)}
              icon2={<FlaskConical size={11} />}
            />
          ))}

        {kind === 'exam' &&
          nodeExams.map((exam) => {
            const isExpanded = expandedExamIds.has(exam.id)
            const hasAttempts = exam.attempts.length > 0
            return (
              <div key={exam.id} className="flex flex-col gap-0.5 border-b border-line/40 pb-1 last:border-b-0">
                <div
                  role="button"
                  tabIndex={0}
                  title={
                    hasAttempts
                      ? isExpanded
                        ? t('收起考试记录')
                        : t('展开考试记录')
                      : t('暂无考试记录')
                  }
                  onClick={() => {
                    if (hasAttempts) {
                      toggleExam(exam.id)
                    }
                  }}
                  className={`group/row flex w-full items-center gap-1.5 rounded-md py-1 pl-1.5 pr-1 text-left text-[11.5px] transition text-ink-soft hover:bg-line/40 hover:text-ink ${
                    hasAttempts ? 'cursor-pointer' : 'cursor-default'
                  }`}
                >
                  <DocTypeIcon kind="exam" size={12} />
                  <span className="min-w-0 flex-1 truncate font-medium">{exam.title}</span>
                  <span className="shrink-0 text-[10px] text-ink-faint">
                    {hasAttempts ? t('{0} 次考试', exam.attempts.length) : t('未考')}
                  </span>
                  {hasAttempts && (
                    <ChevronDown
                      size={12}
                      className={`shrink-0 text-ink-faint transition-transform duration-200 ${
                        isExpanded ? '' : '-rotate-90'
                      }`}
                    />
                  )}
                  <button
                    type="button"
                    title={t('在页签栏开考')}
                    onClick={(e) => {
                      e.stopPropagation()
                      exams.onStart(node.id, exam.id)
                    }}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-seal/10 hover:text-seal transition cursor-pointer"
                  >
                    <ExternalLink size={11} />
                  </button>
                </div>
                {isExpanded && hasAttempts && (
                  <div className="pl-4 flex flex-col gap-0.5 mt-0.5">
                    {exam.attempts.map((att, idx) => {
                      const when = new Date(att.startedAt)
                      const stamp =
                        when.getMonth() + 1 + '/' + when.getDate() +
                        ' ' + String(when.getHours()).padStart(2, '0') +
                        ':' + String(when.getMinutes()).padStart(2, '0')
                      const scoreVal = attemptScore(att)
                      const scoreStr = scoreVal != null ? `(${scoreVal}分)` : ''
                      const isAttActive =
                        (activePreview?.kind === 'exam' &&
                          activePreview.examId === exam.id &&
                          activePreview.attemptId === att.id) ||
                        (activeTab?.kind === 'exam' &&
                          activeTab.examId === exam.id &&
                          activeTab.attemptId === att.id)
                      return (
                        <div
                          key={att.id}
                          role="button"
                          tabIndex={0}
                          title={t('预览第 {0} 次作答副本', idx + 1)}
                          onClick={() =>
                            onPreview({
                              parentNodeId: node.id,
                              kind: 'exam',
                              title: `${exam.title} (${stamp})`,
                              examId: exam.id,
                              attemptId: att.id,
                            })
                          }
                          className={`group/row flex w-full items-center gap-1 rounded py-0.5 pl-1.5 pr-1 text-[10.5px] transition cursor-pointer ${
                            isAttActive
                              ? 'bg-seal/10 font-medium text-seal'
                              : 'text-ink-faint hover:bg-line/30 hover:text-ink'
                          }`}
                        >
                          <span className="truncate flex-1">
                            #{idx + 1} · {stamp} {scoreStr}
                          </span>
                          <button
                            type="button"
                            title={t('在页签栏打开本次考试副本')}
                            onClick={(e) => {
                              e.stopPropagation()
                              docs.onOpenAttempt(node.id, exam.id, att.id)
                            }}
                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-seal/10 hover:text-seal transition"
                          >
                            <ExternalLink size={10} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}

/**
 * 笔记那一行。做成独立组件是因为它有就地改名的状态（改名是笔记独有的：
 * 名字就是磁盘上的文件名，见 NoteRenameRow）。
 */
function NoteTipRow({
  node,
  name,
  active,
  docs,
  onPreview,
}: {
  node: KnowledgeNode
  name: string
  active: boolean
  docs: NodeDocActions
  onPreview: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  return (
    <TipRow
      icon={<DocTypeIcon kind="note" size={12} />}
      label={name}
      hint={t('预览《{0}》；双击改名', name)}
      active={active}
      onOpen={onPreview}
      onOpenTab={() => docs.onOpenNote(node.id, name)}
      onDoubleClick={() => setRenaming(true)}
      onDelete={() => docs.onDeleteNote(node.id, name)}
      renaming={
        renaming ? (
          <NoteRenameInline
            initial={name}
            onCommit={(next) => {
              setRenaming(false)
              if (next.trim() && next !== name) docs.onRenameNote(node.id, name, next.trim())
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : undefined
      }
    />
  )
}

/** tip 里就地改名的输入框（与侧栏的 NoteRenameRow 同一套交互） */
function NoteRenameInline({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onCommit(value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
      onBlur={() => onCommit(value)}
      className="min-w-0 flex-1 rounded border border-seal/40 bg-card px-1.5 py-0.5 text-[11.5px] text-ink outline-none"
    />
  )
}

/** tip 里的一行（笔记 / 超级文档共用）：点开、右侧悬停出现删除 */
function TipRow({
  icon,
  label,
  hint,
  active,
  onOpen,
  onOpenTab,
  onDelete,
  onDoubleClick,
  renaming,
  icon2,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  active: boolean
  onOpen: () => void
  onOpenTab?: () => void
  onDelete: () => void
  onDoubleClick?: () => void
  /** 就地改名时整行换成输入框 */
  renaming?: React.ReactNode
  /** 该类型的一个小提示图标（超级文档用烧瓶，一眼区分） */
  icon2?: React.ReactNode
}) {
  if (renaming) {
    return <div className="flex items-center gap-1.5 px-1.5 py-1">{renaming}</div>
  }
  return (
    <div
      role="button"
      tabIndex={0}
      title={hint}
      onClick={onOpen}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      className={
        'group/row flex w-full items-center gap-1.5 rounded-md py-1 pl-1.5 pr-1 text-left text-[11.5px] transition cursor-pointer ' +
        (active ? 'bg-line/60 text-ink-strong' : 'text-ink-soft hover:bg-line/40 hover:text-ink')
      }
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {icon2 && <span className="shrink-0 text-ink-faint">{icon2}</span>}
      {onOpenTab && (
        <button
          type="button"
          title={t('在页签栏打开《{0}》', label)}
          onClick={(e) => {
            e.stopPropagation()
            onOpenTab()
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-seal/10 hover:text-seal transition"
        >
          <ExternalLink size={11} />
        </button>
      )}
      <button
        type="button"
        title={t('删除《{0}》', label)}
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 transition hover:bg-seal/10 hover:text-seal group-hover/row:opacity-100"
      >
        <X size={11} />
      </button>
    </div>
  )
}

/**
 * 右键弹出的改色菜单。
 *
 * 定位用 `fixed` + 视口坐标（指针在哪儿就贴哪儿），所以它**不受画布缩放影响**——
 * 菜单是操作界面的东西，字必须始终是那个字号。右侧/下侧贴边时往回夹，
 * 不让它跑出窗口。
 */
function TintMenu({
  state,
  store,
  onSet,
  onClose,
}: {
  state: { id: string; x: number; y: number }
  store: LearnStore
  onSet: (nodeId: string, tint: string | null) => void
  onClose: () => void
}) {
  const node = store.nodes.find((n) => n.id === state.id)
  const current = node?.tint ?? 'default'
  // 菜单尺寸（夹到视口里用）：宽 8 格 + 内边距
  const W = 208
  const H = 132
  const left = Math.min(state.x, Math.max(8, window.innerWidth - W - 8))
  const top = Math.min(state.y, Math.max(8, window.innerHeight - H - 8))

  const pick = (sw: TintSwatch) => {
    onSet(state.id, sw.name === 'default' ? null : sw.name)
    onClose()
  }

  return (
    <div
      // 菜单内部的点击不该触发 window 上的「点哪儿都关」（挂在 mousedown 上）
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left, top, width: W }}
      className="fixed z-50 rounded-xl border-2 border-line-strong bg-paper p-2 shadow-2xl dark:bg-card"
    >
      <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
        <Palette size={12} className="text-ink-soft" />
        <span className="text-[11px] font-semibold text-ink-soft">{t('节点颜色')}</span>
        {node && <span className="truncate text-[10.5px] text-ink-faint">· {node.title}</span>}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {TINT_PALETTE.map((sw) => {
          const on = sw.name === current
          return (
            <button
              key={sw.name}
              type="button"
              title={sw.name === 'default' ? t('默认（随分支）') : sw.label}
              onClick={() => pick(sw)}
              className={
                'flex h-7 items-center justify-center rounded-lg border-2 transition ' +
                (on ? 'border-seal' : 'border-transparent hover:border-line-strong')
              }
            >
              {sw.name === 'default' ? (
                // 「默认」画成一圈斜线：它不是一个颜色，是「不定颜色」
                <span
                  className="h-4 w-4 rounded-full border border-ink-faint"
                  style={{
                    background:
                      'repeating-linear-gradient(45deg, transparent 0 3px, var(--color-ink-faint) 3px 4.5px)',
                  }}
                />
              ) : (
                <span
                  className="h-4 w-4 rounded-full"
                  style={{ backgroundColor: sw.light }}
                />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 当前是不是深色。用 `prefers-color-scheme` 而不是读 `data-theme`：
 * 主题块有八套，只有 `dark` 那一套需要另一组色值，其余五套浅色用 light 值即可——
 * 而 `data-theme=dark` 与系统偏好是一致的（见 lib/appearance）。
 */
function usePrefersDark(): boolean {
  const [dark, setDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}

/**
 * 预览子节点卡片：
 * 尺寸 400 * 600，只读预览教学文档、笔记、试卷/考试记录、超级文档。
 * 顶部带有类型徽章、标题、在页签栏打开的按钮（指向右上箭头）、关闭按钮。
 * 当相机选中该卡片时自动调整缩放和居中。
 */
function PreviewNodeCard({
  item,
  activePreview,
  store,
  docs,
  exams,
  onOpenNode,
  onClose,
  onSelect,
  selected,
  isClosing,
}: {
  item: MindmapNodeData
  activePreview: ActivePreviewInfo
  store: LearnStore
  docs: NodeDocActions
  exams: ExamActions
  onOpenNode: (nodeId: string) => void
  onClose: () => void
  onSelect: () => void
  selected: boolean
  isClosing?: boolean
}) {
  const theme = PREVIEW_TYPE_THEME[activePreview.kind]
  const parentNode = store.nodes.find((n) => n.id === activePreview.parentNodeId)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // 保证卡片内滚动不被外层画布的 wheel 监听器拦截或触发画布平移
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // 未按住 Ctrl/Cmd 键时，阻止事件冒泡到画布容器，允许容器原生滚动浏览
      if (!e.ctrlKey && !e.metaKey) {
        e.stopPropagation()
      }
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const handleOpenInTab = (e: React.MouseEvent) => {
    e.stopPropagation()
    switch (activePreview.kind) {
      case 'doc':
        onOpenNode(activePreview.parentNodeId)
        break
      case 'note':
        if (activePreview.noteName) {
          docs.onOpenNote(activePreview.parentNodeId, activePreview.noteName)
        }
        break
      case 'super':
        if (activePreview.superName) {
          docs.onOpenSuperDoc(activePreview.parentNodeId, activePreview.superName)
        }
        break
      case 'exam':
        if (activePreview.attemptId && activePreview.examId) {
          docs.onOpenAttempt(activePreview.parentNodeId, activePreview.examId, activePreview.attemptId)
        } else if (activePreview.examId) {
          exams.onStart(activePreview.parentNodeId, activePreview.examId)
        }
        break
    }
  }

  // 根据不同类型获取内容
  const docMarkdown = useMemo(() => {
    if (activePreview.kind === 'doc') {
      return parentNode?.docs?.teaching ?? ''
    }
    if (activePreview.kind === 'note' && parentNode && activePreview.noteName) {
      const n = findNote(notesOf(parentNode), activePreview.noteName)
      return n?.content ?? ''
    }
    return ''
  }, [activePreview, parentNode])

  const docHtml = useMemo(() => {
    if (activePreview.kind === 'doc' || activePreview.kind === 'note') {
      return renderNote(docMarkdown)
    }
    return ''
  }, [activePreview.kind, docMarkdown])

  const superDoc = useMemo(() => {
    if (activePreview.kind !== 'super' || !activePreview.superName) return null
    return readSuperDoc(store, activePreview.parentNodeId, activePreview.superName)
  }, [activePreview, store])

  const exam = useMemo(() => {
    if (activePreview.kind !== 'exam' || !activePreview.examId) return null
    return store.exams.find((e) => e.id === activePreview.examId)
  }, [activePreview, store.exams])

  const attempt = useMemo(() => {
    if (!exam || !activePreview.attemptId) return null
    return exam.attempts.find((a) => a.id === activePreview.attemptId)
  }, [exam, activePreview.attemptId])

  const attemptScoreVal = attempt ? attemptScore(attempt) : null
  const totalPoints = exam ? examTotalPoints(exam) : 0

  return (
    <div
      role="region"
      tabIndex={0}
      data-mm-card=""
      data-preview-card=""
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      onMouseDown={(e) => {
        // 阻止 mousedown 冒泡到画布容器，防止拖动滚动条或选中文本时意外触发画布平移
        e.stopPropagation()
      }}
      style={{
        left: item.x,
        top: item.y,
        width: item.width,
        height: item.height,
        borderColor: theme.border,
        boxShadow: selected
          ? `0 0 0 2px ${theme.border}, 0 16px 36px -8px rgba(0,0,0,0.22)`
          : '0 8px 24px -6px rgba(0,0,0,0.12)',
      }}
      className={`absolute flex flex-col rounded-2xl border-2 bg-paper text-ink dark:bg-card z-20 select-none overflow-hidden transition-[left,top,box-shadow,border-color] duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${
        isClosing ? 'moji-preview-collapse' : 'moji-preview-sprout'
      }`}
    >
      {/* 顶部标题栏 */}
      <div
        className="flex h-11 shrink-0 items-center justify-between border-b px-3 gap-2"
        style={{
          borderColor: `${theme.border}40`,
          backgroundColor: `${theme.border}12`,
        }}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold text-white shadow-2xs"
            style={{ backgroundColor: theme.color }}
          >
            {theme.label}
          </span>
          <button
            type="button"
            onClick={handleOpenInTab}
            title={t('在页签栏打开《{0}》', activePreview.title)}
            className="truncate text-left text-[12px] font-bold text-seal underline decoration-seal/40 decoration-1 underline-offset-[3px] transition hover:text-seal-deep hover:decoration-seal cursor-pointer"
          >
            {activePreview.title}
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            title={t('关闭预览')}
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-ink-soft transition hover:bg-black/10 dark:hover:bg-white/10 hover:text-ink cursor-pointer"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* 正文区域（只读） */}
      <div
        ref={scrollRef}
        data-preview-scroll=""
        className="flex-1 min-h-0 overflow-y-auto p-4 select-text"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {(activePreview.kind === 'doc' || activePreview.kind === 'note') && (
          docMarkdown.trim() ? (
            <MarkdownView html={docHtml} className="text-[12px] leading-relaxed" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-ink-faint text-[12px]">
              <FileText size={28} className="mb-2 opacity-30" />
              <span>{activePreview.kind === 'doc' ? t('还没有教学文档内容') : t('笔记内容为空')}</span>
            </div>
          )
        )}

        {activePreview.kind === 'super' && (
          superDoc?.html ? (
            <iframe
              srcDoc={superDoc.html}
              sandbox="allow-scripts"
              className="h-full w-full border-0 rounded-lg bg-card"
              title={activePreview.title}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-ink-faint text-[12px]">
              <FlaskConical size={28} className="mb-2 opacity-30" />
              <span>{t('超级文档内容为空')}</span>
            </div>
          )
        )}

        {activePreview.kind === 'exam' && exam && (
          <div className="flex flex-col gap-3 text-[12px]">
            {attempt ? (
              <>
                <div className="flex items-center justify-between rounded-xl border border-line bg-line/20 p-2.5">
                  <div>
                    <span className="text-[11px] text-ink-faint">{t('得分')}</span>
                    <div className="text-[16px] font-bold text-ink">
                      {attemptScoreVal != null ? `${attemptScoreVal} / ${totalPoints} 分` : t('未判分')}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      attempt.passed ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {attempt.passed ? t('已通过') : t('未通过')}
                  </span>
                </div>

                {attempt.explanation && (
                  <div className="rounded-xl border border-line bg-card/60 p-3">
                    <div className="text-[11px] font-semibold text-ink-soft mb-1.5">{t('错题讲解 / 解析')}</div>
                    <MarkdownView html={renderNote(attempt.explanation)} className="text-[11.5px] leading-relaxed" />
                  </div>
                )}

                <div className="space-y-2 mt-1">
                  <div className="text-[11px] font-semibold text-ink-soft">{t('作答详情 ({0} 题)', exam.questions.length)}</div>
                  {exam.questions.map((q, idx) => {
                    const ans = attempt.answers.find((a) => a.questionId === q.id)
                    const res = attempt.results?.find((r) => r.questionId === q.id)
                    return (
                      <div key={q.id} className="rounded-lg border border-line/60 bg-card/40 p-2.5">
                        <div className="flex items-center justify-between mb-1.5 text-[11px] font-medium text-ink">
                          <div className="flex items-center gap-1.5">
                            <span className="text-ink-faint">#{idx + 1}</span>
                            <span className="rounded bg-line/60 px-1 py-0.5 text-[10px] text-ink-soft">
                              {QUESTION_TYPE_LABEL[q.type] || q.type}
                            </span>
                            <span className="text-[10px] text-ink-faint tabular-nums">
                              {t('（{0} 分）', q.points)}
                            </span>
                          </div>
                          {res?.correct != null && (
                            <span className={`text-[10px] font-semibold ${res.correct ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                              {res.correct ? t('正确') : t('错误')}
                              {res.score != null ? ` (${res.score}分)` : ''}
                            </span>
                          )}
                        </div>

                        {/* 题干 Markdown 渲染 */}
                        <div className="text-[11.5px] leading-relaxed text-ink mb-1.5">
                          <MarkdownView html={renderNote(q.stem)} className="text-[11.5px]" />
                        </div>

                        {/* 配图 */}
                        {q.image && (
                          <div className="my-1.5 flex justify-center rounded border border-line/60 bg-paper/30 p-2 moji-exam-figure" dangerouslySetInnerHTML={{ __html: q.image }} />
                        )}

                        {/* 选项作答 */}
                        {q.options && (
                          <div className="pl-2 space-y-1 text-[11px] text-ink-soft">
                            {q.options.map((opt) => {
                              const isChosen = ans?.value?.includes(opt.id)
                              return (
                                <div key={opt.id} className={`flex items-start gap-1.5 ${isChosen ? 'font-semibold text-seal' : ''}`}>
                                  <span className="shrink-0">{opt.id}.</span>
                                  <span className="flex-1 min-w-0" dangerouslySetInnerHTML={{ __html: renderInline(opt.text) }} />
                                  {isChosen && (
                                    <span className="shrink-0 rounded bg-seal/15 px-1 py-0.2 text-[9.5px] text-seal-deep">
                                      {t('你的选择')}
                                    </span>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {/* 非选择题的作答 */}
                        {(q.type === 'fill' || q.type === 'short') && ans?.text && (
                          <div className="mt-1.5 rounded border border-line/60 bg-paper/40 p-2 text-[11px] text-ink-soft">
                            <span className="text-[10px] font-semibold text-ink-faint block mb-0.5">{t('你的作答：')}</span>
                            <div className="text-[11px] leading-relaxed text-ink">
                              <MarkdownView html={renderNote(ans.text)} className="text-[11px]" />
                            </div>
                          </div>
                        )}

                        {/* 评语 Markdown 渲染 */}
                        {res?.comment && (
                          <div className="mt-2 rounded bg-amber-500/10 border border-amber-500/20 p-2 text-[11px] text-amber-700 dark:text-amber-300">
                            <div className="font-semibold mb-0.5 text-[10px]">{t('评语')}</div>
                            <div className="text-[11px] leading-relaxed">
                              <MarkdownView html={renderNote(res.comment)} className="text-[11px]" />
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center text-ink-faint">
                <p className="text-[12px]">{t('试卷本身不支持预览，请在考试记录中查看作答副本')}</p>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => exams.onStart(activePreview.parentNodeId, exam.id)}
                    className="rounded-xl bg-seal px-3.5 py-1.5 text-center text-[12px] font-semibold text-white shadow-2xs hover:bg-seal-deep transition cursor-pointer"
                  >
                    {t('在页签栏开考')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
