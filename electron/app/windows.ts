/**
 * 这个文件负责窗口本身：主窗口的创建与页面加载、渲染层启动打点的回收、console 转发、
 * 外链拦截，以及「主窗口是哪一个」这两个查询。
 *
 * 考试窗口（第二个 BrowserWindow）不在这里，见 examWindow.ts。
 */
import { app, BrowserWindow, desktopCapturer, session, shell, type WebContents } from 'electron'
import path from 'node:path'
import { canOpenExternal, linkAction } from '../link-core'
import { startupBackground } from '../storage'
import { DEV_SERVER_URL, flushStartupTrace, isDev, lap, setRendererMarks, startupTraced } from './startup'
import { attachWindowStatePersistence, loadWindowState } from './windowState'
import { appIcon } from './icon'
import { attachCloseGuard } from './tray'

/* ---------- 窗口 ---------- */

/**
 * 系统音频可视化（顶栏的波浪，src/components/learn/SystemAudioWave.tsx）用的
 * display-media 通道：渲染层 getDisplayMedia 要「屏幕 + 声音」时，画面给主显示器、
 * 声音给「系统回环」（Windows 的 WASAPI loopback）——渲染层到手就停掉视频轨，
 * 实际只消费声音。不弹系统选择器：这条请求只服务于波形，固定给主屏即可。
 *
 * 严格专注的屏幕监控（守卫 agent，见 agent/guardRuntime）走的是同一条通道：
 * 它只要画面（audioRequested 为 false），就不硬塞回环音轨——多余一路音频会话
 * 纯属浪费，还可能让系统的「正在共享」提示多挂一份。
 */
function attachLoopbackAudio(): void {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    void desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) =>
        callback({
          video: sources[0],
          ...(request.audioRequested ? { audio: 'loopback' as const } : {}),
        }),
      )
  })
}

export async function createWindow(): Promise<void> {
  const state = await loadWindowState()

  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 960,
    minHeight: 640,
    // 开窗第一帧之前就生效的底色：按已存主题给色，深色系（尤其纯黑）启动不再白闪
    backgroundColor: startupBackground(),
    title: '归一 Unyra',
    // 窗口图标：任务栏与 Alt+Tab 里显示的就是它。无边框窗口没有系统标题栏，
    // 这是壳上唯一一处 logo；不设的话显示的是 Electron 默认那个原子图标
    icon: appIcon(),
    show: false,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // 内置浏览器的网页页签（<webview>，见 app/webSession 与 src/components/learn/web）：
      // 只有宿主需要这个开关；guest 是独立进程，默认全沙箱
      webviewTag: true,
    },
  })

  lap('main:window')

  if (state.isMaximized) win.maximize()

  // 先隐藏、ready-to-show 再显示：避免白屏一闪
  win.once('ready-to-show', () => {
    lap('main:ready-to-show')
    win.show()
    lap('main:shown')
    captureRendererStartup(win)
  })

  attachWindowStatePersistence(win)
  attachCloseGuard(win)
  /** 把最大化状态推给渲染层，让自绘标题栏的图标跟着变 */
  const pushMaximized = (): void => {
    if (!win.isDestroyed()) win.webContents.send('window:maximizeChange', win.isMaximized())
  }
  win.on('maximize', pushMaximized)
  win.on('unmaximize', pushMaximized)
  win.on('enter-full-screen', pushMaximized)
  win.on('leave-full-screen', pushMaximized)

  // 外链一律交给系统浏览器：不开新窗口、也不让当前窗口被网页顶掉（见 hardenLinks）
  hardenLinks(win.webContents)

  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] render-process-gone:', details.reason)
  })

  attachConsoleForwarding(win)

  // 回环音频的 display-media 通道必须在页面加载前就位（渲染层一开波浪就会要）
  attachLoopbackAudio()

  if (DEV_SERVER_URL) {
    await win.loadURL(DEV_SERVER_URL)
  } else {
    await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
  lap('main:loadFile')

  /**
   * 自动打开开发者工具。
   *
   * 平时不弹（每次启动多一个窗口确实挡事，设置里的「开发者」分页随时能开）；
   * 但现在要查白屏，所以：**dev 运行一律自动打开**，打包运行时用
   * `MOJI_DEVTOOLS=1` 显式打开（PowerShell: `$env:MOJI_DEVTOOLS='1'; npm start`）。
   * 查完把下面这一段删掉即可恢复原状。
   */
  if (isDev || process.env.MOJI_DEVTOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' })
  }
}

