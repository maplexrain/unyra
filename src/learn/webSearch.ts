/**
 * DeepSeek 官方网络搜索与网页抓取服务。
 * 
 * 官方文档规范: https://api-docs.deepseek.com/zh-cn/guides/search
 * 
 * 包含两个核心 API：
 * 1. Search API: POST https://api.deepseek.com/v1/tools/search
 *    - query: string (1~128 字符，必填；支持 q / keyword 别名)
 *    - count?: number (1~50，默认 5；支持 maxResults / limit / pageSize 别名)
 *    - ori_question?: string (用户原始问题；支持 oriQuestion 别名)
 *    - localization?: string (IP 定位)
 *    - need_content?: boolean (是否返回正文，默认 false；支持 needContent 别名)
 *    返回 { ok: true, results: [{ title, url, snippet, summary, rerank_score, authority?, content? }] }
 *    失败返回 { ok: false, results: [], error: string }
 * 
 * 2. Fetch API: POST https://api.deepseek.com/v1/tools/fetch
 *    - url: string (必填，合法的 http/https 链接；支持 link / href 别名)
 *    返回 { ok: true, title, content } (Markdown 格式正文)
 *    失败返回 { ok: false, title: '', content: '', error: string }
 */

import { httpFetch } from '../ai/http'
import { resolveSearchApiKey } from '../ai/settings'

export const DEEPSEEK_SEARCH_ENDPOINT = 'https://api.deepseek.com/v1/tools/search'
export const DEEPSEEK_FETCH_ENDPOINT = 'https://api.deepseek.com/v1/tools/fetch'

/**
 * 默认搜索返回条数。
 * 实测每条结果约 1.5k~2.1k 字符；若使用默认 10 条，单次结果约 21k 字符，
 * 极易触碰沙箱 3.2 万字符上限导致后续查询被截断丢弃。
 * 默认设为 5 条（约 10k 字符），既保证足够的信息量与权威度，又留足上下文空间。
 */
export const DEFAULT_SEARCH_COUNT = 5

export interface DeepSeekSearchParams {
  query: string
  count?: number
  ori_question?: string
  localization?: string
  need_content?: boolean
  // 兼容别名
  maxResults?: number
  max_results?: number
  limit?: number
  pageSize?: number
  page_size?: number
  q?: string
  keyword?: string
  needContent?: boolean
  oriQuestion?: string
}

export interface DeepSeekSearchResultItem {
  title: string
  url: string
  snippet: string
  summary: string
  rerank_score: number
  authority?: number
  content?: string
  [key: string]: unknown
}

export interface DeepSeekSearchSuccess {
  ok: true
  results: DeepSeekSearchResultItem[]
}

export interface DeepSeekSearchFailure {
  ok: false
  results: DeepSeekSearchResultItem[]
  error: string
}

export type DeepSeekSearchResponse = DeepSeekSearchSuccess | DeepSeekSearchFailure

export interface DeepSeekFetchParams {
  url: string
  link?: string
  href?: string
}

export interface DeepSeekFetchSuccess {
  ok: true
  title: string
  content: string
}

export interface DeepSeekFetchFailure {
  ok: false
  title: string
  content: string
  error: string
}

export type DeepSeekFetchResponse = DeepSeekFetchSuccess | DeepSeekFetchFailure

/**
 * 参数归一化：支持 count / maxResults / limit / pageSize 别名与字符串数字解析，
 * 并默认将 count 设为 5（防止单次搜索体积过大撑爆 execute 32k 上限）。
 */
