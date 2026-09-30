/**
 * 这个文件负责什么：主进程侧的界面语言（zh / en）与文案函数 t()。
 *
 * 与渲染层（src/i18n）是同一个方案——「**中文原文即键**」：源码里写的中文就是键，
 * zh 档下 t() 原样返回（零查询、零字典，现有文案一个字都不用动），en 档查
 * electron/i18n-strings 的字典，查不到也原样返回。插值同样用 {0} {1} 数字占位，
 * 逻辑与渲染层一字不差——两边唯一的区别是这里不碰 document / navigator：
 * 主进程说不了 React 的语言，语言变化由渲染层经 preload 的 setUiLocale 推过来
 * （`ui-locale` 频道，处理器在 app/ipc.ts，收到后 setLocale() 并重建应用菜单）。
 *
 * 默认语言用 Electron 的 app.getLocale() 猜：英文系统给英文，其余（含中文）一律中文。
 * 打包版在 app ready 之前 getLocale() 不保证可靠，所以默认值**惰性**求——第一次
 * getLocale() 时才探测；而 t() 的调用点（建菜单、弹对话框）都在 ready 之后。
 */
import { app } from 'electron'
import dict from './i18n-strings'

/** 界面语言。'zh' 是源文案（中文即键，无字典查询），'en' 查表 */
export type Locale = 'zh' | 'en'

let current: Locale | null = null
const listeners = new Set<() => void>()

/** 没收到渲染层的偏好前按系统语言猜：/^en/ 开头（en-US、en-GB…）给英文，其余中文 */
function detectLocale(): Locale {
  try {
    return /^en/.test(app.getLocale()) ? 'en' : 'zh'
  } catch {
    // 探测不出来（极端时机）：按中文兜底，与源文案一致，总不会更糟
    return 'zh'
  }
}

export function getLocale(): Locale {
  if (current === null) current = detectLocale()
  return current
}

export function setLocale(l: Locale): void {
  const next: Locale = l === 'en' ? 'en' : 'zh'
  if (next === getLocale()) return
  current = next
  for (const fn of [...listeners]) fn()
}

/** 订阅语言变化（主进程里暂时没有订阅方，留着与渲染层同一套接口） */
export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * 文案函数：中文原文即键。与渲染层的 t() 同一套逻辑：
 * zh 档原样返回，en 档查表（查不到透传——用户数据从显示层经过时天然透传），
 * 参数按顺序填进 {0} {1} 占位。
 */
export function t(s: string, ...params: Array<string | number>): string {
  const raw = getLocale() === 'zh' ? s : (dict[s] ?? s)
  if (params.length === 0) return raw
  return raw.replace(/\{(\d+)\}/g, (m, i: string) => {
    const v = params[Number(i)]
    return v === undefined ? m : String(v)
  })
}
