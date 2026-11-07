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

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FileNodeKind, LearnStore } from '../../../learn/types'
import { CanvasControls, CanvasPalette, CanvasPaletteGhost, CanvasTrash } from './CanvasChrome'
import { CanvasCards } from './CanvasCards'
import { CanvasEdges } from './CanvasEdges'
import { CanvasMenu } from './CanvasMenu'
import { CanvasMinimap } from './CanvasMinimap'
import type { ExamActions, NodeDocActions } from '../explorer/types'
import { locateUuid, type GNodeKind } from '../../../learn/nodeKinds'
import { useCanvasActions } from './canvasActions'
import { useCanvasPointer } from './canvasPointer'
import { useCanvasCamera } from './canvasCamera'
import { PROJ_PATH_ROW, PROJ_TREE_MAX_ROWS, PROJ_TREE_ROW, useProjectTrees } from './canvasProjectTrees'
import {
  CARD_H,
  boundsOf,
  cardWidthOf,
  type EdgeStyle,
  type StructureMap,
} from '../../../learn/structure'
import { t } from '../../../i18n'
import { GRID_PX, type ChannelResult, type MenuState } from './canvasTypes'
export const TOUR_SEEN_KEY = 'moji:structure:tour-seen'
import { StructureTour } from './StructureTour'
import { getTourMockCanvas, getTourCamera } from './tourMockData'
import {
  CARD_PAD_B,
  deriveCanvas,
  edgeCurve,
  edgeRoute,
  slotAnchorY,
  type CanvasEdge,
  type CardView,
  type Point,
} from './structureView'

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
    extra?: Record<string, unknown>,
  ) => { uuid: string; title?: string } | { error: string }
  onBindFile?: (nodeUuid: string, patch: { fileKind?: FileNodeKind; url?: string; title?: string; titleCustomized?: boolean }) => ChannelResult
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
  /** 删除某份大纲中的某项子目标项 */
  onDeleteOutlineEntry?: (outlineUuid: string, slotKey: string) => void
  onRenameOutlineEntry?: (outlineUuid: string, slotKey: string, nextTitle: string) => void
  /** 视频卡上选一个视频绑到本目标（统一通道：与 agent 的 editContent({ videoId }) 同一条路）；null = 解绑 */
  onBindVideo?: (nodeUuid: string, videoId: string | null) => ChannelResult
  /** 打开绑定的视频（打开它 = 一并打开本目标的页签组，见 LearnWorkspace 的 openTab） */
  onOpenVideo?: (videoId: string) => void
  /** 打开视频节点页签 */
  onOpenVideoNode?: (nodeUuid: string) => void
  /** 更新视频节点内容（输入标识、标题等） */
  onUpdateVideoNode?: (nodeUuid: string, patch: { input?: string; title?: string; titleCustomized?: boolean }) => ChannelResult
  /** 给一个空文档卡点「生成文档」：交给 AI 写正文 */
  onGenerateDoc?: (nodeUuid: string, hint?: string) => void
  /** 文档卡右键菜单的「生成前置知识大纲」 */
  onGenerateOutline?: (docUuid: string) => void
  /** 视频卡点「生成总览」：交给 AI 根据选集生成总览文档并挂在视频节点子级 */
  onGenerateVideoDoc?: (videoNodeUuid: string) => void
  /** 项目卡设置 / 修改路径（统一通道：走节点对象的 editContent，与 agent 同一条路）；拼法由路径推断 */
  onSetProjectPath?: (nodeUuid: string, path: string) => ChannelResult | Promise<ChannelResult>
  /** 点项目卡目录树里的一个文件：本地文件页签打开（磁盘绝对路径） */
  onOpenProjectFile?: (absPath: string) => void
  /** 打开文件节点（本地文件页签或网页页签） */
  onOpenFileNode?: (nodeUuid: string) => void
  onToast?: (msg: string) => void
  /** 外部指定的聚焦目标（chip 路由）：把镜头挪到 uuid 对得上的那张卡 */
  focusTarget?: { nodeId: string; nonce: number } | null
  onFocusHandled?: () => void
  /** 切换视图模式回调 */
  onToggleViewMode?: () => void
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
  onDeleteOutlineEntry,
  onRenameOutlineEntry,
  onBindVideo: _onBindVideo,
  onOpenVideo,
  onOpenVideoNode,
  onUpdateVideoNode,
  onGenerateDoc,
  onGenerateOutline,
  onGenerateVideoDoc,
  onSetProjectPath,
  onOpenProjectFile,
  onOpenFileNode,
  onBindFile,
  onToast,
  focusTarget,
  onFocusHandled,
  onToggleViewMode,
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

  const { projExpanded, projTrees, projTreeRows, clearProjCache, toggleProjRoot, toggleProjDir } = useProjectTrees({ store })


  /**
   * 高度函数：派生层管全部静态卡，项目卡的展开高度在这里叠加——
   * 展开状态是组件运行时状态（projExpanded），派生层不知道它。
   */
  const height = useCallback(
    (c: { uuid: string; kind: GNodeKind }) => {
      const projPath = (c as CardView).project?.path ?? cards.find((it) => it.uuid === c.uuid)?.project?.path
      if (c.kind === 'project' && projPath) {
        const rows = projTreeRows(c.uuid)
        const treeH = rows.length ? Math.min(rows.length, PROJ_TREE_MAX_ROWS) * PROJ_TREE_ROW + CARD_PAD_B : 0
        return CARD_H + PROJ_PATH_ROW + treeH
      }
      return canvas.heightOf(c)
    },
    [cards, canvas, projTreeRows],
  )

  const containerRef = useRef<HTMLDivElement | null>(null)
  const trashRef = useRef<HTMLDivElement | null>(null)
  /** 左侧节点列表：拖出去必须离开过它，松手才允许落地（见 Gesture.palette.leftList） */
  const paletteRef = useRef<HTMLDivElement | null>(null)




  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 选中的连线（点线选中，Delete 断开）。卡片与连线同时只选一个 */
  const [selectedEdge, setSelectedEdge] = useState<CanvasEdge | null>(null)
  /**
   * 选框多选：拉框圈中的那批卡。与 selectedId 互斥——点任何一张卡就回到单选。
   * 多选目前只服务一件事：Delete 一把删（逐个走统一通道）。
   */
  const [multiIds, setMultiIds] = useState<Set<string> | null>(null)

  /** 指针停在某个目标项上：对应的那条子文档连线发光 */
  const [hoverSlot, setHoverSlot] = useState<{ parentId: string; key: string } | null>(null)
  /** 拖动中的节点位置（只在本地，松手才写回坐标表）；整组拖时 moves 带上每一张的新位置 */
  const [draft, setDraft] = useState<{
    id: string
    x: number
    y: number
    moves?: Record<string, { x: number; y: number }>
  } | null>(null)

  /** 目标项圆点的**实测**高度（离卡片顶部），key = `卡片 uuid|目标项 key` */
  const [dotY, setDotY] = useState<Record<string, number>>({})
  const planeRef = useRef<HTMLDivElement | null>(null)
  /** 跳转后闪一下的那张卡（900ms 后清掉） */
  const [flashId, setFlashId] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [menuText, setMenuText] = useState('')
  const [menuTitleText, setMenuTitleText] = useState('')
  const [menuFileKind, setMenuFileKind] = useState<FileNodeKind>('local')

  /** 正在内联编辑的大纲目标项（卡片 uuid、条目 slotKey、输入文本） */
  const [editingSlot, setEditingSlot] = useState<{ uuid: string; slotKey: string; text: string } | null>(null)
  /** 正在内联新建目标项的大纲卡 uuid 与输入文本 */
  const [addingSlotUuid, setAddingSlotUuid] = useState<string | null>(null)
  const [addingSlotText, setAddingSlotText] = useState('')
  const cancelledEditRef = useRef(false)
  const cancelledAddRef = useRef(false)

  const commitEditingSlot = useCallback(
    (targetSlot: { uuid: string; slotKey: string; originalTitle: string }, newText: string) => {
      setEditingSlot(null)
      const trimmed = newText.trim()
      if (trimmed && trimmed !== targetSlot.originalTitle) {
        onRenameOutlineEntry?.(targetSlot.uuid, targetSlot.slotKey, trimmed)
      }
    },
    [onRenameOutlineEntry],
  )

  const commitAddingSlot = useCallback(
    (outlineUuid: string, text: string) => {
      setAddingSlotUuid(null)
      setAddingSlotText('')
      const trimmed = text.trim()
      if (trimmed) {
        onAddOutlineEntry?.(outlineUuid, trimmed)
      }
    },
    [onAddOutlineEntry],
  )


  /** 下一次 cards 变了之后要不要自动对镜头（自动排列之后用） */
  const fitNextRef = useRef(false)

  const bounds = useMemo(() => boundsOf(cards, height), [cards, height])
  const {
    view,
    camera,
    cameraRef,
    boundsRef,
    viewRef,
    animating,
    setAnimating,
    setCameraSync,
    scheduleCameraUpdate,
    flushPendingCamera,
    animTimer,
    fit,
    centerOn,
    focusCard,
    toWorld,
    isOverTrash,
  } = useCanvasCamera({
    containerRef,
    planeRef,
    trashRef,
    goalId,
    cards,
    height,
    bounds,
    focusTarget,
    onFocusHandled,
    setFlashId,
    setSelectedId,
    setMultiIds,
    fitNextRef,
  })



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

  // 性能优化：计算当前视口在世界坐标系下的包围盒（保留 500px 缓冲垫防边缘闪烁与缩放卡顿）
  const viewportBox = useMemo(() => {
    if (!view.width || !view.height) return null
    const z = Math.max(camera.zoom, 0.05)
    const pad = 500
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
            c.x + cardWidthOf(c.kind) >= viewportBox.left &&
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



  const {
    canUndo,
    undo,
    writePos,
    writePositions,
    report,
    removeNode,
    tryConnect,
    onSlotClick,
    openNode,
    autoArrange,
    saveNote,
    saveRename,
    onCanvasDragOver,
    onCanvasDrop,
  } = useCanvasActions({
    store,
    goalId,
    saved,
    onChange,
    onToast,
    onDeleteNode,
    onConnect,
    onCreateNode,
    onCreateChildDoc,
    onRenameNote,
    onBindFile,
    onUpdateVideoNode,
    onOpenVideo,
    onOpenVideoNode,
    onOpenFileNode,
    docs,
    exams,
    cards,
    centerOn,
    toggleProjRoot,
    fitNextRef,
    setDraft,
    setSelectedId,
    setSelectedEdge,
    setMultiIds,
    setMenu,
    toWorld,
  })


  const {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDoubleClick,
    onContextMenu,
    onKeyDown,
    spaceDown,
    hoverId,
    setHoverId,
    hoverDot,
    hoverEdge,
    linkFrom,
    linkAt,
    linkSlot,
    overTrash,
    marquee,
    paletteAt,
    paletteKind,
    candidateIds,
  } = useCanvasPointer({
    tourOpen,
    containerRef,
    paletteRef,
    multiIds,
    setMultiIds,
    selectedId,
    setSelectedId,
    selectedEdge,
    setSelectedEdge,
    draft,
    setDraft,
    menu,
    setMenu,
    setMenuText,
    cards,
    edges,
    height,
    edgeStyle,
    anchorOf,
    routeOf,
    cameraRef,
    scheduleCameraUpdate,
    flushPendingCamera,
    setAnimating,
    fit,
    centerOn,
    focusCard,
    toWorld,
    isOverTrash,
    undo,
    report,
    removeNode,
    onSlotClick,
    tryConnect,
    openNode,
    writePos,
    writePositions,
    onDeleteOutlineEntry,
    onCreateNode,
    onToast,
    onDisconnect,
  })


  const autoTourCheckedRef = useRef(false)

  const handleOpenTour = useCallback(() => {
    try {
      localStorage.setItem(TOUR_SEEN_KEY, '1')
    } catch {
      // ignore
    }
    savedCameraRef.current = camera
    const tourCam = getTourCamera(view.width, view.height)
    setCameraSync(tourCam)
    setSelectedId(null)
    setMultiIds(null)
    setHoverId(null)
    setTourOpen(true)
  }, [camera, view.width, view.height, setCameraSync, setHoverId])

  const handleCloseTour = useCallback(() => {
    try {
      localStorage.setItem(TOUR_SEEN_KEY, '1')
    } catch {
      // ignore
    }
    setTourOpen(false)
    if (savedCameraRef.current) {
      setCameraSync(savedCameraRef.current)
      savedCameraRef.current = null
    }
  }, [setCameraSync])

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

  /* ---------- 渲染 ---------- */

  /*
   * 量一遍目标项圆点的真实位置（仅在节点清单或高度变化时测量一次，绝不在缩放/平移时重复跑，彻底消除强制同步重排）。
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
  }, [displayCards, height])


  const dragging = !!draft
  const menuCard = menu ? cards.find((c) => c.uuid === menu.uuid) ?? null : null

  const edgeOrigin = bounds ? { x: bounds.x - 240, y: bounds.y - 240 } : { x: 0, y: 0 }
  const edgeSize = bounds ? { width: bounds.width + 480, height: bounds.height + 480 } : { width: 0, height: 0 }




  return (
    <div
      ref={containerRef}
      tabIndex={0}
      data-structure-canvas="true"
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
      onDragOver={onCanvasDragOver}
      onDrop={onCanvasDrop}
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
        style={{
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
        }}
      >

        <CanvasEdges
          bounds={bounds}
          edges={edges}
          byId={byId}
          height={height}
          routeOf={routeOf}
          edgeStyle={edgeStyle}
          viewportBox={viewportBox}
          selectedEdge={selectedEdge}
          hoverEdge={hoverEdge}
          hoverSlot={hoverSlot}
          linkAt={linkAt}
          linkFrom={linkFrom}
          linkSlot={linkSlot}
          dotY={dotY}
          edgeOrigin={edgeOrigin}
          edgeSize={edgeSize}
        />
        <CanvasCards
          displayCards={displayCards}
          selectedId={selectedId}
          multiIds={multiIds}
          hoverId={hoverId}
          height={height}
          draft={draft}
          flashId={flashId}
          candidateIds={candidateIds}
          tourOpen={tourOpen}
          viewportBox={viewportBox}
          upstreamEdgeSet={upstreamEdgeSet}
          leafOwnerCache={leafOwnerCache}
          byId={byId}
          edges={edges}
          store={store}
          goalId={goalId}
          docs={docs}
          exams={exams}
          editingSlot={editingSlot}
          setEditingSlot={setEditingSlot}
          cancelledEditRef={cancelledEditRef}
          commitEditingSlot={commitEditingSlot}
          addingSlotUuid={addingSlotUuid}
          setAddingSlotUuid={setAddingSlotUuid}
          addingSlotText={addingSlotText}
          setAddingSlotText={setAddingSlotText}
          cancelledAddRef={cancelledAddRef}
          commitAddingSlot={commitAddingSlot}
          setHoverSlot={setHoverSlot}
          setMenu={setMenu}
          setMenuText={setMenuText}
          onRenameOutlineEntry={onRenameOutlineEntry}
          onDeleteOutlineEntry={onDeleteOutlineEntry}
          onGenerateOutline={onGenerateOutline}
          onGenerateDoc={onGenerateDoc}
          projExpanded={projExpanded}
          projTrees={projTrees}
          projTreeRows={projTreeRows}
          toggleProjRoot={toggleProjRoot}
          toggleProjDir={toggleProjDir}
          onOpenProjectFile={onOpenProjectFile}
          onUpdateVideoNode={onUpdateVideoNode}
          onGenerateVideoDoc={onGenerateVideoDoc}
          onBindFile={onBindFile}
          onToast={onToast}
        />

        {/* 拉选框：跟手的世界坐标矩形（松手把相交的卡都选上） */}
        {marquee && (
          <div
            className="pointer-events-none absolute border border-seal bg-seal/10"
            style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
          />
        )}
      </div>

      <CanvasMinimap
        bounds={bounds}
        displayCards={displayCards}
        edges={edges}
        byId={byId}
        routeOf={routeOf}
        height={height}
        dotY={dotY}
        edgeStyle={edgeStyle}
        camera={camera}
        cameraRef={cameraRef}
        view={view}
        setCameraSync={setCameraSync}
        setAnimating={setAnimating}
        animTimer={animTimer}
        planeRef={planeRef}
        boundsRef={boundsRef}
        viewRef={viewRef}
        scheduleCameraUpdate={scheduleCameraUpdate}
      />
      <CanvasPalette paletteRef={paletteRef} />

      {dragging && <CanvasTrash trashRef={trashRef} overTrash={overTrash} />}

      <CanvasControls
        camera={camera}
        cameraRef={cameraRef}
        setCameraSync={setCameraSync}
        cards={cards}
        height={height}
        view={view}
        edgeStyle={edgeStyle}
        saved={saved}
        onChange={onChange}
        canUndo={canUndo}
        undo={undo}
        fit={fit}
        autoArrange={autoArrange}
        onToggleViewMode={onToggleViewMode}
        onOpenTour={handleOpenTour}
      />

      {paletteKind && paletteAt && <CanvasPaletteGhost paletteKind={paletteKind} paletteAt={paletteAt} />}
      {/* 新手教学：全屏遮罩挖洞、逐步指路，随时可退（见 StructureTour） */}
      {tourOpen && <StructureTour onClose={handleCloseTour} />}

      {/* 节点右键菜单 / 视频卡的下拉（WheelStop：浮层虽是 fixed 定位，DOM 还长在画布
          容器里——长列表滚动时不拦住滚轮，相机就跟着乱跑） */}
      {menu && menuCard && (
        <CanvasMenu
          menu={menu}
          menuCard={menuCard}
          store={store}
          goalId={goalId}
          edges={edges}
          menuText={menuText}
          setMenuText={setMenuText}
          menuTitleText={menuTitleText}
          setMenuTitleText={setMenuTitleText}
          menuFileKind={menuFileKind}
          setMenuFileKind={setMenuFileKind}
          setMenu={setMenu}
          removeNode={removeNode}
          onSetEntry={onSetEntry}
          report={report}
          onGenerateOutline={onGenerateOutline}
          onOpenVideoNode={onOpenVideoNode}
          onOpenVideo={onOpenVideo}
          onGenerateVideoDoc={onGenerateVideoDoc}
          onOpenFileNode={onOpenFileNode}
          onBindFile={onBindFile}
          onSetProjectPath={onSetProjectPath}
          clearProjCache={clearProjCache}
          saveNote={saveNote}
          saveRename={saveRename}
          onToast={onToast}
        />
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
