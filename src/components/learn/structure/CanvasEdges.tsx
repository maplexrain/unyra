/**
 * 结构画布的连线层：一张随节点包围盒铺开的 SVG，画派生边（树边 / 归属 / 目标绑定）、
 * 两端小圆点、以及连线中跟手的那条虚线橡皮筋。视口外的边做粗筛裁剪；
 * 路由点列来自宿主的 routeOf（绕行/曲线由派生层与主组件算好传入）。
 */

import type { GNodeKind } from '../../../learn/nodeKinds'
import type { EdgeStyle } from '../../../learn/structure'
import { CARD_H, cardWidthOf } from '../../../learn/structure'
import { EDGE_CULL_PAD } from './canvasTypes'
import {
  SLOT_ACCENT,
  edgeCurve,
  edgeDots,
  edgeElbow,
  edgePathD,
  slotAnchorY,
  type CanvasEdge,
  type CardView,
  type Point,
} from './structureView'

export interface CanvasEdgesProps {
  /** 节点总包围盒（SVG 层的尺寸与原点跟着它走）；null = 画布上还没有卡 */
  bounds: { x: number; y: number; width: number; height: number } | null
  edges: CanvasEdge[]
  byId: Map<string, CardView>
  height: (c: { uuid: string; kind: GNodeKind }) => number
  routeOf: (edge: CanvasEdge) => Point[] | undefined
  edgeStyle: EdgeStyle
  viewportBox: { left: number; top: number; right: number; bottom: number } | null
  selectedEdge: CanvasEdge | null
  hoverEdge: CanvasEdge | null
  hoverSlot: { parentId: string; key: string } | null
  linkAt: { x: number; y: number } | null
  linkFrom: string | null
  linkSlot: string | null
  /** 目标项圆点的实测高度（离卡片顶部），key = `卡片 uuid|目标项 key` */
  dotY: Record<string, number>
  edgeOrigin: { x: number; y: number }
  edgeSize: { width: number; height: number }
}

export function CanvasEdges({
  bounds,
  edges,
  byId,
  height,
  routeOf,
  edgeStyle,
  viewportBox,
  selectedEdge,
  hoverEdge,
  hoverSlot,
  linkAt,
  linkFrom,
  linkSlot,
  dotY,
  edgeOrigin,
  edgeSize,
}: CanvasEdgesProps) {
  return (
    <>
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
              const isSelected = selectedEdge?.from === edge.from && selectedEdge?.to === edge.to
              /*
                视口裁剪：一屏能看见的永远只有局部，边数却随图规模线性涨。不裁的话
                每条边都是一个常驻 SVG 元素（样式重算、层序、命中区都按元素算）。
                粗筛用「两端卡片矩形的并集」外扩 EDGE_CULL_PAD，命中都不命中就连
                routeOf 那趟绕行路由都不用算。选中 / 正在指的那条不裁——用户点它就是要看见它。
              */
              if (viewportBox && !isSelected) {
                const left = Math.min(from.x, to.x) - EDGE_CULL_PAD
                const top = Math.min(from.y, to.y) - EDGE_CULL_PAD
                const right = Math.max(from.x + cardWidthOf(from.kind), to.x + cardWidthOf(to.kind)) + EDGE_CULL_PAD
                const bottom = Math.max(from.y + height(from), to.y + height(to)) + EDGE_CULL_PAD
                if (
                  right < viewportBox.left ||
                  left > viewportBox.right ||
                  bottom < viewportBox.top ||
                  top > viewportBox.bottom
                ) {
                  return null
                }
              }
              const path = routeOf(edge)
              if (!path) return null
              // 世界坐标 → SVG 坐标（这一层是从包围盒左上角铺开的）
              const points = path.map((p) => ({ x: p.x - edgeOrigin.x, y: p.y - edgeOrigin.y }))
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
    </>
  )
}
