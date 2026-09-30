/**
 * 「先别量」的门：拖动两栏分割线这类**连续改布局**的操作，每一帧都在改尺寸，
 * 平时挂在容器上的 ResizeObserver 会一帧被叫醒一次，每次都跟着一趟全页测量——
 * 拖动期间那些测量量到的是中间帧，量了也白量。把门挂上，它们先跳过；
 * 松手放下门时门会通知一声，收尾的那次测量照常补上（尺寸恰好不再变化、
 * RO 不会再响的那条路也覆盖到了）。
 */

type Listener = () => void

let held = false
const listeners = new Set<Listener>()

/** 挂门：之后的测量请求应当跳过（几何每帧都在变，量了也白量） */
export function holdLayout(): void {
  held = true
}

/** 放门：挂门期间被拦下的测量靠它补跑。重复放是空操作 */
export function releaseLayout(): void {
  if (!held) return
  held = false
  for (const fn of listeners) fn()
}

/** 此刻门挂着吗（测量方据此早退） */
export function layoutHeld(): boolean {
  return held
}

/** 订阅「门放下」这一刻：拖动结束时补一次收尾测量。返回退订函数 */
export function onLayoutRelease(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
