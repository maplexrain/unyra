/*
 * 这个文件负责：页签栏的**常量与拖拽几何小件**——
 * 拖动判定的阈值、页签间距、一枚页签按下那一刻量到的矩形（TabRect）、
 * 拖动中的状态形状（DragState），以及「其余页签要让多远」的位移计算（tabShift）。
 *
 * 纯数据与纯函数：不碰 React、不碰 DOM。被 useTabBarDnd（拖拽会话）、
 * TabStrip（一枚页签怎么画）与门面（进出场认身份用的 tabIdOf）两头共用。
 */

import type { LearnTab } from '../../../learn/types'

/** 拖动一个页签要挪动这么多像素才算「在拖」，低于它仍是点击 */
export const DRAG_MIN = 4

/** 指针出栏多少像素算「拖出来了」：出栏的判定留余量防抖，回栏的判定不留（回得更紧） */
export const LIFT_PAD = 8

/** 页签之间的间距，与页签条上那个 gap-[3px] 是一对 */
export const TAB_GAP = 3

/** 认一枚页签的身份（进出场用它比对前后两版列表）；模块级是为了让它一直是同一个函数 */
export const tabIdOf = (tab: LearnTab): string => tab.id

/**
 * 按下那一刻量到的一个页签。
 *
 * 量一次就冻住：拖动过程中旁边的页签一直在让位，实时量出来的矩形一直在动，
 * 拿它算落点会来回抖（这条教训上一次就是这么踩到的）。
 */
export interface TabRect {
  id: string
  left: number
  width: number
}

export interface DragState {
  id: string
  isPinned: boolean
  /** 拖动开始时它在对应列表（固定或非固定）里的位置 */
  from: number
  /** 此刻它应该落到哪个位置（把其余页签按原位置的中点一分为二算出来的） */
  to: number
  /** 指针相对起点的位移 */
  dx: number
  /** 被拖的那个页签的宽度（其余页签要让位的距离就是它 + 间距） */
  width: number
  /** 指针出了页签栏：页签被真正拖了出来，栏里只剩一枚淡占位（影子跟着指针走） */
  lifted: boolean
}

/**
 * 其余页签要让多远：被拖的那个插到右边去，中间这些就往左让一个「页签宽 + 间距」，
 * 反过来往右让。位移用 transform 而不是重排 DOM——重排会让整条栏瞬间跳一下，
 * 而 transform 是能补间的（transition-transform）。
 */
export function tabShift(drag: DragState | null, i: number, isItemPinned: boolean): number {
  if (!drag || drag.isPinned !== isItemPinned) return 0
  const step = drag.width + TAB_GAP
  if (drag.to > drag.from && i > drag.from && i <= drag.to) return -step
  if (drag.to < drag.from && i >= drag.to && i < drag.from) return step
  return 0
}
