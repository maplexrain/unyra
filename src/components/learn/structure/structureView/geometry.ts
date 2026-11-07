/**
 * 连线几何与点选：命中测试（hitTest）、贝塞尔曲线控制点（edgeCurve）、
 * 直角路由（edgeElbow / edgeRoute，穿卡时 A* 绕行）、路径 d（edgePathD）、
 * 线上取点（edgePointAt）、连线与两端圆点的点选（edgeAt / edgeDots / edgeDotAt）。
 * 从 structureView.ts 拆出（纯搬运，逻辑与注释原样）。
 */

import { defaultHeight, rectOf, type EdgeStyle, type HeightOf } from '../../../../learn/structure'
import { EDGE_ANCHOR_Y } from './palette'
import type { CanvasEdge, CardView } from './viewModel'

/* ---------- 命中测试与连线几何（与 v1 同一套，卡片形状换成 CardView） ---------- */

/** 世界坐标落在哪张卡上（拖动连线时指针被容器捕获，只有几何判断可靠） */
export function hitTest(cards: readonly CardView[], x: number, y: number, height: HeightOf = defaultHeight): CardView | null {
  for (let i = cards.length - 1; i >= 0; i--) {
    const rect = rectOf(cards[i], height)
    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) return cards[i]
  }
  return null
}

export interface Point {
  x: number
  y: number
}

/** 一条连线的三次贝塞尔控制点：从左卡右沿出、进右卡左沿 */
export function edgeCurve(
  from: CardView,
  to: CardView,
  height: HeightOf = defaultHeight,
  anchor?: { from?: number; to?: number },
): [Point, Point, Point, Point] {
  const fromRect = rectOf(from, height)
  const toRect = rectOf(to, height)
  const p0 = { x: fromRect.x + fromRect.width, y: fromRect.y + (anchor?.from ?? EDGE_ANCHOR_Y) }
  const p3 = { x: toRect.x, y: toRect.y + (anchor?.to ?? EDGE_ANCHOR_Y) }
  const bend = Math.max(48, Math.abs(p3.x - p0.x) * 0.45)
  return [p0, { x: p0.x + bend, y: p0.y }, { x: p3.x - bend, y: p3.y }, p3]
}

/* ---------- 直角路由：绕开卡片 ---------- */

export const EDGE_CLEARANCE = 16
export const EDGE_STUB = 20
const TURN_COST = 48

interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

function inflate(r: RectLike, by: number): RectLike {
  return { x: r.x - by, y: r.y - by, width: r.width + by * 2, height: r.height + by * 2 }
}

const EPS = 0.5

function insideRect(p: Point, r: RectLike): boolean {
  return p.x > r.x + EPS && p.x < r.x + r.width - EPS && p.y > r.y + EPS && p.y < r.y + r.height - EPS
}

function crossesRect(a: Point, b: Point, r: RectLike): boolean {
  const minX = Math.min(a.x, b.x)
  const maxX = Math.max(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxY = Math.max(a.y, b.y)
  return maxX > r.x + EPS && minX < r.x + r.width - EPS && maxY > r.y + EPS && minY < r.y + r.height - EPS
}

function intersectsRect(a: RectLike, b: RectLike): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** 老画法：右出 → 竖直 → 右进；没有卡片挡路就用它（一张图一种线型） */
export function edgeElbow(start: Point, end: Point): Point[] {
  if (Math.abs(start.y - end.y) < 0.5) return [start, end]
  const midX = end.x > start.x + 48 ? (start.x + end.x) / 2 : start.x + 40
  return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]
}

function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue
    out.push({ x: p.x, y: p.y })
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1]
    const b = out[i]
    const c = out[i + 1]
    const sameX = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS
    const sameY = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS
    if (sameX || sameY) out.splice(i, 1)
  }
  return out
}

function axisLines(keep: readonly number[], edges: readonly number[]): number[] {
  const out = [...keep]
  for (const v of edges) {
    if (out.some((k) => Math.abs(k - v) <= 1)) continue
    out.push(v)
  }
  return out.sort((a, b) => a - b)
}

function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

/** A* 的开集：二叉堆。拖节点时每条边都要重算，别用「每次扫一遍找最小」 */
class OpenSet {
  private ids: number[] = []
  private keys: number[] = []

  get size(): number {
    return this.ids.length
  }

  push(id: number, key: number): void {
    this.ids.push(id)
    this.keys.push(key)
    let i = this.ids.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.keys[parent] <= this.keys[i]) break
      this.swap(parent, i)
      i = parent
    }
  }

  pop(): number {
    const top = this.ids[0]
    const lastId = this.ids.pop() as number
    const lastKey = this.keys.pop() as number
    if (this.ids.length) {
      this.ids[0] = lastId
      this.keys[0] = lastKey
      let i = 0
      for (;;) {
        const left = i * 2 + 1
        const right = left + 1
        let small = i
        if (left < this.ids.length && this.keys[left] < this.keys[small]) small = left
        if (right < this.ids.length && this.keys[right] < this.keys[small]) small = right
        if (small === i) break
        this.swap(small, i)
        i = small
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    const id = this.ids[a]
    this.ids[a] = this.ids[b]
    this.ids[b] = id
    const key = this.keys[a]
    this.keys[a] = this.keys[b]
    this.keys[b] = key
  }
}

const STEPS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 2],
  [0, -1, 2],
]

