/**
 * 网页页签的日志采集与查询（browser.logs / browser.logDetail / browser.record / browser.fetch）。
 *
 * 主进程在 webview 创建时就挂上 CDP 的 Runtime/Log/Network 三个域，事件流进**每页签一份的
 * 环形缓冲**（本文件的纯逻辑），api 面是纯查询：每次调用显式带 tabId 与过滤参数，任何时刻
 * 重复调用返回一致——没有「读了就没了」的 drain 语义，分页用显式的 afterSeq 游标。
 *
 * 为什么采集在加载前就开：整页加载期的错误与请求（chunk 挂了、启动抛异常、首屏 API 失败）
 * 恰恰是诊断金矿，等第一次查询才挂通道就全漏了。缓冲在宿主侧，不占模型上下文；清单**折叠**
 * 重复（×N 一行、静态资源压成一行计数、失败永不折叠），查询有硬上限——上下文暴涨在这三道
 * 闸门上解决，不靠砍功能。
 *
 * 这个文件是纯函数（缓冲、折叠、行格式、过滤、详情），不 import electron——主进程的
 * webSession 负责把 CDP 事件搬进来，vitest 直接测这里的规则。
 */

/* ---------- 条目与缓冲 ---------- */

export type WebLogLevel = 'error' | 'warn' | 'info' | 'debug'

/** console / 未捕获异常 / Log 域的一条 */
export interface WebConsoleEntry {
  level: WebLogLevel
  /** 扁平化并截断的消息（参数按值/描述串起来） */
  text: string
  /** 调用栈（首行 + 顶帧，截断）——只有异常类才有 */
  stack?: string
}

/** 一条网络请求（重定向折进同一条：状态与类型取最终那一跳） */
export interface WebNetEntry {
  method: string
  url: string
  /** null = 还没回来或失败了 */
  status: number | null
  statusText?: string
  /** CDP 资源类型：XHR / Fetch / Document / Script / Image … */
  type: string
  mime?: string
  /** 响应字节数（encodedDataLength） */
  size?: number
  /** 请求耗时 ms（发出 → 加载完成） */
  ms?: number
  /** loadingFailed 的原因（含「已取消」） */
  errorText?: string
  /** 请求头（截断）——重放 browser.fetch({reqId}) 的原料 */
  headers?: Record<string, string>
  /** 请求体（截断） */
  postData?: string
  /** 响应体（截断，只有 XHR/Fetch 且文本类才采） */
  body?: { text: string; truncated: boolean; mime: string }
  /** CDP 的 requestId：详情里现查响应体用（缓冲淘汰后拿不回，尽力而为） */
  cdpRequestId?: string
}

export type WebConsoleLogEntry = { kind: 'console'; seq: number; at: number } & WebConsoleEntry
export type WebNetLogEntry = { kind: 'network'; seq: number; at: number } & WebNetEntry
export type WebLogEntry = WebConsoleLogEntry | WebNetLogEntry

export interface WebLogBuffer {
  console: WebConsoleLogEntry[]
  network: WebNetLogEntry[]
  nextSeq: number
}

/** 每页签的容量：console 少些（重复消息太多），network 多些（一次 SPA 导航就上百条） */
export const WEB_LOG_CONSOLE_CAP = 300
export const WEB_LOG_NET_CAP = 500

export function newWebLogBuffer(): WebLogBuffer {
  return { console: [], network: [], nextSeq: 1 }
}

function pushCapped(list: WebLogEntry[], entry: WebLogEntry, cap: number): void {
  list.push(entry)
  while (list.length > cap) list.shift()
}

/** 采一条 console（seq 在这里发）；主进程从 Runtime/Log 域的事件里拼好 entry 的其余字段 */
export function pushConsoleLog(buf: WebLogBuffer, at: number, e: WebConsoleEntry): WebConsoleLogEntry {
  const entry: WebConsoleLogEntry = { kind: 'console', seq: buf.nextSeq++, at, ...e }
  pushCapped(buf.console, entry, WEB_LOG_CONSOLE_CAP)
  return entry
}

