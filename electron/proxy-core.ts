/**
 * llm-proxy 的纯逻辑：白名单项怎么解析、一次请求该转发到哪里。
 *
 * 为什么单独一个文件：proxy.ts 要 `import { protocol } from 'electron'`，而那份模块在 Node 里
 * 拿不到（它是 electron 包的路径字符串），于是这段判断就没法被探针覆盖——
 * 而它正好是出过问题的地方（见下面两段说明）。
 * 与 update / update-core 是同一种拆法。
 */

/**
 * 请求里捎带「真正的目标地址」的参数名。**两端必须一致**，因此只在这里定义一次
 * （渲染层 import 这个常量，见 ai/http 的 proxyUrl）。
 *
 * 为什么目标地址不能像原来那样放在 authority 里：`llm-proxy:` 是我们自己注册的协议，
 * 它不是 URL 规范里的 special scheme，authority 按 opaque host 解析——
 * **端口会被整个丢掉**：`llm-proxy://127.0.0.1:8799/x` 解析出来只剩 host `127.0.0.1`，
 * 连 href 里都没有了，事后无法还原。而本地 Ollama / vLLM / 内网网关恰恰都带端口，
 * 于是它们一律撞上「代理目标不在白名单内」。协议同理：http 与 https 分不出来。
 * 结论：目标地址（协议 + host + 端口）整体走查询串，authority 只留一个占位 host。
 */
export const ORIGIN_PARAM = '__moji_origin'

/** 占位 host：它不参与任何判断，只为凑出一个合法的 URL */
export const PLACEHOLDER_HOST = 'target'

/** 主机名部分：普通域名/IPv4，或带方括号的 IPv6 */
const HOST = '(\\[[0-9a-f:]+\\]|[a-z0-9.-]+)'
const PORT = '(?::(\\d+))?'
const ORIGIN = new RegExp('^(?:(https?):\\/\\/)?' + HOST + PORT + '$')

/**
 * 解析一个「协议 + host + 端口」：`http://127.0.0.1:11434` / `https://api.deepseek.com` /
 * 光秃秃的 `api.deepseek.com`（按 https 兜底，历史行为）都收。
 * 解析不出来回 null：带路径、带查询串、非 http(s) 协议、空值一律不收。
 */
export function parseOrigin(raw: unknown): string | null {
  const m = ORIGIN.exec(String(raw ?? '').trim().toLowerCase())
  if (!m) return null
  return (m[1] === 'http' ? 'http:' : 'https:') + '//' + m[2] + (m[3] ? ':' + m[3] : '')
}

/**
 * 白名单项 → 集合。放行的单位是**完整的目标地址**（含协议与端口），
 * 因此「同一个 host 配了两种协议」不再有歧义：那是两条不同的白名单项。
 */
export function originSet(entries: unknown[]): Set<string> {
  const set = new Set<string>()
  for (const raw of entries) {
    const origin = parseOrigin(raw)
    if (origin) set.add(origin)
  }
  return set
}

/**
 * 这次请求该转发到哪个完整地址；目标不在白名单里回 null（调用方据此回 403）。
 *
 * 只认查询串里那个参数，不认 authority：那条路上端口与协议都留不下来（见 ORIGIN_PARAM）。
 * `__moji_origin` 会被摘掉再转发，上游看到的是它自己的查询串。
 */
export function forwardTarget(allowed: Set<string>, requestUrl: URL): string | null {
  const origin = parseOrigin(requestUrl.searchParams.get(ORIGIN_PARAM))
  if (!origin || !allowed.has(origin)) return null
  const rest = new URLSearchParams(requestUrl.searchParams)
  rest.delete(ORIGIN_PARAM)
  const query = rest.toString()
  return origin + requestUrl.pathname + (query ? '?' + query : '')
}

/**
 * 渲染层要把一个真实地址改写成代理地址时用它——**与 forwardTarget 是一对**，
 * 改一处必须改另一处（两边都只认 ORIGIN_PARAM）。
 */
export function toProxyUrl(target: string): string | null {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const params = new URLSearchParams(url.search)
  // url.host 已由 URL 解析器规范化过：小写、默认端口（:443/:80）已去掉
  params.set(ORIGIN_PARAM, url.protocol + '//' + url.host)
  const query = params.toString()
  return 'llm-proxy://' + PLACEHOLDER_HOST + url.pathname + (query ? '?' + query : '')
}
