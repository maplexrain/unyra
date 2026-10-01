/**
 * 抓网页的**纯判断**：地址能不能抓、算不算文本、按什么编码读。
 *
 * 为什么单独一个文件：这些规则是「安不安全」与「读不读得懂」的分界，
 * 而它们不需要网络也不需要 electron——Node 探针里能一条条钉住
 * （见 scripts/agent-ops.test.ts 与 tests/webPage.test.ts）。
 *
 * 返回的「给模型看的一句人话」同时也是界面上给用户看的错误文案，所以走 t()
 * （中文原文即键，见 electron/i18n）；本文件不 import electron，t 在 electron/i18n 里
 * 只依赖 app.getLocale，Node 探针里不触发它就没事。
 */
import { t } from './i18n'

/** 一次抓取最多读多少字节：超过就截断（正文早就在前面了，后面的多半是评论与脚注） */
export const WEB_MAX_BYTES = 4 * 1024 * 1024
/** 抓取超时：慢站点不该把一轮对话吊在那里 */
export const WEB_TIMEOUT_MS = 20_000

/**
 * 这两个状态码换一套浏览器指纹再试一次往往就过了：403 是站点（或它前面的防护）
 * 认出了「不是浏览器的请求」，429 是同一 UA 的频控。纯函数，Node 探针钉得住。
 */
export function shouldRetryWithAlt(status: number): boolean {
  return status === 403 || status === 429
}

/**
 * 这个地址能不能抓。返回 null 表示可以，否则是给模型看的一句人话。
 *
 * 只放行 http/https，并且**不许指向本机与内网**：agent 是模型写的代码在跑，
 * 给它一个能访问 127.0.0.1 的抓取口子，等于把本机服务（包括我们自己的 llm-proxy）
 * 暴露成一个可以被它读的接口。这条边界不需要跟用户商量。
 */
export function webUrlBlockReason(raw: string): string | null {
  let u: URL
  try {
    u = new URL(String(raw ?? '').trim())
  } catch {
    return t('这个地址读不出来——要写成 https://example.com/page 这样的完整地址')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return t('只支持 http / https 地址')
  const host = u.hostname.toLowerCase()
  if (!host) return t('地址里没有主机名')
  if (isPrivateHost(host)) return t('不能抓本机与内网地址（{0}）', host)
  return null
}

/** 本机 / 内网地址判定（IPv4 私网段、回环、链路本地、IPv6 回环与 ULA） */
export function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  // IPv6：::1 回环、fc00::/7 唯一本地、fe80::/10 链路本地
  if (h.includes(':')) {
    if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true
    if (/^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return true
    return false
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

export type WebKind = 'html' | 'text' | 'other'

/** 这一份响应是什么：html 要走正文提取，text 直接用，其余不给模型读 */
export function kindOfContentType(contentType: string | null): WebKind {
  const ct = (contentType ?? '').toLowerCase()
  if (!ct) return 'html'
  if (ct.includes('text/html') || ct.includes('application/xhtml')) return 'html'
  if (ct.startsWith('text/') || ct.includes('json') || ct.includes('xml') || ct.includes('markdown')) return 'text'
  return 'other'
}

/** 响应头里的编码；认不出来就给 utf-8（现代网页的默认） */
export function charsetOf(contentType: string | null): string {
  const m = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? '')
  return normalizeCharset(m?.[1])
}

/** 从 HTML 头部嗅探编码（很多中文站的响应头根本不带 charset，只在 <meta> 里写） */
export function charsetFromHtml(head: string): string {
  const m = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)
  return normalizeCharset(m?.[1])
}

function normalizeCharset(raw: string | undefined): string {
  const cs = (raw ?? '').trim().toLowerCase()
  if (!cs) return 'utf-8'
  // gb2312 / gbk / gb18030 是同一族，TextDecoder 认 gbk 与 gb18030；gb2312 归到 gbk
  if (cs === 'gb2312' || cs === 'gbk' || cs === 'gb18030') return 'gb18030'
  if (cs === 'utf8' || cs === 'utf-8') return 'utf-8'
  return cs
}
