/**
 * 用户「最近有没有在动」的全局记号：ask 的限时（一分钟没人理就超时）以它为准。
 *
 * 「任意操作」= 鼠标移动 / 点击 / 按键 / 滚轮——capture + passive 各挂一份，
 * 处理体只是记一个时间戳，开销可以忽略。模块级一份：任何 ask 都问同一个事实
 * 「用户刚才还在不在」，不需要每个挂表单的地方自己监听一遍。
 */

let lastActive = Date.now()
let listening = false

/** 懒挂监听：第一次有 ask 的时候才挂（纯前端页面滚不到这里也无妨） */
export function ensureActivityListeners(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  const mark = (): void => {
    lastActive = Date.now()
  }
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const) {
    window.addEventListener(type, mark, { passive: true, capture: true })
  }
}

/** 距离用户上一次操作过了多久（毫秒） */
export function userIdleMs(): number {
  return Date.now() - lastActive
}
