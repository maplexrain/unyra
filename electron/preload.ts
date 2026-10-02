/**
 * preload：渲染进程与主进程之间唯一的通道。
 *
 * 渲染进程以 contextIsolation + sandbox 运行，拿不到 Node，也碰不到 ipcRenderer。
 * 这里用 contextBridge 把主进程的能力收敛成一个受控的 `window.mojiNative`，
 * 只暴露必要的方法——不暴露 ipcRenderer 本身，避免渲染层能向任意频道发消息。
 *
 * 通道一览：
 * - `llm-proxy:setHosts` / `llm-proxy:getHosts` —— 同步代理白名单
 * - `file:saveText` / `file:openText` / `file:exportPdf` —— 原生导入导出对话框（退出为 PDF）
 * - `storage:*` —— 全局设置（存储位置）、会话与本机文件读写
 * - `update:*` —— 自动更新状态、手动检查、安装已下载的新版本
 * - `window:*` —— 窗口最小化/最大化/关闭、收进托盘、关窗询问的回答
 * - `exam:*` —— 考试窗口（第二个 BrowserWindow）的开窗、状态推送与事件转发
 * - `web:fetch` —— 抓一个网页的字节（主进程去取，渲染层受同源策略约束）
 * - `shell:*` —— 关窗行为（全局设置）的读写
 * - `plugins:*` —— 插件目录的列出、读源码与开关（执行在渲染层，见 src/lib/plugins.ts）
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron'

import type {
  AttachReadResult, CloseAction, CloseBehavior, CodeArtifact, ExamCloseReason,
  ExamOpenResult, ExportPdfPayload, ExportPdfResult, FlushItem, PluginEntry, PluginListResult,
  PluginSourceResult, PluginTogglesResult, SaveFilter, SilentMark, StorageEntry, StorageFail,
  StorageInfo, StorageOk, StorageRootResult, UpdateFail, UpdatePhase, UpdateState,
  VoiceDownloadResult, VoiceModelProgress, VoiceModelStatus, VoiceReadResult, WebFetchResult, WebSnapshotResult,
} from '../shared/ipc'

// 这些契约形状统一在 shared/ipc.ts（渲染层与主进程共用一份，见该文件顶部）：
// 两边原先各写一遍、逐字重复，漏改一侧不会编译报错，只会在运行时炸。
// 这里按原样转出去，外部从 electron/preload 引这些类型的写法不用改。
export type {
  AttachReadResult, CloseAction, CloseBehavior, CodeArtifact, ExamCloseReason,
  ExamOpenResult, ExportPdfPayload, ExportPdfResult, FlushItem, PluginEntry, PluginListResult,
  PluginSourceResult, PluginTogglesResult, SaveFilter, SilentMark, StorageEntry, StorageFail,
  StorageInfo, StorageOk, StorageRootResult, UpdateFail, UpdatePhase, UpdateState,
  VoiceDownloadResult, VoiceModelProgress, VoiceModelStatus, VoiceReadResult, WebFetchResult, WebSnapshotResult,
}

/* ---------- 只在 preload 这一侧用到的形状 ---------- */

export interface SaveTextResult {
  ok: boolean
  canceled?: boolean
  path?: string
  error?: string
}

export type ArtifactListResult =
  | { ok: true; items: Record<string, CodeArtifact>; silent: Record<string, SilentMark> }
  | { ok: false; error: string }

/** 主进程替沙箱发出去的一次请求（真的结果，见 electron/runner.ts 的 runFetch） */
export type RunnerFetchResult =
  | { ok: true; status: number; statusText: string; headers: Array<[string, string]>; body: string; truncated: boolean }
  | { ok: false; error: string }

/** 外部文件（拖进来浏览的本地文件）的读写结果 */
export type LocalReadResult = { ok: true; content: string } | { ok: false; error: string }

/** 文档区截图（window.capture）的返回：dataUrl 是 PNG */
export type CaptureResult = { ok: true; dataUrl: string } | { ok: false; error: string }
export type LocalWriteResult = { ok: boolean; error?: string }

