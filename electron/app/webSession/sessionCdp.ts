/**
 * CDP 调试通道的地基与采集环形缓冲：webSession 的公共底层。
 * guestOf / ensureDebugger / cdp 是快照（sessionSnapshot）与日志（sessionLogs）
 * 共用的页签定位与调试命令口子；采集部分在 webview 创建即挂 Runtime/Log/Network，
 * 事件流进环形缓冲（页签日志采集，browser.logs / logDetail / record / fetch 的地基，
 * 见 shared/webLogs）。
 */
import { webContents, type Debugger, type WebContents } from 'electron'
import {
  capBodyText,
  capHeaders,
  flattenConsoleArgs,
  flattenStack,
  isTextualMime,
  newWebLogBuffer,
  pushConsoleLog,
  pushNetLog,
  type WebLogBuffer,
  type WebNetLogEntry,
} from '../../../shared/webLogs'

export function guestOf(wcId: number): WebContents | null {
  const wc = webContents.fromId(wcId)
  return wc && !wc.isDestroyed() ? wc : null
}

/** 按需挂调试通道（Accessibility / DOM 两个域共用）；被占用多半是这页签开着 DevTools。
 *  attach 成功返回即已挂载（同步状态翻转），后续 sendCommand 的失败各自兜底。 */
export function ensureDebugger(wc: WebContents): Debugger {
  const dbg = wc.debugger
  if (dbg.isAttached()) return dbg
  try {
    dbg.attach('1.3')
  } catch {
    throw new Error('调试通道被占用（这个页签可能开着开发者工具），拿不到页面快照')
  }
  return dbg
}

/** 单条 CDP 命令的兜底超时：页面卡死不该把 IPC 调用无限吊着 */
export function cdp<T>(dbg: Debugger, method: string, params?: object, ms = 12_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(method + ' 超时（页面可能没有响应）')), ms)
    dbg
      .sendCommand(method, params)
      .then(
        (v) => {
          clearTimeout(t)
          resolve(v as T)
        },
        (e: unknown) => {
          clearTimeout(t)
          reject(e instanceof Error ? e : new Error(String(e)))
        },
      )
  })
}

/* ---------- 页签日志采集（browser.logs / logDetail / record / fetch 的地基，见 shared/webLogs） ---------- */

export const logBuffers = new Map<number, WebLogBuffer>()
/** 录制水位（browser.record(start) 钉下、stop 取走并清掉） */
export const recMarks = new Map<number, number>()
/** cdp requestId → 网络条目：响应/加载完成回填用（重定向换条目，map 跟着改指） */
export const netInflight = new Map<number, Map<string, WebNetLogEntry>>()

function bufferOf(wcId: number): WebLogBuffer {
  let buf = logBuffers.get(wcId)
  if (!buf) {
    buf = newWebLogBuffer()
    logBuffers.set(wcId, buf)
  }
  return buf
}

/** webview 一挂上就开采集：Runtime/Log/Network 的事件流进环形缓冲。
 *  加载期的错误与请求（chunk 挂了、启动异常、首屏 API 失败）是诊断金矿，
 *  等第一次查询才挂通道就全漏了。DevTools（检查元素）要独占调试插槽：让它，关掉再收回。 */
