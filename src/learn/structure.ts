/**
 * 结构图的领域层（**v2，全图化重构**）：几何与缩放数学 + 落盘形状。
 *
 * ## v2 的契约（对照 v1 的天翻地覆，2026-10-24）
 *
 * 画布自有状态**只剩坐标（与贴在卡片上的便条）**：
 * - **卡片就是节点**：坐标表的键是节点 uuid，直接对上 store 里的实体（文档 / 大纲 /
 *   笔记 / 试卷 / 超级文档 / 入口），不再有卡片自己的 id、ref、slot 与连线表；
 * - **连线全部派生**：树边（store.edges）画成「大纲 → 文档」，挂件归属画成
 *   「文档 → 挂件」，目标绑定画成「入口 → 根文档」——图上没有任何一条存出来的线；
 * - **删除卡片 = 删除实体**（统一走 NodeService.delete）：墓碑（hidden）随之退役——
 *   卡片不是派生补出来的，「删了又冒出来」这类对账问题从根上不存在了；
 * - **没有坐标的卡片自动铺排**（structureView 的 deriveCanvas）：按关系深度落列，
 *   拖过之后以存下的坐标为准。
 *
 * ## 存量 v1（cards + edges + hidden）读盘折算
 *
 * 旧卡片 id 按前缀映射：`d:{id}` → 文档 uuid，`o:{id}` / `entry:{id}` / `e:{examId}` →
 * 原样即新键；`n:{owner}:{name}` / `s:{owner}:{name}` 的坐标放弃（旧身份按名字，新身份
 * 是持久 id），交给自动铺排在宿主文档旁边落位——一次性、纯外观。
 *
 * 几何常量与函数（卡片尺寸、包围盒、落点、缩放）保持 v1 的口径：布局、拖拽、
 * 「适应画布」全用这一份，两处各写一个数就会出现「算包围盒时按 200 宽、画的时候是 240」。
 */

import type { GNodeKind } from './nodeKinds'

export type { GNodeKind }
export { isGraphKind, GRAPH_KIND_LABEL, KIND_RANK, NODE_KINDS } from './nodeKinds'

/* ---------- 落盘形状 ---------- */

/** 一张卡的画布状态：坐标 + 用户贴的便条（内容本体永远在 store，不在这里） */
export interface CardPos {
  /** 卡片左上角，世界坐标（与缩放无关） */
  x: number
  y: number
  /** 用户贴在卡片上的便条（右键菜单「注释」）；只属于画布，跟着坐标一起存 */
  note?: string
}

/** 一个目标的结构图（落 `docs/{目标}/structure.json`）——只有坐标与便条 */
export interface StructureMap {
  version: 2
  positions: Record<string, CardPos>
  /** 连线画法（每门课各记各的）；省略 = 直线 */
  edgeStyle?: EdgeStyle
}

export function emptyStructure(): StructureMap {
  return { version: 2, positions: {} }
}

/* ---------- 连线画法 ---------- */

export const EDGE_STYLES = ['straight', 'curved'] as const
export type EdgeStyle = (typeof EDGE_STYLES)[number]

export function isEdgeStyle(v: unknown): v is EdgeStyle {
  return v === 'straight' || v === 'curved'
}

/* ---------- 读盘校验（含 v1 → v2 折算） ---------- */

function finiteNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/**
 * v1 卡片 id → v2 坐标键。`n:` / `s:`（旧名字身份）回 null：坐标放弃、自动铺排。
 * 其余前缀在新旧两代是同一套拼法（v1 的确定性 id 本来就是从这套前缀来的）。
 */
function v1CardKey(id: string): string | null {
  if (id.startsWith('d:') || id.startsWith('e:')) return id.slice(2) || null
  if (id.startsWith('o:') || id.startsWith('entry:')) return id
  return null
}

/**
 * 读回来的结构图：v2 直接重建，v1 折算成坐标表。认不出来的一律丢掉——
 * 与 store 的 normalize 同一条纪律（宁少一个坐标，不留一个 NaN）。
 */
export function normalizeStructure(raw: unknown): StructureMap {
  if (!raw || typeof raw !== 'object') return emptyStructure()
  const src = raw as {
    version?: unknown
    positions?: unknown
    edgeStyle?: unknown
    nodes?: unknown
  }

  const out: StructureMap = { version: 2, positions: {} }

  if (src.positions && typeof src.positions === 'object' && !Array.isArray(src.positions)) {
    // v2：坐标表逐键重建
    for (const [key, value] of Object.entries(src.positions as Record<string, unknown>)) {
      if (!key || !value || typeof value !== 'object') continue
      const p = value as Record<string, unknown>
      const x = finiteNum(p.x)
      const y = finiteNum(p.y)
      if (x === undefined || y === undefined) continue
      const note = typeof p.note === 'string' && p.note.trim() ? p.note : undefined
      out.positions[key] = { x, y, ...(note ? { note } : {}) }
    }
  } else if (Array.isArray(src.nodes)) {
    // v1：卡片表折成坐标表（连线与墓碑不再需要：前者全派生，后者随「删除即删实体」退役）
    for (const item of src.nodes) {
      if (!item || typeof item !== 'object') continue
      const n = item as Record<string, unknown>
      if (typeof n.id !== 'string') continue
      const key = v1CardKey(n.id)
      if (!key || out.positions[key]) continue
      const x = finiteNum(n.x)
      const y = finiteNum(n.y)
      if (x === undefined || y === undefined) continue
      const note = typeof n.note === 'string' && n.note.trim() ? n.note : undefined
      out.positions[key] = { x, y, ...(note ? { note } : {}) }
    }
  }

  if (isEdgeStyle(src.edgeStyle)) out.edgeStyle = src.edgeStyle
  return out
}

