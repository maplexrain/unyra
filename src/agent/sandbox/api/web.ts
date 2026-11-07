/**
 * 这个文件负责什么：网络 api 的装配（fetch / web.fetch / web.search）——单篇与批量
 * 网页抓取和 DeepSeek Search API 搜索。
 * **敏感区（口径一行不能动）**：fetch 批量一次最多并发 5 篇 + maxChars 严格截断
 * （截断信息记入元数据）；web.search 的参数整形与空 query 的报错话术。
 */
import { asRecord, asText } from '../refs'
import { wrapApi } from '../wrap'
import type { SandboxCall, SandboxOptions } from '../types'

/** 网络域：fetch / web.fetch / web.search */
export function installWeb(api: Record<string, unknown>, opts: SandboxOptions, log: SandboxCall[]): void {
  // 网络搜索与网页抓取（基于 DeepSeek 官方 Search API 与 Fetch API）
  if (opts.web) {
    const web = opts.web
    const fetchOne = async (item: unknown): Promise<unknown> => {
      let url = ''
      if (typeof item === 'string') {
        url = item.trim()
      } else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>
        url = asText(obj.url ?? obj.link ?? obj.href).trim()
      }
      if (!url) {
        return {
          ok: false,
          title: '',
          content: '',
          error: 'fetch 需要有效的 url 参数，例如 api.fetch({ url: "https://..." }) 或 api.fetch("https://...")',
        }
      }
      return web.fetch(item && typeof item === 'object' ? { ...(item as Record<string, unknown>), url } : { url })
    }
    /** maxChars 截断：严格不超过 maxChars，截断信息记入元数据 */
    const clipContent = (maxChars: number | undefined) => (r: unknown): unknown => {
      const rec = r as Record<string, unknown> | null
      if (maxChars && rec && typeof rec.content === 'string' && rec.content.length > maxChars) {
        return {
          ...rec,
          truncated: true,
          totalChars: rec.content.length,
          content: rec.content.slice(0, maxChars),
          note: `已按 maxChars(${maxChars}) 严格截断（全文共 ${rec.content.length} 字符）`,
        }
      }
      return r
    }
    /**
     * 单篇与批量同一入口：api.fetch(url 或 {url}, { maxChars? })；
     * 批量 api.fetch([url, {url}, …], { maxChars? })——并发抓、逐条返回 {ok}，
     * 一篇失败只标记它自己，不拖累其他篇（省掉串行试错整轮整轮地烧）。
     */
    const handleFetch = async (args: unknown[]): Promise<unknown> => {
      const options = args[1] && typeof args[1] === 'object' ? (args[1] as Record<string, unknown>) : {}
      const maxChars = typeof options.maxChars === 'number' && options.maxChars > 0 ? Math.floor(options.maxChars) : undefined
      const clip = clipContent(maxChars)
      if (Array.isArray(args[0])) {
        const items = args[0]
        if (!items.length) return { ok: false, error: '批量 fetch 要给 url 数组：api.fetch([url1, url2], { maxChars })' }
        if (items.length > 5) {
          return { ok: false, error: '一次最多并发抓 5 篇（收到 ' + items.length + '）——挑最权威的几篇就够' }
        }
        const results = await Promise.all(
          items.map(async (item) => {
            try {
              return await fetchOne(item).then(clip)
            } catch (err) {
              return { ok: false, title: '', content: '', error: err instanceof Error ? err.message : String(err) }
            }
          }),
        )
        return { ok: true, results }
      }
      return fetchOne(args[0]).then(clip)
    }
    // 支持 api.fetch 与 api.web.fetch
    // 顶层 fetch 是 web.fetch 的快捷别名：提示词里教的就是 api.fetch，别删
    wrapApi(api, 'fetch', handleFetch, log)
    wrapApi(api, 'web.fetch', handleFetch, log)

    // web.search（完全支持 DeepSeek Search API 参数）
    if (web.search) {
      const webSearch = web.search
      wrapApi(
        api,
        'web.search',
        (args) => {
          const first = args[0]
          if (typeof first === 'object' && first !== null) {
            return webSearch(first)
          }
          const query = asText(first).trim()
          if (!query) {
            return {
              ok: false,
              results: [],
              error:
                'web.search 需要有效的 query 搜索词，例如 api.web.search({ query: "知识点" }) 或 api.web.search("知识点", { count: 5 })',
            }
          }
          const second = asRecord(args[1])
          return webSearch({ query, ...second })
        },
        log,
      )
    }
  }
}
