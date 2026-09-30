/*
 * 这个文件负责：文档区拖拽相关的**纯几何**判断（落点、阈值、行内纵向位置）。
 *
 * 全是纯函数：输入 DOM 矩形或坐标，输出数字或布尔，不碰 store、不碰 React。
 * 单独成文件是因为它们被「页签拖动」「分割线拖动」「两列拖宽」三处共用，
 * 而每一处的组件都只想知道「落在哪」，不该各自抄一份判据。
 */

import type { DropZone } from '../../../learn/groups'

/** 落点高亮画在哪一块：贴哪条边就画那半边，中间画满整格 */
export const ZONE_BOX: Record<DropZone['zone'], string> = {
  center: 'inset-1',
  left: 'inset-y-1 left-1 w-1/2',
  right: 'inset-y-1 right-1 w-1/2',
  top: 'inset-x-1 top-1 h-1/2',
  bottom: 'inset-x-1 bottom-1 h-1/2',
}

/**
 * 指针落在这一排页签的**第几个位置**上（用于「拖进别格的页签栏」）。
 *
 * 数的是中点：指针越过一个页签的中线，落点就在它后面一个——与栏内排序（TabBar 里那套）
 * 是同一个判据，两处手感因此一致。
 */
export function insertIndexAt(strip: HTMLElement, x: number): number {
  const tabs = [...strip.querySelectorAll<HTMLElement>('[data-tab]')]
  let at = 0
  for (const el of tabs) {
    const r = el.getBoundingClientRect()
    if (x > r.left + r.width / 2) at += 1
  }
  return at
}

/** 两个落点是不是同一处（指针每动一下都会算一次，一样就别重渲染） */
export function sameZone(a: DropZone | null, b: DropZone | null): boolean {
  if (!a || !b) return a === b
  return a.group === b.group && a.zone === b.zone && (a.index ?? null) === (b.index ?? null)
}

/**
 * 指针在那一行里的纵向位置（拖动时的宽度读数跟着它上下走），夹在行内：
 * 指针甩到行外时读数也不该跟着跑出去。
 */
export function dragYWithin(row: HTMLElement | null, clientY: number): number {
  if (!row) return 0
  const box = row.getBoundingClientRect()
  return Math.min(Math.max(clientY - box.top, 20), Math.max(20, box.height - 20))
}
