/**
 * 这个文件负责主进程的通用 IPC：代理白名单、窗口控制、原生打开/保存对话框、截图、开发者工具，
 * 以及导出 PDF 那两条通道。各分模块的 registerXxxIpc 都在这里被接上。
 *
 * 通道名与 preload 暴露的形状是一对（见 electron/preload.ts），改动前先看那边。
 */
import { app, BrowserWindow, dialog, ipcMain, nativeImage, session, shell } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { canOpenExternal } from '../link-core'
import { setLocale, t } from '../i18n'
import { registerPluginIpc } from '../plugins'
import { allowedHostList, setAllowedHosts } from '../proxy'
import { registerRunnerIpc } from '../runner'
import { closeBehavior, markLocalOwnWrite, registerStorageIpc, setCloseBehavior, setUiLocale, uiLocale } from '../storage'
import { registerUpdateIpc } from '../update'
import { registerVoiceIpc } from '../voice'
import { registerExamIpc } from './examWindow'
import { applyAppIcon } from './applyIcon'
import { rebuildAppMenu, logoSvgPath } from './icon'
import { rebuildTrayMenu, hideToTray, quitApp } from './tray'
import { pdfFooter, pdfPageSize, saveFilters } from './exportPdf'
import type { ExportPdfPayload } from './exportPdf'

/* ---------- IPC ---------- */

function focusedWindow(): BrowserWindow | null {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  return win && !win.isDestroyed() ? win : null
}

