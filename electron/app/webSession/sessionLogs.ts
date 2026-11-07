/**
 * 页签日志四 api 与等待/直译入口 IPC：browser.logs / logDetail / record / fetch
 * （环形缓冲的查询、条目详情、录制水位、页面上下文固定函数 fetch：{ reqId } 重放 +
 * toTmp 全文），外加 browser.waitFor（固定谓词轮询）与 web:fastTranslate 入口
 * （核心在 sessionTranslate）。
 */
import { ipcMain } from 'electron'
import type {
  WebFastTranslateResult,
  WebLogDetailResult,
  WebLogsResult,
  WebPageFetchReq,
  WebPageFetchResult,
  WebRecordResult,
  WebWaitReq,
  WebWaitResult,
} from '../../../shared/ipc'
import {
  apiPathKey,
  capBodyText,
  capHeaders,
  queryWebLogs,
  replayHeadersOf,
  sanitizeLogsQuery,
  webLogDetail,
  WEB_LOG_DETAIL_BODY_MAX,
  type WebFetchSpec,
} from '../../../shared/webLogs'
import { cdp, ensureDebugger, guestOf, logBuffers, netInflight, recMarks } from './sessionCdp'
import { fastTranslateCore } from './sessionTranslate'

/** browser.fetch 在页面上下文跑的固定函数：参数是值（JSON 注入），函数体是死的——
 *  与 DOM_OPS 同一条纪律，没有任意 JS 的口子。credentials: 'include' 是「以这个页签
 *  登录态的身份」语义；同源 API 调用无 CORS 问题，跨域照样受页面自己的 CORS 约束。 */
const PAGE_FETCH_FN =
  'async function (spec) {' +
  '  const ctrl = new AbortController();' +
  '  const timer = setTimeout(function () { ctrl.abort() }, spec.timeoutMs || 15000);' +
  '  try {' +
  '    const res = await fetch(spec.url, {' +
  '      method: spec.method,' +
  '      headers: spec.headers,' +
  '      body: spec.method === "GET" || spec.method === "HEAD" || spec.body === undefined ? undefined : spec.body,' +
  '      credentials: "include",' +
  '      signal: ctrl.signal,' +
  '    });' +
  '    const contentType = res.headers.get("content-type") || "";' +
  '    let text = "";' +
  '    if (!contentType || /^(text\\/|application\\/(json|javascript|xml|xhtml|\\+json|\\+xml|urlencoded|form-data))/i.test(contentType)) {' +
  '      text = await res.text();' +
  '      const cap = spec.maxText || 65536;' +
  '      if (text.length > cap) text = text.slice(0, cap);' +
  '    }' +
  '    return { status: res.status, statusText: res.statusText, contentType: contentType, url: res.url, text: text, textBytes: text.length };' +
  '  } catch (e) {' +
  '    return { error: String((e && e.message) || e) };' +
  '  } finally {' +
  '    clearTimeout(timer);' +
  '  }' +
  '}'

