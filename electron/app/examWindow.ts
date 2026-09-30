/**
 * 这个文件负责考试窗口（第二个 BrowserWindow）的全部：开窗、状态转发、关窗拦截与它的 IPC。
 *
 * 四个模块级状态（examWindow / examAllowClose / examCloseReason / examInitialState）刻意与
 * 读写它们的函数待在同一份里：它们是单例语义，拆到两个模块就成了两份。
 */
import { BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { t } from '../i18n'
import { startupBackground } from '../storage'
import { DEV_SERVER_URL } from './startup'
import { appIcon } from './icon'
import { attachConsoleForwarding, hardenLinks } from './windows'

/* ---------- 考试窗口 ---------- */

/** 考试窗口关掉的原因：主窗口据此决定收尾的分寸（要不要保住那一轮作答） */
export type ExamCloseReason = 'host' | 'quit' | 'closed'

/**
 * 考试窗口：与主窗口**同一份渲染产物**的第二个 BrowserWindow，靠查询参数
 * `?examWindow=1` 分支（渲染层自己认这个参数，主进程不管它渲染成什么）。
 *
 * 这一节只做三件事——开窗、转发、关窗，**不解释考试数据**：载荷一律 unknown 原样中转。
 * 数据所有权也是刻意的：主窗口是唯一写盘方，考试窗口只发事件、收状态。
 * 「谁是权威」不靠约定靠结构——两个窗口各写一半才是真会丢数据的那种设计。
 */
let examWindow: BrowserWindow | null = null
/** 这一轮关闭是否已经放行（确认放弃 / 已交卷 / 主窗口要求 / 应用退出） */
let examAllowClose = false
/** 窗口真的关掉时该报给主窗口的原因 */
let examCloseReason: ExamCloseReason = 'closed'
/** 开窗时主窗口递来的那份状态：页面加载完补发一次（不保证送达，见 openExamWindow） */
let examInitialState: unknown

/**
 * 主窗口：考试窗口之外的那一个。
 *
 * 不能沿用下面 mainWindow() 的「取第一个」：考试窗口也是窗口，主窗口一旦先关掉，
 * `getAllWindows()[0]` 就成了考试窗口，事件会被发回它自己（表现是主窗口永远收不到
 * 「考试窗口关了」，状态一直挂在「考试中」）。
 */
function hostWindow(): BrowserWindow | null {
  const win = BrowserWindow.getAllWindows().find((w) => w !== examWindow && !w.isDestroyed())
  return win ?? null
}

/** 发给主窗口。主窗口已经不在了就静默丢掉——此刻考试窗口是孤儿，等它自己关掉 */
function sendToHost(channel: string, payload: unknown): void {
  const win = hostWindow()
  if (!win || win.webContents.isDestroyed()) return
  win.webContents.send(channel, payload)
}

/** 发给考试窗口。没开、或正在销毁就丢掉（关窗过程中消息还可能在路上） */
function sendToExam(channel: string, payload?: unknown): void {
  if (!examWindow || examWindow.isDestroyed()) return
  if (examWindow.webContents.isDestroyed()) return
  examWindow.webContents.send(channel, payload)
}

/**
 * 开考试窗口。已经开着就把那一个叫到前面来（`reused: true`），绝不另开第二个——
 * 两个窗口对着同一份试卷各记一份答题时间与切屏记录，事后谁都说不清哪份算数。
 */
export async function openExamWindow(payload: unknown): Promise<{ ok: boolean; reused?: boolean; error?: string }> {
  if (examWindow && !examWindow.isDestroyed()) {
    if (examWindow.isMinimized()) examWindow.restore()
    examWindow.focus()
    return { ok: true, reused: true }
  }

  examAllowClose = false
  examCloseReason = 'closed'
  examInitialState = payload

  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 860,
    minHeight: 600,
    // 与主窗口同一个理由：第一帧之前就铺好底色，深色主题下开窗不再白闪
    backgroundColor: startupBackground(),
    title: t('归一 Unyra · 考试'),
    icon: appIcon(),
    show: false,
    // 无边框：应用是自绘标题栏那一套，考试界面自己带「退出」按钮（也是唯一的出口），
    // 系统标题栏一来一回只会多出一个能绕开确认的关闭键
    frame: false,
    webPreferences: {
      // 与主窗口同一个 preload：渲染层靠 ?examWindow=1 分辨自己是哪一侧
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })
  examWindow = win

  win.once('ready-to-show', () => win.show())
  attachConsoleForwarding(win)
  // 考试窗口里也有链接（题干、讲解）：同样的规矩，一律交给系统浏览器
  hardenLinks(win.webContents)

  /**
   * 关闭拦截：考试中途关窗必须由考试界面自己决定（弹「确认放弃 / 已交卷」），
   * 所以先把默认行为挡住，再让它去问。
   *
   * 放行的判据只有一个 examAllowClose——它只在两条路上变真：考试界面调
   * examGuest.allowClose()，或主窗口调 examHost.close()（含应用退出那一趟）。
   * 别在这里加「已经交卷就放行」之类的判断：主进程不解释考试数据，
   * 它无从知道那一轮到底交没交。
   */
  win.on('close', (event) => {
    if (examAllowClose) return
    event.preventDefault()
    if (win.webContents.isDestroyed()) return
    win.webContents.send('exam:confirmClose')
  })

  win.on('closed', () => {
    examWindow = null
    examInitialState = undefined
    sendToHost('exam:windowClosed', { reason: examCloseReason })
    examCloseReason = 'closed'
  })

  /**
   * 主窗口没了就把考试窗口一起收掉：否则最后一个窗口是它，应用既不退出
   * （window-all-closed 不触发），也没有任何人能再给它推状态——一个点不动的空窗口。
   *
   * 监听器在考试窗口关掉时摘掉：主窗口可能被重新创建（托盘 / activate），
   * 而每开一次考试就挂一个监听的话，第二次就挂了两份。
   */
  const host = hostWindow()
  const onHostGone = (): void => closeExamWindow('quit')
  host?.once('closed', onHostGone)
  win.once('closed', () => host?.removeListener('closed', onHostGone))

  /**
   * 页面加载完，把开窗时递来的那份状态补发一次。
   *
   * 说清楚它不保证送达：渲染层的 onState 监听通常挂在 React 的 effect 里，比
   * did-finish-load 还晚，这一发可能落在监听挂上之前——send 是没有回执的。
   * **可靠的那条路是「考试界面挂好监听后自己 emit 一个准备好了，主窗口收到再 push 一次」**，
   * 这里只是顺手带一脚，省掉最常见情况下的一次往返。
   */
  win.webContents.once('did-finish-load', () => {
    if (examInitialState !== undefined) sendToExam('exam:state', examInitialState)
  })

  try {
    if (DEV_SERVER_URL) {
      await win.loadURL(DEV_SERVER_URL + '?examWindow=1')
    } else {
      await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { examWindow: '1' } })
    }
    return { ok: true }
  } catch (err) {
    // 加载失败（dev 服务器半死不活、产物缺失）：把半成品收掉再说失败。
    // 不 destroy 的话 examWindow 会一直「开着」，之后每次 open 都走进 reused 那条路，
    // 用户点「考试」什么都不会发生，还找不到原因
    if (!win.isDestroyed()) win.destroy()
    examWindow = null
    return { ok: false, error: err instanceof Error ? err.message : t('考试窗口打不开') }
  }
}

