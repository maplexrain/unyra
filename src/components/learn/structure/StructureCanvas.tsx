export interface CanvasPerfStats {
  totalCards: number
  visibleCards: number
  totalEdges: number
  zoom: number
}

let lastCanvasStats: CanvasPerfStats = {
  totalCards: 0,
  visibleCards: 0,
  totalEdges: 0,
  zoom: 1,
}

export function getCanvasPerfStats(): Readonly<CanvasPerfStats> {
  return lastCanvasStats
}

/**
 * 这个文件负责什么：**结构画布**——一张固定视角的 3D 平面上的类型化节点图
 * （页签 kind 'outline' 的新形态）。
 *
 * ## 为什么是 3D 平面
 *
 * 节点有**碰撞体积**（不能叠在一起），但拖动时又必须能从别人头上飞过去。
 * 这两件事只有在一个有 z 轴的场景里才说得通：平时所有卡片都躺在 z=0 的平面上，
 * 拖起来的那张抬到 z>0，于是「实时碰撞」照旧成立、只是被提起的那个碰不到别人。
 *
 * 相机是**固定的**：平面绕 X 轴倾斜 18°、正交投影（不开 perspective）。
 * 正交的好处是屏幕坐标与世界坐标之间只差一个 cos 系数——指针换算是一个乘法，
 * 而不是透视除法；一旦开了 perspective，每一次鼠标移动都要解一遍投影方程。
 *
 * ## v2 的数据契约（全图化重构，2026-10-24）
 *
 * - **卡片就是节点**：deriveCanvas 从 store 派生 `{ cards, edges, heightOf }`，
 *   卡片 uuid 直接对上实体；连线全部派生（树边 / 归属 / 目标绑定），不存一条线；
 * - 画布自有状态只有**坐标与便条**（structure.json 的 positions 表）：拖动、注释
 *   走 onChange 写坐标表；建 / 删 / 连 / 改名走宿主的统一通道（NodeService），
 *   与 agent 的 api.node 是同一条路——画布上不再有任何「只存在于图里」的状态；
 * - 删除卡片 = 删除实体（连坐规则在服务层），墓碑随之退役：没有派生补卡，
 *   「删了又冒出来」从根上不存在。
 *
 * ## 一条纪律：几何计算全在领域层
 *
 * 包围盒、缩放下限、卡片尺寸与高度、命中矩形、连线曲线、目标项配色、碰撞，
 * 全部来自 `learn/structure` 与 `structureView`。组件只负责把指针事件翻译成
 * 「谁的坐标变了」「连了哪两个」。
 */

import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Trash2 } from 'lucide-react'
import type { LearnStore } from '../../../learn/types'
import type { ExamActions, NodeDocActions } from '../explorer/types'
import { locateUuid, outlineUuid, docIdOfOutlineUuid, type GNodeKind } from '../../../learn/nodeKinds'
import {
  CARD_H,
  CARD_W,
  GRAPH_KIND_LABEL,
  boundsOf,
  centerPan,
  clampZoom,
  fitZoom,
  EDGE_STYLES,
  STRUCT_MIN_ZOOM_FACTOR,
  type EdgeStyle,
  type StructureMap,
} from '../../../learn/structure'
import { nodeById } from '../../../learn/graph'
import { t } from '../../../i18n'
export const TOUR_SEEN_KEY = 'moji:structure:tour-seen'
import { StructureTour } from './StructureTour'
import { getTourMockCanvas, getTourCamera } from './tourMockData'
import {
  CARD_PAD_B,
  DOC_LINES,
  DOC_LINE_H,
  EDGE_ANCHOR_Y,
  KIND_BADGE,
  KIND_TONE,
  OUTLINE_HEAD,
  SLOT_ROW,
  deriveCanvas,
  edgeAt,
  edgeCurve,
  edgeDotAt,
  edgeDots,
  edgeElbow,
  edgePathD,
  edgeRoute,
  hitTest,
  isTextEntryTarget,
  slotAnchorY,
  SLOT_ACCENT,
  type CanvasEdge,
  type CardView,
  type Point,
} from './structureView'

/** 统一通道的回执形状（与 NodeResult 同构；拒绝必须带一句人话） */
type ChannelResult = { ok: true; note?: string } | { error: string }

export interface StructureCanvasProps {
  store: LearnStore
  /** 这一页属于哪个目标 */
  goalId: string
  /** 坐标表变了（画布自有状态只有坐标与便条） */
  onChange: (next: StructureMap) => void
  /** 文档那一侧的动作：点标题打开教学文档 / 笔记 / 超级文档 */
  docs: NodeDocActions
  /** 考试那一侧的动作：点试卷标题开考试窗口 */
  exams: ExamActions
  /** 节点落地（统一通道）：under 给了 = 创建即绑；null + at = 独立实体落在空白处 */
  onCreateNode?: (
    kind: GNodeKind,
    under: string | null,
    at?: { x: number; y: number },
  ) => { uuid: string; title: string } | { error: string }
  /** 删除节点（统一通道：删谁只删谁） */
  onDeleteNode?: (uuid: string) => ChannelResult
  /** 连线（双边协商在服务层：大纲↔文档挂层、文档↔挂件绑定） */
  onConnect?: (fromUuid: string, toUuid: string, portKey?: string) => ChannelResult
  /** 断开一条连线（= 解绑 / 拆边；两端实体都不动） */
  onDisconnect?: (fromUuid: string, toUuid: string) => ChannelResult
  /** 右键「设为入口」：把一份没有上级的文档立为本图的入口（目标的根；全图有且只有一个） */
  onSetEntry?: (docUuid: string) => ChannelResult
  /** 点大纲目标项：挂一份带标题的空文档（统一通道建实体），返回新文档 uuid */
  onCreateChildDoc?: (ownerNodeId: string, title: string, portKey?: string) => string | null
  /** 改笔记名（宿主走笔记节点的 editContent，页签跟着改） */
  onRenameNote?: (noteUuid: string, to: string) => ChannelResult
  /** 给某份大纲手动加一条目标项（宿主走大纲节点的 editContent） */
  onAddOutlineEntry?: (outlineUuid: string, title: string) => void
  /** 视频卡上选一个视频绑到本目标（统一通道：与 agent 的 editContent({ videoId }) 同一条路）；null = 解绑 */
  onBindVideo?: (nodeUuid: string, videoId: string | null) => ChannelResult
  /** 打开绑定的视频（打开它 = 一并打开本目标的页签组，见 LearnWorkspace 的 openTab） */
  onOpenVideo?: (videoId: string) => void
  /** 给一个空文档卡点「生成文档」：交给 AI 写正文 */
  onGenerateDoc?: (nodeUuid: string, hint?: string) => void
  /** 文档卡右键菜单的「生成前置知识大纲」 */
  onGenerateOutline?: (docUuid: string) => void
  /** 视频卡点「生成总览」：交给 AI 根据选集生成总览文档并挂在视频节点子级 */
  onGenerateVideoDoc?: (videoNodeUuid: string) => void
  onToast?: (msg: string) => void
  /** 外部指定的聚焦目标（chip 路由）：把镜头挪到 uuid 对得上的那张卡 */
  focusTarget?: { nodeId: string; nonce: number } | null
  onFocusHandled?: () => void
}

/**
 * 左侧列表：挂件 + 视频节点。实体先行：拖到空白处就走统一通道建真实空实体，
 * 卡从落位那刻起就由 store 派生。入口、文档与大纲不在列表里——入口由目标绑定
 * 派生，子文档点大纲目标项，前置知识大纲走文档卡右键菜单。
 */
const PALETTE: GNodeKind[] = ['doc', 'outline', 'note', 'exam', 'superdoc', 'video']

/** 网格背景的点距（世界坐标 px）：平移/缩放时按相机换算，见画布根的 backgroundImage */
const GRID_PX = 28

/** 双击节点聚焦的落点与缩放：节点停在屏幕高的 40% 处、水平居中，放大到 140% */
const FOCUS_ZOOM = 1.4
const FOCUS_VERTICAL = 0.4

/**
 * palette 行的图标：全部 24×24、描边 2、圆角端点——与 lucide 同一套笔画语言
 * （自绘图标纪律：比例先对齐成熟图形语言，不自造异形字）。图形口径：
 * 文档=带折角与行线的纸、大纲=圆点列表、笔记=折角便签、试卷=带勾的夹板、
 * 超级文档=闪光。
 */
function KindIcon({ kind }: { kind: GNodeKind }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (kind === 'doc') {
    return (
      <svg {...common}>
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        <path d="M10 9H8" />
        <path d="M16 13H8" />
        <path d="M16 17H8" />
      </svg>
    )
  }
  if (kind === 'outline') {
    return (
      <svg {...common}>
        <path d="M3 6h.01" />
        <path d="M3 12h.01" />
        <path d="M3 18h.01" />
        <path d="M8 5h13" />
        <path d="M8 12h13" />
        <path d="M8 19h13" />
      </svg>
    )
  }
  if (kind === 'note') {
    return (
      <svg {...common}>
        <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11l5-5V5a2 2 0 0 0-2-2Z" />
        <path d="M15 21v-4a2 2 0 0 1 2-2h4" />
      </svg>
    )
  }
  if (kind === 'video') {
    // monitor-play 的同款笔画：屏幕 + 居中播放三角 + 底座（比例对齐 lucide，不自造异形）
    return (
      <svg {...common}>
        <path d="M10 7.5v9l7-4.5Z" />
        <rect width="20" height="14" x="2" y="3" rx="2" />
        <path d="M8 21h8" />
        <path d="M12 17v4" />
      </svg>
    )
  }
  if (kind === 'exam') {
    return (
      <svg {...common}>
        <rect width="8" height="4" x="8" y="2" rx="1" />
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <path d="m9 14 2 2 4-4" />
      </svg>
    )
  }
  
  return (
    <svg {...common}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L13.663 8.5a2 2 0 0 0 1.401 1.398l6.135 1.581a.5.5 0 0 1 0 .964L13.5 14.063a2 2 0 0 0-1.4 1.402l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
      <path d="M4 17v2" />
      <path d="M5 18H3" />
    </svg>
  )
}

/**
 * 右下角工具组的图标按钮：文字说明只住在悬停 tip 里，平时零占位。
 * tip 从按钮**左侧**探出——工具组贴着画布右下角，右边没有地方。
 */
function ControlButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group/btn relative flex h-6 w-6 items-center justify-center rounded transition hover:bg-line/60 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
      <span className="pointer-events-none absolute right-full top-1/2 z-30 mr-1.5 -translate-y-1/2 whitespace-nowrap rounded-md border border-line bg-card px-1.5 py-0.5 text-[11px] text-ink-soft opacity-0 shadow-sm transition group-hover/btn:opacity-100">
        {label}
      </span>
    </button>
  )
}

/** 工具组图标的公共笔画：24×24、描边 2、圆角端点——与 KindIcon 同一套笔画语言 */
const ICON_STROKE = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
} as const

/** 全景缩略图的窗口大小（屏幕像素） */
const MINI_W = 248
const MINI_H = 160

/** 缩略图上各类型的填充色（与卡片色板同族；SVG 要具体色值，大纲跟主题印章色走） */
const MINI_FILL: Record<GNodeKind, string> = {
  entry: '#f43f5e',
  outline: 'var(--color-seal, #a8432f)',
  doc: '#0ea5e9',
  note: '#10b981',
  exam: '#f59e0b',
  superdoc: '#8b5cf6',
  video: '#06b6d4',
}

type Gesture =
  | { mode: 'pan'; startX: number; startY: number; camX: number; camY: number }
  | {
      mode: 'node'
      id: string
      grabX: number
      grabY: number
      origX: number
      origY: number
      moved: boolean
      /** 按下的是标题：没拖动的话松手就打开它 */
      openTitle: boolean
      /** 多选整组拖：这批卡按下时的原位置（含按下的这张）；单选拖没有它 */
      group?: Array<{ id: string; x: number; y: number }>
    }
  | { mode: 'link'; from: string; fromKind: GNodeKind; slotKey?: string; moved?: boolean }
  | {
      mode: 'palette'
      kind: GNodeKind
      /** 指针是否离开过列表：没离开过就松手 = 把它放回去了，不建节点 */
      leftList?: boolean
    }
  | { mode: 'marquee'; startX: number; startY: number }
  | null

/** 右键菜单：贴指针弹出，作用在某个节点上 */
interface MenuState {
  x: number
  y: number
  uuid: string
  /** actions = 动作清单；note = 写注释；rename = 改笔记名；slot = 新加一条目标项；videoPick = 给视频卡挑一个视频绑上 */
  mode: 'actions' | 'note' | 'rename' | 'slot' | 'videoPick'
}

