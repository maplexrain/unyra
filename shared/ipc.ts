/**
 * 渲染层与主进程共用的 IPC 契约类型——同一个契约只留这一份。
 *
 * 这些形状原先在 `electron/preload.ts`（主进程暴露出去的形状）与 `src/lib/native.ts`
 * （渲染层看到的 preload 形状）里各写一份、逐字重复，另外在 electron/runner.ts、
 * electron/plugins.ts、electron/voice.ts、electron/storage/**、src/lib/codeArtifacts.ts
 * 里还有同名同体的副本。漏改一侧不会编译报错，只会在运行时炸——所以只在这里留一份，
 * 其余各文件从这里 `import type` 之后按原样再转出去（调用方的 import 路径不变）。
 *
 * 三条约定：
 * - 这里**只有类型与接口**，一个运行时值都不许放：本文件会被渲染层与主进程同时引入，
 *   放值就会把一侧的实现拖进另一侧的包里。
 * - 通道名字符串（`'storage:read'` 之类）留在各自的实现里——它们是实现细节，不是契约形状。
 * - 每个类型上面那句「谁在用」写的是它跨进程的两端，改字段之前先看那两端。
 */

/* ---------- 内置浏览器（webview 网页页签） ---------- */

/** 页面快照里的一枚可交互元素（browser.snapshot 清单的项）。
 *  谁在用：主进程 electron/app/webSession.ts（Accessibility 树转换，见 shared/axTree.ts），
 *  preload 的 browser.snapshot，渲染层 src/learn/web/browserOps 的 api.browser.snapshot。 */
export interface WebSnapshotElement {
  /** 编号（每次快照从 1 重新数）；click / type 的目标可写成 { ref } 按号指名 */
  ref: number
  /** 无障碍角色：button / link / textbox / heading … */
  role: string
  /** 无障碍名称（按钮文字、链接文字、输入框的标签…） */
  name: string
  /** 输入框的当前值（只有文本框类才有） */
  value?: string
}

/** browser.snapshot 的返回：元素清单，或一句人话错误。谁在用：同上。 */
export type WebSnapshotResult =
  | { elements: WebSnapshotElement[]; truncated?: boolean }
  | { error: string }

/* ---------- 窗口外壳 / 数据落盘 ---------- */

/**
 * 关窗行为：点关闭按钮时做什么。默认「询问」——不替用户预设，让他自己选一次
 * （并可勾选「不再询问」把这次的选择记住）。
 *
 * - ask：弹窗问一次（对话框由渲染层画，见 src/components/CloseDialog.tsx）
 * - close：直接关掉、退出程序
 * - tray：收进托盘，程序留在后台继续跑
 *
 * 谁在用：preload 的 shell.getCloseBehavior / setCloseBehavior（主进程 electron/storage/ipc.ts 收发），
 * 渲染层 src/lib/closeBehavior.ts 与 src/components/CloseDialog.tsx。
 */
export type CloseBehavior = 'ask' | 'close' | 'tray'

/** 关窗询问的回答：cancel 表示这次不关，窗口留着。
 *  谁在用：preload 的 shell.decideClose（通道 window:closeDecision，主进程 electron/app/ipc.ts），
 *  渲染层 src/components/CloseDialog.tsx 收集这一次选择。 */
export type CloseAction = 'close' | 'tray' | 'cancel'

/** 数据根目录：当前用的是哪个、默认是哪个、是不是就是默认的。
 *  谁在用：preload 的 storage.info（通道 storage:info，主进程 electron/storage/ipc.ts），
 *  渲染层 src/lib/storage.ts 与 src/components/settings/StoragePanel.tsx。 */
export interface StorageInfo {
  /** 当前生效的用户数据根目录 */
  root: string
  /** 默认根目录（appdata 里的应用数据目录） */
  defaultRoot: string
  /** 当前是否用的就是默认根目录 */
  isDefault: boolean
}

/** 数据目录里的一项（文件或目录）。
 *  谁在用：preload 的 storage.list（见下面 preload 侧那份 StorageListResult），
 *  渲染层 src/lib/storage.ts 的 listDir。 */
export interface StorageEntry {
  name: string
  dir: boolean
}

/** 同步落盘的一批条目：页面卸载前走 sendSync 的 storage:flush，异步写在那时已经排不上队。
 *  谁在用：preload 的 storage.flush、主进程 electron/storage/flush.ts 的 flushSync，
 *  渲染层 src/lib/storage.ts 的 flushCommitsSync 与 src/learn/store/assets.ts。 */