/**
 * 把主窗口叫回前台。
 *
 * 交卷 / 放弃之后考试窗口就关了，而它刚才一直占着全屏——用户面对的是一个被黑遮罩盖住的
 * 主窗口（遮罩要等主窗口把状态落盘才会撤），从全屏退出来时那扇窗还很容易留在后面。
 * 所以关考试窗口这一趟顺手把主窗口叫到最前面：这是一次「接下来该看这里了」的交接。
 */
function focusHostWindow(): void {
  const win = hostWindow()
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.moveTop()
}

/** 关掉考试窗口（先放行这一次关闭）。reason 会随 exam:windowClosed 报给主窗口 */
export function closeExamWindow(reason: ExamCloseReason): void {
  const win = examWindow
  if (!win || win.isDestroyed()) return
  examAllowClose = true
  examCloseReason = reason
  win.close()
  // 只有「这一场收尾了」才把主窗口叫回来（quit 那一趟主窗口自己也要关了）
  if (reason !== 'quit') focusHostWindow()
}

/**
 * 考试窗口的 IPC。它自己那侧（window.mojiNative.examGuest）只能发事件、收状态、
 * 要求全屏——**没有任何一条通道能把考试数据写进磁盘**：写盘永远发生在主窗口那侧。
 *
 * 每一条都要防两种「已经没了」：窗口被销毁、webContents 已销毁。关窗那一瞬间
 * 这些消息还在路上是常态，不该在主进程里炸出异常。
 */
export function registerExamIpc(): void {
  /** 这条通道的语义是「考试窗口 → 主窗口」，别的窗口发来的一律不认 */
  const fromExam = (sender: unknown): boolean => !!examWindow && !examWindow.isDestroyed() && sender === examWindow.webContents

  // 主窗口：开考试窗口（已经开着就聚焦并回 reused）
  ipcMain.handle('exam:open', (_e, payload: unknown) => openExamWindow(payload))

  // 主窗口 → 考试窗口：状态推送
  ipcMain.on('exam:push', (_e, payload: unknown) => sendToExam('exam:state', payload))

  // 主窗口要求关掉考试窗口：已经确认过了，不再弹确认
  ipcMain.on('exam:close', () => closeExamWindow('host'))

  // 考试窗口 → 主窗口：事件（开始考试、作答、交卷…主进程一个字段都不看）
  ipcMain.on('exam:emit', (event, payload: unknown) => {
    if (!fromExam(event.sender)) return
    sendToHost('exam:windowEvent', payload)
  })

  // 考试界面确认「可以关了」（放弃 / 已交卷）：放行之后由它自己调 window.close()
  ipcMain.on('exam:allowClose', (event) => {
    if (!fromExam(event.sender)) return
    examAllowClose = true
  })

  // 开始考试后全屏（退出全屏传 false）
  ipcMain.on('exam:fullscreen', (event, on: unknown) => {
    if (!fromExam(event.sender)) return
    if (!examWindow || examWindow.isDestroyed()) return
    examWindow.setFullScreen(on === true)
  })
}
