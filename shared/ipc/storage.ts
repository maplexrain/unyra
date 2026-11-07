/**
 * 这个文件负责什么：IPC 契约的**窗口外壳 / 数据落盘**通道组——关窗行为、数据根目录、
 * 目录项、同步 flush 条目，以及落盘成功/失败/换根的通用结果。
 * 原先与其它组同写在 shared/ipc.ts，按通道组拆到这里；形状逐字未动，
 * 对外一律经门面 shared/ipc.ts 原样转出，调用方 import 路径不变。
 */

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
/** 插件配置（声明式设置面板）的读写结果：values 是解密后的明文键值 */
export interface PluginSettingsResult {
  ok: boolean
  values?: Record<string, string | number | boolean>
  error?: string
}

export interface StorageInfo {
  /** 当前生效的用户数据根目录 */
  root: string
  /** 默认根目录（appdata 里的应用数据目录） */
  defaultRoot: string
  /** 当前是否用的就是默认根目录 */
  isDefault: boolean
  /**
   * 数据根与**软件安装目录**的包含关系风险。更新走 NSIS 静默安装，会先静默卸载
   * 旧版本——卸载器清整个安装目录，数据根只要与它有包含关系，数据就会在更新时
   * 被一并删除（用户实测踩过）。非空时设置页要挂警告、更新安装要拦截。
   */
  rootRisk?: RootRisk
}

/** 数据根 × 安装目录的风险类型（判定见 electron/storage/settings 的 dataRootRiskOf） */
export type RootRisk =
  /** 数据根在安装目录里面：更新必删 */
  | 'inside-install-dir'
  /** 数据根包含安装目录：安装目录那棵子树必删（数据可能幸存，但同样不可接受） */
  | 'contains-install-dir'

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

