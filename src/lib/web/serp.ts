/**
 * 搜索引擎结果页（SERP）的解析：**需要 DOM 的那一半**（只在渲染层跑，与 lib/web/dom
 * 同一条分工——字节由主进程取，解析在这里）。判断性的活儿（引擎表、地址拼装）也是纯函数，
 * 用例见 tests/webSerp.test.ts（happy-dom 环境）。
 *
 * 为什么按引擎一张表：五家引擎的结果块结构各不相同，但都是「结果容器 → 标题链接 + 摘要」
 * 的形状。每家给一组选择器与一条链接清洗规则，解析循环共用一份。选择器会随站点改版失效
 * ——失效的表现是解析出 0 条结果，调用方把「换一个引擎」写进回执，不会静默吞掉。
 */

export type SearchEngine = 'baidu' | 'bing' | 'google' | 'yandex' | 'wikipedia'

export const SEARCH_ENGINES: SearchEngine[] = ['baidu', 'bing', 'google', 'yandex', 'wikipedia']

/** 一条搜索结果：摘要已裁到 SNIPPET_MAX（进观察通道，太长会把正题挤没） */
export interface SerpResult {
  title: string
  url: string
  snippet: string
}

export const SNIPPET_MAX = 320

/** 每家引擎的解析规则：容器选择器 → 标题链接 → 摘要（按可信度从高到低，逐个试） */
interface EngineRule {
  item: string
  link: string
  snippet: string[]
  /** 链接清洗：有的引擎给跳转链/相对链/带包装参数的链，各回各家 */
  clean?: (href: string) => string
}

const BAIDU: EngineRule = {
  item: 'div.result, div.c-container',
  link: 'h3 a',
  snippet: ['.c-abstract', '[class*="content-right"]', '.c-span9'],
  // 百度的链接常是它自己的跳转链：原样交给 webFetch 就能跟到真页
  clean: (href) => (href.startsWith('/') ? 'https://www.baidu.com' + href : href),
}

/**
 * bing 的跳转链形如 /ck/a?!&p=…&u=a1aHR0cHM6…&ntb=1：u 参数去掉 a1 前缀后是
 * base64url 的真实地址。解开它，读原文就不必再经过 bing 的跳转器——
 * 那里对无 cookie 的抓取动不动回 403，是「搜索成功、抓取全挂」的常见元凶。
 */
function cleanBing(href: string): string {
  const u = /[?&]u=a1([A-Za-z0-9_-]+)/.exec(href)?.[1]
  if (!u) return href
  try {
    const b64 = u.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    const decoded = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
    return /^https?:\/\//i.test(decoded) ? decoded : href
  } catch {
    return href
  }
}

const BING: EngineRule = {
  item: 'li.b_algo',
  link: 'h2 a',
  snippet: ['.b_caption p', 'p'],
  clean: cleanBing,
}

const GOOGLE: EngineRule = {
  item: 'div.g, div.tF2Cxc, div.Gx5Zad',
  link: 'a',
  snippet: ['.VwiC3b', '.BNeawe', '.st', 'span'],
  // 免 JS 版（gbv=1）的链接是 /url?q=真地址&…：把真地址抠出来
  clean: (href) => {
    if (href.startsWith('/url?')) {
      const q = new URLSearchParams(href.split('?')[1] ?? '').get('q')
      if (q) return q
    }
    return href
  },
}

const YANDEX: EngineRule = {
  item: 'li.serp-item',
  link: 'a.OrganicTitle-Link, h2 a',
  snippet: ['.OrganicTextContentSpan', '.Organic-ContentWrapper'],
}

const RULES: Record<Exclude<SearchEngine, 'wikipedia'>, EngineRule> = {
  baidu: BAIDU,
  bing: BING,
  google: GOOGLE,
  yandex: YANDEX,
}

/**
 * 搜索地址（纯函数）。baidu / bing / google / yandex 抓 HTML 结果页；
 * wikipedia 走官方 API（JSON），lang 缺省 zh。
 */
export function serpUrl(engine: SearchEngine, query: string, opts?: { lang?: string }): string {
  const q = encodeURIComponent(query)
  switch (engine) {
    case 'baidu':
      return 'https://www.baidu.com/s?wd=' + q + '&rn=20'
    case 'bing':
      return 'https://www.bing.com/search?q=' + q + '&count=20'
    case 'google':
      // gbv=1 是「免 JS 的基础版」：没有它，谷歌给脚本化页面的概率大得多
      return 'https://www.google.com/search?q=' + q + '&num=20&gbv=1&hl=' + (opts?.lang === 'en' ? 'en' : 'zh-CN')
    case 'yandex':
      return 'https://yandex.com/search/?text=' + q
    case 'wikipedia': {
      const lang = /^[a-z]{2,3}(-[a-z-]+)?$/i.test(opts?.lang ?? '') ? (opts?.lang as string) : 'zh'
      return (
        'https://' + lang + '.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=15&utf8=1&srsearch=' + q
      )
    }
  }
}

/**
 * 解析一份 SERP 的 HTML（或 wikipedia 的 JSON），回结果列表。
 * 解析不出（验证码、需要浏览器的页面、改版）就回空数组——由调用方说「换一家」。
 * lang 只对 wikipedia 生效（结果链接要落到对应语言的站点上）。
 */
export function parseSerp(engine: SearchEngine, html: string, opts?: { lang?: string }): SerpResult[] {
  if (engine === 'wikipedia') return parseWikipedia(html, opts?.lang ?? 'zh')
  const rule = RULES[engine]
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out: SerpResult[] = []
  const seen = new Set<string>()
  for (const item of Array.from(doc.querySelectorAll(rule.item))) {
    const a = item.querySelector(rule.link)
    if (!a) continue
    const rawHref = a.getAttribute('href') ?? ''
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) continue
    const url = rule.clean ? rule.clean(rawHref) : rawHref
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    const title = (a.querySelector('h3')?.textContent ?? a.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!title) continue
    let snippet = ''
    for (const sel of rule.snippet) {
      const el = item.querySelector(sel)
      const text = (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (text) {
        snippet = text
        break
      }
    }
    seen.add(url)
    out.push({ title, url, snippet: snippet.slice(0, SNIPPET_MAX) })
    if (out.length >= 20) break
  }
  return out
}

/** wikipedia 的官方 API：JSON 里的 snippet 是一段 HTML，标签剥掉就是摘要 */
function parseWikipedia(html: string, lang: string): SerpResult[] {
  let parsed: { query?: { search?: Array<{ title?: unknown; snippet?: unknown }> } }
  try {
    parsed = JSON.parse(html) as typeof parsed
  } catch {
    return []
  }
  const hits = parsed.query?.search ?? []
  const out: SerpResult[] = []
  for (const hit of hits) {
    if (typeof hit.title !== 'string' || !hit.title) continue
    const title = hit.title.replace(/\s+/g, ' ').trim()
    const snippet =
      typeof hit.snippet === 'string'
        ? hit.snippet
            .replace(/<[^>]+>/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, SNIPPET_MAX)
        : ''
    out.push({
      title,
      url: 'https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')),
      snippet,
    })
  }
  return out
}
