import { describe, expect, it } from 'vitest'
import {
  CARD_H,
  CARD_W,
  OUTLINE_CARD_W,
  PROJ_CARD_W,
  ROW_GAP,
  STRUCT_MAX_ZOOM,
  STRUCT_MIN_ZOOM_FACTOR,
  STRUCT_MIN_ZOOM_FLOOR,
  boundsOf,
  cardWidthOf,
  clampZoom,
  emptyStructure,
  fitZoom,
  freeSpotNear,
  minZoomOf,
  normalizeStructure,
  normalizeStructureBook,
  type GNodeKind,
} from '../src/learn/structure'

function card(uuid: string, kind: GNodeKind, x = 0, y = 0): { uuid: string; kind: GNodeKind; x: number; y: number } {
  return { uuid, kind, x, y }
}

describe('结构图（v2）：包围盒与缩放（几何口径与 v1 一致）', () => {
  it('卡片宽度：大纲卡加宽至 268px，项目卡独宽，其余普通卡 208px', () => {
    expect(cardWidthOf('outline')).toBe(OUTLINE_CARD_W)
    expect(cardWidthOf('outline')).toBe(268)
    expect(cardWidthOf('project')).toBe(PROJ_CARD_W)
    expect(cardWidthOf('doc')).toBe(CARD_W)
    expect(cardWidthOf('exam')).toBe(CARD_W)
  })

  it('包围盒按卡片尺寸算，不是按坐标点算', () => {
    const box = boundsOf([card('a', 'outline', 100, 50), card('b', 'doc', 400, 200)])
    expect(box).toEqual({ x: 100, y: 50, width: 300 + CARD_W, height: 150 + CARD_H })
  })

  it('freeSpotNear：锚点空就原样返回，被占就往下找第一块空位', () => {
    // 占着 (400, 0) 的一张卡
    const nodes = [card('a', 'doc', 400, 0)]
    const size = { width: CARD_W, height: CARD_H }
    // 锚点正好撞上：往下挪到第一块空地
    const spot = freeSpotNear(nodes, { x: 400, y: 0 }, size)
    expect(spot.y).toBeGreaterThanOrEqual(CARD_H)
    // 锚点本来就空：原样返回
    expect(freeSpotNear(nodes, { x: 900, y: 0 }, size)).toEqual({ x: 900, y: 0 })
    // 一整列都被占：返回的是有限位置（不发散、坐标有限）
    const column = Array.from({ length: 6 }, (_, i) => card(`c${i}`, 'doc', 400, i * (CARD_H + ROW_GAP)))
    const last = freeSpotNear(column, { x: 400, y: 0 }, size)
    expect(Number.isFinite(last.y)).toBe(true)
  })

  it('空图没有包围盒（调用方据此不缩放）', () => {
    expect(boundsOf([])).toBeNull()
  })

  it('缩放下限由内容包围盒算出：内容越散，下限越小', () => {
    const view = { width: 1000, height: 700 }
    const tight = boundsOf([card('a', 'outline', 0, 0), card('b', 'doc', 100, 0)])
    const wide = boundsOf([card('a', 'outline', 0, 0), card('b', 'doc', 5000, 0)])
    const zTight = minZoomOf(tight, view)
    const zWide = minZoomOf(wide, view)
    expect(zTight).toBeGreaterThan(zWide)
    // 下限 = 恰好装下的 zoom × 系数：系数小于 1，四周永远留得出空白可拖的区域
    expect(zTight).toBeCloseTo(fitZoom(tight!, view) * STRUCT_MIN_ZOOM_FACTOR, 6)
    expect(zWide).toBeCloseTo(fitZoom(wide!, view) * STRUCT_MIN_ZOOM_FACTOR, 6)
    // 刚好装下：宽高都不溢出视口
    expect(tight!.width * zTight).toBeLessThanOrEqual(view.width)
    expect(wide!.width * zWide).toBeLessThanOrEqual(view.width)
  })

  it('上限固定、下限有绝对兜底', () => {
    const view = { width: 1000, height: 700 }
    const tiny = boundsOf([card('a', 'outline', 0, 0)])
    // 一个节点也顶到固定上限就停
    expect(fitZoom(tiny!, view)).toBeLessThanOrEqual(STRUCT_MAX_ZOOM)
    // 节点拖到天边：下限不会掉到 0（否则能缩到什么都看不见）
    const far = boundsOf([card('a', 'outline', 0, 0), card('b', 'doc', 1_000_000, 0)])
    expect(fitZoom(far!, view)).toBeGreaterThanOrEqual(STRUCT_MIN_ZOOM_FLOOR)
  })

  it('缩放只被收进区间，不会被自动改掉', () => {
    const view = { width: 1000, height: 700 }
    const box = boundsOf([card('a', 'outline', 0, 0), card('b', 'doc', 3000, 0)])
    const min = minZoomOf(box, view)
    // 用户手放到比下限还小 → 收回到下限
    expect(clampZoom(min / 2, box, view)).toBeCloseTo(min, 6)
    // 用户手放到比上限还大 → 收回到上限
    expect(clampZoom(99, box, view)).toBe(STRUCT_MAX_ZOOM)
    // 区间内原样返回：这里没有任何「根据包围盒重算当前值」的逻辑
    const mid = (min + STRUCT_MAX_ZOOM) / 2
    expect(clampZoom(mid, box, view)).toBe(mid)
  })
})

