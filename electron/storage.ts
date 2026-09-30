/**
 * 数据落盘：全局设置与本机文件读写。
 *
 * 渲染进程以 contextIsolation + sandbox 运行，碰不到 fs，全部文件操作经由这里的
 * IPC 通道完成（见 preload.ts 的 window.mojiNative.storage）。
 *
 * 分两层：
 * - **全局设置**：用户数据存储根目录与关窗行为，落在 appdata（app.getPath('userData')、
 *   即 global.yaml）。它们跟这台机器绑定，不属于任何用户，因此不进数据目录。
 * - **用户数据**：全部在 `{root}/users/{uid}/` 之下，由渲染层组织具体结构
 *   （user.yaml / setting.yaml / docs/…），主进程只保证路径不越界。
 *
 * 越界防护：渲染层传进来的一律是相对路径，这里逐段校验后 resolve 到 root 之内，
 * 任何绝对路径、盘符、`..` 都会被拒。渲染层是本应用自己的代码，但数据目录里
 * 还放着用户自己的文件，值得多这一道。
 *
 * 实现按职责拆在 electron/storage/ 下，这一份只做转出——从原路径 import 到的符号与从前一模一样：
 *   settings.ts 全局设置与依赖图最底层的小工具 / files.ts 文本与路径 / binary.ts 二进制
 *   flush.ts    关窗前的同步落盘 / local.ts 外部文件与监听 / attach.ts 附件 / ipc.ts 通道注册
 */

export type { CloseBehavior, GlobalSettings } from './storage/settings'
export type { FlushItem } from './storage/flush'
export type { AttachRead } from './storage/attach'
export {
  CLOSE_BEHAVIORS,
  autoUpdate,
  closeBehavior,
  currentRoot,
  defaultRoot,
  isCloseBehavior,
  pluginToggles,
  setAutoUpdate,
  setCloseBehavior,
  setPluginToggle,
  setUiLocale,
  startupBackground,
  uiLocale,
} from './storage/settings'
export { markLocalOwnWrite, setLocalWatchList } from './storage/local'
export { registerStorageIpc } from './storage/ipc'
