/**
 * 内置浏览器的会话与守门（网页页签，渲染层见 src/components/learn/web）。
 *
 * 网页页签用的是 <webview>：guest 是独立进程、默认全沙箱（无 node、无预载脚本），
 * 这里管它周围的三件事——
 * 1. 会话：persist:web 分区当「内置浏览器的 profile」，登录态跨页签、跨重启保留；
 *    UA 伪装成正常 Chrome（Electron 默认 UA 里的 Electron/… 会被 Google 登录这类站点直接拒掉）。
 * 2. 权限：定位、通知、摄像头一概拒绝；只放行剪贴板写入（网页的「复制」按钮）与网页全屏。
 * 3. 出口：guest 的 window.open / target=_blank / 中键新开，一律拦下来开成应用里的
 *    新 web 页签（渲染层 openWebTab 接住）；mailto 交给系统。应用级快捷键（Ctrl+Q/W/L）
 *    焦点在网页里时 DOM 层收不到，从 before-input-event 拦下来转发给主窗口。
 *
 * 下载不挂 will-download：Electron 默认弹系统「另存为」，够用。
 *
 * 本文件是**门面**：保留全部既有导出与装配入口（setupWebBrowser），机制拆在 ./webSession/ 下——
 * sessionPartition（persist:web 分区常量）/ sessionCdp（CDP 调试通道地基 + 采集环形缓冲）/
 * sessionSnapshot（页面快照与受控 DOM 操作）/ sessionLogs（日志四 api + waitFor/fastTranslate 入口）/
 * sessionTranslate（翻译分发器与极速翻译核心）/ sessionEvents（指针事件桥 / 新窗口 / 右键菜单 / 快捷键）。
 */
import { join } from 'node:path'
import { app, session } from 'electron'
import { WEB_PARTITION } from './webSession/sessionPartition'
import { startCapture } from './webSession/sessionCdp'
import { registerSnapshotIpc, snapshotRefs } from './webSession/sessionSnapshot'
import { registerLogIpc } from './webSession/sessionLogs'
import { attachGuestEventHandlers, registerGuestInputIpc } from './webSession/sessionEvents'

// 既有导出面保持不变：WEB_PARTITION 装配时本文件也要用；翻译两个导出只转发。
export { WEB_PARTITION }
export { getTranslationDispatcher, fastTranslateCore } from './webSession/sessionTranslate'

export function setupWebBrowser(): void {
  const ses = session.fromPartition(WEB_PARTITION)
  registerSnapshotIpc()
  registerGuestInputIpc()
  registerLogIpc()

  // 只摘掉 Electron/… 尾巴，版本号用真实 Chromium 的，其余照抄正常 Chrome 的桌面 UA
  ses.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' +
      process.versions.chrome +
      ' Safari/537.36',
  )

  const allowed = new Set(['clipboard-sanitized-write', 'fullscreen'])
  ses.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(allowed.has(permission))
  })
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))

  app.on('web-contents-created', (_e, contents) => {
    // 宿主（主窗口 / 考试窗口）：webview 挂上来之前收掉一切特权——纵深防御，
    // 就算渲染层被人改了属性，guest 也拿不到 node 与主窗口那份预载脚本
    if (contents.getType() === 'window') {
      contents.on('will-attach-webview', (_e2, webPreferences, params) => {
        // 预载换成我们自己的**最小脚本**（electron/guestPreload：只上报指针事件，
        // 好让网页里的事件能冒泡到宿主）。node 照旧关死，contextIsolation 默认开着，
        // 页面世界摸不到预载世界里的 ipcRenderer。
        webPreferences.preload = join(__dirname, 'guestPreload.cjs')
        webPreferences.nodeIntegration = false
        if (params.partition !== WEB_PARTITION) params.partition = WEB_PARTITION
      })
      return
    }
    if (contents.getType() !== 'webview') return

    // 页签一挂上就开日志采集（Runtime/Log/Network → 环形缓冲），页签销毁时随台账一起清
    startCapture(contents)

    // 页签销毁：ref 台账随手摘掉（台账按 wcId 记，留着也是幽灵键）
    contents.once('destroyed', () => snapshotRefs.delete(contents.id))

    // 新窗口拦截 / 右键菜单 / 快捷键转发：webview 的事件面（sessionEvents）
    attachGuestEventHandlers(contents)
  })
}
