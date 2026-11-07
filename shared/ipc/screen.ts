/**
 * 这个文件负责什么：IPC 契约的**屏幕截图与录屏**通道组——截图/录屏结果与图片
 * 保存/复制（见 electron 侧的截图录屏工具）。
 * 原先与其它组同写在 shared/ipc.ts，按通道组拆到这里；形状逐字未动，
 * 对外一律经门面 shared/ipc.ts 原样转出，调用方 import 路径不变。
 */

/* ---------- 屏幕截图与录屏工具 ---------- */

export type ScreenCaptureResult =
  | { ok: true; dataUrl: string }
  | { ok: false; error: string }

export type ScreenRecordResult =
  | { ok: true; status?: string }
  | { ok: false; error: string }

export interface ImageSavePayload {
  suggestedName?: string
  dataUrl: string
}

export type ImageSaveResult =
  | { ok: true; path?: string; canceled?: boolean }
  | { ok: false; error: string }

export type ImageCopyResult =
  | { ok: true }
  | { ok: false; error: string }