export const StructureCanvas = memo(function StructureCanvas({
  store,
  goalId,
  onChange,
  docs,
  exams,
  onCreateNode,
  onDeleteNode,
  onConnect,
  onDisconnect,
  onSetEntry,
  onCreateChildDoc,
  onRenameNote,
  onAddOutlineEntry,
  onBindVideo,
  onOpenVideo,
  onGenerateDoc,
  onGenerateOutline,
  onGenerateVideoDoc,
  onToast,
  focusTarget,
  onFocusHandled,
}: StructureCanvasProps) {
  /**
   * 图是**算出来的**（deriveCanvas）：卡片就是节点、连线全部派生、
   * 没存过坐标的卡自动铺排。没有对账，也没有「首帧铺一张」的 effect。
   */
  /** 新手教学开着没有（入口在右下角工具组的问号按钮，见 StructureTour） */
  const [tourOpen, setTourOpen] = useState(false)
  const savedCameraRef = useRef<{ x: number; y: number; zoom: number } | null>(null)

  const saved = store.structure?.[goalId]
  const realCanvas = useMemo(() => deriveCanvas(store, goalId, saved), [store, goalId, saved])
  // 教学模式开始时清空真实面板数据，使用教学假数据展示全貌；退出后立即恢复真实数据
  const canvas = useMemo(() => (tourOpen ? getTourMockCanvas() : realCanvas), [tourOpen, realCanvas])
  const cards = canvas.cards
  const edges = canvas.edges
  const height = canvas.heightOf

  const containerRef = useRef<HTMLDivElement | null>(null)
  const trashRef = useRef<HTMLDivElement | null>(null)
  /** 左侧节点列表：拖出去必须离开过它，松手才允许落地（见 Gesture.palette.leftList） */
  const paletteRef = useRef<HTMLDivElement | null>(null)
  /** 上一次中键按下时刻：双击中键 = 适应画布（Chromium 不给中键派发 dblclick，只能自己计时） */
  const lastMiddleDownRef = useRef(0)
  const [view, setView] = useState({ width: 0, height: 0 })
  const [camera, setCamera] = useState({ x: 72, y: 72, zoom: 1 })
  const cameraRef = useRef(camera)
  useEffect(() => {
    cameraRef.current = camera
  }, [camera])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 选中的连线（点线选中，Delete 断开）。卡片与连线同时只选一个 */
  const [selectedEdge, setSelectedEdge] = useState<CanvasEdge | null>(null)
  /**
   * 选框多选：拉框圈中的那批卡。与 selectedId 互斥——点任何一张卡就回到单选。
   * 多选目前只服务一件事：Delete 一把删（逐个走统一通道）。
   */
  const [multiIds, setMultiIds] = useState<Set<string> | null>(null)
  /** 拉框进行中的那个矩形（世界坐标，已归一成 x/y/width/height） */
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  /** 指针停在哪个节点上（高亮用） */
  const [hoverId, setHoverId] = useState<string | null>(null)

  const autoTourCheckedRef = useRef(false)

  const handleOpenTour = useCallback(() => {
    try {
      localStorage.setItem(TOUR_SEEN_KEY, '1')
    } catch {
      // ignore
    }
    savedCameraRef.current = camera
    const tourCam = getTourCamera(view.width, view.height)
    setCamera(tourCam)
    setSelectedId(null)
    setMultiIds(null)
    setHoverId(null)
    setTourOpen(true)
  }, [camera, view.width, view.height])

  const handleCloseTour = useCallback(() => {
    try {
      localStorage.setItem(TOUR_SEEN_KEY, '1')
    } catch {
      // ignore
    }
    setTourOpen(false)
    if (savedCameraRef.current) {
      setCamera(savedCameraRef.current)
      savedCameraRef.current = null
    }
  }, [])

  // 首次进入节点宇宙时检测是否看过教程，若未看过则自动开启
  useEffect(() => {
    if (autoTourCheckedRef.current) return
    if (view.width <= 0 || view.height <= 0) return
    autoTourCheckedRef.current = true
    try {
      const seen = localStorage.getItem(TOUR_SEEN_KEY)
      if (!seen) {
        handleOpenTour()
      }
    } catch {
      // ignore
    }
  }, [view.width, view.height, handleOpenTour])
  /** 指针停在哪条连线附近（小圆点只在此时出现） */
  const [hoverEdge, setHoverEdge] = useState<CanvasEdge | null>(null)
  /** 指针正压在某个小圆点上（换成手型光标） */
  const [hoverDot, setHoverDot] = useState(false)
  /** 指针停在某个目标项上：对应的那条子文档连线发光 */
  const [hoverSlot, setHoverSlot] = useState<{ parentId: string; key: string } | null>(null)
  /** 拖动中的节点位置（只在本地，松手才写回坐标表）；整组拖时 moves 带上每一张的新位置 */
  const [draft, setDraft] = useState<{
    id: string
    x: number
    y: number
    moves?: Record<string, { x: number; y: number }>
  } | null>(null)
  /** 连线中的起点与指针位置（世界坐标）：画那条跟手的线 */
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  const [linkAt, setLinkAt] = useState<{ x: number; y: number } | null>(null)
  /** 这次连线是从哪条目标项拉出来的（跟手的线要从那一行出发） */
  const [linkSlot, setLinkSlot] = useState<string | null>(null)

  /** 目标项圆点的**实测**高度（离卡片顶部），key = `卡片 uuid|目标项 key` */
  const [dotY, setDotY] = useState<Record<string, number>>({})
  const planeRef = useRef<HTMLDivElement | null>(null)
  /** 从列表拖出来的那一下：指针的屏幕坐标 */
  const [paletteAt, setPaletteAt] = useState<{ x: number; y: number } | null>(null)
  const [paletteKind, setPaletteKind] = useState<GNodeKind | null>(null)
  /** 正拖着一个节点在垃圾桶上方 */
  const [overTrash, setOverTrash] = useState(false)
  /** 镜头正在做过渡（这段时间平面带 transition，跳转才是「滑过去」而不是瞬移） */
  const [animating, setAnimating] = useState(false)
  const animTimer = useRef<number | null>(null)
  /** 跳转后闪一下的那张卡（900ms 后清掉） */
  const [flashId, setFlashId] = useState<string | null>(null)
  const flashTimer = useRef<number | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [menuText, setMenuText] = useState('')


  /** 空格按住时左键也能拖画布（见 onPointerDown） */
  const spaceRef = useRef(false)
  const [spaceDown, setSpaceDown] = useState(false)
  const gestureRef = useRef<Gesture>(null)
  /**
   * 最近一次左键按下的卡片（双击的落点判定用）。画布容器在每次左键按下时
   * 捕获指针，双击派生的 click/dblclick 目标会被重定向到容器——dblclick 的
   * e.target 到不了卡片上（「双击卡片打开」其实从来没通过 dblclick 生效过，
   * 打开靠的是第一下点标题），落点只能认按下那一刻记下的这份。
   */
  const lastDownCardRef = useRef<{ id: string; openTitle: boolean } | null>(null)
  const fittedRef = useRef(false)
  /** 下一次 cards 变了之后要不要自动对镜头（自动排列之后用） */
  const fitNextRef = useRef(false)

  const bounds = useMemo(() => boundsOf(cards, height), [cards, height])

  /**
   * 连线的「大纲那一端」对准子级对应的那条目标项，而不是卡片顶部那个固定锚点。
   * 从大纲卡出发的线都是树边（子级接文档或接大纲）；归属边（文档 → 它的大纲、挂件）没有目标项可言。
   */
  const anchorOf = useCallback(
    (edge: CanvasEdge) => {
      const from = cards.find((c) => c.uuid === edge.from)
      const to = cards.find((c) => c.uuid === edge.to)
      if (!from || !to || from.kind !== 'outline') return undefined
      const slot = from.slots?.find((s) => s.childId === to.uuid)
      if (!slot) return undefined
      // 实测的圆点位置优先（DOM 量出来的才是真位置）；没量到就按行号算
      return { from: dotY[`${from.uuid}|${slot.key}`] ?? slotAnchorY(slot.index) }
    },
    [cards, dotY],
  )
  /** 连线画法：默认直线（见 learn/structure 的 EDGE_STYLES） */
  const edgeStyle: EdgeStyle = saved?.edgeStyle ?? 'straight'

  /** 拖动中的那一张（整组拖时是整组）用 draft 的位置：连线跟着动，而不是松手才跳过去 */
  const displayCards = useMemo(() => {
    if (!draft) return cards
    return cards.map((c) => {
      const m = draft.moves?.[c.uuid]
      if (m) return { ...c, x: m.x, y: m.y }
      return c.uuid === draft.id ? { ...c, x: draft.x, y: draft.y } : c
    })
  }, [cards, draft])
  const byId = useMemo(() => new Map(displayCards.map((c) => [c.uuid, c])), [displayCards])

  // 性能优化：预先构建上游边索引集合与归属缓存，消除卡片渲染时的 O(N*E) 暴力搜索
  const upstreamEdgeSet = useMemo(() => {
    const set = new Set<string>()
    for (const e of edges) {
      set.add(e.to)
    }
    return set
  }, [edges])

  const leafOwnerCache = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const c of displayCards) {
      if (c.kind === 'exam' || c.kind === 'superdoc') {
        const loc = locateUuid(store, c.uuid)
        map.set(c.uuid, loc?.kind === 'exam' || loc?.kind === 'superdoc' ? loc.docId : null)
      }
    }
    return map
  }, [displayCards, store])

  // 性能优化：计算当前视口在世界坐标系下的包围盒（保留 350px 缓冲垫防边缘闪烁）
  const viewportBox = useMemo(() => {
    if (!view.width || !view.height) return null
    const z = Math.max(camera.zoom, 0.05)
    const pad = 350
    return {
      left: -camera.x / z - pad,
      top: -camera.y / z - pad,
      right: (-camera.x + view.width) / z + pad,
      bottom: (-camera.y + view.height) / z + pad,
    }
  }, [view.width, view.height, camera.x, camera.y, camera.zoom])

  // 记录实时画布性能指标
  useEffect(() => {
    const visibleCount = !viewportBox
      ? displayCards.length
      : displayCards.filter((c) => {
          const h = height(c)
          return (
            c.x <= viewportBox.right &&
            c.x + CARD_W >= viewportBox.left &&
            c.y <= viewportBox.bottom &&
            c.y + h >= viewportBox.top
          )
        }).length
    lastCanvasStats = {
      totalCards: displayCards.length,
      visibleCards: visibleCount,
      totalEdges: edges.length,
      zoom: camera.zoom,
    }
  }, [displayCards, edges.length, camera.zoom, viewportBox, height])


  /**
   * 从列表拖出一张卡时高亮**能当它落点**的卡。落点认类型：
   * 文档挂在大纲之下；大纲拖出去有两个落点——文档卡（给那份文档补大纲）
   * 与大纲卡（在它之下再开一层）；挂件（笔记 / 试卷 / 超级文档）都挂到文档卡。
   * 连线时同理：从大纲拉出的线高亮文档卡与大纲卡，从文档拉出的线高亮大纲卡。
   */
  const candidateIds = useMemo(() => {
    if (paletteKind) {
      const wants: GNodeKind[] =
        paletteKind === 'doc'
          ? ['outline', 'video']
          : paletteKind === 'outline'
            ? ['doc', 'outline']
            : paletteKind === 'video'
              ? [] // 视频节点不挂树：只能落在空白处，没有可作为落点的卡
              : ['doc']
      return new Set(cards.filter((c) => wants.includes(c.kind)).map((c) => c.uuid))
    }
    const g = gestureRef.current
    if (g?.mode === 'link') {
      const wants: GNodeKind[] | null =
        g.fromKind === 'outline'
          ? ['doc', 'outline']
          : g.fromKind === 'video'
            ? ['doc']
            : g.fromKind === 'doc'
              ? ['outline', 'video']
              : null
      // 从大纲拉到大纲：自己那张不算落点（连自己没有意义）
      return wants
        ? new Set(cards.filter((c) => wants.includes(c.kind) && c.uuid !== g.from).map((c) => c.uuid))
        : null
    }
    return null
  }, [paletteKind, cards, linkFrom])

  /**
   * 每条边画在哪：折线走 `edgeRoute`（会绕开卡片），曲线取贝塞尔控制点。
   * 算一次给三处用——画线、点选、两颗小圆点认同一份点列。
   */
  const routes = useMemo(() => {
    const out = new Map<string, Point[]>()
    for (const edge of edges) {
      const from = byId.get(edge.from)
      const to = byId.get(edge.to)
      if (!from || !to) continue
      const anchor = anchorOf(edge)
      out.set(
        `${edge.from}>${edge.to}`,
        edgeStyle === 'curved' ? edgeCurve(from, to, height, anchor) : edgeRoute(from, to, displayCards, height, anchor),
      )
    }
    return out
  }, [edges, byId, displayCards, height, anchorOf, edgeStyle])
  const routeOf = useCallback((edge: CanvasEdge) => routes.get(`${edge.from}>${edge.to}`), [routes])

  /* ---------- 空格：按住时左键临时变成「抓手」 ---------- */

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTextEntryTarget(e.target)) return
      e.preventDefault() // 否则页面会往下滚
      spaceRef.current = true
      setSpaceDown(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      spaceRef.current = false
      setSpaceDown(false)
    }
    // 切走窗口时按键的 keyup 收不到，回来还停在「按住空格」的状态，这里兜一下
    const blur = () => {
      spaceRef.current = false
      setSpaceDown(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  /* ---------- 视口尺寸（缩放的下限要靠它算） ---------- */

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      setView({ width: rect.width, height: rect.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* ---------- 镜头 ---------- */

  /**
   * 镜头跳转：**滑过去**而不是瞬移。
   *
   * 做法是给平面挂 300ms 的 transition-transform，跳完再摘掉——一直挂着的话，
   * 手动拖动与滚轮也会变成「带惯性的慢半拍」，那是另一种难受。
   */
  const animateCamera = useCallback((next: { x: number; y: number; zoom: number }) => {
    setAnimating(true)
    setCamera(next)
    if (animTimer.current !== null) window.clearTimeout(animTimer.current)
    animTimer.current = window.setTimeout(() => {
      animTimer.current = null
      setAnimating(false)
    }, 320)
  }, [])

  const fit = useCallback(() => {
    const box = boundsOf(cards, height)
    if (!box || !view.width || !view.height) return
    const zoom = fitZoom(box, view)
    animateCamera({ ...centerPan(box, view, zoom), zoom })
  }, [cards, height, view, animateCamera])

  useEffect(() => {
    if (fitNextRef.current) {
      fitNextRef.current = false
      fit()
      return
    }
    if (fittedRef.current) return
    if (!view.width || !bounds) return
    fittedRef.current = true
    fit()
  }, [view.width, bounds, fit])

  /** 闪一下边框：跳转之后告诉用户「你被带到这儿了」 */
  const flash = useCallback((id: string) => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    setFlashId(id)
    flashTimer.current = window.setTimeout(() => {
      flashTimer.current = null
      setFlashId(null)
    }, 900)
  }, [])
  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    },
    [],
  )
  useEffect(
    () => () => {
      if (animTimer.current !== null) window.clearTimeout(animTimer.current)
    },
    [],
  )

  const centerOn = useCallback(
    (id: string) => {
      const card = cards.find((c) => c.uuid === id)
      if (!card || !view.width) return
      const zoom = Math.max(cameraRef.current.zoom, 1)
      animateCamera({
        ...centerPan({ x: card.x, y: card.y, width: CARD_W, height: height(card) }, view, zoom),
        zoom,
      })
      setSelectedId(id)
      flash(id)
    },
    [cards, view, height, flash, animateCamera],
  )

  /**
   * 双击节点：把它带到一个**固定**的阅读位——垂直 40%、水平居中、放大 140%。
   * 走 animateCamera 的过渡（300ms ease-out），是滑过去不是闪过去。
   */
  const focusCard = useCallback(
    (card: CardView) => {
      if (!view.width || !view.height) return
      animateCamera({
        x: view.width / 2 - (card.x + CARD_W / 2) * FOCUS_ZOOM,
        y: view.height * FOCUS_VERTICAL - (card.y + height(card) / 2) * FOCUS_ZOOM,
        zoom: FOCUS_ZOOM,
      })
      setSelectedId(card.uuid)
      setMultiIds(null)
      flash(card.uuid)
    },
    [view, height, animateCamera, flash],
  )

  const lastFocusNonce = useRef<number | null>(null)
  useEffect(() => {
    if (!focusTarget || focusTarget.nonce === lastFocusNonce.current) return
    lastFocusNonce.current = focusTarget.nonce
    const target = cards.find((c) => c.uuid === outlineUuid(focusTarget.nodeId)) ?? cards.find((c) => c.uuid === focusTarget.nodeId)
    if (target && view.width) {
      const zoom = Math.max(cameraRef.current.zoom, 1)
      animateCamera({ ...centerPan({ x: target.x, y: target.y, width: CARD_W, height: height(target) }, view, zoom), zoom })
      setSelectedId(target.uuid)
      flash(target.uuid)
    }
    onFocusHandled?.()
  }, [focusTarget, cards, view, height, onFocusHandled, flash, animateCamera])

  /* ---------- 滚轮：平移为主，Ctrl/⌘ + 滚轮缩放 ---------- */

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const cam = cameraRef.current
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        const px = e.clientX - rect.left
        const py = e.clientY - rect.top
        const next = clampZoom(cam.zoom * (e.deltaY > 0 ? 0.92 : 1.08), boundsOf(cards, height), view)
        if (next === cam.zoom) return
        const k = next / cam.zoom
        setCamera({ x: px - (px - cam.x) * k, y: py - (py - cam.y) * k, zoom: next })
        return
      }
      // Shift + 滚轮：横向滚动（触控板横滑本来就给 deltaX，两种都给上）
      const dx = e.shiftKey ? e.deltaY : e.deltaX
      const dy = e.shiftKey ? 0 : e.deltaY
      setCamera({ ...cam, x: cam.x - dx, y: cam.y - dy })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [cards, height, view])

  /* ---------- 坐标换算（正交投影：y 除以 cos 就把倾斜还原了） ---------- */

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current
    const cam = cameraRef.current
    const rect = el?.getBoundingClientRect()
    const left = rect?.left ?? 0
    const top = rect?.top ?? 0
    return {
      x: (clientX - left - cam.x) / cam.zoom,
      y: (clientY - top - cam.y) / cam.zoom,
    }
  }, [])

  const isOverTrash = useCallback((clientX: number, clientY: number) => {
    const rect = trashRef.current?.getBoundingClientRect()
    if (!rect) return false
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  }, [])

  /* ---------- 写回（画布自有状态 = 坐标表；实体走统一通道） ---------- */

  /**
   * 撤回栈：坐标表自己的历史（拖动 / 便条 / 连线画法）。
   * 实体操作（建 / 删 / 连 / 改名）走统一通道，归工作区那边的撤回管——两类动作
   * 不混在同一个栈里，各退各的。
   */
  const historyRef = useRef<StructureMap[]>([])
  const [canUndo, setCanUndo] = useState(false)

  const commit = useCallback(
    (next: StructureMap) => {
      const prev = saved ?? { version: 2 as const, positions: {} }
      historyRef.current.push(prev)
      if (historyRef.current.length > 50) historyRef.current.shift()
      setCanUndo(true)
      onChange(next)
    },
    [saved, onChange],
  )

  const undo = useCallback(() => {
    const prevMap = historyRef.current.pop()
    if (!prevMap) return
    setCanUndo(historyRef.current.length > 0)
    // 撤回本身不再进栈，否则 Ctrl+Z 会在两版之间来回弹
    onChange(prevMap)
    setDraft(null)
    setSelectedId(null)
    setSelectedEdge(null)
    setMultiIds(null)
  }, [onChange])

  /** 换目标就清空：A 课的撤回不该退到 B 课去 */
  useEffect(() => {
    historyRef.current = []
    setCanUndo(false)
  }, [goalId])

  /** 写一张卡的位置（便条跟着位置走，拖动不能把它弄丢） */
  const writePos = useCallback(
    (uuid: string, x: number, y: number, note?: string) => {
      const base = saved ?? { version: 2 as const, positions: {} }
      const prevNote = note ?? base.positions[uuid]?.note
      commit({
        version: 2,
        ...(base.edgeStyle ? { edgeStyle: base.edgeStyle } : {}),
        positions: { ...base.positions, [uuid]: { x, y, ...(prevNote ? { note: prevNote } : {}) } },
      })
    },
    [saved, commit],
  )

  /** 一次提交写一批位置（多选整组拖的落点）：一笔进撤回栈，Ctrl+Z 一次退整组 */
  const writePositions = useCallback(
    (entries: Array<{ uuid: string; x: number; y: number }>) => {
      const base = saved ?? { version: 2 as const, positions: {} }
      const positions = { ...base.positions }
      for (const en of entries) {
        const prevNote = positions[en.uuid]?.note
        positions[en.uuid] = { x: en.x, y: en.y, ...(prevNote ? { note: prevNote } : {}) }
      }
      commit({ version: 2, ...(base.edgeStyle ? { edgeStyle: base.edgeStyle } : {}), positions })
    },
    [saved, commit],
  )

  /** 统一通道的回执 → 吐司（拒绝一定带人话） */
  const report = useCallback(
    (r: ChannelResult) => {
      if ('error' in r) onToast?.(r.error)
      else if (r.note) onToast?.(r.note)
      return 'ok' in r
    },
    [onToast],
  )

  const removeNode = useCallback(
    (uuid: string) => {
      if (!onDeleteNode) {
        onToast?.(t('这个画布没有接入删除通道'))
        return
      }
      // 删根文档 = 删整个目标：这是设计内语义，但绝不能从一张卡的删除键上悄悄发生——
      // 通道里会转接两档确认（与资源管理器同一条路），这里照常走统一通道
      report(onDeleteNode(uuid))
      setSelectedId(null)
      setMenu(null)
    },
    [onDeleteNode, report, onToast],
  )

  /* ---------- 连线（唯一可手工建立：大纲 → 文档 / 大纲） ---------- */

  const tryConnect = useCallback(
    (fromUuid: string, toUuid: string, portKey?: string) => {
      if (!onConnect) return false
      return report(onConnect(fromUuid, toUuid, portKey))
    },
    [onConnect, report],
  )

  /* ---------- 点目标项 ---------- */

  const onSlotClick = useCallback(
    (parentId: string, key: string) => {
      const parent = cards.find((c) => c.uuid === parentId)
      const slot = parent?.slots?.find((s) => s.key === key)
      if (!parent || !slot) return
      if (slot.childId) {
        centerOn(slot.childId)
        return
      }
      /*
       * 点目标项 = 建一份带标题的空文档（统一通道）：create 的同目标去重
       * 会让同一标题永远指向同一份实体；位置由派生自动铺排（父大纲右侧）。
       * owner 直接给大纲 uuid（o:）——服务认得出附身（挂宿主文档）与游离（挂实体）两种。
       */
      const owner = parentId
      if (!onCreateChildDoc) return
      const uuid = onCreateChildDoc(owner, slot.title, slot.key)
      if (!uuid) {
        onToast?.(t('没能创建文档，请稍后再试'))
        return
      }
      setSelectedId(uuid)
      onToast?.(t('「{0}」的空文档已挂上：点卡片上的「生成文档」让 AI 来写', slot.title))
    },
    [cards, centerOn, onCreateChildDoc, onToast],
  )

  /* ---------- 打开内容 ---------- */

  const openNode = useCallback(
    (card: CardView) => {
      if (card.kind === 'doc') {
        docs.onOpenTeach(card.uuid)
        return
      }
      const loc = locateUuid(store, card.uuid)
      // 游离笔记与绑定的笔记**用起来没有任何区别**：同样开笔记页签（页签的实体解析
      // 认得出游离的，编辑保存走池子）。其余游离实体（超级文档 / 试卷）的页签形态
      // 依赖宿主，先给一句指路。
      if (card.kind === 'note' && loc?.kind === 'note' && !loc.docId) {
        docs.onOpenNote(card.uuid, card.title)
        return
      }
      if (loc && (loc.kind === 'superdoc' || loc.kind === 'exam') && !loc.docId) {
        onToast?.(t('这份{0}还没绑到文档上：拖线连到某张文档卡（或把它拖到文档卡上）之后就能打开', card.kind === 'exam' ? t('试卷') : t('超级文档')))
        return
      }
      if (card.kind === 'note' && loc?.kind === 'note') {
        const note = store.nodes.find((n) => n.id === loc.docId)?.notes.find((n) => n.id === loc.noteId)
        if (note) docs.onOpenNote(loc.docId, note.name)
        return
      }
      if (card.kind === 'superdoc' && loc?.kind === 'superdoc') {
        const sdoc = store.nodes.find((n) => n.id === loc.docId)?.superdocs?.find((d) => d.id === loc.sdocId)
        if (sdoc) docs.onOpenSuperDoc(loc.docId, sdoc.name)
        return
      }
      if (card.kind === 'exam') {
        const exam = store.exams.find((e) => e.id === card.uuid)
        if (exam && !nodeById(store, exam.nodeId)) {
          onToast?.(t('这份试卷还没绑到文档上：拖线连到某张文档卡之后就能开考'))
          return
        }
        if (exam) exams.onStart(exam.nodeId, exam.id)
        return
      }
      if (card.kind === 'video') {
        const bound = store.videoNodes?.find((v) => v.id === card.uuid)?.videoId ?? null
        if (bound && onOpenVideo) onOpenVideo(bound)
        else onToast?.(t('这张视频卡还没有绑视频：点卡上的「选择视频」'))
        return
      }
      onToast?.(t('大纲节点就在这张画布上，没有另一份页签'))
    },
    [docs, exams, onToast, onOpenVideo, store],
  )

  /* ---------- 自动排列（清掉坐标、交给派生铺排；便条保留） ---------- */

  const autoArrange = useCallback(() => {
    const fresh = deriveCanvas(store, goalId, undefined)
    const notes = saved?.positions ?? {}
    const positions: StructureMap['positions'] = {}
    for (const card of fresh.cards) {
      const prevNote = notes[card.uuid]?.note
      positions[card.uuid] = { x: card.x, y: card.y, ...(prevNote ? { note: prevNote } : {}) }
    }
    fitNextRef.current = true
    commit({ version: 2, positions, ...(saved?.edgeStyle ? { edgeStyle: saved.edgeStyle } : {}) })
  }, [store, goalId, saved, commit])

  /* ---------- 便条与改名 ---------- */

  const saveNote = useCallback(
    (uuid: string, card: CardView, text: string) => {
      const value = text.trim()
      const base = saved ?? { version: 2 as const, positions: {} }
      const positions = { ...base.positions }
      if (value) positions[uuid] = { x: positions[uuid]?.x ?? card.x, y: positions[uuid]?.y ?? card.y, note: value }
      else if (positions[uuid]) {
        const { note: _drop, ...rest } = positions[uuid]
        positions[uuid] = rest
      }
      commit({ version: 2, ...(base.edgeStyle ? { edgeStyle: base.edgeStyle } : {}), positions })
      setMenu(null)
    },
    [saved, commit],
  )

  const saveRename = useCallback(
    (card: CardView, to: string) => {
      if (!onRenameNote || card.kind !== 'note') {
        setMenu(null)
        return
      }
      report(onRenameNote(card.uuid, to.trim()))
      setMenu(null)
    },
    [onRenameNote, report],
  )

  /* ---------- 指针 ---------- */

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (tourOpen) return
      const target = e.target as HTMLElement
      const el = containerRef.current
      if (!el) return
      /*
       * 平移画布只有两条路：**中键**，或者**按住空格 + 左键**。
       * 左键留给节点（拖、连、选），空地上按左键不再拖动画布——
       * 那样一不小心就会把整张图推走，还分不清是拖动还是点空了。
       */
      if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
        e.preventDefault() // 中键在 Chromium 里会触发自动滚动
        lastDownCardRef.current = null
        setAnimating(false)
        if (e.button === 1) {
          /*
           * 双击中键 = 适应画布。判定必须放在 pointerdown：这里的 preventDefault
           * 会抑制兼容 mousedown（双击因此收不到 dblclick，也不能靠 onMouseDown 计时）。
           */
          const now = performance.now()
          if (now - lastMiddleDownRef.current < 400) {
            lastMiddleDownRef.current = 0
            fit()
            return
          }
          lastMiddleDownRef.current = now
        }
        el.setPointerCapture(e.pointerId)
        const cam = cameraRef.current
        gestureRef.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, camX: cam.x, camY: cam.y }
        return
      }
      if (e.button !== 0) return
      lastDownCardRef.current = null
      // 菜单、按钮、输入框：容器一旦捕获指针，它们就收不到 click 了
      if (target.closest('button, textarea, input, [data-menu]')) return
      if (menu) {
        setMenu(null)
        return
      }
      setAnimating(false)
      el.setPointerCapture(e.pointerId)

      const paletteEl = target.closest<HTMLElement>('[data-palette-kind]')
      if (paletteEl) {
        const kind = paletteEl.dataset.paletteKind as GNodeKind
        gestureRef.current = { mode: 'palette', kind }
        setPaletteKind(kind)
        setPaletteAt({ x: e.clientX, y: e.clientY })
        return
      }

      const dotEl = target.closest<HTMLElement>('[data-slot-dot]')
      if (dotEl) {
        const from = dotEl.dataset.slotDotParent as string
        gestureRef.current = { mode: 'link', from, fromKind: 'outline', slotKey: dotEl.dataset.slotDot as string, moved: false }
        setLinkFrom(from)
        setLinkSlot(dotEl.dataset.slotDot as string)
        setLinkAt(toWorld(e.clientX, e.clientY))
        setSelectedId(from)
        return
      }

      const addEl = target.closest<HTMLElement>('[data-add-slot]')
      if (addEl) {
        const uuid = addEl.dataset.addSlot as string
        setMenuText('')
        setMenu({ x: e.clientX, y: e.clientY, uuid, mode: 'slot' })
        return
      }

      const slotEl = target.closest<HTMLElement>('[data-slot-key]')
      if (slotEl) {
        onSlotClick(slotEl.dataset.slotParent ?? '', slotEl.dataset.slotKey ?? '')
        return
      }

      const handleEl = target.closest<HTMLElement>('[data-link-handle]')
      if (handleEl) {
        const from = handleEl.dataset.linkHandle as string
        const fromKind = cards.find((c) => c.uuid === from)?.kind
        if (fromKind) {
          gestureRef.current = { mode: 'link', from, fromKind }
          setLinkFrom(from)
          setLinkSlot(null)
          setLinkAt(toWorld(e.clientX, e.clientY))
          setSelectedId(from)
        }
        return
      }

      const cardEl = target.closest<HTMLElement>('[data-node-id]')
      if (cardEl) {
        const id = cardEl.dataset.nodeId as string
        const card = cards.find((c) => c.uuid === id)
        if (!card) return
        const world = toWorld(e.clientX, e.clientY)
        /*
         * Ctrl/⌘ + 点按：把这张卡加进 / 移出多选（拉框之外的第二个入口）。
         * 按下即定，不带拖动手势——这一下只是改选区。
         */
        if (e.ctrlKey || e.metaKey) {
          setMultiIds((prev) => {
            const next = new Set(prev ?? [])
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next.size > 0 ? next : null
          })
          setSelectedId(null)
          setSelectedEdge(null)
          return
        }
        /*
         * 按下的是多选里的一张：整组一起拖（每张的原位置在按下这一刻冻结，
         * 之后整组跟着同一个位移走）。普通单选还是老样子：回到单选。
         */
        const group = multiIds?.has(id)
          ? [...multiIds]
              .map((uid) => cards.find((c) => c.uuid === uid))
              .filter((c): c is CardView => !!c)
              .map((c) => ({ id: c.uuid, x: c.x, y: c.y }))
          : undefined
        if (!group) {
          setSelectedId(id)
          setMultiIds(null)
        }
        setSelectedEdge(null)
        const openTitle = !!target.closest('[data-open-title]')
        lastDownCardRef.current = { id, openTitle }
        gestureRef.current = {
          mode: 'node',
          id,
          grabX: world.x,
          grabY: world.y,
          origX: card.x,
          origY: card.y,
          moved: false,
          openTitle,
          ...(group ? { group } : {}),
        }
        return
      }

      const world = toWorld(e.clientX, e.clientY)
      const dot = edgeDotAt(cards, edges, world.x, world.y, 12 / cameraRef.current.zoom, height, edgeStyle, anchorOf, routeOf)
      if (dot) {
        centerOn(dot.side === 'from' ? dot.edge.to : dot.edge.from)
        return
      }
      const edge = edgeAt(cards, edges, world.x, world.y, 8 / cameraRef.current.zoom, height, edgeStyle, anchorOf, routeOf)
      if (edge) {
        setSelectedEdge(edge)
        setSelectedId(null)
        setMultiIds(null)
        return
      }
      // 空地按下左键：清掉选择，开始拉选框（松手时圈住谁就选谁）
      setSelectedId(null)
      setSelectedEdge(null)
      setMultiIds(null)
      gestureRef.current = { mode: 'marquee', startX: world.x, startY: world.y }
      setMarquee({ x: world.x, y: world.y, width: 0, height: 0 })
    },
    [cards, centerOn, edges, height, menu, multiIds, onSlotClick, toWorld, anchorOf, edgeStyle, routeOf],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const g = gestureRef.current
      if (!g) {
        // 没有手势：算「指针附近有没有连线」，小圆点只在此时露面
        const world = toWorld(e.clientX, e.clientY)
        const dot = edgeDotAt(cards, edges, world.x, world.y, 12 / cameraRef.current.zoom, height, edgeStyle, anchorOf, routeOf)
        const edge =
          dot?.edge ?? edgeAt(cards, edges, world.x, world.y, 8 / cameraRef.current.zoom, height, edgeStyle, anchorOf, routeOf)
        setHoverDot(!!dot)
        setHoverEdge((prev) => (prev?.from === edge?.from && prev?.to === edge?.to ? prev : edge ?? null))
        return
      }
      if (g.mode === 'pan') {
        setCamera((c) => ({ ...c, x: g.camX + (e.clientX - g.startX), y: g.camY + (e.clientY - g.startY) }))
        return
      }
      const world = toWorld(e.clientX, e.clientY)
      if (g.mode === 'node') {
        const dx = world.x - g.grabX
        const dy = world.y - g.grabY
        if (!g.moved && Math.abs(dx) + Math.abs(dy) < 2) return
        g.moved = true
        if (g.group && g.group.length > 1) {
          const moves: Record<string, { x: number; y: number }> = {}
          for (const m of g.group) moves[m.id] = { x: m.x + dx, y: m.y + dy }
          setDraft({ id: g.id, x: g.origX + dx, y: g.origY + dy, moves })
        } else {
          setDraft({ id: g.id, x: g.origX + dx, y: g.origY + dy })
        }
        setOverTrash(isOverTrash(e.clientX, e.clientY))
        return
      }
      if (g.mode === 'link') {
        g.moved = true
        setLinkAt(world)
        setHoverId(hitTest(cards, world.x, world.y, height)?.uuid ?? null)
        return
      }
      if (g.mode === 'marquee') {
        setMarquee({
          x: Math.min(g.startX, world.x),
          y: Math.min(g.startY, world.y),
          width: Math.abs(world.x - g.startX),
          height: Math.abs(world.y - g.startY),
        })
        return
      }
      setPaletteAt({ x: e.clientX, y: e.clientY })
      setHoverId(hitTest(cards, world.x, world.y, height)?.uuid ?? null)
      // 记录「离开过列表」：一直在列表上晃然后松手，是放回去，不是放置
      const listRect = paletteRef.current?.getBoundingClientRect()
      if (
        listRect &&
        !(e.clientX >= listRect.left && e.clientX <= listRect.right && e.clientY >= listRect.top && e.clientY <= listRect.bottom)
      ) {
        g.leftList = true
      }
    },
    [anchorOf, cards, edgeStyle, edges, height, isOverTrash, toWorld, routeOf],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const g = gestureRef.current
      gestureRef.current = null
      const el = containerRef.current
      if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (!g) return

      if (g.mode === 'node') {
        const inTrash = isOverTrash(e.clientX, e.clientY)
        setOverTrash(false)
        if (inTrash && g.moved) {
          // 整组拖进垃圾桶 = 整组删（与 Delete 键删除整个多选同一口径）
          for (const m of g.group ?? [{ id: g.id }]) removeNode(m.id)
          setDraft(null)
          setMultiIds(null)
          return
        }
        if (draft && draft.id === g.id && g.moved) {
          if (g.group && g.group.length > 1 && draft.moves) {
            writePositions(g.group.map((m) => ({ uuid: m.id, x: draft.moves![m.id].x, y: draft.moves![m.id].y })))
          } else {
            writePos(draft.id, draft.x, draft.y)
          }
        } else if (!g.moved && g.openTitle) {
          const card = cards.find((c) => c.uuid === g.id)
          if (card) openNode(card)
        }
        setDraft(null)
        return
      }

      if (g.mode === 'link') {
        const world = toWorld(e.clientX, e.clientY)
        // 从圆点上按下但没拖动 = 点了一下这条目标项
        if (!g.moved && g.slotKey) {
          onSlotClick(g.from, g.slotKey)
          setLinkFrom(null)
          setLinkSlot(null)
          setLinkAt(null)
          setHoverId(null)
          return
        }
        const target = hitTest(cards, world.x, world.y, height)
        if (target && target.uuid !== g.from) {
          /*
           * 连线看的是「谁是谁」而不是拖的方向：大纲 ↔ 文档 / 大纲 = 挂进那一层（唯一的长树的手法）；
           * 文档 ↔ 挂件 = 绑定 / 换绑（实体从池子或旧宿主挪过来，内容不动）。
           * 拒绝原因（双边协商的人话）由 report 弹出，这里不再另说。
           */
          const fromCard = cards.find((c) => c.uuid === g.from)
          const toCard = target
          const kinds = [fromCard?.kind, toCard.kind]
          const isPair = (a: GNodeKind, b: GNodeKind) => kinds.includes(a) && kinds.includes(b)
          if (isPair('outline', 'doc')) {
            const outline = fromCard?.kind === 'outline' ? g.from : target.uuid
            const doc = fromCard?.kind === 'doc' ? g.from : target.uuid
            // 从目标项圆点拖出来的线 = 认领那个口（与点目标项建文档同一口径）；反方向拖没有口可指
            tryConnect(outline, doc, fromCard?.kind === 'outline' ? g.slotKey : undefined)
          } else if (isPair('video', 'doc')) {
            const video = fromCard?.kind === 'video' ? g.from : target.uuid
            const doc = fromCard?.kind === 'doc' ? g.from : target.uuid
            tryConnect(video, doc)
          } else if (isPair('outline', 'outline')) {
            /*
             * 大纲连大纲 = 落点的大纲之下再开一层（上层当分类、下层当指导）。
             * 从目标项圆点拖出来的线：圆点的大纲是上级并认领那个口；
             * 从圆把手拖 = 拖着的这一层挂到落点的大纲之下。
             */
            if (g.slotKey && fromCard?.kind === 'outline') tryConnect(g.from, target.uuid, g.slotKey)
            else tryConnect(target.uuid, g.from)
          } else if (isPair('doc', 'note') || isPair('doc', 'exam') || isPair('doc', 'superdoc')) {
            const doc = fromCard?.kind === 'doc' ? g.from : target.uuid
            const widget = fromCard?.kind === 'doc' ? target.uuid : g.from
            tryConnect(doc, widget)
          }
          // 其余组合不响应（没有可建立的关系）——沉默即可，不值得一条吐司
        }
        setLinkFrom(null)
        setLinkSlot(null)
        setLinkAt(null)
        setHoverId(null)
        return
      }

      if (g.mode === 'marquee') {
        const rect = marquee
        setMarquee(null)
        // 几乎没拉：当成一次普通点击（选择已清），不进入多选
        if (!rect || (rect.width < 4 && rect.height < 4)) return
        const found = cards.filter((c) => {
          const r = { x: c.x, y: c.y, width: CARD_W, height: height(c) }
          return r.x < rect.x + rect.width && rect.x < r.x + r.width && r.y < rect.y + rect.height && rect.y < r.y + r.height
        })
        if (!found.length) return
        if (found.length === 1) {
          setSelectedId(found[0].uuid)
          setMultiIds(null)
        } else {
          setMultiIds(new Set(found.map((c) => c.uuid)))
          setSelectedId(null)
        }
        return
      }

      if (g.mode === 'palette') {
        setPaletteAt(null)
        setPaletteKind(null)
        setHoverId(null)
        if (!g.leftList) {
          /*
           * 没离开过列表就松手 = 把它放回去了，不建。快速拖一下可能连一次
           * pointermove 都没发出来，所以这里按**松手位置**补判一次。
           */
          const listRect = paletteRef.current?.getBoundingClientRect()
          const inList =
            !!listRect &&
            e.clientX >= listRect.left &&
            e.clientX <= listRect.right &&
            e.clientY >= listRect.top &&
            e.clientY <= listRect.bottom
          if (inList) return
        }

        /*
         * 节点落地（统一通道）：拖到卡上 = 创建即绑（挂件挂到那份文档、文档挂进那一层）；
         * 拖到**空白处** = 创建独立实体，落点就是它的坐标——节点不必有连接，随时拖线再绑。
         */
        if (PALETTE.includes(g.kind)) {
          const world2 = toWorld(e.clientX, e.clientY)
          const target = hitTest(cards, world2.x, world2.y, height)
          if (!onCreateNode) return
          // 视频节点不挂树：拖到卡上不给落，只有空白处是它的位置（绑定在卡上选）
          if (g.kind === 'video') {
            if (target) {
              onToast?.(t('视频节点拖到空白处放下：它不挂进大纲树，只把一个视频绑到这个目标'))
              return
            }
            const r = onCreateNode('video', null, world2)
            if ('error' in r) {
              onToast?.(r.error)
              return
            }
            writePos(r.uuid, world2.x, world2.y)
            setSelectedId(r.uuid)
            onToast?.(t('已建一张视频卡：点「选择视频」挑一个现有视频绑上'))
            return
          }
          /*
           * 大纲拖到大纲卡上 = 在那张大纲之下开一层**纯大纲**（游离子大纲实体 + 树边，
           * 没有文档——分类层）。其余组合走通用的创建即挂。
           */
          if (g.kind === 'outline' && target?.kind === 'outline') {
            const r = onCreateNode('outline', target.uuid)
            if ('error' in r) {
              onToast?.(r.error)
              return
            }
            writePos(r.uuid, world2.x, world2.y)
            setSelectedId(r.uuid)
            onToast?.(t('已在这张大纲之下开了新的一层：目标项写在大纲卡上，往下挂文档或再开一层'))
            return
          }
          let under: string | null = null
          if (target) {
            if (g.kind === 'doc') {
              // 文档能挂进大纲之下，也能挂在视频节点之下（与发光的候选同一口径，见 candidateIds）
              under = target.kind === 'outline' || target.kind === 'video' ? target.uuid : null
            } else if (g.kind === 'outline') {
              // 大纲拖到文档上 = 给它补一份大纲（附身，node.outline）
              under = target.kind === 'doc' ? target.uuid : null
            } else {
              // 挂件：拖到文档卡 = 绑到它；拖到大纲卡 = 绑到那张大纲的宿主文档（游离大纲没有宿主，接不住）
              under =
                target.kind === 'doc'
                  ? target.uuid
                  : target.kind === 'outline' && !target.free
                    ? docIdOfOutlineUuid(target.uuid)
                    : null
            }
            if (!under) {
              onToast?.(t('这种组合连不成：文档拖到大纲卡上，大纲拖到文档卡或大纲卡上，挂件拖到文档卡上，再不然拖到空白处'))
              return
            }
          }
          const r = onCreateNode(g.kind, under, under ? undefined : world2)
          if ('error' in r) {
            onToast?.(r.error)
            return
          }
          if (!under) writePos(r.uuid, world2.x, world2.y)
          setSelectedId(r.uuid)
          onToast?.(
            g.kind === 'note'
              ? t('已新建笔记「{0}」，点标题就能打开', r.title)
              : g.kind === 'exam'
                ? t('已放一份空试卷：点卡片上的「生成试卷」让 AI 出题')
                : g.kind === 'superdoc'
                  ? t('已放一份空超级文档「{0}」：点「生成超级文档」让 AI 来写', r.title)
                  : g.kind === 'outline'
                    ? t('已建一张独立的大纲卡：目标项写在卡上，往下挂文档或再开一层大纲')
                    : t('已建文档「{0}」：点标题打开写正文', r.title),
          )
        }
      }
    },
    [cards, draft, height, isOverTrash, marquee, onSlotClick, onCreateNode, onToast, openNode, removeNode, toWorld, tryConnect, writePos, writePositions],
  )

  /* ---------- 双击 ---------- */

  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      /*
       * 画布上的双击归画布自己（适应画布 / 聚焦节点），不再冒泡到文档区的
       * 「双击切纯净阅读」——两套手势长在同一个容器里，输的总是用户。
       *
       * 落点不认 e.target（指针捕获把 dblclick 的目标重定向到了容器，它永远
       * 到不了卡片上），认的是 onPointerDown 记下的 lastDownCardRef。
       */
      e.stopPropagation()
      const hit = e.target as HTMLElement
      // 双击在按钮 / 输入框上是连点，不是手势（这些元素不被捕获，target 是真的）
      if (hit.closest('button, textarea, input, [data-menu]')) return
      const down = lastDownCardRef.current
      if (!down) {
        fit()
        return
      }
      // 双击标题 = 打开（第一下点标题已经把文档开了），不再聚焦
      if (down.openTitle) return
      const card = cards.find((c) => c.uuid === down.id)
      if (card) focusCard(card)
    },
    [fit, cards, focusCard],
  )

  /* ---------- 右键菜单 ---------- */

  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (tourOpen) return
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]')
      if (!target) return
      const uuid = target.dataset.nodeId as string
      const card = cards.find((c) => c.uuid === uuid)
      if (!card) return
      e.preventDefault()
      // 右键回到单选：菜单只作用在一张卡上，多选态就此散掉
      setMultiIds(null)
      setSelectedId(uuid)
      setMenuText(card.note ?? '')
      setMenu({ x: e.clientX, y: e.clientY, uuid, mode: 'actions' })
    },
    [cards],
  )

  /* ---------- 键盘 ---------- */

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (tourOpen) return
      if (e.key === 'Escape') {
        setMenu(null)
        setMultiIds(null)
        return
      }
      /*
       * 输入位里的键盘归输入框：注释 / 改名 / 新目标项的 textarea 就长在画布容器里，
       * 按键会冒上来。不拦的话，写注释时按个退格就会把**当前选中的节点**删掉。
       */
      if (isTextEntryTarget(e.target)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (selectedEdge) {
        e.preventDefault()
        // 每条线都可以摘（用户定的：关系只是连线，剪线不带走设备）——
        // 摘树边（大纲 → 子文档 / 子大纲）= 拆那条树边（对方成游离的一层）；
        // 摘大纲 ↔ 它的内容文档 = 删除那份大纲；摘文档 ↔ 挂件 = 解绑（实体进游离池，内容原样）。
        // 唯一摘不了的是入口的绑定线（那是目标本身）。
        if (onDisconnect) report(onDisconnect(selectedEdge.from, selectedEdge.to))
        setSelectedEdge(null)
        return
      }
      const ids = selectedId ? [selectedId] : multiIds ? [...multiIds] : []
      if (!ids.length) return
      e.preventDefault()
      for (const id of ids) removeNode(id)
      setSelectedId(null)
      setMultiIds(null)
      setMenu(null)
    },
    [cards, undo, onToast, removeNode, multiIds, onDisconnect, report, selectedEdge, selectedId],
  )

  /* ---------- 渲染 ---------- */

  /*
   * 量一遍目标项圆点的真实位置。
   *
   * 连线端点原来按 `slotAnchorY(i)` 算，卡片里只要多一个 padding、边框或行高变化就会偏，
   * 已经偏过两次。这里直接读 DOM —— 圆点在哪，线的起点就在哪。
   */
  useLayoutEffect(() => {
    const root = planeRef.current
    if (!root) return
    const zoom = cameraRef.current.zoom || 1
    const next: Record<string, number> = {}
    for (const el of root.querySelectorAll<HTMLElement>('[data-slot-dot]')) {
      const card = el.closest<HTMLElement>('[data-node-id]')
      if (!card) continue
      /*
       * 必须用 getBoundingClientRect，不能用 offsetTop：offsetTop 不含 transform，
       * 而圆点是靠 translateY(-50%) 居中的。两个 rect 在同一层变换里，相减再除以 zoom。
       */
      const cardRect = card.getBoundingClientRect()
      const rect = el.getBoundingClientRect()
      next[`${el.dataset.slotDotParent ?? ''}|${el.dataset.slotDot ?? ''}`] =
        (rect.top + rect.height / 2 - cardRect.top) / zoom
    }
    setDotY((prev) => {
      const keys = Object.keys(next)
      const same =
        keys.length === Object.keys(prev).length && keys.every((k) => Math.abs((prev[k] ?? -1) - next[k]) < 0.5)
      return same ? prev : next
    })
  }, [displayCards, height, dotY, camera.zoom])


  const dragging = !!draft
  const menuCard = menu ? cards.find((c) => c.uuid === menu.uuid) ?? null : null

  const edgeOrigin = bounds ? { x: bounds.x - 240, y: bounds.y - 240 } : { x: 0, y: 0 }
  const edgeSize = bounds ? { width: bounds.width + 480, height: bounds.height + 480 } : { width: 0, height: 0 }
  const zoomPct = Math.round(camera.zoom * 100)

  /* ---------- 全景缩略图 ---------- */

  /**
   * 缩略图的世界包络：节点总包围盒外扩一圈留白，再按缩放下限的口径以中心整体
   * 放大 1/STRUCT_MIN_ZOOM_FACTOR——节点只占画面的这份比例，四周是真实的画布空地。
   * 之后按**统一等比**缩放装进固定窗口，短的那一轴向外扩世界补齐窗口比例：
   * 占满容器靠的是「拍到更多画面」，绝不是把图拉变形；扩出来的那圈正是镜头
   * 缩到下限后本来就看得到的那片空白。
   */
  const mini = useMemo(() => {
    if (!bounds) return null
    const grow = 1 / STRUCT_MIN_ZOOM_FACTOR
    const pad = 40
    const cx = bounds.x + bounds.width / 2
    const cy = bounds.y + bounds.height / 2
    const w0 = (bounds.width + pad * 2) * grow
    const h0 = (bounds.height + pad * 2) * grow
    const scale = Math.min(MINI_W / w0, MINI_H / h0)
    const w = Math.max(w0, MINI_W / scale)
    const h = Math.max(h0, MINI_H / scale)
    return { bounds: { x: cx - w / 2, y: cy - h / 2, width: w, height: h } }
  }, [bounds])
  const miniRef = useRef<SVGSVGElement | null>(null)
  const minimapDragRef = useRef(false)

  /** 把缩略图上的一点变成镜头中心（屏幕坐标 → 窗口占比 → 世界坐标 → 相机平移） */
  const jumpByMinimap = useCallback(
    (clientX: number, clientY: number) => {
      const el = miniRef.current
      const m = mini
      if (!el || !m) return
      const rect = el.getBoundingClientRect()
      const cam = cameraRef.current
      /*
        视口框不许拖出包络：把「镜头中心」夹在「包络缩掉半个视口」的范围内。
        视口比包络还大（图很小）时夹不出区间，就钉在包络中心。
      */
      const halfW = view.width / cam.zoom / 2
      const halfH = view.height / cam.zoom / 2
      let wx = m.bounds.x + ((clientX - rect.left) / rect.width) * m.bounds.width
      let wy = m.bounds.y + ((clientY - rect.top) / rect.height) * m.bounds.height
      wx =
        halfW * 2 >= m.bounds.width
          ? m.bounds.x + m.bounds.width / 2
          : Math.min(Math.max(wx, m.bounds.x + halfW), m.bounds.x + m.bounds.width - halfW)
      wy =
        halfH * 2 >= m.bounds.height
          ? m.bounds.y + m.bounds.height / 2
          : Math.min(Math.max(wy, m.bounds.y + halfH), m.bounds.y + m.bounds.height - halfH)
      setAnimating(false)
      setCamera({ x: view.width / 2 - wx * cam.zoom, y: view.height / 2 - wy * cam.zoom, zoom: cam.zoom })
    },
    [mini, view],
  )
  const onMinimapPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.stopPropagation() // 别让画布把它当成「空地点击」清选择
    e.currentTarget.setPointerCapture(e.pointerId)
    minimapDragRef.current = true
    jumpByMinimap(e.clientX, e.clientY)
  }
  const onMinimapPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!minimapDragRef.current) return
    e.stopPropagation()
    jumpByMinimap(e.clientX, e.clientY)
  }
  const onMinimapPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    minimapDragRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onPointerDown={onPointerDown}
      // 中键在 Chromium 里会触发「自动滚动」，pointerdown 上的 preventDefault 拦不住
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault()
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      className="relative h-full w-full select-none overflow-hidden bg-paper outline-none dark:bg-card/30"
      style={{
        cursor: hoverDot ? 'pointer' : spaceDown ? 'grab' : undefined,
        /*
         * 网格背景：随相机平移缩放（点阵铺在世界坐标 28px 的整数倍上，缩放时点距
         * 跟着缩放）。颜色用 ink 的低透明混合——亮暗主题都自动成立。
         */
        backgroundImage:
          'radial-gradient(circle, color-mix(in oklab, var(--color-ink, #000) 14%, transparent) 1.1px, transparent 1.3px)',
        backgroundSize: `${GRID_PX * camera.zoom}px ${GRID_PX * camera.zoom}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
      }}
    >
      {/*
        画布平面：纯 2D（只有平移与缩放，没有倾斜、没有 z 轴）。
        拖动时整层抬到垃圾桶之上，这样拖到删除区附近也看得见手里的节点。
      */}
      <div
        ref={planeRef}
        className={`absolute top-0 left-0 origin-top-left ${dragging ? 'z-30' : 'z-0'} ${
          animating ? 'transition-transform duration-300 ease-out' : ''
        }`}
        style={{ transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})` }}
      >

        {/* 连线层：尺寸跟着包围盒走（SVG 根默认会裁掉超出的路径，所以不能用 1×1） */}
        {bounds && (
          <svg
            className="pointer-events-none absolute"
            style={{ left: edgeOrigin.x, top: edgeOrigin.y }}
            width={edgeSize.width}
            height={edgeSize.height}
          >
            {edges.map((edge, idx) => {
              const from = byId.get(edge.from)
              const to = byId.get(edge.to)
              if (!from || !to) return null
              const path = routeOf(edge)
              if (!path) return null
              // 世界坐标 → SVG 坐标（这一层是从包围盒左上角铺开的）
              const points = path.map((p) => ({ x: p.x - edgeOrigin.x, y: p.y - edgeOrigin.y }))
              const isSelected = selectedEdge?.from === edge.from && selectedEdge?.to === edge.to
              // 从大纲卡出发的树边（子级是文档还是大纲都算）统一色；归属边一律中性灰
              const color = from.kind === 'outline' ? SLOT_ACCENT : null
              const dots = edgeDots(points, edgeStyle)
              const slotKey = from.slots?.find((s) => s.childId === to.uuid)?.key ?? null
              // 悬停目标项 → 对应的那条子文档连线发光
              const glow = !!hoverSlot && hoverSlot.parentId === edge.from && slotKey === hoverSlot.key
              const isHoveredEdge =
                (hoverEdge?.from === edge.from && hoverEdge?.to === edge.to) || isSelected || glow
              const showDots = hoverEdge?.from === edge.from && hoverEdge?.to === edge.to
              return (
                <g key={`${edge.from}>${edge.to}-${idx}`}>
                  <path
                    d={edgePathD(points, edgeStyle)}
                    fill="none"
                    stroke={color ?? (isHoveredEdge ? 'var(--color-seal, #b45309)' : 'currentColor')}
                    className={color || isHoveredEdge ? '' : 'text-ink-faint/55'}
                    strokeWidth={isSelected || glow ? 2.6 : isHoveredEdge ? 2 : 1.5}
                    strokeLinecap="round"
                    style={
                      glow
                        ? { filter: `drop-shadow(0 0 5px ${color ?? 'var(--color-seal, #b45309)'})` }
                        : undefined
                    }
                  />
                  {/*
                    两端的小圆点：**只在指针停在线上时出现**，而且很小。
                    平时它只会挡视线——线本身已经说清了连接关系。
                  */}
                  {showDots &&
                    (['from', 'to'] as const).map((side) => {
                      const p = side === 'from' ? dots.from : dots.to
                      return (
                        <circle
                          key={side}
                          cx={p.x}
                          cy={p.y}
                          r={3}
                          fill="currentColor"
                          className="text-card transition-all"
                          stroke={color ?? 'rgba(140,140,140,0.7)'}
                          strokeWidth={1.4}
                        />
                      )
                    })}
                </g>
              )
            })}
            {/* 跟手的那条线 */}
            {linkAt && linkFrom && (() => {
              const from = byId.get(linkFrom)
              if (!from) return null
              // 从目标项圆点上拉出来的线，起点要落在**那颗圆点**上（用实测值，不用算）
              const slotKey = from.slots?.find((s) => s.key === linkSlot)?.key
              const measured = slotKey ? dotY[`${from.uuid}|${slotKey}`] : undefined
              // 虚线用目标项统一色：圆点是什么色，线就是什么色
              const linkColor = slotKey && from.kind === 'outline' ? SLOT_ACCENT : undefined
              const slotIndex =
                measured == null && slotKey && from.kind === 'outline'
                  ? from.slots?.findIndex((s) => s.key === linkSlot) ?? -1
                  : -1
              const anchorFrom = measured ?? (slotIndex >= 0 ? slotAnchorY(slotIndex) : undefined)
              const curve = edgeCurve(
                from,
                { uuid: '', kind: from.kind, title: '', subtitle: '', x: linkAt.x, y: linkAt.y - CARD_H / 2 },
                height,
                anchorFrom == null ? undefined : { from: anchorFrom },
              )
              /*
                跟手的这条是**橡皮筋**：终点跟着指针乱跑，按「绕开卡片」去算会一路抖，
                所以它保持老画法（出线 → 竖直 → 进线），落手之后才走真正的路由。
              */
              const points = (edgeStyle === 'curved' ? curve : edgeElbow(curve[0], curve[3])).map((p) => ({
                x: p.x - edgeOrigin.x,
                y: p.y - edgeOrigin.y,
              }))
              return (
                <path
                  d={edgePathD(points, edgeStyle)}
                  fill="none"
                  // 虚线颜色跟着接入点走：拉的是哪一条，线就是那条的颜色
                  stroke={linkColor ?? 'currentColor'}
                  className={linkColor ? '' : 'text-seal/70'}
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                />
              )
            })()}
          </svg>
        )}

        {displayCards.map((card) => {
          const selected = selectedId === card.uuid
          const multi = multiIds?.has(card.uuid) ?? false
          const isHovered = hoverId === card.uuid
          const h = height(card)
          const slots = card.slots ?? []
          const openable = card.kind !== 'outline'
          const lifted = !!draft && (draft.id === card.uuid || (draft.moves !== undefined && card.uuid in draft.moves))
          /*
           * 树的上游：线可能落在文档卡上，也可能落在大纲卡上（接大纲的嵌套子级）。
           * 没接进树的置灰提示（游离）；入口是根，天生没有上级。
           */
          // 性能优化：直接从 O(1) 索引查找
          const hasUpstream = upstreamEdgeSet.has(card.uuid) || upstreamEdgeSet.has(outlineUuid(card.uuid))
          const unassigned = card.kind === 'doc' && !card.entry && !hasUpstream
          // 入口就是根文档自己（一张图有且只有一个）：挂「入口」徽章
          const authoritativeRoot = card.entry === true
          // 性能优化：直接从预热缓存中获取
          const leafOwnerNodeId = leafOwnerCache.get(card.uuid) ?? null

          // 性能优化：视口包围盒裁剪，视口外的普通卡片仅渲染轻量占位容器，削减数千个复杂子 DOM
          const inView = !viewportBox || (
            card.x <= viewportBox.right &&
            card.x + CARD_W >= viewportBox.left &&
            card.y <= viewportBox.bottom &&
            card.y + h >= viewportBox.top
          )
          const mustRender = inView || selected || multi || isHovered || lifted || flashId === card.uuid || (candidateIds?.has(card.uuid) ?? false) || tourOpen
          return (
            <Fragment key={card.uuid}>
            <div
              data-node-id={card.uuid}
              {...(card.uuid === 'tour-mock-entry-doc'
                ? { 'data-tour-node': 'entry-doc' }
                : card.uuid === 'tour-mock-outline'
                  ? { 'data-tour-node': 'outline' }
                  : card.uuid === 'tour-mock-video'
                    ? { 'data-tour-node': 'video' }
                    : card.uuid === 'tour-mock-exam'
                      ? { 'data-tour-node': 'exam' }
                      : card.uuid === 'tour-mock-note'
                        ? { 'data-tour-node': 'note' }
                        : card.uuid === 'tour-mock-superdoc'
                          ? { 'data-tour-node': 'superdoc' }
                          : {})}
              className={`absolute flex flex-col border ${KIND_TONE[card.kind]} ${
                card.blank || unassigned ? 'border-dashed' : ''
              } ${unassigned ? 'opacity-70' : ''} ${
                selected || multi ? 'ring-2 ring-seal/60' : isHovered ? 'ring-1 ring-seal/35' : ''
              } ${lifted ? 'shadow-lg' : 'shadow-sm'} ${flashId === card.uuid ? 'moji-structure-flash' : ''} ${
                candidateIds?.has(card.uuid) ? 'moji-structure-candidate' : ''
              }`}
              style={{
                left: card.x,
                top: card.y,
                width: CARD_W,
                height: h,
                // 悬停不抢光标（箭头就好），拖起来才换成抓住的手——「可拖」由选中态与阴影说
                cursor: lifted ? 'grabbing' : undefined,
              }}
            >
              {mustRender ? (
                <>
              {/*
                标题行高度**必须**等于 OUTLINE_HEAD：目标项圆点的 y 是按这个常量算的
                （slotAnchorY = OUTLINE_HEAD + 行号 × 行高）。这里一旦改成 minHeight 或加
                padding，圆点就会和它那一行错开——真错过一次。
              */}
              <div className="flex shrink-0 items-center gap-1.5 px-3" style={{ height: OUTLINE_HEAD }}>
                <span className={`shrink-0 px-1.5 py-[1px] text-[10px] font-semibold ${KIND_BADGE[card.kind]}`}>
                  {t(GRAPH_KIND_LABEL[card.kind])}
                </span>
                <span
                  {...(openable ? { 'data-open-title': card.uuid } : {})}
                  title={openable ? t('点标题直接打开') : undefined}
                  className={`min-w-0 flex-1 truncate text-[13px] font-medium text-ink ${
                    openable ? 'hover:text-seal hover:underline' : ''
                  }`}
                >
                  {card.title}
                </span>
                {authoritativeRoot && (
                  <span
                    title={t('入口：这门课从这份文档开始（右键其他无上级的文档可以换）')}
                    className="shrink-0 rounded bg-rose-500/15 px-1 py-[1px] text-[9px] font-semibold text-rose-600 dark:text-rose-300"
                  >
                    {t('入口')}
                  </span>
                )}
              </div>

              {card.kind === 'outline' && slots.length > 0 ? (
                /* 容器不带左右内边距：行自己带，圆点才能贴到卡片右边框上 */
                /* 不能加 overflow-hidden：圆点要伸出卡片右边框半颗，裁了连点击都收不到 */
                <div className="flex flex-col pb-2">
                  {slots.map((slot) => (
                    <div
                      key={slot.key}
                      data-slot-key={slot.key}
                      data-slot-parent={card.uuid}
                      title={slot.childId ? t('跳到这个子文档') : t('生成一份空文档')}
                      onPointerEnter={() => setHoverSlot({ parentId: card.uuid, key: slot.key })}
                      onPointerLeave={() => setHoverSlot(null)}
                      className="relative flex cursor-pointer items-center gap-1.5 pr-3 pl-2 hover:bg-seal/[0.08]"
                      style={{ height: SLOT_ROW }}
                    >
                      <span className="h-2 w-2 shrink-0" />
                      <span
                        className="truncate text-[11.5px]"
                        style={{ color: slot.childId ? SLOT_ACCENT : undefined, opacity: slot.childId ? 1 : 0.55 }}
                      >
                        {slot.title}
                      </span>
                      {/*
                        接口点：**菱形**（旋转 45° 的小方块）——圆形留给普通连线把手，
                        一眼分得清「这是在认领某个接口」。认领了=实心，空着=空心。
                        位置规矩不变：放在这一行里面（垂直居中 flex 保证），圆心压在
                        1px 边框的中线上（right: -0.5px 再平移半颗）。
                      */}
                      <span
                        data-slot-dot={slot.key}
                        data-slot-dot-parent={card.uuid}
                        title={slot.childId ? t('已经挂上：拖出去可以换一份') : t('从接口拖出去挂一份文档或子大纲（会认领这条目标项）')}
                        className="absolute top-1/2 -right-[0.5px] h-2.5 w-2.5 -translate-y-1/2 translate-x-1/2 rotate-45 cursor-crosshair rounded-[2px] border-2"
                        style={{
                          borderColor: SLOT_ACCENT,
                          background: slot.childId ? SLOT_ACCENT : 'var(--color-card, #fff)',
                        }}
                      />
                    </div>
                  ))}
                  {/* 手动加一条目标项：这是大纲内容，走大纲节点的 editContent */}
                  <div
                    data-add-slot={card.uuid}
                    title={t('给这份大纲加一条目标项')}
                    className="flex cursor-pointer items-center gap-1.5 pr-3 pl-2 text-[11px] text-ink-faint hover:bg-seal/[0.08] hover:text-seal"
                    style={{ height: SLOT_ROW }}
                  >
                    ＋ {t('添加目标项')}
                  </div>
                </div>
              ) : card.kind === 'outline' && slots.length === 0 ? (
                /*
                  空大纲卡的「生成大纲」与文档卡右键菜单是同一个动作（前置知识大纲工作流）：
                  附身的读宿主文档铺目标项；游离的（挂在大纲下的那一层）读它认领的目标项
                  与上级上下文，规划这一层怎么拆——不靠手填。
                */
                <div className="flex items-center justify-between gap-2 px-3 pb-2">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-ink-soft">{card.subtitle}</span>
                  <button
                    type="button"
                    title={card.free ? t('读它认领的目标项与上级上下文，规划这一层怎么拆') : t('读宿主文档，把「先要学会什么」铺成目标项')}
                    className="shrink-0 bg-seal/15 px-2 py-0.5 text-[11px] text-seal-deep hover:bg-seal/25"
                    onClick={() => {
                      if (card.uuid) onGenerateOutline?.(card.uuid)
                    }}
                  >
                    {t('生成总览')}
                  </button>
                </div>
              ) : card.kind === 'doc' && card.excerpt ? (
                /*
                  有正文：**正好两行**摘要。
                  外层只负责裁：高度就是两行的行高之和、**不带内边距**（溢出是在 padding box
                  上裁的，留了 pb 就等于在第三行上开了一条 8px 的窗口，让它探出来半截）。
                  内层留着 line-clamp-2 只为一件事：让第二行末尾出现省略号。
                */
                <div
                  className="overflow-hidden px-3"
                  style={{ height: DOC_LINES * DOC_LINE_H, marginBottom: CARD_PAD_B }}
                >
                  <div className="line-clamp-2 text-[11px] text-ink-soft" style={{ lineHeight: `${DOC_LINE_H}px` }}>
                    {card.excerpt}
                  </div>
                </div>
              ) : card.kind === 'doc' && card.blank ? (
                /*
                  空文档：给「生成文档」。实体已就位（点目标项那一刻建的），
                  点击把「父大纲 + 所占目标项」作为意图一并交给 agent 的工作流。
                */
                <div className="flex items-center justify-between gap-2 px-3 pb-2">
                  <span className="text-[11px] text-ink-faint">{t('还没有正文')}</span>
                  <button
                    type="button"
                    className="bg-seal/15 px-2 py-0.5 text-[11px] text-seal-deep hover:bg-seal/25"
                    onClick={() => {
                      // 意图：它挂在哪份大纲的哪条目标项下（按 key 对上号的那条）——树边可能落在它的大纲卡上（嵌套接入）
                      const face = byId.has(outlineUuid(card.uuid)) ? outlineUuid(card.uuid) : card.uuid
                      const upstream = edges.find((e) => e.to === face)
                      const upstreamCard = upstream ? byId.get(upstream.from) : undefined
                      const slotTitle = upstreamCard?.slots?.find((s) => s.childId === face)?.title
                      const hint =
                        upstreamCard && slotTitle
                          ? `【本轮是空文档填充】文档节点已就位（uuid ${card.uuid}）：教学文档直接写进它（api.node.get 后 editContent），不要创建任何新节点、不要拆下一层大纲。它的定位：大纲「${upstreamCard.title}」里「${slotTitle}」这条目标项的落地文档——正文围绕这条目标项展开，范围与同纲其他目标项错开。`
                          : undefined
                      onGenerateDoc?.(card.uuid, hint)
                    }}
                  >
                    {t('生成文档')}
                  </button>
                </div>
              ) : card.kind === 'exam' && (card.attempts?.length ?? 0) > 0 ? (
                /*
                  试卷的考试记录：一行一次作答，顶部配有「开始考试」按钮；
                  必须是真按钮：画布容器在 pointerdown 上捕获指针，非白名单元素的 click 会被吞掉。
                */
                <div className="flex flex-col pb-2">
                  <div className="flex items-center justify-between px-3 pb-1 pt-0.5 border-b border-line/40">
                    <span className="text-[10px] text-ink-faint">{t('作答记录 ({0})', card.attempts!.length)}</span>
                    <button
                      type="button"
                      title={t('开始考试（打开独立考试窗口）')}
                      onClick={() => {
                        const exam = store.exams.find((e) => e.id === card.uuid)
                        if (exam && !nodeById(store, exam.nodeId)) {
                          onToast?.(t('这份试卷还没绑到文档上：拖线连到某张文档卡之后就能开考'))
                          return
                        }
                        if (exam) exams.onStart(exam.nodeId, exam.id)
                      }}
                      className="rounded bg-seal/15 px-2 py-0.5 text-[10.5px] font-semibold text-seal-deep hover:bg-seal/25 transition cursor-pointer"
                    >
                      {t('开始考试')}
                    </button>
                  </div>
                  {card.attempts!.map((row) => (
                    <button
                      key={row.n}
                      type="button"
                      title={t('打开这一次考试的记录（卷子 + 作答 + 判分 + 错题讲解）')}
                      onClick={() => {
                        const exam = store.exams.find((e) => e.id === card.uuid)
                        if (exam) exams.onOpenRecord(exam.nodeId, exam.id, row.attemptId)
                      }}
                      className="flex w-full cursor-pointer items-center gap-1.5 px-3 text-left text-[11px] text-ink-soft hover:bg-seal/[0.08]"
                      style={{ height: SLOT_ROW }}
                    >
                      <span className="shrink-0 text-ink-faint">第 {row.n} 次</span>
                      <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    </button>
                  ))}
                </div>
              ) : card.kind === 'exam' && !card.blank ? (
                /*
                  有内容的试卷（还没有作答记录）：显示考试按钮
                */
                <div className="flex items-center justify-between gap-2 px-3 pb-2">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-ink-soft">{card.subtitle}</span>
                  <button
                    type="button"
                    title={t('开始考试（打开独立考试窗口）')}
                    className="shrink-0 rounded bg-seal/15 px-2.5 py-0.5 text-[11px] font-semibold text-seal-deep hover:bg-seal/25 transition cursor-pointer"
                    onClick={() => {
                      const exam = store.exams.find((e) => e.id === card.uuid)
                      if (exam && !nodeById(store, exam.nodeId)) {
                        onToast?.(t('这份试卷还没绑到文档上：拖线连到某张文档卡之后就能开考'))
                        return
                      }
                      if (exam) exams.onStart(exam.nodeId, exam.id)
                    }}
                  >
                    {t('开始考试')}
                  </button>
                </div>
              ) : card.kind === 'video' ? (
                /*
                  视频卡：副行显示绑定状态；绑定后显示「生成大纲」按钮；「选择视频 / 换绑」打开下拉。
                  必须是真按钮：画布容器在 pointerdown 上捕获指针，非白名单元素的 click 会被吞掉。
                */
                <div className="flex items-center justify-between gap-2 px-3 pb-2">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-ink-soft">{card.subtitle}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {!card.blank && (
                      <button
                        type="button"
                        title={t('为这个视频生成总览文档')}
                        className="shrink-0 rounded bg-seal/15 px-2 py-0.5 text-[11px] font-medium text-seal-deep hover:bg-seal/25 transition cursor-pointer"
                        onClick={() => onGenerateVideoDoc?.(card.uuid)}
                      >
                        {t('生成总览')}
                      </button>
                    )}
                    <button
                      type="button"
                      title={t('从现有视频里挑一个绑到这个目标（打开它会一并打开这门课的页签组）')}
                      className="shrink-0 rounded bg-line/60 px-2 py-0.5 text-[11px] text-ink-soft hover:bg-line/90 transition cursor-pointer"
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect()
                        setMenu({
                          x: Math.min(r.right, window.innerWidth - 264),
                          y: Math.min(r.bottom + 6, window.innerHeight - 200),
                          uuid: card.uuid,
                          mode: 'videoPick',
                        })
                      }}
                    >
                      {card.blank ? t('选择视频') : t('换绑')}
                    </button>
                  </div>
                </div>
              ) : (card.kind === 'exam' || card.kind === 'superdoc') && card.blank && leafOwnerNodeId ? (
                /*
                  还没生成内容的试卷 / 超级文档：给一颗「生成」——出卷会先问类型与难度，
                  超级实验室会先问想做什么实验。**已经生成好的不再显示**（subtitle 就是内容在那里）。
                */
                <div className="flex items-center justify-between gap-2 px-3 pb-2">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-ink-soft">{card.subtitle}</span>
                  <button
                    type="button"
                    className="shrink-0 bg-seal/15 px-2 py-0.5 text-[11px] text-seal-deep hover:bg-seal/25"
                    onClick={() =>
                      card.kind === 'exam'
                        ? docs.onNewExam(leafOwnerNodeId)
                        : docs.onNewSuperDoc(leafOwnerNodeId, card.title)
                    }
                  >
                    {card.kind === 'exam' ? t('生成试卷') : t('生成超级文档')}
                  </button>
                </div>
              ) : (
                <div className="truncate px-3 pb-2 text-[11px] text-ink-soft">{card.subtitle}</div>
              )}

              {/*
                普通连线把手：**圆形**实心印章色、卡色描边、不透明——与目标项的菱形接口点
                区分开（圆=普通连接不带认领，菱=认领某个接口）。圆心压在 1px 边框的
                **中线**上：绝对定位的参照是 padding box，边框中线在参照缘外 0.5px。
                高度与连线锚点同一个值。
                出线把手（右）只长在 doc 上：大纲的出线全走目标项的菱形口（从口上拖出去
                才会认领），挂件与入口没有出线。
              */}
              {(card.kind === 'doc' || card.kind === 'video') && (
                <div
                  data-link-handle={card.uuid}
                  title={t('拖出去连到另一个节点')}
                  className="absolute -right-[7.5px] h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-card bg-seal"
                  style={{ top: EDGE_ANCHOR_Y }}
                />
              )}
              {/* 进线接口（左）：实心、不透明。入口不画；视频卡为顶层资源无上游，不该有进线点 */}
              {card.kind !== 'entry' && !card.entry && card.kind !== 'video' && (
                <div
                  className="pointer-events-none absolute -left-[7.5px] h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-card bg-seal"
                  style={{ top: EDGE_ANCHOR_Y }}
                />
              )}
                </>
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[11px] text-ink-faint/45 select-none font-medium px-2 truncate">
                  {card.title}
                </div>
              )}
            </div>
            {/*
              注释：**贴在卡片外面**、跟着节点走的一条便签。
              不塞进卡片里——它会撑高卡片、把连线的锚点和自动排列都带偏；
              挂在外面之后，它只是一个跟着坐标走的标签，节点怎么长都不影响。
            */}
            {card.note && (
              <div
                className="absolute max-w-[260px] text-[10.5px] leading-snug text-ink-soft"
                style={{ left: card.x, top: card.y + h + 6, width: CARD_W }}
                title={card.note}
              >
                {card.note}
              </div>
            )}
            </Fragment>
          )
        })}

        {/* 拉选框：跟手的世界坐标矩形（松手把相交的卡都选上） */}
        {marquee && (
          <div
            className="pointer-events-none absolute border border-seal bg-seal/10"
            style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
          />
        )}
      </div>

      {/*
        全景缩略图：节点按类型着色的微缩卡片（带描边与圆角）+ 半透明的当前视口框。
        点/拖哪里，镜头就把哪里居中——大图上找路比滚轮翻得快。
      */}
      {/*
        左上角固定组：全景缩略图占最角落，节点列表排在它下面——两块都贴着左上，
        用一个纵列装着，谁也不压谁。
      */}
      <div className="absolute top-4 left-4 z-20 flex flex-col items-start gap-2.5">
      {mini && (
        <div
          data-tour="minimap"
          className="flex items-center justify-center rounded-xl border border-line bg-card/90 p-1.5 shadow-sm backdrop-blur"
          style={{ width: MINI_W + 12, height: MINI_H + 12 }}
        >
          <svg
            ref={miniRef}
            width={MINI_W}
            height={MINI_H}
            viewBox={`${mini.bounds.x} ${mini.bounds.y} ${mini.bounds.width} ${mini.bounds.height}`}
            className="block cursor-pointer touch-none"
            onPointerDown={onMinimapPointerDown}
            onPointerMove={onMinimapPointerMove}
            onPointerUp={onMinimapPointerUp}
            onPointerCancel={onMinimapPointerUp}
          >
            {/*
              缩略「照片」：viewBox 直接吃世界坐标，包络本身就是窗口的比例
              （短轴靠扩世界补齐，见 mini 的说明）——画面占满容器且**绝不变形**。
              卡片画结构而不是色块——徽章条、目标项行、摘要行都在，缩多小都看得出
              「这是一张卡」；连线照抄主画布的路径点。所有描边挂 non-scaling-stroke：
              粗细永远按屏幕像素算。
            */}
            {edges.map((edge, idx) => {
              const from = byId.get(edge.from)
              const to = byId.get(edge.to)
              if (!from || !to) return null
              const path = routeOf(edge)
              if (!path) return null
              const accent = from.kind === 'outline' && to.kind === 'doc'
              return (
                <path
                  key={`${edge.from}>${edge.to}-${idx}`}
                  d={edgePathD(path, edgeStyle)}
                  fill="none"
                  stroke={accent ? SLOT_ACCENT : 'currentColor'}
                  className={accent ? '' : 'text-ink-faint/60'}
                  strokeWidth={0.8}
                  opacity={0.7}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
            {displayCards.map((c) => {
              const fill = MINI_FILL[c.kind]
              // 空文档 / 没挂进树里的游离文档：虚线描边，与主画布的虚线卡同一套语言
              const hollow = !!c.blank || (c.kind === 'doc' && !c.entry && !edges.some((e) => e.to === c.uuid))
              return (
                <g key={c.uuid}>
                  <rect
                    x={c.x}
                    y={c.y}
                    width={CARD_W}
                    height={height(c)}
                    rx={3}
                    fill={fill}
                    fillOpacity={0.22}
                    stroke={fill}
                    strokeOpacity={0.9}
                    strokeWidth={0.9}
                    strokeDasharray={hollow ? '3 2' : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                  {/* 头部条：卡片顶部那行类型徽章位，深一档才有「卡」的层次 */}
                  <rect x={c.x} y={c.y} width={CARD_W} height={OUTLINE_HEAD} rx={3} fill={fill} fillOpacity={0.45} />
                  {c.kind === 'outline' &&
                    (c.slots ?? []).map((s, i) => {
                      const y = c.y + (dotY[`${c.uuid}|${s.key}`] ?? slotAnchorY(i))
                      return (
                        <line
                          key={s.key}
                          x1={c.x + 8}
                          y1={y}
                          x2={c.x + 52}
                          y2={y}
                          stroke={fill}
                          strokeOpacity={0.85}
                          strokeWidth={1}
                          vectorEffect="non-scaling-stroke"
                        />
                      )
                    })}
                  {c.kind === 'doc' && c.excerpt && (
                    <g stroke="currentColor" className="text-ink-faint/60" strokeWidth={1}>
                      <line
                        x1={c.x + 12}
                        y1={c.y + OUTLINE_HEAD + DOC_LINE_H * 0.6}
                        x2={c.x + CARD_W - 12}
                        y2={c.y + OUTLINE_HEAD + DOC_LINE_H * 0.6}
                        vectorEffect="non-scaling-stroke"
                      />
                      <line
                        x1={c.x + 12}
                        y1={c.y + OUTLINE_HEAD + DOC_LINE_H * 1.6}
                        x2={c.x + CARD_W * 0.72}
                        y2={c.y + OUTLINE_HEAD + DOC_LINE_H * 1.6}
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  )}
                </g>
              )
            })}
            <rect
              x={-camera.x / camera.zoom}
              y={-camera.y / camera.zoom}
              width={view.width / camera.zoom}
              height={view.height / camera.zoom}
              fill="none"
              stroke="var(--color-seal, #a8432f)"
              strokeOpacity={0.85}
              strokeWidth={1.4}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      )}

      {/* 左侧节点列表：拖到画布上生成节点（必须拖出列表再松手，见 Gesture.palette.leftList） */}
      <div
        ref={paletteRef}
        data-tour="palette"
        className="flex w-[148px] flex-col gap-1 rounded-xl border border-line bg-card/85 p-2 backdrop-blur"
      >
        <div className="px-1 pb-1 text-[10px] font-semibold text-ink-faint">{t('拖到画布或文档卡上')}</div>
        {PALETTE.map((kind) => (
          <div
            key={kind}
            data-palette-kind={kind}
            className="flex cursor-grab items-center gap-1.5 rounded-lg border border-line/70 bg-paper/70 px-2 py-1.5 text-[12px] text-ink hover:border-seal/40 hover:bg-seal/[0.06]"
          >
            {/* 色签用卡片徽章的同一套配色：列表里什么颜色，画布上就是什么颜色 */}
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${KIND_BADGE[kind]}`}>
              <KindIcon kind={kind} />
            </span>
            <span className="min-w-0 flex-1 truncate">{t(GRAPH_KIND_LABEL[kind])}</span>
          </div>
        ))}
      </div>
      </div>

      {/*
        垃圾桶：**只在拖着节点时出现**（平时它只是一块挡视线的色块），
        方形圆角、够大、好瞄准；层级在平面之下，所以被提起的节点永远压在它上面。
        删除走统一通道（实体删除），工作区的撤回能退回它。
      */}
      {dragging && (
        <div
          ref={trashRef}
          className={`absolute bottom-6 left-1/2 z-20 flex h-28 w-44 -translate-x-1/2 flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed text-[12px] transition-all ${
            overTrash
              ? 'scale-105 border-rose-500 bg-rose-500/15 text-rose-600 dark:text-rose-300'
              : 'border-line bg-card/80 text-ink-faint'
          }`}
        >
          <Trash2 size={26} />
          {overTrash ? t('松手删除') : t('拖到这里删除')}
        </div>
      )}

      {/*
        右下角工具组：缩放读数 + 一排图标按钮（文字说明住悬停 tip，见 ControlButton），
        最右是新手教学的入口。图标即功能，tooltip 只在犹豫的那半秒里接住。
      */}
      <div
        data-tour="controls"
        className="absolute right-4 bottom-4 z-20 flex items-center gap-0.5 rounded-lg border border-line bg-card/85 px-1.5 py-1 text-[11px] text-ink-soft backdrop-blur"
      >
        <ControlButton
          label={t('缩小')}
          onClick={() => {
            const cam = cameraRef.current
            const next = clampZoom(cam.zoom - 0.15, boundsOf(cards, height), view)
            if (next !== cam.zoom) setCamera({ ...cam, zoom: next })
          }}
        >
          <svg {...ICON_STROKE}>
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
            <path d="M8 11h6" />
          </svg>
        </ControlButton>
        <span className="w-10 text-center tabular-nums">{zoomPct}%</span>
        <ControlButton
          label={t('放大')}
          onClick={() => {
            const cam = cameraRef.current
            const next = clampZoom(cam.zoom + 0.15, boundsOf(cards, height), view)
            if (next !== cam.zoom) setCamera({ ...cam, zoom: next })
          }}
        >
          <svg {...ICON_STROKE}>
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
            <path d="M11 8v6" />
            <path d="M8 11h6" />
          </svg>
        </ControlButton>
        <span className="mx-0.5 h-3.5 w-px bg-line" />
        <ControlButton
          label={edgeStyle === 'straight' ? t('切换为曲线') : t('切换为直线')}
          onClick={() => {
            const next = EDGE_STYLES[(EDGE_STYLES.indexOf(edgeStyle) + 1) % EDGE_STYLES.length]
            // 只是显示口径，不进撤回栈（Ctrl+Z 不该把线拉回曲线）
            onChange({ ...(saved ?? { version: 2, positions: {} }), edgeStyle: next })
          }}
        >
          <svg {...ICON_STROKE}>
            {edgeStyle === 'straight' ? <path d="M4 18C10 18 14 6 20 6" /> : <path d="M5 19 19 5" />}
          </svg>
        </ControlButton>
        <ControlButton label={t('撤回上一步')} disabled={!canUndo} onClick={undo}>
          <svg {...ICON_STROKE}>
            <path d="M9 14 4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11" />
          </svg>
        </ControlButton>
        <ControlButton label={t('适应画布')} onClick={fit}>
          <svg {...ICON_STROKE}>
            <path d="M8 3H5a2 2 0 0 0-2 2v3" />
            <path d="M16 3h3a2 2 0 0 1 2 2v3" />
            <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
            <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        </ControlButton>
        <ControlButton label={t('自动排列')} onClick={autoArrange}>
          <svg {...ICON_STROKE}>
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </ControlButton>
        <span className="mx-0.5 h-3.5 w-px bg-line" />
        <ControlButton label={t('新手教学')} onClick={handleOpenTour}>
          <svg {...ICON_STROKE}>
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <path d="M12 17h.01" />
          </svg>
        </ControlButton>
      </div>

      {/* 从列表拖出来时跟着指针的那张卡 */}
      {paletteKind && paletteAt && (
        <div
          className="pointer-events-none fixed z-50 flex items-center gap-1.5 rounded-xl border border-seal/40 bg-card/95 px-3 py-2 text-[12px] text-ink shadow-lg"
          style={{ left: paletteAt.x - CARD_W / 2, top: paletteAt.y - CARD_H / 2, width: CARD_W, height: CARD_H }}
        >
          <span className={`rounded px-1.5 py-[1px] text-[10px] font-semibold ${KIND_BADGE[paletteKind]}`}>
            {t(GRAPH_KIND_LABEL[paletteKind])}
          </span>
          <span className="text-ink-soft">{t('松手放下')}</span>
        </div>
      )}

      {/* 新手教学：全屏遮罩挖洞、逐步指路，随时可退（见 StructureTour） */}
      {tourOpen && <StructureTour onClose={handleCloseTour} />}

      {/* 节点右键菜单 / 视频卡的下拉 */}
      {menu && menuCard && (
        <div
          data-menu
          className={`fixed z-50 ${menu.mode === 'videoPick' ? 'w-[248px]' : 'w-[168px]'} rounded-lg border border-line bg-card/95 p-1 text-[12px] text-ink shadow-lg backdrop-blur`}
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.mode === 'actions' ? (
            <>
              <button
                type="button"
                className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
                onClick={() => {
                  // 删除的收尾（关菜单）都由 removeNode 统一处理
                  removeNode(menuCard.uuid)
                }}
              >
                {t('删除')}
              </button>
              {menuCard.kind === 'doc' &&
                !menuCard.entry &&
                store.goals.find((g) => g.id === goalId)?.rootNodeId !== menuCard.uuid &&
                !edges.some((e) => e.to === menuCard.uuid || e.to === outlineUuid(menuCard.uuid)) &&
                onSetEntry && (
                <button
                  type="button"
                  title={t('这门课从这份文档开始（原入口文档退位，仍在图上）')}
                  className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
                  onClick={() => {
                    report(onSetEntry(menuCard.uuid))
                    setMenu(null)
                  }}
                >
                  {t('设为入口')}
                </button>
              )}
              <button
                type="button"
                className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
                onClick={() => {
                  setMenuText(menuCard.note ?? '')
                  setMenu({ ...menu, mode: 'note' })
                }}
              >
                {t('注释')}
              </button>
              {menuCard.kind === 'note' && (
                <button
                  type="button"
                  className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
                  onClick={() => {
                    setMenuText(menuCard.title)
                    setMenu({ ...menu, mode: 'rename' })
                  }}
                >
                  {t('改名')}
                </button>
              )}
              {menuCard.kind === 'outline' && (
                <button
                  type="button"
                  className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
                  onClick={() => {
                    onGenerateOutline?.(menuCard.uuid)
                    setMenu(null)
                  }}
                >
                  {t('生成总览')}
                </button>
              )}
              {menuCard.kind === 'doc' && (
                <button
                  type="button"
                  className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
                  onClick={() => {
                    // 生成大纲：读这份文档，规划子层级目标项
                    onGenerateOutline?.(menuCard.uuid)
                    setMenu(null)
                  }}
                >
                  {t('生成大纲')}
                </button>
              )}
              {menuCard.kind === 'video' && (
                <button
                  type="button"
                  className="flex w-full items-center rounded px-2 py-1.5 text-left hover:bg-line/60"
                  onClick={() => setMenu({ ...menu, mode: 'videoPick' })}
                >
                  {menuCard.blank ? t('选择视频') : t('换一个视频')}
                </button>
              )}
            </>
          ) : menu.mode === 'videoPick' ? (
            /*
              视频卡的下拉：现有视频一张一行（当前绑着的打勾），底部给解绑。
              绑定走统一通道（onBindVideo → 节点的 editContent({ videoId })），
              与 agent 动手绑是同一条路；拒绝的原因由 report 弹吐司。
            */
            <div className="flex max-h-[300px] flex-col overflow-y-auto">
              <div className="px-2 pb-1 pt-1 text-[10px] text-ink-faint">{t('挑一个视频绑到这个目标')}</div>
              {(store.videos ?? []).map((v) => {
                const current = store.videoNodes?.find((n) => n.id === menu.uuid)?.videoId === v.id
                return (
                  <button
                    key={v.id}
                    type="button"
                    title={v.input}
                    className={
                      'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-line/60 ' +
                      (current ? 'bg-seal/[0.08]' : '')
                    }
                    onClick={() => {
                      if (onBindVideo) report(onBindVideo(menu.uuid, v.id))
                      setMenu(null)
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate text-[12px]">{v.title}</span>
                    {v.pluginName && <span className="shrink-0 text-[10px] text-ink-faint">{v.pluginName}</span>}
                    {current && <Check size={12} className="shrink-0 text-seal" />}
                  </button>
                )
              })}
              {!(store.videos ?? []).length && (
                <div className="px-2 pb-1.5 text-[11px] leading-relaxed text-ink-faint">
                  {t('还没有可绑的视频：先在侧栏「视频」里新建一个')}
                </div>
              )}
              {!!store.videoNodes?.find((n) => n.id === menu.uuid)?.videoId && (
                <button
                  type="button"
                  className="mt-1 flex w-full items-center rounded border-t border-line/60 px-2 py-1.5 text-left text-ink-soft hover:bg-line/60"
                  onClick={() => {
                    if (onBindVideo) report(onBindVideo(menu.uuid, null))
                    setMenu(null)
                  }}
                >
                  {t('解绑视频')}
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 p-1">
              <div className="text-[10px] text-ink-faint">
                {menu.mode === 'note'
                  ? t('写一句注释，贴在卡片底部')
                  : menu.mode === 'rename'
                    ? t('改笔记名（文件名一起改）')
                    : t('新的目标项标题')}
              </div>
              <textarea
                autoFocus
                value={menuText}
                onChange={(e) => setMenuText(e.target.value)}
                rows={menu.mode === 'note' ? 3 : 1}
                className="w-full resize-none rounded border border-line bg-paper/80 px-1.5 py-1 text-[12px] text-ink outline-none focus:border-seal/50"
              />
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  className="rounded px-2 py-1 text-[11px] text-ink-soft hover:bg-line/60"
                  onClick={() => setMenu(null)}
                >
                  {t('取消')}
                </button>
                <button
                  type="button"
                  className="rounded bg-seal/15 px-2 py-1 text-[11px] text-seal-deep hover:bg-seal/25"
                  onClick={() => {
                    if (menu.mode === 'note') saveNote(menuCard.uuid, menuCard, menuText)
                    else if (menu.mode === 'rename') saveRename(menuCard, menuText)
                    else {
                      const title = menuText.trim()
                      if (title) onAddOutlineEntry?.(menuCard.uuid, title)
                      setMenu(null)
                    }
                  }}
                >
                  {t('保存')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 空画布提示 */}
      {!cards.length && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-xl border border-dashed border-line bg-card/70 px-5 py-4 text-center text-[12px] text-ink-soft">
            {t('这张画布还是空的')}
            <div className="mt-1 text-[11px] text-ink-faint">{t('从左侧拖一个挂件到文档卡上；子文档点大纲的目标项挂上')}</div>
          </div>
        </div>
      )}
    </div>
  )
})