export interface FlushItem {
  rel: string
  /** 'yaml' | 'json' 决定怎么序列化；给了 remove 或 move 就忽略它 */
  kind?: 'yaml' | 'json'
  data?: unknown
  /** true 表示删除该路径 */
  remove?: boolean
  /** 移动的目标路径；配合 move 使用 */
  to?: string
  /**
   * true 表示把 rel 整个挪到 to（见 movePath）。与 remove 互斥。
   * 数组顺序由调用方保证：**移动项必须排在删除项之前**，否则改名的删除
   * 会把还没挪走的资源一起删掉。
   */
  move?: boolean
}

/* ---------- 插件目录（{root}/plugins/） ---------- */

/** 插件目录里的一个 .js（见 electron/plugins.ts）。执行在渲染层，主进程只把源码递过去。
 *  谁在用：主进程 electron/plugins.ts 的 listPlugins、preload 的 plugins.list，
 *  渲染层 src/lib/plugins.ts 与设置 → 插件。 */
export interface PluginEntry {
  /** 文件名，也是这个插件的标识（启用清单里存的就是它） */
  file: string
  bytes: number
  /** 改动时间（毫秒时间戳）：设置页显示「什么时候放进来的」 */
  mtime: number
  enabled: boolean
}

/** 列出插件目录的结果。
 *  谁在用：preload 的 plugins.list（通道 plugins:list）、主进程 electron/plugins.ts 的 listPlugins。
 *  注：渲染层那一侧另有一份同体不同名的 PluginList（见 src/lib/native.ts），未合并。 */
export type PluginListResult =
  | { ok: true; dir: string; entries: PluginEntry[] }
  | { ok: false; error: string }

/** 读一个插件的源码的结果：只有启用清单里的文件才会来读。
 *  谁在用：preload 的 plugins.read（通道 plugins:read）、主进程 electron/plugins.ts 的 readPluginSource。
 *  注：渲染层那一侧另有一份同体不同名的 PluginSource（见 src/lib/native.ts），未合并。 */
export type PluginSourceResult = { ok: true; content: string } | { ok: false; error: string }

/** 内置插件的开关：id → 要不要开（没记过的按各自默认值）。
 *  谁在用：preload 的 plugins.toggles（通道 plugins:toggles）、主进程 electron/plugins.ts；
 *  落盘是 appdata 里的 global.yaml（见 electron/storage/settings.ts）。 */
export type PluginTogglesResult =
  | { ok: true; toggles: Record<string, boolean> }
  | { ok: false; error: string }

/* ---------- 代码块的伪编译产物 ---------- */

/**
 * 一份伪编译产物：编译出来的 JS + 那次的说明 + 是谁编的。
 *
 * 为什么把源码也存进去：键是「代码 + 语言」的指纹（见 src/lib/codeArtifacts.ts），
 * 指纹理论上会撞；读回来时对着 code 核一眼，撞了就当没有这份产物——
 * 大不了重编一次，绝不能让另一段代码的产物跑到这一块下面去跑。
 *
 * 谁在用：主进程 electron/runner.ts 的 runcache.json、preload 的 runner.artifacts /
 * runner.putArtifact，渲染层 src/lib/codeArtifacts.ts 与 src/lib/codeBlockMenu.ts。
 */
export interface CodeArtifact {
  /** 被编译的那段源码（原样存着：读回来时用它核对，见 codeArtifacts 的碰撞处理） */
  code: string
  /** 语言标记（可能没有：围栏上没写语言） */
  languageId: string | null
  /** 编译产物：一段可直接执行的 JS */
  js: string
  /** 模型写的那句说明（补了哪些假上下文、做了什么改动） */
  note: string
  /** 哪个模型编的（界面要显示，也方便日后判断产物是不是该重编） */
  model: string
  /** 落盘时刻 */
  at: number
}

/**
 * 「这段代码没有输出」的标记（由**超级导师**判定，见 src/lib/codeArtifacts 的 submitSilent）。
 *
 * 它不是缓存，是一条结论：导师看过这段代码，认定它跑不出任何东西。被标上的代码块
 * 从此不再显示编译与运行（重启也是），所以必须落盘。
 *
 * 谁在用：主进程 electron/runner.ts 的 runcache.json、preload 的 runner.putSilent，
 * 渲染层 src/lib/codeArtifacts.ts 的内存表 silent。
 */
export interface SilentMark {
  /** 被判定无输出的那段源码（读回来时核对，防指纹碰撞） */
  code: string
  languageId: string | null
  /** 导师给的一句话：为什么它没有输出 */
  reason: string
  at: number
}

/* ---------- 语音模型 ---------- */

