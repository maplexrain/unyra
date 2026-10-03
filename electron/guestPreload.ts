/**
 * 网页 guest 的**最小**预载脚本（与主窗口的 preload.ts 完全两回事）：
 * 只做一件事——把鼠标指针事件原样上报主进程（web:guest-input），
 * 好让「网页里触发的事件」能冒泡到宿主：右键横划换页签那一类手势，
 * 原本靠文档区的 DOM 事件，网页页签把这些事件吃进了 guest 进程，手势就断了。
 *
 * 安全口径（见 electron/app/webSession 的 will-attach-webview）：node 关死、
 * contextIsolation 默认开——页面世界摸不到这个世界里的 ipcRenderer，
 * 页面能做的只是「正常用鼠标」，与我们想转发的东西一模一样。
 * 只认 mouse：触摸 / 笔在宿主侧没有消费方，白转发只会制造噪音。
 */
import { ipcRenderer } from 'electron'

const report = (type: string) => (raw: Event): void => {
  const e = raw as PointerEvent
  if (e.pointerType !== 'mouse') return
  ipcRenderer.send('web:guest-input', {
    type,
    button: e.button,
    buttons: e.buttons,
    x: e.clientX,
    y: e.clientY,
  })
}

for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
  window.addEventListener(type, report(type), { capture: true, passive: true })
}