/** 在障碍之间找一条横平竖直的路（A*，代价 = 长度 + 拐弯；网格取端点 + 障碍边这些线） */
function orthogonalRoute(start: Point, end: Point, solids: readonly RectLike[]): Point[] | null {
  const xs = axisLines(
    [start.x, end.x],
    solids.flatMap((r) => [r.x, r.x + r.width]),
  )
  const ys = axisLines(
    [start.y, end.y],
    solids.flatMap((r) => [r.y, r.y + r.height]),
  )
  const nx = xs.length
  const ny = ys.length
  const cells = nx * ny

  const blocked = new Uint8Array(cells)
  for (let xi = 0; xi < nx; xi++) {
    for (let yi = 0; yi < ny; yi++) {
      const p = { x: xs[xi], y: ys[yi] }
      if (solids.some((r) => insideRect(p, r))) blocked[xi * ny + yi] = 1
    }
  }

  const startXi = xs.indexOf(start.x)
  const startYi = ys.indexOf(start.y)
  const endXi = xs.indexOf(end.x)
  const endYi = ys.indexOf(end.y)
  if (startXi < 0 || startYi < 0 || endXi < 0 || endYi < 0) return null
  const startCell = startXi * ny + startYi
  const endCell = endXi * ny + endYi
  blocked[startCell] = 0
  blocked[endCell] = 0

  const g = new Float64Array(cells * 3).fill(Infinity)
  const prev = new Int32Array(cells * 3).fill(-1)
  const done = new Uint8Array(cells * 3)
  const open = new OpenSet()
  const first = startCell * 3
  g[first] = 0
  open.push(first, manhattan(start, end))

  while (open.size) {
    const cur = open.pop()
    if (done[cur]) continue
    done[cur] = 1
    const dir = cur % 3
    const cell = (cur - dir) / 3
    if (cell === endCell) {
      const path: Point[] = []
      for (let id = cur; id >= 0; id = prev[id]) {
        const d = id % 3
        const c = (id - d) / 3
        const xi = Math.floor(c / ny)
        path.push({ x: xs[xi], y: ys[c - xi * ny] })
      }
      return simplify(path.reverse())
    }
    const xi = Math.floor(cell / ny)
    const yi = cell - xi * ny
    const here = { x: xs[xi], y: ys[yi] }
    for (const [dx, dy, nextDir] of STEPS) {
      const tx = xi + dx
      const ty = yi + dy
      if (tx < 0 || tx >= nx || ty < 0 || ty >= ny) continue
      const target = tx * ny + ty
      if (blocked[target]) continue
      const there = { x: xs[tx], y: ys[ty] }
      if (solids.some((r) => crossesRect(here, there, r))) continue
      const next = target * 3 + nextDir
      if (done[next]) continue
      const cost = g[cur] + manhattan(here, there) + (dir && dir !== nextDir ? TURN_COST : 0)
      if (cost < g[next] - 1e-6) {
        g[next] = cost
        prev[next] = cur
        open.push(next, cost + manhattan(there, end))
      }
    }
  }
  return null
}

/**
 * 一条边画在哪：直角折线，遇到卡片绕着走。先试老画法（不穿卡就用），
 * 穿不过去才 A* 绕行；接入位置固定（源右沿出、目标左沿进）。
 */
export function edgeRoute(
  from: CardView,
  to: CardView,
  cards: readonly CardView[],
  height: HeightOf = defaultHeight,
  anchor?: { from?: number; to?: number },
): Point[] {
  const fromRect = rectOf(from, height)
  const toRect = rectOf(to, height)
  const start = { x: fromRect.x + fromRect.width, y: fromRect.y + (anchor?.from ?? EDGE_ANCHOR_Y) }
  const end = { x: toRect.x, y: toRect.y + (anchor?.to ?? EDGE_ANCHOR_Y) }

  const others = cards
    .filter((n) => n.uuid !== from.uuid && n.uuid !== to.uuid)
    .map((n) => inflate(rectOf(n, height), EDGE_CLEARANCE))
  const solids = [...others, fromRect, toRect]

  const elbow = edgeElbow(start, end)
  const blocked = solids.some((r) => elbow.some((p, i) => i > 0 && crossesRect(elbow[i - 1], p, r)))
  if (!blocked) return elbow

  const stubStart = { x: start.x + EDGE_STUB, y: start.y }
  const stubEnd = { x: end.x - EDGE_STUB, y: end.y }
  const around = [...others, inflate(fromRect, EDGE_CLEARANCE), inflate(toRect, EDGE_CLEARANCE)]
  const area = {
    x: Math.min(start.x, end.x) - 240,
    y: Math.min(start.y, end.y) - 240,
    width: Math.abs(start.x - end.x) + 480,
    height: Math.abs(start.y - end.y) + 480,
  }
  const near = around.filter((r) => intersectsRect(area, r))
  const found = orthogonalRoute(stubStart, stubEnd, near) ?? orthogonalRoute(stubStart, stubEnd, around)
  if (!found) return elbow

  const points = simplify([start, ...found, end])
  const hits = points.some((p, i) => i > 0 && solids.some((r) => crossesRect(points[i - 1], p, r)))
  return hits ? elbow : points
}