export function startCapture(contents: WebContents): void {
  const wcId = contents.id
  bufferOf(wcId)
  const dbg = contents.debugger
  try {
    dbg.attach('1.3')
  } catch {
    return // 槽位被占（创建时理论上不会）：采集缺席，查询回空，操作型 api 走 ensureDebugger 自己的报错
  }
  const inflight = new Map<string, WebNetLogEntry>()
  netInflight.set(wcId, inflight)
  const enable = (): void => {
    for (const domain of ['Runtime.enable', 'Log.enable', 'Network.enable']) {
      void dbg.sendCommand(domain).catch(() => {})
    }
  }
  enable()
  const onMessage = (_e: Electron.Event, method: string, params: Record<string, unknown>): void => {
    const buf = logBuffers.get(wcId)
    if (!buf) return
    const p = params ?? {}
    const at = Date.now()
    if (method === 'Runtime.consoleAPICalled') {
      const type = String(p.type ?? 'log')
      const level = type === 'error' ? 'error' : type === 'warning' ? 'warn' : type === 'debug' ? 'debug' : 'info'
      const stack = type === 'trace' ? flattenStack(p.stackTrace) : undefined
      pushConsoleLog(buf, at, { level, text: flattenConsoleArgs(p.args), ...(stack ? { stack } : {}) })
    } else if (method === 'Runtime.exceptionThrown') {
      const d = (p.exceptionDetails ?? {}) as {
        text?: string
        url?: string
        exception?: { description?: string }
        stackTrace?: { callFrames?: unknown }
      }
      const text = d.exception?.description ?? [d.text, d.url].filter(Boolean).join(' （') + (d.url ? '）' : '')
      pushConsoleLog(buf, at, {
        level: 'error',
        text: text.slice(0, 2000),
        ...(flattenStack(d.stackTrace?.callFrames) ? { stack: flattenStack(d.stackTrace?.callFrames) } : {}),
      })
    } else if (method === 'Log.entryAdded') {
      const e = (p.entry ?? {}) as { source?: string; level?: string; text?: string; url?: string }
      const level = e.level === 'error' ? 'error' : e.level === 'warning' ? 'warn' : e.level === 'verbose' ? 'debug' : 'info'
      const extra = e.url && !(e.text ?? '').includes(e.url) ? '（' + e.url + '）' : ''
      pushConsoleLog(buf, at, {
        level,
        text: ((e.text ?? '') + extra).slice(0, 2000),
      })
    } else if (method === 'Network.requestWillBeSent') {
      const req = (p.request ?? {}) as { url?: string; method?: string; headers?: unknown; postData?: string }
      const redirect = p.redirectResponse as Record<string, unknown> | undefined
      if (redirect) {
        // 重定向：同一 requestId 的上一跳落定，续跳开新条目
        const prev = inflight.get(String(p.requestId))
        if (prev) {
          prev.status = Number(redirect.status) || null
          prev.statusText = typeof redirect.statusText === 'string' ? redirect.statusText : undefined
          prev.mime = typeof redirect.mimeType === 'string' ? redirect.mimeType : undefined
          prev.ms = at - prev.at
        }
      }
      const entry = pushNetLog(buf, at, {
        method: String(req.method ?? 'GET').toUpperCase(),
        url: String(req.url ?? ''),
        status: null,
        type: String(p.type ?? 'Other'),
        ...(capHeaders(req.headers) ? { headers: capHeaders(req.headers) } : {}),
        ...(req.postData !== undefined ? { postData: capBodyText(String(req.postData)) } : {}),
        cdpRequestId: String(p.requestId),
      })
      inflight.set(String(p.requestId), entry)
    } else if (method === 'Network.responseReceived') {
      const entry = inflight.get(String(p.requestId))
      const res = (p.response ?? {}) as { status?: number; statusText?: string; mimeType?: string }
      if (entry) {
        entry.status = typeof res.status === 'number' ? res.status : entry.status
        entry.statusText = res.statusText || undefined
        entry.mime = res.mimeType || undefined
        if (typeof p.type === 'string' && p.type !== 'Other') entry.type = p.type
      }
    } else if (method === 'Network.loadingFinished') {
      const entry = inflight.get(String(p.requestId))
      if (!entry) return
      entry.size = typeof p.encodedDataLength === 'number' ? Math.round(p.encodedDataLength) : entry.size
      entry.ms = at - entry.at
      inflight.delete(String(p.requestId)) // 挂起台账：完了就出列（waitFor 的 networkIdle 数它）
      // API 响应体现采一份（XHR/Fetch、文本类）：详情与「分析网页发了什么」都靠它
      if (
        entry.cdpRequestId &&
        (entry.type === 'XHR' || entry.type === 'Fetch') &&
        isTextualMime(entry.mime) &&
        dbg.isAttached()
      ) {
        void dbg
          .sendCommand('Network.getResponseBody', { requestId: entry.cdpRequestId })
          .then((r) => {
            const body = (r as { body?: string; base64?: boolean }) ?? {}
            if (body.body !== undefined && !body.base64) {
              entry.body = {
                text: capBodyText(body.body),
                truncated: body.body.length > capBodyText(body.body).length,
                mime: entry.mime ?? '',
              }
            }
          })
          .catch(() => {})
      }
    } else if (method === 'Network.loadingFailed') {
      const entry = inflight.get(String(p.requestId))
      if (!entry) return
      entry.errorText = String(p.errorText ?? '失败') + (p.canceled ? '（已取消）' : '')
      entry.ms = at - entry.at
      inflight.delete(String(p.requestId))
    }
  }
  dbg.on('message', onMessage)
  contents.once('destroyed', () => {
    try {
      dbg.removeListener('message', onMessage)
      if (dbg.isAttached()) dbg.detach()
    } catch {
      /* 页签都没了，收尾失败无所谓 */
    }
    logBuffers.delete(wcId)
    recMarks.delete(wcId)
    netInflight.delete(wcId)
  })
  // 检查元素/用户 DevTools 要占调试插槽：让位（这页签的采集中断），关掉再收回
  contents.on('devtools-opened', () => {
    try {
      if (dbg.isAttached()) dbg.detach()
    } catch {
      /* 同上 */
    }
    inflight.clear()
  })
  contents.on('devtools-closed', () => {
    try {
      if (!dbg.isAttached()) {
        dbg.attach('1.3')
        enable()
      }
    } catch {
      /* 另一路（snapshot 等）先挂上了就归它 */
    }
  })
}

/** 检查元素前先给 DevTools 让出调试插槽（否则开不出/打不开面板） */
export function yieldDebuggerToDevtools(contents: WebContents): void {
  try {
    const dbg = contents.debugger
    if (dbg.isAttached()) {
      dbg.detach()
      netInflight.get(contents.id)?.clear()
    }
  } catch {
    /* 让位失败就让它去报「调试通道被占用」 */
  }
}
