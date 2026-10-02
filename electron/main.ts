/**
 * Electron 主进程。
 *
 * 职责：
 * 1. 建窗口（尺寸/位置记忆）与生命周期；
 * 2. 承载 `llm-proxy://` 协议：渲染进程的全部 AI 请求都从这里转发出去，
 *    从而绕开浏览器的 CORS 与「禁止改写的请求头」两道限制（见 proxy.ts）；
 * 3. 提供渲染进程够不到的 native 能力：原生打开/保存文件对话框；
 * 4. 数据落盘：全局设置与用户数据目录的读写（见 storage.ts）；
 * 5. 自动更新：从公开的发布仓库取新版本并在后台下载（见 update.ts）；
 * 6. 外壳行为：窗口图标、托盘，以及按「关窗行为」决定点关闭时做什么。
 *
 * 渲染进程以 contextIsolation + sandbox 运行，只能通过 preload 暴露的
 * window.mojiNative 访问上述能力（见 preload.ts）。
 *
 * 实现按职责拆在 electron/app/ 下，这一份只剩 main() 与装配（下面的顺序即启动顺序）：
 *   startup.ts     开发服务器地址、启动打点、单实例闸门
 *   windowState.ts 窗口尺寸/位置的记忆
 *   windows.ts     主窗口与页面加载、渲染层打点回收、console 转发、外链拦截
 *   examWindow.ts  考试窗口（第二个 BrowserWindow）
 *   tray.ts        托盘、收进托盘、退出、关窗拦截
 *   icon.ts        应用图标与应用菜单
 *   ipc.ts         通用 IPC 注册
 *   exportPdf.ts   导出 PDF 的零件与生产环境的 CSP 注入
 */

import { app, BrowserWindow, protocol } from 'electron'
import { existsSync, renameSync } from 'node:fs'
import path from 'node:path'
import { registerProxyProtocol } from './proxy'
import { startUpdateChecks } from './update'
import { registerWebIpc } from './web'
import { bootSingleInstance, initStartupTrace, lap } from './app/startup'
import { createWindow, showMainWindow } from './app/windows'
import { setupWebBrowser } from './app/webSession'
import { closeExamWindow } from './app/examWindow'
import { createTray, markQuitting } from './app/tray'
import { installAppMenu } from './app/icon'
import { registerIpc } from './app/ipc'
import { installLocalFileCsp } from './app/exportPdf'

/* ---------- 启动追踪 ---------- */

/**
 * 这一行以上的时间（Electron 引导 + 本文件解析求值，含全部 import）不属于任何一段代码，
 * 只能整体看：它由 main:eval 这一笔间接反映出来。没开 MOJI_STARTUP_TRACE 时它什么都不做。
 */
initStartupTrace()

/* ---------- 单实例 ---------- */

// 闸门与「为什么必须挡」的说明见 app/startup.ts
bootSingleInstance(main)

function main(): void {
  // 全局兜底：未捕获异常只记日志，不静默崩掉整个应用
  process.on('uncaughtException', (err) => console.error('[main] uncaughtException:', err))
  process.on('unhandledRejection', (reason) => console.error('[main] unhandledRejection:', reason))

  // 特权协议声明必须在 app ready 之前。
  // corsEnabled + supportFetchAPI + stream 三件套缺一不可：
  // 没有 corsEnabled，渲染进程的 fetch 仍会按同源策略拦下这个协议。
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'llm-proxy',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ])

  registerIpc()
  // 抓网页：只有 web:fetch 一个频道（见 electron/web）。放这里是因为它与其余 IPC 一样，
  // 必须在 app ready 之前就把 handler 挂上——渲染层可能很早就来问
  registerWebIpc()
  lap('main:ipc')

  /*
   * 用户数据目录**钉死**在 %APPDATA%\unyra。
   *
   * 为什么不能靠默认值：默认值是 app.getName()，而它取的是「打包时写进 app 的
   * package.json 里的 productName（有就用它）或 name」。改一次显示名就可能让这个值
   * 跟着变，于是老用户的教学文档、对话、资源全部「不见了」——文件还在磁盘上，
   * 只是程序换了个目录去找。把它写死，改名这件事就再也碰不到数据。
   *
   * 从 moji-notes 升上来的老安装：第一次启动把整份目录搬过来（同盘改名，瞬间完成；
   * global.yaml、会话、全部用户数据、语音模型都在里面，一次搬家全部生效）。
   * 新旧目录同时存在（比如搬过之后又跑了一次旧版）时以新目录为准，不做合并。
   * 搬不动（目录被占用之类）就退回老目录继续用——宁可路径旧一点，不能让数据看起来丢了。
   *
   * 留 --user-data-dir 这条口子：scripts/startup-trace.mjs 用它把数据写到临时目录，
   * 免得测一次启动就把真实用户数据翻一遍（那条命令行的优先级高于这里的默认值）。
   */
  if (!app.commandLine.hasSwitch('user-data-dir')) {
    const appData = app.getPath('appData')
    const next = path.join(appData, 'unyra')
    const legacy = path.join(appData, 'moji-notes')
    if (existsSync(next) || !existsSync(legacy)) {
      app.setPath('userData', next)
    } else {
      try {
        renameSync(legacy, next)
        app.setPath('userData', next)
      } catch {
        app.setPath('userData', legacy)
      }
    }
  }

  // Windows 的任务栏、通知与固定项都按 AppUserModelID 归组；不设这一条，
  // 它们会挂到「Electron」名下，图标也跟着变成 Electron 的
  app.setAppUserModelId('com.moji.guiyi')

  app.whenReady().then(() => {
    lap('main:ready')
    registerProxyProtocol()
    installLocalFileCsp()
    installAppMenu()
    // 内置浏览器的会话与守门（网页页签）：分区、UA 伪装、权限、弹窗与快捷键转发
    setupWebBrowser()
    /*
     * 先开窗再建托盘（两者都不 await）。
     *
     * 托盘那一步要读图、缩图、建原生图标，实测 13~15 ms，卡在开窗之前就是白白多等这么久；
     * 换到窗口后面，它和页面加载重叠，用户不可能察觉——窗口收进托盘之前，谁也碰不到托盘。
     * 图标染色不受影响：那是渲染层首帧之后才回来的事（见 lib/appIcon），远晚于这里。
     */
    createWindow()
    createTray()
    lap('main:tray')
    /*
     * 更新检查排在最后，而且它自己还会再等几秒（见 update.ts）：
     * 首屏与数据载入都该先跑完。整条链路是异步的，
     * 失败了也只在状态里留一条记录——不弹窗、不阻塞、不影响当前版本。
     */
    startUpdateChecks()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  // 真的在退出（托盘菜单、系统关机、或策略就是「直接关闭」）：
  // 放开关窗拦截，否则窗口会被自己拦下来，程序退不掉
  app.on('before-quit', () => {
    markQuitting()
    // 考试窗口那层「关窗前问一次」的拦截对退出流程也必须放行：不放的话它会拦住自己，
    // 进程被一个孤儿窗口吊着不退（用户在主窗口里已经点了退出，却什么都没发生）
    closeExamWindow('quit')
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  // 又点了一次图标：把窗口找回来（它可能正收在托盘里，光 focus 是叫不出来的）
  app.on('second-instance', () => showMainWindow())
}