function distanceToSegment(x: number, y: number, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < 0.0001) return Math.hypot(x - a.x, y - a.y)
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2))
  return Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t))
}

/** 路径的 d：折线直接连，曲线要四个贝塞尔控制点 */
export function edgePathD(points: readonly Point[], style: EdgeStyle = 'straight'): string {
  if (style === 'curved' && points.length === 4) {
    const [p0, p1, p2, p3] = points
    return `M${p0.x} ${p0.y} C${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`
  }
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
}

function polylineAt(points: readonly Point[], t: number): Point {
  if (!points.length) return { x: 0, y: 0 }
  const segs = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
  const total = segs.reduce((a, b) => a + b, 0)
  if (total < 0.5) return points[0]
  let left = t * total
  for (let i = 0; i < segs.length; i++) {
    if (left <= segs[i] || i === segs.length - 1) {
      const k = segs[i] < 0.5 ? 0 : Math.min(1, left / segs[i])
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * k,
        y: points[i].y + (points[i + 1].y - points[i].y) * k,
      }
    }
    left -= segs[i]
  }
  return points[points.length - 1]
}

/** 线上参数 t 处的点：折线按累计长度取，曲线是三次贝塞尔 */
export function edgePointAt(points: readonly Point[], t: number, style: EdgeStyle = 'straight'): Point {
  if (style === 'curved' && points.length === 4) {
    const [p0, p1, p2, p3] = points
    const u = 1 - t
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    }
  }
  return polylineAt(points, t)
}

function edgePointsOf(
  cards: readonly CardView[],
  edge: CanvasEdge,
  from: CardView,
  to: CardView,
  height: HeightOf,
  style: EdgeStyle,
  anchorOf?: (edge: CanvasEdge) => { from?: number; to?: number } | undefined,
  routeOf?: (edge: CanvasEdge) => readonly Point[] | undefined,
): readonly Point[] {
  const cached = routeOf?.(edge)
  if (cached) return cached
  const anchor = anchorOf?.(edge)
  return style === 'curved' ? edgeCurve(from, to, height, anchor) : edgeRoute(from, to, cards, height, anchor)
}

/** 点在哪条连线上（阈值内取最近） */
export function edgeAt(
  cards: readonly CardView[],
  edges: readonly CanvasEdge[],
  x: number,
  y: number,
  threshold = 8,
  height: HeightOf = defaultHeight,
  style: EdgeStyle = 'straight',
  anchorOf?: (edge: CanvasEdge) => { from?: number; to?: number } | undefined,
  routeOf?: (edge: CanvasEdge) => readonly Point[] | undefined,
): CanvasEdge | null {
  const byId = new Map(cards.map((c) => [c.uuid, c]))
  let best: CanvasEdge | null = null
  let bestDist = threshold
  for (const edge of edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) continue
    const points = edgePointsOf(cards, edge, from, to, height, style, anchorOf, routeOf)
    let dist = Infinity
    if (style === 'curved' && points.length === 4) {
      for (let i = 0; i <= 24; i++) {
        const p = edgePointAt(points, i / 24, 'curved')
        dist = Math.min(dist, Math.hypot(p.x - x, p.y - y))
      }
    } else {
      for (let i = 1; i < points.length; i++) {
        dist = Math.min(dist, distanceToSegment(x, y, points[i - 1], points[i]))
      }
    }
    if (dist <= bestDist) {
      bestDist = dist
      best = edge
    }
  }
  return best
}

/** 一条连线两端那两颗小圆点的位置（按参数取，永远落在线上） */
export function edgeDots(points: readonly Point[], style: EdgeStyle = 'straight'): { from: Point; to: Point } {
  return { from: edgePointAt(points, 0.22, style), to: edgePointAt(points, 0.78, style) }
}

/** 点在哪颗小圆点上（点它 = 跳到线的另一端） */
export function edgeDotAt(
  cards: readonly CardView[],
  edges: readonly CanvasEdge[],
  x: number,
  y: number,
  threshold = 11,
  height: HeightOf = defaultHeight,
  style: EdgeStyle = 'straight',
  anchorOf?: (edge: CanvasEdge) => { from?: number; to?: number } | undefined,
  routeOf?: (edge: CanvasEdge) => readonly Point[] | undefined,
): { edge: CanvasEdge; side: 'from' | 'to' } | null {
  const byId = new Map(cards.map((c) => [c.uuid, c]))
  for (const edge of edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) continue
    const dots = edgeDots(edgePointsOf(cards, edge, from, to, height, style, anchorOf, routeOf), style)
    if (Math.hypot(dots.from.x - x, dots.from.y - y) <= threshold) return { edge, side: 'from' }
    if (Math.hypot(dots.to.x - x, dots.to.y - y) <= threshold) return { edge, side: 'to' }
  }
  return null
}
