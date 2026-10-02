/**
 * 地址栏输入的归一：一条输入，两种意思——像网址的就补协议，不是网址的就交搜索。
 *
 * 与浏览器的地址栏同一套直觉：`example.com` 直接进，`localhost` 与纯 IP 走 http
 * （本机开发服务器几乎没有 https），带空格或不像域名的交搜索引擎。
 * 危险 scheme（javascript:、data:…）不直接执行——落进搜索，顶多搜出一堆结果。
 */

const SEARCH = 'https://www.bing.com/search?q='

export function normalizeWebInput(input: string): string {
  const s = input.trim()
  if (!s) return ''
  // 已带协议的原样放行（http/https/file/about：看本地 html、内网服务都算正经诉求）
  if (/^https?:\/\//i.test(s) || /^file:\/\//i.test(s) || /^about:blank$/i.test(s)) return s
  // 有空格就不是网址
  if (/\s/.test(s)) return SEARCH + encodeURIComponent(s)
  // localhost 与纯 IP 用 http：本机开发服务器几乎没有 https
  if (/^localhost(:\d+)?([/?#]|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/.test(s)) {
    return 'http://' + s
  }
  // 「像域名的」：至少一个点 + 合法字符，可带端口/路径
  if (/^[a-z\d-]+(\.[a-z\d-]+)+(:\d+)?([/?#].*)?$/i.test(s)) return 'https://' + s
  return SEARCH + encodeURIComponent(s)
}
