/**
 * 这个文件负责什么：IPC 契约的**插件目录（{root}/plugins/）**通道组——插件条目、
 * 清单/源码/开关结果与声明式设置面板的读写结果。
 * 原先与其它组同写在 shared/ipc.ts，按通道组拆到这里；形状逐字未动，
 * 对外一律经门面 shared/ipc.ts 原样转出，调用方 import 路径不变。
 */

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

