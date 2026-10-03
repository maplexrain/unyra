import type { WebviewTag } from 'electron'

/**
 * 存活 web 页签的元素登记表（tabId → <webview> 元素），模块级。
 *
 * browser.* 的宿主实现（learn/web/browserOps）要从这里拿元素做页面级操作，
 * 而元素由组件层的 WebPage 在 ref 回调里装卸——两边隔着组件层次，用模块级
 * 表传递（与 lib/outline 的 OutlineHandle、components/learn/web/addressFocus
 * 同款手法）。页签关掉时元素卸载、ref 回 null，表项随之摘掉。
 */
const els = new Map<string, WebviewTag>()

export function registerWebview(tabId: string, el: WebviewTag | null): void {
  if (el) els.set(tabId, el)
  else els.delete(tabId)
}

export function webviewOf(tabId: string): WebviewTag | undefined {
  return els.get(tabId)
}

/** 按 guest 的 WebContents id 找元素（web:guest-input 转发回来时只带 wcId） */
export function webviewByWcId(wcId: number): WebviewTag | undefined {
  for (const el of els.values()) {
    try {
      if (el.getWebContentsId?.() === wcId) return el
    } catch {
      // 元素已经 detached（页签刚关）：跳过，它不可能匹配
    }
  }
  return undefined
}