/**
 * 把渲染层的启动打点取回来，连同主进程的读数一起落盘（只在 MOJI_STARTUP_TRACE 下动作）。
 *
 * 为什么要等一会儿再取：渲染层那两个「首帧画完了」的点是靠两层 rAF 记的，
 * 而 ready-to-show 只说明第一帧背景已经出来，React 那一帧可能还在路上。
 */
function captureRendererStartup(win: BrowserWindow): void {
  if (!startupTraced()) return
  setTimeout(() => {
    void (async () => {
      try {
        const raw = (await win.webContents.executeJavaScript(
          'globalThis.__mojiStartup ? JSON.stringify(globalThis.__mojiStartup()) : null',
        )) as string | null
        if (raw) setRendererMarks(JSON.parse(raw))
      } catch (err) {
        console.error('[startup] 渲染层打点没取到：', err)
      }
      lap('main:trace-end')
      flushStartupTrace()
      if (process.env.MOJI_STARTUP_TRACE_EXIT === '1') app.quit()
    })()
  }, 1500)
}

/**
 * 渲染进程的 console 转发到主进程终端。
 *
 * 白屏这类故障往往发生在页面脚本的最早期：整个模块图没能求值完（比如循环依赖的 TDZ）、
 * 或者首屏 render 就抛了。那种时候「等 DevTools 打开再看」经常已经错过，
 * 转一份到终端，启动瞬间就能看到。卫星窗口（学习状态 / 试卷 / 设置）同样挂着它——
 * 那几个窗口平时不开 DevTools，出问题只能靠这一条。
 *
 * 注意签名：这一版 Electron 的**类型声明**是 (event, details)，但**运行时**仍按老签名
 * 发位置参数（event, level, message, line, sourceId）。按类型写就拿不到那几个值，
 * 所以这里显式按运行时形状收参数。
 */
export function attachConsoleForwarding(win: BrowserWindow): void {
  type ConsoleListener = (
    event: unknown,
    level?: number,
    message?: string,
    line?: number,
    sourceId?: string,
  ) => void
  const onConsole: ConsoleListener = (_event, level, message, line, sourceId) => {
    const text = message ?? ''
    if (!text) return
    const where = sourceId ? ' (' + String(sourceId).split('/').pop() + ':' + (line ?? 0) + ')' : ''
    if (level === 3) console.error('[renderer] ' + text + where)
    else if (level === 2) console.warn('[renderer] ' + text + where)
    else console.log('[renderer] ' + text + where)
  }
  ;(win.webContents as unknown as { on(e: 'console-message', l: ConsoleListener): void }).on(
    'console-message',
    onConsole,
  )
}

/* ---------- 外链拦截 ---------- */

/**
 * 外链的拦截（判定见 electron/link-core，用例在 tests/linkNav.test.ts）。
 *
 * 三件事一起做，缺一条都会漏：
 * 1. **target=_blank**：应用内不开新窗口，交给系统浏览器（markdown 里的链接没有 target，
 *    所以这一条只覆盖得到文档里手写的 <a target="_blank">）；
 * 2. **主框架导航**：没有 target 的链接点下去走的就是这里——不拦的话整个应用界面会被
 *    那个网页顶掉（用户报的「外链在应用内打开了」正是这一条）；
 * 3. **子框架导航**：超级文档是 iframe，里面点链接不会触发第 2 条，不拦就只在那一小块
 *    里把页面换掉了——同样是「在应用内打开」。
 *
 * 只读外链、不问用户：这是「点了链接」这个动作的默认含义，没有需要商量的地方。
 */
export function hardenLinks(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (canOpenExternal(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const handle = (event: { preventDefault: () => void }, frameUrl: string, target: string): void => {
    const action = linkAction(frameUrl, target)
    if (action === 'allow') return
    event.preventDefault()
    if (action === 'open' && canOpenExternal(target)) void shell.openExternal(target)
  }
  contents.on('will-navigate', (event, url) => handle(event, contents.getURL(), url))
  contents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return
    handle(event, event.frame?.url ?? contents.getURL(), event.url)
  })
}

/* 主窗口是哪一个、怎么把它叫到前面来，住在 ./mainWindow：
   托盘那边要用它们，而这里要用托盘那边的 attachCloseGuard，放在这儿会与托盘成环。
   从本文件仍然取得到这两个名字（下面转出）。 */
export { mainWindow, showMainWindow } from './mainWindow'