export function normalizeSearchParams(
  queryOrParams: unknown,
  opts?: unknown,
): {
  query: string
  count: number
  ori_question?: string
  localization?: string
  need_content?: boolean
} {
  let rawQuery = ''
  let rawCount: unknown
  let rawOriQuestion: unknown
  let rawLocalization: unknown
  let rawNeedContent: unknown

  if (typeof queryOrParams === 'object' && queryOrParams !== null) {
    const obj = queryOrParams as Record<string, unknown>
    rawQuery = String(obj.query ?? obj.q ?? obj.keyword ?? '')
    rawCount =
      obj.count ??
      obj.maxResults ??
      obj.max_results ??
      obj.limit ??
      obj.num ??
      obj.pageSize ??
      obj.page_size
    rawOriQuestion = obj.ori_question ?? obj.oriQuestion
    rawLocalization = obj.localization
    rawNeedContent = obj.need_content ?? obj.needContent
  } else {
    rawQuery = String(queryOrParams ?? '')
    if (typeof opts === 'object' && opts !== null) {
      const optObj = opts as Record<string, unknown>
      rawCount =
        optObj.count ??
        optObj.maxResults ??
        optObj.max_results ??
        optObj.limit ??
        optObj.num ??
        optObj.pageSize ??
        optObj.page_size
      rawOriQuestion = optObj.ori_question ?? optObj.oriQuestion
      rawLocalization = optObj.localization
      rawNeedContent = optObj.need_content ?? optObj.needContent
    }
  }

  // 解析条数：默认 5 条
  let count = DEFAULT_SEARCH_COUNT
  if (typeof rawCount === 'number' && Number.isFinite(rawCount)) {
    count = Math.min(50, Math.max(1, Math.floor(rawCount)))
  } else if (typeof rawCount === 'string') {
    const parsed = parseInt(rawCount.trim(), 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      count = Math.min(50, Math.max(1, parsed))
    }
  }

  const query = rawQuery.trim().slice(0, 128)
  const ori_question =
    typeof rawOriQuestion === 'string' && rawOriQuestion.trim()
      ? rawOriQuestion.trim()
      : undefined
  const localization =
    typeof rawLocalization === 'string' && rawLocalization.trim()
      ? rawLocalization.trim()
      : undefined
  const need_content =
    typeof rawNeedContent === 'boolean' ? rawNeedContent : undefined

  return {
    query,
    count,
    ...(ori_question ? { ori_question } : {}),
    ...(localization ? { localization } : {}),
    ...(need_content !== undefined ? { need_content } : {}),
  }
}

/**
 * URL 归一化：支持 url / link / href 等别名
 */
export function normalizeFetchUrl(urlOrParams: unknown): string {
  if (typeof urlOrParams === 'string') {
    return urlOrParams.trim()
  }
  if (typeof urlOrParams === 'object' && urlOrParams !== null) {
    const obj = urlOrParams as Record<string, unknown>
    return String(obj.url ?? obj.link ?? obj.href ?? '').trim()
  }
  return ''
}

/**
 * 直接调用 DeepSeek 官方搜索 API。
 * 保证始终返回统一的 { ok, results, error? } 结构，results 恒定为数组。
 */
export async function callDeepSeekSearch(
  params: DeepSeekSearchParams,
  apiKey?: string,
): Promise<DeepSeekSearchResponse> {
  const key = (apiKey ?? resolveSearchApiKey()).trim()
  if (!key) {
    return {
      ok: false,
      results: [],
      error:
        '尚未配置 DeepSeek API Key。请在「设置 - 模型 - 网络搜索」中配置 DeepSeek API Key，或添加已配置的 DeepSeek 提供商。',
    }
  }

  const normalized = normalizeSearchParams(params)
  if (!normalized.query) {
    return {
      ok: false,
      results: [],
      error: '搜索关键词 query 不能为空（1~128 个字符）。',
    }
  }

  const body: Record<string, unknown> = {
    query: normalized.query,
    count: normalized.count,
  }
  if (normalized.ori_question) body.ori_question = normalized.ori_question
  if (normalized.localization) body.localization = normalized.localization
  if (normalized.need_content !== undefined) body.need_content = normalized.need_content

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new Error('DeepSeek 搜索请求超时（超过 25 秒）'))
  }, 25000)

  try {
    const res = await httpFetch(DEEPSEEK_SEARCH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)

    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) {
      const msg =
        (json?.error as { message?: string })?.message ||
        (typeof json?.message === 'string' ? json.message : '') ||
        `HTTP ${res.status}: ${res.statusText || '请求异常'}`
      return { ok: false, results: [], error: `DeepSeek 搜索服务调用失败：${msg}` }
    }

    if (json && typeof json.error === 'string') {
      return { ok: false, results: [], error: `DeepSeek 搜索服务返回错误：${json.error}` }
    }

    const rawResults = (json?.results && Array.isArray(json.results)) ? json.results : []
    return {
      ok: true,
      results: rawResults as DeepSeekSearchResultItem[],
    }
  } catch (err) {
    clearTimeout(timer)
    return {
      ok: false,
      results: [],
      error:
        'DeepSeek 搜索网络请求失败：' + (err instanceof Error ? err.message : String(err)),
    }
  }
}

/**
 * 直接调用 DeepSeek 官方 Fetch 抓取 API。
 * 保证始终返回统一的 { ok, title, content, error? } 结构，
 * title 与 content 恒定为字符串（失败时为空字符串），防止 agent 访问 content.slice 崩溃。
 */
