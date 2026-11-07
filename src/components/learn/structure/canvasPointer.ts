/**
 * 结构画布的指针与手势 hook：画布上全部指针/键盘交互的状态机。
 * 手势（Gesture）：中键或空格+左键平移、节点拖动（含多选整组拖与垃圾桶删除）、
 * 连线（大纲目标项菱形口认领 portKey / 圆把手普通连线）、palette 落地（按类型认宿主，
 * 离开过列表才建节点）、拉框多选。另有双击（适应画布 / 聚焦阅读位）、右键菜单、
 * 键盘（Escape / Ctrl+Z / Delete）、空格抓手、候选落点高亮（candidateIds）。
 * port 认领逻辑（portKey 落树边只下游侧）是敏感区，搬运一行未动。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { HeightOf } from '../../../learn/structure'
import { cardWidthOf, type EdgeStyle } from '../../../learn/structure'
import { docIdOfOutlineUuid, type GNodeKind } from '../../../learn/nodeKinds'
import { t } from '../../../i18n'
import { PALETTE, type ChannelResult, type Gesture, type MenuState } from './canvasTypes'
import {
  edgeAt,
  edgeDotAt,
  hitTest,
  isTextEntryTarget,
  type CanvasEdge,
  type CardView,
  type Point,
} from './structureView'

/** 指针/手势 hook 需要的宿主状态与邻接动作 */
export interface CanvasPointerDeps {
  /** 新手教学开着没有（教学期间指针交互全部让路） */
  tourOpen: boolean
  containerRef: RefObject<HTMLDivElement | null>
  /** 左侧节点列表：拖出去必须离开过它，松手才允许落地（见 Gesture.palette.leftList） */
  paletteRef: RefObject<HTMLDivElement | null>
  multiIds: Set<string> | null
  setMultiIds: Dispatch<SetStateAction<Set<string> | null>>
  selectedId: string | null
  setSelectedId: Dispatch<SetStateAction<string | null>>
  /** 选中的连线（点线选中，Delete 断开）。卡片与连线同时只选一个 */
  selectedEdge: CanvasEdge | null
  setSelectedEdge: Dispatch<SetStateAction<CanvasEdge | null>>
  /** 拖动中的节点位置（只在本地，松手才写回坐标表）；整组拖时 moves 带上每一张的新位置 */
  draft: { id: string; x: number; y: number; moves?: Record<string, { x: number; y: number }> } | null
  setDraft: Dispatch<SetStateAction<{ id: string; x: number; y: number; moves?: Record<string, { x: number; y: number }> } | null>>
  menu: MenuState | null
  setMenu: Dispatch<SetStateAction<MenuState | null>>
  setMenuText: Dispatch<SetStateAction<string>>
  cards: CardView[]
  edges: CanvasEdge[]
  height: HeightOf
  edgeStyle: EdgeStyle
  /** 连线「大纲那一端」对准目标项的锚点（实测 dotY 优先） */
  anchorOf: (edge: CanvasEdge) => { from: number } | undefined
  routeOf: (edge: CanvasEdge) => Point[] | undefined
  /* ---------- useCanvasCamera ---------- */
  cameraRef: RefObject<{ x: number; y: number; zoom: number }>
  scheduleCameraUpdate: (next: { x: number; y: number; zoom: number }) => void
  flushPendingCamera: () => void
  setAnimating: Dispatch<SetStateAction<boolean>>
  fit: () => void
  centerOn: (id: string) => void
  focusCard: (card: CardView) => void
  toWorld: (clientX: number, clientY: number) => { x: number; y: number }
  isOverTrash: (clientX: number, clientY: number) => boolean
  /* ---------- useCanvasActions ---------- */
  undo: () => void
  report: (r: ChannelResult) => boolean
  removeNode: (uuid: string) => void
  onSlotClick: (parentId: string, key: string) => void
  tryConnect: (fromUuid: string, toUuid: string, portKey?: string) => boolean
  openNode: (card: CardView) => void
  writePos: (uuid: string, x: number, y: number, note?: string) => void
  writePositions: (entries: Array<{ uuid: string; x: number; y: number }>) => void
  /** 删除某份大纲中的某项子目标项 */
  onDeleteOutlineEntry?: (outlineUuid: string, slotKey: string) => void
  /** 断开一条连线（= 解绑 / 拆边；两端实体都不动） */
  onDisconnect?: (fromUuid: string, toUuid: string) => ChannelResult
  /** 节点落地（统一通道）：palette 拖出落地时建实体 */
  onCreateNode?: (
    kind: GNodeKind,
    under: string | null,
    at?: { x: number; y: number },
    extra?: Record<string, unknown>,
  ) => { uuid: string; title?: string } | { error: string }
  onToast?: (msg: string) => void
}

