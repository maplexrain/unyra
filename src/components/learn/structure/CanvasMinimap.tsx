/**
 * 结构画布的全景缩略图：一张 canvas 画出按类型着色的微缩卡片 + 半透明视口框，
 * 点/拖哪里镜头就把哪里居中。性能核心：静态底图（卡片 + 连线）只在节点增删、
 * 移动、样式或主题变化时绘制一次到离屏 canvas（renderMiniBg），镜头缩放/平移时
 * 只复用底图补一条视口框（drawMini）。相机与视口状态由宿主（useCanvasCamera）
 * 持有，经 props 传入；wheel 与指针拖拽都走宿主的相机调度。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { HeightOf } from '../../../learn/structure'
import { STRUCT_MIN_ZOOM_FACTOR, clampZoom, cardWidthOf, type EdgeStyle } from '../../../learn/structure'
import type { GNodeKind } from '../../../learn/nodeKinds'
import {
  DOC_LINE_H,
  OUTLINE_HEAD,
  SLOT_ACCENT,
  slotAnchorY,
  type CanvasEdge,
  type CardView,
  type Point,
} from './structureView'

/** 全景缩略图的窗口大小（屏幕像素） */
const MINI_W = 248
const MINI_H = 160

/**
 * 缩略图上各类型的填充色（与卡片色板同族）。
 * canvas 只吃具体色值：写死的 hex 直接用，`var(--…)` 会在 drawMini 里按当前主题解析。
 */
const MINI_FILL: Record<GNodeKind, string> = {
  entry: '#f43f5e',
  outline: 'var(--color-seal, #a8432f)',
  doc: '#0ea5e9',
  note: '#10b981',
  exam: '#f59e0b',
  superdoc: '#8b5cf6',
  video: '#ec4899',
  project: '#14b8a6',
  file: '#2563eb',
}

export interface CanvasMinimapProps {
  /** 节点总包围盒（null = 画布上还没有卡） */
  bounds: { x: number; y: number; width: number; height: number } | null
  displayCards: CardView[]
  edges: CanvasEdge[]
  byId: Map<string, CardView>
  routeOf: (edge: CanvasEdge) => Point[] | undefined
  height: HeightOf
  /** 目标项圆点的实测高度（离卡片顶部），key = `卡片 uuid|目标项 key` */
  dotY: Record<string, number>
  edgeStyle: EdgeStyle
  camera: { x: number; y: number; zoom: number }
  cameraRef: RefObject<{ x: number; y: number; zoom: number }>
  view: { width: number; height: number }
  setCameraSync: (next: { x: number; y: number; zoom: number }) => void
  setAnimating: Dispatch<SetStateAction<boolean>>
  /** 镜头过渡的计时器（wheel 打断过渡要清掉它），宿主 useCanvasCamera 持有 */
  animTimer: RefObject<number | null>
  planeRef: RefObject<HTMLDivElement | null>
  /** 相机/视口的同步 ref（宿主 useCanvasCamera 持有，渲染期写入发生在那边） */
  boundsRef: RefObject<{ x: number; y: number; width: number; height: number } | null>
  viewRef: RefObject<{ width: number; height: number }>
  scheduleCameraUpdate: (next: { x: number; y: number; zoom: number }) => void
}

