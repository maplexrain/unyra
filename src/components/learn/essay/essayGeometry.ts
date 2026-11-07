/**
 * 随笔窗口的**几何与拖拽机制**（搬自 EssayDock，纯搬运）：
 *
 * - 没摆过时的默认位置（视口居中）与夹取（clampRect：窗口不许被拖到看不见的地方）；
 * - 圆 → 方变形的计时常数（按钮长成窗口的那 260ms）；
 * - 窗口级指针拖拽的装/拆（bindWindowDrag：拖动浮窗、拖右下角改大小共用）。
 *
 * 几何存在 state.json（见 learn/types 的 EssayDockRect）：下次打开还在你摆的那个位置；
 * 打开那一刻要重新夹一遍视口——上次是 1440 宽的屏，这次可能只有 900，存下来的坐标
 * 必须当场收回来（见 clampRect）。变形的播放与开合时序在 EssayDock，这里只有机制。
 */
import { ESSAY_DOCK_MIN_H, ESSAY_DOCK_MIN_W } from '../../../learn/essays'
import type { EssayDockRect } from '../../../learn/types'

/** 默认尺寸（用户定的）：500×700，居中摆——够写一段、读一段历史，也不偏到角落去 */
const DEFAULT_W = 500
const DEFAULT_H = 700
/** 圆 → 方的变形时长；与 CSS 过渡、退场时序同一个数 */
export const MORPH_MS = 260
/** 方窗口的圆角（变形终点） */
export const PANEL_RADIUS = 16
/** 内容晚一点再淡入：先让盒子长开，字再跟上，才不会在 44px 的圆里挤成一团 */
export const CONTENT_DELAY_MS = 140

/** 变形中的几何：x/y/w/h + 圆角（按钮是正圆，窗口是 16px） */
export interface Box {
  x: number
  y: number
  w: number
  h: number
  r: number
}

/**
 * 没存过几何时的位置：**视口居中**（用户定的）。量不到按钮也无所谓——
 * 变形动画的起点仍由按钮那颗圆决定（见 boxOfButton），终点落在这里。
 */
export function defaultRect(): EssayDockRect {
  const w = Math.min(DEFAULT_W, Math.max(ESSAY_DOCK_MIN_W, window.innerWidth - 24))
  const h = Math.min(DEFAULT_H, Math.max(ESSAY_DOCK_MIN_H, window.innerHeight - 24))
  return {
    x: Math.max(8, Math.round((window.innerWidth - w) / 2)),
    y: Math.max(8, Math.round((window.innerHeight - h) / 2)),
    w,
    h,
  }
}

/** 夹进视口：窗口不许被拖到看不见的地方（拖出去就再也抓不回来了） */
export function clampRect(r: EssayDockRect): EssayDockRect {
  const maxW = Math.max(ESSAY_DOCK_MIN_W, window.innerWidth - 24)
  const maxH = Math.max(ESSAY_DOCK_MIN_H, window.innerHeight - 24)
  const w = Math.min(Math.max(ESSAY_DOCK_MIN_W, r.w), maxW)
  const h = Math.min(Math.max(ESSAY_DOCK_MIN_H, r.h), maxH)
  return {
    ...r,
    w,
    h,
    x: Math.min(Math.max(8, r.x), Math.max(8, window.innerWidth - w - 8)),
    y: Math.min(Math.max(8, r.y), Math.max(8, window.innerHeight - h - 8)),
  }
}

/** 从一颗圆按钮长成方窗口：起点的圆角与尺寸都由按钮自己决定 */
export function boxOfButton(el: HTMLElement): Box {
  const b = el.getBoundingClientRect()
  return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.width / 2 }
}

/**
 * 窗口级指针拖拽的装/拆（拖动浮窗、拖右下角改大小共用）。
 *
 * 三件事缺一不可：`setPointerCapture`（拖出窗口再松手时 up 仍会派发到元素）、
 * `pointerup` / `pointercancel`（正常收尾）、`blur`（拖动途中 Alt+Tab 切走）。
 * 只写前两条的话，那一次没人收到的 up 会把三个监听连同闭包永久留在 window 上，
 * 每漏一次多一份——用久了拖拽会越来越迟钝，而且只有重载才清得掉。
 */
export function bindWindowDrag(
  el: HTMLElement,
  pointerId: number,
  onMove: (ev: PointerEvent) => void,
  onEnd: () => void,
): void {
  try {
    el.setPointerCapture(pointerId)
  } catch {
    // 不支持捕获的环境：靠 blur 兜底
  }
  const end = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    window.removeEventListener('blur', end)
    try {
      el.releasePointerCapture(pointerId)
    } catch {
      // 元素已经卸载 / 早就释放了：无所谓
    }
    onEnd()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
  window.addEventListener('blur', end)
}
