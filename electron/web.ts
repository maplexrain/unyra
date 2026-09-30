/**
 * 抓取网页（主进程）。
 *
 * 为什么必须在主进程：渲染进程的 fetch 受同源策略约束，抓任意站点一律被 CORS 挡下；
 * 而「关掉 webSecurity」这种事不能做（那等于把整个渲染层敞开）。所以抓取放在这里，
 * 走 Node 的 fetch，渲染层通过 web:fetch 这一个频道拿结果。
 *
 * 三条自我约束（都不与用户商量，因为 agent 是模型写的代码）：
 * 1. **只读**：只发 GET，不带 cookie、不带任何本机凭据；
 * 2. **有上限**：体积与时间都有硬上限，超了就截断/中止，不把主进程拖住；
 * 3. **不碰内网**：地址先过 web-core 的判定（本机、私网段一律拒绝）。
 */

import { ipcMain } from 'electron'
import { t } from './i18n'
import {
  WEB_MAX_BYTES,
  WEB_TIMEOUT_MS,
  charsetFromHtml,
  charsetOf,
  kindOfContentType,
  webUrlBlockReason,
  type WebKind,
} from './web-core'

export interface WebFetchOk {
  ok: true
  /** 请求的地址（规范化之后） */
  url: string
  /** 重定向之后真正读到的地址 */
  finalUrl: string
  status: number
  contentType: string
  kind: WebKind
  /** 正文文本（html 就是整页 HTML，交给渲染层提取） */
  text: string
  bytes: number
  /** 超过体积上限被截断了 */
  truncated: boolean
}

export type WebFetchResult = WebFetchOk | { ok: false; error: string }

/**
 * 一个正常的浏览器 UA。
 *
 * 为什么不用 Electron 的默认 UA：不少站点（尤其文档站与博客）会按 UA 直接回 403/406，
 * 而这里读的是公开页面、与用户手动打开它没有分别——伪装成浏览器是让「读得到」而不是「绕过什么」。
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

async function fetchPage(raw: unknown): Promise<WebFetchResult> {
  const url = typeof raw === 'string' ? raw.trim() : ''
  const blocked = webUrlBlockReason(url)
  if (blocked) return { ok: false, error: blocked }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), WEB_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ac.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    })
    const contentType = res.headers.get('content-type') ?? ''
    const kind = kindOfContentType(contentType)
    if (!res.ok) return { ok: false, error: t('这个地址回了 {0}（{1}）', res.status, res.statusText) }
    if (kind === 'other') return { ok: false, error: t('这不是能读的网页（{0}）：只读 HTML 与纯文本', contentType) }

    const { bytes, truncated, body } = await readCapped(res)
    const text = decodeBody(body, contentType, kind)
    return {
      ok: true,
      url,
      finalUrl: res.url || url,
      status: res.status,
      contentType,
      kind,
      text,
      bytes,
      truncated,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (ac.signal.aborted) return { ok: false, error: t('抓取超时（超过 {0} 秒）：这个站点太慢或连不上', Math.round(WEB_TIMEOUT_MS / 1000)) }
    return { ok: false, error: t('抓取失败：{0}', msg) }
  } finally {
    clearTimeout(timer)
  }
}

/** 边读边数：超过上限就当场停下（不先读完再判断——那正是要避免的） */
async function readCapped(res: Response): Promise<{ body: Uint8Array; bytes: number; truncated: boolean }> {
  const reader = res.body?.getReader()
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer())
    const truncated = buf.byteLength > WEB_MAX_BYTES
    return { body: buf.subarray(0, WEB_MAX_BYTES), bytes: Math.min(buf.byteLength, WEB_MAX_BYTES), truncated }
  }
  const chunks: Uint8Array[] = []
  let bytes = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value?.byteLength) continue
    const room = WEB_MAX_BYTES - bytes
    if (value.byteLength >= room) {
      chunks.push(value.subarray(0, room))
      bytes += room
      truncated = true
      await reader.cancel().catch(() => {})
      break
    }
    chunks.push(value)
    bytes += value.byteLength
  }
  const body = new Uint8Array(bytes)
  let at = 0
  for (const c of chunks) {
    body.set(c, at)
    at += c.byteLength
  }
  return { body, bytes, truncated }
}

/**
 * 解码：先看响应头，没有就嗅探 HTML 头部的 <meta charset>。
 * 中文站里这两条都不带的情况依然存在（那就是 utf-8）。
 */
function decodeBody(body: Uint8Array, contentType: string, kind: WebKind): string {
  const header = charsetOf(contentType)
  const fromHeader = /charset/i.test(contentType)
  const head = kind === 'html' ? new TextDecoder('utf-8').decode(body.subarray(0, 4096)) : ''
  const cs = fromHeader ? header : kind === 'html' ? charsetFromHtml(head) : header
  try {
    return new TextDecoder(cs).decode(body)
  } catch {
    return new TextDecoder('utf-8').decode(body)
  }
}

export function registerWebIpc(): void {
  ipcMain.handle('web:fetch', (_e, url: unknown) => fetchPage(url))
}