export function registerIpc(): void {
  // 渲染进程同步提供商名单，主进程据此收紧 llm-proxy 白名单
  ipcMain.handle('llm-proxy:setHosts', (_e, hosts: unknown) => {
    if (!Array.isArray(hosts)) return allowedHostList()
    setAllowedHosts(hosts as string[])
    return allowedHostList()
  })
  ipcMain.handle('llm-proxy:getHosts', () => allowedHostList())

  /**
   * 界面语言变化（`ui-locale`，见 preload 的 setUiLocale）。语言状态的拥有者是渲染层，
   * 这里跟着换（setLocale 让主进程侧的 t() 生效，再重建应用菜单与托盘菜单——
   * 两边都是幂等的，重复调用没有代价），并顺手落盘：语言跟机器走（global.yaml），
   * 下次启动渲染层直接来读，不必等这里再推一次。
   */
  ipcMain.on('ui-locale', (_e, l: 'zh' | 'en') => {
    setLocale(l)
    setUiLocale(l)
    rebuildAppMenu()
    rebuildTrayMenu()
  })
  // 启动时渲染层读一次存档（见 src/lib/uiLocale 的 loadUiLocale）
  ipcMain.handle('ui-locale:get', () => uiLocale())

  // 全局设置与本机文件读写（window.mojiNative.storage）
  registerStorageIpc()
  // 插件目录：列出 / 读源码 / 开关（window.mojiNative.plugins，见 electron/plugins.ts）
  registerPluginIpc()
  // 代码块伪编译：产物的持久化与运行时唯一的联网出口（见 electron/runner.ts）
  registerRunnerIpc()
  // 语音模型的下载与读取（见 electron/voice.ts）：渲染层够不着外网，这条通道由主进程走
  registerVoiceIpc()

  // 自动更新（window.mojiNative.update）
  registerUpdateIpc()

  // 考试窗口（第二个 BrowserWindow）：开窗、状态推送、事件转发（见「考试窗口」一节）
  registerExamIpc()

  ipcMain.handle('window:isMaximized', () => focusedWindow()?.isMaximized() ?? false)
  ipcMain.on('window:minimize', () => focusedWindow()?.minimize())
  ipcMain.on('window:toggleMaximize', () => {
    const win = focusedWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('window:close', () => focusedWindow()?.close())

  /**
   * 渲染层明确要求「用系统浏览器打开这个地址」。
   *
   * 与 hardenLinks 那三条是同一件事的两端：那边拦的是**意外**（点了个链接就把界面换掉），
   * 这边给的是**明确的意图**（组件自己知道这个地址该出去），省掉一次「先导航再被拦」。
   * 地址照样要先过 canOpenExternal：渲染层能被开发者工具改，这条边界不能只靠它自觉。
   */
  ipcMain.handle('shell:openExternal', (_e, url: unknown) => {
    if (typeof url !== 'string' || !canOpenExternal(url)) return false
    void shell.openExternal(url)
    return true
  })

  /**
   * 运行时图标换色（lib/appIcon）：主进程出 SVG 原文、收染色结果，
   * 染色画在渲染层画布上（主进程没有 DOM，nativeImage 也解不了 SVG）。
   */
  ipcMain.handle('app:logoSource', () => {
    try {
      return fs.readFileSync(logoSvgPath(), 'utf-8')
    } catch {
      return ''
    }
  })
  ipcMain.handle('app:setAppIcon', (_e, dataUrl: unknown) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) return false
    const image = nativeImage.createFromDataURL(dataUrl)
    if (image.isEmpty()) return false
    applyAppIcon(image)
    return true
  })

  /**
   * 渲染层对关窗询问的回答。
   * remember（对话框里勾了「不再询问」）为真时，把这次的选择直接存成策略，下次不再问。
   */
  ipcMain.handle('window:closeDecision', (_e, action: unknown, remember: unknown) => {
    if (remember === true && (action === 'close' || action === 'tray')) setCloseBehavior(action)
    if (action === 'tray') hideToTray()
    else if (action === 'close') quitApp()
    return { ok: true as const, behavior: closeBehavior() }
  })

  /** 设置面板里的「现在收进托盘」：与关窗策略无关，什么时候都能用 */
  ipcMain.on('window:hideToTray', () => hideToTray())

  /** 提示音（api.tiktok）：Electron 自带的 shell.beep，把用户的注意力请回来 */
  ipcMain.on('window:beep', () => {
    shell.beep()
  })

  /**
   * 文档区截图（api.ui.screenshot）：渲染层给一个相对窗口内容区的矩形，
   * capturePage 按它截（坐标是 DIP，与 getBoundingClientRect 的 CSS 像素同标度）。
   * 不传矩形就截整窗。返回 PNG 的 data URL，转存进资源库由渲染层负责。
   */
  ipcMain.handle('window:capture', async (_e, rect: unknown) => {
    const win = focusedWindow()
      if (!win || win.isDestroyed()) return { ok: false as const, error: t('没有可用的窗口') }
    try {
      const r = (rect ?? {}) as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
      const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
      const x = num(r.x)
      const y = num(r.y)
      const width = num(r.width)
      const height = num(r.height)
      const image =
        x !== undefined && y !== undefined && width !== undefined && height !== undefined && width > 0 && height > 0
          ? await win.webContents.capturePage({ x, y, width, height })
          : await win.webContents.capturePage()
      if (image.isEmpty()) return { ok: false as const, error: t('截出来是空的') }
      return { ok: true as const, dataUrl: image.toDataURL() }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : t('截图失败') }
    }
  })

  /**
   * 开发者工具（设置里的「开发者」分页）。
   *
   * 已经开着的话先关再开：独立的 devtools 窗口被别的窗口盖住之后，
   * 单纯 focus() 并不能可靠地把它提到最前；关掉重开则一定是新窗口、一定在最上层。
   * 关闭是异步的，因此要等 devtools-closed 再开——立刻 open 会被忽略。
   */
  ipcMain.on('window:devtools', () => {
    const win = focusedWindow()
    if (!win) return
    const wc = win.webContents
    const open = (): void => {
      if (win.isDestroyed()) return
      wc.openDevTools({ mode: 'detach', activate: true })
    }
    if (wc.isDevToolsOpened()) {
      wc.once('devtools-closed', open)
      wc.closeDevTools()
    } else {
      open()
    }
  })

  // 原生「保存文件」：渲染进程给出建议文件名与内容，落盘路径交给系统对话框
  ipcMain.handle(
    'file:saveText',
    async (
      _e,
      payload: { suggestedName?: string; content: string; title?: string; filters?: unknown },
    ) => {
      const win = focusedWindow()
      const suggestedName = String(payload?.suggestedName ?? 'unyra.json')
      const title = typeof payload?.title === 'string' && payload.title.trim() ? payload.title.trim() : t('导出')
      const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined!, {
        title,
        defaultPath: suggestedName,
        // 扩展名过滤由调用方给（导出文档要 md / html）；不给就还是 JSON，行为与从前一致
        filters: saveFilters(payload?.filters) ?? [
          { name: 'JSON', extensions: ['json'] },
          { name: t('全部文件'), extensions: ['*'] },
        ],
      })
      if (canceled || !filePath) return { ok: false as const, canceled: true as const }
      try {
        await fsp.writeFile(filePath, String(payload?.content ?? ''), 'utf-8')
        // 另存的目标可能恰好也在监听清单里（覆盖同名文件）：记一笔，watcher 别把它当外部改动
        markLocalOwnWrite(filePath)
        return { ok: true as const, path: filePath }
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : t('写入失败') }
      }
    },
  )

  /*
   * 导出 PDF：渲染进程给一份自带样式的 HTML，主进程在**隐藏窗口**里排一遍再打印成 PDF。
   *
   * 为什么不用渲染进程的 window.print()：那打的是整个应用界面（侧栏、对话栏、页签都在），
   * 而且要用户选打印机、拿到的是纸不是文件。printToPDF 是「一份 HTML 进、一个 PDF 缓冲区出」，
   * 可控得多，也不打扰用户。
   *
   * 三个细节都是踩出来的：
   * - HTML 先落临时文件再 loadFile：文件小则无所谓，但内嵌了图片的导出件轻松超过
   *   两兆，而 Chromium 对 data: URL 导航就卡在这个数上；
   * - 隐藏窗口用**独立 session**（moji-export，内存态、不落盘）：生产环境的 CSP 注入
   *   只挂在默认 session 上（见 installLocalFileCsp），导出件不必去受应用那份约束；
   * - 窗口不跑脚本（javascript: false）：导出件里本来就没有脚本，少一条通道少一份风险。
   *   注意 did-finish-load 与 printToPDF 与页面脚本无关，关掉它不影响出图。
   */
  ipcMain.handle('file:exportPdf', async (_e, payload: ExportPdfPayload) => {
    const html = typeof payload?.html === 'string' ? payload.html : ''
    if (!html) return { ok: false as const, error: t('没有可导出的内容') }
    const win = focusedWindow()
    const suggestedName = String(payload?.suggestedName ?? 'unyra.pdf')
    const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined!, {
      title: t('导出 PDF'),
      defaultPath: suggestedName,
      filters: [
        { name: t('PDF 文档'), extensions: ['pdf'] },
        { name: t('全部文件'), extensions: ['*'] },
      ],
    })
    if (canceled || !filePath) return { ok: false as const, canceled: true as const }

    const tmp = path.join(
      app.getPath('temp'),
      'moji-export-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.html',
    )
    let sheet: BrowserWindow | null = null
    try {
      await fsp.writeFile(tmp, html, 'utf-8')
      sheet = new BrowserWindow({
        show: false,
        webPreferences: {
          session: session.fromPartition('moji-export'),
          javascript: false,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      })
      await sheet.loadFile(tmp)
      // 图片是 data: URL，会跟着文档一起解析完；这里再等一拍，让字体度量与分页落定
      await new Promise((resolve) => setTimeout(resolve, 120))
      const data = await sheet.webContents.printToPDF({
        printBackground: true,
        pageSize: pdfPageSize(payload?.pageSize),
        landscape: payload?.landscape === true,
        margins: { top: 0.6, bottom: 0.62, left: 0.62, right: 0.62 },
        displayHeaderFooter: payload?.pageNumbers === true,
        headerTemplate: '<div></div>',
        footerTemplate: pdfFooter(),
      })
      await fsp.writeFile(filePath, data)
      return { ok: true as const, path: filePath, bytes: data.length }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : t('导出 PDF 失败') }
    } finally {
      if (sheet && !sheet.isDestroyed()) sheet.destroy()
      await fsp.unlink(tmp).catch(() => undefined)
    }
  })
}
