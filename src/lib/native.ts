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
  AttachReadResult, BaseFileEditOpts, BaseFileEditResult, BaseFileListResult, BaseFileOpResult, BaseFileReadResult,
  BaseFileStatResult, BaseFileWriteResult, BaseProcessCreateOpts, BaseProcessCreateResult, BaseProcessDeleteResult, BaseProcessGetResult,
  BaseProcessListResult, BaseProcessOutputResult, BaseProcessStartResult, BaseProcessStatusResult,
  BaseProcessStopResult, CloseAction, CloseBehavior, CodeArtifact, ExamCloseReason,
  ExamOpenResult, ExportPdfPayload, ExportPdfResult, FlushItem, McpStdioCallResult, McpStdioServerPayload, McpStdioToolsResult,
  NoticeSettings, PluginEntry, PluginTogglesResult, SaveFilter,
  SilentMark, StorageEntry, StorageFail, StorageInfo, StorageOk, StorageRootResult, UpdateChannel, UpdateFail,
  UpdatePhase, UpdateState, VideoApiFetchResult, VideoStreamOpenResult, VoiceDownloadResult, VoiceModelProgress, VoiceModelStatus,
  VoiceTranscribeRequest, VoiceTranscribeResult, WebDomOpResult, WebFastTranslateResult, WebFetchResult, WebBinaryFetchResult, WebLogDetailResult,
  WebLogsOpts, WebLogsResult,
  WebPageFetchReq, WebPageFetchResult, WebPointResult, WebReadHtmlResult, WebRecordResult,
  WebScrollReq, WebScrollResult, WebSnapshotResult, WebTextResult, WebTextTarget, WebTranslatePayload, WebWaitReq, WebWaitResult,
  LanDeviceInfo, LanRequestFileOptions, LanRequestFileResult, LanServerStatus, LanUploadedFile,
  CropBoxInput, CropImageResult, PreviewCropResult, RotateImageResult,
  ScreenCaptureResult, ScreenRecordResult, ImageSavePayload, ImageSaveResult, ImageCopyResult,
} from '../../shared/ipc'