/** 采一条网络请求 */
export function pushNetLog(buf: WebLogBuffer, at: number, e: WebNetEntry): WebNetLogEntry {
  const entry: WebNetLogEntry = { kind: 'network', seq: buf.nextSeq++, at, ...e }
  pushCapped(buf.network, entry, WEB_LOG_NET_CAP)
  return entry
}

/* ---------- 清单查询：折叠 + 行格式 ---------- */

export interface WebLogsQuery {
  /** 默认两种都看 */
  kind?: 'console' | 'network'
  /** console 档位：默认 error（未捕获异常 / console.error / 被拦的请求），warn 含警告，all 全量 */
  level?: 'error' | 'warn' | 'all'
  /** 网络侧再收窄：'api' 只看 XHR/Fetch（API 调用），'fail' 只看失败的 */
  only?: 'api' | 'fail'
  /** 最多回多少行（默认 40，上限 200）——折叠后的行数 */
  limit?: number
  /** 只看 seq 大于它的（上一份清单的 latestSeq）——无状态分页游标 */
  afterSeq?: number
  /** 顺手回结构化条目（shown 行对应的 {seq, kind, …}）——agent 就不用拿正则从行文本里扒条目号了 */
  meta?: boolean
}

export interface WebLogsView {
  /** 人话清单，每行自带条目号 [c#]/[n#]（browser.logDetail / browser.fetch 的 {reqId} 认它） */
  lines: string[]
  shown: number
  totalConsole: number
  totalNetwork: number
  /** 缓冲里最新的 seq：翻页就把它当下一查询的 afterSeq */
  latestSeq: number
  truncated: boolean
  /** { meta: true } 时回：shown 行的结构化原形（折叠组取第一条；静态行没有条目） */
  entries?: WebLogMetaEntry[]
}

export type WebLogMetaEntry =
  | { seq: number; kind: 'console'; level: WebLogLevel; text: string }
  | { seq: number; kind: 'network'; method: string; url: string; status: number | null; type: string }

