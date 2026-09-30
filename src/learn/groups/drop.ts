/** 这个文件负责：拖动落点的几何——指针落在哪一格的哪条边上（纯坐标换算，所以能被单测钉住） */

import type { DropZoneKind } from './types'

/* ---------- 拖页签的落点 ---------- */

/** 贴边阈值：四边各 30% 以内算贴边，中间那 40% 见方算「放进这一格」 */
export const DROP_EDGE = 0.3

/**
 * 指针落在这一格的哪一条边上；不在这一格里时返回 null。
 *
 * box 用实测矩形（getBoundingClientRect 那一份），这里只做纯粹的相对位置判断。
 */
export function zoneAtPoint(
  box: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
): DropZoneKind | null {
  if (x < box.left || y < box.top || x > box.left + box.width || y > box.top + box.height) return null
  // 相对位置（0~1）：四边各算一次距离，最近的那一条就是落点所在的那条边
  const fx = (x - box.left) / Math.max(1, box.width)
  const fy = (y - box.top) / Math.max(1, box.height)
  const d = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy }
  const edge = Math.min(d.left, d.right, d.top, d.bottom)
  if (edge > DROP_EDGE) return 'center'
  return edge === d.left ? 'left' : edge === d.right ? 'right' : edge === d.top ? 'top' : 'bottom'
}