export async function callDeepSeekFetch(
  params: DeepSeekFetchParams,
  apiKey?: string,
): Promise<DeepSeekFetchResponse> {
  const key = (apiKey ?? resolveSearchApiKey()).trim()
  if (!key) {
    return {
      ok: false,
      title: '',
      content: '',
      error:
        '尚未配置 DeepSeek API Key。请在「设置 - 模型 - 网络搜索」中配置 DeepSeek API Key，或添加已配置的 DeepSeek 提供商。',
    }
  }

  const url = normalizeFetchUrl(params)
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return {
      ok: false,
      title: '',
      content: '',
      error: 'fetch 需要合法的 http:// 或 https:// 网页地址。',
    }
  }

  const controller = new AbortController()
  /*
    8 秒硬超时。抓正文是调研链路上最容易卡住的一环：站点慢、反爬、超时重试都会把一轮
    对话拖进几十秒的干等。窗口期缩短之后失败要快——agent 拿到 ok:false 就换来源或降级
    用摘要，而不是原地等。8 秒是实测的折中：DeepSeek 要现场抓取并转 Markdown，5 秒对
    慢站失败率偏高，再长又失去「快速失败」的意义。

    为什么还要再 race 一层：abort 只是「请求侧取消」，经自定义协议转发出去时不一定
    立刻兑现（取消信号在代理那一端未必透传）。race 保证时间一到这个函数就返回，
    不会让调用方卡在等正文上。
  */
  const TIMEOUT_MS = 8000
  let timer: ReturnType<typeof setTimeout> | null = null
  const stopTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`抓取超过 ${TIMEOUT_MS / 1000} 秒`, { cause: 'timeout' })
      controller.abort(err)
      reject(err)
    }, TIMEOUT_MS)
  })

  try {
    const res = await Promise.race([
      httpFetch(DEEPSEEK_FETCH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      }),
      timeout,
    ])
    // 正文也落在同一个 8 秒窗口里：头回来了、body 卡住同样等于没抓到
    const json = (await Promise.race([res.json().catch(() => null), timeout])) as Record<
      string,
      unknown
    > | null
    stopTimer()
    if (!res.ok) {
      const msg =
        (json?.error as { message?: string })?.message ||
        (typeof json?.message === 'string' ? json.message : '') ||
        `HTTP ${res.status}: ${res.statusText || '请求异常'}`
      return { ok: false, title: '', content: '', error: `DeepSeek 抓取服务调用失败：${msg}` }
    }

    // DeepSeek 抓取服务在抓取特定外部站点失败时可能返回 200 伴随 { error: "failed to fetch URL" }
    if (json && typeof json.error === 'string') {
      return {
        ok: false,
        title: String(json.title ?? ''),
        content: String(json.content ?? ''),
        error: `DeepSeek 网页抓取失败：${json.error}`,
      }
    }

    return {
      ok: true,
      title: String(json?.title ?? ''),
      content: String(json?.content ?? ''),
    }
  } catch (err) {
    stopTimer()
    const msg = err instanceof Error ? err.message : String(err)
    // 超时单独说清楚：让 agent 直接换来源，而不是当成网络故障去重试同一页
    if ((err as { cause?: unknown } | null)?.cause === 'timeout' || msg.includes('抓取超过')) {
      return {
        ok: false,
        title: '',
        content: '',
        error: `抓取超时（${TIMEOUT_MS / 1000} 秒）：这一页没能及时返回。换一个来源，或降级用搜索结果里的摘要；不要重试同一 URL。`,
      }
    }
    return {
      ok: false,
      title: '',
      content: '',
      error:
        'DeepSeek 抓取网络请求失败：' + msg,
    }
  }
}

/**
 * execute 沙箱中的 api.web.search 入口。
 * 支持别名（count, maxResults, limit）与默认 count=5，返回结构保证 results 为数组。
 */
export async function searchForAgent(queryOrParams: unknown, opts?: unknown): Promise<unknown> {
  const normalized = normalizeSearchParams(queryOrParams, opts)
  if (!normalized.query) {
    return {
      ok: false,
      results: [],
      error:
        'web.search 需要有效的 query 搜索词，例如 api.web.search({ query: "知识点" }) 或 api.web.search("知识点", { count: 5 })',
    }
  }

  return await callDeepSeekSearch(normalized)
}

/**
 * execute 沙箱中的 api.fetch 入口。
 * 支持 url / link / href 等别名，保证返回 { ok, title, content, error? } 且 content 恒为字符串。
 */
export async function fetchForAgent(urlOrParams: unknown): Promise<unknown> {
  const url = normalizeFetchUrl(urlOrParams)
  if (!url) {
    return {
      ok: false,
      title: '',
      content: '',
      error:
        'fetch 需要有效的 url 参数，例如 api.fetch({ url: "https://..." }) 或 api.fetch("https://...")',
    }
  }

  return await callDeepSeekFetch({ url })
}

