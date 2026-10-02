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
 */
import { app, session, shell } from 'electron'
import { canOpenExternal } from '../link-core'
import { mainWindow } from './mainWindow'

/**
 * 内置浏览器的分区。渲染层 <webview partition> 与这里是**同一个字符串**（两处必须一致，
 * 各写一份、注释互指）：强制走独立分区，guest 永远摸不到应用自己的 Cookie。
 */
export const WEB_PARTITION = 'persist:web'

/** 焦点在网页里也要能用的应用快捷键：q = 聚焦导师，w = 关页签，l = 新建网页页签 */
const FORWARD_KEYS = new Set(['q', 'w', 'l'])

export function setupWebBrowser(): void {
  const ses = session.fromPartition(WEB_PARTITION)

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
    // 就算渲染层被人改了属性，guest 也拿不到 node 与我们的预载脚本
    if (contents.getType() === 'window') {
      contents.on('will-attach-webview', (_e2, webPreferences, params) => {
        delete webPreferences.preload
        webPreferences.nodeIntegration = false
        if (params.partition !== WEB_PARTITION) params.partition = WEB_PARTITION
      })
      return
    }
    if (contents.getType() !== 'webview') return

    // 网页想开新窗口：一律不开原生窗——http(s) 落成应用里的新 web 页签，mailto 给系统，
    // 其余（data:、blob:…）直接拒
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('mailto:')) void shell.openExternal(url)
      else if (canOpenExternal(url)) mainWindow()?.webContents.send('web:openTab', url)
      return { action: 'deny' }
    })

    contents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return
      if (!(input.control || input.meta) || input.alt || input.shift) return
      const key = input.key.toLowerCase()
      if (!FORWARD_KEYS.has(key)) return
      e.preventDefault()
      mainWindow()?.webContents.send('web:shortcut', key)
    })
  })
}
