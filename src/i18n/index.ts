/**
 * 这个文件负责什么：界面语言（zh / en）与文案函数 t()。
 *
 * 方案是「**中文原文即键**」：源码里写的中文就是键。zh 档下 t() 原样返回——
 * 零查询、零字典，现有界面一个字都不用动；en 档查 en 字典，查不到也原样返回。
 * 「查不到原样返回」是刻意设计：用户数据（节点名、工作流登记名、AI 写的内容）
 * 从显示层经过 t() 时天然透传，「界面文案」与「数据」因此不需要在类型上区分，
 * 显示层可以放心把任何字符串包进 t()。
 *
 * 插值用 {0} {1} 数字占位（`已保存到 {0}` + 参数按顺序填入），不用命名占位——
 * 调用点都是模板字符串改过来的， positional 最省事也最不容易写错。
 *
 * 语言状态是模块级的（与 lib/appearance 同一套路）：appearance 负责存用户的
 * 选择并在启动 / 切换用户时调 setLocale()（见 lib/appearance 的 refreshAppearance）；
 * 组件用 useLocale() 订阅（只有 App 根部与两个 memo 组件需要显式订阅，
 * 其余组件跟随父级重渲染）。界面语言属于「看起来是什么样」，所以住在 appearance 里。
 */
import { en } from './en'

/** 界面语言。'zh' 是源文案（中文即键，无字典查询），'en' 查表 */
export type Locale = 'zh' | 'en'

export const LOCALES: Locale[] = ['zh', 'en']

/** 语言选择器上显示的名字：各语言用自己的文字写自己的名字，不互相翻译 */
export const LOCALE_LABEL: Record<Locale, string> = { zh: '中文', en: 'English' }

let current: Locale = 'zh'
const listeners = new Set<() => void>()

/** 没有存过偏好时按系统语言猜：英文系统给英文，其余（含中文）一律中文 */
export function defaultLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh'
  return /^en\b/i.test(navigator.language || '') ? 'en' : 'zh'
}

export function getLocale(): Locale {
  return current
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * 主进程桥（见 electron/i18n）：菜单与原生对话框说不了 React 的语言，
 * 渲染层把语言变化推过去（App 挂载时经 setLocaleBridge 接上）。桥断了就断：
 * 换语言不该因为主进程没应答而失败。
 */
let bridge: ((l: Locale) => void) | null = null

export function setLocaleBridge(fn: ((l: Locale) => void) | null): void {
  bridge = fn
}

export function setLocale(l: Locale): void {
  if (l === current) return
  current = l
  if (typeof document !== 'undefined') document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'
  try {
    bridge?.(l)
  } catch {
    // 桥断了不该连累界面换语言
  }
  for (const fn of [...listeners]) fn()
}

/**
 * 文案函数：中文原文即键。
 *
 * 只能在函数体 / 渲染体 / 事件处理器里调用——模块顶层常量在 import 时求值一次，
 * 语言之后切换也不会再算，会把旧语言冻结进去。模块顶层的中文常量保留中文原文，
 * 在使用处再包 t()。
 */
export function t(s: string, ...params: Array<string | number>): string {
  const raw = current === 'zh' ? s : (en[s] ?? s)
  if (params.length === 0) return raw
  return raw.replace(/\{(\d+)\}/g, (m, i: string) => {
    const v = params[Number(i)]
    return v === undefined ? m : String(v)
  })
}

/** 组件里订阅界面语言用（见 useLocale.ts）；从本模块统一转出，接入方只记一个 import 点 */
export { useLocale } from './useLocale'