/** 语音模型（whisper.cpp 的 ggml base q5_1）在本机的状态。
 *  谁在用：主进程 electron/voice.ts 的 statusOf、preload 的 voice.modelStatus，
 *  渲染层 src/lib/voice/model.ts。 */
export interface VoiceModelStatus {
  /** 模型文件在本机的完整路径 */
  path: string
  exists: boolean
  bytes: number
  /** 官方下载地址 */
  url: string
  /** 有哪几个下载源（官方 + 国内镜像） */
  sources: string[]
}

/** 下载进度（主进程每 512 KB 推一次）。
 *  谁在用：主进程 electron/voice.ts 推送的 voice:modelProgress、preload 的 voice.onModelProgress，
 *  渲染层 src/lib/voice/model.ts。 */
export interface VoiceModelProgress {
  received: number
  total: number
  percent: number
  /** 一句话进度说明（换源、开始下载时给） */
  note?: string
}

/** 下载（或换一份）语音模型的结果。
 *  谁在用：主进程 electron/voice.ts、preload 的 voice.downloadModel / voice.chooseModel。 */
export interface VoiceDownloadResult {
  ok: boolean
  error?: string
  bytes?: number
  /** 这一份是从哪个源下回来的（界面要告诉用户，出问题时好排查） */
  source?: string
}

/** 把模型字节读给渲染层的结果（一次会话读一次，调用方自己缓存）。
 *  谁在用：主进程 electron/voice.ts、preload 的 voice.readModel，
 *  渲染层 src/lib/voice/model.ts。 */
export type VoiceReadResult = { ok: boolean; bytes?: Uint8Array; error?: string }

/* ---------- 原生导入导出 ---------- */

/** 保存对话框的扩展名过滤：导出文档时给 md / html，不给就按 JSON 走。
 *  谁在用：preload 的 saveText 的 payload.filters、主进程 electron/app/ipc.ts 的 file:saveText，
 *  渲染层 src/lib/exportDoc.ts 与 src/components/learn/workspace/useDocExport.ts。 */
export interface SaveFilter {
  name: string
  extensions: string[]
}

/** 导出 PDF 的请求：渲染层给一份自带样式的整份 HTML，排版在主进程的隐藏窗口里做。
 *  谁在用：preload 的 exportPdf（通道 file:exportPdf，排版见 electron/app/exportPdf.ts），
 *  渲染层 src/lib/exportDoc.ts 与 src/components/learn/workspace/useDocExport.ts。 */
export interface ExportPdfPayload {
  suggestedName?: string
  html: string
  pageSize?: 'A4' | 'A3' | 'Letter'
  landscape?: boolean
  /** 页脚打「第 n / 共 m 页」 */
  pageNumbers?: boolean
}

/** 导出 PDF 的结果：bytes 只为了让界面能说一句「导出了多大」，不参与任何判断。
 *  谁在用：preload 的 exportPdf、主进程 electron/app/exportPdf.ts，
 *  渲染层 src/components/learn/workspace/useDocExport.ts。 */
export type ExportPdfResult =
  | { ok: true; path: string; bytes: number }
  | { ok: false; canceled?: boolean; error?: string }

/* ---------- 数据落盘的通用结果 ---------- */

/** 落盘失败的通用形状。
 *  谁在用：preload 的 storage.* / local.* / plugins.* / runner.* 的一半返回值，
 *  主进程 electron/storage/**。 */
export type StorageFail = { ok: false; error: string }

/** 落盘成功的通用形状（不关心写了什么）。
 *  谁在用：preload 的 storage.* / local.* / plugins.* / runner.* 的一半返回值，
 *  主进程 electron/storage/**。 */
export type StorageOk = { ok: true }

/** 切换数据根目录的结果。
 *  谁在用：preload 的 storage.setRoot（通道 storage:setRoot，主进程 electron/storage/ipc.ts），
 *  渲染层 src/lib/storage.ts 与 src/components/settings/StoragePanel.tsx。 */
export type StorageRootResult = { ok: boolean; root: string; error?: string }

/* ---------- 自动更新 ---------- */

/**
 * 自动更新处在哪一档。判定、联网、下载全在主进程（见 electron/update.ts）；
 * 渲染层只做两件事：把它推过来的状态画出来、在用户点了之后说一声「装」。
 *
 * 同样的理由：这里是渲染层，能打开开发者工具改，
 * 所以「有没有新版本」「能不能装」一律以主进程的结论为准。
 *
 * 谁在用：主进程 electron/update.ts、preload 的 update.*，
 * 渲染层 src/lib/update.ts 与 src/components/settings/UpdatePanel.tsx。
 */