// 这些契约形状统一在 shared/ipc.ts（与 electron/preload.ts 共用一份，见该文件顶部）：
// 两边原先各写一遍、逐字重复，漏改一侧不会编译报错，只会在运行时炸。
// 这里按原样转出去，外部从 src/lib/native 引这些类型的写法不用改。
export type {
  AttachReadResult, BaseProcessDeleteResult, CloseAction, CloseBehavior, CodeArtifact, ExamCloseReason,
  ExamOpenResult, ExportPdfPayload, ExportPdfResult, FlushItem, McpStdioCallResult, McpStdioServerPayload, McpStdioToolsResult,
  NoticeSettings, PluginEntry, PluginTogglesResult, SaveFilter,
  SilentMark, StorageEntry, StorageFail, StorageInfo, StorageOk, StorageRootResult, UpdateChannel, UpdateFail,
  UpdatePhase, UpdateState, VideoApiFetchResult, VideoStreamOpenResult, VoiceDownloadResult, VoiceModelProgress, VoiceModelStatus,
  VoiceTranscribeRequest, VoiceTranscribeResult, WebDomOpResult, WebFastTranslateResult, WebFetchResult, WebBinaryFetchResult, WebLogDetailResult,
  WebLogsOpts, WebLogsResult,
  WebPageFetchReq, WebPageFetchResult, WebPointResult, WebReadHtmlResult, WebRecordResult,
  WebScrollReq, WebScrollResult, WebSnapshotResult, WebTextResult, WebTextTarget, WebTranslatePayload, WebWaitReq, WebWaitResult,
  LanDeviceInfo, LanRequestFileOptions, LanRequestFileResult, LanServerStatus, LanUploadedFile,
  CropBoxInput, CropImageResult, PreviewCropResult, RotateImageResult,
  ScreenCaptureResult, ScreenRecordResult, ImageSavePayload, ImageSaveResult, ImageCopyResult,
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
  platform: 'win32' | 'darwin' | 'linux'
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
   * 工作区目录的**外部变化**（资源管理器里项目 / 子目录在被应用外的增删改名）：
   * 把「此刻展开着的目录」清单（绝对路径）推给主进程按目录挂 watcher；目录一有变化
   * 就经 onChanged 推回来。与 local 那条的差别：不带具体路径——重列是幂等的，
   * 收到就是「工作区变过」，各层行各自重列（见 explorer/wsChanges）。
   */
  ws: {
    watch(dirs: string[]): Promise<StorageOk | StorageFail>
    /** 订阅工作区变化（无参数）；返回取消订阅函数 */
    onChanged(cb: () => void): () => void
  }

  /**
   * 外部 MCP 服务（**stdio 传输**）的本地进程会话：命令在主进程里起
   * （渲染层拿不到 child_process），JSON-RPC 走子进程的 stdin/stdout，
   * 会话按服务配置复用（见 electron/mcp）。SSE 传输不走这里——那条由渲染层
   * 直接 fetch（见 src/agent/mcp/client 的 sse 分支）。
   */
  mcp: {
    discover(server: McpStdioServerPayload): Promise<McpStdioToolsResult>
    call(server: McpStdioServerPayload, tool: string, args: Record<string, unknown>): Promise<McpStdioCallResult>
    /** 停掉某个服务的会话（设置里禁用 / 删除时来一发，不留没用的子进程）；省略 = 停掉全部 */
    stop(serverId?: string): Promise<StorageOk | StorageFail>
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
    /** 读插件配置（password 字段已解密成明文） */
    settingsGet(file: string): Promise<{ ok: boolean; values?: Record<string, string | number | boolean>; error?: string }>
    /** 存插件配置：secrets 列出的 key 由主进程加密落盘 */
    settingsSet(
      file: string,
      values: Record<string, string | number | boolean>,
      secrets: string[],
    ): Promise<{ ok: boolean; error?: string }>
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
    /** 一条系统级通知（Windows toast）：点击把主窗口叫到前台。守卫的警告与熔断用它 */
    notify(payload: { title: string; body?: string }): Promise<{ ok: boolean; error?: string }>
    /** 主窗口「闪现置顶」：钉在最上层但不抢焦点，拿到焦点或超时自动解除。守卫的分心警告用它 */
    flashTop(): void
    /** 获取系统当前获得焦点的应用名称（专注模式守卫用） */
    getFocusedApp(): Promise<string>
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
    /** 裁切手写答案图片（支持顺时针旋转修正） */
    cropImage?(payload: {
      imagePath: string
      box: CropBoxInput
      rotate?: number
      sheetRotate?: number
    }): Promise<CropImageResult>
    /** 裁切预检（在原图上画红框并回传） */
    previewCrop?(payload: {
      imagePath: string
      box: CropBoxInput
      rotate?: number
      sheetRotate?: number
    }): Promise<PreviewCropResult>
    /** 顺时针旋转整张手写答卷 */
    rotateSheet?(payload: { imagePath: string; degrees: number }): Promise<RotateImageResult>
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
    /** 裁切手写答案图片（支持顺时针旋转修正） */
    cropImage?(payload: {
      imagePath: string
      box: CropBoxInput
      rotate?: number
      sheetRotate?: number
    }): Promise<CropImageResult>
    /** 裁切预检（在原图上画红框并回传） */
    previewCrop?(payload: {
      imagePath: string
      box: CropBoxInput
      rotate?: number
      sheetRotate?: number
    }): Promise<PreviewCropResult>
    /** 顺时针旋转整张手写答卷 */
    rotateSheet?(payload: { imagePath: string; degrees: number }): Promise<RotateImageResult>
  }
  /**
   * 上下文轨迹窗口（第三个 BrowserWindow，`?contextTrace=1` 分支）的**主窗口那一侧**。
   * 轨迹是纯只读的：把当前会话的原始数据整份推过去，轨迹窗口没有回发通道。
   */
  traceHost: {
    /** 开轨迹窗口（payload = 当前会话数据）；已经开着就聚焦并换数据 */
    open(payload: unknown): Promise<ExamOpenResult>
    /** 把当前会话数据推给轨迹窗口（随数据变化持续推） */
    push(payload: unknown): void
    /** 订阅「轨迹窗口关掉了」；主窗口据此停止推送。返回取消订阅函数 */
    onClosed(cb: () => void): () => void
  }
  /** 轨迹窗口那一侧：只收会话数据 */
  traceGuest: {
    /** 订阅主窗口推来的会话数据；返回取消订阅函数 */
    onState(cb: (payload: unknown) => void): () => void
  }
  /**
   * 语音：模型的状态与下载、一次识别、这台机器上有没有显卡。
   * 与 electron/preload.ts 那份是同一套（渲染层不能 import 主进程的文件，只能各声明一份）。
   */
  voice: {
    modelStatus(): Promise<VoiceModelStatus>
    downloadModel(): Promise<VoiceDownloadResult>
    cancelDownload(): Promise<boolean>
    chooseModel(): Promise<{ ok: boolean; canceled?: boolean; error?: string; bytes?: number }>
    removeModel(): Promise<{ ok: boolean; error?: string }>
    /** 识别一段 16 kHz 单声道 PCM（推理在主进程，见 electron/voice.ts） */
    transcribe(req: VoiceTranscribeRequest): Promise<VoiceTranscribeResult>
    /** 有没有显卡：设置页拿它决定 GPU 开关的默认值 */
    gpuInfo(): Promise<{ hasGpu: boolean; name: string }>
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
    /** 当前更新策略（stable 正式版 / beta 尝鲜版，全局设置，跟机器走） */
    getChannel(): Promise<UpdateChannel>
    /** 切更新策略；主进程按新策略立刻重新认定一次，返回存盘后生效的值 */
    setChannel(value: UpdateChannel): Promise<UpdateChannel>
    install(): Promise<{ ok: boolean }>
    openRelease(): Promise<boolean>
    /** 订阅状态变化；返回取消订阅函数 */
    onState(cb: (state: UpdateState) => void): () => void
  }
  /**
   * 远程公告在本机的状态（要不要自动弹、上次弹时的版本号、读过哪些 id）。
   * 与关窗行为一样是「跟机器走」的全局设置（appdata 的 global.yaml），
   * 这里只读写、不自己存一份——判定的完整逻辑见 src/lib/notice.ts。
   */
  notice: {
    get(): Promise<NoticeSettings>
    /** 按字段合并着改（只改传进来的那几项） */
    set(patch: Partial<NoticeSettings>): Promise<NoticeSettings>
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
    /** 抓一个网络二进制（图片 / PDF，字节以 base64 data URL 过 IPC）；api.see 的取字节通道（见 learn/see） */
    fetchBinary(url: string): Promise<WebBinaryFetchResult>
  }
  /**
   * 视频学习（实验）：来源插件的两条通道（见 shared/ipc 的说明与 electron/video-net）。
   * fetch 是插件 API 请求（只读 GET + 防盗链头）；openStream 把媒体流登记进主进程
   * 换回 media-relay:// 中转地址——每次播放前都要重新登记（流地址带签名会过期）。
   */
  video: {
    fetch(url: string, headers?: Record<string, string>): Promise<VideoApiFetchResult>
    openStream(url: string, headers?: Record<string, string>): Promise<VideoStreamOpenResult>
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
    /** 订阅来自右键菜单的翻译指令 */
    onTranslate(cb: (payload: WebTranslatePayload) => void): () => void
    /** 极速翻译单条或短文本（免费公共接口） */
    fastTranslate(text: string, targetLang?: string): Promise<WebFastTranslateResult>
    /** 页面快照：Accessibility 树 → 带 ref 的可交互元素清单（browser.* 的「看」通道） */
    snapshot(wcId: number): Promise<WebSnapshotResult>
    /** 页面滚到目标元素并高亮突出（browser.point） */
    point(wcId: number, target: { ref: number } | { selector: string }): Promise<WebPointResult>
    /** 对 snapshot 的 ref 执行受控 DOM 操作（browser.dom）：固定函数 + 值参数 */
    domOp(wcId: number, ref: number, op: string, arg?: string): Promise<WebDomOpResult>
    /** 拿当前页的整份 DOM HTML（渲染层走 webFetch 同一条 markdown 管线，browser.read） */
    readHtml(wcId: number): Promise<WebReadHtmlResult>
    /** 页签日志清单（折叠去重，见 shared/webLogs）：browser.logs */
    logs(wcId: number, opts?: WebLogsOpts): Promise<WebLogsResult>
    /** 单条日志详情（完整头/栈/响应体）：browser.logDetail */
    logDetail(wcId: number, seq: number, opts?: { maxBody?: number }): Promise<WebLogDetailResult>
    /** 页面上下文直发 HTTP（继承页签登录态；{reqId} 重放捕获的请求）：browser.fetch */
    pageFetch(wcId: number, req: WebPageFetchReq): Promise<WebPageFetchResult>
    /** 日志录制（start 钉水位 / stop 回区间清单）：browser.record */
    record(wcId: number, action: 'start' | 'stop', opts?: WebLogsOpts): Promise<WebRecordResult>
    /** 区域文本（渲染后的 innerText，按 ref/selector 取）：browser.text */
    text(wcId: number, target: WebTextTarget): Promise<WebTextResult>
    /** 滚页面（by/to/ref）：browser.scroll */
    scroll(wcId: number, req: WebScrollReq): Promise<WebScrollResult>
    /** 等条件成立（selector/text/urlIncludes/networkIdle/load）：browser.waitFor */
    waitFor(wcId: number, req: WebWaitReq): Promise<WebWaitResult>
  }
  /**
   * 基础真实文件系统与受控系统进程 (files.* / process.*)。
   * 受目标目录与用户权限白名单保护。
   */
  files: {
    read(path: string, opts?: { encoding?: 'utf8' | 'base64' | 'binary'; maxBytes?: number; offset?: number }): Promise<BaseFileReadResult>
    write(path: string, content: string, opts?: { encoding?: 'utf8' | 'base64'; overwrite?: boolean }): Promise<BaseFileWriteResult>
    edit(path: string, opts?: BaseFileEditOpts): Promise<BaseFileEditResult>
    list(path?: string): Promise<BaseFileListResult>
    stat(path: string): Promise<BaseFileStatResult>
    mkdir(path: string): Promise<BaseFileOpResult>
    copy(from: string, to: string, opts?: { overwrite?: boolean }): Promise<BaseFileOpResult>
    move(from: string, to: string): Promise<BaseFileOpResult>
    delete(path: string): Promise<BaseFileOpResult>
    onChanged?(cb: (payload: { path: string; action: string; content?: string }) => void): () => void
  }
  process: {
    create(opts: BaseProcessCreateOpts): Promise<BaseProcessCreateResult>
    start(process_id: string): Promise<BaseProcessStartResult>
    status(process_id: string): Promise<BaseProcessStatusResult>
    output(process_id: string, opts?: { offset?: number; reset?: boolean }): Promise<BaseProcessOutputResult>
    stop(process_id: string, opts?: { timeoutMs?: number; force?: boolean }): Promise<BaseProcessStopResult>
    list(): Promise<BaseProcessListResult>
    get(process_id: string): Promise<BaseProcessGetResult>
    delete(process_id: string): Promise<BaseProcessDeleteResult>
  }
  syncPermissions(allowedDirs: string[]): Promise<{ ok: boolean }>
  base?: {
    files: {
      read(path: string, opts?: { encoding?: 'utf8' | 'base64' | 'binary'; maxBytes?: number; offset?: number }): Promise<BaseFileReadResult>
      write(path: string, content: string, opts?: { encoding?: 'utf8' | 'base64'; overwrite?: boolean }): Promise<BaseFileWriteResult>
      edit(path: string, opts?: BaseFileEditOpts): Promise<BaseFileEditResult>
      list(path?: string): Promise<BaseFileListResult>
      stat(path: string): Promise<BaseFileStatResult>
      mkdir(path: string): Promise<BaseFileOpResult>
      copy(from: string, to: string, opts?: { overwrite?: boolean }): Promise<BaseFileOpResult>
      move(from: string, to: string): Promise<BaseFileOpResult>
      delete(path: string): Promise<BaseFileOpResult>
      onChanged?(cb: (payload: { path: string; action: string; content?: string }) => void): () => void
    }
    process: {
      create(opts: BaseProcessCreateOpts): Promise<BaseProcessCreateResult>
      start(process_id: string): Promise<BaseProcessStartResult>
      status(process_id: string): Promise<BaseProcessStatusResult>
      output(process_id: string, opts?: { offset?: number; reset?: boolean }): Promise<BaseProcessOutputResult>
      stop(process_id: string, opts?: { timeoutMs?: number; force?: boolean }): Promise<BaseProcessStopResult>
      list(): Promise<BaseProcessListResult>
      get(process_id: string): Promise<BaseProcessGetResult>
      delete(process_id: string): Promise<BaseProcessDeleteResult>
    }
    syncPermissions(allowedDirs: string[]): Promise<{ ok: boolean }>
  }
  lan?: {
    startServer(port?: number): Promise<LanServerStatus>
    stopServer(): Promise<boolean>
    getStatus(): Promise<LanServerStatus>
    setSelectedIp(ip: string): Promise<LanServerStatus>
    getQrDataUrl(ip?: string): Promise<string>
    requestDeviceFile(options?: LanRequestFileOptions): Promise<LanRequestFileResult>
    cancelRequests?(reason?: string): Promise<void>
    openFile(filePath: string): Promise<void>
    showInFolder(filePath: string): Promise<void>
    onStatusChange(cb: (status: LanServerStatus) => void): () => void
    onFileReceived(cb: (file: LanUploadedFile) => void): () => void
    onDevicesChange(cb: (devices: LanDeviceInfo[]) => void): () => void
  }
  tools?: {
    captureScreen(): Promise<ScreenCaptureResult>
    openScreenshot?(): Promise<{ ok: boolean; error?: string }>
    getScreenshotImage?(): Promise<string | null>
    getScreenshotSystemRects?(): Promise<Array<{ x: number; y: number; width: number; height: number }>>
    onScreenshotUpdate?(cb: (payload: { imageSrc: string; systemRects?: Array<{ x: number; y: number; width: number; height: number }> }) => void): () => void
    notifyScreenshotReady?(): void
    closeScreenshot?(): void
    confirmScreenshot?(dataUrl: string): Promise<ImageCopyResult>
    pinScreenshot?(pinnedItem: unknown): void
    saveScreenshot?(payload: ImageSavePayload): Promise<ImageSaveResult>
    getPinData?(id: string): Promise<any>
    closePin?(id: string): void
    copyPin?(id: string): Promise<ImageCopyResult>
    savePin?(id: string): Promise<ImageSaveResult>
    notifyPinReady?(id: string): void
    movePin?(id: string, dx: number, dy: number): void
    zoomPin?(id: string, zoomFactor: number): void
    copyImage(dataUrl: string): Promise<ImageCopyResult>
    saveImage(payload: ImageSavePayload): Promise<ImageSaveResult>
    startRecord?(): Promise<ScreenRecordResult>
    onPinnedScreenshot?(cb: (item: unknown) => void): () => void
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
import { createWebNativeBridge } from './nativeBridgeWeb'

let webBridgeInstance: NativeBridge | null = null

export const native = (): NativeBridge => {
  if (typeof window !== 'undefined') {
    if (window.mojiNative) return window.mojiNative
    // 处于普通 Web 浏览器环境，自动初始化 Web 桥适配器
    webBridgeInstance ??= createWebNativeBridge()
    return webBridgeInstance
  }
  throw new Error(
    t('未检测到原生或 Web 桥运行环境：请启动桌面客户端或本地 Web 服务。'),
  )
}

/** 是否运行在 Electron 原生客户端容器内 */
export const isElectron = (): boolean =>
  typeof window !== 'undefined' && !!window.mojiNative

/** 是否运行在普通浏览器 (WebUI) 模式中 */
export const isWeb = (): boolean =>
  typeof window !== 'undefined' && !window.mojiNative

/** 判定当前运行环境是否为 macOS（Electron 壳内以 platform 为准，浏览器以 userAgent 为准） */
export const isMac = (): boolean => {
  if (isElectron()) {
    return window.mojiNative?.platform === 'darwin'
  }
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
}
