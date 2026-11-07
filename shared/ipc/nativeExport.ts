/**
 * 这个文件负责什么：IPC 契约的**原生导入导出**通道组——保存对话框扩展名过滤、
 * 二进制保存与导出 PDF 的请求/结果（见 electron/app/exportPdf.ts）。
 * 原先与其它组同写在 shared/ipc.ts，按通道组拆到这里；形状逐字未动，
 * 对外一律经门面 shared/ipc.ts 原样转出，调用方 import 路径不变。
 */

/* ---------- 原生导入导出 ---------- */

/** 保存对话框的扩展名过滤：导出文档时给 md / html，不给就按 JSON 走。
 *  谁在用：preload 的 saveText 的 payload.filters、主进程 electron/app/ipc.ts 的 file:saveText，
 *  渲染层 src/lib/exportDoc.ts 与 src/components/learn/workspace/useDocExport.ts。 */
export interface SaveFilter {
  name: string
  extensions: string[]
}

export interface SaveBinaryPayload {
  suggestedName?: string
  data: Uint8Array | string
  title?: string
  filters?: SaveFilter[]
}

export type SaveBinaryResult =
  | { ok: true; path: string }
  | { ok: false; canceled?: boolean; error?: string }

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

