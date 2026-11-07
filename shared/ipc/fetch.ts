/**
 * 这个文件负责什么：IPC 契约的**附件 / 抓网页**通道组——附件读取、抓网页与抓网络
 * 二进制的结果（主进程 electron/web.ts 与 electron/storage/attach.ts）。
 * 原先与其它组同写在 shared/ipc.ts，按通道组拆到这里；形状逐字未动，
 * 对外一律经门面 shared/ipc.ts 原样转出，调用方 import 路径不变。
 */

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

/**
 * 抓一个**网络二进制**（图片 / PDF）的结果（通道 web:fetchBinary，主进程 electron/web.ts 的 fetchBinary）。
 *
 * 与 web:fetch 分开的原因：那边只回 HTML / 纯文本（图片与 PDF 会被当成 kind:'other' 拒掉），
 * 而这里要的是原始字节——走 data URL（base64）过 IPC，渲染层拿到后再按用途校验
 * （图片看魔数、PDF 看头四个字节）。通道本身不做内容类型限制。
 * 谁在用：preload 的 web.fetchBinary，渲染层 src/learn/see.ts（api.see 的宿主实现）。
 */
export type WebBinaryFetchResult =
  | {
      ok: true
      url: string
      finalUrl: string
      status: number
      contentType: string
      /** 响应头或魔数认定的 mime（仅报告用；内容是否合格由调用方校验） */
      mime: string
      bytes: number
      /** `data:<mime>;base64,…` 形式的字节 */
      dataUrl: string
    }
  | { ok: false; error: string }