describe('结构图（v2）：读盘校验', () => {
  it('v2 坐标表逐键重建：坏坐标丢掉、便条保留、edgeStyle 认得', () => {
    const map = normalizeStructure({
      version: 2,
      positions: {
        a: { x: 0, y: 0 },
        b: { x: 'NaN', y: 0 },
        c: { x: 5, y: 5, note: '贴一张便条' },
        d: { y: 5 },
      },
      edgeStyle: 'curved',
    })
    expect(map.positions).toEqual({
      a: { x: 0, y: 0 },
      c: { x: 5, y: 5, note: '贴一张便条' },
    })
    expect(map.edgeStyle).toBe('curved')
  })

  it('v1 卡片表折成 v2 坐标表：d:/o:/e:/entry: 映射，n:/s: 放弃（交给自动铺排）', () => {
    const map = normalizeStructure({
      version: 1,
      nodes: [
        { id: 'd:doc1', kind: 'doc', x: 1, y: 2, ref: 'doc1' },
        { id: 'o:doc1', kind: 'outline', x: 3, y: 4, ref: 'doc1', note: '大纲便条' },
        { id: 'e:ex1', kind: 'exam', x: 5, y: 6, ref: 'ex1' },
        { id: 'entry:root', kind: 'entry', x: 7, y: 8 },
        { id: 'n:doc1:错题', kind: 'note', x: 9, y: 10, ref: 'doc1:错题' },
        { id: 's:doc1:实验', kind: 'superdoc', x: 11, y: 12, ref: 'doc1:实验' },
        { id: 'd:dup', kind: 'doc', x: 13, y: 14, ref: 'dup' },
        { id: 'd:dup', kind: 'doc', x: 15, y: 16, ref: 'dup' },
        { id: 'bad', kind: 'nope', x: 0, y: 0 },
      ],
      edges: [{ from: 'd:doc1', to: 'o:doc1' }],
      hidden: ['d:gone'],
    })
    // d:/e: 前缀剥掉即文档/试卷 uuid；o:/entry: 原样即新键；重复 id 取第一份；坏类型丢掉
    expect(map.positions).toEqual({
      doc1: { x: 1, y: 2 },
      'o:doc1': { x: 3, y: 4, note: '大纲便条' },
      ex1: { x: 5, y: 6 },
      'entry:root': { x: 7, y: 8 },
      dup: { x: 13, y: 14 },
    })
    // 连线与墓碑不进 v2：前者全派生，后者随「删除即删实体」退役
    expect(map).not.toHaveProperty('nodes')
    expect(map).not.toHaveProperty('edges')
    expect(map).not.toHaveProperty('hidden')
  })

  it('空值与非对象输入给一张空图，不抛异常', () => {
    expect(normalizeStructure(null)).toEqual(emptyStructure())
    expect(normalizeStructure('x')).toEqual(emptyStructure())
    expect(normalizeStructure({ positions: 'oops' })).toEqual(emptyStructure())
  })

  it('整本账：目标不在的直接丢，空坐标表的也不留', () => {
    const out = normalizeStructureBook(
      {
        g1: { version: 2, positions: { a: { x: 0, y: 0 } } },
        g2: { version: 2, positions: {} },
        g3: { version: 2, positions: { b: { x: 1, y: 1 } } },
      },
      new Set(['g1', 'g2']),
    )
    expect(Object.keys(out)).toEqual(['g1'])
  })
})
