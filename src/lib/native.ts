/**
 * 原生桥：preload 通过 contextBridge 注入的 `window.mojiNative` 的渲染层入口。
 *
 * 它不属于 AI 层——窗口控制、原生对话框、数据落盘都走这里，因此单独放在 lib 下。
 * `ai/http.ts` 会把它转出去，既有引用路径（`native()` / `isElectron()`）保持不变。
 *
 * 应用必须跑在 Electron 里：拿不到桥即视为启动环境不对（比如直接在浏览器里打开
 * dist/index.html），当场给出可操作的提示，而不是让后续调用各报各的错。
 */

import { t } from '../i18n'
import type {
  AttachReadResult, CloseAction, CloseBehavior, CodeArtifact, ExamCloseReason,
  ExamOpenResult, ExportPdfPayload, ExportPdfResult, FlushItem, PluginEntry, PluginTogglesResult, SaveFilter,
  SilentMark, StorageEntry, StorageFail, StorageInfo, StorageOk, StorageRootResult, UpdateFail,
  UpdatePhase, UpdateState, VoiceDownloadResult, VoiceModelProgress, VoiceModelStatus,
  VoiceReadResult, WebDomOpResult, WebFetchResult, WebPointResult, WebReadHtmlResult, WebSnapshotResult,
} from '../../shared/ipc'

// 这些契约形状统一在 shared/ipc.ts（与 electron/preload.ts 共用一份，见该文件顶部）：
// 两边原先各写一遍、逐字重复，漏改一侧不会编译报错，只会在运行时炸。
// 这里按原样转出去，外部从 src/lib/native 引这些类型的写法不用改。
export type {
  AttachReadResult, CloseAction, CloseBehavior, CodeArtifact, ExamCloseReason,
  ExamOpenResult, ExportPdfPayload, ExportPdfResult, FlushItem, PluginEntry, PluginTogglesResult, SaveFilter,
  SilentMark, StorageEntry, StorageFail, StorageInfo, StorageOk, StorageRootResult, UpdateFail,
  UpdatePhase, UpdateState, VoiceDownloadResult, VoiceModelProgress, VoiceModelStatus,
  VoiceReadResult, WebDomOpResult, WebFetchResult, WebPointResult, WebReadHtmlResult, WebSnapshotResult,
}

export type PluginList =
  | { ok: true; dir: string; entries: PluginEntry[] }
  | { ok: false; error: string }

export type PluginSource = { ok: true; content: string } | { ok: false; error: string }

export type ArtifactList =
  | { ok: true; items: Record<string, CodeArtifact>; silent: Record<string, SilentMark> }
  | { ok: false; error: string }

/** 主进程替沙箱发出去的那一次请求的结果 */
export type RunnerFetch =
  | { ok: true; status: number; statusText: string; headers: Array<[string, string]>; body: string; truncated: boolean }
  | { ok: false; error: string }

export interface RunnerFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}

export type StorageRead = { ok: true; content: string | null } | StorageFail
export type StorageYaml = { ok: true; data: unknown } | StorageFail
/** 读二进制（图片通道与资源库通道共用）：dataUrl 为 null 表示文件不存在（不算错误） */
export type StorageImage = { ok: true; dataUrl: string | null } | StorageFail
export type StorageList = { ok: true; entries: StorageEntry[] } | StorageFail

