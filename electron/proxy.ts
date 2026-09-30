/**
 * llm-proxy:// —— 渲染进程发起 AI 请求的唯一出口。
 *
 * 为什么需要它：本应用原先在浏览器里直连各家 API，而浏览器的同源策略限制了两件事：
 * 1. **CORS**：服务端必须显式放行才能读响应；Command Code 的网关更是只放行
 *    `Content-Type,Authorization`，而它的版本门禁又要求 `x-command-code-version`，
 *    于是浏览器直连必然失败；
 * 2. **禁止改写的请求头**：`User-Agent` 等由浏览器独占，脚本无法设置。
 *
 * 主进程没有这些限制。渲染进程把请求发到 `llm-proxy://<host>/<path>`，
 * 主进程校验 host 后转发到 `<协议>//<host>/<path>`，再把响应原样流回。
 * **协议跟着白名单走**（`http://` 也要能转发）：本地 Ollama / vLLM 与不少内网网关
 * 都是明文 http，而改写后的地址里没有协议——只认 https 的话它们一个都连不上。
 * 自定义协议在 Electron 里是「特权协议」（见 main.ts 的 registerSchemesAsPrivileged），
 * 不受 CORS 约束，因此这一层同时解决了上面两个问题。
 *
 * 安全边界：只放行白名单内的 host，绝不做一个开放代理。白名单来自「已知提供商预设
 * 的地址 ∪ 用户在设置里实际填过的地址」，由渲染进程通过 llm-proxy:setHosts 同步过来。
 */

import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { t } from './i18n'
import { ORIGIN_PARAM, forwardTarget, originSet } from './proxy-core'

/**
 * 允许转发的目标地址（`协议//host[:端口]`）。
 * 初始为空——渲染进程挂载后会把提供商名单同步过来；在那之前的请求一律拒绝。
 *
 * 协议与端口都由渲染层告诉这里（它才知道用户填的是什么），解析见 proxy-core。
 */
let allowedOrigins = new Set<string>()

/** 覆盖渲染进程同步过来的白名单；每一项是 `协议//host[:端口]` */
export function setAllowedHosts(entries: string[]): void {
  allowedOrigins = originSet(entries)
}

/** 当前白名单（供状态查询与调试） */
export const allowedHostList = (): string[] => [...allowedOrigins].sort()

export const isAllowedOrigin = (origin: string): boolean => allowedOrigins.has(origin)

/** 请求体：web ReadableStream → Node Readable（Node fetch 需要后者） */
function toNodeBody(body: ReadableStream<Uint8Array> | null): Readable | undefined {
  return body ? Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]) : undefined
}

/**
 * 处理一条 llm-proxy 请求：校验 → 转发 → 流式回传。
 *
 * 响应头做两处修正：
 * - **丢掉 `access-control-*`**：目标服务给的那份只放行少数头，留着会让浏览器
 *   再拦一次；自定义协议的跨域由 Electron 按 registerSchemesAsPrivileged 的
 *   `corsEnabled` 处理，不需要上游配合。
 * - **丢掉 `content-length` / `content-encoding`**：Node fetch 已解压，长度需由
 *   协议层重算，否则响应体会对不上。
 */
export async function handleProxyRequest(request: Request): Promise<Response> {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return jsonError(400, t('请求地址不合法'))
  }

  if (url.protocol !== 'llm-proxy:') return jsonError(400, t('不支持的协议：{0}', url.protocol))
  // 目标地址从查询串里取（authority 那一路留不下端口与协议），不在白名单就拒绝——绝不做一个开放代理
  const target = forwardTarget(allowedOrigins, url)
  if (!target) {
    const asked = url.searchParams.get(ORIGIN_PARAM) || t('(没写)') + ' ' + url.host
    return jsonError(403, t('代理目标不在白名单内：{0}。请在设置里保存一次该提供商的配置。', asked))
  }
  const headers = new Headers(request.headers)
  // 这些头由转发层自己决定，透传会出错
  headers.delete('host')
  headers.delete('origin')
  headers.delete('referer')
  headers.delete('content-length')
  // undici 会按需自己协商压缩；透传浏览器的 accept-encoding 会拿到已解压却仍标着
  // content-encoding 的响应
  headers.delete('accept-encoding')

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : toNodeBody(request.body),
      // Node fetch 的硬性要求：body 是流时必须声明 half duplex
      duplex: 'half',
      redirect: 'follow',
    } as RequestInit)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return jsonError(502, t('转发到 {0} 失败：{1}', url.host, message))
  }

  const outHeaders = new Headers()
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase()
    if (k.startsWith('access-control-')) return
    if (k === 'content-length' || k === 'content-encoding' || k === 'transfer-encoding') return
    outHeaders.set(key, value)
  })

  // 直接回传上游的 body 流：SSE 与 NDJSON 都要边到边推，不能缓冲
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  })
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** 注册协议处理器（在 app.whenReady 之后调用） */
export function registerProxyProtocol(): void {
  protocol.handle('llm-proxy', handleProxyRequest)
}