/** 查询参数消毒（主进程与宿主层共用）：认不出的值一律落回默认，limit/afterSeq 夹紧 */
export function sanitizeLogsQuery(raw: unknown): WebLogsQuery {
  const o = (raw ?? {}) as Record<string, unknown>
  const kind = o.kind === 'console' || o.kind === 'network' ? o.kind : undefined
  const level = o.level === 'error' || o.level === 'warn' || o.level === 'all' ? o.level : undefined
  const limit =
    typeof o.limit === 'number' && Number.isFinite(o.limit)
      ? Math.min(Math.max(Math.floor(o.limit), 1), 200)
      : undefined
  const afterSeq =
    typeof o.afterSeq === 'number' && Number.isFinite(o.afterSeq) && o.afterSeq >= 0
      ? Math.floor(o.afterSeq)
      : undefined
  return {
    ...(kind ? { kind } : {}),
    ...(level ? { level } : {}),
    ...(o.only === 'api' || o.only === 'fail' ? { only: o.only } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(afterSeq !== undefined ? { afterSeq } : {}),
    ...(o.meta === true ? { meta: true } : {}),
  }
}

const CONSOLE_TAG: Record<WebLogLevel, string> = { error: 'E', warn: 'W', info: 'I', debug: 'D' }

/** 已知的静态资源类型：清单里压成一行计数，明细不进上下文（要看去 logDetail 单条也查不到，它们不值得看） */
const STATIC_TYPES = new Set([
  'Script',
  'StyleSheet',
  'Image',
  'Media',
  'Font',
  'Manifest',
  'TextTrack',
  'Signaling',
  'Preflight',
])

/** 静态资源的扩展名兜底：CDP 的 type 有时给 Other（预加载/缓存命中），按网址长相再折一道 */
const STATIC_EXT_RE = /\.(?:m?js|mjs|css|m3u8|mp4|webm|mov|mp3|woff2?|ttf|otf|png|jpe?g|gif|svg|ico|webp|avif|bmp|wasm|map)(?:[?#]|$)/i

function isStaticNet(e: WebNetLogEntry): boolean {
  return STATIC_TYPES.has(e.type) || e.method === 'OPTIONS' || STATIC_EXT_RE.test(e.url)
}

function levelPasses(level: 'error' | 'warn' | 'all' | undefined, e: WebLogLevel): boolean {
  if (!level || level === 'error') return e === 'error'
  if (level === 'warn') return e === 'error' || e === 'warn'
  return true
}

/** url → 折叠 key 用的路径：query 只留参数名（分页/游标参数最会制造假差异） */
export function apiPathKey(url: string): string {
  try {
    const u = new URL(url)
    const names = [...new URLSearchParams(u.search).keys()].sort()
    return u.pathname + (names.length ? '?' + names.join('&') : '')
  } catch {
    return url
  }
}

export function humanSize(bytes: number | undefined): string {
  if (bytes === undefined || Number.isNaN(bytes)) return ''
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0) + 'KB'
  return (bytes / 1024 / 1024).toFixed(1) + 'MB'
}

function shortUrl(url: string, max = 160): string {
  return url.length > max ? url.slice(0, max - 1) + '…' : url
}

interface NetGroup<E> {
  first: E
  count: number
}

/** 清单查询：过滤 → 折叠 → 行，全在缓冲的现况上算，不消耗缓冲 */
export function queryWebLogs(buf: WebLogBuffer, q: WebLogsQuery = {}): WebLogsView {
  const after = q.afterSeq ?? 0
  const limit = Math.min(Math.max(q.limit ?? 40, 1), 200)
  const wantConsole = !q.kind || q.kind === 'console'
  const wantNetwork = !q.kind || q.kind === 'network'

  const lines: Array<{ seq: number; line: string }> = []
  /** seq → 结构化原形（meta:true 时按 shown 行配齐；折叠组取第一条） */
  const metaBySeq = new Map<number, WebLogMetaEntry>()
  let truncated = false

  if (wantConsole) {
    const seen = buf.console.filter((e) => e.seq > after)
    const groups = new Map<string, NetGroup<WebConsoleLogEntry>>() // 键 = level + text；栈取第一条的
    for (const e of seen) {
      if (!levelPasses(q.level, e.level)) continue
      const key = e.level + '\u0000' + e.text
      const hit = groups.get(key)
      if (hit) hit.count++
      else groups.set(key, { first: e, count: 1 })
    }
    for (const g of groups.values()) {
      const e = g.first
      lines.push({
        seq: e.seq,
        line:
          '[c' + e.seq + '] ' + CONSOLE_TAG[e.level] + ' ' + e.text + (g.count > 1 ? ' ×' + g.count : ''),
      })
      if (q.meta) metaBySeq.set(e.seq, { seq: e.seq, kind: 'console', level: e.level, text: e.text })
    }
  }

  if (wantNetwork) {
    const seen = buf.network.filter((e) => e.seq > after)
    const api = new Map<string, NetGroup<WebNetLogEntry>>()
    const failures: WebNetLogEntry[] = []
    let staticCount = 0
    for (const e of seen) {
      if (q.only === 'fail') {
        // only:'fail' 专看失败：静态与成功的都不占行
        if (e.errorText !== undefined || (e.status !== null && e.status >= 400)) failures.push(e)
        continue
      }
      if (q.only === 'api' && e.type !== 'XHR' && e.type !== 'Fetch') continue
      const failed = e.errorText !== undefined || (e.status !== null && e.status >= 400)
      if (isStaticNet(e)) {
        staticCount++
        continue
      }
      if (failed) {
        failures.push(e)
        continue
      }
      const key = e.method + ' ' + apiPathKey(e.url) + ' → ' + e.status
      const hit = api.get(key)
      if (hit) hit.count++
      else api.set(key, { first: e, count: 1 })
    }
    const netLines: Array<{ seq: number; line: string }> = []
    for (const e of failures) {
      const verdict =
        e.status !== null && e.errorText === undefined
          ? String(e.status)
          : 'ERR ' + (e.errorText ?? '失败')
      netLines.push({
        seq: e.seq,
        line: '[n' + e.seq + '] ' + e.method + ' ' + shortUrl(e.url) + ' → ' + verdict.trim(),
      })
      if (q.meta) {
        metaBySeq.set(e.seq, {
          seq: e.seq,
          kind: 'network',
          method: e.method,
          url: shortUrl(e.url, 300),
          status: e.status,
          type: e.type,
        })
      }
    }
    for (const g of api.values()) {
      const e = g.first
      netLines.push({
        seq: e.seq,
        line:
          '[n' + e.seq + '] ' + e.method + ' ' + shortUrl(e.url) + ' → ' + e.status +
          (e.size !== undefined ? ' · ' + humanSize(e.size) : '') +
          (g.count > 1 ? ' ×' + g.count : ''),
      })
      if (q.meta) {
        metaBySeq.set(e.seq, {
          seq: e.seq,
          kind: 'network',
          method: e.method,
          url: shortUrl(e.url, 300),
          status: e.status,
          type: e.type,
        })
      }
    }
    netLines.sort((a, b) => a.seq - b.seq)
    lines.push(...netLines)
    if (staticCount > 0) {
      // 静态摘要在行尾垫底（截断也保留它——它是最便宜的一行）；不入 seq 排序，也没有结构化条目
      lines.push({ seq: Number.MAX_SAFE_INTEGER, line: '[static] 静态资源 ×' + staticCount + '（已折叠，不看）' })
    }
  }

  lines.sort((a, b) => a.seq - b.seq)
  const shown = lines.slice(0, limit)
  truncated = lines.length > shown.length

  return {
    lines: shown.map((l) => l.line),
    shown: shown.length,
    totalConsole: wantConsole
      ? buf.console.filter((e) => e.seq > after && levelPasses(q.level, e.level)).length
      : 0,
    totalNetwork: wantNetwork ? buf.network.filter((e) => e.seq > after).length : 0,
    latestSeq: buf.nextSeq - 1,
    truncated,
    ...(q.meta ? { entries: shown.map((l) => metaBySeq.get(l.seq)).filter((e) => e !== undefined) } : {}),
  }
}

/* ---------- 单条详情 ---------- */

/** 详情的响应体上限给大些：这是 agent 显式点名要的那一条 */
export const WEB_LOG_DETAIL_BODY_MAX = 32_000

/** 单条详情（body 按缓冲里存的回；主进程可以再拿 cdpRequestId 现查一次补全）。
 *  kind/seq/responseBody 是主进程要程序化访问的键，其余走索引签名原样放行。 */
export interface WebLogDetailRec extends Record<string, unknown> {
  kind: 'console' | 'network'
  seq: number
  responseBody?: { text: string; truncated: boolean; mime: string }
}

export function webLogDetail(buf: WebLogBuffer, seq: number): WebLogDetailRec | null {
  const c = buf.console.find((e) => e.seq === seq)
  if (c) {
    return {
      kind: 'console',
      seq: c.seq,
      at: new Date(c.at).toISOString(),
      level: c.level,
      text: c.text,
      ...(c.stack ? { stack: c.stack } : {}),
    }
  }
  const n = buf.network.find((e) => e.seq === seq)
  if (n) {
    return {
      kind: 'network',
      seq: n.seq,
      at: new Date(n.at).toISOString(),
      method: n.method,
      url: n.url,
      ...(n.status !== null ? { status: n.status, ...(n.statusText ? { statusText: n.statusText } : {}) } : {}),
      type: n.type,
      ...(n.mime ? { mime: n.mime } : {}),
      ...(n.size !== undefined ? { size: n.size } : {}),
      ...(n.ms !== undefined ? { ms: n.ms } : {}),
      ...(n.errorText ? { errorText: n.errorText } : {}),
      ...(n.headers ? { requestHeaders: n.headers } : {}),
      ...(n.postData !== undefined ? { postData: n.postData } : {}),
      ...(n.body ? { responseBody: { text: n.body.text, truncated: n.body.truncated, mime: n.body.mime } } : {}),
    }
  }
  return null
}

/* ---------- 直发请求（browser.fetch）的规格 ---------- */

/** 页面上下文 fetch 的规格（reqId 重放时主进程先用捕获参数填好，再让覆盖项落上去） */
export interface WebFetchSpec {
  url: string
  method: string
  headers?: Record<string, string>
  body?: string
  timeoutMs: number
}

/** 重放时浏览器/页面自己会带的头不要抄（抄了反而对不上），只留应用层自己的头 */
const REPLAY_HEADER_DROP = /^(cookie|host|content-length|origin|referer|sec-.*|accept-encoding)$/i

export function replayHeadersOf(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (!REPLAY_HEADER_DROP.test(k) && v.length <= 2000) out[k] = v
  }
  return out
}

/** 文本类响应才采内容，二进制回尺寸就够了 */
export function isTextualMime(mime: string | undefined): boolean {
  if (!mime) return true // 拿不到 content-type 时宁可试着采
  return /^(text\/|application\/(json|javascript|xml|xhtml|\+json|\+xml|urlencoded|form-data))/i.test(mime)
}

/* ---------- 采集侧的扁平化（CDP 参数 → 缓冲条目） ---------- */

/** Runtime.consoleAPICalled 的 args（RemoteObject）→ 一行人话 */
export function flattenConsoleArgs(args: unknown): string {
  const list = Array.isArray(args) ? args : []
  const parts: string[] = []
  for (const raw of list) {
    const o = (raw ?? {}) as { type?: string; value?: unknown; description?: string }
    let s: string
    if (o.value !== undefined) {
      s = typeof o.value === 'string' ? o.value : JSON.stringify(o.value)
    } else if (o.description !== undefined) {
      s = o.description
    } else {
      s = String(o.type ?? 'undefined')
    }
    parts.push(s.length > 500 ? s.slice(0, 499) + '…' : s)
    if (parts.join(' ').length > 2000) break
  }
  const text = parts.join(' ')
  return text.length > 2000 ? text.slice(0, 1999) + '…' : text
}

/** exceptionDetails / Log.entryAdded 的调用栈 → 首行 + 顶帧 */
export function flattenStack(frames: unknown): string | undefined {
  const list = Array.isArray(frames) ? frames : []
  const rows: string[] = []
  for (const raw of list.slice(0, 5)) {
    const f = (raw ?? {}) as { functionName?: string; url?: string; lineNumber?: number; columnNumber?: number }
    const where = (f.url ?? '').replace(/^https?:\/\/[^/]+/, '')
    rows.push((f.functionName || '(匿名)') + ' @ ' + where + ':' + (f.lineNumber ?? 0) + ':' + (f.columnNumber ?? 0))
  }
  if (!rows.length) return undefined
  const stack = rows.join('\n')
  return stack.length > 1500 ? stack.slice(0, 1499) + '…' : stack
}

/** CDP 请求头对象 → 截断后的记录（每值 ≤2000 字，键数 ≤40） */
export function capHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== 'object') return undefined
  const out: Record<string, string> = {}
  let n = 0
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (n >= 40) break
    const s = String(v)
    out[k] = s.length > 2000 ? s.slice(0, 1999) + '…' : s
    n++
  }
  return Object.keys(out).length ? out : undefined
}

/** 请求/响应体截断入库 */
export function capBodyText(text: string, max = 16_000): string {
  return text.length > max ? text.slice(0, max) : text
}