export interface NativeBridge {
  isElectron: true
  /** 同步代理白名单；每一项是 `协议//host`（见 ai/http 的 originOfBaseUrl）。
   *  主进程据此收紧 llm-proxy 白名单——不做开放代理。 */
  setProxyHosts(hosts: string[]): Promise<string[]>
  getProxyHosts(): Promise<string[]>
  /** 原生「保存文件」；title / filters 换对话框的标题与扩展名过滤（导出文档用） */
  saveText(payload: {
    suggestedName?: string
    content: string
    title?: string
    filters?: SaveFilter[]
  }): Promise<{
    ok: boolean
    canceled?: boolean
    path?: string
    error?: string
  }>
  /** 导出 PDF：HTML 进，PDF 落在用户选的路径上（排版见 electron/main.ts 的 file:exportPdf） */
  exportPdf(payload: ExportPdfPayload): Promise<ExportPdfResult>
  /**
   * 拖进来的文件 → 绝对路径。
   *
   * Electron 32 起 File.path 被删掉了，唯一替代是 preload 里的 webUtils（渲染层用不了），
   * 因此这里只是一个转发。拿不到路径时返回空串（拖进来的不是磁盘文件，如网页里的一张图）。
   */
  pathForFile(file: File): string
  /**
   * 外部文件（不在数据目录里的那些）的读写：路径是**绝对路径**，
   * 只放行 md / txt / html 这几种文本（见 electron/storage 的 LOCAL_TEXT_EXTS）。
   */
  local: {
    read(path: string): Promise<{ ok: true; content: string } | { ok: false; error: string }>
    /** 读本地媒体文件（多媒体预览页签用）：mime + base64 data URL */
    readMedia(path: string): Promise<{ ok: true; mime: string; dataUrl: string } | { ok: false; error: string }>
    write(path: string, content: string): Promise<{ ok: boolean; error?: string }>
    reveal(path: string): Promise<StorageOk | StorageFail>
    /** 弹原生多选框挑几个本地文件（拖拽之外的第二个入口） */
    pick(): Promise<{ ok: boolean; canceled?: boolean; paths?: string[] }>
    /**
     * 附件通道（发给超级导师的文件）：**任意扩展名**。
     * readAttach 已经分好类——图片是 dataUrl、文本是正文、其余只报体积。
     */
    pickAttach(): Promise<{ ok: boolean; canceled?: boolean; paths?: string[] }>
    readAttach(path: string): Promise<AttachReadResult>
    /**
     * 把「开着页签的本地文件」清单推给主进程挂 watcher（目录级 fs.watch，见
     * electron/storage）：文件在外部被改时经 onChanged 推回来。
     */
    watch(paths: string[]): Promise<StorageOk | StorageFail>
    /** 订阅外部文件变化（参数是绝对路径）；返回取消订阅函数 */
    onChanged(cb: (path: string) => void): () => void
  }