export type StorageReadResult = { ok: true; content: string | null } | StorageFail
export type StorageListResult = { ok: true; entries: StorageEntry[] } | StorageFail
export type StorageYamlResult = { ok: true; data: unknown } | StorageFail
/** 读二进制（图片通道与资源库通道共用）：dataUrl 为 null 表示文件不存在（不算错误） */
export type StorageImageResult = { ok: true; dataUrl: string | null } | StorageFail

const api = {
  /** 是否运行在 Electron 壳里。渲染层的 http 层据此选择直连还是走主进程 */
  isElectron: true as const,

  /**
   * 界面语言（zh / en）。语言状态的拥有者是渲染层：挂载时与每次切换都推一份过来，
   * 主进程收到后换掉自己的 t() 并重建应用菜单（`ui-locale` 频道，处理器在 app/ipc.ts）。
   */
  setUiLocale: (l: 'zh' | 'en') => { ipcRenderer.send('ui-locale', l) },

  /** 启动时读一次存档（global.yaml）：语言跟机器走，见 src/lib/uiLocale 的 loadUiLocale */
  getUiLocale: (): Promise<'zh' | 'en'> => ipcRenderer.invoke('ui-locale:get'),

  /**
   * 把「允许代理的 host 列表」同步给主进程。
   * 主进程据此收紧 llm-proxy 白名单——不做开放代理。
   */
  // 每一项是 `协议//host`：改写后的 llm-proxy:// 地址里没有协议，主进程只能从这份名单里取
  setProxyHosts: (hosts: string[]): Promise<string[]> => ipcRenderer.invoke('llm-proxy:setHosts', hosts),

  getProxyHosts: (): Promise<string[]> => ipcRenderer.invoke('llm-proxy:getHosts'),

  /**
   * 原生「保存文件」对话框；用户取消时返回 canceled。
   * title / filters 用来换对话框的标题与扩展名过滤（导出文档是 md / html）。
   */
  saveText: (payload: {
    suggestedName?: string
    content: string
    title?: string
    filters?: SaveFilter[]
  }): Promise<SaveTextResult> => ipcRenderer.invoke('file:saveText', payload),

  /**
   * 导出 PDF：给一份自带样式的 HTML，主进程在隐藏窗口里排版、打印，最后落到用户选的路径。
   * 返回 bytes 只是为了让界面能说一句「导出了多大」，不参与任何判断。
   */
  exportPdf: (payload: ExportPdfPayload): Promise<ExportPdfResult> =>
    ipcRenderer.invoke('file:exportPdf', payload),

  /**
   * 拖进来的文件 → 它的绝对路径。
   *
   * Electron 32 起 File.path 被删掉了，只剩这条官方替代路：webUtils 只能在 preload 里用，
   * 因此由这里转一手（渲染层拿到的就是一个 string）。
   */
  pathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  /**
   * 外部文件的读写。走单独的通道而不是 storage:*：后者只认数据根下的相对路径，
   * 而拖进来的文件在用户自己的目录里（见 electron/storage 的 LOCAL_TEXT_EXTS）。
   */
  local: {
    read: (path: string): Promise<LocalReadResult> => ipcRenderer.invoke('local:read', path),
    write: (path: string, content: string): Promise<LocalWriteResult> =>
      ipcRenderer.invoke('local:write', path, content),
    reveal: (path: string): Promise<StorageOk | StorageFail> => ipcRenderer.invoke('local:reveal', path),
    pick: (): Promise<{ ok: boolean; canceled?: boolean; paths?: string[] }> =>
      ipcRenderer.invoke('local:pick'),
    /**
     * 附件通道：**不设扩展名白名单**，读回来的是内容本身（图片给 dataUrl）。
     * 用户要发给导师的东西不该被「归一只支持这几种文本」那条规则挡住。
     */
    pickAttach: (): Promise<{ ok: boolean; canceled?: boolean; paths?: string[] }> =>
      ipcRenderer.invoke('local:pickAttach'),
    readAttach: (path: string): Promise<AttachReadResult> => ipcRenderer.invoke('local:readAttach', path),
    /**
     * 把「开着页签的本地文件」清单推给主进程挂 watcher；文件在外部被改时经
     * onChanged 推回（渲染层据此同步页签或标记保存冲突）。返回取消订阅函数。
     */
    watch: (paths: string[]): Promise<StorageOk> => ipcRenderer.invoke('local:watch', paths),
    onChanged: (cb: (path: string) => void): (() => void) => {
      const listener = (_e: unknown, changed: string) => cb(changed)
      ipcRenderer.on('local:changed', listener)
      return () => ipcRenderer.removeListener('local:changed', listener)
    },
  },

  /**
   * 数据落盘。渲染层传的一律是相对根目录的相对路径，越界由主进程挡掉
   * （见 electron/storage.ts）。YAML 的解析/序列化留在主进程，
   * 渲染层拿到的就是普通对象，格式细节只有一处。
   */
  storage: {
    /** 当前根目录、默认根目录，以及是否用的默认值 */
    info: (): Promise<StorageInfo> => ipcRenderer.invoke('storage:info'),

    /** 切换根目录；不传或传空串表示恢复默认。不迁移旧目录数据 */
    setRoot: (dir?: string): Promise<StorageRootResult> => ipcRenderer.invoke('storage:setRoot', dir),

    /** 弹原生目录选择框，只返回用户选了什么 */
    pickRoot: (): Promise<{ ok: boolean; canceled?: boolean; root?: string; error?: string }> =>
      ipcRenderer.invoke('storage:pickRoot'),

    list: (rel: string): Promise<StorageListResult> => ipcRenderer.invoke('storage:list', rel),

    /** 读文本；文件不存在返回 content: null，不算错误 */
    read: (rel: string): Promise<StorageReadResult> => ipcRenderer.invoke('storage:read', rel),

    write: (rel: string, content: string): Promise<StorageOk | StorageFail> =>
      ipcRenderer.invoke('storage:write', rel, content),

    /** 写一张图。走单独的通道：文本通道是 utf-8 的，二进制过不去 */
    writeImage: (rel: string, dataUrl: string): Promise<StorageOk | StorageFail> =>
      ipcRenderer.invoke('storage:writeImage', rel, dataUrl),

    /** 读一张图，回 base64 data URL */
    readImage: (rel: string): Promise<StorageImageResult> => ipcRenderer.invoke('storage:readImage', rel),

    /**
     * 写任意扩展名的二进制（资源库）。与 writeImage 分开：那条通道按扩展名白名单
     * 只收图片，这条不限类型（见 electron/storage.ts 的 writeBinary）。
     */
    writeBinary: (rel: string, dataUrl: string): Promise<StorageOk | StorageFail> =>
      ipcRenderer.invoke('storage:writeBinary', rel, dataUrl),

    /** 读任意扩展名的二进制，回 base64 data URL（mime 由扩展名推） */
    readBinary: (rel: string): Promise<StorageImageResult> => ipcRenderer.invoke('storage:readBinary', rel),

    /** 移动文件或整个目录。改标题时用它把资源库整个挪到新目录下 */
    move: (from: string, to: string): Promise<StorageOk | StorageFail> =>
      ipcRenderer.invoke('storage:move', from, to),

    /** 删除文件或整个目录 */
    remove: (rel: string): Promise<StorageOk | StorageFail> => ipcRenderer.invoke('storage:remove', rel),

    /** 新建一个目录（父目录连带建起；已存在同名时拒绝，见 mkdirPath） */
    mkdir: (rel: string): Promise<StorageOk | StorageFail> => ipcRenderer.invoke('storage:mkdir', rel),

    /** 在系统文件管理器里定位某个文件（节点右键菜单用） */
    reveal: (rel: string): Promise<StorageOk | StorageFail> => ipcRenderer.invoke('storage:reveal', rel),

    readYaml: (rel: string): Promise<StorageYamlResult> => ipcRenderer.invoke('storage:readYaml', rel),

    writeYaml: (rel: string, data: unknown): Promise<StorageOk | StorageFail> =>
      ipcRenderer.invoke('storage:writeYaml', rel, data),

    /** 会话是机器本地的登录态，存在 appdata，不属于任何数据目录 */
    readSession: (): Promise<StorageYamlResult> => ipcRenderer.invoke('storage:readSession'),

    writeSession: (data: unknown): Promise<StorageOk | StorageFail> =>
      ipcRenderer.invoke('storage:writeSession', data),

    /**
     * 同步写一批（sendSync）。页面卸载前调用：异步写在那时已经排不上队了。
     * 会阻塞渲染进程几毫秒，只该用在关窗这一类时刻。
     */
    flush: (items: FlushItem[]): { ok: boolean; failed: string[] } =>
      ipcRenderer.sendSync('storage:flush', items),
  },

  /**
   * 插件目录（`{root}/plugins/`）。主进程只递源码与开关，执行在渲染层
   * （见 src/lib/plugins：那里用 new Function 编译，插件通过 register() 交回对象）。
   */
  plugins: {
    list: (): Promise<PluginListResult> => ipcRenderer.invoke('plugins:list'),

    read: (file: string): Promise<PluginSourceResult> => ipcRenderer.invoke('plugins:read', file),

    /** 开关插件；写 enabled.json，**重启后生效** */
    setEnabled: (file: string, enabled: boolean): Promise<StorageOk | StorageFail> =>
      ipcRenderer.invoke('plugins:setEnabled', file, enabled),

    /** 在系统文件管理器里打开插件目录（用户要往里放 .js） */
    reveal: (): Promise<StorageOk | StorageFail> => ipcRenderer.invoke('plugins:reveal'),

    /** 内置插件的开关（存在 appdata 的 global.yaml，跟机器走；只有被改过的 id 才在里面） */
    toggles: (): Promise<PluginTogglesResult> => ipcRenderer.invoke('plugins:toggles'),

    /** 改一个内置插件的开关；**重启后生效** */
    setToggle: (id: string, enabled: boolean): Promise<StorageOk | StorageFail> =>
      ipcRenderer.invoke('plugins:setToggle', id, enabled),
  },

  /**
   * 代码块伪编译的产物与联网出口（见 electron/runner.ts）。
   *
   * 两件事都只能在这儿做：产物要落在**数据目录**里（活过重启），
   * 联网要被 CSP 挡在门外（渲染层的 Worker 连不上外网，只能请主进程代发）。
   */
  runner: {
    /** 全量产物表（渲染层启动时拉一次，之后本地维护） */
    artifacts: (): Promise<ArtifactListResult> => ipcRenderer.invoke('runner:artifacts'),

    /** 存一份产物（按「代码 + 语言」的指纹） */
    putArtifact: (key: string, value: CodeArtifact): Promise<StorageOk | StorageFail> =>
      ipcRenderer.invoke('runner:putArtifact', key, value),

    /** 记下「这段代码没有输出」：导师判定的结论，落盘之后那块不再可编译、不可运行 */
    putSilent: (key: string, value: SilentMark): Promise<StorageOk | StorageFail> =>
      ipcRenderer.invoke('runner:putSilent', key, value),

    /** 清空全部产物（设置页里的清理入口） */
    clearArtifacts: (): Promise<StorageOk | StorageFail> => ipcRenderer.invoke('runner:clearArtifacts'),

    /** 替沙箱发一次请求。**用户同不同意是渲染层弹窗的事**，这里只负责发 */
    fetch: (url: string, init: {
      method?: string
      headers?: Record<string, string>
      body?: string
    }): Promise<RunnerFetchResult> => ipcRenderer.invoke('runner:fetch', url, init),
  },

  /**
   * 语音模型：下载、读取字节、换一份、删掉。
   * 判定与联网都在主进程（见 electron/voice.ts）：渲染层的 CSP 连不上外网，
   * 而且 57 MB 的二进制该直接落盘，不该先经过渲染进程的内存。
   */
  voice: {
    modelStatus: (): Promise<VoiceModelStatus> => ipcRenderer.invoke('voice:modelStatus'),

    /** 从 HuggingFace 下一份 base q5_1（约 57 MB）；进度走 onModelProgress */
    downloadModel: (): Promise<VoiceDownloadResult> => ipcRenderer.invoke('voice:downloadModel'),

    cancelDownload: (): Promise<boolean> => ipcRenderer.invoke('voice:cancelDownload'),

    /** 从本机挑一个 .bin 模型（离线、或用户早就下过） */
    chooseModel: (): Promise<{ ok: boolean; canceled?: boolean; error?: string; bytes?: number }> =>
      ipcRenderer.invoke('voice:chooseModel'),

    /** 把模型字节交给渲染层（一次会话读一次，调用方自己缓存） */
    readModel: (): Promise<VoiceReadResult> => ipcRenderer.invoke('voice:readModel'),

    removeModel: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('voice:removeModel'),

    /** 在文件管理器里定位模型文件 */
    revealModel: (): Promise<boolean> => ipcRenderer.invoke('voice:revealModel'),

    /** 订阅下载进度；返回取消订阅函数 */
    onModelProgress: (cb: (p: VoiceModelProgress) => void): (() => void) => {
      const listener = (_e: unknown, p: VoiceModelProgress) => cb(p)
      ipcRenderer.on('voice:modelProgress', listener)
      return () => ipcRenderer.removeListener('voice:modelProgress', listener)
    },
  },
  /**
   * 自动更新。渲染层不决定任何事：什么时候查、下没下完、能不能装，
   * 全由主进程的状态说了算，这里只转发。
   */
  update: {
    /** 当前状态。挂载时先要一次，之后靠 onState 推 */
    state: (): Promise<UpdateState> => ipcRenderer.invoke('update:state'),

    /** 手动检查（设置 → 更新里的按钮）。任何时候都能查，哪怕关掉了自动更新 */
    check: (): Promise<UpdateState> => ipcRenderer.invoke('update:check'),

    /** 下载查到的那个新版本（关掉自动更新时，这一档要用户自己点） */
    download: (): Promise<UpdateState> => ipcRenderer.invoke('update:download'),

    /** 要不要自动检查并下载更新（全局设置，跟机器走） */
    getAuto: (): Promise<boolean> => ipcRenderer.invoke('update:getAuto'),

    /** 改这个开关；返回存盘后真正生效的值 */
    setAuto: (value: boolean): Promise<boolean> => ipcRenderer.invoke('update:setAuto', value),

    /** 立即更新：关掉应用、静默安装、装完自动启动。只在 ready 时有效 */
    install: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('update:install'),

    /** 在系统浏览器里打开这次更新的发布页 */
    openRelease: (): Promise<boolean> => ipcRenderer.invoke('update:openRelease'),

    /**
     * 订阅状态变化。返回取消订阅函数——组件卸载时必须调用，
     * 否则监听会随重挂载越积越多。
     */
    onState: (cb: (state: UpdateState) => void): (() => void) => {
      const listener = (_e: unknown, state: UpdateState) => cb(state)
      ipcRenderer.on('update:state', listener)
      return () => ipcRenderer.removeListener('update:state', listener)
    },
  },

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    /** 打开 / 重新打开开发者工具（已开则先关后开，保证它浮在最上层） */
    devtools: (): void => ipcRenderer.send('window:devtools'),
    /**
     * 订阅最大化状态变化（自绘标题栏据此换图标）。
     * 返回取消订阅函数——组件卸载时必须调用，否则监听会随重挂载越积越多。
     */
    onMaximizeChange: (cb: (maximized: boolean) => void): (() => void) => {
      const listener = (_e: unknown, maximized: boolean) => cb(maximized)
      ipcRenderer.on('window:maximizeChange', listener)
      return () => ipcRenderer.removeListener('window:maximizeChange', listener)
    },
    /** 提示音（api.tiktok）：主进程走 Electron 的 beep */
    beep: (): void => ipcRenderer.send('window:beep'),
    /**
     * 截取窗口内容的一块（文档区截图用）：rect 是相对窗口内容区的 CSS 像素矩形，
     * 省略则截整窗。返回 PNG data URL。
     */
    capture: (rect?: { x: number; y: number; width: number; height: number }): Promise<CaptureResult> =>
      ipcRenderer.invoke('window:capture', rect),
    /** logo.svg 原文（运行时给任务栏 / 托盘图标染色用，见 lib/appIcon） */
    logoSource: (): Promise<string> => ipcRenderer.invoke('app:logoSource'),
    /** 把染色后的 PNG 设为窗口（任务栏）与托盘图标 */
    setAppIcon: (dataUrl: string): Promise<boolean> => ipcRenderer.invoke('app:setAppIcon', dataUrl),
  },

  /**
   * 考试窗口的**主窗口那一侧**。
   *
   * 考试窗口是第二个 BrowserWindow，加载的是**同一份渲染产物**（`?examWindow=1` 分支，
   * 见 electron/main.ts 的 openExamWindow）。主进程在这条链路上只做三件事：开窗、转发、关窗，
   * **不解释任何考试数据**（载荷一律 unknown 原样中转）。
   *
   * 两侧的分工也照此定死：主窗口是**唯一的数据拥有者**（答案、答题顺序、切屏记录、判分结果
   * 都由它落盘），考试窗口只发事件、收状态。这样「谁是权威」不靠约定靠结构。
   */
  examHost: {
    /**
     * 开考试窗口。已经开着就把那一个叫到前面来（reused: true），不另开第二个——
     * 两个窗口对着同一份试卷各记一份答题时间，事后谁都说不清哪份算数。
     *
     * payload 是「开窗时顺手带过去」的那份状态（主进程不看它，页面加载完后补发一次）。
     * **不能当可靠投递**：渲染层的 onState 往往比 did-finish-load 挂得晚。
     * 稳妥的写法是拿到 { ok: true } 之后自己 push 一份，或等考试界面 emit 一个「准备好了」。
     */
    open: (payload: unknown): Promise<ExamOpenResult> => ipcRenderer.invoke('exam:open', payload),

    /** 把当前状态推给考试窗口（两边自己约定的形状，主进程不看） */
    push: (payload: unknown): void => ipcRenderer.send('exam:push', payload),

    /** 要求关掉考试窗口。走这条路的关闭不再弹确认（主窗口已经问过了） */
    close: (): void => ipcRenderer.send('exam:close'),

    /**
     * 订阅考试窗口发来的事件。返回取消订阅函数——组件卸载时必须调用，
     * 否则监听会随重挂载越积越多。
     */
    onEvent: (cb: (payload: unknown) => void): (() => void) => {
      const listener = (_e: unknown, payload: unknown) => cb(payload)
      ipcRenderer.on('exam:windowEvent', listener)
      return () => ipcRenderer.removeListener('exam:windowEvent', listener)
    },

    /**
     * 考试窗口关掉了（任何原因，含用户确认放弃、主窗口要求、应用退出）。
     * 主窗口据此收尾：停掉那边的计时、把状态从「考试中」放下来。
     */
    onClosed: (cb: (info: { reason: string }) => void): (() => void) => {
      const listener = (_e: unknown, info: { reason: string }) => cb(info)
      ipcRenderer.on('exam:windowClosed', listener)
      return () => ipcRenderer.removeListener('exam:windowClosed', listener)
    },
  },

  /**
   * 考试窗口的**考试窗口那一侧**。
   *
   * 这一侧只能发事件、收状态、要求全屏、放行关闭——**没有任何一条通道能写盘**：
   * 考试数据一律回主窗口，由它落盘（见上面 examHost 的说明）。
   */
  examGuest: {
    /** 向主窗口发一个事件（开始考试、作答、交卷…形状由两侧自己约定，主进程不看） */
    emit: (payload: unknown): void => ipcRenderer.send('exam:emit', payload),

    /** 订阅主窗口推来的状态；返回取消订阅函数（组件卸载时必须调用） */
    onState: (cb: (payload: unknown) => void): (() => void) => {
      const listener = (_e: unknown, payload: unknown) => cb(payload)
      ipcRenderer.on('exam:state', listener)
      return () => ipcRenderer.removeListener('exam:state', listener)
    },

    /**
     * 用户试图关窗（系统关闭键 / Alt+F4 / 界面上的退出按钮）。
     *
     * 主进程已经把默认行为挡住了：要不要弹一次「确认放弃」，由考试界面自己决定
     * （未开始就退出 → 直接 allowClose；考到一半 → 先问）。主进程不问，因为它不知道
     * 这一场到底开没开始。
     */
    onConfirmClose: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('exam:confirmClose', listener)
      return () => ipcRenderer.removeListener('exam:confirmClose', listener)
    },

    /** 开始考试后全屏（退出全屏传 false） */
    setFullscreen: (on: boolean): void => ipcRenderer.send('exam:fullscreen', on === true),

    /**
     * 「确认放弃 / 已交卷」之后放行关闭。放行只是**许可**，真正关窗还要界面自己调
     * window.close()——这样「先确认、再关」的顺序看得见，不会出现确认框还没画出来
     * 窗口就没了的情况。
     */
    allowClose: (): void => ipcRenderer.send('exam:allowClose'),
  },

  /**
   * 外壳行为：关窗策略与托盘。
   *
   * 策略存在主进程（appdata 里的 global.yaml），这里只负责读写：真正拦关窗的是主进程，
   * 渲染层再存一份迟早会不一致。
   */
  /**
   * 抓网页。渲染层的 fetch 受同源策略约束（抓任意站点一律被 CORS 挡下），
   * 所以字节由主进程取（见 electron/web）：这里只是那一个频道的转发。
   */
  web: {
    fetch: (url: string): Promise<WebFetchResult> => ipcRenderer.invoke('web:fetch', url),
  },

  /**
   * 内置浏览器页签（见 src/components/learn/web 与 electron/app/webSession）。
   * 两条都是主进程推、渲染层收：
   * - onOpenTab —— 网页的弹窗 / target=_blank 要开的新页签（拦截与协议判定在主进程）；
   * - onShortcut —— 焦点在网页里时按下的应用快捷键（Ctrl+Q/W/L），转发回来当 DOM 键用。
   * 都返回取消订阅函数。
   */
  browser: {
    onOpenTab: (cb: (url: string) => void): (() => void) => {
      const listener = (_e: unknown, url: string): void => cb(url)
      ipcRenderer.on('web:openTab', listener)
      return () => ipcRenderer.removeListener('web:openTab', listener)
    },
    onShortcut: (cb: (key: string) => void): (() => void) => {
      const listener = (_e: unknown, key: string): void => cb(key)
      ipcRenderer.on('web:shortcut', listener)
      return () => ipcRenderer.removeListener('web:shortcut', listener)
    },
    /** 页面快照：Accessibility 树 → 带 ref 的可交互元素清单（browser.* 的「看」通道） */
    snapshot: (wcId: number): Promise<WebSnapshotResult> => ipcRenderer.invoke('web:snapshot', wcId),
    /** 把 { ref } / { selector } 解析成视口坐标（主进程 CDP：滚进视野 + 取元素四边形中心） */
    locate: (
      wcId: number,
      target: { ref: number } | { selector: string },
    ): Promise<{ x: number; y: number } | { error: string }> => ipcRenderer.invoke('web:locate', wcId, target),
  },

  shell: {
    /** 当前关窗行为 */
    getCloseBehavior: (): Promise<CloseBehavior> => ipcRenderer.invoke('shell:getCloseBehavior'),

    setCloseBehavior: (value: CloseBehavior): Promise<CloseBehavior> =>
      ipcRenderer.invoke('shell:setCloseBehavior', value),

    /** 回答关窗询问；remember 为真时把这次的选择存成策略 */
    decideClose: (action: CloseAction, remember: boolean): Promise<{ ok: boolean; behavior: CloseBehavior }> =>
      ipcRenderer.invoke('window:closeDecision', action, remember),

    /**
     * 用系统浏览器打开一个地址（http / https / mailto）。
     * 协议判定在主进程（见 electron/link-core）：渲染层能被开发者工具改，这条边界不能只靠它自觉。
     */
    openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('shell:openExternal', url),

    /** 立刻收进托盘（设置面板里的按钮） */
    hideToTray: (): void => ipcRenderer.send('window:hideToTray'),

    /**
     * 订阅「主进程要关窗，问一下」——只在策略是「询问」时才会来。
     * 返回取消订阅函数，组件卸载时必须调用。
     */
    onCloseRequested: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('window:closeRequested', listener)
      return () => ipcRenderer.removeListener('window:closeRequested', listener)
    },
  },
}

export type MojiNative = typeof api

contextBridge.exposeInMainWorld('mojiNative', api)