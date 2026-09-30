/**
 * 界面语言（全局设置）：渲染层这一侧的入口。
 *
 * 语言跟机器走，不跟用户走——存 appdata 的 global.yaml，与关窗行为同一套范式
 * （见 electron/storage/settings）。语言状态的拥有者仍是渲染层的 i18n 模块：
 * 每次语言变化经 App 挂的桥（setUiLocale）推给主进程，那边换自己的 t()、
 * 重建菜单并写进 global.yaml；这里只负责启动时读一次存档，
 * 以及给设置界面与登录页一个不牵扯外观设置的改名入口。
 */
import { setLocale, type Locale } from '../i18n'

export type { Locale }

/** 启动时读一次全局语言并应用；读不到（非 Electron、新装）就保持 i18n 按系统语言的猜测 */
export async function loadUiLocale(): Promise<void> {
  try {
    const api = (window as unknown as { mojiNative?: { getUiLocale?: () => Promise<'zh' | 'en'> } }).mojiNative
    const l = await api?.getUiLocale?.()
    if (l === 'zh' || l === 'en') setLocale(l)
  } catch {
    // 读不到就按系统语言猜：这不是值得打断启动的错误
  }
}

/** 切换界面语言：本地立即生效；落盘与主进程的菜单重建由 App 挂的桥顺路完成 */
export function changeUiLocale(l: Locale): void {
  setLocale(l)
}
