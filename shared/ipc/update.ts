/**
 * 这个文件负责什么：IPC 契约的**自动更新**通道组——更新策略、阶段、失败归类与状态
 * （见 electron/update.ts）。
 * 原先与其它组同写在 shared/ipc.ts，按通道组拆到这里；形状逐字未动，
 * 对外一律经门面 shared/ipc.ts 原样转出，调用方 import 路径不变。
 */

/* ---------- 自动更新 ---------- */

/**
 * 更新策略（通道）：这个客户端按哪一档接收新版本。
 *
 * - stable 正式版：只收正式发行版（版本号 vX.Y.Z），最稳，节奏慢；
 * - beta 尝鲜版：正式版与尝鲜版（vX.Y.Z-beta.N）都收，新功能来得快、可能不稳。
 *
 * 落在全局设置（appdata 的 global.yaml，跟机器走）；真正决定取哪个版本的是
 * 主进程的 autoUpdater.allowPrerelease（见 electron/update.ts），
 * 渲染层只负责选择与展示。
 *
 * 谁在用：主进程 electron/update.ts 与 electron/storage/settings.ts、
 * preload 的 update.*，渲染层 src/lib/update.ts 与 src/components/settings/UpdatePanel.tsx。
 */
export type UpdateChannel = 'stable' | 'beta'

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

