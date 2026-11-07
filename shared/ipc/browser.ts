/**
 * 这个文件负责什么：IPC 契约的**内置浏览器（webview 网页页签）**通道组——页面快照、
 * 定位、DOM 操作回执、整页 HTML、翻译指令与极速翻译结果。
 * 原先与其它组同写在 shared/ipc.ts，按通道组拆到这里；形状逐字未动，
 * 对外一律经门面 shared/ipc.ts 原样转出，调用方 import 路径不变。
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

/** browser.point 的返回：页面已滚到目标并高亮，或一句人话错误。谁在用：同上。 */
export type WebPointResult = { ok: true } | { error: string }

/** browser.dom 的返回：受控 DOM 操作的执行回执（result 是操作自己的小结果），或一句人话错误。
 *  谁在用：同上。 */
export type WebDomOpResult = { ok: true; result?: unknown } | { error: string }

/** browser.read 的第一步：主进程从 live DOM 取回的整页 HTML（渲染层走 webFetch 同一条
 *  markdown 管线转换）。谁在用：主进程 electron/app/webSession.ts 的 web:readHtml，
 *  渲染层 src/learn/web/browserOps 与 src/learn/webDocs 的 livePageForAgent。 */
export type WebReadHtmlResult = { html: string; url: string; title: string } | { error: string }

export type TranslationEngine = 'fast' | 'ai'

/** 内置浏览器翻译指令载荷。谁在用：主进程 electron/app/webSession.ts ↔ 渲染层 WebTabLayer */
export interface WebTranslatePayload {
  wcId: number
  mode: 'selection' | 'page' | 'toggle' | 'clear'
  engine?: TranslationEngine
  text?: string
  x?: number
  y?: number
}

/** 极速翻译单条或批量请求结果 */
export type WebFastTranslateResult =
  | { ok: true; text: string; source?: string }
  | { ok: false; error: string }