export function useCanvasPointer({
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
  onDisconnect,
  onCreateNode,
  onToast,
}: CanvasPointerDeps) {

  /** 上一次中键按下时刻：双击中键 = 适应画布（Chromium 不给中键派发 dblclick，只能自己计时） */
  const lastMiddleDownRef = useRef(0)
  const draftRafRef = useRef<number | null>(null)
  const pendingDraftRef = useRef<{ id: string; x: number; y: number; moves?: Record<string, { x: number; y: number }> } | null>(null)
  const trashRectRef = useRef<DOMRect | null>(null)
  /** 拉框进行中的那个矩形（世界坐标，已归一成 x/y/width/height） */
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  /** 指针停在哪个节点上（高亮用） */
  const [hoverId, setHoverId] = useState<string | null>(null)
  /** 指针停在哪条连线附近（小圆点只在此时出现） */
  const [hoverEdge, setHoverEdge] = useState<CanvasEdge | null>(null)
  /** 指针正压在某个小圆点上（换成手型光标） */
  const [hoverDot, setHoverDot] = useState(false)
  /** 连线中的起点与指针位置（世界坐标）：画那条跟手的线 */
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  const [linkAt, setLinkAt] = useState<{ x: number; y: number } | null>(null)
  /** 这次连线是从哪条目标项拉出来的（跟手的线要从那一行出发） */
  const [linkSlot, setLinkSlot] = useState<string | null>(null)
  /** 从列表拖出来的那一下：指针的屏幕坐标 */
  const [paletteAt, setPaletteAt] = useState<{ x: number; y: number } | null>(null)
  const [paletteKind, setPaletteKind] = useState<GNodeKind | null>(null)
  /** 正拖着一个节点在垃圾桶上方 */
  const [overTrash, setOverTrash] = useState(false)
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
          ? ['outline', 'video', 'file']
          : paletteKind === 'outline'
            ? ['doc', 'outline', 'file']
            : paletteKind === 'video'
              ? ['doc'] // 视频节点可落在文档之下或空白处
              : paletteKind === 'file'
                ? ['doc', 'note', 'superdoc', 'exam']
                : ['doc']
      return new Set(cards.filter((c) => wants.includes(c.kind)).map((c) => c.uuid))
    }
    const g = gestureRef.current
    if (g?.mode === 'link') {
      // fromKind 收进局部量再比较：ref 只读一次（同一访问模式的警告少一条是一条）
      const fk = g.fromKind
      const wants: GNodeKind[] | null =
        fk === 'outline'
          ? ['doc', 'outline']
          : fk === 'video'
            ? ['doc']
            : fk === 'doc'
              ? ['outline', 'video', 'project', 'note', 'exam', 'superdoc', 'file']
              : fk === 'project'
                ? ['doc'] // 项目只能挂到文档之下：从项目卡拉出去，文档卡是唯一落点
                : fk === 'exam' || fk === 'superdoc'
                  ? ['note', 'file']
                  : fk === 'note'
                    ? ['file']
                    : fk === 'file'
                      ? ['outline', 'doc', 'note', 'superdoc', 'exam']
                      : null
      // 从大纲拉到大纲：自己那张不算落点（连自己没有意义）
      return wants
        ? new Set(cards.filter((c) => wants.includes(c.kind) && c.uuid !== g.from).map((c) => c.uuid))
        : null
    }
    return null
  }, [paletteKind, cards, linkFrom])
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
  /* ---------- 指针 ---------- */

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (tourOpen) return
      flushPendingCamera()
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
      if (target.closest('button, textarea, input, [data-menu], [data-add-slot], [data-rename-slot]')) return
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

      const deleteSlotEl = target.closest<HTMLElement>('[data-delete-slot]')
      if (deleteSlotEl) {
        const parentId = deleteSlotEl.dataset.deleteSlotParent as string
        const slotKey = deleteSlotEl.dataset.deleteSlot as string
        onDeleteOutlineEntry?.(parentId, slotKey)
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
    [cards, centerOn, edges, height, menu, multiIds, onSlotClick, toWorld, anchorOf, edgeStyle, routeOf, cameraRef, containerRef, setMultiIds, flushPendingCamera, onDeleteOutlineEntry, tourOpen, fit, setSelectedId, setMenu, setSelectedEdge, setAnimating],
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
        scheduleCameraUpdate({ ...cameraRef.current, x: g.camX + (e.clientX - g.startX), y: g.camY + (e.clientY - g.startY) })
        return
      }
      const world = toWorld(e.clientX, e.clientY)
      if (g.mode === 'node') {
        const dx = world.x - g.grabX
        const dy = world.y - g.grabY
        if (!g.moved && Math.abs(dx) + Math.abs(dy) < 2) return
        g.moved = true
        const nextDraft = g.group && g.group.length > 1
          ? (() => {
              const moves: Record<string, { x: number; y: number }> = {}
              for (const m of g.group) moves[m.id] = { x: m.x + dx, y: m.y + dy }
              return { id: g.id, x: g.origX + dx, y: g.origY + dy, moves }
            })()
          : { id: g.id, x: g.origX + dx, y: g.origY + dy }
        pendingDraftRef.current = nextDraft
        if (draftRafRef.current == null) {
          draftRafRef.current = requestAnimationFrame(() => {
            draftRafRef.current = null
            if (pendingDraftRef.current) {
              setDraft(pendingDraftRef.current)
            }
          })
        }
        const tr = trashRectRef.current
        const isOver = tr ? e.clientX >= tr.left && e.clientX <= tr.right && e.clientY >= tr.top && e.clientY <= tr.bottom : false
        setOverTrash((prev) => (prev !== isOver ? isOver : prev))
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
    [anchorOf, cards, edgeStyle, edges, height, isOverTrash, toWorld, routeOf, scheduleCameraUpdate, cameraRef, paletteRef, setDraft],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      flushPendingCamera()
      const g = gestureRef.current
      gestureRef.current = null
      if (g && g.mode === 'pan') {
        const dist = Math.abs(e.clientX - g.startX) + Math.abs(e.clientY - g.startY)
        if (dist > 3) {
          // 移动过则说明是拖映画布手势，重置中键连击判定计时，防止连续拖拽被误判为双击自动校正适应画布
          lastMiddleDownRef.current = 0
        }
      }
      const el = containerRef.current
      if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      if (!g) return

      if (g.mode === 'node') {
        trashRectRef.current = null
        if (draftRafRef.current != null) {
          cancelAnimationFrame(draftRafRef.current)
          draftRafRef.current = null
        }
        pendingDraftRef.current = null
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
            tryConnect(g.from, target.uuid)
          } else if (isPair('outline', 'outline')) {
            /*
             * 大纲连大纲 = 落点的大纲之下再开一层（上层当分类、下层当指导）。
             * 从目标项圆点拖出来的线：圆点的大纲是上级并认领那个口；
             * 从圆把手拖 = 拖着的这一层挂到落点的大纲之下。
             */
            if (g.slotKey && fromCard?.kind === 'outline') tryConnect(g.from, target.uuid, g.slotKey)
            else tryConnect(target.uuid, g.from)
          } else if (isPair('doc', 'note') || isPair('doc', 'exam') || isPair('doc', 'superdoc') || isPair('doc', 'project')) {
            const doc = fromCard?.kind === 'doc' ? g.from : target.uuid
            const widget = fromCard?.kind === 'doc' ? target.uuid : g.from
            tryConnect(doc, widget)
          } else if (isPair('exam', 'note')) {
            const exam = fromCard?.kind === 'exam' ? g.from : target.uuid
            const note = fromCard?.kind === 'exam' ? target.uuid : g.from
            tryConnect(exam, note)
          } else if (isPair('superdoc', 'note')) {
            const sdoc = fromCard?.kind === 'superdoc' ? g.from : target.uuid
            const note = fromCard?.kind === 'superdoc' ? target.uuid : g.from
            tryConnect(sdoc, note)
          } else if (fromCard?.kind === 'file') {
            if (['outline', 'doc', 'note', 'superdoc', 'exam'].includes(target.kind)) {
              tryConnect(g.from, target.uuid)
            }
          } else if (target.kind === 'file') {
            if (['doc', 'note', 'superdoc', 'exam'].includes(fromCard?.kind ?? '')) {
              tryConnect(g.from, target.uuid)
            } else if (fromCard?.kind === 'outline') {
              tryConnect(target.uuid, g.from)
            }
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
          const r = { x: c.x, y: c.y, width: cardWidthOf(c.kind), height: height(c) }
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
          // 视频节点：可落在文档之下作为下游，也可拖到空白处独立放置
          if (g.kind === 'video') {
            if (target && target.kind !== 'doc') {
              onToast?.(t('视频节点只能挂在文档之下或放在空白处'))
              return
            }
            const r = onCreateNode('video', target ? target.uuid : null, world2)
            if ('error' in r) {
              onToast?.(r.error)
              return
            }
            writePos(r.uuid, world2.x, world2.y)
            setSelectedId(r.uuid)
            onToast?.(t('已创建视频节点：在第二行输入视频唯一标识，点击标题打开视频 Tab'))
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
            } else if (g.kind === 'file') {
              under = ['doc', 'note', 'superdoc', 'exam'].includes(target.kind) ? target.uuid : null
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
              ? t('已新建笔记「{0}」，点标题就能打开', r.title || '')
              : g.kind === 'exam'
                ? t('已放一份空试卷：点卡片上的「生成试卷」让 AI 出题')
                : g.kind === 'superdoc'
                  ? t('已放一份空超级文档「{0}」：点「生成超级文档」让 AI 来写', r.title || '')
                  : g.kind === 'outline'
                    ? t('已建一张独立的大纲卡：目标项写在卡上，往下挂文档或再开一层大纲')
                    : g.kind === 'project'
                      ? t('已建一枚项目节点：右键卡片 →「设置路径」声明一条真实路径，之后 agent 可以读写它下面的所有文件')
                      : g.kind === 'file'
                        ? t('已建文件节点「{0}」', r.title || '')
                        : t('已建文档「{0}」：点标题打开写正文', r.title || ''),
          )
        }
      }
    },
    [cards, draft, height, isOverTrash, marquee, onSlotClick, onCreateNode, onToast, openNode, removeNode, toWorld, tryConnect, writePos, writePositions, setMultiIds, containerRef, flushPendingCamera, setDraft, setSelectedId, paletteRef],
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
    [cards, setMultiIds, setSelectedId, setMenu, setMenuText, tourOpen],
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
    [cards, undo, onToast, removeNode, multiIds, onDisconnect, report, selectedEdge, selectedId, setMultiIds, setSelectedId, setMenu, setSelectedEdge, tourOpen],
  )
  return {
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
  }
}
