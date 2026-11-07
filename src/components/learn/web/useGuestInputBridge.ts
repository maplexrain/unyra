/**
 * guest 指针事件桥（拆自 WebTabLayer，敏感区）：
 * guest 里的鼠标指针事件（electron/guestPreload 上报，主进程按 wcId 转发回来）：
 * 在对应的 <webview> 元素上合成一枚可冒泡的 PointerEvent。合成事件不是 isTrusted
 * 的，但应用侧的手势（右键横划换页签那一类）全是普通监听，照常接得住——
 * 「网页里触发的事件冒泡到宿主」这条链的最后一段就在这里补上。
 */
import { useEffect } from 'react'
import { isElectron, native } from '../../../lib/native'
import { webviewByWcId } from '../../../learn/web/webviewRegistry'

export function useGuestInputBridge(): void {
  useEffect(() => {
    if (!isElectron()) return
    return native().browser.onGuestInput((p) => {
      const el = webviewByWcId(p.wcId)
      if (!el) return
      const r = el.getBoundingClientRect()
      el.dispatchEvent(
        new PointerEvent(p.type, {
          bubbles: true,
          cancelable: true,
          clientX: r.left + p.x,
          clientY: r.top + p.y,
          button: p.button,
          buttons: p.buttons,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        }),
      )
    })
  }, [])
}
