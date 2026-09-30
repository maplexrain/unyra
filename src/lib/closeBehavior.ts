/**
 * 关窗行为（全局设置）：渲染层这一侧的入口。
 *
 * 策略本身由主进程持有（appdata 里的 global.yaml，见 electron/storage.ts）——
 * 真正拦下关窗的是主进程，渲染层再存一份迟早会不一致。这里做三件事：
 * 1. 缓存一份，界面要显示当前策略时同步读得到（不必每次 await）；
 * 2. 改动与「弹窗里记住的选择」都回写主进程，并通知订阅者；
 * 3. 把关窗询问、托盘操作包成几个函数，供 App 与设置面板调用。
 */

import { isElectron, native } from './native'
import type { CloseAction, CloseBehavior } from './native'

export type { CloseAction, CloseBehavior }

export const CLOSE_BEHAVIOR_LABEL: Record<CloseBehavior, string> = {
  ask: '每次询问',
  close: '直接关闭',
  tray: '最小化到托盘',
}

export const CLOSE_BEHAVIOR_HINT: Record<CloseBehavior, string> = {
  ask: '点关闭时弹一个对话框，当场选「直接关闭」还是「最小化到托盘」；对话框里可以勾选「不再询问」。',
  close: '点关闭就直接退出程序。',
  tray: '点关闭不退出：窗口收进托盘，程序留在后台继续跑，点托盘图标就能重新打开。',
}

/** 顺序即界面上的排列顺序 */
export const CLOSE_BEHAVIORS: readonly CloseBehavior[] = ['ask', 'close', 'tray']

/** 默认「询问」：与主进程的默认值一致，不替用户预设 */
let cached: CloseBehavior = 'ask'
const listeners = new Set<(value: CloseBehavior) => void>()

export const closeBehavior = (): CloseBehavior => cached

function publish(value: CloseBehavior): void {
  cached = value
  for (const cb of listeners) cb(value)
}

/** 订阅策略变化（比如刚在关窗弹窗里勾了「不再询问」）；返回取消订阅函数 */
export function onCloseBehaviorChange(cb: (value: CloseBehavior) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** 从主进程读一次当前策略（打开设置面板时用） */
export async function loadCloseBehavior(): Promise<CloseBehavior> {
  if (!isElectron()) return cached
  try {
    publish(await native().shell.getCloseBehavior())
  } catch {
    // 读不到就沿用缓存里的值：这不是值得打断界面的错误
  }
  return cached
}

/** 改策略：以主进程存盘后返回的值为准 */
export async function setCloseBehavior(value: CloseBehavior): Promise<CloseBehavior> {
  if (!isElectron()) return cached
  try {
    publish(await native().shell.setCloseBehavior(value))
  } catch {
    // 存不下来就保持原值，界面不会显示一个其实没生效的选项
  }
  return cached
}

/** 回答关窗询问；remember 为真时把这次的选择存成策略，下次不再问 */
export async function decideClose(action: CloseAction, remember: boolean): Promise<void> {
  if (!isElectron()) return
  try {
    publish((await native().shell.decideClose(action, remember)).behavior)
  } catch {
    // 主进程已经在退出：没什么可做的
  }
}

/** 立刻收进托盘（设置面板里的按钮） */
export function hideToTray(): void {
  if (!isElectron()) return
  native().shell.hideToTray()
}

/** 订阅主进程的关窗询问（策略为「询问」时才会来）；返回取消订阅函数 */
export function onCloseRequested(cb: () => void): () => void {
  if (!isElectron()) return () => {}
  return native().shell.onCloseRequested(cb)
}
