/**
 * 渲染进程的 HTTP 出口：把 AI 请求交给主进程转发。
 *
 * 应用以 Electron 运行，渲染进程不再直接 fetch 外部 API。原因有两个，
 * 且都不是「配置问题」：
 * 1. **CORS**：Command Code 网关的预检只放行 `Content-Type,Authorization`，
 *    而它的版本门禁又要求 `x-command-code-version`——浏览器永远发不出这个头；
 * 2. **禁止改写的请求头**：`User-Agent` 等由浏览器独占。
 *
 * 做法：把目标地址改写成 `llm-proxy://target/<path>?__moji_origin=<协议//host[:端口]>`，
 * 由主进程（electron/proxy.ts）用 Node fetch 真正发出去，响应流式回传。
 * 自定义协议是 Electron 的特权协议，不受 CORS 约束。
 *
 * **目标地址为什么走查询串而不是 authority**：`llm-proxy:` 不是 URL 规范里的 special scheme，
 * authority 按 opaque host 解析，端口会被整个丢掉（`llm-proxy://127.0.0.1:8799/x` 只剩
 * host `127.0.0.1`），协议也分不出 http / https。于是本地 Ollama / 内网网关一律撞 403。
 * 细节与两端的分工见 electron/proxy-core 的 ORIGIN_PARAM。
 *
 * 调用方（client.ts / commandcode.ts）只把 `fetch` 换成这里的 `httpFetch`，
 * 其余逻辑——URL 怎么拼、头发什么、流怎么解析——完全不变。
 */

import { isElectron, native } from '../lib/native'
// 目标地址怎么捎带：与主进程共用同一份定义（唯一真值，改一处两边一起变）
import { toProxyUrl } from '../../electron/proxy-core'

/** preload 注入的原生桥；定义见 src/lib/native.ts（这里转出去，保持既有引用路径） */
export { isElectron, native, type NativeBridge } from '../lib/native'

/**
 * 把目标地址改写成经主进程转发的地址。
 * 只改写 http/https；`llm-proxy:` 与 `data:` 等原样返回，避免二次包装。
 * 改写规则本身在 electron/proxy-core 的 toProxyUrl 里（纯函数，Node 探针钉得住）。
 */
export function proxyUrl(target: string): string {
  return toProxyUrl(target) ?? target
}

/**
 * 发起一次 AI 请求。签名与 `fetch` 一致，因此调用方的改动只是换个函数名。
 */
export function httpFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(proxyUrl(input), init)
}

/* ---------- 代理白名单 ---------- */

/**
 * 已知提供商的 `协议//host` 集合。主进程只放行这些地址，绝不做开放代理。
 * 由 ai/providers 的预设经 syncProxyHosts 推给主进程。
 *
 * **每一项都带协议**，这不是装饰：改写后的 `llm-proxy://host/path` 里没有协议，
 * 主进程只能从这份名单里取。原先只传 host、转发时写死 https，于是
 * 「本地 Ollama / vLLM」这条被文档写进支持范围的路根本走不通——
 * 那些服务是明文 http，TLS 握手当场失败。协议由渲染层给，因为只有它见过用户填的地址。
 */
let knownOrigins: string[] = []

/** 取出一个 baseUrl 的 `协议//host`（小写）；非法地址与非 http(s) 协议返回 null */
export function originOfBaseUrl(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.protocol + '//' + url.host.toLowerCase()
  } catch {
    return null
  }
}

/**
 * 同步白名单到主进程。
 *
 * 请把「所有内置预设的地址」加上「当前用户实际配置的地址」一起传进来：
 * 只同步预设会漏掉用户自己填的中转，只同步已配置的又会让刚打开设置页、
 * 还没保存的提供商不可用。
 *
 * @returns 主进程最终接受的白名单（已过滤非法项），便于排查
 */
export async function syncProxyHosts(baseUrls: string[]): Promise<string[]> {
  const origins = baseUrls.map(originOfBaseUrl).filter((o): o is string => !!o)
  // 去重后排序：同一个 host 出现两次时，主进程按「后者覆盖前者」处理（见 proxy-core），
  // 排序让「后者」是确定的，不会因为配置顺序变来变去
  knownOrigins = [...new Set(origins)].sort()
  if (!isElectron()) return knownOrigins
  try {
    const accepted = await native().setProxyHosts(knownOrigins)
    return accepted
  } catch {
    // 同步失败不该让应用起不来：后续请求会拿到主进程的 403 与明确提示
    return knownOrigins
  }
}

/** 当前已同步的白名单（只读，便于设置页展示与排查）；每项是 `协议//host` */
export const proxyOrigins = (): string[] => [...knownOrigins]