export type UpdatePhase =
  /** 这个构建不参与自动更新（开发运行、非 Windows）——界面什么都不该显示 */
  | 'disabled'
  /** 还没查过，或已是最新 */
  | 'idle'
  | 'checking'
  /** 查到了新版本，但还没开始下（关掉「自动检查更新」时才会停在这一档） */
  | 'available'
  /** 后台下载中：顶栏不显示任何东西，进度在设置 → 更新里 */
  | 'downloading'
  /** 下载完成，等用户点 */
  | 'ready'
  | 'installing'
  /** 出错了。只影响这次更新，当前版本照常用 */
  | 'error'

/** 失败归类；中文说法见 lib/update.ts 的 updateFailText。
 *  谁在用：主进程 electron/update.ts、preload 的 update.*，
 *  渲染层 src/lib/update.ts。 */
export type UpdateFail =
  /** 连不上 GitHub（DNS/超时/连接被断） */
  | 'network'
  /** 发布仓库里还没有正式发行版 */
  | 'no-release'
  /** 有发行版，但缺更新元数据（latest.yml） */
  | 'not-found'
  /** 下载回来的包哈希对不上 */
  | 'checksum'
  | 'download'
  | 'install'
  | 'http'
  | 'unknown'

/** 自动更新的一份状态：查没查到、下没下完、能不能装。
 *  谁在用：主进程 electron/update.ts 的 update:state、preload 的 update.*，
 *  渲染层 src/lib/update.ts 与 src/components/settings/UpdatePanel.tsx。 */
export interface UpdateState {
  phase: UpdatePhase
  /** 当前运行的版本 */
  current: string
  /** 发现的新版本 */
  version?: string
  /** 发布标题 */
  releaseName?: string
  /** 更新说明（HTML，来自 GitHub Release 正文）——渲染前必须消毒 */
  notes?: string
  /** 安装包文件名（界面要显示「下的是哪个包」） */
  fileName?: string
  /** 安装包体积（字节） */
  size?: number
  /** 已下载字节 */
  transferred?: number
  /** 下载速度（字节/秒） */
  bytesPerSecond?: number
  /** 下载进度 0-100 */
  percent?: number
  reason?: UpdateFail
  /** 失败的原始信息 */
  detail?: string
  /** 发布页地址 */
  releaseUrl?: string
  /** 最近一次检查结束的时间 */
  checkedAt?: number
}

/* ---------- 考试窗口 ---------- */

/** 开考试窗口的结果。`reused` 为真表示**没有新开**，只是把已经开着的那个叫到了前面：
 *  全局只允许一个考试窗口（见 electron/app/examWindow.ts 的 exam:open）。
 *  谁在用：preload 的 examHost.open、主进程 electron/app/examWindow.ts，
 *  渲染层 src/learn/useExamBridge.ts。 */
export interface ExamOpenResult {
  ok: boolean
  reused?: boolean
  error?: string
}

/** 考试窗口关掉的原因：host = 主窗口要求关；quit = 应用退出 / 主窗口没了；closed = 考试界面自己放行。
 *  谁在用：主进程 electron/app/examWindow.ts 的 exam:windowClosed、
 *  preload 的 examHost.onClosed，渲染层 src/learn/useExamBridge.ts。 */
export type ExamCloseReason = 'host' | 'quit' | 'closed'

/* ---------- 附件 / 抓网页 ---------- */

/**
 * 附件（要发给超级导师的文件）的读取结果。
 *
 * 与外面那条本地文件通道（只读 md / txt / html）不同：这条**不设扩展名白名单**，
 * 读回来先分好类——图片给 dataUrl、文本给正文、其余只报体积。
 *
 * 谁在用：preload 的 local.readAttach（主进程 electron/storage/attach.ts 的 readAttach），
 * 渲染层 src/learn/attachments.ts 与 src/components/agent/panel/useComposer.ts。
 */
export interface AttachReadResult {
  ok: boolean
  name?: string
  bytes?: number
  kind?: 'image' | 'text' | 'binary'
  text?: string
  dataUrl?: string
  truncated?: boolean
  error?: string
}

/** 抓网页的结果（主进程去取字节：渲染层的 fetch 受同源策略约束，抓不了任意站点）。
 *  谁在用：preload 的 web.fetch（通道 web:fetch，主进程 electron/web.ts），
 *  渲染层 src/learn/webDocs.ts 与 src/agent/sandbox/api.ts。 */
export type WebFetchResult =
  | {
      ok: true
      url: string
      finalUrl: string
      status: number
      contentType: string
      kind: 'html' | 'text' | 'other'
      text: string
      bytes: number
      truncated: boolean
    }
  | { ok: false; error: string }
