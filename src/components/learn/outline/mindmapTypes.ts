/*
 * 本文件负责：思维导图（MindmapView）各模块共享的**类型与常量**。
 *
 * 为什么单独一个文件而不是留在组件文件里：MindmapView.tsx 是组件文件，
 * 「组件文件不导出非组件」（oxlint 的 react/only-export-components）——类型、
 * 调色盘、尺寸常量都得有自己的住处（同 mindmapNav.ts / mindmapTint.ts 的拆法）。
 * 下面每一项都原样搬自 MindmapView.tsx，注释一并带走。
 */
import type { KnowledgeNode, LearnStore, MasteryStatus, OutlineEntry, TabRef } from '../../../learn/types'
import type { ExamActions, NodeDocActions } from '../explorer/types'

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
  onCreateChild?: (parentNode: KnowledgeNode, entry: OutlineEntry) => void
  /** 请导师规划 / 重排某个节点的大纲 */
  onGenerate?: (node: KnowledgeNode) => void
  /** 改某个节点的自定义颜色；传 null = 回到「随分支」 */
  onSetTint?: (nodeId: string, tint: string | null) => void
  /**
   * 节点 tip 里的文档动作。与侧栏资源管理器**同一份**（见 LearnWorkspace 的 explorerDocs）：
   * 「新建一份笔记」在侧栏和在图里必须是同一件事，各写一套迟早会分叉。
   */
  docs: NodeDocActions
  /** 考试那一侧的动作（tip 里的试卷要能开考、判分、删除） */
  exams: ExamActions
  /** 焦点格里正开着的那份文档：tip 里对应的那一行要亮 */
  activeTab?: TabRef | null
  /** 外部指定的聚焦/选中节点目标（如 chip 路由） */
  focusTarget?: { nodeId: string; nonce: number } | null
  /** 外部聚焦已完成的回调 */
  onFocusHandled?: () => void
  /** 只读模式：不能编辑节点，只能打开节点对应的页签 */
  readOnly?: boolean
  /** 切换视图模式回调 */
  onToggleViewMode?: () => void
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

export interface MindmapEdge {
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

export const GAP_X = 100
export const GAP_Y = 28
export const PADDING = 56

/**
 * 卡片的**统一尺寸**。从前根节点 230×88、一级 210×76、更深 190×…——
 * 三级三种尺寸，图看着像三种东西拼的。现在全一个尺寸：层级交给缩进（GAP_X）与
 * 连线表达，卡片自己不必再长得不一样。
 */
export const CARD_W = 224
export const CARD_H = 104

/**
 * tip 那个气泡尖角的边长（px）。
 *
 * 尖角是一个转了 45° 的小方块，只留朝外的两条边——于是它的对角线（≈1.414×边长）
 * 正好横跨「卡片下沿」到「气泡上沿」那段空当，看起来就像气泡从按钮那儿长出来。
 * 10 这个数是照着那段空当量出来的：菱形顶端比自己的上边界还高出约 0.207×边长，
 * 10 × 0.207 ≈ 2px，加上 10px 的砖身，正好把 8px 的空当填满。
 */
export const TIP_TAIL = 10

/** 卡片下沿与 tip 上沿之间的空当（即 tip 的 marginTop）：尖角要横跨这一段 */
export const TIP_GAP = 8

/**
 * tip 自己的边框宽度（border-2）。
 *
 * 绝对定位的子元素，left/top 是相对**父元素的 padding box** 量的，而锚点（anchorX）
 * 与卡片下沿都是相对 border box 量的——差的就是这道边框。少了这一项，
 * 尖角会整体偏出 2px，在放大之后看得清清楚楚。
 */
export const TIP_BORDER = 2

/** 底栏那一排文档按钮中的一颗 */
export type DocKey = 'note' | 'exam' | 'super'

/** 三类文档按钮的名字（图标 + 数量之外，tooltip 里要用） */
export const DOC_LABEL: Record<DocKey, string> = {
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
export const DOC_BUTTONS: DocKey[] = ['note', 'exam', 'super']
