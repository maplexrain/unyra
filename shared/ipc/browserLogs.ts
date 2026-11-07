/**
 * 这个文件负责什么：IPC 契约的**页签日志与直发请求**通道组——browser.logs / logDetail /
 * pageFetch / text / scroll / waitFor / record 的入参与返回（折叠与缓冲见 shared/webLogs）。
 * 原先与其它组同写在 shared/ipc.ts，按通道组拆到这里；形状逐字未动
 * （唯一的机械调整：`import('./webLogs')` 随目录层级改为 `import('../webLogs')`），
 * 对外一律经门面 shared/ipc.ts 原样转出，调用方 import 路径不变。
 */

/* ---------- 页签日志与直发请求（browser.logs / logDetail / fetch / record，见 shared/webLogs） ---------- */

/** browser.logs 的过滤参数。谁在用：preload browser.logs ↔ 主进程 web:logs（折叠与缓冲见 shared/webLogs）。 */
export interface WebLogsOpts {
  kind?: 'console' | 'network'
  level?: 'error' | 'warn' | 'all'
  only?: 'api' | 'fail'
  limit?: number
  afterSeq?: number
}

/** browser.logs / browser.record(stop) 的返回：折叠后的清单视图，或一句人话错误。谁在用：同上。 */
export type WebLogsResult = import('../webLogs').WebLogsView | { error: string }

/** browser.logDetail 的返回：单条详情（形状见 shared/webLogs 的 webLogDetail），或一句人话错误。
 *  谁在用：主进程 web:logDetail，渲染层 browserOps 的 api.browser.logDetail。 */
export type WebLogDetailResult = { detail: Record<string, unknown> } | { error: string }

/** browser.fetch 的入参：url 直发，或 { reqId } 重放捕获的请求（覆盖项落在其上）；
 *  offset/maxBody 把长响应分段读（body 按 [offset, offset+maxBody) 切）。
 *  谁在用：preload browser.pageFetch ↔ 主进程 web:pageFetch（页面上下文固定函数执行）。 */
export interface WebPageFetchReq {
  url?: string
  reqId?: number
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  maxBody?: number
  offset?: number
  /** 页面侧采文本的上限（toTmp 全文模式把 64k 提到 256k） */
  maxText?: number
}

/**
 * browser.fetch 的返回，或一句人话错误（只有参数/页签类错误才走 error）。
 * **请求级失败不抛异常**：没拿到响应（CSP/CORS/超时/中止）回 { status: 0, failed: true, reason }，
 * agent 照常分支，不用 try/catch。HTTP 4xx/5xx 是正常回执（status 原样）。
 * 谁在用：同上。
 */
export type WebPageFetchResult =
  | {
      status: number
      failed?: true
      reason?: string
      statusText?: string
      contentType?: string
      url?: string
      body?: string
      bodyTruncated?: boolean
      /** 响应文本总字符数与本次切走的区间：续读带 { offset: nextOffset } */
      chars?: number
      offset?: number
      nextOffset?: number
      bytes?: number
      /** { reqId } 重放时回显原请求；4xx 时附一次性签名的提示 */
      replayed?: { url: string; method: string }
      note?: string
    }
  | { error: string }

/** browser.text 的入参与返回：按 ref/selector 取**渲染后**的区域文本（SPA 上不用截图读）。
 *  谁在用：主进程 web:text（CDP 固定函数），渲染层 browserOps 的 api.browser.text。 */
export type WebTextTarget = { ref: number; maxChars?: number } | { selector: string; maxChars?: number }
export type WebTextResult = { text: string; chars: number; truncated?: boolean } | { error: string }

/** browser.scroll 的入参与返回：滚页面（无限滚动信息流的引擎）。to = 'top' | 'bottom' | 选择器；
 *  ref 走 snapshot 台账。返回滚动后的页面几何（atBottom 判断加载More）。
 *  谁在用：主进程 web:scroll，渲染层 browserOps 的 api.browser.scroll。 */
export interface WebScrollReq {
  by?: number
  to?: 'top' | 'bottom' | string
  ref?: number
}
export type WebScrollResult =
  | { ok: true; scrollY: number; scrollHeight: number; viewport: number; atBottom: boolean; atTop: boolean }
  | { error: string }

/** browser.waitFor 的入参与返回：等条件成立（「等一下、再取一次、还是空」循环的替代品）。
 *  谓词全是固定原语（selector/text/urlIncludes/networkIdle/load），agent 传不进自由 JS。
 *  谁在用：主进程 web:waitFor（250ms 轮询），渲染层 browserOps 的 api.browser.waitFor。 */
export interface WebWaitReq {
  selector?: string
  text?: string
  urlIncludes?: string
  networkIdle?: boolean
  load?: boolean
  timeoutMs?: number
}
export type WebWaitResult =
  | { ok: true; matched: 'selector' | 'text' | 'url' | 'networkIdle' | 'load'; waitedMs: number; url: string }
  | { error: string }

/** browser.record 的返回：start 回水位，stop 回这段区间的清单视图。谁在用：主进程 web:record，渲染层 browserOps。 */
export type WebRecordResult =
  | { ok: true; action: 'start'; since: number }
  | (import('../webLogs').WebLogsView & { action: 'stop' })
  | { error: string }

