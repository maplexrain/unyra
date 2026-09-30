/**
 * 「跟随最新消息 / 脱离自动滚动」的判据。
 *
 * 全是纯函数：这段逻辑靠肉眼是看不出对错的（阈值、时间窗、三种 deltaMode 的折算），
 * 抽出来就能在 Node 里直接测，见 scripts/agent-ops.test.ts。组件那边只负责把事件喂进来、
 * 按结果改状态。
 */

/**
 * 脱离的阈值：**短时间内**在列表里往上滚了多少像素。
 *
 * 为什么不按「离底部多远」判：模型每吐一个字内容就变高一点，只要它还在写，
 * 用户永远达不到阈值。按滚动量判才读得懂「他是想上去看」这个意图。
 * 取 140（滚轮一格约 100~120）：触控板的轻微抖动够不着，有意往上拨一下就够。
 */
export const DETACH_PX = 140

/** 累计窗口：超过这么久没有新的滚轮事件，之前攒的就不算数了 */
export const DETACH_WINDOW_MS = 420

/** 回到离底部这么近就算「已经看到最新」，重新跟随 */
export const REPIN_PX = 32

/** 滚轮事件之后多久之内，滚动位置的移动都算「滚轮造成的」 */
export const WHEEL_ATTRIBUTION_MS = 80

/** 滚轮累计器（组件里用 ref 持有） */
export interface WheelLatch {
  /** 上一次滚轮事件的时刻 */
  last: number
  /** 窗口内累计的「往上」像素 */
  up: number
}

/** 一次滚轮事件的形状（只取用得到的字段） */
export interface WheelLike {
  deltaY: number
  /** 0 像素 / 1 行 / 2 页 */
  deltaMode: number
}

/** 把滚轮增量折算成像素：行按 16px 估，页按一屏高估 */
export function wheelPixels(e: WheelLike, viewportHeight: number): number {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewportHeight : 1
  return e.deltaY * unit
}

/**
 * 累计一次滚轮事件，返回「是否该脱离跟随」。会就地更新 latch。
 *
 * 往下滚要把累计清零：那说明用户正往回走，不该攒着上一次的额度把他踢出去。
 */
export function shouldDetachByWheel(
  latch: WheelLatch,
  e: WheelLike,
  now: number,
  viewportHeight: number,
): boolean {
  if (now - latch.last > DETACH_WINDOW_MS) latch.up = 0
  latch.last = now
  const dy = wheelPixels(e, viewportHeight)
  if (dy > 0) {
    latch.up = 0
    return false
  }
  latch.up += -dy
  return latch.up >= DETACH_PX
}

/** 离底部的距离（负数按 0 处理：回弹时某些浏览器会给负值） */
export function bottomGap(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): number {
  return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight)
}

/** 是否已经回到最新（可以重新跟随） */
export function isAtBottom(gap: number): boolean {
  return gap <= REPIN_PX
}

/**
 * 这次滚动位置的变化，能不能算「用户主动往上走」。
 *
 * 自动滚动只会往下（贴住底部），所以往上走一定是用户干的：滚轮、拖滚动条、PageUp。
 * 但滚轮那一类要留给 shouldDetachByWheel 判（那里有累计门槛），
 * 刚发生过滚轮事件就不在这里重复判定，免得触控板的轻微抖动也被算成「想上去看」。
 */
export function isUserScrollUp(top: number, prevTop: number, sinceWheelMs: number): boolean {
  return top < prevTop - 2 && sinceWheelMs > WHEEL_ATTRIBUTION_MS
}