  /**
   * 数据落盘。路径一律是相对根目录的相对路径（如 `users/<uid>/setting.yaml`），
   * 由主进程解析并挡掉越界（见 electron/storage.ts）。
   */
  storage: {
    info(): Promise<StorageInfo>
    /** 切换根目录；不传或传空串表示恢复默认 */
    setRoot(dir?: string): Promise<StorageRootResult>
    /** 弹原生目录选择框；只返回用户选了什么，改不改由调用方决定 */
    pickRoot(): Promise<{ ok: boolean; canceled?: boolean; root?: string; error?: string }>
    list(rel: string): Promise<StorageList>
    read(rel: string): Promise<StorageRead>
    write(rel: string, content: string): Promise<StorageOk | StorageFail>
    /** 写一张图（内容为 base64 data URL；只允许图片扩展名） */
    writeImage(rel: string, dataUrl: string): Promise<StorageOk | StorageFail>
    /** 读一张图，回 base64 data URL */
    readImage(rel: string): Promise<StorageImage>
    /** 写任意扩展名的二进制（资源库；内容为 base64 data URL，不限类型） */
    writeBinary(rel: string, dataUrl: string): Promise<StorageOk | StorageFail>
    /** 读任意扩展名的二进制，回 base64 data URL；mime 由扩展名推，认不出按 octet-stream */
    readBinary(rel: string): Promise<StorageImage>
    /** 移动文件或整个目录（改名时用它保住目录下的二进制资源） */
    move(from: string, to: string): Promise<StorageOk | StorageFail>
    /** 复制文件或整个目录（工作区拖拽的 Ctrl 分支）；目标已存在时拒绝 */
    copy(from: string, to: string): Promise<StorageOk | StorageFail>
    remove(rel: string): Promise<StorageOk | StorageFail>
    /** 新建一个目录（父目录连带建起；已存在同名时拒绝，见 electron/storage 的 mkdirPath） */
    mkdir(rel: string): Promise<StorageOk | StorageFail>
    /** 在系统文件管理器里定位某个文件；文件不存在时退而打开它所在的目录 */
    reveal(rel: string): Promise<StorageOk | StorageFail>
    readYaml(rel: string): Promise<StorageYaml>
    writeYaml(rel: string, data: unknown): Promise<StorageOk | StorageFail>
    readSession(): Promise<StorageYaml>
    writeSession(data: unknown): Promise<StorageOk | StorageFail>
    /** 同步写一批；页面卸载前用，平时一律走上面的异步接口 */
    flush(items: FlushItem[]): { ok: boolean; failed: string[] }
  }
  /**
   * 插件目录（`{root}/plugins/`，见 electron/plugins.ts）。
   *
   * 主进程只负责「列出 / 读某个文件的源码 / 开关」，**执行在渲染层**（lib/plugins）。
   * 这么分是因为插件要往 DOM 里画东西，只能在渲染进程跑；主进程守住目录这一道，
   * 渲染层拿不到「往插件目录随便写」的能力。
   */
  plugins: {
    list(): Promise<PluginList>
    /** 读一个插件的源码；只有启用清单里的文件才会来读 */
    read(file: string): Promise<PluginSource>
    /** 开关插件（写 enabled.json）。**重启后生效**，理由见 lib/renderPlugins */
    setEnabled(file: string, enabled: boolean): Promise<StorageOk | StorageFail>
    /** 在系统文件管理器里打开插件目录 */
    reveal(): Promise<StorageOk | StorageFail>
    /**
     * 内置插件的开关。它们编译进包、跟机器走，所以存 appdata 的 global.yaml，
     * 而不是数据目录里那份用户插件清单（见 electron/plugins.ts）。
     */
    toggles(): Promise<PluginTogglesResult>
    /** 改一个内置插件的开关；**重启后生效** */
    setToggle(id: string, enabled: boolean): Promise<StorageOk | StorageFail>
  }
  /**
   * 代码块伪编译（见 electron/runner.ts）。
   *
   * 产物落在**数据目录**里（换一份数据目录就换一批产物）；联网只能走主进程——
   * 渲染层那个执行沙箱是 Web Worker，受页面 CSP 管着，自己发不出外部请求。
   */
  runner: {
    /** 全量产物表 */
    artifacts(): Promise<ArtifactList>
    /** 存一份产物（键是「代码 + 语言」的指纹） */
    putArtifact(key: string, value: CodeArtifact): Promise<StorageOk | StorageFail>
    /** 记下「这段代码没有输出」：那块代码从此不再显示编译与运行 */
    putSilent(key: string, value: SilentMark): Promise<StorageOk | StorageFail>
    /** 清空全部产物 */
    clearArtifacts(): Promise<StorageOk | StorageFail>
    /** 替沙箱发一次请求；用户同不同意由渲染层先弹窗问过 */
    fetch(url: string, init: RunnerFetchInit): Promise<RunnerFetch>
  }
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    /** 打开 / 重新打开开发者工具（已开着则先关后开，保证它浮到最上层） */
    devtools(): void
    /** 订阅最大化状态变化；返回取消订阅函数 */
    onMaximizeChange(cb: (maximized: boolean) => void): () => void
    /** 提示音（api.tiktok）：Electron 的 beep */
    beep(): void
    /**
     * 截取窗口内容的一块（api.ui.screenshot 用）：rect 是相对窗口内容区的
     * CSS 像素矩形，省略则截整窗；返回 PNG data URL。
     */
    capture(rect?: { x: number; y: number; width: number; height: number }): Promise<{
      ok: boolean
      dataUrl?: string
      error?: string
    }>
    /** logo.svg 原文（运行时给任务栏 / 托盘图标染色用，见 lib/appIcon） */
    logoSource(): Promise<string>
    /** 把染色后的 PNG 设为窗口（任务栏）与托盘图标 */
    setAppIcon(dataUrl: string): Promise<boolean>
  }
  /**
   * 考试窗口的**主窗口那一侧**。考试窗口是第二个 BrowserWindow，加载同一份渲染产物
   * （`?examWindow=1` 分支）；主进程只开窗与转发，**不解释载荷**。
   *
   * 两侧分工：主窗口是唯一的数据拥有者（答案、答题顺序、切屏记录、判分都由它落盘），
   * 考试窗口只发事件、收状态。
   */
  examHost: {
    /**
     * 开考试窗口；已经开着就聚焦它并回 `reused: true`（全局只有一个）。
     * payload 会在页面加载完后补发一次，但**不保证送达**——稳妥的写法是拿到
     * `{ ok: true }` 之后自己 push 一份，或等考试界面 emit 一个「准备好了」。
     */
    open(payload: unknown): Promise<ExamOpenResult>
    /** 把当前状态推给考试窗口（形状由两侧自己约定，主进程不看） */
    push(payload: unknown): void
    /** 要求关掉考试窗口；走这条路的关闭不再弹确认 */
    close(): void
    /** 订阅考试窗口发来的事件；返回取消订阅函数 */
    onEvent(cb: (payload: unknown) => void): () => void
    /** 订阅「考试窗口关掉了」（任何原因）；返回取消订阅函数 */
    onClosed(cb: (info: { reason: string }) => void): () => void
  }
  /**
   * 考试窗口的**考试窗口那一侧**：只能发事件、收状态、要求全屏、放行关闭，
   * **没有任何一条通道能写盘**——数据一律回主窗口落盘。
   */
  examGuest: {
    /** 向主窗口发一个事件（开始考试、作答、交卷…） */
    emit(payload: unknown): void
    /** 订阅主窗口推来的状态；返回取消订阅函数 */
    onState(cb: (payload: unknown) => void): () => void
    /**
     * 用户试图关窗（系统关闭键 / Alt+F4 / 界面上的退出按钮）。主进程已经把默认行为
     * 挡住了——要不要弹「确认放弃」，由考试界面自己决定（主进程不知道这一场开没开始）。
     */
    onConfirmClose(cb: () => void): () => void
    /** 开始考试后全屏（退出全屏传 false） */
    setFullscreen(on: boolean): void
    /** 「确认放弃 / 已交卷」之后放行关闭；之后由界面自己调 window.close() */
    allowClose(): void
  }
  /**
   * 语音模型：下载、读取字节、换一份、删掉。
   * 与 electron/preload.ts 那份是同一套（渲染层不能 import 主进程的文件，只能各声明一份）。
   */
  voice: {
    modelStatus(): Promise<VoiceModelStatus>
    downloadModel(): Promise<VoiceDownloadResult>
    cancelDownload(): Promise<boolean>
    chooseModel(): Promise<{ ok: boolean; canceled?: boolean; error?: string; bytes?: number }>
    readModel(): Promise<VoiceReadResult>
    removeModel(): Promise<{ ok: boolean; error?: string }>
    revealModel(): Promise<boolean>
    onModelProgress(cb: (p: VoiceModelProgress) => void): () => void
  }
  /**
   * 自动更新：读状态、手动检查、安装、看发布页。
   * 下载什么时候开始、能不能装，都由主进程决定，这里没有开关。
   */
  update: {
    state(): Promise<UpdateState>
    check(): Promise<UpdateState>
    /** 下载查到的那个新版本（关掉自动更新时要用户自己点） */
    download(): Promise<UpdateState>
    /** 自动检查并下载更新（全局设置，跟机器走） */
    getAuto(): Promise<boolean>
    setAuto(value: boolean): Promise<boolean>
    install(): Promise<{ ok: boolean }>
    openRelease(): Promise<boolean>
    /** 订阅状态变化；返回取消订阅函数 */
    onState(cb: (state: UpdateState) => void): () => void
  }
  /**
   * 外壳行为：关窗策略与托盘。
   * 策略由主进程持有（appdata 里的 global.yaml），这里只读写，不自己存一份。
   */
  shell: {
    getCloseBehavior(): Promise<CloseBehavior>
    setCloseBehavior(value: CloseBehavior): Promise<CloseBehavior>
    /** 回答关窗询问；remember 为真时把这次的选择存成策略 */
    decideClose(action: CloseAction, remember: boolean): Promise<{ ok: boolean; behavior: CloseBehavior }>
    /** 用系统浏览器打开一个地址（http / https / mailto）；协议判定在主进程 */
    openExternal(url: string): Promise<boolean>
    /** 立刻收进托盘 */
    hideToTray(): void
    /** 订阅主进程的关窗询问（策略为「询问」时才会来）；返回取消订阅函数 */
    onCloseRequested(cb: () => void): () => void
  }
  /**
   * 抓网页：主进程去取字节（渲染层受同源策略约束，抓不了任意站点）。
   *
   * 只有这一个方法，而且**只读**：不给 cookie、不给本机凭据，体积与时间都有硬上限，
   * 本机与内网地址一律拒绝（判定见 electron/web-core）。正文提取在渲染层做（见 lib/web）。
   */
  web: {
    fetch(url: string): Promise<WebFetchResult>
  }
  /**
   * 内置浏览器页签（见 src/components/learn/web 与 electron/app/webSession）。
   * 三条都是主进程推、渲染层收：onOpenTab —— 网页弹窗 / target=_blank 要开的新页签
   * （拦截与协议判定在主进程）；onShortcut —— 焦点在网页里时按下的应用快捷键，
   * 转发回来当 DOM 键用；onGuestInput —— guest 里的鼠标指针事件（electron/guestPreload
   * 上报），渲染层据此在 <webview> 元素上合成可冒泡的 PointerEvent。返回取消订阅函数。
   */
  browser: {
    onOpenTab(cb: (url: string) => void): () => void
    onShortcut(cb: (key: string) => void): () => void
    onGuestInput(
      cb: (p: { wcId: number; type: string; button: number; buttons: number; x: number; y: number }) => void,
    ): () => void
    /** 页面快照：Accessibility 树 → 带 ref 的可交互元素清单（browser.* 的「看」通道） */
    snapshot(wcId: number): Promise<WebSnapshotResult>
    /** 页面滚到目标元素并高亮突出（browser.point） */
    point(wcId: number, target: { ref: number } | { selector: string }): Promise<WebPointResult>
    /** 对 snapshot 的 ref 执行受控 DOM 操作（browser.dom）：固定函数 + 值参数 */
    domOp(wcId: number, ref: number, op: string, arg?: string): Promise<WebDomOpResult>
    /** 拿当前页的整份 DOM HTML（渲染层走 webFetch 同一条 markdown 管线，browser.read） */
    readHtml(wcId: number): Promise<WebReadHtmlResult>
  }
}

declare global {
  interface Window {
    mojiNative?: NativeBridge
  }
}

/**
 * 拿桥。**这里是本文件唯一碰 window.mojiNative 的地方**（其余全是类型声明）：
 * 于是「浏览器里跑测试」这类少了桥的环境，只有在真的去调原生能力时才会拿到这句可操作的
 * 提示，import 一下这个模块不会抛。
 */
export const native = (): NativeBridge => {
  const bridge = window.mojiNative
  if (!bridge) {
    throw new Error(
      t('未检测到 Electron 运行环境：请用 npm run electron:dev 启动桌面应用，而不是直接在浏览器里打开。'),
    )
  }
  return bridge
}

export const isElectron = (): boolean => typeof window !== 'undefined' && !!window.mojiNative