/**
 * 读回来的一整本结构图：目标 id → 那个目标的坐标表。
 * 目标已经不在的直接丢掉；一张坐标都没有的也不留（等于「还没拖过」）。
 */
export function normalizeStructureBook(raw: unknown, goalIds: ReadonlySet<string>): Record<string, StructureMap> {
  const out: Record<string, StructureMap> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [goalId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!goalIds.has(goalId)) continue
    const map = normalizeStructure(value)
    if (Object.keys(map.positions).length) out[goalId] = map
  }
  return out
}

/* ---------- 卡片尺寸与包围盒（v1 口径原样保留） ---------- */

export const CARD_W = 208
export const CARD_H = 76
/** 项目卡是普通卡的 1.5 倍宽：要装下路径行与可展开的目录树（其余卡统一 208） */
export const PROJ_CARD_W = Math.round(CARD_W * 1.5)

/** 一类卡多宽（project 独宽，其余同宽）：几何、命中、铺排、渲染共用这一份，别处再写一个数就会对不上 */
export function cardWidthOf(kind: GNodeKind): number {
  return kind === 'project' ? PROJ_CARD_W : CARD_W
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 一张卡有多高（内容算出来的，不进数据；大纲卡按目标项条数长高） */
export type HeightOf = (node: { uuid: string; kind: GNodeKind }) => number

export const defaultHeight: HeightOf = () => CARD_H

export function rectOf(node: { uuid: string; kind: GNodeKind; x: number; y: number }, heightOf: HeightOf = defaultHeight): Rect {
  return { x: node.x, y: node.y, width: cardWidthOf(node.kind), height: heightOf(node) }
}

/** 全部卡片的包围盒；一张都没有时返回 null（调用方据此不做「适应画布」） */
export function boundsOf(nodes: readonly { uuid: string; kind: GNodeKind; x: number; y: number }[], heightOf: HeightOf = defaultHeight): Rect | null {
  if (!nodes.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    const h = heightOf(n)
    if (n.x < minX) minX = n.x
    if (n.y < minY) minY = n.y
    const w = cardWidthOf(n.kind)
    if (n.x + w > maxX) maxX = n.x + w
    if (n.y + h > maxY) maxY = n.y + h
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * 给一张新卡找一个不与现有卡重叠的落点：从锚点出发往下挪，直到腾出位置。
 * 四周各留 12px 的呼吸空隙，贴着算重叠。
 */
export function freeSpotNear(
  nodes: readonly { uuid: string; kind: GNodeKind; x: number; y: number }[],
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  heightOf: HeightOf = defaultHeight,
): { x: number; y: number } {
  const GAP = 12
  const overlaps = (x: number, y: number): boolean =>
    nodes.some((n) => {
      const r = rectOf(n, heightOf)
      return x < r.x + r.width + GAP && r.x < x + size.width + GAP && y < r.y + r.height + GAP && r.y < y + size.height + GAP
    })
  let y = anchor.y
  for (let i = 0; i <= nodes.length; i++) {
    if (!overlaps(anchor.x, y)) return { x: anchor.x, y }
    y += size.height + ROW_GAP
  }
  return { x: anchor.x, y }
}

/* ---------- 缩放（v1 口径原样保留） ---------- */

export const STRUCT_MAX_ZOOM = 1.6
export const STRUCT_MIN_ZOOM_FLOOR = 0.02
/**
 * 缩放下限 = 「恰好装下全图」的 zoom × 这个系数。1 = 旧口径（缩到全图刚好装满就到底）；
 * 调小它，画布四周就多出成片的空白可拖可看——用户要的「更大范围的可拖拽空间」。
 * 绝对兜底仍是 STRUCT_MIN_ZOOM_FLOOR（再空的画布也不许缩到什么都看不见）。
 */
export const STRUCT_MIN_ZOOM_FACTOR = 0.6
export const STRUCT_FIT_PADDING = 96

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function fitZoom(bounds: Rect, view: { width: number; height: number }, padding = STRUCT_FIT_PADDING): number {
  const usableW = Math.max(1, view.width - padding * 2)
  const usableH = Math.max(1, view.height - padding * 2)
  const zoom = Math.min(usableW / Math.max(1, bounds.width), usableH / Math.max(1, bounds.height))
  return clamp(zoom, STRUCT_MIN_ZOOM_FLOOR, STRUCT_MAX_ZOOM)
}

export function minZoomOf(bounds: Rect | null, view: { width: number; height: number }): number {
  if (!bounds) return STRUCT_MIN_ZOOM_FLOOR
  return Math.max(STRUCT_MIN_ZOOM_FLOOR, fitZoom(bounds, view) * STRUCT_MIN_ZOOM_FACTOR)
}

export function clampZoom(zoom: number, bounds: Rect | null, view: { width: number; height: number }): number {
  return clamp(zoom, minZoomOf(bounds, view), STRUCT_MAX_ZOOM)
}

export function centerPan(bounds: Rect, view: { width: number; height: number }, zoom: number): { x: number; y: number } {
  return {
    x: view.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: view.height / 2 - (bounds.y + bounds.height / 2) * zoom,
  }
}

/* ---------- 行列间距 ---------- */

/** 列间距（世界坐标）：卡片宽 + 连线留白 */
export const COL_GAP = CARD_W + 112
/** 同一列里两张卡之间的空（「空」不是「行距」：卡片高度是内容算出来的） */
export const ROW_GAP = 36