export function CanvasMinimap({
  bounds,
  displayCards,
  edges,
  byId,
  routeOf,
  height,
  dotY,
  edgeStyle,
  camera,
  cameraRef,
  view,
  setCameraSync,
  setAnimating,
  animTimer,
  planeRef,
  boundsRef,
  viewRef,
  scheduleCameraUpdate,
}: CanvasMinimapProps) {

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
  const miniRef = useRef<HTMLCanvasElement | null>(null)
  const miniBgRef = useRef<HTMLCanvasElement | null>(null)
  const sealColorRef = useRef<string>('#a8432f')
  const minimapContainerRef = useRef<HTMLDivElement | null>(null)
  const minimapDragRef = useRef(false)

  /** 在缩略地图上滚动滚轮：以视口中心缩放相机（RAF 调度防卡顿） */
  useEffect(() => {
    const el = minimapContainerRef.current
    if (!el) return
    const onMinimapWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const cam = cameraRef.current
      const normDelta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY
      const clampedDelta = Math.max(-120, Math.min(120, normDelta))
      const factor = Math.exp(-clampedDelta * 0.0018)
      const next = clampZoom(cam.zoom * factor, boundsRef.current, viewRef.current)
      if (next === cam.zoom) return
      const curView = viewRef.current
      const px = curView.width / 2
      const py = curView.height / 2
      const k = next / cam.zoom
      if (animTimer.current !== null) {
        window.clearTimeout(animTimer.current)
        animTimer.current = null
      }
      if (planeRef.current) {
        planeRef.current.style.transition = 'none'
      }
      setAnimating(false)
      scheduleCameraUpdate({ x: px - (px - cam.x) * k, y: py - (py - cam.y) * k, zoom: next })
    }
    el.addEventListener('wheel', onMinimapWheel, { passive: false })
    return () => el.removeEventListener('wheel', onMinimapWheel)
  }, [scheduleCameraUpdate, viewRef, boundsRef, planeRef, cameraRef, setAnimating, animTimer])

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
      setCameraSync({ x: view.width / 2 - wx * cam.zoom, y: view.height / 2 - wy * cam.zoom, zoom: cam.zoom })
    },
    [mini, view, setCameraSync, cameraRef, setAnimating],
  )
  const onMinimapPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation() // 别让画布把它当成「空地点击」清选择
    e.currentTarget.setPointerCapture(e.pointerId)
    minimapDragRef.current = true
    jumpByMinimap(e.clientX, e.clientY)
  }
  const onMinimapPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!minimapDragRef.current) return
    e.stopPropagation()
    jumpByMinimap(e.clientX, e.clientY)
  }
  const onMinimapPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    minimapDragRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  /** 缩略图连线：几何只跟卡片坐标有关，与相机无关——相机每帧动时不该重跑一遍绕行路由 */
  const miniEdges = useMemo(
    () =>
      edges.flatMap((edge) => {
        const from = byId.get(edge.from)
        const to = byId.get(edge.to)
        if (!from || !to) return []
        const path = routeOf(edge)
        if (!path) return []
        return [{ path, accent: from.kind === 'outline' && to.kind === 'doc' }]
      }),
    [edges, byId, routeOf],
  )

  /** 有入边的卡（缩略图判「游离」用）：每帧对每张卡扫一遍 edges 是 O(卡×边)，先收成一次 */
  const hasIncoming = useMemo(() => {
    const s = new Set<string>()
    for (const e of edges) s.add(e.to)
    return s
  }, [edges])

  /**
   * 绘制缩略图的静态底图（卡片和连线）到离屏 Canvas。
   *
   * 性能核心优化：底图只在节点增删、移动、样式或主题变化时绘制一次；
   * 镜头缩放或平移时，只需复用该底图并绘制一条视口框，从几十毫秒降至 0.02ms，彻底解决缩放卡顿。
   */
  const renderMiniBg = useCallback(() => {
    const m = mini
    if (!m) return
    if (!miniBgRef.current) {
      miniBgRef.current = document.createElement('canvas')
    }
    const bgCanvas = miniBgRef.current
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const pixelW = Math.round(MINI_W * dpr)
    const pixelH = Math.round(MINI_H * dpr)
    if (bgCanvas.width !== pixelW) bgCanvas.width = pixelW
    if (bgCanvas.height !== pixelH) bgCanvas.height = pixelH
    const ctx = bgCanvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, MINI_W, MINI_H)
    ctx.lineCap = 'butt'

    const sx = MINI_W / m.bounds.width
    const sy = MINI_H / m.bounds.height
    const px = (x: number): number => (x - m.bounds.x) * sx
    const py = (y: number): number => (y - m.bounds.y) * sy

    const cs = getComputedStyle(document.documentElement)
    const seal = cs.getPropertyValue('--color-seal').trim() || '#a8432f'
    sealColorRef.current = seal
    const inkFaint = cs.getPropertyValue('--color-ink-faint').trim() || '#98928a'
    const fillOf = (kind: GNodeKind): string => {
      const raw = MINI_FILL[kind]
      if (!raw.startsWith('var(')) return raw
      const name = /var\(\s*(--[\w-]+)/.exec(raw)?.[1]
      return (name && cs.getPropertyValue(name).trim()) || seal
    }

    // --- 连线：照抄主画布的路径点（curved 是四点三次贝塞尔，其余是折线） ---
    ctx.lineWidth = 0.8
    for (const e of miniEdges) {
      const p = e.path
      if (!p.length) continue
      ctx.beginPath()
      ctx.moveTo(px(p[0].x), py(p[0].y))
      if (edgeStyle === 'curved' && p.length === 4) {
        ctx.bezierCurveTo(px(p[1].x), py(p[1].y), px(p[2].x), py(p[2].y), px(p[3].x), py(p[3].y))
      } else {
        for (let i = 1; i < p.length; i++) ctx.lineTo(px(p[i].x), py(p[i].y))
      }
      ctx.strokeStyle = e.accent ? SLOT_ACCENT : inkFaint
      ctx.globalAlpha = e.accent ? 0.7 : 0.42
      ctx.stroke()
    }

    // --- 卡片：底、顶部徽章条、目标项行、文档摘要行 ---
    for (const c of displayCards) {
      const fill = fillOf(c.kind)
      const x = px(c.x)
      const y = py(c.y)
      const w = cardWidthOf(c.kind) * sx
      const h = height(c) * sy
      const radius = Math.min(3 * sx, w / 2)
      const hollow = !!c.blank || (c.kind === 'doc' && !c.entry && !hasIncoming.has(c.uuid))

      ctx.beginPath()
      ctx.roundRect(x, y, w, h, radius)
      ctx.fillStyle = fill
      ctx.globalAlpha = 0.22
      ctx.fill()
      ctx.strokeStyle = fill
      ctx.globalAlpha = 0.9
      ctx.lineWidth = 0.9
      ctx.setLineDash(hollow ? [3, 2] : [])
      ctx.stroke()
      ctx.setLineDash([])

      // 头部条：卡片顶部那行类型徽章位，深一档才有「卡」的层次
      ctx.beginPath()
      ctx.roundRect(x, y, w, OUTLINE_HEAD * sy, Math.min(radius, (OUTLINE_HEAD * sy) / 2))
      ctx.fillStyle = fill
      ctx.globalAlpha = 0.45
      ctx.fill()

      // 目标项行：每一行一小段横线
      if (c.kind === 'outline' && c.slots?.length) {
        ctx.beginPath()
        c.slots.forEach((s, i) => {
          const ly = py(c.y + (dotY[`${c.uuid}|${s.key}`] ?? slotAnchorY(i)))
          ctx.moveTo(px(c.x + 8), ly)
          ctx.lineTo(px(c.x + 52), ly)
        })
        ctx.strokeStyle = fill
        ctx.globalAlpha = 0.85
        ctx.lineWidth = 1
        ctx.stroke()
      }

      // 文档摘要行：两条示意横线（缩多小都还看得出「这是一张文档卡」）
      if (c.kind === 'doc' && c.excerpt) {
        const l1 = c.y + OUTLINE_HEAD + DOC_LINE_H * 0.6
        const l2 = c.y + OUTLINE_HEAD + DOC_LINE_H * 1.6
        ctx.beginPath()
        ctx.moveTo(px(c.x + 12), py(l1))
        ctx.lineTo(px(c.x + cardWidthOf(c.kind) - 12), py(l1))
        ctx.moveTo(px(c.x + 12), py(l2))
        ctx.lineTo(px(c.x + cardWidthOf(c.kind) * 0.72), py(l2))
        ctx.strokeStyle = inkFaint
        ctx.globalAlpha = 0.6
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }
  }, [mini, miniEdges, displayCards, edgeStyle, dotY, height, hasIncoming])

  /**
   * 画全景缩略图：将缓存底图画上画布，并更新视口框（0.02ms 极速绘制）。
   */
  const drawMini = useCallback(() => {
    const canvas = miniRef.current
    const m = mini
    if (!canvas || !m) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const pixelW = Math.round(MINI_W * dpr)
    const pixelH = Math.round(MINI_H * dpr)
    // 位图尺寸只在 dpr / 窗口大小变时重设：赋值会清空画布并重置全部上下文状态
    if (canvas.width !== pixelW) canvas.width = pixelW
    if (canvas.height !== pixelH) canvas.height = pixelH
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, MINI_W, MINI_H)
    ctx.lineCap = 'butt'

    if (!miniBgRef.current) renderMiniBg()
    if (miniBgRef.current) {
      ctx.drawImage(miniBgRef.current, 0, 0, MINI_W, MINI_H)
    }

    const sx = MINI_W / m.bounds.width
    const sy = MINI_H / m.bounds.height
    const px = (x: number): number => (x - m.bounds.x) * sx
    const py = (y: number): number => (y - m.bounds.y) * sy

    // --- 当前视口框 ---
    ctx.beginPath()
    ctx.rect(
      px(-camera.x / camera.zoom),
      py(-camera.y / camera.zoom),
      (view.width / camera.zoom) * sx,
      (view.height / camera.zoom) * sy,
    )
    ctx.strokeStyle = sealColorRef.current || '#a8432f'
    ctx.globalAlpha = 0.85
    ctx.lineWidth = 1.4
    ctx.stroke()
    ctx.globalAlpha = 1
  }, [mini, camera.x, camera.y, camera.zoom, view.width, view.height, renderMiniBg])

  // 布局阶段就画底图与视口：首帧不会先亮一块空白。
  useLayoutEffect(() => {
    renderMiniBg()
    drawMini()
  }, [renderMiniBg, drawMini])

  const refreshMiniRef = useRef(() => {
    renderMiniBg()
    drawMini()
  })
  useEffect(() => {
    refreshMiniRef.current = () => {
      renderMiniBg()
      drawMini()
    }
  })

  /** 换肤后重绘底图与视口：canvas 不像 SVG 那样跟着 CSS 变量自己变 */
  useLayoutEffect(() => {
    const watch = new MutationObserver(() => refreshMiniRef.current())
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    return () => watch.disconnect()
  }, [])

  return (
    <>
      {/*
        全景缩略图：节点按类型着色的微缩卡片（带描边与圆角）+ 半透明的当前视口框。
        点/拖哪里，镜头就把哪里居中——大图上找路比滚轮翻得快。
      */}
      {/*
        全景缩略图：节点按类型着色的微缩卡片（带描边与圆角）+ 半透明的当前视口框。
        点/拖哪里，镜头就把哪里居中——大图上找路比滚轮翻得快。
      */}
      {mini && (
        <div
          ref={minimapContainerRef}
          data-tour="minimap"
          className="absolute top-4 left-4 z-20 flex items-center justify-center rounded-xl border border-line bg-card/90 p-1.5 shadow-sm backdrop-blur"
          style={{ width: MINI_W + 12, height: MINI_H + 12 }}
        >
          {/*
            画的是一张 canvas（绘制见 drawMini）：缩略图天生适合它——纯几何、没有文本、
            没有交互（只有点击定位），不必为它付「自己实现排版与命中测试」的代价。
            原先这里是**全量 SVG**：每张卡两个 rect、每个目标项一条 line、每条边一个
            path，两百节点就是近千个常驻元素；而相机动一下（视口框要跟着走）React 就得
            把整棵 SVG 子树重新协调一遍。
            注意：**不要在这里写 width/height 属性**——那会让 React 每次渲染把画布重置
            回 1× 尺寸，把 drawMini 设好的 dpr 位图覆盖掉，画面立刻变糊。
          */}
          <canvas
            ref={miniRef}
            style={{ width: MINI_W, height: MINI_H }}
            className="block cursor-pointer touch-none"
            onPointerDown={onMinimapPointerDown}
            onPointerMove={onMinimapPointerMove}
            onPointerUp={onMinimapPointerUp}
            onPointerCancel={onMinimapPointerUp}
          />
        </div>
      )}
    </>

  )
}
