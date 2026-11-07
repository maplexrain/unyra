/**
 * 这个文件负责什么：IPC 契约的**考试窗口**通道组——考试窗口开关回执、关窗原因与
 * 手写答卷裁切/旋转结果（见 electron/app/examWindow.ts）。
 * 原先与其它组同写在 shared/ipc.ts，按通道组拆到这里；形状逐字未动，
 * 对外一律经门面 shared/ipc.ts 原样转出，调用方 import 路径不变。
 */

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

export type CropBoxInput =
  | [number, number, number, number]
  | { x: number; y: number; width: number; height: number }
  | { ymin: number; xmin: number; ymax: number; xmax: number }

export interface CropImageResult {
  ok: boolean
  croppedPath?: string
  dataUrl?: string
  error?: string
}

export interface PreviewCropResult {
  ok: boolean
  previewPath?: string
  dataUrl?: string
  rect?: { x: number; y: number; width: number; height: number }
  box?: [number, number, number, number]
  error?: string
}

export interface RotateImageResult {
  ok: boolean
  rotatedPath?: string
  dataUrl?: string
  error?: string
}

