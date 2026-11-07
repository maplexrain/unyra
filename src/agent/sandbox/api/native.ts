/**
 * 这个文件负责什么：宿主原生桥（window.mojiNative）上「真实文件系统」与「受控进程」
 * 两条通道的取用函数。原内联在 api.ts 的 buildApi 里，被 files.* / process.* / skill.*
 * 三组共用，提出来做模块级共享；只做窗口探测，不持有快照，无桥时回 null，
 * 由各 api 自己兜 mock 实现。
 */

/** 取宿主注入的真实文件系统通道（files.* 用） */
export const getNativeFiles = () => {
  if (typeof window !== 'undefined') {
    if (window.mojiNative?.files) return window.mojiNative.files
    if (window.mojiNative?.base?.files) return window.mojiNative.base.files
  }
  return null
}

/** 取宿主注入的受控进程通道（process.* / skill.run 用） */
export const getNativeProcess = () => {
  if (typeof window !== 'undefined') {
    if (window.mojiNative?.process) return window.mojiNative.process
    if (window.mojiNative?.base?.process) return window.mojiNative.base.process
  }
  return null
}