/** 日志查询与直发请求的四个通道（browser.logs / logDetail / fetch / record） */
export function registerLogIpc(): void {
  ipcMain.handle('web:logs', (_e, wcId: number, opts: unknown): WebLogsResult => {
    const buf = logBuffers.get(Number(wcId))
    if (!buf) return { error: '这一页签的日志缓冲不在了（页签已关）——api.browser.tabs() 换个活页签' }
    return queryWebLogs(buf, sanitizeLogsQuery(opts))
  })

  ipcMain.handle(
    'web:logDetail',
    async (_e, wcId: number, seq: number, opts: unknown): Promise<WebLogDetailResult> => {
      const buf = logBuffers.get(Number(wcId))
      if (!buf) return { error: '这一页签的日志缓冲不在了（页签已关）' }
      const detail = webLogDetail(buf, Number(seq))
      if (!detail) {
        return { error: '缓冲里没有这条（太旧被挤掉了，或条目号不对）——api.browser.logs 重拿现行清单' }
      }
      // 响应体按缓冲里存的回；不够长再向页面现查一次（缓冲淘汰后查不回，尽力而为）
      const maxBody = (() => {
        const v = (opts as { maxBody?: unknown } | null | undefined)?.maxBody
        return typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(Math.floor(v), 200), WEB_LOG_DETAIL_BODY_MAX) : WEB_LOG_DETAIL_BODY_MAX
      })()
      if (detail.kind === 'network') {
        const entry = buf.network.find((e) => e.seq === Number(seq))
        if (entry?.cdpRequestId && (!detail.responseBody || detail.responseBody.truncated)) {
          const wc = guestOf(wcId)
          if (wc) {
            try {
              const dbg = await ensureDebugger(wc)
              const r = (await cdp<{ body?: string; base64?: boolean }>(
                dbg,
                'Network.getResponseBody',
                { requestId: entry.cdpRequestId },
              )) ?? {}
              if (r.body !== undefined && !r.base64) {
                const text = capBodyText(r.body, maxBody)
                detail.responseBody = {
                  text,
                  truncated: r.body.length > text.length,
                  mime: entry.mime ?? '',
                }
              }
            } catch {
              /* 页面变了/体已被回收：保留缓冲里那份（可能没有） */
            }
          }
        }
        // 详情瘦身（实测教训：GraphQL 的全量 URL 单条 3000+ 字符，agent 只是想拿个地址）：
        // 头每值截 500；补一个「host + 路径 + 参数名」的短形态，全量 url 仍在
        const headers = detail.requestHeaders as Record<string, string> | undefined
        if (headers) {
          const trimmed: Record<string, string> = {}
          for (const [k, v] of Object.entries(headers)) trimmed[k] = v.length > 500 ? v.slice(0, 499) + '…' : v
          detail.requestHeaders = trimmed
        }
        if (typeof detail.url === 'string') {
          try {
            detail.urlPath = new URL(detail.url).host + apiPathKey(detail.url)
          } catch {
            /* url 不合法就不补短形态 */
          }
        }
      }
      return { detail }
    },
  )

  ipcMain.handle('web:record', (_e, wcId: number, action: string, opts: unknown): WebRecordResult => {
    const buf = logBuffers.get(Number(wcId))
    if (!buf) return { error: '这一页签的日志缓冲不在了（页签已关）——api.browser.tabs() 换个活页签' }
    if (action === 'start') {
      const since = buf.nextSeq - 1
      recMarks.set(wcId, since)
      return { ok: true, action: 'start', since }
    }
    if (action === 'stop') {
      const mark = recMarks.get(wcId)
      if (mark === undefined) {
        return { error: '这个页签没有进行中的录制——先 browser.record(tabId, "start") 起录' }
      }
      recMarks.delete(wcId)
      return { ...queryWebLogs(buf, { ...sanitizeLogsQuery(opts), afterSeq: mark }), action: 'stop' as const }
    }
    return { error: 'record 的动作只有 "start" / "stop"' }
  })

  ipcMain.handle(
    'web:pageFetch',
    async (_e, wcId: number, raw: unknown): Promise<WebPageFetchResult> => {
      const wc = guestOf(wcId)
      if (!wc) return { error: '这一页签的网页已经不在了' }
      const req = (raw ?? {}) as WebPageFetchReq
      let spec: WebFetchSpec
      if (typeof req.reqId === 'number' && Number.isFinite(req.reqId)) {
        const entry = logBuffers.get(wcId)?.network.find((e) => e.seq === req.reqId)
        if (!entry) {
          return { error: '缓冲里没有这条网络请求（太旧被挤掉了，或条目号不对）——api.browser.logs 重拿现行清单' }
        }
        const headers = {
          ...replayHeadersOf(entry.headers),
          ...(capHeaders(req.headers) ?? {}),
        }
        spec = {
          url: typeof req.url === 'string' && req.url.trim() ? req.url.trim() : entry.url,
          method: String(req.method ?? entry.method ?? 'GET').toUpperCase(),
          ...(Object.keys(headers).length ? { headers } : {}),
          body: req.body !== undefined ? String(req.body) : entry.postData,
          timeoutMs: clampTimeout(req.timeoutMs),
          ...(maxTextOf(req) ? { maxText: maxTextOf(req) } : {}),
        }
      } else {
        const url = typeof req.url === 'string' ? req.url.trim() : ''
        if (!/^https?:\/\//i.test(url)) {
          return { error: '要给 http(s) 网址，或 { reqId }（网络清单里的条目号）来重放页面发过的请求' }
        }
        spec = {
          url,
          method: String(req.method ?? 'GET').toUpperCase(),
          ...(capHeaders(req.headers) ? { headers: capHeaders(req.headers) } : {}),
          body: req.body !== undefined ? String(req.body) : undefined,
          timeoutMs: clampTimeout(req.timeoutMs),
          ...(maxTextOf(req) ? { maxText: maxTextOf(req) } : {}),
        }
      }
      if (spec.method === 'GET' || spec.method === 'HEAD') delete spec.body
      try {
        const dbg = ensureDebugger(wc)
        const r = await cdp<{
          result?: { value?: { error?: string; status?: number; statusText?: string; contentType?: string; url?: string; text?: string; textBytes?: number } }
          exceptionDetails?: { exception?: { description?: string } }
        }>(
          dbg,
          'Runtime.evaluate',
          { expression: '(' + PAGE_FETCH_FN + ')(' + JSON.stringify(spec) + ')', awaitPromise: true, returnByValue: true, userGesture: true },
          spec.timeoutMs + 10_000,
        )
        if (r.exceptionDetails) {
          return { error: '页面里请求失败：' + (r.exceptionDetails.exception?.description ?? '未知异常').slice(0, 300) }
        }
        const v = r.result?.value
        if (!v || (typeof v.status !== 'number' && !v.error)) {
          return { error: '页面里请求失败：拿不到响应' }
        }
        /*
         * **请求级失败不抛异常**：没拿到响应（CSP/CORS/超时/中止）回值 { status:0, failed, reason }，
         * agent 按值分支；只有参数/页签类错误才走上面的 error（抛给 execute）。
         * 实测教训：跨域被拒时 throw 会把整批 execute 连带已成功的结果一起带走。
         */
        if (v.error) {
          const reason = String(v.error)
          const timedOut = /abort/i.test(reason)
          return {
            status: 0,
            failed: true,
            reason: timedOut
              ? '超时：' + Math.round(spec.timeoutMs / 1000) + 's 内页面没回来（fetch 被中止）'
              : '页面里请求失败：' + reason + '——同源 API 没这个问题；跨域要过页面自己的 CORS/CSP',
          }
        }
        const maxBody = typeof req.maxBody === 'number' && Number.isFinite(req.maxBody)
          ? Math.min(Math.max(Math.floor(req.maxBody), 200), 262_144)
          : 4_000
        const text = v.text ?? ''
        const offset = typeof req.offset === 'number' && Number.isFinite(req.offset)
          ? Math.min(Math.max(Math.floor(req.offset), 0), Math.max(text.length - 1, 0))
          : 0
        // offset 越过末尾不再静默回空：带一句说明（实测教训：agent 以为分段坏了白试一轮）
        const pastEnd = offset >= text.length
        const body = pastEnd ? '' : text.slice(offset, offset + maxBody)
        const nextOffset = offset + body.length < text.length ? offset + body.length : undefined
        const replayed = typeof req.reqId === 'number'
          ? { url: spec.url, method: spec.method }
          : undefined
        const replayBounced = replayed && (v.status === 403 || v.status === 404)
        const status = typeof v.status === 'number' ? v.status : 0
        return {
          status,
          ...(replayed ? { replayed } : {}),
          ...(v.statusText ? { statusText: v.statusText } : {}),
          ...(v.contentType ? { contentType: v.contentType } : {}),
          ...(v.url ? { url: v.url } : {}),
          ...(body
            ? { body, ...(body.length < text.length - offset || nextOffset !== undefined ? { bodyTruncated: true } : {}) }
            : pastEnd
              ? { note: 'offset 已越过响应末尾（全文共 ' + text.length + ' 字符）——没有更多内容了' }
              : text.length
                ? { note: '响应不是文本类，不回内容' }
                : {}),
          ...(text.length ? { chars: v.textBytes ?? text.length, ...(offset ? { offset } : {}), ...(nextOffset !== undefined ? { nextOffset } : {}) } : {}),
          ...(replayBounced
            ? { note: '重放拿到 ' + v.status + '：捕获的请求头可能含一次性签名（x-client-transaction-id 之类）已过期——回 UI 重新触发一次同样的操作拿新 reqId，或直接用网址直发让页面自己带头' }
            : {}),
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : '页面请求失败' }
      }
    },
  )

  // 等条件成立（browser.waitFor）：「wait 一下、再取一次、还是空」循环的替代品。
  // 谓词全是固定原语——selector/text/url 在页面里跑固定表达式，networkIdle 数挂起台账，
  // agent 传不进自由 JS。250ms 轮询到成立或超时，超时回执带页面现状（url）供判断下一步。
  ipcMain.handle('web:waitFor', async (_e, wcId: number, raw: unknown): Promise<WebWaitResult> => {
    const wc = guestOf(wcId)
    if (!wc) return { error: '这一页签的网页已经不在了' }
    const req = (raw ?? {}) as WebWaitReq
    const selector = typeof req.selector === 'string' && req.selector.trim() ? req.selector.trim() : undefined
    const text = typeof req.text === 'string' && req.text.trim() ? req.text.trim() : undefined
    const urlIncludes = typeof req.urlIncludes === 'string' && req.urlIncludes.trim() ? req.urlIncludes.trim() : undefined
    const predicates: string[] = []
    if (req.load === true) predicates.push('load')
    if (selector) predicates.push('selector')
    if (text) predicates.push('text')
    if (urlIncludes) predicates.push('url')
    if (req.networkIdle === true) predicates.push('networkIdle')
    if (!predicates.length) {
      return { error: '要给至少一个等待条件：{ selector } / { text } / { urlIncludes } / { networkIdle: true } / { load: true }' }
    }
    const timeoutMs =
      typeof req.timeoutMs === 'number' && Number.isFinite(req.timeoutMs)
        ? Math.min(Math.max(Math.floor(req.timeoutMs), 500), 30_000)
        : 8_000
    const deadline = Date.now() + timeoutMs
    const dbg = (() => {
      try {
        return ensureDebugger(wc)
      } catch {
        return null // DevTools 占着插槽：selector/text 等不了，load/url/networkIdle 照样能等
      }
    })()
    for (;;) {
      let matched: 'selector' | 'text' | 'url' | 'networkIdle' | 'load' | null = null
      if (predicates.includes('load') && !wc.isLoading()) matched = 'load'
      if (!matched && selector && dbg) {
        try {
          const r = await cdp<{ result?: { value?: boolean } }>(dbg, 'Runtime.evaluate', {
            expression: '!!document.querySelector(' + JSON.stringify(selector) + ')',
            returnByValue: true,
          })
          if (r.result?.value === true) matched = 'selector'
        } catch {
          /* 页面正在跳转的瞬间会失败：当作还没满足，下一拍再试 */
        }
      }
      if (!matched && text && dbg) {
        try {
          const r = await cdp<{ result?: { value?: boolean } }>(dbg, 'Runtime.evaluate', {
            expression: '!!(document.body && document.body.innerText && document.body.innerText.indexOf(' + JSON.stringify(text) + ') >= 0)',
            returnByValue: true,
          })
          if (r.result?.value === true) matched = 'text'
        } catch {
          /* 同上 */
        }
      }
      if (!matched && urlIncludes && wc.getURL().includes(urlIncludes)) matched = 'url'
      if (!matched && req.networkIdle === true && !wc.isLoading() && (netInflight.get(wcId)?.size ?? 0) === 0) {
        matched = 'networkIdle'
      }
      if (matched !== null) {
        return { ok: true, matched, waitedMs: timeoutMs - Math.max(deadline - Date.now(), 0), url: wc.getURL() }
      }
      if (Date.now() >= deadline) {
        return {
          error:
            '等了 ' + timeoutMs + 'ms 条件没满足（' + predicates.join(' / ') + '）——页面当前在 ' + wc.getURL() +
            '：把条件放宽（比如先 scroll 再等 text）、拉长 timeoutMs，或改用截图看页面到底长什么样',
        }
      }
      await new Promise((r) => setTimeout(r, 250))
    }
  })

  ipcMain.handle(
    'web:fastTranslate',
    async (_e, payload: { text?: string; targetLang?: string }): Promise<WebFastTranslateResult> => {
      return fastTranslateCore(payload?.text ?? '', payload?.targetLang)
    },
  )
}

function clampTimeout(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(Math.floor(v), 1000), 60_000) : 15_000
}

/** 页面侧采文本上限：toTmp 全文模式把默认 64k 放宽（wrap 侧只在 toTmp 时设置） */
function maxTextOf(req: WebPageFetchReq): number | undefined {
  return typeof req.maxText === 'number' && Number.isFinite(req.maxText)
    ? Math.min(Math.max(Math.floor(req.maxText), 65_536), 262_144)
    : undefined
}
